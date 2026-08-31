"""MES(생산현장관리) 서비스 로직 — 직렬화·채번·판정·집계.

설계 계약서: docs/MES_DESIGN.md §3(시드), §4(API 계약)
"""
from __future__ import annotations

import calendar
import json
from datetime import date, datetime, timedelta
from typing import Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db_models import ScmProduct, ScmRawMaterial, ScmSubMaterial, ScmBomLine
from app.models.mes import (
    MesProcess, MesEquipment, MesWorker, MesCode, MesCcpLimit,
    MesProductionPlan, MesWorkOrder, MesWorkOrderWorker, MesWorkResult,
    MesDefect, MesDowntime, MesMaterialIssue, MesProcessRun, MesDeviation,
    MesCcpLog, MesChecklistTemplate, MesChecklistEntry, MesEquipmentEvent,
    MesSensorReading,
)


# ──────────────────────────────────────────────
# 공용 헬퍼
# ──────────────────────────────────────────────

def iso(dt) -> Optional[str]:
    return dt.isoformat() if dt else None


def dstr(d) -> Optional[str]:
    return d.isoformat()[:10] if d else None


def jloads(s, default=None):
    if not s:
        return default if default is not None else {}
    try:
        return json.loads(s)
    except Exception:
        return default if default is not None else {}


def jdumps(obj) -> str:
    return json.dumps(obj, ensure_ascii=False)


def parse_date(s: Optional[str]) -> Optional[date]:
    """안전한 날짜 파싱. 실패 시 None(라우트에서 400 처리)."""
    if not s:
        return None
    try:
        return date.fromisoformat(str(s).strip()[:10])
    except Exception:
        return None


def month_range(month: str) -> tuple[Optional[date], Optional[date]]:
    """'YYYY-MM' → (해당월 1일, 말일)."""
    try:
        y, m = [int(x) for x in month.strip().split("-")[:2]]
        first = date(y, m, 1)
        last = date(y, m, calendar.monthrange(y, m)[1])
        return first, last
    except Exception:
        return None, None


def week_bounds(d: date) -> tuple[date, date]:
    """d가 속한 주(월~일)의 시작/끝."""
    start = d - timedelta(days=d.weekday())
    return start, start + timedelta(days=6)


def round1(v) -> Optional[float]:
    if v is None:
        return None
    try:
        return round(float(v), 1)
    except Exception:
        return None


# ──────────────────────────────────────────────
# 마스터 직렬화
# ──────────────────────────────────────────────

def ser_process(p: MesProcess) -> dict:
    return {
        "id": p.id, "code": p.code, "name": p.name, "process_class": p.process_class,
        "floor": p.floor, "is_ccp": bool(p.is_ccp), "ccp_code": p.ccp_code,
        "pop_kind": p.pop_kind, "sub_kind": p.sub_kind, "sort_order": p.sort_order,
        "is_active": bool(p.is_active), "notes": p.notes,
    }


def ser_equipment(e: MesEquipment, process_name: Optional[str] = None) -> dict:
    return {
        "id": e.id, "code": e.code, "name": e.name, "process_id": e.process_id,
        "process_name": process_name, "floor": e.floor, "unit_label": e.unit_label,
        "eq_type": e.eq_type, "maker": e.maker, "model": e.model, "spec": e.spec,
        "purchase_date": dstr(e.purchase_date), "purchase_amount": e.purchase_amount,
        "plc_yn": bool(e.plc_yn), "is_active": bool(e.is_active), "sort_order": e.sort_order,
        "notes": e.notes,
    }


def ser_worker(w: MesWorker) -> dict:
    return {
        "id": w.id, "name": w.name, "department": w.department, "default_floor": w.default_floor,
        "phone": w.phone, "is_active": bool(w.is_active), "sort_order": w.sort_order,
        "health_cert_date": dstr(w.health_cert_date), "health_cert_next": dstr(w.health_cert_next),
        "notes": w.notes,
    }


def ser_code(c: MesCode) -> dict:
    return {
        "id": c.id, "group_code": c.group_code, "code": c.code, "name": c.name,
        "sort_order": c.sort_order, "is_active": bool(c.is_active),
        "extra": jloads(c.extra, {}), "notes": c.notes,
    }


def ser_limit(l: MesCcpLimit, process_name: Optional[str] = None) -> dict:
    return {
        "id": l.id, "process_id": l.process_id, "process_name": process_name,
        "family_code": l.family_code, "name": l.name, "param": l.param,
        "min_value": l.min_value, "max_value": l.max_value, "unit": l.unit,
        "check_cycle": l.check_cycle, "check_method": l.check_method,
        "corrective_action": l.corrective_action, "alarm_yn": bool(l.alarm_yn),
        "is_active": bool(l.is_active), "notes": l.notes,
    }


def ser_plan(p: MesProductionPlan) -> dict:
    return {
        "id": p.id, "plan_date": dstr(p.plan_date), "item_id": p.item_id,
        "item_name": p.item_name, "family_code": p.family_code, "plan_qty": p.plan_qty,
        "unit": p.unit, "notes": p.notes,
    }


def ser_template(t: MesChecklistTemplate) -> dict:
    return {
        "id": t.id, "code": t.code, "name": t.name, "category": t.category, "cycle": t.cycle,
        "items_json": jloads(t.items_json, []), "approval_json": jloads(t.approval_json, {}),
        "items": jloads(t.items_json, []), "approval": jloads(t.approval_json, {}),
        "is_active": bool(t.is_active), "sort_order": t.sort_order, "notes": t.notes,
    }


def ser_event(e: MesEquipmentEvent, equipment_name: Optional[str] = None) -> dict:
    return {
        "id": e.id, "equipment_id": e.equipment_id, "equipment_name": equipment_name,
        "event_type": e.event_type, "event_date": dstr(e.event_date), "description": e.description,
        "part_name": e.part_name, "cost": e.cost, "done_by": e.done_by,
        "downtime_minutes": e.downtime_minutes, "status": e.status,
    }


def ser_reading(r: MesSensorReading) -> dict:
    return {"id": r.id, "equipment_id": r.equipment_id, "ts": iso(r.ts), "kind": r.kind,
            "value": r.value, "source": r.source}


# ──────────────────────────────────────────────
# 코드/설비/작업자 캐시(요청 단위)
# ──────────────────────────────────────────────

def code_name_map(db: Session, group_code: str) -> dict[str, str]:
    rows = db.query(MesCode.code, MesCode.name).filter(MesCode.group_code == group_code).all()
    return {c: n for c, n in rows}


def process_map(db: Session) -> dict[int, MesProcess]:
    return {p.id: p for p in db.query(MesProcess).all()}


def equipment_map(db: Session) -> dict[int, MesEquipment]:
    return {e.id: e for e in db.query(MesEquipment).all()}


def worker_map(db: Session) -> dict[int, MesWorker]:
    return {w.id: w for w in db.query(MesWorker).all()}


# ──────────────────────────────────────────────
# 작업지시 채번
# ──────────────────────────────────────────────

def next_wo_no(db: Session, order_date: date) -> tuple[str, int]:
    """'WO' + yymmdd + 3자리 seq. 같은 날 최대 seq+1 (단순 처리 — 동시성 보장 X)."""
    prefix = "WO" + order_date.strftime("%y%m%d")
    max_seq = db.query(func.max(MesWorkOrder.seq)).filter(
        MesWorkOrder.order_date == order_date).scalar()
    seq = int(max_seq or 0) + 1
    return f"{prefix}{seq:03d}", seq


# ──────────────────────────────────────────────
# 판정 로직 (POP)
# ──────────────────────────────────────────────

DEFAULT_HEATING_MIN = 75.0
DEFAULT_FREEZING_MAX = -18.0
DEFAULT_MIXING_MAX_MIN = 30.0


def find_limit(db: Session, process_id: int, family_code: Optional[str]) -> Optional[MesCcpLimit]:
    """(process_id, family_code) 우선, 없으면 (process_id, family_code=None)."""
    q = db.query(MesCcpLimit).filter(
        MesCcpLimit.process_id == process_id, MesCcpLimit.is_active.is_(True))
    row = None
    if family_code:
        row = q.filter(MesCcpLimit.family_code == family_code).first()
    if not row:
        row = q.filter(MesCcpLimit.family_code.is_(None)).first()
    return row


def auto_limit_value(process: MesProcess, limit_row: Optional[MesCcpLimit]) -> Optional[float]:
    """공정 종류별 의미 있는 한계값 자동 세팅."""
    kind = process.pop_kind
    if kind == "heating":
        return (limit_row.min_value if limit_row else None) or DEFAULT_HEATING_MIN
    if kind == "freezing":
        return (limit_row.max_value if limit_row else None) or DEFAULT_FREEZING_MAX
    if kind == "mixing":
        return (limit_row.max_value if limit_row else None) or DEFAULT_MIXING_MAX_MIN
    return limit_row.max_value if limit_row else None


def judge_run(process: MesProcess, limit_row: Optional[MesCcpLimit], minutes: Optional[float],
              measured_value: Optional[float], test_result: Optional[str]) -> Optional[str]:
    """공정 종류별 적/부 판정. 값이 없어 판정 불가하면 None(보류)."""
    kind = process.pop_kind
    if kind == "mixing":
        max_min = (limit_row.max_value if limit_row else None) or DEFAULT_MIXING_MAX_MIN
        if minutes is None:
            return None
        return "적" if minutes <= max_min else "부"
    if kind == "heating":
        if measured_value is None:
            return None
        min_v = (limit_row.min_value if limit_row else None)
        if min_v is None:
            min_v = DEFAULT_HEATING_MIN
        return "적" if measured_value >= min_v else "부"
    if kind == "freezing":
        if measured_value is None:
            return None
        max_v = (limit_row.max_value if limit_row else None)
        if max_v is None:
            max_v = DEFAULT_FREEZING_MAX
        return "적" if measured_value <= max_v else "부"
    if kind == "metal":
        if test_result in ("pass", "test"):
            return "적"
        if test_result == "detect":
            return "부"
        return None
    # packing/기타
    return "적"


DEVIATION_CODE_BY_KIND = {
    "mixing": "TIME",
    "heating": "TEMP",
    "freezing": "TEMP",
    "metal": "METAL",
}


def create_deviation_for_run(db: Session, run: MesProcessRun, process: MesProcess) -> MesDeviation:
    dcode = DEVIATION_CODE_BY_KIND.get(process.pop_kind, "ETC")
    dev = MesDeviation(
        run_id=run.id, work_order_id=run.work_order_id, process_id=run.process_id,
        equipment_id=run.equipment_id, occurred_at=run.end_at or datetime.now(),
        deviation_code=dcode, description=f"{process.name} POP 판정 부적합(run #{run.id})",
        limit_value=run.limit_value, measured_value=run.measured_value, status="open",
    )
    db.add(dev)
    return dev


def record_sensor_from_run(db: Session, run: MesProcessRun, process: MesProcess) -> None:
    """가열/급속동결 measured_value → sensor_reading(temp), 금속검출 → metal_*"""
    if not run.equipment_id:
        return
    ts = run.end_at or datetime.now()
    if process.pop_kind in ("heating", "freezing") and run.measured_value is not None:
        db.add(MesSensorReading(equipment_id=run.equipment_id, ts=ts, kind="temp",
                                value=run.measured_value, source="pop"))
    elif process.pop_kind == "metal" and run.test_result:
        kind = {"pass": "metal_pass", "detect": "metal_detect", "test": "metal_test"}.get(run.test_result)
        if kind:
            db.add(MesSensorReading(equipment_id=run.equipment_id, ts=ts, kind=kind,
                                    value=1, source="pop"))


def ser_run(r: MesProcessRun, process_name=None, equipment_name=None, worker_name=None) -> dict:
    return {
        "id": r.id, "run_date": dstr(r.run_date), "process_id": r.process_id,
        "process_name": process_name, "equipment_id": r.equipment_id,
        "equipment_name": equipment_name, "work_order_id": r.work_order_id,
        "family_code": r.family_code, "item_name": r.item_name, "input_kg": r.input_kg,
        "alcohol_g": r.alcohol_g, "limit_value": r.limit_value, "measured_value": r.measured_value,
        "start_at": iso(r.start_at), "end_at": iso(r.end_at), "minutes": r.minutes,
        "judgment": r.judgment, "worker_id": r.worker_id, "worker_name": worker_name,
        "test_result": r.test_result, "status": r.status, "notes": r.notes,
    }


def ser_deviation(d: MesDeviation, process_name=None, equipment_name=None) -> dict:
    return {
        "id": d.id, "run_id": d.run_id, "work_order_id": d.work_order_id,
        "process_id": d.process_id, "process_name": process_name, "equipment_id": d.equipment_id,
        "equipment_name": equipment_name, "occurred_at": iso(d.occurred_at),
        "deviation_code": d.deviation_code, "description": d.description,
        "limit_value": d.limit_value, "measured_value": d.measured_value,
        "corrective_action": d.corrective_action, "action_by": d.action_by,
        "action_at": iso(d.action_at), "status": d.status,
    }


def ser_ccp_log(l: MesCcpLog, process_name=None, equipment_name=None, run_count=0, fail_count=0) -> dict:
    return {
        "id": l.id, "log_date": dstr(l.log_date), "process_id": l.process_id,
        "process_name": process_name, "equipment_id": l.equipment_id,
        "equipment_name": equipment_name, "status": l.status, "author": l.author,
        "approver": l.approver, "submitted_at": iso(l.submitted_at),
        "approved_at": iso(l.approved_at), "reject_reason": l.reject_reason,
        "summary_json": jloads(l.summary_json, {}), "summary": jloads(l.summary_json, {}), "notes": l.notes,
        "run_count": run_count, "fail_count": fail_count,
    }


def ser_entry(e: MesChecklistEntry, template_code=None, template_name=None, cycle=None, category=None) -> dict:
    return {
        "id": e.id, "template_id": e.template_id, "template_code": template_code,
        "template_name": template_name, "cycle": cycle, "category": category,
        "check_date": dstr(e.check_date), "shift": e.shift, "author": e.author,
        "status": e.status, "reviewer": e.reviewer, "approver": e.approver,
        "results_json": jloads(e.results_json, {}), "results": jloads(e.results_json, {}), "remarks": e.remarks,
        "deviation_count": e.deviation_count, "submitted_at": iso(e.submitted_at),
        "approved_at": iso(e.approved_at), "reject_reason": e.reject_reason,
    }


def count_deviation(results_json: dict) -> int:
    """results_json = {"<no>": {"value": "ok"|"ng"|number|text, "note": ""}} → ng 개수."""
    n = 0
    for v in (results_json or {}).values():
        if isinstance(v, dict) and v.get("value") == "ng":
            n += 1
    return n


# ──────────────────────────────────────────────
# 작업지시 실적 집계
# ──────────────────────────────────────────────

def order_metrics(db: Session, order_ids: list[int]) -> dict[int, dict]:
    """작업지시별 실적/불량/비가동 합계 — N+1 방지용 일괄 로드."""
    out = {oid: {"prod_qty": 0.0, "good_qty": 0.0, "defect_qty": 0.0,
                 "downtime_minutes": 0.0, "result_count": 0} for oid in order_ids}
    if not order_ids:
        return out
    for oid, prod, good, defect, cnt in db.query(
        MesWorkResult.work_order_id, func.sum(MesWorkResult.prod_qty),
        func.sum(MesWorkResult.good_qty), func.sum(MesWorkResult.defect_qty),
        func.count(MesWorkResult.id),
    ).filter(MesWorkResult.work_order_id.in_(order_ids)).group_by(MesWorkResult.work_order_id).all():
        if oid in out:
            out[oid].update(prod_qty=float(prod or 0), good_qty=float(good or 0),
                            defect_qty=float(defect or 0), result_count=int(cnt or 0))
    now = datetime.now()
    for dt_ in db.query(MesDowntime).filter(MesDowntime.work_order_id.in_(order_ids)).all():
        if dt_.work_order_id not in out:
            continue
        mins = dt_.minutes
        if mins is None and dt_.start_at:
            end = dt_.end_at or now
            mins = (end - dt_.start_at).total_seconds() / 60
        out[dt_.work_order_id]["downtime_minutes"] += float(mins or 0)
    return out


def ser_result(r: MesWorkResult, worker_name=None) -> dict:
    return {
        "id": r.id, "work_order_id": r.work_order_id, "result_no": r.result_no,
        "start_at": iso(r.start_at), "end_at": iso(r.end_at), "prod_qty": r.prod_qty,
        "good_qty": r.good_qty, "defect_qty": r.defect_qty, "worker_id": r.worker_id,
        "worker_name": worker_name, "notes": r.notes,
    }


def ser_defect(d: MesDefect, defect_name=None) -> dict:
    return {"id": d.id, "work_order_id": d.work_order_id, "result_id": d.result_id,
            "defect_code": d.defect_code, "defect_name": defect_name, "qty": d.qty, "notes": d.notes}


def ser_downtime(d: MesDowntime, downtime_name=None, equipment_name=None) -> dict:
    return {
        "id": d.id, "work_order_id": d.work_order_id, "equipment_id": d.equipment_id,
        "equipment_name": equipment_name, "downtime_code": d.downtime_code,
        "downtime_name": downtime_name, "start_at": iso(d.start_at), "end_at": iso(d.end_at),
        "minutes": d.minutes, "reason": d.reason,
    }


def ser_material(m: MesMaterialIssue) -> dict:
    return {
        "id": m.id, "work_order_id": m.work_order_id, "material_type": m.material_type,
        "material_id": m.material_id, "material_name": m.material_name, "qty": m.qty,
        "unit": m.unit, "lot_no": m.lot_no, "source": m.source,
    }


def ser_work_order(o: MesWorkOrder, process_name=None, equipment_name=None,
                    workers=None, metrics=None) -> dict:
    metrics = metrics or {}
    plan_qty = o.plan_qty or 0
    prod_qty = metrics.get("prod_qty", 0.0)
    progress_pct = round(min(100.0, (prod_qty / plan_qty * 100)) if plan_qty else 0.0, 1)
    return {
        "id": o.id, "wo_no": o.wo_no, "order_date": dstr(o.order_date), "seq": o.seq,
        "item_id": o.item_id, "item_name": o.item_name, "family_code": o.family_code,
        "process_id": o.process_id, "process_name": process_name,
        "equipment_id": o.equipment_id, "equipment_name": equipment_name,
        "plan_qty": o.plan_qty, "unit": o.unit, "batch_count": o.batch_count,
        "status": o.status, "priority": o.priority, "start_at": iso(o.start_at),
        "end_at": iso(o.end_at), "lot_no": o.lot_no, "expiry_date": dstr(o.expiry_date),
        "notes": o.notes, "created_by": o.created_by, "workers": workers or [],
        "prod_qty": metrics.get("prod_qty", 0.0), "good_qty": metrics.get("good_qty", 0.0),
        "defect_qty": metrics.get("defect_qty", 0.0),
        "downtime_minutes": metrics.get("downtime_minutes", 0.0),
        "result_count": metrics.get("result_count", 0), "progress_pct": progress_pct,
    }


# ──────────────────────────────────────────────
# 품목·자재 조회 (scm_* 마스터 사용)
# ──────────────────────────────────────────────

def guess_family_code(db: Session, product_name: str, product_category: Optional[str]) -> Optional[str]:
    """FAMILY 코드 extra.csa_category 또는 품목명 부분일치로 추정."""
    codes = db.query(MesCode).filter(MesCode.group_code == "FAMILY", MesCode.is_active.is_(True)).all()
    name = (product_name or "").strip()
    cat = (product_category or "").strip()
    for c in codes:
        extra = jloads(c.extra, {})
        csa_cat = (extra.get("csa_category") or "").strip()
        if csa_cat and cat and csa_cat == cat:
            return c.code
    for c in codes:
        if c.name and name and (c.name in name or name in c.name):
            return c.code
    return None


def search_items(db: Session, q: Optional[str], item_type: Optional[str], limit: int = 200) -> list[dict]:
    query = db.query(ScmProduct).filter(ScmProduct.is_active.is_(True))
    if item_type:
        query = query.filter(ScmProduct.item_type == item_type)
    else:
        query = query.filter(
            (ScmProduct.item_type.in_(["반제품", "완제품", "세트"])) | (ScmProduct.item_type.is_(None)))
    if q:
        query = query.filter(ScmProduct.product_name.ilike(f"%{q}%"))
    rows = query.order_by(ScmProduct.product_name).limit(limit).all()
    out = []
    for p in rows:
        out.append({
            "id": p.id, "name": p.product_name, "code": p.product_code,
            "item_type": p.item_type, "category": p.product_category,
            "family_code": guess_family_code(db, p.product_name, p.product_category),
        })
    return out


def search_materials(db: Session, q: Optional[str], limit: int = 100) -> list[dict]:
    out = []
    rq = db.query(ScmRawMaterial).filter(ScmRawMaterial.is_active.is_(True))
    if q:
        rq = rq.filter(ScmRawMaterial.name.ilike(f"%{q}%"))
    for m in rq.order_by(ScmRawMaterial.name).limit(limit).all():
        out.append({"id": m.id, "type": "raw", "name": m.name, "unit": m.unit, "erp_code": m.erp_code})
    sq = db.query(ScmSubMaterial).filter(ScmSubMaterial.is_active.is_(True))
    if q:
        sq = sq.filter(ScmSubMaterial.name.ilike(f"%{q}%"))
    for m in sq.order_by(ScmSubMaterial.name).limit(limit).all():
        out.append({"id": m.id, "type": "sub", "name": m.name, "unit": m.unit, "erp_code": m.erp_code})
    return out


def item_bom_lines(db: Session, item_id: int) -> list[dict]:
    rows = db.query(ScmBomLine).filter(ScmBomLine.item_id == item_id).order_by(ScmBomLine.sort_order).all()
    return [{
        "material_type": r.material_type,
        "material_id": r.raw_material_id if r.material_type == "raw" else r.sub_material_id,
        "material_name": r.material_name, "qty_per_unit": r.qty_per_unit, "unit": r.qty_unit,
    } for r in rows]


# ──────────────────────────────────────────────
# 체크리스트 달력/오늘
# ──────────────────────────────────────────────

def _entries_by_template_date(db: Session, template_ids: list[int], start: date, end: date):
    rows = db.query(MesChecklistEntry).filter(
        MesChecklistEntry.template_id.in_(template_ids),
        MesChecklistEntry.check_date >= start, MesChecklistEntry.check_date <= end,
    ).order_by(MesChecklistEntry.id).all()
    by_day: dict[tuple[int, date], list[MesChecklistEntry]] = {}
    for e in rows:
        by_day.setdefault((e.template_id, e.check_date), []).append(e)
    return by_day


_STATUS_RANK = {"draft": 1, "rejected": 1, "submitted": 2, "reviewed": 3, "approved": 4}


def _best_status(entries: list[MesChecklistEntry]) -> str:
    if not entries:
        return "missing"
    return max(entries, key=lambda e: _STATUS_RANK.get(e.status, 0)).status


def checklist_calendar(db: Session, month: str) -> dict:
    first, last = month_range(month)
    if not first:
        raise ValueError("month 형식 오류(YYYY-MM)")
    templates = db.query(MesChecklistTemplate).filter(
        MesChecklistTemplate.is_active.is_(True)).order_by(MesChecklistTemplate.sort_order).all()
    tids = [t.id for t in templates]
    by_day = _entries_by_template_date(db, tids, first, last)
    today = date.today()

    days: dict[str, dict[str, str]] = {}
    total_cells = 0
    done_cells = 0
    d = first
    while d <= last:
        wk_start, wk_end = week_bounds(d)
        cell: dict[str, str] = {}
        for t in templates:
            key = str(t.id)
            if t.cycle == "daily":
                entries = by_day.get((t.id, d), [])
                status = _best_status(entries) if entries else ("missing" if d <= today else "n/a")
            elif t.cycle == "weekly":
                wk_entries = []
                wd = wk_start
                while wd <= wk_end:
                    wk_entries += by_day.get((t.id, wd), [])
                    wd += timedelta(days=1)
                if wk_entries:
                    status = _best_status(wk_entries)
                else:
                    status = "missing" if wk_end <= today else "n/a"
            elif t.cycle == "monthly":
                mo_entries = []
                for (tid, cd), es in by_day.items():
                    if tid == t.id:
                        mo_entries += es
                if mo_entries:
                    status = _best_status(mo_entries)
                else:
                    status = "missing" if last <= today else "n/a"
            else:  # asneeded
                entries = by_day.get((t.id, d), [])
                status = _best_status(entries) if entries else "n/a"
            cell[key] = status
            if status in ("approved", "submitted", "reviewed"):
                done_cells += 1
                total_cells += 1
            elif status == "missing":
                total_cells += 1
        days[d.isoformat()] = cell
        d += timedelta(days=1)

    completion_rate = round(done_cells / total_cells, 4) if total_cells else 1.0
    return {
        "templates": [{"id": t.id, "code": t.code, "name": t.name, "cycle": t.cycle} for t in templates],
        "days": days, "completion_rate": completion_rate,
    }


def checklists_today(db: Session) -> dict:
    today = date.today()
    wk_start, wk_end = week_bounds(today)
    mo_start = today.replace(day=1)
    mo_end = date(today.year, today.month, calendar.monthrange(today.year, today.month)[1])
    templates = db.query(MesChecklistTemplate).filter(
        MesChecklistTemplate.is_active.is_(True)).order_by(MesChecklistTemplate.sort_order).all()
    out = []
    for t in templates:
        entry = None
        if t.cycle == "daily":
            entry = db.query(MesChecklistEntry).filter(
                MesChecklistEntry.template_id == t.id, MesChecklistEntry.check_date == today).first()
        elif t.cycle == "weekly":
            entry = db.query(MesChecklistEntry).filter(
                MesChecklistEntry.template_id == t.id,
                MesChecklistEntry.check_date >= wk_start, MesChecklistEntry.check_date <= wk_end).first()
            if entry:
                continue  # 이번 주 이미 작성됨 → 오늘 대상 아님
        elif t.cycle == "monthly":
            entry = db.query(MesChecklistEntry).filter(
                MesChecklistEntry.template_id == t.id,
                MesChecklistEntry.check_date >= mo_start, MesChecklistEntry.check_date <= mo_end).first()
            if entry:
                continue
        else:
            continue  # asneeded는 상시 대상 아님
        out.append({
            "template_id": t.id, "code": t.code, "name": t.name, "cycle": t.cycle,
            "category": t.category, "entry_id": entry.id if entry else None,
            "status": entry.status if entry else "missing",
        })
    due = len(out)
    done = sum(1 for o in out if o["status"] in ("submitted", "reviewed", "approved"))
    return {"items": out, "due": due, "done": done}


# ──────────────────────────────────────────────
# 대시보드/모니터링/설비상태/OEE — 라우트에서 세부 구현 호출
# ──────────────────────────────────────────────

def compute_oee_row(order: MesWorkOrder, metrics: dict) -> dict:
    now = datetime.now()
    start_at = order.start_at
    end_at = order.end_at or (now if order.status == "in_progress" else order.start_at)
    if start_at and end_at and end_at > start_at:
        load_minutes = (end_at - start_at).total_seconds() / 60
    else:
        load_minutes = 0.0
    downtime_minutes = metrics.get("downtime_minutes", 0.0)
    run_minutes = max(load_minutes - downtime_minutes, 0.0)
    prod_qty = metrics.get("prod_qty", 0.0)
    good_qty = metrics.get("good_qty", 0.0)
    defect_qty = metrics.get("defect_qty", 0.0)
    plan_qty = order.plan_qty or 0.0

    availability = (run_minutes / load_minutes) if load_minutes > 0 else 0.0
    performance = min(1.0, prod_qty / plan_qty) if plan_qty > 0 else 1.0
    quality = (good_qty / prod_qty) if prod_qty > 0 else 0.0
    oee = availability * performance * quality
    defect_rate = (defect_qty / prod_qty) if prod_qty > 0 else 0.0
    achievement_rate = (prod_qty / plan_qty) if plan_qty > 0 else 0.0
    return {
        "plan_qty": plan_qty, "prod_qty": prod_qty, "good_qty": good_qty, "defect_qty": defect_qty,
        "defect_rate": round(defect_rate, 4), "achievement_rate": round(achievement_rate, 4),
        "load_minutes": round(load_minutes, 1), "downtime_minutes": round(downtime_minutes, 1),
        "run_minutes": round(run_minutes, 1), "availability": round(availability, 4),
        "performance": round(performance, 4), "quality": round(quality, 4), "oee": round(oee, 4),
    }


# ══════════════════════════════════════════════
# 시드 데이터
# ══════════════════════════════════════════════

PROCESSES = [
    dict(code="P_MIX", name="배합", process_class="배합", floor="2F", is_ccp=True,
         ccp_code="CCP-2B", pop_kind="mixing", sub_kind=None),
    dict(code="P_BAKE", name="굽기", process_class="가열", floor="2F", is_ccp=True,
         ccp_code="CCP-1B", pop_kind="heating", sub_kind="굽기"),
    dict(code="P_BOIL", name="끓임", process_class="가열", floor="2F", is_ccp=True,
         ccp_code="CCP-1B", pop_kind="heating", sub_kind="끓임"),
    dict(code="P_MELT", name="멜팅", process_class="가열", floor="2F", is_ccp=True,
         ccp_code="CCP-1B", pop_kind="heating", sub_kind="멜팅"),
    dict(code="P_TUNNEL", name="터널", process_class="가열", floor="2F", is_ccp=True,
         ccp_code="CCP-1B", pop_kind="heating", sub_kind="터널"),
    dict(code="P_FREEZE", name="급속동결", process_class="급속동결", floor="2F", is_ccp=True,
         ccp_code="CCP-2C", pop_kind="freezing", sub_kind=None),
    dict(code="P_METAL", name="금속검출", process_class="금속검출", floor=None, is_ccp=True,
         ccp_code="CCP-3P", pop_kind="metal", sub_kind=None),
    dict(code="P_PACK", name="포장가공", process_class="포장가공", floor=None, is_ccp=False,
         ccp_code=None, pop_kind="packing", sub_kind=None),
    dict(code="P_FORM", name="성형", process_class="성형", floor=None, is_ccp=False,
         ccp_code=None, pop_kind=None, sub_kind=None),
    dict(code="P_COOL", name="냉각", process_class="냉각", floor=None, is_ccp=False,
         ccp_code=None, pop_kind=None, sub_kind=None),
]

EQUIPMENT = (
    [dict(code=f"RO-2F-{i}", name=f"2F 로터리오븐 {i}호기", process_code="P_BAKE", floor="2F",
          unit_label=f"2F{i}호기", eq_type="로터리오븐") for i in range(1, 5)]
    + [dict(code=f"TO-2F-{i}", name=f"2F 터널오븐 {i}호기", process_code="P_TUNNEL", floor="2F",
            unit_label=f"2F{i}호기", eq_type="터널오븐") for i in (5, 6)]
    + [dict(code=f"RO-3F-{i}", name=f"3F 로터리오븐 {i}호기", process_code="P_BAKE", floor="3F",
            unit_label=f"3F{i}호기", eq_type="로터리오븐") for i in range(7, 15)]
    + [dict(code="TO-3F-1", name="3F 터널오븐", process_code="P_TUNNEL", floor="3F",
            unit_label="3F1호기", eq_type="터널오븐")]
    + [dict(code=f"DO-2F-{s}", name=f"2F 데크오븐 {n}", process_code="P_BAKE", floor="2F",
            unit_label=f"2F-{n}", eq_type="데크오븐") for s, n in (("U", "상"), ("M", "중"), ("D", "하"))]
    + [dict(code=f"MX-2F-{i}", name=f"2F 배합기 {i}호기", process_code="P_MIX", floor="2F",
            unit_label=f"2F{i}호기", eq_type="배합기") for i in (1, 2)]
    + [dict(code="MX-CREAM-100L", name="크림 100리터 배합기", process_code="P_MIX", floor="2F",
            unit_label="크림100L", eq_type="배합기")]
    + [dict(code="MX-CREAM-VMI", name="크림 VMI 배합기", process_code="P_MIX", floor="2F",
            unit_label="크림VMI", eq_type="배합기")]
    + [dict(code="FZ-2F-1", name="급속동결기 2F1호기", process_code="P_FREEZE", floor="2F",
            unit_label="2F1호기", eq_type="급속동결기")]
    + [dict(code=f"MD-2F-{i}", name=f"금속검출기 2F {i}호기", process_code="P_METAL", floor="2F",
            unit_label=f"2F{i}호기", eq_type="금속검출기") for i in range(1, 5)]
    + [dict(code=f"MD-3F-{i}", name=f"금속검출기 3F {i}호기", process_code="P_METAL", floor="3F",
            unit_label=f"3F{i}호기", eq_type="금속검출기") for i in range(1, 5)]
    + [dict(code="WH-1F", name="1F 상온창고", process_code=None, floor="1F",
            unit_label="1F", eq_type="창고")]
    + [dict(code="CR-2F", name="2F 냉각실", process_code=None, floor="2F",
            unit_label="2F", eq_type="냉각실")]
)

WORKERS = [
    "임규식", "아지", "대니", "임준혁", "이영화", "이완", "김종민", "줄리안토", "리빤", "앤디",
    "박상훈", "디안", "무코코", "반선", "수리안토", "리키", "김종성",
]

FAMILY_CODES = [
    ("JAM_EARLGREY", "얼그레이잼", None),
    ("COFFEE_CUSTARD", "커피커스터드", None),
    ("GANACHE", "가나슈", None),
    ("TTUNGCARONG_COQUE", "뚱카롱꼬끄", "뚱카롱"),
    ("TTUNGNANGSIER", "뚱낭시에", "뚱낭시에"),
    ("COOKIE", "쿠키류(르뱅/아메리칸/크럼블/쫀득)", "르뱅쿠키"),
    ("WHEAT_SCONE", "통밀스콘", None),
    ("BROWNIE_POUND", "브라우니/파운드", "브라우니"),
    ("WHEAT_BREAD", "통밀식빵/슈톨렌", None),
    ("LIGHT_BUN", "라이트번", None),
    ("ANGLAISE", "앙글레즈", None),
    ("BAKERY_ETC", "베이글/바게트/포카치아/사워도우/깜빠뉴/슬랩", None),
    ("MACARON_COQUE", "마카롱꼬끄", "마카롱"),
    ("CHEWY_BREAD", "쫀득빵", None),
    ("MADELEINE", "마들렌", None),
    ("CREAM", "크림(뚱카롱 크림류)", "크림"),
]

DOWNTIME_CODES = [
    ("EQ_FAIL", "설비고장"), ("MAT_WAIT", "자재대기"), ("SETUP", "금형/세팅교체"),
    ("CLEAN", "청소소독"), ("BREAK", "휴식"), ("POWER", "정전"), ("ETC", "기타"),
]
DEFECT_CODES = [
    ("SHAPE", "형상불량"), ("BAKE", "소성불량(타짐/덜익음)"), ("FOREIGN", "이물"),
    ("WEIGHT", "중량미달"), ("BROKEN", "파손"), ("PACK", "포장불량"), ("ETC", "기타"),
]
DEVIATION_CODES = [
    ("TEMP", "온도이탈"), ("TIME", "시간이탈"), ("METAL", "금속검출"),
    ("ALCOHOL", "주정비율이탈"), ("MISSING", "기록누락"), ("ETC", "기타"),
]
EQ_EVENT_CODES = [
    ("FAIL", "고장"), ("REPAIR", "수리"), ("PART", "부품교체"), ("CHECK", "점검"), ("CLEAN", "청소소독"),
]

BAKE_FAMILY_TEMP = {
    "TTUNGCARONG_COQUE": 150, "COOKIE": 170, "WHEAT_BREAD": 190, "MACARON_COQUE": 140,
}


def _mk_items(rows: list[tuple]) -> list[dict]:
    """rows: (section, item, standard, type, unit, ref) → items_json 리스트."""
    out = []
    for i, (section, item, standard, typ, unit, ref) in enumerate(rows, start=1):
        out.append({"no": i, "section": section, "item": item, "standard": standard,
                    "type": typ, "unit": unit, "ref": ref})
    return out


CHECKLIST_TEMPLATES = [
    dict(code="JJ-PP-01-B", name="조도 점검표", category="선행요건", cycle="daily", items=_mk_items([
        ("작업장", "원료보관실 조도", "220 lux 이상", "num", "lux", None),
        ("작업장", "배합실 조도", "540 lux 이상", "num", "lux", None),
        ("작업장", "포장실 조도", "540 lux 이상", "num", "lux", None),
        ("작업장", "검수실 조도", "540 lux 이상", "num", "lux", None),
        ("작업장", "냉각실 조도", "110 lux 이상", "num", "lux", None),
        ("작업장", "창고 조도", "110 lux 이상", "num", "lux", None),
        ("설비", "조도계 정상 작동", "이상없음", "ok", None, None),
        ("설비", "조명 파손/누락 여부", "이상없음", "ok", None, None),
    ])),
    dict(code="JJ-PP-02", name="작업장 위생관리점검표", category="위생", cycle="daily", items=_mk_items([
        ("공통", "바닥 청결상태", "이물/오염 없음", "ok", None, None),
        ("공통", "벽면/천장 상태", "이물/곰팡이 없음", "ok", None, None),
        ("공통", "배수구 상태", "막힘/악취 없음", "ok", None, None),
        ("공통", "쓰레기통 관리", "뚜껑/즉시배출", "ok", None, None),
        ("공통", "환기 상태", "이상없음", "ok", None, None),
        ("공통", "해충 흔적", "없음", "ok", None, None),
        ("공통", "출입 통제", "관계자외 출입금지 준수", "ok", None, None),
        ("공통", "위생복 착용 상태", "이상없음", "ok", None, None),
        ("공통", "특이사항", "-", "text", None, None),
    ])),
    dict(code="JJ-PP-03", name="개인위생점검일지", category="위생", cycle="daily", items=_mk_items([
        ("작업자", "위생복 착용", "규정 착용", "ok", None, None),
        ("작업자", "위생모/마스크 착용", "규정 착용", "ok", None, None),
        ("작업자", "손세척/소독", "작업 전 실시", "ok", None, None),
        ("작업자", "손톱/장신구", "미착용/단정", "ok", None, None),
        ("작업자", "상처 유무", "없음/방수밴드 조치", "ok", None, None),
        ("작업자", "건강상태(발열/설사 등)", "이상없음", "ok", None, None),
        ("작업자", "보건증 유효기간", "유효", "ok", None, None),
        ("작업자", "특이사항", "-", "text", None, None),
    ])),
    dict(code="JJ-PP-04", name="제조시설/기구 위생점검표", category="위생", cycle="daily", items=_mk_items([
        ("시설", "제조설비 세척상태", "이상없음", "ok", None, None),
        ("시설", "작업대 위생상태", "이상없음", "ok", None, None),
        ("기구", "칼/도마 위생상태", "이상없음", "ok", None, None),
        ("기구", "용기/트레이 위생상태", "이상없음", "ok", None, None),
        ("기구", "소도구 보관상태", "지정위치 정리", "ok", None, None),
        ("시설", "노후/파손 여부", "이상없음", "ok", None, None),
        ("시설", "세척제/소독제 관리", "적정 보관", "ok", None, None),
    ])),
    dict(code="JJ-PP-05", name="방충방서점검표", category="선행요건", cycle="weekly", items=_mk_items([
        ("외부", "포충등 작동상태", "정상", "ok", None, None),
        ("외부", "방서시설(트랩) 이상 유무", "이상없음", "ok", None, None),
        ("출입구", "에어커튼 작동", "정상", "ok", None, None),
        ("출입구", "방충망 파손 여부", "이상없음", "ok", None, None),
        ("내부", "해충/설치류 흔적", "없음", "ok", None, None),
        ("내부", "트랩 포획물 확인", "확인함", "ok", None, None),
        ("기록", "방역업체 점검일지 대조", "일치", "ok", None, None),
    ])),
    dict(code="JJ-PP-06", name="소독시설관리점검표", category="설비", cycle="weekly", items=_mk_items([
        ("시설", "손소독기 작동/충전", "정상", "ok", None, None),
        ("시설", "장화소독조 농도", "적정", "ok", None, None),
        ("시설", "자외선살균기 작동", "정상", "ok", None, None),
        ("소모품", "소독제 잔량", "충분", "ok", None, None),
        ("기록", "소독액 교체주기 준수", "준수", "ok", None, None),
    ])),
    dict(code="JJ-PP-07", name="작업장온도체크리스트", category="선행요건", cycle="daily", items=_mk_items([
        ("작업장", "원료보관실 온도", "실온 기준", "num", "℃", None),
        ("작업장", "배합실 온도", "실온 기준", "num", "℃", None),
        ("작업장", "냉장고 온도", "0~10℃", "num", "℃", None),
        ("작업장", "냉동고 온도", "-18℃ 이하", "num", "℃", None),
        ("작업장", "포장실 온도", "실온 기준", "num", "℃", None),
        ("작업장", "완제품 창고 온도", "실온 기준", "num", "℃", None),
    ])),
    dict(code="JJ-PP-08", name="출입문·창문점검", category="설비", cycle="daily", items=_mk_items([
        ("시설", "출입문 자동개폐/밀폐", "이상없음", "ok", None, None),
        ("시설", "창문 방충망 상태", "이상없음", "ok", None, None),
        ("시설", "에어샤워 작동", "정상", "ok", None, None),
        ("시설", "잠금장치 상태", "정상", "ok", None, None),
    ])),
    dict(code="JJ-PP-09-C", name="고객불만처리일지", category="기타", cycle="asneeded", items=_mk_items([
        ("접수", "접수일시/채널", "-", "text", None, None),
        ("접수", "고객 정보", "-", "text", None, None),
        ("내용", "불만 내용", "-", "text", None, None),
        ("조사", "원인 조사 결과", "-", "text", None, None),
        ("조치", "개선/보상 조치", "-", "text", None, None),
        ("종결", "처리 완료 여부", "-", "ok", None, None),
    ])),
    dict(code="JJ-PP-10", name="작업도구위생점검표", category="위생", cycle="daily", items=_mk_items([
        ("도구", "짤주머니/깍지 세척", "이상없음", "ok", None, None),
        ("도구", "저울/온도계 위생", "이상없음", "ok", None, None),
        ("도구", "이동카트 위생", "이상없음", "ok", None, None),
        ("도구", "보관함 정리정돈", "이상없음", "ok", None, None),
    ])),
    dict(code="JJ-PP-11", name="부대시설관리점검표", category="설비", cycle="weekly", items=_mk_items([
        ("시설", "탈의실 청결", "이상없음", "ok", None, None),
        ("시설", "화장실 청결", "이상없음", "ok", None, None),
        ("시설", "휴게실 청결", "이상없음", "ok", None, None),
        ("시설", "정화조/배수설비", "이상없음", "ok", None, None),
        ("시설", "보일러/공조설비", "이상없음", "ok", None, None),
    ])),
    dict(code="JJ-PP-12", name="원료·부재료 검수일지", category="검수", cycle="daily", items=_mk_items([
        ("검수", "입고 품목명/수량 일치", "일치", "ok", None, None),
        ("검수", "유통기한/제조일자 확인", "적합", "ok", None, None),
        ("검수", "포장 상태", "이상없음", "ok", None, None),
        ("검수", "입고 온도(냉장/냉동)", "기준 이내", "num", "℃", None),
        ("검수", "이물/변질 여부", "없음", "ok", None, None),
        ("검수", "성적서/증명서 확인", "확인함", "ok", None, None),
    ])),
    dict(code="JJ-PP-13", name="완제품검수일지", category="검수", cycle="daily", items=_mk_items([
        ("검수", "표시사항 확인", "적합", "ok", None, None),
        ("검수", "중량 확인", "기준 이내", "ok", None, None),
        ("검수", "포장 밀봉 상태", "이상없음", "ok", None, None),
        ("검수", "금속검출 결과 확인", "적합", "ok", None, None),
        ("검수", "외관/색상 이상 유무", "없음", "ok", None, None),
    ])),
    dict(code="JJ-PP-14", name="관능평가서", category="검수", cycle="weekly", items=_mk_items([
        ("관능", "외관", "이상없음", "ok", None, None),
        ("관능", "향", "이상없음", "ok", None, None),
        ("관능", "맛", "이상없음", "ok", None, None),
        ("관능", "조직감", "이상없음", "ok", None, None),
        ("관능", "종합 의견", "-", "text", None, None),
    ])),
    dict(code="JJ-PP-15", name="보건증관리점검표", category="선행요건", cycle="monthly", items=_mk_items([
        ("작업자", "보건증 보유 여부", "전원 보유", "ok", None, None),
        ("작업자", "유효기간 만료 예정자 확인", "30일 이내 갱신", "ok", None, None),
        ("기록", "보건증 사본 비치", "비치됨", "ok", None, None),
    ])),
    dict(code="JJ-PP-16", name="연료사용현황", category="기타", cycle="monthly", items=_mk_items([
        ("연료", "가스 사용량", "-", "num", "㎥", None),
        ("연료", "전기 사용량", "-", "num", "kWh", None),
        ("연료", "특이사항", "-", "text", None, None),
    ])),
]


def run_seed(db: Session) -> dict:
    """code 기준 멱등 upsert. 이미 있으면 갱신, 없으면 생성."""
    created = {"processes": 0, "equipment": 0, "workers": 0, "codes": 0, "limits": 0, "templates": 0}

    proc_by_code: dict[str, MesProcess] = {p.code: p for p in db.query(MesProcess).all()}
    for i, p in enumerate(PROCESSES):
        row = proc_by_code.get(p["code"])
        is_new = row is None
        if is_new:
            row = MesProcess(code=p["code"])
            db.add(row)
        row.name = p["name"]
        row.process_class = p["process_class"]
        row.floor = p["floor"]
        row.is_ccp = p["is_ccp"]
        row.ccp_code = p["ccp_code"]
        row.pop_kind = p["pop_kind"]
        row.sub_kind = p["sub_kind"]
        row.sort_order = i
        row.is_active = True
        if is_new:
            created["processes"] += 1
    db.flush()
    proc_by_code = {p.code: p for p in db.query(MesProcess).all()}

    eq_by_code: dict[str, MesEquipment] = {e.code: e for e in db.query(MesEquipment).all()}
    for i, e in enumerate(EQUIPMENT):
        row = eq_by_code.get(e["code"])
        is_new = row is None
        if is_new:
            row = MesEquipment(code=e["code"])
            db.add(row)
        row.name = e["name"]
        row.process_id = proc_by_code[e["process_code"]].id if e.get("process_code") else None
        row.floor = e["floor"]
        row.unit_label = e["unit_label"]
        row.eq_type = e["eq_type"]
        row.plc_yn = False
        row.sort_order = i
        row.is_active = True
        if is_new:
            created["equipment"] += 1

    worker_by_name = {w.name: w for w in db.query(MesWorker).all()}
    for i, name in enumerate(WORKERS):
        row = worker_by_name.get(name)
        is_new = row is None
        if is_new:
            row = MesWorker(name=name)
            db.add(row)
        row.department = "생산팀"
        row.sort_order = i
        row.is_active = True
        if is_new:
            created["workers"] += 1

    code_rows = {(c.group_code, c.code): c for c in db.query(MesCode).all()}

    def upsert_code(group: str, code: str, name: str, sort: int, extra: Optional[dict] = None,
                     notes: Optional[str] = None) -> MesCode:
        row = code_rows.get((group, code))
        is_new = row is None
        if is_new:
            row = MesCode(group_code=group, code=code)
            db.add(row)
            code_rows[(group, code)] = row
        row.name = name
        row.sort_order = sort
        row.is_active = True
        row.extra = jdumps(extra) if extra else None
        row.notes = notes
        if is_new:
            created["codes"] += 1
        return row

    for i, (code, name, csa_cat) in enumerate(FAMILY_CODES):
        extra = {"csa_category": csa_cat, "pop_kinds": []}
        upsert_code("FAMILY", code, name, i, extra=extra)
    for i, (code, name) in enumerate(DOWNTIME_CODES):
        upsert_code("DOWNTIME", code, name, i)
    for i, (code, name) in enumerate(DEFECT_CODES):
        upsert_code("DEFECT", code, name, i)
    for i, (code, name) in enumerate(DEVIATION_CODES):
        upsert_code("DEVIATION", code, name, i)
    for i, (code, name) in enumerate(EQ_EVENT_CODES):
        upsert_code("EQ_EVENT", code, name, i)
    db.flush()

    limit_rows = {(l.process_id, l.family_code): l for l in db.query(MesCcpLimit).all()}

    def upsert_limit(process_code: str, family_code: Optional[str], name: str, param: str,
                     min_v: Optional[float], max_v: Optional[float], unit: str,
                     notes: Optional[str] = None) -> None:
        pid = proc_by_code[process_code].id
        key = (pid, family_code)
        row = limit_rows.get(key)
        is_new = row is None
        if is_new:
            row = MesCcpLimit(process_id=pid, family_code=family_code)
            db.add(row)
            limit_rows[key] = row
        row.name = name
        row.param = param
        row.min_value = min_v
        row.max_value = max_v
        row.unit = unit
        row.check_cycle = "매 배치"
        row.check_method = "육안/센서 측정"
        row.corrective_action = "재작업 또는 폐기, 원인분석 후 이탈일지 작성"
        row.alarm_yn = True
        row.is_active = True
        row.notes = notes
        if is_new:
            created["limits"] += 1

    upsert_limit("P_MIX", None, "배합시간", "time", None, DEFAULT_MIXING_MAX_MIN, "분")
    upsert_limit("P_MIX", None, "주정비율", "alcohol_ratio", 0.9, 1.1, "%")
    # 가열 공정 기본 한계(품온/오븐온도)
    for pcode in ("P_BAKE", "P_BOIL", "P_MELT", "P_TUNNEL"):
        upsert_limit(pcode, None, "품온/오븐온도(기본)", "temp", DEFAULT_HEATING_MIN, None, "℃")
    for fam, temp in BAKE_FAMILY_TEMP.items():
        upsert_limit("P_BAKE", fam, f"{fam} 오븐온도", "temp", temp, None, "℃",
                     notes="예시값 — 현장 확인 필요")
    upsert_limit("P_FREEZE", None, "급속동결 온도", "temp", None, DEFAULT_FREEZING_MAX, "℃")
    upsert_limit("P_METAL", None, "Fe1.5mm/SUS2.5mm 시편 통과", "metal", None, None, None)
    db.flush()

    tpl_by_code = {t.code: t for t in db.query(MesChecklistTemplate).all()}
    for i, t in enumerate(CHECKLIST_TEMPLATES):
        row = tpl_by_code.get(t["code"])
        is_new = row is None
        if is_new:
            row = MesChecklistTemplate(code=t["code"])
            db.add(row)
        row.name = t["name"]
        row.category = t["category"]
        row.cycle = t["cycle"]
        row.items_json = jdumps(t["items"])
        row.approval_json = jdumps({"reviewer": True, "approver": True})
        row.sort_order = i
        row.is_active = True
        if is_new:
            created["templates"] += 1

    db.commit()
    return {"created": created}
