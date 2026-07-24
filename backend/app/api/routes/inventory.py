"""재고 관리 API 라우트 — 매출→재고 1단계.

base path: /api/inventory (main.py에서 prefix="/api"로 등록)
"""
from __future__ import annotations

import io
import os
import tempfile
import logging
from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query, Body
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.routes.auth import get_current_user
from app.database import get_db
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
from app.services import inventory_service as inv

router = APIRouter(prefix="/inventory", tags=["inventory"])
logger = logging.getLogger(__name__)


def _parse_date(s: Optional[str]) -> Optional[date]:
    if not s:
        return None
    try:
        return date.fromisoformat(s.strip()[:10])
    except Exception:
        return None


# ──────────────────────────────────────────────
# 창고 마스터
# ──────────────────────────────────────────────

class WarehouseIn(BaseModel):
    id: Optional[int] = None
    code: Optional[str] = None
    name: str
    location: Optional[str] = None
    is_active: bool = True
    sort_order: int = 0
    notes: Optional[str] = None


@router.get("/warehouses")
def list_warehouses(only_active: bool = False, db: Session = Depends(get_db)):
    return {"warehouses": inv.load_warehouses(db, only_active=only_active)}


@router.post("/warehouses")
def upsert_warehouse(body: WarehouseIn, db: Session = Depends(get_db),
                     user: dict = Depends(get_current_user)):
    if body.id:
        w = db.get(InventoryWarehouse, body.id)
        if not w:
            raise HTTPException(404, "창고 없음")
    else:
        w = InventoryWarehouse()
        db.add(w)
    w.code = (body.code or "").strip() or None
    w.name = body.name.strip()
    w.location = body.location
    w.is_active = body.is_active
    w.sort_order = body.sort_order
    w.notes = body.notes
    try:
        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(400, f"저장 실패(중복 코드/이름 가능): {e}")
    db.refresh(w)
    return {"id": w.id, "name": w.name}


@router.delete("/warehouses/{wid}")
def delete_warehouse(wid: int, db: Session = Depends(get_db),
                     user: dict = Depends(get_current_user)):
    w = db.get(InventoryWarehouse, wid)
    if not w:
        raise HTTPException(404, "창고 없음")
    # 이 창고에 원장/매핑이 있으면 비활성화만
    has_ledger = db.query(InventoryStockLedger.id).filter(
        InventoryStockLedger.warehouse_id == wid).first()
    has_map = db.query(InventoryChannelWarehouse.id).filter(
        InventoryChannelWarehouse.warehouse_id == wid).first()
    if has_ledger or has_map:
        w.is_active = False
        db.commit()
        return {"deactivated": True, "reason": "원장/채널매핑 존재 → 비활성화 처리"}
    db.delete(w)
    db.commit()
    return {"deleted": True}


# ──────────────────────────────────────────────
# 채널 → 창고 매핑
# ──────────────────────────────────────────────

@router.get("/channels")
def list_channels(db: Session = Depends(get_db)):
    """판매 데이터에 존재하는 채널 + 현재 창고 매핑."""
    chans = db.query(
        ChannelSalesDailyProduct.channel_id,
        ChannelSalesDailyProduct.channel_name,
        ChannelSalesDailyProduct.channel_category,
    ).distinct().all()
    mapping = {m.channel_id: m for m in db.query(InventoryChannelWarehouse).all()}
    out = []
    for cid, cname, ccat in chans:
        m = mapping.get(cid)
        out.append({
            "channel_id": cid,
            "channel_name": cname,
            "category": ccat,
            "warehouse_id": m.warehouse_id if m else None,
            "is_active": m.is_active if m else None,
        })
    out.sort(key=lambda x: (x["warehouse_id"] is not None, x["channel_name"] or ""))
    unassigned = sum(1 for x in out if x["warehouse_id"] is None)
    return {"channels": out, "count": len(out), "unassigned": unassigned}


class ChannelWarehouseIn(BaseModel):
    channel_id: str
    channel_name: Optional[str] = None
    warehouse_id: int
    is_active: bool = True


@router.post("/channel-warehouse")
def assign_channel_warehouse(body: ChannelWarehouseIn, db: Session = Depends(get_db),
                             user: dict = Depends(get_current_user)):
    m = db.query(InventoryChannelWarehouse).filter(
        InventoryChannelWarehouse.channel_id == body.channel_id).first()
    if not m:
        m = InventoryChannelWarehouse(channel_id=body.channel_id)
        db.add(m)
    m.channel_name = body.channel_name
    m.warehouse_id = body.warehouse_id
    m.is_active = body.is_active
    db.commit()
    return {"ok": True, "channel_id": body.channel_id, "warehouse_id": body.warehouse_id}


@router.post("/channel-warehouse/bulk")
def assign_channel_warehouse_bulk(items: list[ChannelWarehouseIn] = Body(...),
                                  db: Session = Depends(get_db),
                                  user: dict = Depends(get_current_user)):
    existing = {m.channel_id: m for m in db.query(InventoryChannelWarehouse).all()}
    n = 0
    for it in items:
        m = existing.get(it.channel_id)
        if not m:
            m = InventoryChannelWarehouse(channel_id=it.channel_id)
            db.add(m)
            existing[it.channel_id] = m
        m.channel_name = it.channel_name
        m.warehouse_id = it.warehouse_id
        m.is_active = it.is_active
        n += 1
    db.commit()
    return {"ok": True, "updated": n}


@router.delete("/channel-warehouse/{channel_id}")
def unassign_channel_warehouse(channel_id: str, db: Session = Depends(get_db),
                               user: dict = Depends(get_current_user)):
    db.query(InventoryChannelWarehouse).filter(
        InventoryChannelWarehouse.channel_id == channel_id).delete()
    db.commit()
    return {"ok": True}


# ──────────────────────────────────────────────
# 안전재고
# ──────────────────────────────────────────────

@router.get("/categories")
def list_categories(db: Session = Depends(get_db)):
    cats = db.query(ProductMaster.category).filter(
        ProductMaster.category.isnot(None)).distinct().all()
    return {"categories": sorted({c[0] for c in cats if c[0]})}


@router.get("/products")
def list_products(db: Session = Depends(get_db)):
    prods = inv.load_products(db, only_active=True)
    return {"products": sorted(prods.values(), key=lambda p: (p["category"], p["name"]))}


@router.get("/safety-stock")
def list_safety_stock(db: Session = Depends(get_db)):
    products = inv.load_products(db)
    warehouses = {w["id"]: w["name"] for w in inv.load_warehouses(db)}
    rows = []
    for s in db.query(InventorySafetyStock).all():
        p = products.get(s.product_id, {})
        rows.append({
            "id": s.id,
            "warehouse_id": s.warehouse_id,
            "warehouse_name": warehouses.get(s.warehouse_id) if s.warehouse_id else "(전체 공통)",
            "product_id": s.product_id,
            "product_name": p.get("name"),
            "category": p.get("category"),
            "safety_stock": s.safety_stock,
            "reorder_point": s.reorder_point,
            "reorder_qty": s.reorder_qty,
            "target_stock": s.target_stock,
            "is_active": s.is_active,
        })
    rows.sort(key=lambda r: (r["category"] or "", r["product_name"] or ""))
    return {"rows": rows}


class SafetyStockIn(BaseModel):
    id: Optional[int] = None
    warehouse_id: Optional[int] = None
    product_id: int
    safety_stock: float = 0
    reorder_point: float = 0
    reorder_qty: float = 0
    target_stock: float = 0
    is_active: bool = True


@router.post("/safety-stock")
def upsert_safety_stock(body: SafetyStockIn, db: Session = Depends(get_db),
                        user: dict = Depends(get_current_user)):
    q = db.query(InventorySafetyStock).filter(
        InventorySafetyStock.product_id == body.product_id)
    if body.warehouse_id is None:
        q = q.filter(InventorySafetyStock.warehouse_id.is_(None))
    else:
        q = q.filter(InventorySafetyStock.warehouse_id == body.warehouse_id)
    s = q.first()
    if not s:
        s = InventorySafetyStock(product_id=body.product_id, warehouse_id=body.warehouse_id)
        db.add(s)
    s.safety_stock = body.safety_stock
    s.reorder_point = body.reorder_point
    s.reorder_qty = body.reorder_qty
    s.target_stock = body.target_stock
    s.is_active = body.is_active
    db.commit()
    db.refresh(s)
    return {"id": s.id}


@router.delete("/safety-stock/{sid}")
def delete_safety_stock(sid: int, db: Session = Depends(get_db),
                        user: dict = Depends(get_current_user)):
    db.query(InventorySafetyStock).filter(InventorySafetyStock.id == sid).delete()
    db.commit()
    return {"ok": True}


# ──────────────────────────────────────────────
# 기초재고 업로드 + 수동 이동
# ──────────────────────────────────────────────

@router.post("/opening/upload")
async def upload_opening(
    file: UploadFile = File(...),
    default_warehouse_id: int = Query(...),
    default_date: str = Query("2025-01-01"),
    dry_run: bool = Query(True),
    mode: str = Query("replace"),
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """기초재고 엑셀 업로드. dry_run=true면 파싱 미리보기, false면 원장 반영.
    default_date 기준일(기본 2025-01-01, 판매데이터 시작점)."""
    content = await file.read()
    suffix = os.path.splitext(file.filename or "")[1] or ".xlsx"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tf:
        tf.write(content)
        tmp_path = tf.name
    try:
        parsed = inv.parse_opening_excel(tmp_path)
    finally:
        try:
            os.unlink(tmp_path)
        except Exception:
            pass

    rows = parsed.get("rows", [])
    if parsed.get("errors"):
        return {"ok": False, "parse_errors": parsed["errors"], "rows": rows[:50], "row_count": len(rows)}

    ddate = _parse_date(default_date) or date(2025, 1, 1)
    if dry_run:
        # 매칭 미리보기 (실제 반영 X)
        products = db.query(ProductMaster).all()
        by_code = {(p.code or "").strip().lower(): p for p in products if p.code}
        by_name = {(p.name or "").strip().lower(): p for p in products if p.name}
        preview, unmatched = [], 0
        for r in rows:
            pcode = (r.get("product_code") or "").strip().lower()
            pname = (r.get("product_name") or "").strip().lower()
            match = by_code.get(pcode) or by_name.get(pname)
            if not match:
                unmatched += 1
            preview.append({**r, "matched": bool(match),
                            "matched_name": match.name if match else None})
        return {"ok": True, "dry_run": True, "row_count": len(rows),
                "unmatched": unmatched, "rows": preview[:200],
                "default_date": ddate.isoformat()}

    res = inv.apply_opening(db, rows, default_warehouse_id=default_warehouse_id,
                            default_date=ddate, user=user.get("email"), mode=mode)
    return {"ok": True, "dry_run": False, **res, "row_count": len(rows)}


class LedgerIn(BaseModel):
    warehouse_id: int
    product_id: int
    movement_date: str
    movement_type: str  # opening/production_in/adjustment/transfer_in/transfer_out
    qty_delta: float
    reason: Optional[str] = None


@router.post("/ledger")
def add_ledger(body: LedgerIn, db: Session = Depends(get_db),
               user: dict = Depends(get_current_user)):
    """수동 재고 이동(조정/생산입고/이동 등). adjustment/count_correction은 사유 필수."""
    if body.movement_type in ("adjustment", "count_correction") and not (body.reason or "").strip():
        raise HTTPException(400, "조정/보정은 사유(reason)가 필수입니다")
    mdate = _parse_date(body.movement_date) or date.today()
    db.add(InventoryStockLedger(
        warehouse_id=body.warehouse_id, product_id=body.product_id,
        movement_date=mdate, movement_type=body.movement_type,
        qty_delta=body.qty_delta, reason=body.reason,
        ref_type="manual", created_by=user.get("email"),
    ))
    db.commit()
    return {"ok": True}


@router.get("/ledger")
def list_ledger(
    warehouse_id: Optional[int] = None,
    product_id: Optional[int] = None,
    limit: int = 200,
    db: Session = Depends(get_db),
):
    q = db.query(InventoryStockLedger)
    if warehouse_id is not None:
        q = q.filter(InventoryStockLedger.warehouse_id == warehouse_id)
    if product_id is not None:
        q = q.filter(InventoryStockLedger.product_id == product_id)
    q = q.order_by(InventoryStockLedger.movement_date.desc(), InventoryStockLedger.id.desc()).limit(limit)
    products = inv.load_products(db)
    warehouses = {w["id"]: w["name"] for w in inv.load_warehouses(db)}
    rows = [{
        "id": l.id, "warehouse_id": l.warehouse_id,
        "warehouse_name": warehouses.get(l.warehouse_id),
        "product_id": l.product_id,
        "product_name": products.get(l.product_id, {}).get("name"),
        "movement_date": l.movement_date.isoformat() if l.movement_date else None,
        "movement_type": l.movement_type, "qty_delta": l.qty_delta,
        "reason": l.reason, "created_by": l.created_by,
    } for l in q.all()]
    return {"rows": rows}


# ──────────────────────────────────────────────
# 재고 현황 / 흐름 / 보충 / 대시보드
# ──────────────────────────────────────────────

@router.get("/stock")
def get_stock(as_of: Optional[str] = None, warehouse_id: Optional[int] = None,
              category: Optional[str] = None, db: Session = Depends(get_db)):
    return inv.stock_rows(db, as_of=_parse_date(as_of), warehouse_id=warehouse_id,
                          category=category)


@router.get("/flows")
def get_flows(start: str, end: str, warehouse_id: Optional[int] = None,
              category: Optional[str] = None, db: Session = Depends(get_db)):
    s = _parse_date(start)
    e = _parse_date(end)
    if not s or not e:
        raise HTTPException(400, "start/end 날짜 형식 오류")
    return inv.period_flows(db, start=s, end=e, warehouse_id=warehouse_id, category=category)


@router.get("/replenishment")
def get_replenishment(warehouse_id: Optional[int] = None, db: Session = Depends(get_db)):
    return inv.replenishment(db, warehouse_id=warehouse_id)


@router.get("/dashboard")
def get_dashboard(as_of: Optional[str] = None, db: Session = Depends(get_db)):
    return inv.dashboard(db, as_of=_parse_date(as_of))


@router.get("/report.xlsx")
def report_xlsx(as_of: Optional[str] = None, warehouse_id: Optional[int] = None,
                category: Optional[str] = None, db: Session = Depends(get_db)):
    """재고 현황 리포트 엑셀."""
    import pandas as pd
    data = inv.stock_rows(db, as_of=_parse_date(as_of), warehouse_id=warehouse_id,
                          category=category)
    df = pd.DataFrame(data["rows"])
    if not df.empty:
        df = df[["product_code", "product_name", "category", "warehouse_name",
                 "qty", "safety_stock", "reorder_point", "status"]]
        df.columns = ["품목코드", "품목명", "카테고리", "창고", "현재고",
                      "안전재고", "재주문점", "상태"]
    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as w:
        (df if not df.empty else pd.DataFrame({"안내": ["데이터 없음"]})).to_excel(
            w, index=False, sheet_name="재고현황")
    buf.seek(0)
    fname = f"inventory_{data['as_of']}.xlsx"
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={fname}"},
    )


# ──────────────────────────────────────────────
# 재고 실사 세션
# ──────────────────────────────────────────────

@router.get("/count-sessions")
def list_count_sessions(db: Session = Depends(get_db)):
    warehouses = {w["id"]: w["name"] for w in inv.load_warehouses(db)}
    rows = []
    for s in db.query(InventoryCountSession).order_by(
            InventoryCountSession.count_date.desc(), InventoryCountSession.id.desc()).all():
        rows.append({
            "id": s.id, "warehouse_id": s.warehouse_id,
            "warehouse_name": warehouses.get(s.warehouse_id),
            "count_date": s.count_date.isoformat() if s.count_date else None,
            "period_type": s.period_type, "status": s.status,
            "title": s.title, "confirmed_at": s.confirmed_at.isoformat() if s.confirmed_at else None,
            "confirmed_by": s.confirmed_by,
        })
    return {"rows": rows}


class CountSessionIn(BaseModel):
    warehouse_id: int
    count_date: str
    period_type: str = "monthly"
    title: Optional[str] = None


@router.post("/count-sessions")
def create_count_session(body: CountSessionIn, db: Session = Depends(get_db),
                         user: dict = Depends(get_current_user)):
    cd = _parse_date(body.count_date) or date.today()
    s = InventoryCountSession(
        warehouse_id=body.warehouse_id, count_date=cd,
        period_type=body.period_type, title=body.title,
        status="draft", created_by=user.get("email"),
    )
    db.add(s)
    db.commit()
    db.refresh(s)
    # 스냅샷 라인 생성
    inv.count_session_snapshot(db, s.id)
    return {"id": s.id}


@router.get("/count-sessions/{sid}")
def get_count_session(sid: int, db: Session = Depends(get_db)):
    s = db.get(InventoryCountSession, sid)
    if not s:
        raise HTTPException(404, "세션 없음")
    warehouses = {w["id"]: w["name"] for w in inv.load_warehouses(db)}
    try:
        lines = inv.count_session_snapshot(db, sid)
    except ValueError as e:
        raise HTTPException(404, str(e))
    return {
        "session": {
            "id": s.id, "warehouse_id": s.warehouse_id,
            "warehouse_name": warehouses.get(s.warehouse_id),
            "count_date": s.count_date.isoformat() if s.count_date else None,
            "period_type": s.period_type, "status": s.status, "title": s.title,
        },
        "lines": lines,
    }


class CountLineIn(BaseModel):
    product_id: int
    counted_qty: Optional[float] = None
    reason: Optional[str] = None


@router.post("/count-sessions/{sid}/lines")
def save_count_lines(sid: int, items: list[CountLineIn] = Body(...),
                     db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    s = db.get(InventoryCountSession, sid)
    if not s:
        raise HTTPException(404, "세션 없음")
    if s.status == "confirmed":
        raise HTTPException(400, "확정된 세션은 수정 불가")
    existing = {l.product_id: l for l in db.query(InventoryCountLine).filter(
        InventoryCountLine.session_id == sid).all()}
    for it in items:
        l = existing.get(it.product_id)
        if not l:
            l = InventoryCountLine(session_id=sid, product_id=it.product_id, system_qty=0)
            db.add(l)
            existing[it.product_id] = l
        l.counted_qty = it.counted_qty
        l.reason = it.reason
        if it.counted_qty is not None:
            l.diff = round(float(it.counted_qty) - float(l.system_qty or 0), 2)
    db.commit()
    return {"ok": True, "saved": len(items)}


@router.post("/count-sessions/{sid}/confirm")
def confirm_count(sid: int, db: Session = Depends(get_db),
                  user: dict = Depends(get_current_user)):
    try:
        res = inv.confirm_count_session(db, sid, user=user.get("email"))
    except ValueError as e:
        raise HTTPException(400, str(e))
    if not res.get("ok"):
        raise HTTPException(400, detail=res)
    return res


@router.delete("/count-sessions/{sid}")
def delete_count_session(sid: int, db: Session = Depends(get_db),
                         user: dict = Depends(get_current_user)):
    s = db.get(InventoryCountSession, sid)
    if not s:
        raise HTTPException(404, "세션 없음")
    if s.status == "confirmed":
        raise HTTPException(400, "확정된 세션은 삭제 불가(보정 이동이 원장에 반영됨)")
    db.query(InventoryCountLine).filter(InventoryCountLine.session_id == sid).delete()
    db.delete(s)
    db.commit()
    return {"ok": True}


# ──────────────────────────────────────────────
# 생산 실적 (RAW-DATA 엑셀 → 재고 보충)
# ──────────────────────────────────────────────

@router.post("/production/upload")
async def upload_production(
    file: UploadFile = File(...),
    warehouse_id: int = Query(..., description="생산 입고 창고(재고 보충 대상)"),
    dry_run: bool = Query(True),
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """생산 RAW-DATA 엑셀 업로드. dry_run=true면 파싱·매칭 미리보기, false면 적재+재고 보충."""
    content = await file.read()
    suffix = os.path.splitext(file.filename or "")[1] or ".xlsx"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tf:
        tf.write(content)
        tmp_path = tf.name
    try:
        parsed = inv.parse_production_excel(tmp_path)
    finally:
        try:
            os.unlink(tmp_path)
        except Exception:
            pass

    rows = parsed.get("rows", [])
    if parsed.get("errors") and not rows:
        return {"ok": False, "parse_errors": parsed["errors"],
                "headers": parsed.get("headers"), "sheet": parsed.get("sheet")}

    if dry_run:
        cat_map, scm_map = inv._production_maps(db)
        matched = unmatched = 0
        unmatched_keys: dict[str, float] = {}
        for r in rows:
            pid = inv._resolve_prod(cat_map, scm_map, r.get("category"), r.get("product_name"))
            if pid:
                matched += 1
            else:
                unmatched += 1
                k = r.get("category") or r.get("product_name") or "?"
                unmatched_keys[k] = unmatched_keys.get(k, 0.0) + float(r.get("qty") or 0)
        return {
            "ok": True, "dry_run": True, "sheet": parsed.get("sheet"),
            "row_count": len(rows), "matched": matched, "unmatched": unmatched,
            "unmatched_keys": sorted(({"key": k, "qty": round(v)} for k, v in unmatched_keys.items()),
                                     key=lambda x: -x["qty"]),
            "rows": rows[:100],
        }

    batch_id = uuid.uuid4().hex
    res = inv.apply_production(db, rows, warehouse_id=warehouse_id,
                              user=user.get("email"), batch_id=batch_id)
    return {"ok": True, "dry_run": False, "batch_id": batch_id, "row_count": len(rows), **res}


@router.get("/production")
def list_production(
    start: Optional[str] = None, end: Optional[str] = None,
    category: Optional[str] = None, worker: Optional[str] = None,
    limit: int = 300, db: Session = Depends(get_db),
):
    q = db.query(InventoryProduction)
    s, e = _parse_date(start), _parse_date(end)
    if s:
        q = q.filter(InventoryProduction.prod_date >= s)
    if e:
        q = q.filter(InventoryProduction.prod_date <= e)
    if category:
        q = q.filter(InventoryProduction.category == category)
    if worker:
        q = q.filter(InventoryProduction.worker == worker)
    total = q.count()
    q = q.order_by(InventoryProduction.prod_date.desc(), InventoryProduction.id.desc()).limit(limit)
    products = inv.load_products(db)
    rows = [{
        "id": r.id, "prod_date": r.prod_date.isoformat() if r.prod_date else None,
        "worker": r.worker, "location": r.location, "category": r.category,
        "product_name": r.product_name, "qty": r.qty, "hours": r.hours,
        "unit_price": r.unit_price, "prod_amount": r.prod_amount,
        "unit_cost": r.unit_cost, "total_cost": r.total_cost, "grade": r.grade,
        "matched": r.product_id is not None,
        "matched_name": products.get(r.product_id, {}).get("name") if r.product_id else None,
        "batch_id": r.batch_id,
    } for r in q.all()]
    return {"rows": rows, "total": total, "shown": len(rows)}


@router.get("/production/dashboard")
def production_dashboard(start: Optional[str] = None, end: Optional[str] = None,
                         db: Session = Depends(get_db)):
    return inv.production_dashboard(db, start=_parse_date(start), end=_parse_date(end))


@router.delete("/production/batch/{batch_id}")
def delete_production_batch(batch_id: str, db: Session = Depends(get_db),
                            user: dict = Depends(get_current_user)):
    n = db.query(InventoryProduction).filter(InventoryProduction.batch_id == batch_id).delete()
    db.commit()
    return {"ok": True, "deleted": n}


@router.get("/production/batches")
def list_production_batches(db: Session = Depends(get_db)):
    from sqlalchemy import func as _f
    rows = db.query(
        InventoryProduction.batch_id,
        _f.count(InventoryProduction.id),
        _f.sum(InventoryProduction.qty),
        _f.min(InventoryProduction.prod_date),
        _f.max(InventoryProduction.prod_date),
        _f.min(InventoryProduction.created_at),
    ).filter(InventoryProduction.batch_id.isnot(None)).group_by(InventoryProduction.batch_id).all()
    out = [{
        "batch_id": b, "count": c, "qty": round(float(q or 0)),
        "period": f"{d1}~{d2}", "uploaded_at": ca.isoformat() if ca else None,
    } for b, c, q, d1, d2, ca in rows]
    out.sort(key=lambda x: x["uploaded_at"] or "", reverse=True)
    return {"batches": out}
