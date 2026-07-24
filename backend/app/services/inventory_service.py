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
    c_grade = find("등급", "평가")

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
    existing = {h for (h,) in db.query(InventoryProduction.dedup_hash).all()}
    applied = dup = 0
    unmatched: dict[str, float] = {}
    for r in rows:
        h = _prod_hash(r)
        if h in existing:
            dup += 1
            continue
        pid = _resolve_prod(cat_map, scm_map, r.get("category"), r.get("product_name"))
        if not pid:
            key = r.get("category") or r.get("product_name") or "?"
            unmatched[key] = unmatched.get(key, 0.0) + float(r.get("qty") or 0)
        db.add(InventoryProduction(
            batch_id=batch_id,
            prod_date=date.fromisoformat(r["prod_date"]),
            worker=r.get("worker") or None, location=r.get("location") or None,
            category=r.get("category") or None, product_name=r.get("product_name") or None,
            qty=float(r.get("qty") or 0), hours=float(r.get("hours") or 0),
            unit_price=float(r.get("unit_price") or 0), prod_amount=float(r.get("prod_amount") or 0),
            labor_cost=float(r.get("labor_cost") or 0), unit_cost=float(r.get("unit_cost") or 0),
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
                         end: Optional[date] = None) -> dict:
    """생산 대시보드: 총생산량·생산액·원가 + 일별/품목류별/담당자별/등급별 집계."""
    q = db.query(InventoryProduction)
    if start:
        q = q.filter(InventoryProduction.prod_date >= start)
    if end:
        q = q.filter(InventoryProduction.prod_date <= end)
    recs = q.all()
    tot_qty = tot_amt = tot_cost = tot_hours = 0.0
    by_cat: dict[str, dict] = {}
    by_worker: dict[str, dict] = {}
    by_month: dict[str, dict] = {}
    by_grade: dict[str, float] = {}
    for r in recs:
        tot_qty += r.qty or 0; tot_amt += r.prod_amount or 0
        tot_cost += r.total_cost or 0; tot_hours += r.hours or 0
        c = r.category or "미분류"
        by_cat.setdefault(c, {"qty": 0.0, "amount": 0.0, "cost": 0.0})
        by_cat[c]["qty"] += r.qty or 0; by_cat[c]["amount"] += r.prod_amount or 0; by_cat[c]["cost"] += r.total_cost or 0
        w = r.worker or "미상"
        by_worker.setdefault(w, {"qty": 0.0, "amount": 0.0, "hours": 0.0})
        by_worker[w]["qty"] += r.qty or 0; by_worker[w]["amount"] += r.prod_amount or 0; by_worker[w]["hours"] += r.hours or 0
        mk = f"{r.prod_date.year}-{r.prod_date.month:02d}" if r.prod_date else "?"
        by_month.setdefault(mk, {"qty": 0.0, "amount": 0.0, "cost": 0.0})
        by_month[mk]["qty"] += r.qty or 0; by_month[mk]["amount"] += r.prod_amount or 0; by_month[mk]["cost"] += r.total_cost or 0
        g = r.grade or "미분류"
        by_grade[g] = by_grade.get(g, 0.0) + (r.qty or 0)
    return {
        "start": start.isoformat() if start else None,
        "end": end.isoformat() if end else None,
        "record_count": len(recs),
        "total_qty": round(tot_qty), "total_amount": round(tot_amt),
        "total_cost": round(tot_cost), "total_hours": round(tot_hours, 1),
        "cost_ratio": round(tot_cost / tot_amt * 100, 1) if tot_amt else 0,
        "by_category": [{"category": k, **{kk: round(vv) for kk, vv in v.items()}}
                        for k, v in sorted(by_cat.items(), key=lambda x: -x[1]["qty"])],
        "by_worker": [{"worker": k, **{kk: round(vv) for kk, vv in v.items()}}
                      for k, v in sorted(by_worker.items(), key=lambda x: -x[1]["qty"])],
        "by_month": [{"month": k, **{kk: round(vv) for kk, vv in v.items()}}
                     for k, v in sorted(by_month.items())],
        "by_grade": [{"grade": k, "qty": round(v)} for k, v in sorted(by_grade.items(), key=lambda x: -x[1])],
    }
