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


# ── 구매 실적(구매일보) ──
class RecordsIn(BaseModel):
    rows: list[dict]


@router.post("/records/ingest")
def ingest_records(body: RecordsIn, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    return pur.ingest_records(db, body.rows)


class ManualRecordIn(BaseModel):
    pdate: str
    seq: int = 0
    warehouse: Optional[str] = None
    vendor: Optional[str] = None
    mclass: Optional[str] = None
    staff: Optional[str] = None
    item_code: Optional[str] = None
    item_name: Optional[str] = None
    unit: Optional[str] = "ea"
    qty: float = 0
    unit_price: float = 0
    supply: Optional[float] = None
    vat: Optional[float] = None
    total: Optional[float] = None
    note: Optional[str] = None


@router.post("/records/manual")
def add_manual_record(body: ManualRecordIn, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    res = pur.add_manual_record(db, body.model_dump(), user=user.get("email"))
    if not res.get("ok"):
        raise HTTPException(400, res.get("msg") or "실패")
    return res


@router.get("/records/manual-recent")
def manual_recent(limit: int = 30, db: Session = Depends(get_db)):
    return pur.manual_recent(db, limit=limit)


class RecordPatchIn(BaseModel):
    qty: Optional[float] = None
    unit_price: Optional[float] = None
    supply: Optional[float] = None
    vat: Optional[float] = None
    total: Optional[float] = None
    unit: Optional[str] = None
    vendor: Optional[str] = None
    mclass: Optional[str] = None
    staff: Optional[str] = None
    item_code: Optional[str] = None
    item_name: Optional[str] = None
    warehouse: Optional[str] = None
    note: Optional[str] = None
    pdate: Optional[str] = None
    seq: Optional[int] = None
    recompute: bool = True


@router.patch("/records/{rec_id}")
def update_record(rec_id: int, body: RecordPatchIn, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    # None(미지정) 필드는 제외 — 그래야 update_record의 재계산 판정("supply" 미지정 등)이 올바르게 동작.
    fields = {k: v for k, v in body.model_dump(exclude_none=True).items() if k != "recompute"}
    res = pur.update_record(db, rec_id, fields, recompute=body.recompute)
    if not res.get("ok"):
        raise HTTPException(404, res.get("msg") or "실패")
    return res


class NormalizeUnitIn(BaseModel):
    item_code: str
    box_kg: float
    threshold: float = 15000
    dry_run: bool = True


@router.post("/records/normalize-unit")
def normalize_unit(body: NormalizeUnitIn, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    """kg당 단가(초기 입력분)를 박스당 단가로 정규화 (단위기준 혼재 교정)."""
    return pur.normalize_unit_basis(db, body.item_code, body.box_kg,
                                    threshold=body.threshold, dry_run=body.dry_run)


@router.delete("/records/{rec_id}")
def delete_record(rec_id: int, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    return pur.delete_record(db, rec_id)


@router.delete("/records")
def purge_records(db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    return pur.purge_records(db)


@router.get("/records")
def list_records(start: Optional[str] = None, end: Optional[str] = None,
                 vendor: Optional[str] = None, mclass: Optional[str] = None,
                 item_code: Optional[str] = None, q: Optional[str] = None,
                 limit: int = 500, offset: int = 0, db: Session = Depends(get_db)):
    return pur.records_list(db, start=_pd(start), end=_pd(end), vendor=vendor,
                            mclass=mclass, item_code=item_code, q=q, limit=limit, offset=offset)


@router.get("/records/dashboard")
def records_dashboard(start: str, end: str, vendor: Optional[str] = None,
                      mclass: Optional[str] = None, q: Optional[str] = None,
                      db: Session = Depends(get_db)):
    s, e = _pd(start), _pd(end)
    if not s or not e:
        raise HTTPException(400, "start/end 형식 오류")
    return pur.records_dashboard(db, s, e, vendor=vendor, mclass=mclass, q=q)


@router.get("/records/gap-trend")
def gap_trend(start: str, end: str, granularity: str = "month", db: Session = Depends(get_db)):
    """월별 BOM이론소요 vs 실제구매 · 매출원가추정 vs 실제구매 추이."""
    s, e = _pd(start), _pd(end)
    if not s or not e:
        raise HTTPException(400, "start/end 형식 오류")
    from app.services import management_service as mgmt
    return mgmt.trend(db, s, e, granularity=granularity)


@router.get("/records/req-vs-actual")
def req_vs_actual(start: str, end: str, top: int = 40, db: Session = Depends(get_db)):
    s, e = _pd(start), _pd(end)
    if not s or not e:
        raise HTTPException(400, "start/end 형식 오류")
    return pur.req_vs_actual(db, s, e, top=top)


@router.get("/records/sales-ratio")
def sales_ratio(start: str, end: str, granularity: str = "day", db: Session = Depends(get_db)):
    s, e = _pd(start), _pd(end)
    if not s or not e:
        raise HTTPException(400, "start/end 형식 오류")
    return pur.sales_vs_purchase(db, s, e, granularity=granularity)


@router.get("/records/vendor-history")
def vendor_history(vendor: str, start: Optional[str] = None, end: Optional[str] = None, db: Session = Depends(get_db)):
    return pur.vendor_history(db, vendor, start=_pd(start), end=_pd(end))


@router.get("/records/item-history")
def item_history(item_code: Optional[str] = None, item_name: Optional[str] = None,
                 start: Optional[str] = None, end: Optional[str] = None, db: Session = Depends(get_db)):
    return pur.item_history(db, item_code=item_code, item_name=item_name, start=_pd(start), end=_pd(end))


@router.get("/records/price-tracker")
def price_tracker(start: str, end: str, mclass: Optional[str] = None,
                  vendor: Optional[str] = None, q: Optional[str] = None,
                  min_lines: int = Query(1, ge=1), sort: str = "abs_change",
                  db: Session = Depends(get_db)):
    """품목별 매입 단가 변동 개요 — 기간 내 최초/최근/최저/최고 단가 + 변동률."""
    s, e = _pd(start), _pd(end)
    if not s or not e:
        raise HTTPException(400, "start/end 날짜가 필요합니다.")
    return pur.price_tracker(db, s, e, mclass=mclass, vendor=vendor, q=q,
                             min_lines=min_lines, sort=sort)


# ── 발주서 이메일 발행 ──
@router.post("/orders/{pid}/issue")
def issue_order(pid: int, to: Optional[str] = Query(None), db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    po = db.get(PurchaseOrder, pid)
    if not po:
        raise HTTPException(404, "발주 없음")
    lines = db.query(PurchaseOrderLine).filter(PurchaseOrderLine.po_id == pid).all()
    # 수신 이메일: 인자 > 거래처 이메일
    recipient = to
    if not recipient and po.vendor_id:
        v = db.get(PurchaseVendor, po.vendor_id)
        recipient = v.email if v else None
    if not recipient:
        raise HTTPException(400, "수신 이메일이 없습니다(거래처 이메일 등록 또는 to 지정).")

    try:
        from app.config import get_settings
        import resend
        settings = get_settings()
        if not settings.RESEND_API_KEY:
            raise HTTPException(500, "RESEND_API_KEY 미설정")
        resend.api_key = settings.RESEND_API_KEY
        rows_html = "".join(
            f"<tr><td style='padding:6px 10px;border:1px solid #ddd'>{l.material_name or ''}</td>"
            f"<td style='padding:6px 10px;border:1px solid #ddd'>{l.erp_code or ''}</td>"
            f"<td style='padding:6px 10px;border:1px solid #ddd;text-align:right'>{(l.qty or 0):,.0f} {l.unit or ''}</td>"
            f"<td style='padding:6px 10px;border:1px solid #ddd;text-align:right'>{(l.unit_price or 0):,.0f}</td>"
            f"<td style='padding:6px 10px;border:1px solid #ddd;text-align:right'>{(l.amount or 0):,.0f}</td></tr>"
            for l in lines
        )
        html = f"""
        <div style='font-family:sans-serif;max-width:640px'>
          <h2>발주서 (Purchase Order)</h2>
          <p>거래처: <b>{po.vendor_name or ''}</b><br/>
             발주일: {po.order_date.isoformat() if po.order_date else ''}<br/>
             입고예정: {po.expected_date.isoformat() if po.expected_date else '-'}<br/>
             발주번호: {po.po_no or f'PO-{po.id}'}</p>
          <table style='border-collapse:collapse;width:100%;font-size:14px'>
            <thead><tr style='background:#f4f4f5'>
              <th style='padding:6px 10px;border:1px solid #ddd;text-align:left'>품목</th>
              <th style='padding:6px 10px;border:1px solid #ddd'>코드</th>
              <th style='padding:6px 10px;border:1px solid #ddd'>수량</th>
              <th style='padding:6px 10px;border:1px solid #ddd'>단가</th>
              <th style='padding:6px 10px;border:1px solid #ddd'>금액</th>
            </tr></thead>
            <tbody>{rows_html}</tbody>
            <tfoot><tr><td colspan='4' style='padding:8px 10px;text-align:right;font-weight:bold'>합계</td>
              <td style='padding:8px 10px;border:1px solid #ddd;text-align:right;font-weight:bold'>{(po.total_amount or 0):,.0f}원</td></tr></tfoot>
          </table>
          <p style='color:#888;font-size:12px;margin-top:16px'>본 발주서는 조인앤조인 구매관리 시스템에서 발행되었습니다.</p>
        </div>"""
        resend.Emails.send({
            "from": settings.RESEND_FROM_EMAIL,
            "to": [recipient],
            "subject": f"[조인앤조인] 발주서 {po.po_no or f'PO-{po.id}'} — {po.vendor_name or ''}",
            "html": html,
        })
        po.status = "발주"
        db.commit()
        return {"ok": True, "sent_to": recipient}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"발송 실패: {str(e)[:200]}")
