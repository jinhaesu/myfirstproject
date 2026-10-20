"""경영관리 서비스 — 교차 검증 대시보드.

부서 데이터를 서로 대조해 경영 관점의 이상치·gap을 요약:
 1) 매출기반 원가추정(판매수량×BOM원가=Σcost_cogs) vs 실제 원부재료 구매액
 2) 생산 BOM 소요 금액 vs 실제 구매 금액 gap
 3) mysixth 근무시간 vs 생산/물류 기입시간 gap
 4) 재고 현황 요약(마이너스 재고 등)
 5) 실사 재고조정(수동조정·실사보정) 사유
"""
from __future__ import annotations

import re
from datetime import date
from typing import Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db_models import (
    ChannelSalesDailyProduct, PurchaseRecord, InventoryStockLedger,
    ProductMaster,
)
from app.services import purchase_service as pur
from app.services import inventory_service as inv
from app.services import logistics_service as logi


def _sales_costs(db: Session, start: date, end: date) -> dict:
    r = db.query(
        func.coalesce(func.sum(ChannelSalesDailyProduct.net_sales), 0.0),
        func.coalesce(func.sum(ChannelSalesDailyProduct.cost_cogs), 0.0),
        func.coalesce(func.sum(ChannelSalesDailyProduct.cost_labor), 0.0),
        func.coalesce(func.sum(ChannelSalesDailyProduct.pcs_qty), 0.0),
    ).filter(
        ChannelSalesDailyProduct.sale_date >= start,
        ChannelSalesDailyProduct.sale_date <= end,
    ).one()
    return {"net_sales": float(r[0] or 0), "cogs_est": float(r[1] or 0),
            "labor_est": float(r[2] or 0), "pcs_qty": float(r[3] or 0)}


def _bom_codes(db: Session) -> set:
    """BOM 자재 마스터(원재료·부자재) ERP 코드 — 실제구매 중 BOM이 다루는 범위 판별용."""
    from app.db_models import ScmRawMaterial, ScmSubMaterial
    codes = {c for (c,) in db.query(ScmRawMaterial.erp_code).all() if c}
    codes |= {c for (c,) in db.query(ScmSubMaterial.erp_code).all() if c}
    return {str(c).strip() for c in codes if str(c).strip() not in ("", "-")}


# 개당 포장(BOM 부자재): 롤지·인쇄필름('_8도' 등 도수 표기)·삼방지퍼백·머핀컵
_PIECE_PACK = re.compile(r"롤지|\d\s*도(?![가-힣])|삼방지퍼백|머핀컵")
# 비교 제외(판매단위 포장·물류·제판비) 그룹
_EXCL_GROUPS = [
    ("물류·보냉(드라이아이스·아이스박스/팩·택배박스·완충재)", re.compile(r"드라이아이스|아이스팩|아이스박스|택배박스|완충재|보냉")),
    ("판매 포장(단상자·선물박스·구/입 패키지·쇼핑백)", re.compile(r"단상자|박스|\d\s*구|\d\s*(?:개)?입|카토너|쇼핑백|패키지|케이스|파우치")),
    ("제판·목형비", re.compile(r"목형|동판|제판")),
]


def bom_scope_classifier(db: Session):
    """구매 1행이 원가(BOM) 비교 범위인지 판정 → fn(item_code, item_name, mclass) -> bool.

    범위 = ① BOM 자재 마스터 품목코드 ② 원재료(원산지 변경 등으로 코드가 바뀐 원료 포함)
          ③ 개당 포장(롤지·인쇄필름·지퍼백 등, BOM 부자재).
    제외 = 판매단위 포장(단상자·선물박스)·물류/보냉자재·제판비 등 BOM에 없는 구매.
    (2026-10-20: 코드만으로 판정 시 코코아파우더·PTS 등 원재료 2.2억이 '비대상'으로 잘못 빠짐)
    """
    codes = _bom_codes(db)

    def in_scope(code, name, mclass) -> bool:
        if code and str(code).strip() in codes:
            return True
        if (mclass or "") == "원재료":
            return True
        return bool(_PIECE_PACK.search(name or ""))
    return in_scope


def excluded_group(name: str) -> str:
    for g, rx in _EXCL_GROUPS:
        if rx.search(name or ""):
            return g
    return "기타 부재료"


def _pm_cost_resolver(db: Session):
    """생산품목명 → CSA 표준품목(이름·별칭 최장 부분일치) 개당 원가(cogs 규칙).
    SCM 완제품명과 매칭 안 되는 생산명('GS 도넛케이크 다크초코' 등)의 이론원가 폴백."""
    from app.db_models import CsaCostRule, CsaCostItem
    cogs_id = db.query(CsaCostItem.id).filter(CsaCostItem.code == "cogs").scalar()
    amt = {}
    if cogs_id:
        for pid, a in db.query(CsaCostRule.product_id, CsaCostRule.amount_per_pcs).filter(
                CsaCostRule.cost_item_id == cogs_id, CsaCostRule.channel_id.is_(None),
                CsaCostRule.is_active.is_(True)).all():
            if pid and a:
                amt[pid] = float(a)
    keys = []
    for p in db.query(ProductMaster).filter(ProductMaster.id.in_(list(amt) or [-1])).all():
        names = [p.name or ""] + ([str(a) for a in p.aliases if a] if isinstance(p.aliases, list) else [])
        for k in names:
            k2 = k.replace(" ", "").lower()
            if len(k2) >= 2:
                keys.append((k2, amt[p.id]))
    keys.sort(key=lambda x: -len(x[0]))

    def resolve(name: str):
        n = (name or "").replace(" ", "").lower()
        for k, a in keys:
            if k in n:
                return a
        return None
    return resolve


def excluded_purchases(db: Session, start: date, end: date, team: Optional[str] = None,
                       limit: int = 100) -> dict:
    """원가 비교에서 제외되는 BOM 비대상 구매(판매포장·물류/보냉·제판비 등) 내역 — 품목별·그룹별 합계(공급가)."""
    in_scope = bom_scope_classifier(db)
    q = db.query(PurchaseRecord.item_code, PurchaseRecord.item_name, PurchaseRecord.mclass,
                 PurchaseRecord.vendor_name, PurchaseRecord.supply_amount).filter(
        PurchaseRecord.pdate >= start, PurchaseRecord.pdate <= end)
    if team:
        q = q.filter(PurchaseRecord.team == team)
    items: dict = {}
    by_class: dict = {}
    total = included = 0.0
    for code, name, mc, vendor, amt in q.all():
        amt = float(amt or 0)
        total += amt
        if in_scope(code, name, mc):
            included += amt
            continue
        nm = re.sub(r"\s+", " ", re.sub(r"\[.*?\]", "", name or "")).strip() or "(품목명 없음)"
        grp = excluded_group(nm)
        e = items.setdefault((code or "", nm), {"item_code": code, "item_name": nm, "mclass": mc, "group": grp,
                                                 "vendor": vendor, "amount": 0.0, "count": 0})
        e["amount"] += amt; e["count"] += 1
        by_class[grp] = by_class.get(grp, 0.0) + amt
    rows = sorted(items.values(), key=lambda x: -x["amount"])
    for r in rows:
        r["amount"] = round(r["amount"])
    excluded = total - included
    return {
        "start": start.isoformat(), "end": end.isoformat(), "basis": "supply",
        "purchase_total": round(total), "bom_scope": round(included), "excluded": round(excluded),
        "excluded_pct": round(excluded / total * 100, 1) if total else None,
        "item_count": len(rows),
        "by_group": [{"group": k, "amount": round(v)} for k, v in sorted(by_class.items(), key=lambda x: -x[1])],
        "items": rows[:limit],
    }


def _purchase_actual(db: Session, start: date, end: date) -> dict:
    rows = db.query(PurchaseRecord.mclass, func.coalesce(func.sum(PurchaseRecord.supply_amount), 0.0)).filter(
        PurchaseRecord.pdate >= start, PurchaseRecord.pdate <= end).group_by(PurchaseRecord.mclass).all()
    raw = sub = 0.0
    for c, v in rows:
        if c == "부재료":
            sub += float(v or 0)
        else:
            raw += float(v or 0)
    return {"raw": raw, "sub": sub, "total": raw + sub}


def overview(db: Session, start: date, end: date) -> dict:
    sc = _sales_costs(db, start, end)
    pa = _purchase_actual(db, start, end)

    # 1) 매출기반 원가추정 vs 실제 구매액 — 비교는 BOM 자재코드 범위 구매(포장·물류자재 제외)로
    cogs_est = sc["cogs_est"]
    purchase_total = pa["total"]
    in_scope = bom_scope_classifier(db)
    bom_scope = sum(float(a or 0) for c, n, mc, a in db.query(
        PurchaseRecord.item_code, PurchaseRecord.item_name, PurchaseRecord.mclass, PurchaseRecord.supply_amount).filter(
        PurchaseRecord.pdate >= start, PurchaseRecord.pdate <= end).all() if in_scope(c, n, mc))
    cost_vs_purchase = {
        "net_sales": round(sc["net_sales"]),
        "cogs_est": round(cogs_est),                 # 판매수량×BOM원가 (Σcost_cogs)
        "cogs_ratio": round(cogs_est / sc["net_sales"] * 100, 1) if sc["net_sales"] else None,
        "purchase_actual": round(purchase_total),    # 실제 원부재료 구매(공급가)
        "purchase_raw": round(pa["raw"]), "purchase_sub": round(pa["sub"]),
        "purchase_ratio": round(purchase_total / sc["net_sales"] * 100, 1) if sc["net_sales"] else None,
        "purchase_bom_scope": round(bom_scope),
        "purchase_excluded": round(purchase_total - bom_scope),   # BOM 비대상(포장·물류·소모품) — 비교에서 제외
        "gap": round(bom_scope - cogs_est),          # +면 구매>소비(재고빌드/과다구매), −면 구매<소비(재고소진)
    }

    # 2) BOM 이론소요 vs 실제 구매
    try:
        mr = pur.material_requirement(db, start, end)
        bom_cost = mr.get("total_cost", 0)
    except Exception:
        mr, bom_cost = {}, 0
    # BOM 품목명 미매칭 생산분은 CSA 표준품목 개당원가로 폴백(누락=0원 과소 방지)
    resolve = _pm_cost_resolver(db)
    fb_cost = 0.0; still_unmatched = 0.0
    for u in (mr.get("unmatched") or []):
        c = resolve(u.get("name"))
        if c:
            fb_cost += (u.get("qty") or 0) * c
        else:
            still_unmatched += (u.get("qty") or 0)
    bom_cost += fb_cost
    bom_vs_purchase = {
        "bom_req_cost": round(bom_cost),             # 생산 BOM 소요 이론금액(미매칭분 표준품목 원가 폴백 포함)
        "bom_fallback_cost": round(fb_cost),
        "unmatched_prod_qty": round(still_unmatched),
        "purchase_actual": round(purchase_total),
        "purchase_bom_scope": round(float(bom_scope)),   # BOM 범위 구매(원재료+개당포장, 판매포장·물류 제외)
        "gap": round(float(bom_scope) - bom_cost),
        "gap_pct": round((float(bom_scope) - bom_cost) / bom_cost * 100, 1) if bom_cost else None,
    }

    # 3) 근무시간 vs 기입시간
    try:
        pl = inv.labor_compare(db, start, end, granularity="day")
    except Exception:
        pl = {}
    try:
        ll = logi.logistics_compare(db, start, end, granularity="day")
    except Exception:
        ll = {}
    labor = {
        "production": {
            "logged_hours": pl.get("total_prod_hours", 0),
            "attendance_hours": pl.get("total_att_hours", 0),
            "ratio": pl.get("total_hours_ratio", 0),
            "gap_hours": round((pl.get("total_prod_hours", 0) or 0) - (pl.get("total_att_hours", 0) or 0), 1),
        },
        "logistics": {
            "logged_hours": ll.get("total_prod_hours", 0),
            "attendance_hours": ll.get("total_att_hours", 0),
            "ratio": ll.get("total_hours_ratio", 0),
            "gap_hours": round((ll.get("total_prod_hours", 0) or 0) - (ll.get("total_att_hours", 0) or 0), 1),
        },
    }

    # 4) 재고 현황 (end 시점)
    stock = inv.current_stock_map(db, as_of=end)
    prod_names = {p.id: p.name for p in db.query(ProductMaster.id, ProductMaster.name).all()}
    agg: dict[int, float] = {}
    for (w, p), q in stock.items():
        agg[p] = agg.get(p, 0.0) + q
    neg = [(pid, q) for pid, q in agg.items() if q < -0.5]
    neg.sort(key=lambda x: x[1])
    inventory = {
        "product_count": len(agg),
        "negative_count": len(neg),
        "total_qty": round(sum(agg.values())),
        "top_negative": [{"product": prod_names.get(pid, str(pid)), "qty": round(q)} for pid, q in neg[:10]],
    }

    # 5) 실사·조정 사유
    adj_rows = db.query(InventoryStockLedger).filter(
        InventoryStockLedger.movement_type.in_(["adjustment", "count_correction"]),
        InventoryStockLedger.movement_date >= start,
        InventoryStockLedger.movement_date <= end,
    ).order_by(InventoryStockLedger.movement_date.desc()).all()
    adj_total = sum(a.qty_delta or 0 for a in adj_rows)
    adjustments = {
        "count": len(adj_rows),
        "net_qty": round(adj_total),
        "items": [{
            "date": a.movement_date.isoformat() if a.movement_date else None,
            "type": "실사보정" if a.movement_type == "count_correction" else "수동조정",
            "product": prod_names.get(a.product_id, str(a.product_id)),
            "qty_delta": round(a.qty_delta or 0),
            "reason": a.reason or "(사유 미기재)",
            "by": a.created_by,
        } for a in adj_rows[:30]],
    }

    # 핵심 요약(경보)
    alerts = []
    if cost_vs_purchase["gap"] > sc["net_sales"] * 0.05 and sc["net_sales"]:
        alerts.append({"level": "info", "text": f"구매액이 매출원가추정보다 {pur_won(cost_vs_purchase['gap'])} 많음 — 재고 빌드업 또는 과다구매 점검"})
    if cost_vs_purchase["gap"] < -sc["net_sales"] * 0.05 and sc["net_sales"]:
        alerts.append({"level": "warn", "text": f"구매액이 매출원가추정보다 {pur_won(-cost_vs_purchase['gap'])} 적음 — 재고 소진 진행"})
    if bom_vs_purchase["gap_pct"] is not None and abs(bom_vs_purchase["gap_pct"]) > 30:
        alerts.append({"level": "warn", "text": f"BOM 이론소요 대비 실제구매 gap {bom_vs_purchase['gap_pct']}% — BOM 원가/구매단가 정합 점검"})
    for dept, lab in (("생산", labor["production"]), ("물류", labor["logistics"])):
        r = lab["ratio"]
        if r and (r < 0.7 or r > 1.3):
            alerts.append({"level": "warn", "text": f"{dept} 기입시간/근무시간 비율 {r} — 기입 시간과 실제 근무시간 괴리"})
    if inventory["negative_count"] > 0:
        alerts.append({"level": "warn", "text": f"마이너스 재고 {inventory['negative_count']}개 품목 — 기초재고 미입력 또는 매핑 누락 가능"})
    unreasoned = sum(1 for a in adj_rows if not (a.reason or "").strip())
    if unreasoned:
        alerts.append({"level": "info", "text": f"사유 미기재 재고조정 {unreasoned}건"})

    return {
        "start": start.isoformat(), "end": end.isoformat(),
        "cost_vs_purchase": cost_vs_purchase,
        "bom_vs_purchase": bom_vs_purchase,
        "labor": labor,
        "inventory": inventory,
        "adjustments": adjustments,
        "alerts": alerts,
    }


def pur_won(n) -> str:
    n = abs(n or 0)
    if n >= 1e8:
        return f"{n/1e8:.1f}억"
    if n >= 1e4:
        return f"{round(n/1e4):,}만"
    return f"{round(n):,}원"


def trend(db: Session, start: date, end: date, granularity: str = "month",
          team: Optional[str] = None) -> dict:
    """기간 내 월/주/일별 추이 — 실제구매·매출원가추정(cost_cogs)·BOM이론소요·매출.

    BOM 이론소요는 동기화된 ScmProduct.default_cost(개당원가)×생산량으로 고속 계산.
    team 지정 시 실제구매 측만 해당 팀으로 필터(매출·원가·BOM 소요는 전사 기준 유지).
    """
    import re
    from datetime import timedelta
    from app.db_models import ScmProduct, InventoryProduction
    from app.services import purchase_service as pur_svc

    def bucket(d):
        if granularity == "month":
            return f"{d.year}-{d.month:02d}"
        if granularity == "week":
            monday = d - timedelta(days=d.weekday())
            return monday.isoformat()
        return d.isoformat()

    # 실제 구매(공급가) — 전체 + BOM 자재코드 범위(원가 비교용, 포장·물류자재·소모품 제외)
    in_scope = bom_scope_classifier(db)
    pur: dict = {}
    pur_bom: dict = {}
    _pq = db.query(PurchaseRecord.pdate, PurchaseRecord.supply_amount, PurchaseRecord.item_code,
                   PurchaseRecord.item_name, PurchaseRecord.mclass).filter(
        PurchaseRecord.pdate >= start, PurchaseRecord.pdate <= end)
    if team:
        _pq = _pq.filter(PurchaseRecord.team == team)
    for pd, amt, code, iname, mcl in _pq.all():
        if pd:
            pur[bucket(pd)] = pur.get(bucket(pd), 0) + (amt or 0)
            if in_scope(code, iname, mcl):
                pur_bom[bucket(pd)] = pur_bom.get(bucket(pd), 0) + (amt or 0)

    # 매출·원가추정(cost_cogs)
    sal: dict = {}
    cogs: dict = {}
    for sd, ns, cc in db.query(
            ChannelSalesDailyProduct.sale_date, ChannelSalesDailyProduct.net_sales,
            ChannelSalesDailyProduct.cost_cogs).filter(
            ChannelSalesDailyProduct.sale_date >= start, ChannelSalesDailyProduct.sale_date <= end).all():
        if sd:
            b = bucket(sd)
            sal[b] = sal.get(b, 0) + (ns or 0)
            cogs[b] = cogs.get(b, 0) + (cc or 0)

    # BOM 이론소요 = 생산량 × 개당원가(동기화된 default_cost)
    cost_by_id = {p.id: p.default_cost for p in db.query(ScmProduct.id, ScmProduct.default_cost).all()
                  if p.default_cost}
    match = pur_svc.build_prod_matcher(db)
    resolve = _pm_cost_resolver(db)
    bom: dict = {}
    unmatched_qty = 0.0
    for pd, name, q in db.query(
            InventoryProduction.prod_date, InventoryProduction.product_name,
            InventoryProduction.qty).filter(
            InventoryProduction.prod_date >= start, InventoryProduction.prod_date <= end,
            InventoryProduction.product_name.isnot(None)).all():
        if not pd or not q:
            continue
        iid, _how = match(name)
        c = cost_by_id.get(iid) if iid else None
        if c is None:
            c = resolve(name)   # SCM명 미매칭 → CSA 표준품목 개당원가 폴백
        if c:
            bom[bucket(pd)] = bom.get(bucket(pd), 0) + q * c
        else:
            unmatched_qty += q

    keys = sorted(set(pur) | set(sal) | set(bom))
    series = []
    for k in keys:
        p = round(pur.get(k, 0)); s = round(sal.get(k, 0)); pb = round(pur_bom.get(k, 0))
        cg = round(cogs.get(k, 0)); bm = round(bom.get(k, 0))
        series.append({
            "bucket": k, "purchase": p, "purchase_bom": pb, "purchase_excluded": p - pb,
            "sales": s, "cogs_est": cg, "bom_req": bm,
            "purchase_ratio": round(p / s * 100, 1) if s else None,
            "purchase_bom_ratio": round(pb / s * 100, 1) if s else None,
            "cogs_ratio": round(cg / s * 100, 1) if s else None,
            "bom_gap": pb - bm, "cogs_gap": pb - cg,
        })
    return {"granularity": granularity, "series": series, "unmatched_prod_qty": round(unmatched_qty)}


def labor_trend(db: Session, start: date, end: date, granularity: str = "month") -> dict:
    """근무시간(mysixth) vs 기입시간(생산·물류) 기간별 추이."""
    try:
        pl = inv.labor_compare(db, start, end, granularity=granularity)
    except Exception:
        pl = {"series": []}
    try:
        ll = logi.logistics_compare(db, start, end, granularity=granularity)
    except Exception:
        ll = {"series": []}
    idx: dict = {}
    for s in pl.get("series", []):
        b = s.get("period")
        e = idx.setdefault(b, {"bucket": b, "prod_logged": 0, "prod_att": 0, "logi_logged": 0, "logi_att": 0})
        e["prod_logged"] = round(s.get("prod_hours", 0) or 0, 1)
        e["prod_att"] = round(s.get("att_hours", 0) or 0, 1)
    for s in ll.get("series", []):
        b = s.get("period")
        e = idx.setdefault(b, {"bucket": b, "prod_logged": 0, "prod_att": 0, "logi_logged": 0, "logi_att": 0})
        e["logi_logged"] = round(s.get("prod_hours", 0) or 0, 1)
        e["logi_att"] = round(s.get("att_hours", 0) or 0, 1)
    series = []
    for b in sorted(idx.keys()):
        e = idx[b]
        e["prod_ratio"] = round(e["prod_logged"] / e["prod_att"], 2) if e["prod_att"] else None
        e["logi_ratio"] = round(e["logi_logged"] / e["logi_att"], 2) if e["logi_att"] else None
        series.append(e)
    return {"granularity": granularity, "series": series}
