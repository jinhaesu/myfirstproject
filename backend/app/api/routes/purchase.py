"""구매 관리 API — 거래처·발주·원부재료 소요·대시보드."""
from __future__ import annotations

from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Body
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.routes.auth import get_current_user
from app.database import get_db
from app.db_models import PurchaseVendor, PurchaseOrder, PurchaseOrderLine
from app.services import purchase_service as pur

router = APIRouter(prefix="/purchase", tags=["purchase"])


def _pd(s: Optional[str]) -> Optional[date]:
    if not s:
        return None
    try:
        return date.fromisoformat(s.strip()[:10])
    except Exception:
        return None


# ── 거래처 ──
@router.get("/vendors")
def vendors(db: Session = Depends(get_db)):
    return {"vendors": pur.vendor_list(db)}


@router.post("/vendors/seed")
def seed_vendors(db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    return pur.seed_vendors(db)


class VendorIn(BaseModel):
    id: Optional[int] = None
    name: str
    biz_no: Optional[str] = None
    contact: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    category: Optional[str] = None
    lead_time_days: int = 0
    is_active: bool = True
    notes: Optional[str] = None


@router.post("/vendors")
def upsert_vendor(body: VendorIn, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    if body.id:
        v = db.get(PurchaseVendor, body.id)
        if not v:
            raise HTTPException(404, "거래처 없음")
    else:
        v = PurchaseVendor()
        db.add(v)
    v.name = body.name.strip(); v.biz_no = body.biz_no; v.contact = body.contact
    v.phone = body.phone; v.email = body.email; v.category = body.category
    v.lead_time_days = body.lead_time_days; v.is_active = body.is_active; v.notes = body.notes
    try:
        db.commit()
    except Exception as e:
        db.rollback(); raise HTTPException(400, f"저장 실패(중복명?): {e}")
    db.refresh(v)
    return {"id": v.id}


@router.delete("/vendors/{vid}")
def delete_vendor(vid: int, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    db.query(PurchaseVendor).filter(PurchaseVendor.id == vid).delete()
    db.commit()
    return {"ok": True}


# ── 원부재료 소요 (생산 → BOM) ──
@router.get("/material-requirement")
def material_requirement(start: str, end: str, db: Session = Depends(get_db)):
    s, e = _pd(start), _pd(end)
    if not s or not e:
        raise HTTPException(400, "start/end 형식 오류")
    try:
        return pur.material_requirement(db, s, e)
    except Exception as ex:
        return {"error": str(ex)[:200], "materials": []}


# ── 발주 ──
@router.get("/orders")
def orders(start: Optional[str] = None, end: Optional[str] = None, status: Optional[str] = None,
           vendor_id: Optional[int] = None, db: Session = Depends(get_db)):
    return {"orders": pur.list_po(db, start=_pd(start), end=_pd(end), status=status, vendor_id=vendor_id)}


class POLineIn(BaseModel):
    material_type: Optional[str] = None
    material_id: Optional[int] = None
    material_name: Optional[str] = None
    erp_code: Optional[str] = None
    qty: float = 0
    unit: Optional[str] = None
    unit_price: float = 0


class POIn(BaseModel):
    po_no: Optional[str] = None
    vendor_id: Optional[int] = None
    vendor_name: Optional[str] = None
    order_date: str
    expected_date: Optional[str] = None
    status: str = "발주"
    notes: Optional[str] = None
    lines: list[POLineIn] = []


@router.post("/orders")
def create_order(body: POIn, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    return pur.create_po(db, body.model_dump(), user=user.get("email"))


@router.patch("/orders/{pid}/status")
def update_status(pid: int, status: str = Query(...), db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    po = db.get(PurchaseOrder, pid)
    if not po:
        raise HTTPException(404, "발주 없음")
    po.status = status
    db.commit()
    return {"ok": True}


@router.delete("/orders/{pid}")
def delete_order(pid: int, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    db.query(PurchaseOrderLine).filter(PurchaseOrderLine.po_id == pid).delete()
    db.query(PurchaseOrder).filter(PurchaseOrder.id == pid).delete()
    db.commit()
    return {"ok": True}


@router.get("/dashboard")
def dashboard(start: str, end: str, db: Session = Depends(get_db)):
    s, e = _pd(start), _pd(end)
    if not s or not e:
        raise HTTPException(400, "start/end 형식 오류")
    return pur.purchase_dashboard(db, s, e)
