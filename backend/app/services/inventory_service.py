"""재고 관리 서비스 — 매출→재고 1단계.

핵심: "가상 판매차감 원장".
  현재고(창고w, 품목p, d시점)
    = Σ 원장이동(inventory_stock_ledger, movement_date ≤ d)
    − Σ 판매낱개(csa_sales_daily_product.pcs_qty, 채널→창고 매핑 w, sale_date ≤ d)
판매출고는 원장에 물리 기록하지 않고 판매집계에서 매번 실시간 계산한다.
원장에는 기초재고(opening)·생산입고(production_in)·수동조정(adjustment)·
실사보정(count_correction)·창고이동(transfer)만 append 된다.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db_models import (
    InventoryWarehouse,
    InventoryChannelWarehouse,
    InventoryStockLedger,
    InventorySafetyStock,
    InventoryCountSession,
    InventoryCountLine,
    InventoryProduction,
    ChannelSalesDailyProduct,
    ProductMaster,
)


# ──────────────────────────────────────────────
# 마스터 로더
# ──────────────────────────────────────────────

def load_products(db: Session, only_active: bool = False) -> dict[int, dict]:
    """csa_product_master → {id: {code,name,category,unit}}"""
    q = db.query(ProductMaster)
    if only_active:
        q = q.filter(ProductMaster.is_active.is_(True))
    out: dict[int, dict] = {}
    for p in q.all():
        out[p.id] = {
            "id": p.id,
            "code": p.code,
            "name": p.name,
            "category": p.category or "",
            "unit_size": p.default_unit_size or 1,
        }
    return out


def load_warehouses(db: Session, only_active: bool = False) -> list[dict]:
    q = db.query(InventoryWarehouse)
    if only_active:
        q = q.filter(InventoryWarehouse.is_active.is_(True))
    q = q.order_by(InventoryWarehouse.sort_order, InventoryWarehouse.id)
    return [
        {
            "id": w.id, "code": w.code, "name": w.name, "location": w.location,
            "is_active": w.is_active, "sort_order": w.sort_order, "notes": w.notes,
        }
        for w in q.all()
    ]


def channel_warehouse_map(db: Session) -> dict[str, int]:
    """{channel_id: warehouse_id} (활성 매핑만)."""
    rows = db.query(
        InventoryChannelWarehouse.channel_id,
        InventoryChannelWarehouse.warehouse_id,
    ).filter(InventoryChannelWarehouse.is_active.is_(True)).all()
    return {cid: wid for cid, wid in rows}


# ──────────────────────────────────────────────
# 현재고 계산 (원장 − 판매차감)
# ──────────────────────────────────────────────

def _ledger_sums(
    db: Session,
    as_of: Optional[date] = None,
    warehouse_id: Optional[int] = None,
    product_id: Optional[int] = None,
    types: Optional[list[str]] = None,
) -> dict[tuple[int, int], float]:
    """Σ qty_delta grouped by (warehouse_id, product_id)."""
    q = db.query(
        InventoryStockLedger.warehouse_id,
        InventoryStockLedger.product_id,
        func.coalesce(func.sum(InventoryStockLedger.qty_delta), 0.0),
    )
    if as_of is not None:
        q = q.filter(InventoryStockLedger.movement_date <= as_of)
    if warehouse_id is not None:
        q = q.filter(InventoryStockLedger.warehouse_id == warehouse_id)
    if product_id is not None:
        q = q.filter(InventoryStockLedger.product_id == product_id)
    if types is not None:
        q = q.filter(InventoryStockLedger.movement_type.in_(types))
    q = q.group_by(InventoryStockLedger.warehouse_id, InventoryStockLedger.product_id)
    return {(w, p): float(s or 0) for w, p, s in q.all()}


def _sales_sums(
    db: Session,
    as_of: Optional[date] = None,
    start: Optional[date] = None,
    warehouse_id: Optional[int] = None,
    product_id: Optional[int] = None,
) -> dict[tuple[int, int], float]:
    """Σ pcs_qty grouped by (warehouse_id, product_id).
    채널→창고 매핑(InventoryChannelWarehouse)으로 창고 귀속. 매핑 없는 채널 제외."""
    q = db.query(
        InventoryChannelWarehouse.warehouse_id,
        ChannelSalesDailyProduct.product_id,
        func.coalesce(func.sum(ChannelSalesDailyProduct.pcs_qty), 0.0),
    ).join(
        InventoryChannelWarehouse,
        InventoryChannelWarehouse.channel_id == ChannelSalesDailyProduct.channel_id,
    ).filter(
        InventoryChannelWarehouse.is_active.is_(True),
        ChannelSalesDailyProduct.product_id.isnot(None),
    )
    if as_of is not None:
        q = q.filter(ChannelSalesDailyProduct.sale_date <= as_of)
    if start is not None:
        q = q.filter(ChannelSalesDailyProduct.sale_date >= start)
    if warehouse_id is not None:
        q = q.filter(InventoryChannelWarehouse.warehouse_id == warehouse_id)
    if product_id is not None:
        q = q.filter(ChannelSalesDailyProduct.product_id == product_id)
    q = q.group_by(InventoryChannelWarehouse.warehouse_id, ChannelSalesDailyProduct.product_id)
    return {(w, p): float(s or 0) for w, p, s in q.all()}


def _production_sums(
    db: Session,
    as_of: Optional[date] = None,
    start: Optional[date] = None,
    warehouse_id: Optional[int] = None,
    product_id: Optional[int] = None,
) -> dict[tuple[int, int], float]:
    """Σ 생산량(inventory_production.qty) grouped by (warehouse_id, product_id).
    생산은 재고 보충원 — 판매차감과 대칭으로 현재고에 가산된다."""
    q = db.query(
        InventoryProduction.warehouse_id,
        InventoryProduction.product_id,
        func.coalesce(func.sum(InventoryProduction.qty), 0.0),
    ).filter(
        InventoryProduction.product_id.isnot(None),
        InventoryProduction.warehouse_id.isnot(None),
    )
    if as_of is not None:
        q = q.filter(InventoryProduction.prod_date <= as_of)
    if start is not None:
        q = q.filter(InventoryProduction.prod_date >= start)
    if warehouse_id is not None:
        q = q.filter(InventoryProduction.warehouse_id == warehouse_id)
    if product_id is not None:
        q = q.filter(InventoryProduction.product_id == product_id)
    q = q.group_by(InventoryProduction.warehouse_id, InventoryProduction.product_id)
    return {(w, p): float(s or 0) for w, p, s in q.all()}


def current_stock_map(
    db: Session,
    as_of: Optional[date] = None,
    warehouse_id: Optional[int] = None,
    product_id: Optional[int] = None,
) -> dict[tuple[int, int], float]:
    """{(warehouse_id, product_id): 현재고}. as_of 미지정 시 오늘 시점(전체).
    현재고 = 원장(기초·조정·실사보정) + 생산 − 판매."""
    ledger = _ledger_sums(db, as_of=as_of, warehouse_id=warehouse_id, product_id=product_id)
    prod = _production_sums(db, as_of=as_of, warehouse_id=warehouse_id, product_id=product_id)
    sales = _sales_sums(db, as_of=as_of, warehouse_id=warehouse_id, product_id=product_id)
    keys = set(ledger) | set(prod) | set(sales)
    return {k: ledger.get(k, 0.0) + prod.get(k, 0.0) - sales.get(k, 0.0) for k in keys}


# ──────────────────────────────────────────────
# 재고 현황 행 (품목 단위, 창고/카테고리 필터)
# ──────────────────────────────────────────────

def _safety_map(db: Session) -> dict[tuple[Optional[int], int], dict]:
    """{(warehouse_id|None, product_id): {reorder_point, safety_stock, reorder_qty, target_stock}}"""
    out: dict[tuple[Optional[int], int], dict] = {}
    for s in db.query(InventorySafetyStock).filter(InventorySafetyStock.is_active.is_(True)).all():
        out[(s.warehouse_id, s.product_id)] = {
            "safety_stock": float(s.safety_stock or 0),
            "reorder_point": float(s.reorder_point or 0),
            "reorder_qty": float(s.reorder_qty or 0),
            "target_stock": float(s.target_stock or 0),
        }
    return out


def _resolve_safety(smap: dict, warehouse_id: Optional[int], product_id: int) -> Optional[dict]:
    """창고×품목 우선, 없으면 전체공통(warehouse_id=None) 폴백."""
    if warehouse_id is not None and (warehouse_id, product_id) in smap:
        return smap[(warehouse_id, product_id)]
    if (None, product_id) in smap:
        return smap[(None, product_id)]
    return None


def stock_status(qty: float, safety: Optional[dict]) -> str:
    """정상/주의/부족/품절."""
    if qty <= 0:
        return "품절"
    if safety:
        rp = safety.get("reorder_point", 0)
        ss = safety.get("safety_stock", 0)
        if qty <= ss:
            return "부족"
        if rp and qty <= rp:
            return "주의"
    return "정상"


def stock_rows(
    db: Session,
    as_of: Optional[date] = None,
    warehouse_id: Optional[int] = None,
    category: Optional[str] = None,
    only_active: bool = True,
    include_zero: bool = True,
) -> dict:
    """재고 현황 표. 창고 미지정이면 전체 창고 합산(품목별)."""
    products = load_products(db, only_active=only_active)
    warehouses = {w["id"]: w for w in load_warehouses(db)}
    smap = _safety_map(db)
    stock = current_stock_map(db, as_of=as_of, warehouse_id=warehouse_id)

    # 품목별(+창고 지정 시 그 창고) 집계
    agg: dict[tuple[Optional[int], int], float] = {}
    for (wid, pid), qty in stock.items():
        key = (wid if warehouse_id is not None else None, pid)
        agg[key] = agg.get(key, 0.0) + qty

    # include_zero: 재고 이력 없는 품목도 0으로 표시
    if include_zero:
        for pid in products:
            key = (warehouse_id, pid)
            agg.setdefault(key, 0.0)

    rows = []
    for (wid, pid), qty in agg.items():
        prod = products.get(pid)
        if prod is None:
            continue
        if category and prod["category"] != category:
            continue
        safety = _resolve_safety(smap, warehouse_id, pid)
        rows.append({
            "product_id": pid,
            "product_code": prod["code"],
            "product_name": prod["name"],
            "category": prod["category"],
            "warehouse_id": wid,
            "warehouse_name": warehouses.get(wid, {}).get("name") if wid else None,
            "qty": round(qty, 2),
            "safety_stock": safety["safety_stock"] if safety else None,
            "reorder_point": safety["reorder_point"] if safety else None,
            "status": stock_status(qty, safety),
        })
    rows.sort(key=lambda r: (r["category"], r["product_name"]))
    return {
        "as_of": (as_of or date.today()).isoformat(),
        "warehouse_id": warehouse_id,
        "rows": rows,
        "count": len(rows),
    }


# ──────────────────────────────────────────────
# 기간별 흐름 (기초/입고/판매출고/보정/기말)
# ──────────────────────────────────────────────

def period_flows(
    db: Session,
    start: date,
    end: date,
    warehouse_id: Optional[int] = None,
    category: Optional[str] = None,
) -> dict:
    """품목별 기간 흐름: 기초재고(start 전) + 입고/판매출고/조정/보정(기간내) = 기말재고(end)."""
    from datetime import timedelta
    before = start - timedelta(days=1)
    products = load_products(db)

    opening = current_stock_map(db, as_of=before, warehouse_id=warehouse_id)
    closing = current_stock_map(db, as_of=end, warehouse_id=warehouse_id)

    # 기간내 원장 이동 유형별
    def _ledger_period(types):
        q = db.query(
            InventoryStockLedger.product_id,
            func.coalesce(func.sum(InventoryStockLedger.qty_delta), 0.0),
        ).filter(
            InventoryStockLedger.movement_date >= start,
            InventoryStockLedger.movement_date <= end,
            InventoryStockLedger.movement_type.in_(types),
        )
        if warehouse_id is not None:
            q = q.filter(InventoryStockLedger.warehouse_id == warehouse_id)
        q = q.group_by(InventoryStockLedger.product_id)
        return {p: float(s or 0) for p, s in q.all()}

    inflow = _ledger_period(["production_in", "transfer_in", "opening"])
    # 생산 입고(생산 테이블) 기간내 합산 → 입고에 가산
    prod_period = _production_sums(db, start=start, as_of=end, warehouse_id=warehouse_id)
    for (_w, pid), v in prod_period.items():
        inflow[pid] = inflow.get(pid, 0.0) + v
    adjust = _ledger_period(["adjustment"])
    correction = _ledger_period(["count_correction"])
    transfer_out = _ledger_period(["transfer_out"])
    # 기간내 판매출고 (양수로 표시)
    sold_map = _sales_sums(db, as_of=end, start=start, warehouse_id=warehouse_id)
    sold: dict[int, float] = {}
    for (_w, pid), v in sold_map.items():
        sold[pid] = sold.get(pid, 0.0) + v

    def _agg_by_prod(m):
        out: dict[int, float] = {}
        for k, v in m.items():
            pid = k[1] if isinstance(k, tuple) else k
            out[pid] = out.get(pid, 0.0) + v
        return out

    open_p = _agg_by_prod(opening)
    close_p = _agg_by_prod(closing)

    pids = set(open_p) | set(close_p) | set(inflow) | set(sold) | set(adjust) | set(correction)
    rows = []
    for pid in pids:
        prod = products.get(pid)
        if prod is None:
            continue
        if category and prod["category"] != category:
            continue
        rows.append({
            "product_id": pid,
            "product_code": prod["code"],
            "product_name": prod["name"],
            "category": prod["category"],
            "opening": round(open_p.get(pid, 0.0), 2),
            "inflow": round(inflow.get(pid, 0.0), 2),
            "sold": round(sold.get(pid, 0.0), 2),
            "adjustment": round(adjust.get(pid, 0.0), 2),
            "correction": round(correction.get(pid, 0.0), 2),
            "transfer_out": round(transfer_out.get(pid, 0.0), 2),
            "closing": round(close_p.get(pid, 0.0), 2),
        })
    rows = [r for r in rows if any(abs(r[k]) > 1e-9 for k in
            ("opening", "inflow", "sold", "adjustment", "correction", "closing"))]
    rows.sort(key=lambda r: (r["category"], r["product_name"]))
    return {
        "start": start.isoformat(), "end": end.isoformat(),
        "warehouse_id": warehouse_id, "rows": rows, "count": len(rows),
    }


# ──────────────────────────────────────────────
# 안전재고 보충 알림
# ──────────────────────────────────────────────

def replenishment(db: Session, warehouse_id: Optional[int] = None) -> dict:
    """현재고 ≤ 재주문점인 품목 리스트 + 권장보충량."""
    base = stock_rows(db, warehouse_id=warehouse_id, include_zero=True)
    smap = _safety_map(db)
    items = []
    for r in base["rows"]:
        safety = _resolve_safety(smap, warehouse_id, r["product_id"])
        if not safety:
            continue
        rp = safety.get("reorder_point", 0)
        if rp <= 0:
            continue
        if r["qty"] > rp:
            continue
        # 권장 보충량: reorder_qty 우선, 없으면 target_stock-현재고
        rq = safety.get("reorder_qty", 0)
        target = safety.get("target_stock", 0)
        suggest = rq if rq > 0 else max(target - r["qty"], 0)
        items.append({
            **r,
            "reorder_qty": rq,
            "target_stock": target,
            "suggest_qty": round(suggest, 2),
            "shortfall": round(rp - r["qty"], 2),
        })
    items.sort(key=lambda x: (x["status"] != "품절", x["status"] != "부족", -x["shortfall"]))
    return {"warehouse_id": warehouse_id, "items": items, "count": len(items)}


# ──────────────────────────────────────────────
# 실사 세션
# ──────────────────────────────────────────────

def count_session_snapshot(db: Session, session_id: int) -> list[dict]:
    """세션의 창고·기준일로 시스템재고 스냅샷을 라인에 채워 반환(미확정 시 갱신)."""
    sess = db.get(InventoryCountSession, session_id)
    if not sess:
        raise ValueError("세션 없음")
    products = load_products(db, only_active=True)
    stock = current_stock_map(db, as_of=sess.count_date, warehouse_id=sess.warehouse_id)
    sys_by_prod: dict[int, float] = {}
    for (_w, pid), v in stock.items():
        sys_by_prod[pid] = sys_by_prod.get(pid, 0.0) + v

    existing = {l.product_id: l for l in
                db.query(InventoryCountLine).filter(InventoryCountLine.session_id == session_id).all()}
    editable = sess.status == "draft"
    for pid, prod in products.items():
        sysq = round(sys_by_prod.get(pid, 0.0), 2)
        line = existing.get(pid)
        if line is None:
            line = InventoryCountLine(
                session_id=session_id, product_id=pid, product_name=prod["name"],
                system_qty=sysq, counted_qty=None, diff=0.0,
            )
            db.add(line)
            existing[pid] = line
        elif editable:
            line.system_qty = sysq
            if line.counted_qty is not None:
                line.diff = round(float(line.counted_qty) - sysq, 2)
    db.commit()

    out = []
    for pid, prod in sorted(products.items(), key=lambda kv: (kv[1]["category"], kv[1]["name"])):
        line = existing[pid]
        out.append({
            "line_id": line.id,
            "product_id": pid,
            "product_code": prod["code"],
            "product_name": prod["name"],
            "category": prod["category"],
            "system_qty": round(float(line.system_qty or 0), 2),
            "counted_qty": (round(float(line.counted_qty), 2) if line.counted_qty is not None else None),
            "diff": round(float(line.diff or 0), 2),
            "reason": line.reason or "",
        })
    return out


def confirm_count_session(db: Session, session_id: int, user: Optional[str] = None) -> dict:
    """실사 확정: diff≠0 라인은 reason 필수. 각 diff만큼 count_correction 이동 기록."""
    sess = db.get(InventoryCountSession, session_id)
    if not sess:
        raise ValueError("세션 없음")
    if sess.status == "confirmed":
        raise ValueError("이미 확정된 세션")

    lines = db.query(InventoryCountLine).filter(
        InventoryCountLine.session_id == session_id,
        InventoryCountLine.counted_qty.isnot(None),
    ).all()
    # 사유 누락 검증
    missing = []
    for l in lines:
        diff = round(float(l.counted_qty) - float(l.system_qty or 0), 2)
        l.diff = diff
        if abs(diff) > 1e-9 and not (l.reason or "").strip():
            missing.append({"product_id": l.product_id, "product_name": l.product_name, "diff": diff})
    if missing:
        db.rollback()
        return {"ok": False, "error": "reason_required", "missing": missing}

    posted = 0
    for l in lines:
        diff = round(float(l.counted_qty) - float(l.system_qty or 0), 2)
        if abs(diff) <= 1e-9:
            continue
        db.add(InventoryStockLedger(
            warehouse_id=sess.warehouse_id,
            product_id=l.product_id,
            movement_date=sess.count_date,
            movement_type="count_correction",
            qty_delta=diff,
            ref_type="count_session",
            ref_id=str(session_id),
            reason=l.reason,
            created_by=user,
        ))
        posted += 1
    sess.status = "confirmed"
    sess.confirmed_by = user
    sess.confirmed_at = datetime.utcnow()
    db.commit()
    return {"ok": True, "corrections_posted": posted, "session_id": session_id}


# ──────────────────────────────────────────────
# 기초재고 엑셀 파싱
# ──────────────────────────────────────────────

def parse_opening_excel(file_path: str) -> dict:
    """기초재고 엑셀 파싱. 유연한 헤더 매칭.
    필요 컬럼: 창고(코드 or 이름), 품목(코드 or 이름), 수량. 선택: 기준일.
    반환: {rows:[{warehouse, product, qty, date}], errors:[...]}"""
    from app.services.csa_parsers._common import read_excel_safe
    df = read_excel_safe(file_path)
    if df is None or df.empty:
        return {"rows": [], "errors": ["빈 파일"]}

    cols = {str(c).strip(): c for c in df.columns}

    def find(*cands):
        for cand in cands:
            for name, orig in cols.items():
                if cand in name.replace(" ", ""):
                    return orig
        return None

    c_wh = find("창고", "warehouse", "센터", "물류")
    c_prod = find("품목", "제품", "상품", "product", "품명")
    c_code = find("품목코드", "제품코드", "코드", "code", "sku")
    c_qty = find("수량", "재고", "qty", "stock", "낱개")
    c_date = find("기준일", "일자", "date", "기준")

    rows, errors = [], []
    if c_qty is None:
        return {"rows": [], "errors": ["수량 컬럼을 찾을 수 없습니다"]}
    if c_prod is None and c_code is None:
        return {"rows": [], "errors": ["품목(명 또는 코드) 컬럼을 찾을 수 없습니다"]}

    import pandas as pd
    for idx, r in df.iterrows():
        try:
            qty_raw = r[c_qty]
            if pd.isna(qty_raw):
                continue
            qty = float(str(qty_raw).replace(",", "").strip())
        except Exception:
            continue
        prod_name = str(r[c_prod]).strip() if c_prod is not None and not pd.isna(r[c_prod]) else ""
        prod_code = str(r[c_code]).strip() if c_code is not None and not pd.isna(r[c_code]) else ""
        wh = str(r[c_wh]).strip() if c_wh is not None and not pd.isna(r[c_wh]) else ""
        d = None
        if c_date is not None and not pd.isna(r[c_date]):
            try:
                d = pd.to_datetime(r[c_date]).date().isoformat()
            except Exception:
                d = None
        if not prod_name and not prod_code:
            continue
        rows.append({
            "warehouse": wh, "product_name": prod_name,
            "product_code": prod_code, "qty": qty, "date": d,
        })
    return {"rows": rows, "errors": errors}


def apply_opening(
    db: Session,
    rows: list[dict],
    default_warehouse_id: int,
    default_date: date,
    user: Optional[str] = None,
    mode: str = "replace",
) -> dict:
    """파싱된 기초재고 행을 원장에 opening 이동으로 반영.
    mode=replace: 동일 (창고,품목)의 기존 opening 이동을 지우고 새로 기록.
    창고/품목 해석: 코드 우선, 없으면 이름. 해석 실패 행은 errors."""
    warehouses = db.query(InventoryWarehouse).all()
    wh_by_code = {(w.code or "").strip().lower(): w.id for w in warehouses if w.code}
    wh_by_name = {(w.name or "").strip().lower(): w.id for w in warehouses if w.name}
    products = db.query(ProductMaster).all()
    pr_by_code = {(p.code or "").strip().lower(): p.id for p in products if p.code}
    pr_by_name = {(p.name or "").strip().lower(): p.id for p in products if p.name}
    # 별칭도 매칭
    pr_by_alias: dict[str, int] = {}
    for p in products:
        for a in (p.aliases or []):
            pr_by_alias[str(a).strip().lower()] = p.id

    applied, errors = 0, []
    seen: set[tuple[int, int]] = set()
    for r in rows:
        wname = (r.get("warehouse") or "").strip().lower()
        wid = wh_by_code.get(wname) or wh_by_name.get(wname) or default_warehouse_id
        pname = (r.get("product_name") or "").strip().lower()
        pcode = (r.get("product_code") or "").strip().lower()
        pid = (pr_by_code.get(pcode) or pr_by_name.get(pname)
               or pr_by_alias.get(pname) or pr_by_name.get(pcode))
        if not pid:
            errors.append({"row": r, "error": "품목 매칭 실패"})
            continue
        try:
            mdate = date.fromisoformat(r["date"]) if r.get("date") else default_date
        except Exception:
            mdate = default_date
        qty = float(r.get("qty") or 0)

        if mode == "replace":
            key = (wid, pid)
            if key not in seen:
                db.query(InventoryStockLedger).filter(
                    InventoryStockLedger.warehouse_id == wid,
                    InventoryStockLedger.product_id == pid,
                    InventoryStockLedger.movement_type == "opening",
                ).delete(synchronize_session=False)
                seen.add(key)
        db.add(InventoryStockLedger(
            warehouse_id=wid, product_id=pid, movement_date=mdate,
            movement_type="opening", qty_delta=qty,
            ref_type="opening_upload", reason="기초재고 업로드", created_by=user,
        ))
        applied += 1
    db.commit()
    return {"applied": applied, "errors": errors, "error_count": len(errors)}


# ──────────────────────────────────────────────
# 대시보드 집계
# ──────────────────────────────────────────────

def dashboard(db: Session, as_of: Optional[date] = None) -> dict:
    """재고 대시보드 요약: 총재고/품목수/부족·품절 수/창고별·카테고리별 분포/보충 필요 top."""
    products = load_products(db)
    warehouses = {w["id"]: w for w in load_warehouses(db, only_active=True)}
    smap = _safety_map(db)
    stock = current_stock_map(db, as_of=as_of)

    total_qty = 0.0
    by_wh: dict[int, float] = {}
    by_cat: dict[str, float] = {}
    prod_total: dict[int, float] = {}
    for (wid, pid), qty in stock.items():
        total_qty += qty
        by_wh[wid] = by_wh.get(wid, 0.0) + qty
        prod_total[pid] = prod_total.get(pid, 0.0) + qty
        cat = products.get(pid, {}).get("category", "") or "미분류"
        by_cat[cat] = by_cat.get(cat, 0.0) + qty

    # include 0 품목
    for pid in products:
        prod_total.setdefault(pid, 0.0)

    shortage = out_of_stock = 0
    for pid, qty in prod_total.items():
        safety = _resolve_safety(smap, None, pid)
        st = stock_status(qty, safety)
        if st == "품절":
            out_of_stock += 1
        elif st in ("부족", "주의") and safety and safety.get("reorder_point", 0) > 0:
            if qty <= safety["reorder_point"]:
                shortage += 1

    repl = replenishment(db)
    return {
        "as_of": (as_of or date.today()).isoformat(),
        "total_qty": round(total_qty, 2),
        "product_count": len(products),
        "shortage_count": shortage,
        "out_of_stock_count": out_of_stock,
        "warehouse_count": len(warehouses),
        "by_warehouse": [
            {"warehouse_id": wid, "warehouse_name": warehouses.get(wid, {}).get("name", f"창고{wid}"),
             "qty": round(q, 2)}
            for wid, q in sorted(by_wh.items(), key=lambda x: -x[1])
        ],
        "by_category": [
            {"category": c, "qty": round(q, 2)}
            for c, q in sorted(by_cat.items(), key=lambda x: -x[1])
        ],
        "replenishment_top": repl["items"][:10],
        "replenishment_total": repl["count"],
    }


# ──────────────────────────────────────────────
# 생산 실적 (RAW-DATA 엑셀 → 재고 보충)
# ──────────────────────────────────────────────

HOURLY_WAGE = 15000       # 노무비 산출 기준 시급(원, 최저시급). 노무비 = 시급 × 생산투여시간.
NIGHT_MULTIPLIER = 1.5    # 야간(22:00~06:00) 생산 노무비 가산율. 야간 = 시급 × 1.5.


def _is_night(grade) -> bool:
    """생산 구분(주간/야간)에서 야간 여부. 야간=밤 10시~아침 6시."""
    g = str(grade or "")
    return ("야" in g) or ("night" in g.lower())


def _labor_cost(hours, grade) -> float:
    """노무비 = 시급 × 시간 × (야간이면 1.5)."""
    mult = NIGHT_MULTIPLIER if _is_night(grade) else 1.0
    return round(HOURLY_WAGE * float(hours or 0) * mult, 2)


def _norm(s) -> str:
    return str(s or "").strip().replace(" ", "").lower()


def _production_maps(db: Session):
    """품목류/품목명 → csa_product_master.id 매핑 소스."""
    cat_map: dict[str, int] = {}
    for p in db.query(ProductMaster).all():
        if p.name:
            cat_map[_norm(p.name)] = p.id
        for a in (p.aliases or []):
            cat_map.setdefault(_norm(a), p.id)
    # scm_products.product_name → csa_product_id (보조 경로)
    scm_map: dict[str, int] = {}
    try:
        from app.db_models import ScmProduct
        for s in db.query(ScmProduct).filter(ScmProduct.csa_product_id.isnot(None)).all():
            if s.product_name:
                scm_map[_norm(s.product_name)] = s.csa_product_id
    except Exception:
        pass
    return cat_map, scm_map


def _resolve_prod(cat_map, scm_map, category, product_name) -> Optional[int]:
    pid = cat_map.get(_norm(category))
    if pid:
        return pid
    return scm_map.get(_norm(product_name))


def parse_production_excel(file_path: str) -> dict:
    """생산 RAW-DATA 엑셀 파싱. RAW-DATA 시트 우선, 유연 헤더 매칭.
    열: 날짜·담당자·생산위치·품목류·품목명·생산량·소요시간·단가·생산액·노무비·원가·원가총액·등급."""
    import pandas as pd
    try:
        if str(file_path).lower().endswith(".csv"):
            for enc in ("utf-8-sig", "utf-8", "cp949", "euc-kr"):
                try:
                    sheets = {"CSV": pd.read_csv(file_path, header=None, encoding=enc)}
                    break
                except UnicodeDecodeError:
                    continue
            else:
                sheets = {"CSV": pd.read_csv(file_path, header=None, encoding="utf-8", errors="ignore")}
        else:
            sheets = pd.read_excel(file_path, sheet_name=None, header=None)
    except Exception as e:
        return {"rows": [], "errors": [f"엑셀 읽기 실패: {e}"]}
    if not sheets:
        return {"rows": [], "errors": ["빈 파일"]}

    # RAW 시트 선택
    target_name = None
    for name in sheets:
        if "raw" in _norm(name):
            target_name = name
            break
    if target_name is None:
        # 생산량 헤더가 있는 첫 시트
        for name, df in sheets.items():
            if df.astype(str).apply(lambda col: col.str.contains("생산량", na=False)).any().any():
                target_name = name
                break
    if target_name is None:
        target_name = list(sheets.keys())[0]
    df = sheets[target_name]

    # 헤더행 탐색
    hdr = None
    for i in range(min(15, len(df))):
        joined = " ".join(str(x) for x in df.iloc[i].tolist())
        if "생산량" in joined or ("날짜" in joined and "품목" in joined):
            hdr = i
            break
    if hdr is None:
        return {"rows": [], "errors": [f"'{target_name}' 시트에서 헤더행(생산량/품목)을 찾지 못했습니다"]}
    cols = [str(x).strip() for x in df.iloc[hdr].tolist()]
    data = df.iloc[hdr + 1:].copy()
    data.columns = cols

    def find(*cands, exclude=()):
        for c in cols:
            cn = _norm(c)
            if any(ex in cn for ex in exclude):
                continue
            if any(_norm(cand) in cn for cand in cands):
                return c
        return None

    c_date = find("날짜", "일자", "date")
    c_worker = find("담당", "작업자", "생산자")
    c_loc = find("생산위치", "위치", "층")
    c_cat = find("품목류", "분류", "카테고리", exclude=("품목명", "품명"))
    c_prod = find("품목명", "제품명", "상품명", "품명")
    c_qty = find("생산량", "생산수량", exclude=("금액", "액"))
    c_hours = find("시간", "소요")
    c_uprice = find("단가", exclude=("원가",))
    c_amount = find("생산액", "생산금액", "생산 금액")
    c_labor = find("노무", "인건")
    c_ucost = find("원가", exclude=("총", "액"))
    c_tcost = find("원가총액", "총원가", "원가 총액") or find("총액")
    c_deduct = find("공제")
    c_grade = find("등급", "평가", "구분", "주간", "야간", "주야")  # 주간/야간 생산 구분

    import pandas as pd
    def num(v):
        if v is None or (isinstance(v, float) and pd.isna(v)):
            return 0.0
        try:
            return float(str(v).replace(",", "").replace("-", "0").strip() or 0)
        except Exception:
            return 0.0

    rows, errors = [], []
    if c_qty is None or (c_cat is None and c_prod is None) or c_date is None:
        return {"rows": [], "errors": ["필수 열(날짜·품목·생산량)을 찾지 못했습니다"], "sheet": target_name, "headers": cols}

    for _, r in data.iterrows():
        try:
            dval = r[c_date]
            if pd.isna(dval):
                continue
            d = pd.to_datetime(dval, errors="coerce")
            if pd.isna(d):
                continue
            qty = num(r[c_qty]) if c_qty else 0.0
            cat = str(r[c_cat]).strip() if c_cat is not None and not pd.isna(r[c_cat]) else ""
            pname = str(r[c_prod]).strip() if c_prod is not None and not pd.isna(r[c_prod]) else ""
            if not cat and not pname:
                continue
            if qty <= 0:
                continue
            up = num(r[c_uprice]) if c_uprice else 0.0
            uc = num(r[c_ucost]) if c_ucost else 0.0
            rows.append({
                "prod_date": d.date().isoformat(),
                "worker": str(r[c_worker]).strip() if c_worker is not None and not pd.isna(r[c_worker]) else "",
                "location": str(r[c_loc]).strip() if c_loc is not None and not pd.isna(r[c_loc]) else "",
                "category": cat, "product_name": pname, "qty": qty,
                "hours": num(r[c_hours]) if c_hours else 0.0,
                "unit_price": up,
                "prod_amount": num(r[c_amount]) if c_amount else round(qty * up, 2),
                "labor_cost": num(r[c_labor]) if c_labor else 0.0,
                "unit_cost": uc,
                "total_cost": num(r[c_tcost]) if c_tcost else round(qty * uc, 2),
                "grade": str(r[c_grade]).strip() if c_grade is not None and not pd.isna(r[c_grade]) else "",
            })
        except Exception as e:
            errors.append(str(e))
    return {"rows": rows, "errors": errors, "sheet": target_name}


def _prod_hash(r: dict) -> str:
    import hashlib
    key = "|".join(str(r.get(k, "")) for k in
                    ("prod_date", "category", "product_name", "qty", "worker", "unit_price"))
    return hashlib.sha256(key.encode("utf-8")).hexdigest()


def apply_production(db: Session, rows: list[dict], warehouse_id: int,
                     user: Optional[str] = None, batch_id: Optional[str] = None) -> dict:
    """생산 행을 inventory_production에 적재(dedup). 품목류/품목명→마스터 매핑."""
    cat_map, scm_map = _production_maps(db)
    id2name = {p.id: p.name for p in db.query(ProductMaster).all()}
    existing = {h for (h,) in db.query(InventoryProduction.dedup_hash).all()}
    applied = dup = 0
    unmatched: dict[str, float] = {}
    for r in rows:
        h = _prod_hash(r)
        if h in existing:
            dup += 1
            continue
        pid = _resolve_prod(cat_map, scm_map, r.get("category"), r.get("product_name"))
        # 매칭되면 품목류를 마스터 표준명으로 통일(하나의 표현). 미매칭이면 원본 유지.
        canon_cat = id2name.get(pid) if pid else (r.get("category") or None)
        if not pid:
            key = r.get("category") or r.get("product_name") or "?"
            unmatched[key] = unmatched.get(key, 0.0) + float(r.get("qty") or 0)
        hours = float(r.get("hours") or 0)
        db.add(InventoryProduction(
            batch_id=batch_id,
            prod_date=date.fromisoformat(r["prod_date"]),
            worker=r.get("worker") or None, location=r.get("location") or None,
            category=canon_cat, product_name=r.get("product_name") or None,
            qty=float(r.get("qty") or 0), hours=hours,
            unit_price=float(r.get("unit_price") or 0), prod_amount=float(r.get("prod_amount") or 0),
            labor_cost=_labor_cost(hours, r.get("grade")), unit_cost=float(r.get("unit_cost") or 0),
            total_cost=float(r.get("total_cost") or 0), grade=r.get("grade") or None,
            product_id=pid, warehouse_id=warehouse_id, dedup_hash=h, created_by=user,
        ))
        existing.add(h)
        applied += 1
    db.commit()
    unmatched_list = sorted(({"key": k, "qty": round(v, 1)} for k, v in unmatched.items()),
                            key=lambda x: -x["qty"])
    return {"applied": applied, "duplicate": dup, "unmatched_count": len(unmatched_list),
            "unmatched": unmatched_list}


def production_dashboard(db: Session, start: Optional[date] = None,
                         end: Optional[date] = None, location: Optional[str] = None) -> dict:
    """생산 대시보드: 총생산량·생산액·원가 + 일별/품목류별/담당자별/등급별/층별 집계.
    location 지정 시 해당 생산위치(층)만 필터."""
    q = db.query(InventoryProduction)
    if start:
        q = q.filter(InventoryProduction.prod_date >= start)
    if end:
        q = q.filter(InventoryProduction.prod_date <= end)
    if location:
        q = q.filter(InventoryProduction.location == location)
    recs = q.all()
    # 층×주야 평균 일 근무시간: (일자 집합, 총시간) → 평균 일 근무시간 = 총시간/작업일수
    loc_shift: dict[tuple, dict] = {}
    tot_qty = tot_amt = tot_cost = tot_hours = tot_labor = 0.0
    by_cat: dict[str, dict] = {}
    by_worker: dict[str, dict] = {}
    by_month: dict[str, dict] = {}
    by_grade: dict[str, float] = {}
    by_location: dict[str, dict] = {}
    for r in recs:
        labor = float(r.labor_cost or 0)  # 노무비 = 시급 15,000 × 시간
        tot_qty += r.qty or 0; tot_amt += r.prod_amount or 0
        tot_cost += r.total_cost or 0; tot_hours += r.hours or 0; tot_labor += labor
        c = r.category or "미분류"
        by_cat.setdefault(c, {"qty": 0.0, "amount": 0.0, "cost": 0.0, "labor": 0.0, "hours": 0.0})
        by_cat[c]["qty"] += r.qty or 0; by_cat[c]["amount"] += r.prod_amount or 0
        by_cat[c]["cost"] += r.total_cost or 0; by_cat[c]["labor"] += labor; by_cat[c]["hours"] += r.hours or 0
        w = r.worker or "미상"
        by_worker.setdefault(w, {"qty": 0.0, "amount": 0.0, "hours": 0.0, "labor": 0.0})
        by_worker[w]["qty"] += r.qty or 0; by_worker[w]["amount"] += r.prod_amount or 0
        by_worker[w]["hours"] += r.hours or 0; by_worker[w]["labor"] += labor
        mk = f"{r.prod_date.year}-{r.prod_date.month:02d}" if r.prod_date else "?"
        by_month.setdefault(mk, {"qty": 0.0, "amount": 0.0, "cost": 0.0, "labor": 0.0})
        by_month[mk]["qty"] += r.qty or 0; by_month[mk]["amount"] += r.prod_amount or 0
        by_month[mk]["cost"] += r.total_cost or 0; by_month[mk]["labor"] += labor
        g = r.grade or "미분류"
        by_grade[g] = by_grade.get(g, 0.0) + (r.qty or 0)
        loc = r.location or "미상"
        by_location.setdefault(loc, {"qty": 0.0, "hours": 0.0, "labor": 0.0})
        by_location[loc]["qty"] += r.qty or 0; by_location[loc]["hours"] += r.hours or 0; by_location[loc]["labor"] += labor
        # 층×주야: 작업일 집합·총시간 누적
        shift = "야간" if _is_night(r.grade) else "주간"
        ls = loc_shift.setdefault((loc, shift), {"hours": 0.0, "qty": 0.0, "labor": 0.0, "days": set()})
        ls["hours"] += r.hours or 0; ls["qty"] += r.qty or 0; ls["labor"] += labor
        if r.prod_date:
            ls["days"].add(r.prod_date)

    def _cat_row(k, v):
        return {"category": k, "qty": round(v["qty"]), "amount": round(v["amount"]),
                "cost": round(v["cost"]), "labor": round(v["labor"]), "hours": round(v["hours"], 1),
                "unit_labor": round(v["labor"] / v["qty"], 1) if v["qty"] else 0,  # 개당 노무비
                "hourly_qty": round(v["qty"] / v["hours"], 1) if v["hours"] else 0,  # 시간당 생산량
                "profitability": round(v["amount"] / v["labor"], 2) if v["labor"] else 0}  # 채산성=생산액/노무비

    return {
        "start": start.isoformat() if start else None,
        "end": end.isoformat() if end else None,
        "record_count": len(recs),
        "total_qty": round(tot_qty), "total_amount": round(tot_amt),
        "total_cost": round(tot_cost), "total_hours": round(tot_hours, 1),
        "total_labor": round(tot_labor), "hourly_wage": HOURLY_WAGE,
        "cost_ratio": round(tot_cost / tot_amt * 100, 1) if tot_amt else 0,
        "labor_ratio": round(tot_labor / tot_amt * 100, 1) if tot_amt else 0,
        "profitability": round(tot_amt / tot_labor, 2) if tot_labor else 0,  # 채산성=생산액/노무비
        "hourly_qty": round(tot_qty / tot_hours, 1) if tot_hours else 0,     # 총 시간당 생산량
        "by_category": [_cat_row(k, v) for k, v in sorted(by_cat.items(), key=lambda x: -x[1]["qty"])],
        "by_worker": [{"worker": k, "qty": round(v["qty"]), "amount": round(v["amount"]),
                       "hours": round(v["hours"], 1), "labor": round(v["labor"])}
                      for k, v in sorted(by_worker.items(), key=lambda x: -x[1]["qty"])],
        "by_month": [{"month": k, "qty": round(v["qty"]), "amount": round(v["amount"]),
                      "cost": round(v["cost"]), "labor": round(v["labor"])}
                     for k, v in sorted(by_month.items())],
        "by_grade": [{"grade": k, "qty": round(v)} for k, v in sorted(by_grade.items(), key=lambda x: -x[1])],
        "by_location": [{"location": k, "qty": round(v["qty"]), "hours": round(v["hours"], 1),
                         "labor": round(v["labor"]),
                         "hourly_qty": round(v["qty"] / v["hours"], 1) if v["hours"] else 0}
                        for k, v in sorted(by_location.items(), key=lambda x: -x[1]["qty"])],
        "by_location_shift": [{
            "location": loc, "shift": sh,
            "hours": round(v["hours"], 1), "qty": round(v["qty"]), "labor": round(v["labor"]),
            "days": len(v["days"]),
            "avg_daily_hours": round(v["hours"] / len(v["days"]), 1) if v["days"] else 0,
            "hourly_qty": round(v["qty"] / v["hours"], 1) if v["hours"] else 0,
        } for (loc, sh), v in sorted(loc_shift.items(), key=lambda x: (x[0][0], x[0][1]))],
        "locations": sorted(by_location.keys()),
    }


# ──────────────────────────────────────────────
# 생산 시계열 / 채산성 / 수동입력
# ──────────────────────────────────────────────

def _month_key(d) -> str:
    return f"{d.year}-{d.month:02d}"


def _month_list(start: date, end: date) -> list[str]:
    out, y, m = [], start.year, start.month
    while (y, m) <= (end.year, end.month):
        out.append(f"{y}-{m:02d}")
        m += 1
        if m > 12:
            m = 1; y += 1
    return out


def production_categories(db: Session) -> list[str]:
    rows = db.query(InventoryProduction.category).filter(InventoryProduction.category.isnot(None)).distinct().all()
    return sorted({r[0] for r in rows if r[0]})


def automap_scm_products(db: Session, overwrite: bool = False) -> dict:
    """scm_products(BOM) → csa_product_master 자동 연결(csa_product_id).
    품목류(product_category)/품목명을 표준명·별칭·부분일치로 매칭."""
    from app.db_models import ScmProduct
    cat_map, _scm = _production_maps(db)  # norm(csa name/alias) -> id
    csa = [(p.id, _norm(p.name)) for p in db.query(ProductMaster).all() if p.name]

    def resolve(cat, name):
        pid = cat_map.get(_norm(cat)) or cat_map.get(_norm(name))
        if pid:
            return pid
        nc = _norm(cat)
        best = None
        for cid, cn in csa:
            if cn and (cn in nc or nc in cn):
                # 가장 긴 매칭 우선(마카롱 vs 비건 마카롱 구분)
                if best is None or len(cn) > best[1]:
                    best = (cid, len(cn))
        return best[0] if best else None

    q = db.query(ScmProduct)
    if not overwrite:
        q = q.filter(ScmProduct.csa_product_id.is_(None))
    updated = 0
    unmatched: dict[str, int] = {}
    id2name = {p.id: p.name for p in db.query(ProductMaster).all()}
    samples: dict[str, str] = {}
    for s in q.all():
        pid = resolve(s.product_category or "", s.product_name or "")
        if pid:
            s.csa_product_id = pid
            updated += 1
            samples.setdefault(s.product_category or "", id2name.get(pid, ""))
        else:
            unmatched[s.product_category or "?"] = unmatched.get(s.product_category or "?", 0) + 1
    db.commit()
    return {"updated": updated,
            "matched_categories": samples,
            "unmatched": sorted(unmatched.items(), key=lambda x: -x[1])}


def mapping_overview(db: Session) -> dict:
    """품목류(csa_product_master) 중심 통합 매핑 관계 — 영업·생산·물류재고·BOM/세트 연결.
    한 품목이 각 시스템에서 어떻게 이어지는지 한눈에."""
    from app.db_models import ScmProduct, CsaChannelProduct
    prods: dict[int, dict] = {}
    for p in db.query(ProductMaster).filter(ProductMaster.is_active.is_(True)).all():
        prods[p.id] = {"id": p.id, "name": p.name, "category": p.category or "",
                       "code": p.code, "aliases": p.aliases or [],
                       "sales_channels": 0, "sales_qty": 0.0, "sales_amount": 0.0,
                       "prod_qty": 0.0, "stock": 0.0,
                       "bom_finished": 0, "bom_semi": 0, "bom_set": 0, "bom_items": []}

    # 영업: 판매 수량·금액
    for pid, q, amt in db.query(
        ChannelSalesDailyProduct.product_id,
        func.coalesce(func.sum(ChannelSalesDailyProduct.pcs_qty), 0.0),
        func.coalesce(func.sum(ChannelSalesDailyProduct.net_sales), 0.0),
    ).filter(ChannelSalesDailyProduct.product_id.isnot(None)).group_by(ChannelSalesDailyProduct.product_id).all():
        if pid in prods:
            prods[pid]["sales_qty"] = float(q or 0); prods[pid]["sales_amount"] = float(amt or 0)

    # 영업: 판매 채널 수
    try:
        for pid, cnt in db.query(CsaChannelProduct.product_id, func.count(CsaChannelProduct.id)).filter(
                CsaChannelProduct.is_active.is_(True)).group_by(CsaChannelProduct.product_id).all():
            if pid in prods:
                prods[pid]["sales_channels"] = int(cnt)
    except Exception:
        pass

    # 생산
    for pid, q in db.query(
        InventoryProduction.product_id, func.coalesce(func.sum(InventoryProduction.qty), 0.0),
    ).filter(InventoryProduction.product_id.isnot(None)).group_by(InventoryProduction.product_id).all():
        if pid in prods:
            prods[pid]["prod_qty"] = float(q or 0)

    # 물류 재고
    for (_w, pid), v in current_stock_map(db).items():
        if pid in prods:
            prods[pid]["stock"] += v

    # BOM: scm_products (csa_product_id 연결)
    for s in db.query(ScmProduct).filter(ScmProduct.csa_product_id.isnot(None)).all():
        p = prods.get(s.csa_product_id)
        if not p:
            continue
        it = s.item_type or ""
        if "완제품" in it:
            p["bom_finished"] += 1
        elif "반제품" in it:
            p["bom_semi"] += 1
        elif "세트" in it:
            p["bom_set"] += 1
        if len(p["bom_items"]) < 40:
            p["bom_items"].append({"name": s.product_name, "item_type": it, "code": s.product_code})

    rows = []
    for p in prods.values():
        p["sales_qty"] = round(p["sales_qty"]); p["sales_amount"] = round(p["sales_amount"])
        p["prod_qty"] = round(p["prod_qty"]); p["stock"] = round(p["stock"])
        p["bom_total"] = p["bom_finished"] + p["bom_semi"] + p["bom_set"]
        # 매핑 완성도: 영업/생산/BOM 세 축에 데이터 있으면 완결
        p["linked"] = {"sales": p["sales_channels"] > 0 or p["sales_qty"] != 0,
                       "production": p["prod_qty"] > 0, "bom": p["bom_total"] > 0}
        p["link_score"] = sum(p["linked"].values())
        rows.append(p)
    rows.sort(key=lambda r: (-r["sales_amount"], r["name"]))
    total = len(rows)
    return {
        "rows": rows, "count": total,
        "summary": {
            "sales_linked": sum(1 for r in rows if r["linked"]["sales"]),
            "production_linked": sum(1 for r in rows if r["linked"]["production"]),
            "bom_linked": sum(1 for r in rows if r["linked"]["bom"]),
            "fully_linked": sum(1 for r in rows if r["link_score"] == 3),
        },
    }


def product_cost_map(db: Session) -> dict:
    """csa_product_master(품목류) 기준 개당 원가·노무비 (생산이력 가중평균)."""
    rows = db.query(
        InventoryProduction.product_id,
        func.coalesce(func.sum(InventoryProduction.qty), 0.0),
        func.coalesce(func.sum(InventoryProduction.total_cost), 0.0),
        func.coalesce(func.sum(InventoryProduction.labor_cost), 0.0),
    ).filter(InventoryProduction.product_id.isnot(None)).group_by(InventoryProduction.product_id).all()
    out = {}
    for pid, q, tc, lc in rows:
        q = float(q or 0)
        if q <= 0:
            continue
        out[int(pid)] = {"unit_cost": round(float(tc or 0) / q, 1),
                         "unit_labor": round(float(lc or 0) / q, 1),
                         "qty": round(q)}
    return out


def production_catalog(db: Session, category: Optional[str] = None) -> list[dict]:
    """생산 이력의 품목명별 평균 생산단가·원가 (실적 입력 자동계산용)."""
    q = db.query(
        InventoryProduction.product_name, InventoryProduction.category,
        func.avg(InventoryProduction.unit_price), func.avg(InventoryProduction.unit_cost),
    ).filter(InventoryProduction.product_name.isnot(None), InventoryProduction.product_name != "")
    if category:
        q = q.filter(InventoryProduction.category == category)
    q = q.group_by(InventoryProduction.product_name, InventoryProduction.category)
    out = []
    for name, cat, up, uc in q.all():
        out.append({"product_name": name, "category": cat,
                    "unit_price": round(float(up or 0), 1), "unit_cost": round(float(uc or 0), 1)})
    out.sort(key=lambda x: (x["category"] or "", x["product_name"]))
    return out


def production_timeseries(db: Session, granularity: str = "month",
                          start: Optional[date] = None, end: Optional[date] = None,
                          category: Optional[str] = None, location: Optional[str] = None) -> dict:
    """일/월 생산 시계열 — 생산성(시간당생산량)·채산성(생산액/노무비)·주야 포함. 품목류·층 필터."""
    q = db.query(InventoryProduction)
    if start:
        q = q.filter(InventoryProduction.prod_date >= start)
    if end:
        q = q.filter(InventoryProduction.prod_date <= end)
    if category:
        q = q.filter(InventoryProduction.category == category)
    if location:
        q = q.filter(InventoryProduction.location == location)
    buckets: dict[str, dict] = {}
    for r in q.all():
        if granularity == "day":
            key = r.prod_date.isoformat()
        elif granularity == "week":
            iso = r.prod_date.isocalendar()
            key = f"{iso[0]}-W{iso[1]:02d}"
        else:
            key = _month_key(r.prod_date)
        b = buckets.setdefault(key, {"qty": 0.0, "hours": 0.0, "amount": 0.0, "cost": 0.0,
                                     "labor": 0.0, "day_qty": 0.0, "night_qty": 0.0})
        b["qty"] += r.qty or 0; b["hours"] += r.hours or 0; b["amount"] += r.prod_amount or 0
        b["cost"] += r.total_cost or 0; b["labor"] += r.labor_cost or 0
        if _is_night(r.grade):
            b["night_qty"] += r.qty or 0
        else:
            b["day_qty"] += r.qty or 0
    series = []
    for k in sorted(buckets):
        v = buckets[k]
        series.append({
            "period": k, "qty": round(v["qty"]), "hours": round(v["hours"], 1),
            "amount": round(v["amount"]), "cost": round(v["cost"]), "labor": round(v["labor"]),
            "hourly_qty": round(v["qty"] / v["hours"], 1) if v["hours"] else 0,          # 생산성(시간당생산량)
            "profitability": round(v["amount"] / v["labor"], 2) if v["labor"] else 0,    # 채산성=생산액/노무비
            "day_qty": round(v["day_qty"]), "night_qty": round(v["night_qty"]),
        })
    return {"granularity": granularity, "category": category, "series": series}


def add_production_record(db: Session, data: dict, warehouse_id: int,
                          user: Optional[str] = None) -> dict:
    """생산 실적 1건 수동 입력. 품목류→마스터 매핑 + dedup + 야간 노무비."""
    cat_map, scm_map = _production_maps(db)
    id2name = {p.id: p.name for p in db.query(ProductMaster).all()}
    r = {
        "prod_date": data["prod_date"], "worker": data.get("worker", ""),
        "location": data.get("location", ""), "category": data.get("category", ""),
        "product_name": data.get("product_name", ""), "qty": float(data.get("qty") or 0),
        "unit_price": float(data.get("unit_price") or 0),
    }
    h = _prod_hash(r)
    if db.query(InventoryProduction.id).filter(InventoryProduction.dedup_hash == h).first():
        return {"ok": False, "error": "duplicate", "msg": "동일 생산 기록이 이미 있습니다"}
    pid = _resolve_prod(cat_map, scm_map, r["category"], r["product_name"])
    canon = id2name.get(pid) if pid else (r["category"] or None)
    hours = float(data.get("hours") or 0)
    qty = r["qty"]; up = r["unit_price"]; uc = float(data.get("unit_cost") or 0)
    grade = data.get("grade") or "주간"
    rec = InventoryProduction(
        batch_id="manual", prod_date=date.fromisoformat(r["prod_date"]),
        worker=r["worker"] or None, location=r["location"] or None, category=canon,
        product_name=r["product_name"] or None, qty=qty, hours=hours,
        unit_price=up, prod_amount=round(qty * up, 2), labor_cost=_labor_cost(hours, grade),
        unit_cost=uc, total_cost=round(qty * uc, 2), grade=grade,
        product_id=pid, warehouse_id=warehouse_id, dedup_hash=h, created_by=user,
    )
    db.add(rec)
    db.commit()
    db.refresh(rec)
    return {"ok": True, "id": rec.id, "matched": pid is not None, "matched_name": canon}


def update_production_record(db: Session, rec_id: int, data: dict) -> dict:
    """생산 실적 수동입력 건 수정. 파생값(prod_amount·labor_cost·total_cost)·품목매핑·dedup_hash 재산출."""
    rec = db.query(InventoryProduction).filter(InventoryProduction.id == rec_id).first()
    if not rec:
        return {"ok": False, "msg": "대상 없음"}
    cat_map, scm_map = _production_maps(db)
    id2name = {p.id: p.name for p in db.query(ProductMaster).all()}

    def _pick(k, cur):
        v = data.get(k)
        return cur if v is None else v

    if data.get("prod_date"):
        rec.prod_date = date.fromisoformat(str(data["prod_date"])[:10])
    rec.worker = _pick("worker", rec.worker) or None
    rec.location = _pick("location", rec.location) or None
    rec.category = _pick("category", rec.category)
    rec.product_name = _pick("product_name", rec.product_name) or None
    rec.qty = float(_pick("qty", rec.qty) or 0)
    rec.hours = float(_pick("hours", rec.hours) or 0)
    rec.unit_price = float(_pick("unit_price", rec.unit_price) or 0)
    rec.unit_cost = float(_pick("unit_cost", rec.unit_cost) or 0)
    rec.grade = _pick("grade", rec.grade) or "주간"

    # 품목류/품목명 바뀌었을 수 있으니 매핑 재산출
    pid = _resolve_prod(cat_map, scm_map, rec.category or "", rec.product_name or "")
    canon = id2name.get(pid) if pid else (rec.category or None)
    rec.product_id = pid
    if pid:
        rec.category = canon
    rec.prod_amount = round(rec.qty * rec.unit_price, 2)
    rec.total_cost = round(rec.qty * rec.unit_cost, 2)
    rec.labor_cost = _labor_cost(rec.hours, rec.grade)
    rec.dedup_hash = _prod_hash({
        "prod_date": rec.prod_date.isoformat() if rec.prod_date else "",
        "category": rec.category or "", "product_name": rec.product_name or "",
        "qty": rec.qty, "worker": rec.worker or "", "unit_price": rec.unit_price,
    })
    db.commit()
    return {"ok": True, "id": rec.id, "matched": pid is not None, "matched_name": canon}


# ──────────────────────────────────────────────
# 재고 월별 흐름 / 히트맵
# ──────────────────────────────────────────────

def _prod_month_sums(db, start, end, warehouse_id=None, by_product=False):
    cols = [func.extract("year", InventoryProduction.prod_date),
            func.extract("month", InventoryProduction.prod_date)]
    if by_product:
        cols.insert(0, InventoryProduction.product_id)
    q = db.query(*cols, func.coalesce(func.sum(InventoryProduction.qty), 0.0)).filter(
        InventoryProduction.prod_date >= start, InventoryProduction.prod_date <= end,
        InventoryProduction.product_id.isnot(None))
    if warehouse_id is not None:
        q = q.filter(InventoryProduction.warehouse_id == warehouse_id)
    q = q.group_by(*cols)
    return q.all()


def _sales_month_sums(db, start, end, warehouse_id=None, by_product=False):
    cols = [ChannelSalesDailyProduct.year, ChannelSalesDailyProduct.month]
    if by_product:
        cols.insert(0, ChannelSalesDailyProduct.product_id)
    q = db.query(*cols, func.coalesce(func.sum(ChannelSalesDailyProduct.pcs_qty), 0.0)).join(
        InventoryChannelWarehouse,
        InventoryChannelWarehouse.channel_id == ChannelSalesDailyProduct.channel_id,
    ).filter(
        InventoryChannelWarehouse.is_active.is_(True),
        ChannelSalesDailyProduct.product_id.isnot(None),
        ChannelSalesDailyProduct.sale_date >= start,
        ChannelSalesDailyProduct.sale_date <= end,
    )
    if warehouse_id is not None:
        q = q.filter(InventoryChannelWarehouse.warehouse_id == warehouse_id)
    q = q.group_by(*cols)
    return q.all()


def _trunc_label(dt, gran: str) -> str:
    if gran == "day":
        return dt.strftime("%Y-%m-%d")
    if gran == "week":
        iso = dt.isocalendar()
        return f"{iso[0]}-W{iso[1]:02d}"
    return dt.strftime("%Y-%m")


def stock_trend(db: Session, start: date, end: date, warehouse_id: Optional[int] = None,
                granularity: str = "month") -> dict:
    """재고 흐름(일/주/월): 기초재고 + 기간별(생산입고·판매출고·순증감) → 기말 재고 누계."""
    from datetime import timedelta
    gran = granularity if granularity in ("day", "week", "month") else "month"
    before = start - timedelta(days=1)
    opening = sum(current_stock_map(db, as_of=before, warehouse_id=warehouse_id).values())

    pcol = func.date_trunc(gran, InventoryProduction.prod_date)
    pq = db.query(pcol, func.coalesce(func.sum(InventoryProduction.qty), 0.0)).filter(
        InventoryProduction.prod_date >= start, InventoryProduction.prod_date <= end,
        InventoryProduction.product_id.isnot(None))
    if warehouse_id is not None:
        pq = pq.filter(InventoryProduction.warehouse_id == warehouse_id)
    prod_b = {dt: float(s or 0) for dt, s in pq.group_by(pcol).all()}

    scol = func.date_trunc(gran, ChannelSalesDailyProduct.sale_date)
    sq = db.query(scol, func.coalesce(func.sum(ChannelSalesDailyProduct.pcs_qty), 0.0)).join(
        InventoryChannelWarehouse,
        InventoryChannelWarehouse.channel_id == ChannelSalesDailyProduct.channel_id,
    ).filter(
        InventoryChannelWarehouse.is_active.is_(True),
        ChannelSalesDailyProduct.product_id.isnot(None),
        ChannelSalesDailyProduct.sale_date >= start, ChannelSalesDailyProduct.sale_date <= end)
    if warehouse_id is not None:
        sq = sq.filter(InventoryChannelWarehouse.warehouse_id == warehouse_id)
    sales_b = {dt: float(s or 0) for dt, s in sq.group_by(scol).all()}

    keys = sorted(set(prod_b) | set(sales_b))
    running = opening
    series = []
    for dt in keys:
        inbound = prod_b.get(dt, 0.0)
        outbound = sales_b.get(dt, 0.0)
        net = inbound - outbound
        running += net
        series.append({
            "period": _trunc_label(dt, gran), "inbound": round(inbound),
            "outbound": round(outbound), "net": round(net), "closing": round(running),
        })
    return {"opening": round(opening), "warehouse_id": warehouse_id,
            "granularity": gran, "series": series}


def stock_heatmap(db: Session, start: date, end: date,
                  warehouse_id: Optional[int] = None, top_n: int = 20,
                  granularity: str = "month") -> dict:
    """품목 × 기간(일/주/월) 순증감(생산−판매) 히트맵. 활동량 상위 top_n 품목."""
    gran = granularity if granularity in ("day", "week", "month") else "month"
    products = load_products(db)

    pcol = func.date_trunc(gran, InventoryProduction.prod_date)
    pq = db.query(InventoryProduction.product_id, pcol,
                  func.coalesce(func.sum(InventoryProduction.qty), 0.0)).filter(
        InventoryProduction.prod_date >= start, InventoryProduction.prod_date <= end,
        InventoryProduction.product_id.isnot(None))
    if warehouse_id is not None:
        pq = pq.filter(InventoryProduction.warehouse_id == warehouse_id)
    prod, bucket_set = {}, set()
    for pid, dt, s in pq.group_by(InventoryProduction.product_id, pcol).all():
        lbl = _trunc_label(dt, gran)
        prod[(pid, lbl)] = float(s or 0); bucket_set.add(lbl)

    scol = func.date_trunc(gran, ChannelSalesDailyProduct.sale_date)
    sq = db.query(ChannelSalesDailyProduct.product_id, scol,
                  func.coalesce(func.sum(ChannelSalesDailyProduct.pcs_qty), 0.0)).join(
        InventoryChannelWarehouse,
        InventoryChannelWarehouse.channel_id == ChannelSalesDailyProduct.channel_id).filter(
        InventoryChannelWarehouse.is_active.is_(True),
        ChannelSalesDailyProduct.product_id.isnot(None),
        ChannelSalesDailyProduct.sale_date >= start, ChannelSalesDailyProduct.sale_date <= end)
    if warehouse_id is not None:
        sq = sq.filter(InventoryChannelWarehouse.warehouse_id == warehouse_id)
    sales = {}
    for pid, dt, s in sq.group_by(ChannelSalesDailyProduct.product_id, scol).all():
        lbl = _trunc_label(dt, gran)
        sales[(pid, lbl)] = float(s or 0); bucket_set.add(lbl)

    months = sorted(bucket_set)
    pids = {k[0] for k in prod} | {k[0] for k in sales}
    scored = []
    for pid in pids:
        cells = [round(prod.get((pid, mk), 0.0) - sales.get((pid, mk), 0.0)) for mk in months]
        activity = sum(abs(prod.get((pid, mk), 0.0)) + abs(sales.get((pid, mk), 0.0)) for mk in months)
        scored.append((activity, pid, cells))
    scored.sort(key=lambda x: -x[0])
    rows = []
    for _act, pid, cells in scored[:top_n]:
        p = products.get(pid, {})
        rows.append({"product_id": pid, "product_name": p.get("name", f"#{pid}"),
                     "category": p.get("category", ""), "cells": cells,
                     "total": sum(cells)})
    return {"months": months, "rows": rows, "warehouse_id": warehouse_id}


def _date_bucket(d: date, gran: str) -> str:
    if gran == "day":
        return d.isoformat()
    if gran == "week":
        iso = d.isocalendar()
        return f"{iso[0]}-W{iso[1]:02d}"
    return f"{d.year}-{d.month:02d}"


def labor_compare(db: Session, start: date, end: date, granularity: str = "day") -> dict:
    """생산실적 투여시간 vs mysixthproject 생산팀 근태 노무시간 — 일/주/월 대조.
    근태 = 생산팀만(정규직 생산부서 실근태 clock + 파견/알바 생산사업장, 물류·카페 제외)."""
    from app.services import mysixth_client
    gran = granularity if granularity in ("day", "week", "month") else "day"

    # 1) 생산일보 버킷 (투여시간·산출노무비)
    pcol = func.date_trunc(gran, InventoryProduction.prod_date)
    pq = db.query(pcol,
                  func.coalesce(func.sum(InventoryProduction.hours), 0.0),
                  func.coalesce(func.sum(InventoryProduction.labor_cost), 0.0)).filter(
        InventoryProduction.prod_date >= start, InventoryProduction.prod_date <= end
    ).group_by(pcol)
    prod_b = {_trunc_label(dt, gran): (float(h or 0), float(l or 0)) for dt, h, l in pq.all()}

    # 2) 근태 일별 → 버킷 (생산팀만)
    daily = mysixth_client.production_labor_daily(start.isoformat(), end.isoformat())
    att_b: dict[str, dict] = {}
    for dstr, v in daily.items():
        try:
            d = date.fromisoformat(dstr)
        except Exception:
            continue
        lbl = _date_bucket(d, gran)
        b = att_b.setdefault(lbl, {"regular": 0.0, "dispatch": 0.0})
        b["regular"] += v.get("regular", 0); b["dispatch"] += v.get("dispatch", 0)

    # 3) 노무비(월별) — 정규직 실지급 + 파견 환산
    pay_m = mysixth_client.production_pay_by_month(_month_list(start, end))
    tot_reg_pay = sum(pay_m.values())

    labels = sorted(set(prod_b) | set(att_b))
    series = []
    tot_ph = tot_ah = tot_pl = tot_reg = tot_disp = 0.0
    for lbl in labels:
        ph, pl = prod_b.get(lbl, (0.0, 0.0))
        a = att_b.get(lbl, {"regular": 0.0, "dispatch": 0.0})
        reg, disp = a["regular"], a["dispatch"]
        ah = reg + disp
        tot_ph += ph; tot_ah += ah; tot_pl += pl; tot_reg += reg; tot_disp += disp
        series.append({
            "period": lbl,
            "prod_hours": round(ph, 1), "att_hours": round(ah, 1),
            "regular_hours": round(reg, 1), "dispatch_hours": round(disp, 1),
            "hours_ratio": round(ph / ah, 2) if ah else 0,
            "prod_labor": round(pl),
        })
    tot_att_cost = round(tot_reg_pay + tot_disp * 15000)
    return {
        "start": start.isoformat(), "end": end.isoformat(), "granularity": gran, "series": series,
        "total_prod_hours": round(tot_ph, 1), "total_att_hours": round(tot_ah, 1),
        "total_regular_hours": round(tot_reg, 1), "total_dispatch_hours": round(tot_disp, 1),
        "total_hours_ratio": round(tot_ph / tot_ah, 2) if tot_ah else 0,
        "total_prod_labor": round(tot_pl), "total_att_cost": tot_att_cost,
        "total_regular_pay": round(tot_reg_pay),
        "note": "근태 노무시간 = 생산팀만(정규직 생산부서 실근태 clock in/out + 파견/알바 생산사업장). 물류·카페 제외. 노무비 = 정규직 실지급 + 파견/알바 환산(시간×15,000). 비율(생산일보÷근태) 1에 근접할수록 정합.",
    }


# ──────────────────────────────────────────────
# 대시보드 월별 매트릭스 (생산 / 재고 순증감)
# ──────────────────────────────────────────────

def _month_range_list(start: date, end: date) -> list[str]:
    out, y, m = [], start.year, start.month
    while (y, m) <= (end.year, end.month):
        out.append(f"{y}-{m:02d}")
        m += 1
        if m > 12:
            m = 1; y += 1
    return out


def production_monthly_matrix(db: Session, start: date, end: date,
                              location: Optional[str] = None) -> dict:
    """품목(품목명)×월 생산량 매트릭스 + 행/열 합계."""
    q = db.query(
        InventoryProduction.product_name, InventoryProduction.category,
        InventoryProduction.prod_date, InventoryProduction.qty,
    ).filter(InventoryProduction.prod_date >= start, InventoryProduction.prod_date <= end)
    if location:
        q = q.filter(InventoryProduction.location == location)
    months = _month_range_list(start, end)
    cell: dict = {}
    cat_of: dict = {}
    for name, cat, pd, qty in q.all():
        if not pd:
            continue
        nm = name or "(미지정)"
        cat_of.setdefault(nm, cat or "")
        mk = f"{pd.year}-{pd.month:02d}"
        cell.setdefault(nm, {}).setdefault(mk, 0.0)
        cell[nm][mk] += float(qty or 0)
    rows = []
    col_tot = {m: 0.0 for m in months}
    for nm in sorted(cell.keys(), key=lambda x: (cat_of.get(x, ""), x)):
        vals = [round(cell[nm].get(m, 0.0)) for m in months]
        tot = sum(vals)
        for i, m in enumerate(months):
            col_tot[m] += vals[i]
        rows.append({"name": nm, "category": cat_of.get(nm, ""), "values": vals, "total": tot})
    return {
        "start": start.isoformat(), "end": end.isoformat(), "location": location,
        "months": months, "rows": rows,
        "col_totals": [round(col_tot[m]) for m in months],
        "grand_total": round(sum(col_tot.values())),
    }


def _net_delta_range(db: Session, s: date, e: date, warehouse_id: Optional[int] = None) -> dict:
    """기간 [s,e] 품목별 재고 순증감 = 원장Δ(전체유형) + 생산입고 − 판매출고."""
    from sqlalchemy import and_
    lq = db.query(
        InventoryStockLedger.product_id,
        func.coalesce(func.sum(InventoryStockLedger.qty_delta), 0.0),
    ).filter(InventoryStockLedger.movement_date >= s, InventoryStockLedger.movement_date <= e)
    if warehouse_id is not None:
        lq = lq.filter(InventoryStockLedger.warehouse_id == warehouse_id)
    lq = lq.group_by(InventoryStockLedger.product_id)
    net: dict = {pid: float(v or 0) for pid, v in lq.all()}
    for (_w, pid), v in _production_sums(db, start=s, as_of=e, warehouse_id=warehouse_id).items():
        net[pid] = net.get(pid, 0.0) + v
    for (_w, pid), v in _sales_sums(db, start=s, as_of=e, warehouse_id=warehouse_id).items():
        net[pid] = net.get(pid, 0.0) - v
    return net


def stock_net_matrix(db: Session, start: date, end: date,
                     warehouse_id: Optional[int] = None) -> dict:
    """재고 순증감(+/-): ① 품목별 기간 누계  ② 품목×월 매트릭스."""
    products = load_products(db)
    months = _month_range_list(start, end)
    # 월별 net
    per_month: dict = {}  # pid -> {ym: delta}
    for ym in months:
        y, m = int(ym[:4]), int(ym[5:7])
        ms = date(y, m, 1)
        me = date(y + (m // 12), (m % 12) + 1, 1) - __import__("datetime").timedelta(days=1)
        me = min(me, end); ms = max(ms, start)
        for pid, v in _net_delta_range(db, ms, me, warehouse_id).items():
            per_month.setdefault(pid, {})[ym] = per_month.get(pid, {}).get(ym, 0.0) + v
    rows = []
    period_rows = []
    col_tot = {m: 0.0 for m in months}
    for pid, mv in per_month.items():
        prod = products.get(pid)
        if not prod:
            continue
        vals = [round(mv.get(m, 0.0), 1) for m in months]
        tot = round(sum(vals), 1)
        if abs(tot) < 1e-9 and not any(abs(v) > 1e-9 for v in vals):
            continue
        for i, m in enumerate(months):
            col_tot[m] += vals[i]
        rows.append({"product": prod["name"], "category": prod["category"],
                     "code": prod["code"], "values": vals, "total": tot})
        period_rows.append({"product": prod["name"], "category": prod["category"],
                            "code": prod["code"], "net": tot})
    rows.sort(key=lambda r: (r["category"], r["product"]))
    period_rows.sort(key=lambda r: r["net"])
    return {
        "start": start.isoformat(), "end": end.isoformat(), "warehouse_id": warehouse_id,
        "months": months,
        "period_rows": period_rows,   # 품목별 기간 순증감 누계
        "matrix_rows": rows,          # 품목×월 순증감
        "col_totals": [round(col_tot[m], 1) for m in months],
        "grand_total": round(sum(col_tot.values()), 1),
    }
