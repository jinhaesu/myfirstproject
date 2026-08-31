"""MES(생산현장관리) API 라우트.

base path: /mes (main.py에서 prefix="/api"로 등록 → 실제 경로 /api/mes/...)
설계 계약서: docs/MES_DESIGN.md §4
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.routes.auth import get_current_user
from app.database import get_db
from app.db_models import ScmBomLine
from app.models.mes import (
    MesProcess, MesEquipment, MesWorker, MesCode, MesCcpLimit,
    MesProductionPlan, MesWorkOrder, MesWorkOrderWorker, MesWorkResult,
    MesDefect, MesDowntime, MesMaterialIssue, MesProcessRun, MesDeviation,
    MesCcpLog, MesChecklistTemplate, MesChecklistEntry, MesEquipmentEvent,
    MesSensorReading,
)
from app.services import mes_service as svc

router = APIRouter(prefix="/mes", tags=["mes"])


def _uemail(user: dict) -> str:
    return user.get("email") or user.get("sub") or "system"


def _pdate(s: Optional[str], field: str = "date") -> Optional[date]:
    if s is None:
        return None
    d = svc.parse_date(s)
    if d is None:
        raise HTTPException(400, f"{field} 형식 오류(YYYY-MM-DD)")
    return d


# ══════════════════════════════════════════════
# 기준정보
# ══════════════════════════════════════════════

class ProcessIn(BaseModel):
    id: Optional[int] = None
    code: str
    name: str
    process_class: Optional[str] = None
    floor: Optional[str] = None
    is_ccp: bool = False
    ccp_code: Optional[str] = None
    pop_kind: Optional[str] = None
    sub_kind: Optional[str] = None
    sort_order: int = 0
    is_active: bool = True
    notes: Optional[str] = None


@router.get("/processes")
def list_processes(active: Optional[int] = None, db: Session = Depends(get_db),
                   user: dict = Depends(get_current_user)):
    q = db.query(MesProcess)
    if active:
        q = q.filter(MesProcess.is_active.is_(True))
    rows = q.order_by(MesProcess.sort_order, MesProcess.id).all()
    return {"items": [svc.ser_process(p) for p in rows]}


@router.post("/processes")
def upsert_process(body: ProcessIn, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    row = db.get(MesProcess, body.id) if body.id else None
    if body.id and not row:
        raise HTTPException(404, "공정 없음")
    if not row:
        row = MesProcess()
        db.add(row)
    for f in ("code", "name", "process_class", "floor", "is_ccp", "ccp_code", "pop_kind",
              "sub_kind", "sort_order", "is_active", "notes"):
        setattr(row, f, getattr(body, f))
    try:
        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(400, f"저장 실패(중복 코드 가능): {e}")
    db.refresh(row)
    return svc.ser_process(row)


@router.delete("/processes/{pid}")
def delete_process(pid: int, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    row = db.get(MesProcess, pid)
    if not row:
        raise HTTPException(404, "공정 없음")
    row.is_active = False
    db.commit()
    return {"ok": True, "deactivated": True}


class EquipmentIn(BaseModel):
    id: Optional[int] = None
    code: str
    name: str
    process_id: Optional[int] = None
    floor: Optional[str] = None
    unit_label: Optional[str] = None
    eq_type: Optional[str] = None
    maker: Optional[str] = None
    model: Optional[str] = None
    spec: Optional[str] = None
    purchase_date: Optional[str] = None
    purchase_amount: Optional[float] = None
    plc_yn: bool = False
    is_active: bool = True
    sort_order: int = 0
    notes: Optional[str] = None


@router.get("/equipment")
def list_equipment(process_id: Optional[int] = None, floor: Optional[str] = None,
                   active: Optional[int] = None, db: Session = Depends(get_db),
                   user: dict = Depends(get_current_user)):
    q = db.query(MesEquipment)
    if process_id is not None:
        q = q.filter(MesEquipment.process_id == process_id)
    if floor:
        q = q.filter(MesEquipment.floor == floor)
    if active:
        q = q.filter(MesEquipment.is_active.is_(True))
    rows = q.order_by(MesEquipment.sort_order, MesEquipment.id).all()
    procs = svc.process_map(db)
    return {"items": [svc.ser_equipment(e, procs.get(e.process_id).name if e.process_id in procs else None)
                      for e in rows]}


@router.post("/equipment")
def upsert_equipment(body: EquipmentIn, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    row = db.get(MesEquipment, body.id) if body.id else None
    if body.id and not row:
        raise HTTPException(404, "설비 없음")
    if not row:
        row = MesEquipment()
        db.add(row)
    row.code = body.code
    row.name = body.name
    row.process_id = body.process_id
    row.floor = body.floor
    row.unit_label = body.unit_label
    row.eq_type = body.eq_type
    row.maker = body.maker
    row.model = body.model
    row.spec = body.spec
    row.purchase_date = _pdate(body.purchase_date, "purchase_date")
    row.purchase_amount = body.purchase_amount
    row.plc_yn = body.plc_yn
    row.is_active = body.is_active
    row.sort_order = body.sort_order
    row.notes = body.notes
    try:
        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(400, f"저장 실패(중복 코드 가능): {e}")
    db.refresh(row)
    return svc.ser_equipment(row)


@router.delete("/equipment/{eid}")
def delete_equipment(eid: int, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    row = db.get(MesEquipment, eid)
    if not row:
        raise HTTPException(404, "설비 없음")
    row.is_active = False
    db.commit()
    return {"ok": True, "deactivated": True}


class WorkerIn(BaseModel):
    id: Optional[int] = None
    name: str
    department: Optional[str] = None
    default_floor: Optional[str] = None
    phone: Optional[str] = None
    is_active: bool = True
    sort_order: int = 0
    health_cert_date: Optional[str] = None
    health_cert_next: Optional[str] = None
    notes: Optional[str] = None


@router.get("/workers")
def list_workers(active: Optional[int] = None, db: Session = Depends(get_db),
                 user: dict = Depends(get_current_user)):
    q = db.query(MesWorker)
    if active:
        q = q.filter(MesWorker.is_active.is_(True))
    rows = q.order_by(MesWorker.sort_order, MesWorker.id).all()
    return {"items": [svc.ser_worker(w) for w in rows]}


@router.post("/workers")
def upsert_worker(body: WorkerIn, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    row = db.get(MesWorker, body.id) if body.id else None
    if body.id and not row:
        raise HTTPException(404, "작업자 없음")
    if not row:
        row = MesWorker()
        db.add(row)
    row.name = body.name
    row.department = body.department
    row.default_floor = body.default_floor
    row.phone = body.phone
    row.is_active = body.is_active
    row.sort_order = body.sort_order
    row.health_cert_date = _pdate(body.health_cert_date, "health_cert_date")
    row.health_cert_next = _pdate(body.health_cert_next, "health_cert_next")
    row.notes = body.notes
    db.commit()
    db.refresh(row)
    return svc.ser_worker(row)


@router.delete("/workers/{wid}")
def delete_worker(wid: int, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    row = db.get(MesWorker, wid)
    if not row:
        raise HTTPException(404, "작업자 없음")
    row.is_active = False
    db.commit()
    return {"ok": True, "deactivated": True}


class CodeIn(BaseModel):
    id: Optional[int] = None
    group_code: str
    code: str
    name: str
    sort_order: int = 0
    is_active: bool = True
    extra: Optional[dict] = None
    notes: Optional[str] = None


@router.get("/codes")
def list_codes(group: Optional[str] = None, db: Session = Depends(get_db),
              user: dict = Depends(get_current_user)):
    q = db.query(MesCode)
    if group:
        q = q.filter(MesCode.group_code == group)
    rows = q.order_by(MesCode.group_code, MesCode.sort_order, MesCode.id).all()
    return {"items": [svc.ser_code(c) for c in rows]}


@router.post("/codes")
def upsert_code(body: CodeIn, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    row = db.get(MesCode, body.id) if body.id else None
    if body.id and not row:
        raise HTTPException(404, "코드 없음")
    if not row:
        row = MesCode()
        db.add(row)
    row.group_code = body.group_code
    row.code = body.code
    row.name = body.name
    row.sort_order = body.sort_order
    row.is_active = body.is_active
    row.extra = svc.jdumps(body.extra) if body.extra else None
    row.notes = body.notes
    try:
        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(400, f"저장 실패(중복 group+code 가능): {e}")
    db.refresh(row)
    return svc.ser_code(row)


@router.delete("/codes/{cid}")
def delete_code(cid: int, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    row = db.get(MesCode, cid)
    if not row:
        raise HTTPException(404, "코드 없음")
    row.is_active = False
    db.commit()
    return {"ok": True, "deactivated": True}


class LimitIn(BaseModel):
    id: Optional[int] = None
    process_id: int
    family_code: Optional[str] = None
    name: Optional[str] = None
    param: Optional[str] = None
    min_value: Optional[float] = None
    max_value: Optional[float] = None
    unit: Optional[str] = None
    check_cycle: Optional[str] = None
    check_method: Optional[str] = None
    corrective_action: Optional[str] = None
    alarm_yn: bool = False
    is_active: bool = True
    notes: Optional[str] = None


@router.get("/limits")
def list_limits(process_id: Optional[int] = None, db: Session = Depends(get_db),
                user: dict = Depends(get_current_user)):
    q = db.query(MesCcpLimit)
    if process_id is not None:
        q = q.filter(MesCcpLimit.process_id == process_id)
    rows = q.order_by(MesCcpLimit.process_id, MesCcpLimit.id).all()
    procs = svc.process_map(db)
    return {"items": [svc.ser_limit(l, procs.get(l.process_id).name if l.process_id in procs else None)
                      for l in rows]}


@router.post("/limits")
def upsert_limit(body: LimitIn, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    row = db.get(MesCcpLimit, body.id) if body.id else None
    if body.id and not row:
        raise HTTPException(404, "한계기준 없음")
    if not row:
        row = MesCcpLimit()
        db.add(row)
    for f in ("process_id", "family_code", "name", "param", "min_value", "max_value", "unit",
              "check_cycle", "check_method", "corrective_action", "alarm_yn", "is_active", "notes"):
        setattr(row, f, getattr(body, f))
    db.commit()
    db.refresh(row)
    procs = svc.process_map(db)
    return svc.ser_limit(row, procs.get(row.process_id).name if row.process_id in procs else None)


@router.delete("/limits/{lid}")
def delete_limit(lid: int, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    row = db.get(MesCcpLimit, lid)
    if not row:
        raise HTTPException(404, "한계기준 없음")
    row.is_active = False
    db.commit()
    return {"ok": True, "deactivated": True}


@router.get("/items")
def get_items(q: Optional[str] = None, item_type: Optional[str] = None,
             db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    return {"items": svc.search_items(db, q, item_type)}


@router.get("/materials")
def get_materials(q: Optional[str] = None, db: Session = Depends(get_db),
                  user: dict = Depends(get_current_user)):
    return {"items": svc.search_materials(db, q)}


@router.get("/items/{item_id}/bom")
def get_item_bom(item_id: int, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    return {"lines": svc.item_bom_lines(db, item_id)}


class TemplateIn(BaseModel):
    id: Optional[int] = None
    code: str
    name: str
    category: Optional[str] = None
    cycle: str = "daily"
    items_json: Optional[list] = None
    approval_json: Optional[dict] = None
    items: Optional[list] = None          # 프론트 별칭
    approval: Optional[dict] = None       # 프론트 별칭
    is_active: bool = True
    sort_order: int = 0
    notes: Optional[str] = None


@router.get("/templates")
def list_templates(db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    rows = db.query(MesChecklistTemplate).order_by(MesChecklistTemplate.sort_order,
                                                    MesChecklistTemplate.id).all()
    return {"items": [svc.ser_template(t) for t in rows]}


@router.post("/templates")
def upsert_template(body: TemplateIn, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    row = db.get(MesChecklistTemplate, body.id) if body.id else None
    if body.id and not row:
        raise HTTPException(404, "템플릿 없음")
    if not row:
        row = MesChecklistTemplate()
        db.add(row)
    row.code = body.code
    row.name = body.name
    row.category = body.category
    row.cycle = body.cycle
    row.items_json = svc.jdumps(body.items_json or body.items or [])
    row.approval_json = svc.jdumps(body.approval_json or body.approval or {"reviewer": True, "approver": True})
    row.is_active = body.is_active
    row.sort_order = body.sort_order
    row.notes = body.notes
    try:
        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(400, f"저장 실패(중복 코드 가능): {e}")
    db.refresh(row)
    return svc.ser_template(row)


@router.delete("/templates/{tid}")
def delete_template(tid: int, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    row = db.get(MesChecklistTemplate, tid)
    if not row:
        raise HTTPException(404, "템플릿 없음")
    row.is_active = False
    db.commit()
    return {"ok": True, "deactivated": True}


@router.post("/seed")
def seed(db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    return svc.run_seed(db)


# ══════════════════════════════════════════════
# 생산계획
# ══════════════════════════════════════════════

@router.get("/plans")
def list_plans(month: str, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    first, last = svc.month_range(month)
    if not first:
        raise HTTPException(400, "month 형식 오류(YYYY-MM)")
    rows = db.query(MesProductionPlan).filter(
        MesProductionPlan.plan_date >= first, MesProductionPlan.plan_date <= last).all()
    orders = db.query(MesWorkOrder).filter(
        MesWorkOrder.order_date >= first, MesWorkOrder.order_date <= last,
        MesWorkOrder.status == "done").all()
    metrics = svc.order_metrics(db, [o.id for o in orders])
    actual: dict[str, float] = defaultdict(float)
    for o in orders:
        key = f"{o.item_name}|{svc.dstr(o.order_date)}"
        actual[key] += metrics.get(o.id, {}).get("good_qty", 0.0)
    return {"items": [svc.ser_plan(p) for p in rows], "actual": dict(actual)}


class PlanItemIn(BaseModel):
    plan_date: str
    item_id: Optional[int] = None
    item_name: str
    family_code: Optional[str] = None
    plan_qty: Optional[float] = 0


class PlansBulkIn(BaseModel):
    items: list[PlanItemIn]


@router.post("/plans/bulk")
def bulk_plans(body: PlansBulkIn, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    upserted = deleted = 0
    for it in body.items:
        pd = _pdate(it.plan_date, "plan_date")
        row = db.query(MesProductionPlan).filter(
            MesProductionPlan.plan_date == pd, MesProductionPlan.item_name == it.item_name).first()
        if not it.plan_qty:
            if row:
                db.delete(row)
                deleted += 1
            continue
        if not row:
            row = MesProductionPlan(plan_date=pd, item_name=it.item_name)
            db.add(row)
        row.item_id = it.item_id
        row.family_code = it.family_code
        row.plan_qty = it.plan_qty
        upserted += 1
    db.commit()
    return {"ok": True, "upserted": upserted, "deleted": deleted}


# ══════════════════════════════════════════════
# 작업지시
# ══════════════════════════════════════════════

class WorkOrderIn(BaseModel):
    id: Optional[int] = None
    order_date: str
    item_id: Optional[int] = None
    item_name: str
    family_code: Optional[str] = None
    process_id: int
    equipment_id: Optional[int] = None
    plan_qty: float = 0
    unit: Optional[str] = "ea"
    batch_count: Optional[int] = None
    priority: Optional[int] = 3
    lot_no: Optional[str] = None
    expiry_date: Optional[str] = None
    notes: Optional[str] = None
    worker_ids: Optional[list[int]] = None


def _assign_workers(db: Session, order_id: int, worker_ids: Optional[list[int]]):
    if worker_ids is None:
        return
    db.query(MesWorkOrderWorker).filter(MesWorkOrderWorker.work_order_id == order_id).delete()
    for wid in worker_ids:
        db.add(MesWorkOrderWorker(work_order_id=order_id, worker_id=wid))


def _order_workers(db: Session, order_ids: list[int]) -> dict[int, list[dict]]:
    out: dict[int, list[dict]] = defaultdict(list)
    if not order_ids:
        return out
    workers = svc.worker_map(db)
    rows = db.query(MesWorkOrderWorker).filter(MesWorkOrderWorker.work_order_id.in_(order_ids)).all()
    for r in rows:
        w = workers.get(r.worker_id)
        out[r.work_order_id].append({"id": r.worker_id, "name": w.name if w else None})
    return out


@router.get("/work-orders")
def list_work_orders(start: Optional[str] = None, end: Optional[str] = None,
                     process_id: Optional[int] = None, equipment_id: Optional[int] = None,
                     status: Optional[str] = None, q: Optional[str] = None,
                     db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    query = db.query(MesWorkOrder)
    if start:
        query = query.filter(MesWorkOrder.order_date >= _pdate(start, "start"))
    if end:
        query = query.filter(MesWorkOrder.order_date <= _pdate(end, "end"))
    if process_id is not None:
        query = query.filter(MesWorkOrder.process_id == process_id)
    if equipment_id is not None:
        query = query.filter(MesWorkOrder.equipment_id == equipment_id)
    if status:
        query = query.filter(MesWorkOrder.status == status)
    if q:
        query = query.filter(MesWorkOrder.item_name.ilike(f"%{q}%"))
    rows = query.order_by(MesWorkOrder.order_date.desc(), MesWorkOrder.id.desc()).all()
    procs = svc.process_map(db)
    eqs = svc.equipment_map(db)
    order_ids = [o.id for o in rows]
    metrics = svc.order_metrics(db, order_ids)
    workers = _order_workers(db, order_ids)
    return {"items": [
        svc.ser_work_order(o, procs.get(o.process_id).name if o.process_id in procs else None,
                           eqs.get(o.equipment_id).name if o.equipment_id in eqs else None,
                           workers.get(o.id, []), metrics.get(o.id, {}))
        for o in rows
    ]}


@router.post("/work-orders")
def upsert_work_order(body: WorkOrderIn, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    od = _pdate(body.order_date, "order_date")
    row = db.get(MesWorkOrder, body.id) if body.id else None
    if body.id and not row:
        raise HTTPException(404, "작업지시 없음")
    if not row:
        wo_no, seq = svc.next_wo_no(db, od)
        row = MesWorkOrder(wo_no=wo_no, seq=seq, order_date=od, status="planned",
                           created_by=_uemail(user))
        db.add(row)
    row.order_date = od
    row.item_id = body.item_id
    row.item_name = body.item_name
    row.family_code = body.family_code
    row.process_id = body.process_id
    row.equipment_id = body.equipment_id
    row.plan_qty = body.plan_qty
    row.unit = body.unit
    row.batch_count = body.batch_count
    row.priority = body.priority or 3
    row.lot_no = body.lot_no
    row.expiry_date = _pdate(body.expiry_date, "expiry_date")
    row.notes = body.notes
    db.flush()
    _assign_workers(db, row.id, body.worker_ids)
    db.commit()
    db.refresh(row)
    procs = svc.process_map(db)
    eqs = svc.equipment_map(db)
    workers = _order_workers(db, [row.id])
    return svc.ser_work_order(row, procs.get(row.process_id).name if row.process_id in procs else None,
                              eqs.get(row.equipment_id).name if row.equipment_id in eqs else None,
                              workers.get(row.id, []), svc.order_metrics(db, [row.id]).get(row.id, {}))


class WorkOrderBulkIn(BaseModel):
    items: list[WorkOrderIn]


@router.post("/work-orders/bulk")
def bulk_work_orders(body: WorkOrderBulkIn, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    created = []
    for it in body.items:
        od = _pdate(it.order_date, "order_date")
        wo_no, seq = svc.next_wo_no(db, od)
        row = MesWorkOrder(
            wo_no=wo_no, seq=seq, order_date=od, item_id=it.item_id, item_name=it.item_name,
            family_code=it.family_code, process_id=it.process_id, equipment_id=it.equipment_id,
            plan_qty=it.plan_qty, unit=it.unit, batch_count=it.batch_count,
            priority=it.priority or 3, lot_no=it.lot_no,
            expiry_date=_pdate(it.expiry_date, "expiry_date"), notes=it.notes,
            status="planned", created_by=_uemail(user),
        )
        db.add(row)
        db.flush()
        _assign_workers(db, row.id, it.worker_ids)
        created.append(row.id)
    db.commit()
    return {"ok": True, "created": len(created), "ids": created}


@router.get("/work-orders/timeline")
def work_orders_timeline(date: Optional[str] = None, db: Session = Depends(get_db),
                         user: dict = Depends(get_current_user)):
    d = _pdate(date, "date") or datetime.now().date()
    equipment = db.query(MesEquipment).filter(MesEquipment.is_active.is_(True)).order_by(
        MesEquipment.sort_order, MesEquipment.id).all()
    orders = db.query(MesWorkOrder).filter(MesWorkOrder.order_date == d).all()
    metrics = svc.order_metrics(db, [o.id for o in orders])
    by_eq: dict[int, list] = defaultdict(list)
    for o in orders:
        m = metrics.get(o.id, {})
        plan_qty = o.plan_qty or 0
        prod = m.get("prod_qty", 0.0)
        progress = round(min(100.0, prod / plan_qty * 100) if plan_qty else 0.0, 1)
        by_eq[o.equipment_id or 0].append({
            "id": o.id, "wo_no": o.wo_no, "item_name": o.item_name, "status": o.status,
            "start_at": svc.iso(o.start_at), "end_at": svc.iso(o.end_at),
            "plan_qty": o.plan_qty, "progress_pct": progress,
        })
    out = [{"id": e.id, "name": e.name, "floor": e.floor, "orders": by_eq.get(e.id, [])} for e in equipment]
    if by_eq.get(0):
        out.append({"id": 0, "name": "미배정", "floor": None, "orders": by_eq[0]})
    return {"equipment": out}


@router.get("/work-orders/{oid}")
def get_work_order(oid: int, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    o = db.get(MesWorkOrder, oid)
    if not o:
        raise HTTPException(404, "작업지시 없음")
    procs = svc.process_map(db)
    eqs = svc.equipment_map(db)
    workers_map = svc.worker_map(db)
    downtime_names = svc.code_name_map(db, "DOWNTIME")
    defect_names = svc.code_name_map(db, "DEFECT")
    order_dict = svc.ser_work_order(
        o, procs.get(o.process_id).name if o.process_id in procs else None,
        eqs.get(o.equipment_id).name if o.equipment_id in eqs else None,
        _order_workers(db, [o.id]).get(o.id, []), svc.order_metrics(db, [o.id]).get(o.id, {}))
    results = db.query(MesWorkResult).filter(MesWorkResult.work_order_id == oid).order_by(
        MesWorkResult.id).all()
    defects = db.query(MesDefect).filter(MesDefect.work_order_id == oid).order_by(MesDefect.id).all()
    downtimes = db.query(MesDowntime).filter(MesDowntime.work_order_id == oid).order_by(MesDowntime.id).all()
    materials = db.query(MesMaterialIssue).filter(MesMaterialIssue.work_order_id == oid).order_by(
        MesMaterialIssue.id).all()
    runs = db.query(MesProcessRun).filter(MesProcessRun.work_order_id == oid).order_by(MesProcessRun.id).all()
    return {
        "order": order_dict,
        "results": [svc.ser_result(r, workers_map.get(r.worker_id).name if r.worker_id in workers_map else None)
                   for r in results],
        "defects": [svc.ser_defect(d, defect_names.get(d.defect_code)) for d in defects],
        "downtimes": [svc.ser_downtime(d, downtime_names.get(d.downtime_code),
                                       eqs.get(d.equipment_id).name if d.equipment_id in eqs else None)
                     for d in downtimes],
        "materials": [svc.ser_material(m) for m in materials],
        "workers": _order_workers(db, [oid]).get(oid, []),
        "runs": [svc.ser_run(r, procs.get(r.process_id).name if r.process_id in procs else None,
                             eqs.get(r.equipment_id).name if r.equipment_id in eqs else None,
                             workers_map.get(r.worker_id).name if r.worker_id in workers_map else None)
                for r in runs],
    }


@router.delete("/work-orders/{oid}")
def delete_work_order(oid: int, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    o = db.get(MesWorkOrder, oid)
    if not o:
        raise HTTPException(404, "작업지시 없음")
    if o.status in ("planned", "cancelled"):
        db.query(MesWorkOrderWorker).filter(MesWorkOrderWorker.work_order_id == oid).delete()
        db.query(MesWorkResult).filter(MesWorkResult.work_order_id == oid).delete()
        db.query(MesDefect).filter(MesDefect.work_order_id == oid).delete()
        db.query(MesDowntime).filter(MesDowntime.work_order_id == oid).delete()
        db.query(MesMaterialIssue).filter(MesMaterialIssue.work_order_id == oid).delete()
        db.delete(o)
        db.commit()
        return {"ok": True, "deleted": True}
    o.status = "cancelled"
    db.commit()
    return {"ok": True, "cancelled": True}


def _get_order_or_404(db: Session, oid: int) -> MesWorkOrder:
    o = db.get(MesWorkOrder, oid)
    if not o:
        raise HTTPException(404, "작업지시 없음")
    return o


@router.post("/work-orders/{oid}/start")
def start_work_order(oid: int, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    o = _get_order_or_404(db, oid)
    o.status = "in_progress"
    if not o.start_at:
        o.start_at = datetime.now()
    db.commit()
    return {"ok": True, "status": o.status, "start_at": svc.iso(o.start_at)}


@router.post("/work-orders/{oid}/pause")
def pause_work_order(oid: int, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    o = _get_order_or_404(db, oid)
    o.status = "paused"
    db.commit()
    return {"ok": True, "status": o.status}


@router.post("/work-orders/{oid}/resume")
def resume_work_order(oid: int, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    o = _get_order_or_404(db, oid)
    o.status = "in_progress"
    db.commit()
    return {"ok": True, "status": o.status}


@router.post("/work-orders/{oid}/finish")
def finish_work_order(oid: int, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    o = _get_order_or_404(db, oid)
    o.status = "done"
    o.end_at = datetime.now()
    db.commit()
    return {"ok": True, "status": o.status, "end_at": svc.iso(o.end_at)}


@router.post("/work-orders/{oid}/cancel")
def cancel_work_order(oid: int, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    o = _get_order_or_404(db, oid)
    o.status = "cancelled"
    db.commit()
    return {"ok": True, "status": o.status}


class ResultIn(BaseModel):
    prod_qty: float
    defect_qty: Optional[float] = 0
    good_qty: Optional[float] = None
    start_at: Optional[str] = None
    end_at: Optional[str] = None
    worker_id: Optional[int] = None
    notes: Optional[str] = None


@router.post("/work-orders/{oid}/results")
def add_result(oid: int, body: ResultIn, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    o = _get_order_or_404(db, oid)
    good = body.good_qty if body.good_qty is not None else max((body.prod_qty or 0) - (body.defect_qty or 0), 0)
    n = db.query(MesWorkResult).filter(MesWorkResult.work_order_id == oid).count() + 1
    r = MesWorkResult(
        work_order_id=oid, result_no=f"R{o.wo_no}-{n}", prod_qty=body.prod_qty,
        good_qty=good, defect_qty=body.defect_qty or 0, worker_id=body.worker_id, notes=body.notes,
        start_at=_parse_dt(body.start_at), end_at=_parse_dt(body.end_at),
    )
    db.add(r)
    db.commit()
    db.refresh(r)
    return svc.ser_result(r)


def _parse_dt(s: Optional[str]) -> Optional[datetime]:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", ""))
    except Exception:
        return None


@router.delete("/results/{rid}")
def delete_result(rid: int, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    n = db.query(MesWorkResult).filter(MesWorkResult.id == rid).delete()
    db.commit()
    return {"ok": True, "deleted": n}


class DefectIn(BaseModel):
    defect_code: str
    qty: float
    notes: Optional[str] = None


@router.post("/work-orders/{oid}/defects")
def add_defect(oid: int, body: DefectIn, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    _get_order_or_404(db, oid)
    d = MesDefect(work_order_id=oid, defect_code=body.defect_code, qty=body.qty, notes=body.notes)
    db.add(d)
    db.commit()
    db.refresh(d)
    names = svc.code_name_map(db, "DEFECT")
    return svc.ser_defect(d, names.get(d.defect_code))


@router.delete("/defects/{did}")
def delete_defect(did: int, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    n = db.query(MesDefect).filter(MesDefect.id == did).delete()
    db.commit()
    return {"ok": True, "deleted": n}


class DowntimeIn(BaseModel):
    downtime_code: str
    start_at: Optional[str] = None
    end_at: Optional[str] = None
    minutes: Optional[float] = None
    reason: Optional[str] = None
    equipment_id: Optional[int] = None


@router.post("/work-orders/{oid}/downtimes")
def add_downtime(oid: int, body: DowntimeIn, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    _get_order_or_404(db, oid)
    start_at = _parse_dt(body.start_at) or datetime.now()
    end_at = _parse_dt(body.end_at)
    minutes = body.minutes
    if minutes is None and end_at:
        minutes = (end_at - start_at).total_seconds() / 60
    d = MesDowntime(work_order_id=oid, equipment_id=body.equipment_id, downtime_code=body.downtime_code,
                    start_at=start_at, end_at=end_at, minutes=minutes, reason=body.reason)
    db.add(d)
    db.commit()
    db.refresh(d)
    names = svc.code_name_map(db, "DOWNTIME")
    return svc.ser_downtime(d, names.get(d.downtime_code))


@router.post("/downtimes/{did}/end")
def end_downtime(did: int, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    d = db.get(MesDowntime, did)
    if not d:
        raise HTTPException(404, "비가동 기록 없음")
    d.end_at = datetime.now()
    d.minutes = (d.end_at - d.start_at).total_seconds() / 60 if d.start_at else d.minutes
    db.commit()
    names = svc.code_name_map(db, "DOWNTIME")
    return svc.ser_downtime(d, names.get(d.downtime_code))


@router.delete("/downtimes/{did}")
def delete_downtime(did: int, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    n = db.query(MesDowntime).filter(MesDowntime.id == did).delete()
    db.commit()
    return {"ok": True, "deleted": n}


class MaterialIn(BaseModel):
    material_type: str
    material_id: Optional[int] = None
    material_name: str
    qty: float
    unit: Optional[str] = None
    lot_no: Optional[str] = None


@router.post("/work-orders/{oid}/materials")
def add_material(oid: int, body: MaterialIn, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    _get_order_or_404(db, oid)
    m = MesMaterialIssue(work_order_id=oid, material_type=body.material_type, material_id=body.material_id,
                         material_name=body.material_name, qty=body.qty, unit=body.unit,
                         lot_no=body.lot_no, source="manual")
    db.add(m)
    db.commit()
    db.refresh(m)
    return svc.ser_material(m)


@router.post("/work-orders/{oid}/materials/from-bom")
def materials_from_bom(oid: int, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    o = _get_order_or_404(db, oid)
    if not o.item_id:
        raise HTTPException(400, "품목이 지정되지 않아 BOM 자동산출 불가")
    lines = db.query(ScmBomLine).filter(ScmBomLine.item_id == o.item_id).all()
    # 멱등 처리: 기존 BOM 자동생성분 삭제 후 재생성
    db.query(MesMaterialIssue).filter(MesMaterialIssue.work_order_id == oid,
                                      MesMaterialIssue.source == "bom").delete()
    created = []
    for ln in lines:
        qty = (ln.qty_per_unit or 0) * (o.plan_qty or 0)
        m = MesMaterialIssue(
            work_order_id=oid, material_type=ln.material_type,
            material_id=ln.raw_material_id if ln.material_type == "raw" else ln.sub_material_id,
            material_name=ln.material_name, qty=qty, unit=ln.qty_unit, source="bom",
        )
        db.add(m)
        created.append(m)
    db.commit()
    return {"ok": True, "created": len(created), "items": [svc.ser_material(m) for m in created]}


@router.delete("/materials/{mid}")
def delete_material(mid: int, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    n = db.query(MesMaterialIssue).filter(MesMaterialIssue.id == mid).delete()
    db.commit()
    return {"ok": True, "deleted": n}


class WorkersAssignIn(BaseModel):
    worker_ids: list[int]


@router.post("/work-orders/{oid}/workers")
def assign_workers(oid: int, body: WorkersAssignIn, db: Session = Depends(get_db),
                   user: dict = Depends(get_current_user)):
    _get_order_or_404(db, oid)
    _assign_workers(db, oid, body.worker_ids)
    db.commit()
    return {"ok": True, "workers": _order_workers(db, [oid]).get(oid, [])}


# ══════════════════════════════════════════════
# POP 공정실행
# ══════════════════════════════════════════════

class RunIn(BaseModel):
    run_date: Optional[str] = None
    process_id: int
    equipment_id: Optional[int] = None
    work_order_id: Optional[int] = None
    family_code: Optional[str] = None
    item_name: Optional[str] = None
    input_kg: Optional[float] = None
    alcohol_g: Optional[float] = None
    limit_value: Optional[float] = None
    measured_value: Optional[float] = None
    worker_id: Optional[int] = None
    notes: Optional[str] = None


@router.get("/runs")
def list_runs(date: Optional[str] = None, pop_kind: Optional[str] = None,
             process_id: Optional[int] = None, equipment_id: Optional[int] = None,
             status: Optional[str] = None, db: Session = Depends(get_db),
             user: dict = Depends(get_current_user)):
    q = db.query(MesProcessRun)
    if date:
        q = q.filter(MesProcessRun.run_date == _pdate(date, "date"))
    if process_id is not None:
        q = q.filter(MesProcessRun.process_id == process_id)
    if equipment_id is not None:
        q = q.filter(MesProcessRun.equipment_id == equipment_id)
    if status:
        q = q.filter(MesProcessRun.status == status)
    else:
        q = q.filter(MesProcessRun.status != "deleted")
    procs = svc.process_map(db)
    if pop_kind:
        pids = [pid for pid, p in procs.items() if p.pop_kind == pop_kind]
        q = q.filter(MesProcessRun.process_id.in_(pids))
    rows = q.order_by(MesProcessRun.id.desc()).all()
    eqs = svc.equipment_map(db)
    workers = svc.worker_map(db)
    return {"items": [
        svc.ser_run(r, procs.get(r.process_id).name if r.process_id in procs else None,
                   eqs.get(r.equipment_id).name if r.equipment_id in eqs else None,
                   workers.get(r.worker_id).name if r.worker_id in workers else None)
        for r in rows
    ]}


@router.post("/runs")
def create_run(body: RunIn, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    process = db.get(MesProcess, body.process_id)
    if not process:
        raise HTTPException(404, "공정 없음")
    limit_row = svc.find_limit(db, body.process_id, body.family_code, process.pop_kind if process else None)
    limit_value = body.limit_value
    if limit_value is None:
        limit_value = svc.auto_limit_value(process, limit_row)
    alcohol_g = body.alcohol_g
    if process.pop_kind == "mixing" and alcohol_g is None and body.input_kg is not None:
        alcohol_g = round(body.input_kg * 10, 1)
    r = MesProcessRun(
        run_date=_pdate(body.run_date, "run_date") or date.today(), process_id=body.process_id,
        equipment_id=body.equipment_id, work_order_id=body.work_order_id, family_code=body.family_code,
        item_name=body.item_name, input_kg=body.input_kg, alcohol_g=alcohol_g, limit_value=limit_value,
        measured_value=body.measured_value, worker_id=body.worker_id, notes=body.notes,
        status="running", start_at=datetime.now(),
    )
    db.add(r)
    db.commit()
    db.refresh(r)
    procs = svc.process_map(db)
    eqs = svc.equipment_map(db)
    workers = svc.worker_map(db)
    return svc.ser_run(r, procs.get(r.process_id).name if r.process_id in procs else None,
                       eqs.get(r.equipment_id).name if r.equipment_id in eqs else None,
                       workers.get(r.worker_id).name if r.worker_id in workers else None)


class RunEndIn(BaseModel):
    measured_value: Optional[float] = None
    test_result: Optional[str] = None
    notes: Optional[str] = None


@router.post("/runs/{rid}/end")
def end_run(rid: int, body: RunEndIn, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    r = db.get(MesProcessRun, rid)
    if not r:
        raise HTTPException(404, "공정실행 없음")
    process = db.get(MesProcess, r.process_id)
    r.end_at = datetime.now()
    if r.start_at:
        r.minutes = round((r.end_at - r.start_at).total_seconds() / 60, 1)
    if body.measured_value is not None:
        r.measured_value = body.measured_value
    if body.test_result is not None:
        r.test_result = body.test_result
    if body.notes is not None:
        r.notes = body.notes
    r.status = "done"
    limit_row = svc.find_limit(db, r.process_id, r.family_code, process.pop_kind if process else None)
    r.judgment = svc.judge_run(process, limit_row, r.minutes, r.measured_value, r.test_result)
    svc.record_sensor_from_run(db, r, process)
    if r.judgment == "부":
        svc.create_deviation_for_run(db, r, process)
    db.commit()
    db.refresh(r)
    procs = svc.process_map(db)
    eqs = svc.equipment_map(db)
    workers = svc.worker_map(db)
    return svc.ser_run(r, procs.get(r.process_id).name if r.process_id in procs else None,
                       eqs.get(r.equipment_id).name if r.equipment_id in eqs else None,
                       workers.get(r.worker_id).name if r.worker_id in workers else None)


class RunUpdateIn(BaseModel):
    equipment_id: Optional[int] = None
    work_order_id: Optional[int] = None
    family_code: Optional[str] = None
    item_name: Optional[str] = None
    input_kg: Optional[float] = None
    alcohol_g: Optional[float] = None
    limit_value: Optional[float] = None
    measured_value: Optional[float] = None
    worker_id: Optional[int] = None
    notes: Optional[str] = None


@router.put("/runs/{rid}")
def update_run(rid: int, body: RunUpdateIn, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    r = db.get(MesProcessRun, rid)
    if not r:
        raise HTTPException(404, "공정실행 없음")
    for f in ("equipment_id", "work_order_id", "family_code", "item_name", "input_kg", "alcohol_g",
              "limit_value", "measured_value", "worker_id", "notes"):
        v = getattr(body, f)
        if v is not None:
            setattr(r, f, v)
    db.commit()
    db.refresh(r)
    procs = svc.process_map(db)
    eqs = svc.equipment_map(db)
    workers = svc.worker_map(db)
    return svc.ser_run(r, procs.get(r.process_id).name if r.process_id in procs else None,
                       eqs.get(r.equipment_id).name if r.equipment_id in eqs else None,
                       workers.get(r.worker_id).name if r.worker_id in workers else None)


@router.delete("/runs/{rid}")
def delete_run(rid: int, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    r = db.get(MesProcessRun, rid)
    if not r:
        raise HTTPException(404, "공정실행 없음")
    r.status = "deleted"
    db.commit()
    return {"ok": True}


@router.get("/runs/summary")
def runs_summary(date: Optional[str] = None, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    d = _pdate(date, "date") or datetime.now().date()
    runs = db.query(MesProcessRun).filter(MesProcessRun.run_date == d,
                                          MesProcessRun.status != "deleted").all()
    procs = svc.process_map(db)
    eqs = svc.equipment_map(db)
    by_proc: dict[int, dict] = {}
    by_eq: dict[int, dict] = {}
    total = pass_n = fail_n = 0
    for r in runs:
        total += 1
        is_pass = r.judgment == "적"
        is_fail = r.judgment == "부"
        pass_n += 1 if is_pass else 0
        fail_n += 1 if is_fail else 0
        e = by_proc.setdefault(r.process_id, {"process_id": r.process_id,
                               "name": procs.get(r.process_id).name if r.process_id in procs else None,
                               "pop_kind": procs.get(r.process_id).pop_kind if r.process_id in procs else None,
                               "total": 0, "running": 0, "done": 0, "pass": 0, "fail": 0})
        e["total"] += 1
        e["running"] += 1 if r.status == "running" else 0
        e["done"] += 1 if r.status == "done" else 0
        e["pass"] += 1 if is_pass else 0
        e["fail"] += 1 if is_fail else 0
        if r.equipment_id:
            eq = by_eq.setdefault(r.equipment_id, {"equipment_id": r.equipment_id,
                                  "name": eqs.get(r.equipment_id).name if r.equipment_id in eqs else None,
                                  "total": 0, "running": 0, "done": 0, "pass": 0, "fail": 0})
            eq["total"] += 1
            eq["running"] += 1 if r.status == "running" else 0
            eq["done"] += 1 if r.status == "done" else 0
            eq["pass"] += 1 if is_pass else 0
            eq["fail"] += 1 if is_fail else 0
    for e in list(by_proc.values()) + list(by_eq.values()):
        denom = e["pass"] + e["fail"]
        e["pass_rate"] = round(e["pass"] / denom, 4) if denom else 0.0
    denom = pass_n + fail_n
    return {
        "by_process": list(by_proc.values()), "by_equipment": list(by_eq.values()),
        "total": total, "pass_rate": round(pass_n / denom, 4) if denom else 0.0,
    }


# ══════════════════════════════════════════════
# 이탈·개선조치
# ══════════════════════════════════════════════

class DeviationIn(BaseModel):
    id: Optional[int] = None
    run_id: Optional[int] = None
    work_order_id: Optional[int] = None
    process_id: Optional[int] = None
    equipment_id: Optional[int] = None
    occurred_at: Optional[str] = None
    deviation_code: str
    description: Optional[str] = None
    limit_value: Optional[float] = None
    measured_value: Optional[float] = None
    corrective_action: Optional[str] = None
    action_by: Optional[str] = None
    status: Optional[str] = "open"


@router.get("/deviations")
def list_deviations(start: Optional[str] = None, end: Optional[str] = None, status: Optional[str] = None,
                    process_id: Optional[int] = None, db: Session = Depends(get_db),
                    user: dict = Depends(get_current_user)):
    q = db.query(MesDeviation)
    if start:
        q = q.filter(MesDeviation.occurred_at >= datetime.combine(_pdate(start, "start"), datetime.min.time()))
    if end:
        q = q.filter(MesDeviation.occurred_at <= datetime.combine(_pdate(end, "end"), datetime.max.time()))
    if status:
        q = q.filter(MesDeviation.status == status)
    if process_id is not None:
        q = q.filter(MesDeviation.process_id == process_id)
    rows = q.order_by(MesDeviation.id.desc()).all()
    procs = svc.process_map(db)
    eqs = svc.equipment_map(db)
    dnames = svc.code_name_map(db, "DEVIATION")
    return {"items": [svc.ser_deviation(d, procs.get(d.process_id).name if d.process_id in procs else None,
                                        eqs.get(d.equipment_id).name if d.equipment_id in eqs else None,
                                        dnames.get(d.deviation_code, d.deviation_code))
                      for d in rows]}


@router.post("/deviations")
def upsert_deviation(body: DeviationIn, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    row = db.get(MesDeviation, body.id) if body.id else None
    if body.id and not row:
        raise HTTPException(404, "이탈 기록 없음")
    if not row:
        row = MesDeviation()
        db.add(row)
    row.run_id = body.run_id
    row.work_order_id = body.work_order_id
    row.process_id = body.process_id
    row.equipment_id = body.equipment_id
    row.occurred_at = _parse_dt(body.occurred_at) or row.occurred_at or datetime.now()
    row.deviation_code = body.deviation_code
    row.description = body.description
    row.limit_value = body.limit_value
    row.measured_value = body.measured_value
    row.corrective_action = body.corrective_action
    row.action_by = body.action_by
    row.status = body.status or "open"
    db.commit()
    db.refresh(row)
    procs = svc.process_map(db)
    eqs = svc.equipment_map(db)
    dnames = svc.code_name_map(db, "DEVIATION")
    return svc.ser_deviation(row, procs.get(row.process_id).name if row.process_id in procs else None,
                             eqs.get(row.equipment_id).name if row.equipment_id in eqs else None,
                             dnames.get(row.deviation_code, row.deviation_code))


class DeviationCloseIn(BaseModel):
    corrective_action: str
    action_by: Optional[str] = None


@router.post("/deviations/{did}/close")
def close_deviation(did: int, body: DeviationCloseIn, db: Session = Depends(get_db),
                    user: dict = Depends(get_current_user)):
    d = db.get(MesDeviation, did)
    if not d:
        raise HTTPException(404, "이탈 기록 없음")
    d.corrective_action = body.corrective_action
    d.action_by = body.action_by or _uemail(user)
    d.action_at = datetime.now()
    d.status = "closed"
    db.commit()
    return {"ok": True, "status": d.status}


@router.get("/deviations/stats")
def deviations_stats(start: Optional[str] = None, end: Optional[str] = None,
                     db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    q = db.query(MesDeviation)
    if start:
        q = q.filter(MesDeviation.occurred_at >= datetime.combine(_pdate(start, "start"), datetime.min.time()))
    if end:
        q = q.filter(MesDeviation.occurred_at <= datetime.combine(_pdate(end, "end"), datetime.max.time()))
    rows = q.all()
    names = svc.code_name_map(db, "DEVIATION")
    procs = svc.process_map(db)
    by_type: dict[str, int] = defaultdict(int)
    by_process: dict[int, int] = defaultdict(int)
    by_day: dict[str, int] = defaultdict(int)
    for d in rows:
        by_type[d.deviation_code or "ETC"] += 1
        if d.process_id:
            by_process[d.process_id] += 1
        by_day[svc.dstr((d.occurred_at or datetime.now()).date())] += 1
    return {
        "by_type": [{"code": c, "name": names.get(c, c), "count": n} for c, n in by_type.items()],
        "by_process": [{"process_id": p, "name": procs.get(p).name if p in procs else None, "count": n}
                       for p, n in by_process.items()],
        "by_day": [{"date": d, "count": n} for d, n in sorted(by_day.items())],
    }


# ══════════════════════════════════════════════
# CCP 점검일지
# ══════════════════════════════════════════════

def _ccp_run_counts(db: Session, log_date: date, process_id: int, equipment_id: Optional[int]):
    q = db.query(MesProcessRun).filter(MesProcessRun.run_date == log_date,
                                       MesProcessRun.process_id == process_id,
                                       MesProcessRun.status != "deleted")
    if equipment_id is not None:
        q = q.filter(MesProcessRun.equipment_id == equipment_id)
    else:
        q = q.filter(MesProcessRun.equipment_id.is_(None))
    rows = q.all()
    pass_n = sum(1 for r in rows if r.judgment == "적")
    fail_n = sum(1 for r in rows if r.judgment == "부")
    return rows, pass_n, fail_n


@router.get("/ccp-logs")
def list_ccp_logs(start: Optional[str] = None, end: Optional[str] = None, process_id: Optional[int] = None,
                  status: Optional[str] = None, db: Session = Depends(get_db),
                  user: dict = Depends(get_current_user)):
    q = db.query(MesCcpLog)
    if start:
        q = q.filter(MesCcpLog.log_date >= _pdate(start, "start"))
    if end:
        q = q.filter(MesCcpLog.log_date <= _pdate(end, "end"))
    if process_id is not None:
        q = q.filter(MesCcpLog.process_id == process_id)
    if status:
        q = q.filter(MesCcpLog.status == status)
    rows = q.order_by(MesCcpLog.log_date.desc(), MesCcpLog.id.desc()).all()
    procs = svc.process_map(db)
    eqs = svc.equipment_map(db)
    out = []
    for l in rows:
        _, pass_n, fail_n = _ccp_run_counts(db, l.log_date, l.process_id, l.equipment_id)
        out.append(svc.ser_ccp_log(l, procs.get(l.process_id).name if l.process_id in procs else None,
                                   eqs.get(l.equipment_id).name if l.equipment_id in eqs else None,
                                   pass_n + fail_n, fail_n))
    return {"items": out}


class CcpGenerateIn(BaseModel):
    date: str


@router.post("/ccp-logs/generate")
def generate_ccp_logs(body: CcpGenerateIn, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    d = _pdate(body.date, "date")
    if not d:
        raise HTTPException(400, "date 형식 오류")
    procs = svc.process_map(db)
    ccp_pids = [pid for pid, p in procs.items() if p.is_ccp]
    runs = db.query(MesProcessRun).filter(MesProcessRun.run_date == d,
                                          MesProcessRun.status != "deleted",
                                          MesProcessRun.process_id.in_(ccp_pids)).all()
    groups: dict[tuple[int, Optional[int]], list[MesProcessRun]] = defaultdict(list)
    for r in runs:
        groups[(r.process_id, r.equipment_id)].append(r)

    eqs = svc.equipment_map(db)
    workers = svc.worker_map(db)
    created = updated = 0
    for (pid, eid), grs in groups.items():
        existing = db.query(MesCcpLog).filter(MesCcpLog.log_date == d, MesCcpLog.process_id == pid,
                                              MesCcpLog.equipment_id == eid).first()
        if existing and existing.status == "approved":
            continue
        pass_n = sum(1 for r in grs if r.judgment == "적")
        fail_n = sum(1 for r in grs if r.judgment == "부")
        family_codes = sorted({r.family_code for r in grs if r.family_code})
        limits = db.query(MesCcpLimit).filter(
            MesCcpLimit.process_id == pid, MesCcpLimit.is_active.is_(True),
            (MesCcpLimit.family_code.in_(family_codes)) | (MesCcpLimit.family_code.is_(None))
        ).all()
        summary = {
            "runs": [svc.ser_run(r, procs.get(pid).name, eqs.get(eid).name if eid in eqs else None,
                                 workers.get(r.worker_id).name if r.worker_id in workers else None)
                    for r in grs],
            "total": len(grs), "pass": pass_n, "fail": fail_n,
            "pass_rate": round(pass_n / len(grs), 4) if grs else 0.0,
            "limits": [svc.ser_limit(l) for l in limits],
        }
        if existing:
            existing.summary_json = svc.jdumps(summary)
            updated += 1
        else:
            db.add(MesCcpLog(log_date=d, process_id=pid, equipment_id=eid, status="draft",
                             author=_uemail(user), summary_json=svc.jdumps(summary)))
            created += 1
    # 실행이 모두 삭제돼 0건이 된 초안(draft) 로그는 정리
    removed = 0
    for stale in db.query(MesCcpLog).filter(MesCcpLog.log_date == d, MesCcpLog.status == "draft").all():
        if (stale.process_id, stale.equipment_id) not in groups:
            db.delete(stale)
            removed += 1
    db.commit()
    return {"created": created, "updated": updated, "removed": removed}


@router.get("/ccp-logs/{lid}")
def get_ccp_log(lid: int, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    l = db.get(MesCcpLog, lid)
    if not l:
        raise HTTPException(404, "CCP 일지 없음")
    procs = svc.process_map(db)
    eqs = svc.equipment_map(db)
    workers = svc.worker_map(db)
    runs, pass_n, fail_n = _ccp_run_counts(db, l.log_date, l.process_id, l.equipment_id)
    limits = db.query(MesCcpLimit).filter(MesCcpLimit.process_id == l.process_id,
                                          MesCcpLimit.is_active.is_(True)).all()
    return {
        "log": svc.ser_ccp_log(l, procs.get(l.process_id).name if l.process_id in procs else None,
                               eqs.get(l.equipment_id).name if l.equipment_id in eqs else None,
                               pass_n + fail_n, fail_n),
        "runs": [svc.ser_run(r, procs.get(r.process_id).name if r.process_id in procs else None,
                             eqs.get(r.equipment_id).name if r.equipment_id in eqs else None,
                             workers.get(r.worker_id).name if r.worker_id in workers else None)
                for r in runs],
        "limits": [svc.ser_limit(x) for x in limits],
    }


class RejectIn(BaseModel):
    reason: Optional[str] = None


@router.post("/ccp-logs/{lid}/submit")
def submit_ccp_log(lid: int, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    l = db.get(MesCcpLog, lid)
    if not l:
        raise HTTPException(404, "CCP 일지 없음")
    l.status = "submitted"
    l.author = l.author or _uemail(user)
    l.submitted_at = datetime.now()
    db.commit()
    return {"ok": True, "status": l.status}


@router.post("/ccp-logs/{lid}/approve")
def approve_ccp_log(lid: int, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    l = db.get(MesCcpLog, lid)
    if not l:
        raise HTTPException(404, "CCP 일지 없음")
    l.status = "approved"
    l.approver = _uemail(user)
    l.approved_at = datetime.now()
    db.commit()
    return {"ok": True, "status": l.status}


@router.post("/ccp-logs/{lid}/reject")
def reject_ccp_log(lid: int, body: RejectIn, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    l = db.get(MesCcpLog, lid)
    if not l:
        raise HTTPException(404, "CCP 일지 없음")
    l.status = "rejected"
    l.reject_reason = body.reason
    db.commit()
    return {"ok": True, "status": l.status}


class CcpNotesIn(BaseModel):
    notes: Optional[str] = None


@router.put("/ccp-logs/{lid}")
def update_ccp_log(lid: int, body: CcpNotesIn, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    l = db.get(MesCcpLog, lid)
    if not l:
        raise HTTPException(404, "CCP 일지 없음")
    l.notes = body.notes
    db.commit()
    return {"ok": True}


# ══════════════════════════════════════════════
# 선행점검일지
# ══════════════════════════════════════════════

@router.get("/checklists")
def list_checklists(start: Optional[str] = None, end: Optional[str] = None,
                    template_id: Optional[int] = None, status: Optional[str] = None,
                    db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    q = db.query(MesChecklistEntry)
    if start:
        q = q.filter(MesChecklistEntry.check_date >= _pdate(start, "start"))
    if end:
        q = q.filter(MesChecklistEntry.check_date <= _pdate(end, "end"))
    if template_id is not None:
        q = q.filter(MesChecklistEntry.template_id == template_id)
    if status:
        q = q.filter(MesChecklistEntry.status == status)
    rows = q.order_by(MesChecklistEntry.check_date.desc(), MesChecklistEntry.id.desc()).all()
    templates = {t.id: t for t in db.query(MesChecklistTemplate).all()}
    out = []
    for e in rows:
        t = templates.get(e.template_id)
        out.append(svc.ser_entry(e, t.code if t else None, t.name if t else None,
                                 t.cycle if t else None, t.category if t else None))
    return {"items": out}


@router.get("/checklists/calendar")
def checklists_calendar(month: str, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    try:
        return svc.checklist_calendar(db, month)
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.get("/checklists/today")
def checklists_today(db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    return svc.checklists_today(db)


class ChecklistIn(BaseModel):
    id: Optional[int] = None
    template_id: int
    check_date: str
    shift: Optional[str] = "-"
    results_json: dict = {}
    remarks: Optional[str] = None


@router.post("/checklists")
def upsert_checklist(body: ChecklistIn, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    cd = _pdate(body.check_date, "check_date")
    row = db.get(MesChecklistEntry, body.id) if body.id else None
    if body.id and not row:
        raise HTTPException(404, "점검일지 없음")
    if not row:
        row = MesChecklistEntry(template_id=body.template_id, check_date=cd, shift=body.shift or "-",
                                author=_uemail(user), status="draft")
        db.add(row)
    row.results_json = svc.jdumps(body.results_json or {})
    row.remarks = body.remarks
    row.deviation_count = svc.count_deviation(body.results_json or {})
    try:
        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(400, f"저장 실패(동일 템플릿·날짜·시프트 중복 가능): {e}")
    db.refresh(row)
    t = db.get(MesChecklistTemplate, row.template_id)
    return svc.ser_entry(row, t.code if t else None, t.name if t else None,
                         t.cycle if t else None, t.category if t else None)


@router.get("/checklists/{eid}")
def get_checklist(eid: int, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    e = db.get(MesChecklistEntry, eid)
    if not e:
        raise HTTPException(404, "점검일지 없음")
    t = db.get(MesChecklistTemplate, e.template_id)
    return {"entry": svc.ser_entry(e, t.code if t else None, t.name if t else None,
                                   t.cycle if t else None, t.category if t else None),
            "template": svc.ser_template(t) if t else None}


@router.post("/checklists/{eid}/submit")
def submit_checklist(eid: int, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    e = db.get(MesChecklistEntry, eid)
    if not e:
        raise HTTPException(404, "점검일지 없음")
    e.status = "submitted"
    e.submitted_at = datetime.now()
    db.commit()
    return {"ok": True, "status": e.status}


@router.post("/checklists/{eid}/review")
def review_checklist(eid: int, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    e = db.get(MesChecklistEntry, eid)
    if not e:
        raise HTTPException(404, "점검일지 없음")
    e.status = "reviewed"
    e.reviewer = _uemail(user)
    db.commit()
    return {"ok": True, "status": e.status}


@router.post("/checklists/{eid}/approve")
def approve_checklist(eid: int, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    e = db.get(MesChecklistEntry, eid)
    if not e:
        raise HTTPException(404, "점검일지 없음")
    e.status = "approved"
    e.approver = _uemail(user)
    e.approved_at = datetime.now()
    db.commit()
    return {"ok": True, "status": e.status}


@router.post("/checklists/{eid}/reject")
def reject_checklist(eid: int, body: RejectIn, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    e = db.get(MesChecklistEntry, eid)
    if not e:
        raise HTTPException(404, "점검일지 없음")
    e.status = "rejected"
    e.reject_reason = body.reason
    db.commit()
    return {"ok": True, "status": e.status}


@router.delete("/checklists/{eid}")
def delete_checklist(eid: int, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    e = db.get(MesChecklistEntry, eid)
    if not e:
        raise HTTPException(404, "점검일지 없음")
    if e.status != "draft":
        raise HTTPException(400, "임시저장 상태만 삭제 가능합니다")
    db.delete(e)
    db.commit()
    return {"ok": True}


# ══════════════════════════════════════════════
# 설비
# ══════════════════════════════════════════════

class EquipmentEventIn(BaseModel):
    id: Optional[int] = None
    equipment_id: int
    event_type: str
    event_date: str
    description: Optional[str] = None
    part_name: Optional[str] = None
    cost: Optional[float] = None
    done_by: Optional[str] = None
    downtime_minutes: Optional[float] = None
    status: Optional[str] = "open"


@router.get("/equipment-events")
def list_equipment_events(equipment_id: Optional[int] = None, start: Optional[str] = None,
                          end: Optional[str] = None, db: Session = Depends(get_db),
                          user: dict = Depends(get_current_user)):
    q = db.query(MesEquipmentEvent)
    if equipment_id is not None:
        q = q.filter(MesEquipmentEvent.equipment_id == equipment_id)
    if start:
        q = q.filter(MesEquipmentEvent.event_date >= _pdate(start, "start"))
    if end:
        q = q.filter(MesEquipmentEvent.event_date <= _pdate(end, "end"))
    rows = q.order_by(MesEquipmentEvent.event_date.desc(), MesEquipmentEvent.id.desc()).all()
    eqs = svc.equipment_map(db)
    return {"items": [svc.ser_event(e, eqs.get(e.equipment_id).name if e.equipment_id in eqs else None)
                      for e in rows]}


@router.post("/equipment-events")
def upsert_equipment_event(body: EquipmentEventIn, db: Session = Depends(get_db),
                           user: dict = Depends(get_current_user)):
    row = db.get(MesEquipmentEvent, body.id) if body.id else None
    if body.id and not row:
        raise HTTPException(404, "설비이력 없음")
    if not row:
        row = MesEquipmentEvent()
        db.add(row)
    row.equipment_id = body.equipment_id
    row.event_type = body.event_type
    row.event_date = _pdate(body.event_date, "event_date")
    row.description = body.description
    row.part_name = body.part_name
    row.cost = body.cost
    row.done_by = body.done_by
    row.downtime_minutes = body.downtime_minutes
    row.status = body.status or "open"
    db.commit()
    db.refresh(row)
    eqs = svc.equipment_map(db)
    return svc.ser_event(row, eqs.get(row.equipment_id).name if row.equipment_id in eqs else None)


@router.post("/equipment-events/{eid}/close")
def close_equipment_event(eid: int, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    e = db.get(MesEquipmentEvent, eid)
    if not e:
        raise HTTPException(404, "설비이력 없음")
    e.status = "closed"
    db.commit()
    return {"ok": True, "status": e.status}


@router.delete("/equipment-events/{eid}")
def delete_equipment_event(eid: int, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    n = db.query(MesEquipmentEvent).filter(MesEquipmentEvent.id == eid).delete()
    db.commit()
    return {"ok": True, "deleted": n}


@router.get("/equipment/status")
def equipment_status(date: Optional[str] = None, db: Session = Depends(get_db),
                     user: dict = Depends(get_current_user)):
    d = _pdate(date, "date") or datetime.now().date()
    equipment = db.query(MesEquipment).order_by(MesEquipment.sort_order, MesEquipment.id).all()
    eq_ids = [e.id for e in equipment]
    procs = svc.process_map(db)

    running_run: dict[int, MesProcessRun] = {}
    for r in db.query(MesProcessRun).filter(MesProcessRun.equipment_id.in_(eq_ids),
                                             MesProcessRun.status == "running").all():
        running_run[r.equipment_id] = r

    in_progress_order: dict[int, MesWorkOrder] = {}
    for o in db.query(MesWorkOrder).filter(MesWorkOrder.equipment_id.in_(eq_ids),
                                           MesWorkOrder.status == "in_progress").all():
        in_progress_order[o.equipment_id] = o

    open_events: dict[int, int] = defaultdict(int)
    down_flag: dict[int, bool] = defaultdict(bool)
    for ev in db.query(MesEquipmentEvent).filter(MesEquipmentEvent.equipment_id.in_(eq_ids),
                                                  MesEquipmentEvent.status == "open").all():
        open_events[ev.equipment_id] += 1
        if ev.event_type in ("고장", "수리"):
            down_flag[ev.equipment_id] = True

    for dt_ in db.query(MesDowntime).filter(MesDowntime.equipment_id.in_(eq_ids),
                                            MesDowntime.end_at.is_(None)).all():
        down_flag[dt_.equipment_id] = True

    today_total: dict[int, int] = defaultdict(int)
    today_fail: dict[int, int] = defaultdict(int)
    for r in db.query(MesProcessRun).filter(MesProcessRun.equipment_id.in_(eq_ids),
                                            MesProcessRun.run_date == d,
                                            MesProcessRun.status != "deleted").all():
        today_total[r.equipment_id] += 1
        if r.judgment == "부":
            today_fail[r.equipment_id] += 1

    last_temp: dict[int, MesSensorReading] = {}
    for s in db.query(MesSensorReading).filter(MesSensorReading.equipment_id.in_(eq_ids),
                                                MesSensorReading.kind == "temp").order_by(
                                                MesSensorReading.ts.desc()).all():
        if s.equipment_id not in last_temp:
            last_temp[s.equipment_id] = s

    out = []
    for e in equipment:
        run = running_run.get(e.id)
        order = in_progress_order.get(e.id)
        if run or order:
            state = "running"
        elif down_flag.get(e.id):
            state = "down"
        elif not e.is_active:
            state = "off"
        else:
            state = "idle"
        st = last_temp.get(e.id)
        out.append({
            "equipment": svc.ser_equipment(e, procs.get(e.process_id).name if e.process_id in procs else None),
            "state": state,
            "current_run": svc.ser_run(run, procs.get(run.process_id).name if run and run.process_id in procs else None) if run else None,
            "current_order": {"id": order.id, "wo_no": order.wo_no, "item_name": order.item_name} if order else None,
            "last_temp": {"value": st.value, "ts": svc.iso(st.ts)} if st else None,
            "today_runs": today_total.get(e.id, 0), "today_fail": today_fail.get(e.id, 0),
            "open_events": open_events.get(e.id, 0),
        })
    return {"items": out}


# ══════════════════════════════════════════════
# 모니터링·센서
# ══════════════════════════════════════════════

def _temp_state(value: Optional[float], is_min_type: bool, boundary: float) -> str:
    if value is None:
        return "off"
    if is_min_type:
        if value < boundary:
            return "danger"
        return "warn" if value <= boundary + 5 else "normal"
    if value > boundary:
        return "danger"
    return "warn" if value >= boundary - 5 else "normal"


@router.get("/monitoring")
def monitoring_board(floor: str, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    equipment = db.query(MesEquipment).filter(MesEquipment.floor == floor,
                                              MesEquipment.is_active.is_(True)).order_by(
                                              MesEquipment.eq_type, MesEquipment.sort_order).all()
    eq_ids = [e.id for e in equipment]
    procs = svc.process_map(db)

    last_reading: dict[int, MesSensorReading] = {}
    for s in db.query(MesSensorReading).filter(MesSensorReading.equipment_id.in_(eq_ids)).order_by(
            MesSensorReading.ts.desc()).all():
        last_reading.setdefault(s.equipment_id, s)

    running_run: dict[int, MesProcessRun] = {}
    for r in db.query(MesProcessRun).filter(MesProcessRun.equipment_id.in_(eq_ids),
                                             MesProcessRun.status == "running").all():
        running_run[r.equipment_id] = r

    today = date.today()
    metal_counts: dict[int, dict[str, int]] = defaultdict(lambda: {"pass": 0, "detect": 0, "test": 0})
    for r in db.query(MesProcessRun).filter(MesProcessRun.equipment_id.in_(eq_ids),
                                            MesProcessRun.run_date == today,
                                            MesProcessRun.test_result.isnot(None)).all():
        if r.test_result in ("pass", "detect", "test"):
            metal_counts[r.equipment_id][r.test_result] += 1

    oven_types = ("로터리오븐", "터널오븐", "데크오븐")
    ovens = [e for e in equipment if e.eq_type in oven_types]
    metals = [e for e in equipment if e.eq_type == "금속검출기"]
    others = [e for e in equipment if e.eq_type not in oven_types and e.eq_type != "금속검출기"]

    def oven_tile(e: MesEquipment) -> dict:
        reading = last_reading.get(e.id)
        run = running_run.get(e.id)
        process = procs.get(e.process_id) if e.process_id else None
        limit_row = svc.find_limit(db, e.process_id, run.family_code if run else None, procs.get(e.process_id).pop_kind if e.process_id in procs else None) if e.process_id else None
        if process and process.pop_kind == "freezing":
            boundary = (limit_row.max_value if limit_row else None) or svc.DEFAULT_FREEZING_MAX
            is_min = False
        else:
            boundary = (limit_row.min_value if limit_row else None) or svc.DEFAULT_HEATING_MIN
            is_min = True
        value = reading.value if reading else None
        return {
            "equipment_id": e.id, "name": e.name, "kind": "temp", "value": value, "unit": "℃",
            "updated_at": svc.iso(reading.ts) if reading else None,
            "state": _temp_state(value, is_min, boundary),
            "limit_min": limit_row.min_value if limit_row else None,
            "limit_max": limit_row.max_value if limit_row else None,
            "running_item": run.item_name if run else None,
        }

    def metal_tile(e: MesEquipment) -> dict:
        c = metal_counts.get(e.id, {"pass": 0, "detect": 0, "test": 0})
        state = "danger" if c["detect"] > 0 else ("normal" if (c["pass"] + c["test"]) > 0 else "off")
        run = running_run.get(e.id)
        return {
            "equipment_id": e.id, "name": e.name, "kind": "metal", "value": None, "unit": None,
            "updated_at": None, "state": state, "limit_min": None, "limit_max": None,
            "running_item": run.item_name if run else None, "counts": c,
        }

    def other_tile(e: MesEquipment) -> dict:
        reading = last_reading.get(e.id)
        value = reading.value if reading else None
        return {
            "equipment_id": e.id, "name": e.name, "kind": "temp", "value": value, "unit": "℃",
            "updated_at": svc.iso(reading.ts) if reading else None,
            "state": "off" if value is None else "normal",
            "limit_min": None, "limit_max": None, "running_item": None,
        }

    groups = []
    if ovens:
        groups.append({"title": f"CCP-{floor} 오븐", "tiles": [oven_tile(e) for e in ovens]})
    if metals:
        groups.append({"title": f"{floor} 금속검출", "tiles": [metal_tile(e) for e in metals]})
    if others:
        groups.append({"title": "창고·냉각실", "tiles": [other_tile(e) for e in others]})

    return {"floor": floor, "groups": groups, "updated_at": svc.iso(datetime.now())}


class SensorReadingIn(BaseModel):
    equipment_code: Optional[str] = None
    equipment_id: Optional[int] = None
    kind: str
    value: float
    ts: Optional[str] = None


class SensorIngestIn(BaseModel):
    readings: list[SensorReadingIn]


@router.post("/sensors/ingest")
def sensors_ingest(body: SensorIngestIn, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    by_code = {e.code: e.id for e in db.query(MesEquipment).all()}
    n = 0
    for rd in body.readings:
        eid = rd.equipment_id or by_code.get(rd.equipment_code or "")
        if not eid:
            continue
        ts = _parse_dt(rd.ts) or datetime.now()
        db.add(MesSensorReading(equipment_id=eid, ts=ts, kind=rd.kind, value=rd.value, source="iot"))
        n += 1
    db.commit()
    return {"inserted": n}


@router.get("/sensors")
def list_sensors(equipment_id: Optional[int] = None, start: Optional[str] = None, end: Optional[str] = None,
                 kind: Optional[str] = None, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    q = db.query(MesSensorReading)
    if equipment_id is not None:
        q = q.filter(MesSensorReading.equipment_id == equipment_id)
    if start:
        q = q.filter(MesSensorReading.ts >= datetime.combine(_pdate(start, "start"), datetime.min.time()))
    if end:
        q = q.filter(MesSensorReading.ts <= datetime.combine(_pdate(end, "end"), datetime.max.time()))
    if kind:
        q = q.filter(MesSensorReading.kind == kind)
    rows = q.order_by(MesSensorReading.ts.desc()).limit(2000).all()
    return {"items": [svc.ser_reading(r) for r in rows]}


# ══════════════════════════════════════════════
# 생산일보·OEE
# ══════════════════════════════════════════════

@router.get("/production/daily")
def production_daily(start: Optional[str] = None, end: Optional[str] = None, process_id: Optional[int] = None,
                     equipment_id: Optional[int] = None, family_code: Optional[str] = None,
                     db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    q = db.query(MesWorkOrder)
    if start:
        q = q.filter(MesWorkOrder.order_date >= _pdate(start, "start"))
    if end:
        q = q.filter(MesWorkOrder.order_date <= _pdate(end, "end"))
    if process_id is not None:
        q = q.filter(MesWorkOrder.process_id == process_id)
    if equipment_id is not None:
        q = q.filter(MesWorkOrder.equipment_id == equipment_id)
    if family_code:
        q = q.filter(MesWorkOrder.family_code == family_code)
    orders = q.order_by(MesWorkOrder.order_date.desc()).all()
    metrics = svc.order_metrics(db, [o.id for o in orders])
    procs = svc.process_map(db)
    eqs = svc.equipment_map(db)
    workers = _order_workers(db, [o.id for o in orders])

    rows = []
    sums = defaultdict(float)
    for o in orders:
        m = metrics.get(o.id, {})
        oee = svc.compute_oee_row(o, m)
        rows.append({
            "date": svc.dstr(o.order_date), "wo_no": o.wo_no, "item_name": o.item_name,
            "process_name": procs.get(o.process_id).name if o.process_id in procs else None,
            "equipment_name": eqs.get(o.equipment_id).name if o.equipment_id in eqs else None,
            **oee, "workers": [w["name"] for w in workers.get(o.id, [])],
        })
        for k in ("plan_qty", "prod_qty", "good_qty", "defect_qty", "load_minutes",
                  "downtime_minutes", "run_minutes"):
            sums[k] += oee[k]

    load = sums["load_minutes"]
    prod = sums["prod_qty"]
    plan = sums["plan_qty"]
    good = sums["good_qty"]
    availability = (sums["run_minutes"] / load) if load > 0 else 0.0
    performance = min(1.0, prod / plan) if plan > 0 else 1.0
    quality = (good / prod) if prod > 0 else 0.0
    totals = {
        "plan_qty": plan, "prod_qty": prod, "good_qty": good, "defect_qty": sums["defect_qty"],
        "defect_rate": round(sums["defect_qty"] / prod, 4) if prod > 0 else 0.0,
        "achievement_rate": round(prod / plan, 4) if plan > 0 else 0.0,
        "load_minutes": round(load, 1), "downtime_minutes": round(sums["downtime_minutes"], 1),
        "run_minutes": round(sums["run_minutes"], 1), "availability": round(availability, 4),
        "performance": round(performance, 4), "quality": round(quality, 4),
        "oee": round(availability * performance * quality, 4),
    }
    return {"rows": rows, "totals": totals}


def _bucket_key(d: date, granularity: str) -> str:
    if granularity == "week":
        wk_start, _ = svc.week_bounds(d)
        return wk_start.isoformat()
    if granularity == "month":
        return f"{d.year:04d}-{d.month:02d}"
    return d.isoformat()


@router.get("/production/trend")
def production_trend(start: str, end: str, granularity: str = "day", family_code: Optional[str] = None,
                     db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    s, e = _pdate(start, "start"), _pdate(end, "end")
    if not s or not e:
        raise HTTPException(400, "start/end 형식 오류")
    gran = granularity if granularity in ("day", "week", "month") else "day"
    q = db.query(MesWorkOrder).filter(MesWorkOrder.order_date >= s, MesWorkOrder.order_date <= e)
    if family_code:
        q = q.filter(MesWorkOrder.family_code == family_code)
    orders = q.all()
    metrics = svc.order_metrics(db, [o.id for o in orders])
    buckets: dict[str, dict] = defaultdict(lambda: defaultdict(float))
    counts: dict[str, int] = defaultdict(int)
    for o in orders:
        key = _bucket_key(o.order_date, gran)
        m = metrics.get(o.id, {})
        oee = svc.compute_oee_row(o, m)
        counts[key] += 1
        for k in ("plan_qty", "prod_qty", "good_qty", "defect_qty", "load_minutes",
                  "downtime_minutes", "run_minutes"):
            buckets[key][k] += oee[k]
    series = []
    for key in sorted(buckets.keys()):
        b = buckets[key]
        avail = (b["run_minutes"] / b["load_minutes"]) if b["load_minutes"] > 0 else 0.0
        perf = min(1.0, b["prod_qty"] / b["plan_qty"]) if b["plan_qty"] > 0 else 1.0
        qual = (b["good_qty"] / b["prod_qty"]) if b["prod_qty"] > 0 else 0.0
        series.append({
            "period": key, "plan_qty": b["plan_qty"], "prod_qty": b["prod_qty"], "good_qty": b["good_qty"],
            "defect_qty": b["defect_qty"], "oee": round(avail * perf * qual, 4),
            "downtime_minutes": round(b["downtime_minutes"], 1), "wo_count": counts[key],
        })
    return {"series": series}


@router.get("/production/pareto")
def production_pareto(start: str, end: str, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    s, e = _pdate(start, "start"), _pdate(end, "end")
    if not s or not e:
        raise HTTPException(400, "start/end 형식 오류")
    order_ids = [oid for (oid,) in db.query(MesWorkOrder.id).filter(
        MesWorkOrder.order_date >= s, MesWorkOrder.order_date <= e).all()]
    defect_names = svc.code_name_map(db, "DEFECT")
    downtime_names = svc.code_name_map(db, "DOWNTIME")

    defect_sum: dict[str, float] = defaultdict(float)
    if order_ids:
        for code, qty in db.query(MesDefect.defect_code, MesDefect.qty).filter(
                MesDefect.work_order_id.in_(order_ids)).all():
            defect_sum[code or "ETC"] += float(qty or 0)
    d_total = sum(defect_sum.values()) or 1.0
    d_sorted = sorted(defect_sum.items(), key=lambda x: -x[1])
    defects, cum = [], 0.0
    for code, qty in d_sorted:
        cum += qty
        defects.append({"code": code, "name": defect_names.get(code, code), "qty": round(qty, 1),
                        "pct": round(qty / d_total, 4), "cum_pct": round(cum / d_total, 4)})

    downtime_sum: dict[str, float] = defaultdict(float)
    for code, minutes in db.query(MesDowntime.downtime_code, MesDowntime.minutes).filter(
            MesDowntime.start_at >= datetime.combine(s, datetime.min.time()),
            MesDowntime.start_at <= datetime.combine(e, datetime.max.time())).all():
        downtime_sum[code or "ETC"] += float(minutes or 0)
    t_total = sum(downtime_sum.values()) or 1.0
    t_sorted = sorted(downtime_sum.items(), key=lambda x: -x[1])
    downtimes, cum2 = [], 0.0
    for code, minutes in t_sorted:
        cum2 += minutes
        downtimes.append({"code": code, "name": downtime_names.get(code, code), "minutes": round(minutes, 1),
                          "pct": round(minutes / t_total, 4), "cum_pct": round(cum2 / t_total, 4)})

    return {"defects": defects, "downtimes": downtimes}


@router.get("/dashboard")
def dashboard(date: Optional[str] = None, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    d = _pdate(date, "date") or datetime.now().date()
    orders = db.query(MesWorkOrder).filter(MesWorkOrder.order_date == d).all()
    metrics = svc.order_metrics(db, [o.id for o in orders])
    status_counts = defaultdict(int)
    plan_sum = good_sum = 0.0
    for o in orders:
        status_counts[o.status] += 1
        plan_sum += o.plan_qty or 0
        good_sum += metrics.get(o.id, {}).get("good_qty", 0.0)

    runs = db.query(MesProcessRun).filter(MesProcessRun.run_date == d, MesProcessRun.status != "deleted").all()
    procs = svc.process_map(db)
    pass_n = sum(1 for r in runs if r.judgment == "적")
    fail_n = sum(1 for r in runs if r.judgment == "부")
    by_proc_run: dict[int, dict] = {}
    for r in runs:
        e = by_proc_run.setdefault(r.process_id, {"process_id": r.process_id,
                                   "name": procs.get(r.process_id).name if r.process_id in procs else None,
                                   "total": 0, "pass": 0, "fail": 0})
        e["total"] += 1
        e["pass"] += 1 if r.judgment == "적" else 0
        e["fail"] += 1 if r.judgment == "부" else 0

    deviations_open = db.query(MesDeviation).filter(MesDeviation.status == "open").count()

    today_checklists = svc.checklists_today(db)
    due = len(today_checklists["items"])
    done = sum(1 for it in today_checklists["items"] if it["status"] not in ("missing",))
    checklist_rate = round(done / due, 4) if due else 1.0

    ccp_logs = db.query(MesCcpLog).filter(MesCcpLog.log_date == d).all()
    ccp_draft = sum(1 for l in ccp_logs if l.status == "draft")
    ccp_submitted = sum(1 for l in ccp_logs if l.status == "submitted")
    ccp_approved = sum(1 for l in ccp_logs if l.status == "approved")

    equipment = db.query(MesEquipment).filter(MesEquipment.is_active.is_(True)).all()
    eq_ids = [e.id for e in equipment]
    running_eq = {r.equipment_id for r in db.query(MesProcessRun).filter(
        MesProcessRun.equipment_id.in_(eq_ids), MesProcessRun.status == "running").all()}
    running_eq |= {o.equipment_id for o in db.query(MesWorkOrder).filter(
        MesWorkOrder.equipment_id.in_(eq_ids), MesWorkOrder.status == "in_progress").all()}
    down_eq = {ev.equipment_id for ev in db.query(MesEquipmentEvent).filter(
        MesEquipmentEvent.equipment_id.in_(eq_ids), MesEquipmentEvent.status == "open",
        MesEquipmentEvent.event_type.in_(["고장", "수리"])).all()}
    down_eq |= {dt_.equipment_id for dt_ in db.query(MesDowntime).filter(
        MesDowntime.equipment_id.in_(eq_ids), MesDowntime.end_at.is_(None)).all()}
    running_cnt = len(running_eq)
    down_cnt = len(down_eq - running_eq)
    idle_cnt = max(len(eq_ids) - running_cnt - down_cnt, 0)

    open_downtimes = db.query(MesDowntime).filter(MesDowntime.end_at.is_(None)).count()
    soon = d + timedelta(days=30)
    expiring_workers = db.query(MesWorker).filter(
        MesWorker.health_cert_next.isnot(None), MesWorker.health_cert_next >= d,
        MesWorker.health_cert_next <= soon, MesWorker.is_active.is_(True)).count()

    alerts = []
    if deviations_open:
        alerts.append({"level": "danger", "text": f"미조치 이탈 {deviations_open}건",
                       "href": "/mes/haccp/deviations"})
    missing_checklists = due - done
    if missing_checklists > 0:
        alerts.append({"level": "warn", "text": f"오늘 선행점검 미작성 {missing_checklists}건",
                       "href": "/mes/haccp/checklists"})
    if ccp_submitted:
        alerts.append({"level": "warn", "text": f"상신 대기 CCP 일지 {ccp_submitted}건",
                       "href": "/mes/haccp/ccp"})
    if open_downtimes:
        alerts.append({"level": "warn", "text": f"진행중인 비가동 {open_downtimes}건",
                       "href": "/mes/work-orders"})
    if expiring_workers:
        alerts.append({"level": "warn", "text": f"보건증 만료 30일 이내 작업자 {expiring_workers}명",
                       "href": "/mes/master"})

    return {
        "date": svc.dstr(d),
        "orders": {
            "total": len(orders), "planned": status_counts.get("planned", 0),
            "in_progress": status_counts.get("in_progress", 0), "done": status_counts.get("done", 0),
            "cancelled": status_counts.get("cancelled", 0), "plan_qty": plan_sum, "good_qty": good_sum,
            "achievement": round(good_sum / plan_sum, 4) if plan_sum else 0.0,
        },
        "runs": {
            "total": len(runs), "pass": pass_n, "fail": fail_n,
            "pass_rate": round(pass_n / (pass_n + fail_n), 4) if (pass_n + fail_n) else 0.0,
            "by_process": list(by_proc_run.values()),
        },
        "deviations_open": deviations_open,
        "checklists": {"due": due, "done": done, "rate": checklist_rate},
        "ccp_logs": {"draft": ccp_draft, "submitted": ccp_submitted, "approved": ccp_approved},
        "equipment": {"running": running_cnt, "idle": idle_cnt, "down": down_cnt},
        "alerts": alerts,
    }
