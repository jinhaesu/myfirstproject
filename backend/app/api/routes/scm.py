"""SCM 관리 API 라우트"""
from datetime import datetime, date, timezone, timedelta
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from app.api.routes.auth import get_current_user
from app.database import get_db, SessionLocal
from sqlalchemy.orm import Session
from sqlalchemy import func, extract
import logging
import uuid

router = APIRouter(prefix="/scm", tags=["scm"])
logger = logging.getLogger(__name__)


# ──────────────────────────────────────────────
# Pydantic Request / Response Models
# ──────────────────────────────────────────────

# --- Orders ---
class OrderCreate(BaseModel):
    order_number: Optional[str] = None
    channel: str = "스마트스토어"
    customer_name: str
    product_name: str
    quantity: int = 1
    amount: float = 0
    status: str = "신규접수"
    memo: Optional[str] = None

class OrderStatusUpdate(BaseModel):
    status: str

# --- Workforce ---
class StaffMemberCreate(BaseModel):
    name: str
    department: str = "물류"
    position: str = "사원"
    status: str = "근무중"
    task_area: Optional[str] = None
    contact: Optional[str] = None

class StaffMemberUpdate(BaseModel):
    name: Optional[str] = None
    department: Optional[str] = None
    position: Optional[str] = None
    status: Optional[str] = None
    task_area: Optional[str] = None
    contact: Optional[str] = None

class ScheduleUpdate(BaseModel):
    member_id: int
    work_date: date
    shift_type: str = "주간"

class TaskCreate(BaseModel):
    task_name: str
    assignee_id: Optional[int] = None
    assignee_name: str = ""
    hours_estimated: float = 0
    status: str = "대기"

class TaskUpdate(BaseModel):
    task_name: Optional[str] = None
    assignee_id: Optional[int] = None
    assignee_name: Optional[str] = None
    hours_spent: Optional[float] = None
    hours_estimated: Optional[float] = None
    progress: Optional[int] = None
    status: Optional[str] = None

# --- Production ---
class ProductionPlanCreate(BaseModel):
    product_name: str
    category: str = "스킨케어"
    planned_qty: int = 0
    produced_qty: int = 0
    start_date: date
    end_date: date
    status: str = "계획"
    manager: Optional[str] = None
    memo: Optional[str] = None
    year: int
    month: int

class ProductionPlanUpdate(BaseModel):
    product_name: Optional[str] = None
    category: Optional[str] = None
    planned_qty: Optional[int] = None
    produced_qty: Optional[int] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    status: Optional[str] = None
    manager: Optional[str] = None
    memo: Optional[str] = None

# --- Inventory ---
class InventoryItemCreate(BaseModel):
    sku: str
    product_name: str
    category: str
    current_stock: int = 0
    safety_stock: int = 0
    reorder_point: int = 0
    status: str = "정상"

class InventoryItemUpdate(BaseModel):
    product_name: Optional[str] = None
    category: Optional[str] = None
    current_stock: Optional[int] = None
    safety_stock: Optional[int] = None
    reorder_point: Optional[int] = None
    status: Optional[str] = None
    last_inbound_date: Optional[date] = None

class ShipmentCreate(BaseModel):
    shipment_number: Optional[str] = None
    product_name: str
    sku: str
    quantity: int = 0
    destination: str
    courier: Optional[str] = None
    tracking_number: Optional[str] = None
    status: str = "준비중"

class ShipmentUpdate(BaseModel):
    product_name: Optional[str] = None
    sku: Optional[str] = None
    quantity: Optional[int] = None
    destination: Optional[str] = None
    courier: Optional[str] = None
    tracking_number: Optional[str] = None
    status: Optional[str] = None


# ══════════════════════════════════════════════
#  1. 주문현황 (Orders)
# ══════════════════════════════════════════════

@router.get("/orders")
def list_orders(
    year: Optional[int] = None,
    month: Optional[int] = None,
    status: Optional[str] = None,
    channel: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """주문 목록 조회 (필터 지원)"""
    try:
        from app.db_models import ScmOrder

        query = db.query(ScmOrder).filter(ScmOrder.user_id == current_user["email"])

        if year:
            query = query.filter(extract("year", ScmOrder.order_date) == year)
        if month:
            query = query.filter(extract("month", ScmOrder.order_date) == month)
        if status:
            query = query.filter(ScmOrder.status == status)
        if channel:
            query = query.filter(ScmOrder.channel == channel)

        orders = query.order_by(ScmOrder.order_date.desc()).all()

        return {
            "success": True,
            "data": [
                {
                    "id": o.id,
                    "order_number": o.order_number,
                    "order_date": o.order_date.isoformat() if o.order_date else None,
                    "channel": o.channel,
                    "customer_name": o.customer_name,
                    "product_name": o.product_name,
                    "quantity": o.quantity,
                    "amount": o.amount,
                    "status": o.status,
                    "memo": o.memo,
                    "created_at": o.created_at.isoformat() if o.created_at else None,
                }
                for o in orders
            ],
            "total": len(orders),
        }
    except Exception as e:
        logger.error(f"주문 목록 조회 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/orders/summary")
def orders_summary(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """주문 요약 통계"""
    try:
        from app.db_models import ScmOrder

        user_email = current_user["email"]
        base = db.query(ScmOrder).filter(ScmOrder.user_id == user_email)

        today = datetime.now(timezone.utc).date()
        today_count = base.filter(func.date(ScmOrder.order_date) == today).count()
        pending = base.filter(ScmOrder.status.in_(["신규접수", "확인완료"])).count()
        shipping = base.filter(ScmOrder.status.in_(["배송준비", "배송중"])).count()
        revenue = base.with_entities(func.coalesce(func.sum(ScmOrder.amount), 0)).scalar()

        return {
            "success": True,
            "data": {
                "today_count": today_count,
                "pending": pending,
                "shipping": shipping,
                "revenue": float(revenue),
            },
        }
    except Exception as e:
        logger.error(f"주문 요약 조회 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/orders/chart/daily")
def orders_chart_daily(
    days: int = 30,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """일별 주문 추이 차트 데이터"""
    try:
        from app.db_models import ScmOrder

        since = datetime.now(timezone.utc) - timedelta(days=days)
        rows = (
            db.query(
                func.date(ScmOrder.order_date).label("day"),
                func.count(ScmOrder.id).label("count"),
                func.coalesce(func.sum(ScmOrder.amount), 0).label("amount"),
            )
            .filter(
                ScmOrder.user_id == current_user["email"],
                ScmOrder.order_date >= since,
            )
            .group_by(func.date(ScmOrder.order_date))
            .order_by(func.date(ScmOrder.order_date))
            .all()
        )

        return {
            "success": True,
            "data": [
                {"date": str(r.day), "count": r.count, "amount": float(r.amount)}
                for r in rows
            ],
        }
    except Exception as e:
        logger.error(f"일별 주문 차트 조회 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/orders/chart/by-channel")
def orders_chart_by_channel(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """채널별 주문 분포 차트 데이터"""
    try:
        from app.db_models import ScmOrder

        rows = (
            db.query(
                ScmOrder.channel,
                func.count(ScmOrder.id).label("count"),
                func.coalesce(func.sum(ScmOrder.amount), 0).label("amount"),
            )
            .filter(ScmOrder.user_id == current_user["email"])
            .group_by(ScmOrder.channel)
            .all()
        )

        return {
            "success": True,
            "data": [
                {"channel": r.channel, "count": r.count, "amount": float(r.amount)}
                for r in rows
            ],
        }
    except Exception as e:
        logger.error(f"채널별 주문 차트 조회 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/orders")
def create_order(
    body: OrderCreate,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """주문 수동 생성"""
    try:
        from app.db_models import ScmOrder

        order_number = body.order_number or f"ORD-{datetime.now().strftime('%Y%m%d%H%M%S')}-{uuid.uuid4().hex[:4].upper()}"

        order = ScmOrder(
            order_number=order_number,
            channel=body.channel,
            customer_name=body.customer_name,
            product_name=body.product_name,
            quantity=body.quantity,
            amount=body.amount,
            status=body.status,
            memo=body.memo,
            user_id=current_user["email"],
        )
        db.add(order)
        db.commit()
        db.refresh(order)

        return {"success": True, "data": {"id": order.id, "order_number": order.order_number}}
    except Exception as e:
        db.rollback()
        logger.error(f"주문 생성 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/orders/{order_id}/status")
def update_order_status(
    order_id: int,
    body: OrderStatusUpdate,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """주문 상태 변경"""
    try:
        from app.db_models import ScmOrder

        order = db.query(ScmOrder).filter(
            ScmOrder.id == order_id,
            ScmOrder.user_id == current_user["email"],
        ).first()

        if not order:
            raise HTTPException(status_code=404, detail="주문을 찾을 수 없습니다")

        order.status = body.status
        db.commit()

        return {"success": True, "message": "상태가 변경되었습니다"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"주문 상태 변경 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/orders/{order_id}")
def delete_order(
    order_id: int,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """주문 삭제"""
    try:
        from app.db_models import ScmOrder

        order = db.query(ScmOrder).filter(
            ScmOrder.id == order_id,
            ScmOrder.user_id == current_user["email"],
        ).first()

        if not order:
            raise HTTPException(status_code=404, detail="주문을 찾을 수 없습니다")

        db.delete(order)
        db.commit()

        return {"success": True, "message": "주문이 삭제되었습니다"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"주문 삭제 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ══════════════════════════════════════════════
#  2. 인력배치 / 공수 (Workforce)
# ══════════════════════════════════════════════

@router.get("/workforce/members")
def list_staff_members(
    department: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """인력 목록 조회"""
    try:
        from app.db_models import ScmStaffMember

        query = db.query(ScmStaffMember).filter(ScmStaffMember.user_id == current_user["email"])

        if department:
            query = query.filter(ScmStaffMember.department == department)

        members = query.order_by(ScmStaffMember.department, ScmStaffMember.name).all()

        return {
            "success": True,
            "data": [
                {
                    "id": m.id,
                    "name": m.name,
                    "department": m.department,
                    "position": m.position,
                    "status": m.status,
                    "task_area": m.task_area,
                    "contact": m.contact,
                    "created_at": m.created_at.isoformat() if m.created_at else None,
                }
                for m in members
            ],
            "total": len(members),
        }
    except Exception as e:
        logger.error(f"인력 목록 조회 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/workforce/summary")
def workforce_summary(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """인력 요약 통계"""
    try:
        from app.db_models import ScmStaffMember, ScmTask

        user_email = current_user["email"]
        base = db.query(ScmStaffMember).filter(ScmStaffMember.user_id == user_email)

        total = base.count()
        working = base.filter(ScmStaffMember.status == "근무중").count()
        off_duty = base.filter(ScmStaffMember.status.in_(["휴무", "연차"])).count()

        task_base = db.query(ScmTask).filter(ScmTask.user_id == user_email)
        active_tasks = task_base.filter(ScmTask.status == "진행중").count()

        return {
            "success": True,
            "data": {
                "total_members": total,
                "working": working,
                "off_duty": off_duty,
                "active_tasks": active_tasks,
            },
        }
    except Exception as e:
        logger.error(f"인력 요약 조회 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/workforce/members")
def add_staff_member(
    body: StaffMemberCreate,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """인력 추가"""
    try:
        from app.db_models import ScmStaffMember

        member = ScmStaffMember(
            name=body.name,
            department=body.department,
            position=body.position,
            status=body.status,
            task_area=body.task_area,
            contact=body.contact,
            user_id=current_user["email"],
        )
        db.add(member)
        db.commit()
        db.refresh(member)

        return {"success": True, "data": {"id": member.id, "name": member.name}}
    except Exception as e:
        db.rollback()
        logger.error(f"인력 추가 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/workforce/members/{member_id}")
def update_staff_member(
    member_id: int,
    body: StaffMemberUpdate,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """인력 정보 수정"""
    try:
        from app.db_models import ScmStaffMember

        member = db.query(ScmStaffMember).filter(
            ScmStaffMember.id == member_id,
            ScmStaffMember.user_id == current_user["email"],
        ).first()

        if not member:
            raise HTTPException(status_code=404, detail="인력을 찾을 수 없습니다")

        update_data = body.model_dump(exclude_unset=True)
        for key, value in update_data.items():
            setattr(member, key, value)

        db.commit()
        return {"success": True, "message": "인력 정보가 수정되었습니다"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"인력 수정 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/workforce/members/{member_id}")
def delete_staff_member(
    member_id: int,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """인력 삭제"""
    try:
        from app.db_models import ScmStaffMember

        member = db.query(ScmStaffMember).filter(
            ScmStaffMember.id == member_id,
            ScmStaffMember.user_id == current_user["email"],
        ).first()

        if not member:
            raise HTTPException(status_code=404, detail="인력을 찾을 수 없습니다")

        db.delete(member)
        db.commit()
        return {"success": True, "message": "인력이 삭제되었습니다"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"인력 삭제 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/workforce/schedule")
def get_weekly_schedule(
    week_start: str,  # YYYY-MM-DD
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """주간 스케줄 조회"""
    try:
        from app.db_models import ScmSchedule, ScmStaffMember

        start = date.fromisoformat(week_start)
        end = start + timedelta(days=6)

        schedules = (
            db.query(ScmSchedule)
            .filter(
                ScmSchedule.user_id == current_user["email"],
                ScmSchedule.work_date >= start,
                ScmSchedule.work_date <= end,
            )
            .all()
        )

        members = (
            db.query(ScmStaffMember)
            .filter(ScmStaffMember.user_id == current_user["email"])
            .all()
        )

        return {
            "success": True,
            "data": {
                "week_start": str(start),
                "week_end": str(end),
                "members": [
                    {"id": m.id, "name": m.name, "department": m.department}
                    for m in members
                ],
                "schedules": [
                    {
                        "id": s.id,
                        "member_id": s.member_id,
                        "work_date": str(s.work_date),
                        "shift_type": s.shift_type,
                    }
                    for s in schedules
                ],
            },
        }
    except Exception as e:
        logger.error(f"주간 스케줄 조회 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/workforce/schedule")
def update_schedule_cell(
    body: ScheduleUpdate,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """스케줄 셀 업데이트 (upsert)"""
    try:
        from app.db_models import ScmSchedule

        existing = (
            db.query(ScmSchedule)
            .filter(
                ScmSchedule.user_id == current_user["email"],
                ScmSchedule.member_id == body.member_id,
                ScmSchedule.work_date == body.work_date,
            )
            .first()
        )

        if existing:
            existing.shift_type = body.shift_type
        else:
            schedule = ScmSchedule(
                member_id=body.member_id,
                work_date=body.work_date,
                shift_type=body.shift_type,
                user_id=current_user["email"],
            )
            db.add(schedule)

        db.commit()
        return {"success": True, "message": "스케줄이 업데이트되었습니다"}
    except Exception as e:
        db.rollback()
        logger.error(f"스케줄 업데이트 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/workforce/tasks")
def list_tasks(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """업무 목록 조회"""
    try:
        from app.db_models import ScmTask

        tasks = (
            db.query(ScmTask)
            .filter(ScmTask.user_id == current_user["email"])
            .order_by(ScmTask.created_at.desc())
            .all()
        )

        return {
            "success": True,
            "data": [
                {
                    "id": t.id,
                    "task_name": t.task_name,
                    "assignee_id": t.assignee_id,
                    "assignee_name": t.assignee_name,
                    "hours_spent": t.hours_spent,
                    "hours_estimated": t.hours_estimated,
                    "progress": t.progress,
                    "status": t.status,
                    "created_at": t.created_at.isoformat() if t.created_at else None,
                }
                for t in tasks
            ],
            "total": len(tasks),
        }
    except Exception as e:
        logger.error(f"업무 목록 조회 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/workforce/tasks")
def add_task(
    body: TaskCreate,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """업무 추가"""
    try:
        from app.db_models import ScmTask

        task = ScmTask(
            task_name=body.task_name,
            assignee_id=body.assignee_id,
            assignee_name=body.assignee_name,
            hours_estimated=body.hours_estimated,
            status=body.status,
            user_id=current_user["email"],
        )
        db.add(task)
        db.commit()
        db.refresh(task)

        return {"success": True, "data": {"id": task.id, "task_name": task.task_name}}
    except Exception as e:
        db.rollback()
        logger.error(f"업무 추가 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/workforce/tasks/{task_id}")
def update_task(
    task_id: int,
    body: TaskUpdate,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """업무 수정"""
    try:
        from app.db_models import ScmTask

        task = db.query(ScmTask).filter(
            ScmTask.id == task_id,
            ScmTask.user_id == current_user["email"],
        ).first()

        if not task:
            raise HTTPException(status_code=404, detail="업무를 찾을 수 없습니다")

        update_data = body.model_dump(exclude_unset=True)
        for key, value in update_data.items():
            setattr(task, key, value)

        db.commit()
        return {"success": True, "message": "업무가 수정되었습니다"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"업무 수정 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ══════════════════════════════════════════════
#  3. 생산계획 (Production)
# ══════════════════════════════════════════════

@router.get("/production/plans")
def list_production_plans(
    year: Optional[int] = None,
    month: Optional[int] = None,
    status: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """생산 계획 목록 조회"""
    try:
        from app.db_models import ScmProductionPlan

        query = db.query(ScmProductionPlan).filter(
            ScmProductionPlan.user_id == current_user["email"]
        )

        if year:
            query = query.filter(ScmProductionPlan.year == year)
        if month:
            query = query.filter(ScmProductionPlan.month == month)
        if status:
            query = query.filter(ScmProductionPlan.status == status)

        plans = query.order_by(ScmProductionPlan.start_date.desc()).all()

        return {
            "success": True,
            "data": [
                {
                    "id": p.id,
                    "product_name": p.product_name,
                    "category": p.category,
                    "planned_qty": p.planned_qty,
                    "produced_qty": p.produced_qty,
                    "start_date": str(p.start_date) if p.start_date else None,
                    "end_date": str(p.end_date) if p.end_date else None,
                    "status": p.status,
                    "manager": p.manager,
                    "memo": p.memo,
                    "year": p.year,
                    "month": p.month,
                    "created_at": p.created_at.isoformat() if p.created_at else None,
                }
                for p in plans
            ],
            "total": len(plans),
        }
    except Exception as e:
        logger.error(f"생산 계획 조회 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/production/summary")
def production_summary(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """생산 계획 요약 통계"""
    try:
        from app.db_models import ScmProductionPlan

        user_email = current_user["email"]
        base = db.query(ScmProductionPlan).filter(ScmProductionPlan.user_id == user_email)

        total = base.count()
        in_progress = base.filter(ScmProductionPlan.status == "생산중").count()
        completed = base.filter(ScmProductionPlan.status == "완료").count()
        delayed = base.filter(ScmProductionPlan.status == "지연").count()

        planned_total = base.with_entities(
            func.coalesce(func.sum(ScmProductionPlan.planned_qty), 0)
        ).scalar()
        produced_total = base.with_entities(
            func.coalesce(func.sum(ScmProductionPlan.produced_qty), 0)
        ).scalar()

        return {
            "success": True,
            "data": {
                "total_plans": total,
                "in_progress": in_progress,
                "completed": completed,
                "delayed": delayed,
                "planned_total": int(planned_total),
                "produced_total": int(produced_total),
                "achievement_rate": round(int(produced_total) / int(planned_total) * 100, 1) if planned_total else 0,
            },
        }
    except Exception as e:
        logger.error(f"생산 요약 조회 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/production/chart/monthly")
def production_chart_monthly(
    year: Optional[int] = None,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """월별 계획 대비 실적 차트 데이터"""
    try:
        from app.db_models import ScmProductionPlan

        target_year = year or datetime.now().year
        rows = (
            db.query(
                ScmProductionPlan.month,
                func.coalesce(func.sum(ScmProductionPlan.planned_qty), 0).label("planned"),
                func.coalesce(func.sum(ScmProductionPlan.produced_qty), 0).label("produced"),
            )
            .filter(
                ScmProductionPlan.user_id == current_user["email"],
                ScmProductionPlan.year == target_year,
            )
            .group_by(ScmProductionPlan.month)
            .order_by(ScmProductionPlan.month)
            .all()
        )

        return {
            "success": True,
            "data": [
                {
                    "month": r.month,
                    "planned": int(r.planned),
                    "produced": int(r.produced),
                }
                for r in rows
            ],
        }
    except Exception as e:
        logger.error(f"월별 생산 차트 조회 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/production/plans")
def create_production_plan(
    body: ProductionPlanCreate,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """생산 계획 생성"""
    try:
        from app.db_models import ScmProductionPlan

        plan = ScmProductionPlan(
            product_name=body.product_name,
            category=body.category,
            planned_qty=body.planned_qty,
            produced_qty=body.produced_qty,
            start_date=body.start_date,
            end_date=body.end_date,
            status=body.status,
            manager=body.manager,
            memo=body.memo,
            year=body.year,
            month=body.month,
            user_id=current_user["email"],
        )
        db.add(plan)
        db.commit()
        db.refresh(plan)

        return {"success": True, "data": {"id": plan.id, "product_name": plan.product_name}}
    except Exception as e:
        db.rollback()
        logger.error(f"생산 계획 생성 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/production/plans/{plan_id}")
def update_production_plan(
    plan_id: int,
    body: ProductionPlanUpdate,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """생산 계획 수정"""
    try:
        from app.db_models import ScmProductionPlan

        plan = db.query(ScmProductionPlan).filter(
            ScmProductionPlan.id == plan_id,
            ScmProductionPlan.user_id == current_user["email"],
        ).first()

        if not plan:
            raise HTTPException(status_code=404, detail="생산 계획을 찾을 수 없습니다")

        update_data = body.model_dump(exclude_unset=True)
        for key, value in update_data.items():
            setattr(plan, key, value)

        db.commit()
        return {"success": True, "message": "생산 계획이 수정되었습니다"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"생산 계획 수정 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/production/plans/{plan_id}")
def delete_production_plan(
    plan_id: int,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """생산 계획 삭제"""
    try:
        from app.db_models import ScmProductionPlan

        plan = db.query(ScmProductionPlan).filter(
            ScmProductionPlan.id == plan_id,
            ScmProductionPlan.user_id == current_user["email"],
        ).first()

        if not plan:
            raise HTTPException(status_code=404, detail="생산 계획을 찾을 수 없습니다")

        db.delete(plan)
        db.commit()
        return {"success": True, "message": "생산 계획이 삭제되었습니다"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"생산 계획 삭제 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ══════════════════════════════════════════════
#  4. 재고 / 출고 (Inventory)
# ══════════════════════════════════════════════

@router.get("/inventory/items")
def list_inventory_items(
    category: Optional[str] = None,
    status: Optional[str] = None,
    search: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """재고 목록 조회"""
    try:
        from app.db_models import ScmInventoryItem

        query = db.query(ScmInventoryItem).filter(
            ScmInventoryItem.user_id == current_user["email"]
        )

        if category:
            query = query.filter(ScmInventoryItem.category == category)
        if status:
            query = query.filter(ScmInventoryItem.status == status)
        if search:
            query = query.filter(
                (ScmInventoryItem.product_name.ilike(f"%{search}%"))
                | (ScmInventoryItem.sku.ilike(f"%{search}%"))
            )

        items = query.order_by(ScmInventoryItem.product_name).all()

        return {
            "success": True,
            "data": [
                {
                    "id": i.id,
                    "sku": i.sku,
                    "product_name": i.product_name,
                    "category": i.category,
                    "current_stock": i.current_stock,
                    "safety_stock": i.safety_stock,
                    "reorder_point": i.reorder_point,
                    "status": i.status,
                    "last_inbound_date": str(i.last_inbound_date) if i.last_inbound_date else None,
                    "created_at": i.created_at.isoformat() if i.created_at else None,
                }
                for i in items
            ],
            "total": len(items),
        }
    except Exception as e:
        logger.error(f"재고 목록 조회 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/inventory/summary")
def inventory_summary(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """재고 요약 통계"""
    try:
        from app.db_models import ScmInventoryItem, ScmShipment

        user_email = current_user["email"]
        base = db.query(ScmInventoryItem).filter(ScmInventoryItem.user_id == user_email)

        total_items = base.count()
        normal = base.filter(ScmInventoryItem.status == "정상").count()
        warning = base.filter(ScmInventoryItem.status == "주의").count()
        shortage = base.filter(ScmInventoryItem.status.in_(["부족", "품절"])).count()

        total_stock = base.with_entities(
            func.coalesce(func.sum(ScmInventoryItem.current_stock), 0)
        ).scalar()

        shipment_base = db.query(ScmShipment).filter(ScmShipment.user_id == user_email)
        today = datetime.now(timezone.utc).date()
        today_shipments = shipment_base.filter(
            func.date(ScmShipment.shipment_date) == today
        ).count()

        return {
            "success": True,
            "data": {
                "total_items": total_items,
                "normal": normal,
                "warning": warning,
                "shortage": shortage,
                "total_stock": int(total_stock),
                "today_shipments": today_shipments,
            },
        }
    except Exception as e:
        logger.error(f"재고 요약 조회 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/inventory/items")
def add_inventory_item(
    body: InventoryItemCreate,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """재고 항목 추가"""
    try:
        from app.db_models import ScmInventoryItem

        item = ScmInventoryItem(
            sku=body.sku,
            product_name=body.product_name,
            category=body.category,
            current_stock=body.current_stock,
            safety_stock=body.safety_stock,
            reorder_point=body.reorder_point,
            status=body.status,
            user_id=current_user["email"],
        )
        db.add(item)
        db.commit()
        db.refresh(item)

        return {"success": True, "data": {"id": item.id, "sku": item.sku}}
    except Exception as e:
        db.rollback()
        logger.error(f"재고 항목 추가 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/inventory/items/{item_id}")
def update_inventory_item(
    item_id: int,
    body: InventoryItemUpdate,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """재고 항목 수정"""
    try:
        from app.db_models import ScmInventoryItem

        item = db.query(ScmInventoryItem).filter(
            ScmInventoryItem.id == item_id,
            ScmInventoryItem.user_id == current_user["email"],
        ).first()

        if not item:
            raise HTTPException(status_code=404, detail="재고 항목을 찾을 수 없습니다")

        update_data = body.model_dump(exclude_unset=True)
        for key, value in update_data.items():
            setattr(item, key, value)

        db.commit()
        return {"success": True, "message": "재고 항목이 수정되었습니다"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"재고 항목 수정 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/inventory/shipments")
def list_shipments(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """출고 목록 조회"""
    try:
        from app.db_models import ScmShipment

        shipments = (
            db.query(ScmShipment)
            .filter(ScmShipment.user_id == current_user["email"])
            .order_by(ScmShipment.shipment_date.desc())
            .all()
        )

        return {
            "success": True,
            "data": [
                {
                    "id": s.id,
                    "shipment_number": s.shipment_number,
                    "shipment_date": s.shipment_date.isoformat() if s.shipment_date else None,
                    "product_name": s.product_name,
                    "sku": s.sku,
                    "quantity": s.quantity,
                    "destination": s.destination,
                    "courier": s.courier,
                    "tracking_number": s.tracking_number,
                    "status": s.status,
                    "created_at": s.created_at.isoformat() if s.created_at else None,
                }
                for s in shipments
            ],
            "total": len(shipments),
        }
    except Exception as e:
        logger.error(f"출고 목록 조회 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/inventory/shipments")
def add_shipment(
    body: ShipmentCreate,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """출고 등록"""
    try:
        from app.db_models import ScmShipment

        shipment_number = body.shipment_number or f"SHP-{datetime.now().strftime('%Y%m%d%H%M%S')}-{uuid.uuid4().hex[:4].upper()}"

        shipment = ScmShipment(
            shipment_number=shipment_number,
            product_name=body.product_name,
            sku=body.sku,
            quantity=body.quantity,
            destination=body.destination,
            courier=body.courier,
            tracking_number=body.tracking_number,
            status=body.status,
            user_id=current_user["email"],
        )
        db.add(shipment)
        db.commit()
        db.refresh(shipment)

        return {"success": True, "data": {"id": shipment.id, "shipment_number": shipment.shipment_number}}
    except Exception as e:
        db.rollback()
        logger.error(f"출고 등록 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/inventory/shipments/{shipment_id}")
def update_shipment(
    shipment_id: int,
    body: ShipmentUpdate,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """출고 정보 수정"""
    try:
        from app.db_models import ScmShipment

        shipment = db.query(ScmShipment).filter(
            ScmShipment.id == shipment_id,
            ScmShipment.user_id == current_user["email"],
        ).first()

        if not shipment:
            raise HTTPException(status_code=404, detail="출고 정보를 찾을 수 없습니다")

        update_data = body.model_dump(exclude_unset=True)
        for key, value in update_data.items():
            setattr(shipment, key, value)

        db.commit()
        return {"success": True, "message": "출고 정보가 수정되었습니다"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"출고 수정 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/inventory/alerts")
def inventory_alerts(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """재고 부족 알림 목록"""
    try:
        from app.db_models import ScmInventoryItem

        alerts = (
            db.query(ScmInventoryItem)
            .filter(
                ScmInventoryItem.user_id == current_user["email"],
                ScmInventoryItem.current_stock <= ScmInventoryItem.reorder_point,
            )
            .order_by(ScmInventoryItem.current_stock.asc())
            .all()
        )

        return {
            "success": True,
            "data": [
                {
                    "id": i.id,
                    "sku": i.sku,
                    "product_name": i.product_name,
                    "category": i.category,
                    "current_stock": i.current_stock,
                    "safety_stock": i.safety_stock,
                    "reorder_point": i.reorder_point,
                    "status": i.status,
                    "shortage": i.reorder_point - i.current_stock,
                }
                for i in alerts
            ],
            "total": len(alerts),
        }
    except Exception as e:
        logger.error(f"재고 알림 조회 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))
