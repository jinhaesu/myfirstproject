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
import math

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


# --- Order Plan (주문 계획) ---
class OrderPlanCreate(BaseModel):
    product_name: str
    product_code: Optional[str] = None
    channel_type: str = "online"  # 'online' or 'offline'
    channel_name: Optional[str] = None
    assignee: str
    plan_date: date
    planned_qty: int = 0
    actual_qty: Optional[int] = 0
    unit_price: Optional[float] = 0
    notes: Optional[str] = None

class OrderPlanUpdate(BaseModel):
    product_name: Optional[str] = None
    product_code: Optional[str] = None
    channel_type: Optional[str] = None
    channel_name: Optional[str] = None
    assignee: Optional[str] = None
    plan_date: Optional[date] = None
    planned_qty: Optional[int] = None
    actual_qty: Optional[int] = None
    unit_price: Optional[float] = None
    notes: Optional[str] = None

class OrderPlanBulkItem(BaseModel):
    id: Optional[int] = None  # None이면 create, 있으면 update
    product_name: str
    product_code: Optional[str] = None
    channel_type: str = "online"
    channel_name: Optional[str] = None
    assignee: str
    plan_date: date
    planned_qty: int = 0
    actual_qty: Optional[int] = 0
    unit_price: Optional[float] = 0
    notes: Optional[str] = None

class OrderPlanBulkRequest(BaseModel):
    items: List[OrderPlanBulkItem]

# --- Production Result (생산 결과) ---
class ProductionResultCreate(BaseModel):
    production_date: date
    team_name: str
    work_shift: str = "주간"
    product_code: Optional[str] = None
    product_name: str
    sale_price: float = 0
    cost_rate: float = 0
    production_hours: float = 0
    expected_sales: float = 0
    profit: float = 0
    hourly_rate: float = 0
    profitability: Optional[str] = None
    quality_status: Optional[str] = None

class ProductionResultUpdate(BaseModel):
    production_date: Optional[date] = None
    team_name: Optional[str] = None
    work_shift: Optional[str] = None
    product_code: Optional[str] = None
    product_name: Optional[str] = None
    sale_price: Optional[float] = None
    cost_rate: Optional[float] = None
    production_hours: Optional[float] = None
    expected_sales: Optional[float] = None
    profit: Optional[float] = None
    hourly_rate: Optional[float] = None
    profitability: Optional[str] = None
    quality_status: Optional[str] = None

class ProductionResultBulkItem(BaseModel):
    id: Optional[int] = None
    production_date: date
    team_name: str
    work_shift: str = "주간"
    product_code: Optional[str] = None
    product_name: str
    sale_price: float = 0
    cost_rate: float = 0
    production_hours: float = 0
    expected_sales: float = 0
    profit: float = 0
    hourly_rate: float = 0
    profitability: Optional[str] = None
    quality_status: Optional[str] = None

class ProductionResultBulkRequest(BaseModel):
    items: List[ProductionResultBulkItem]

# --- Production Plan V2 (생산 계획 v2) ---
class ProductionPlanV2Create(BaseModel):
    plan_date: date
    product_name: str
    product_code: Optional[str] = None
    planned_qty: int = 0
    required_hours: Optional[float] = 0
    required_manpower: Optional[int] = 0
    avg_hourly_rate: Optional[float] = 0
    order_plan_qty: Optional[int] = 0
    safety_stock_deficit: Optional[int] = 0
    ai_recommended_qty: Optional[int] = 0
    status: str = "draft"
    notes: Optional[str] = None

class ProductionPlanV2Update(BaseModel):
    plan_date: Optional[date] = None
    product_name: Optional[str] = None
    product_code: Optional[str] = None
    planned_qty: Optional[int] = None
    required_hours: Optional[float] = None
    required_manpower: Optional[int] = None
    avg_hourly_rate: Optional[float] = None
    order_plan_qty: Optional[int] = None
    safety_stock_deficit: Optional[int] = None
    ai_recommended_qty: Optional[int] = None
    status: Optional[str] = None
    notes: Optional[str] = None

class AiRecommendRequest(BaseModel):
    product_name: str
    plan_date: date

class SharePlanRequest(BaseModel):
    plan_ids: List[int]
    format: str = "email"  # email, kakao, slack, etc.
    recipients: Optional[List[str]] = None
    message: Optional[str] = None


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


# ══════════════════════════════════════════════
#  5. 주문 계획 (Order Plans)
# ══════════════════════════════════════════════

@router.get("/order-plans")
def list_order_plans(
    start_date: Optional[str] = None,  # YYYY-MM-DD
    end_date: Optional[str] = None,
    product_name: Optional[str] = None,
    channel_type: Optional[str] = None,
    assignee: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """주문 계획 목록 조회 (필터 지원)"""
    try:
        from app.db_models import ScmOrderPlan

        query = db.query(ScmOrderPlan)

        if start_date:
            query = query.filter(ScmOrderPlan.plan_date >= date.fromisoformat(start_date))
        if end_date:
            query = query.filter(ScmOrderPlan.plan_date <= date.fromisoformat(end_date))
        if product_name:
            query = query.filter(ScmOrderPlan.product_name.ilike(f"%{product_name}%"))
        if channel_type:
            query = query.filter(ScmOrderPlan.channel_type == channel_type)
        if assignee:
            query = query.filter(ScmOrderPlan.assignee.ilike(f"%{assignee}%"))

        plans = query.order_by(ScmOrderPlan.plan_date.desc(), ScmOrderPlan.id.desc()).all()

        return {
            "success": True,
            "data": [
                {
                    "id": p.id,
                    "product_name": p.product_name,
                    "product_code": p.product_code,
                    "channel_type": p.channel_type,
                    "channel_name": p.channel_name,
                    "assignee": p.assignee,
                    "plan_date": str(p.plan_date) if p.plan_date else None,
                    "planned_qty": p.planned_qty,
                    "actual_qty": p.actual_qty,
                    "unit_price": p.unit_price,
                    "notes": p.notes,
                    "created_at": p.created_at.isoformat() if p.created_at else None,
                    "updated_at": p.updated_at.isoformat() if p.updated_at else None,
                }
                for p in plans
            ],
            "total": len(plans),
        }
    except Exception as e:
        logger.error(f"주문 계획 목록 조회 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/order-plans")
def create_order_plans(
    body: List[OrderPlanCreate],
    db: Session = Depends(get_db),
):
    """주문 계획 생성 (단건/복수건 지원)"""
    try:
        from app.db_models import ScmOrderPlan

        created = []
        for item in body:
            plan = ScmOrderPlan(
                product_name=item.product_name,
                product_code=item.product_code,
                channel_type=item.channel_type,
                channel_name=item.channel_name,
                assignee=item.assignee,
                plan_date=item.plan_date,
                planned_qty=item.planned_qty,
                actual_qty=item.actual_qty,
                unit_price=item.unit_price,
                notes=item.notes,
            )
            db.add(plan)
            db.flush()
            created.append({"id": plan.id, "product_name": plan.product_name})

        db.commit()
        return {"success": True, "data": created, "count": len(created)}
    except Exception as e:
        db.rollback()
        logger.error(f"주문 계획 생성 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/order-plans/{plan_id}")
def update_order_plan(
    plan_id: int,
    body: OrderPlanUpdate,
    db: Session = Depends(get_db),
):
    """주문 계획 단건 수정"""
    try:
        from app.db_models import ScmOrderPlan

        plan = db.query(ScmOrderPlan).filter(ScmOrderPlan.id == plan_id).first()
        if not plan:
            raise HTTPException(status_code=404, detail="주문 계획을 찾을 수 없습니다")

        update_data = body.model_dump(exclude_unset=True)
        for key, value in update_data.items():
            setattr(plan, key, value)

        db.commit()
        return {"success": True, "message": "주문 계획이 수정되었습니다"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"주문 계획 수정 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/order-plans/{plan_id}")
def delete_order_plan(
    plan_id: int,
    db: Session = Depends(get_db),
):
    """주문 계획 삭제"""
    try:
        from app.db_models import ScmOrderPlan

        plan = db.query(ScmOrderPlan).filter(ScmOrderPlan.id == plan_id).first()
        if not plan:
            raise HTTPException(status_code=404, detail="주문 계획을 찾을 수 없습니다")

        db.delete(plan)
        db.commit()
        return {"success": True, "message": "주문 계획이 삭제되었습니다"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"주문 계획 삭제 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/order-plans/bulk")
def bulk_order_plans(
    body: OrderPlanBulkRequest,
    db: Session = Depends(get_db),
):
    """주문 계획 일괄 생성/수정 (Excel-like paste)"""
    try:
        from app.db_models import ScmOrderPlan

        created_count = 0
        updated_count = 0

        for item in body.items:
            if item.id:
                # update existing
                plan = db.query(ScmOrderPlan).filter(ScmOrderPlan.id == item.id).first()
                if plan:
                    for key, value in item.model_dump(exclude={"id"}).items():
                        if value is not None:
                            setattr(plan, key, value)
                    updated_count += 1
            else:
                # create new
                plan = ScmOrderPlan(
                    product_name=item.product_name,
                    product_code=item.product_code,
                    channel_type=item.channel_type,
                    channel_name=item.channel_name,
                    assignee=item.assignee,
                    plan_date=item.plan_date,
                    planned_qty=item.planned_qty,
                    actual_qty=item.actual_qty,
                    unit_price=item.unit_price,
                    notes=item.notes,
                )
                db.add(plan)
                created_count += 1

        db.commit()
        return {
            "success": True,
            "message": f"생성 {created_count}건, 수정 {updated_count}건 처리되었습니다",
            "created": created_count,
            "updated": updated_count,
        }
    except Exception as e:
        db.rollback()
        logger.error(f"주문 계획 일괄 처리 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/order-plans/products")
def get_order_plan_products(
    db: Session = Depends(get_db),
):
    """주문 계획 품명 자동완성용 distinct 목록"""
    try:
        from app.db_models import ScmOrderPlan

        rows = (
            db.query(ScmOrderPlan.product_name)
            .distinct()
            .order_by(ScmOrderPlan.product_name)
            .all()
        )
        return {
            "success": True,
            "data": [r.product_name for r in rows],
        }
    except Exception as e:
        logger.error(f"주문 계획 품명 조회 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/order-plans/assignees")
def get_order_plan_assignees(
    db: Session = Depends(get_db),
):
    """주문 계획 담당자 자동완성용 distinct 목록"""
    try:
        from app.db_models import ScmOrderPlan

        rows = (
            db.query(ScmOrderPlan.assignee)
            .distinct()
            .order_by(ScmOrderPlan.assignee)
            .all()
        )
        return {
            "success": True,
            "data": [r.assignee for r in rows],
        }
    except Exception as e:
        logger.error(f"주문 계획 담당자 조회 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ══════════════════════════════════════════════
#  6. 생산 결과 (Production Results)
# ══════════════════════════════════════════════

@router.get("/production-results")
def list_production_results(
    start_date: Optional[str] = None,  # YYYY-MM-DD
    end_date: Optional[str] = None,
    team_name: Optional[str] = None,
    product_name: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """생산 결과 목록 조회 (필터 지원)"""
    try:
        from app.db_models import ScmProductionResult

        query = db.query(ScmProductionResult)

        if start_date:
            query = query.filter(ScmProductionResult.production_date >= date.fromisoformat(start_date))
        if end_date:
            query = query.filter(ScmProductionResult.production_date <= date.fromisoformat(end_date))
        if team_name:
            query = query.filter(ScmProductionResult.team_name.ilike(f"%{team_name}%"))
        if product_name:
            query = query.filter(ScmProductionResult.product_name.ilike(f"%{product_name}%"))

        results = query.order_by(
            ScmProductionResult.production_date.desc(),
            ScmProductionResult.id.desc(),
        ).all()

        return {
            "success": True,
            "data": [
                {
                    "id": r.id,
                    "production_date": str(r.production_date) if r.production_date else None,
                    "team_name": r.team_name,
                    "work_shift": r.work_shift,
                    "product_code": r.product_code,
                    "product_name": r.product_name,
                    "sale_price": r.sale_price,
                    "cost_rate": r.cost_rate,
                    "production_hours": r.production_hours,
                    "expected_sales": r.expected_sales,
                    "profit": r.profit,
                    "hourly_rate": r.hourly_rate,
                    "profitability": r.profitability,
                    "quality_status": r.quality_status,
                    "created_at": r.created_at.isoformat() if r.created_at else None,
                    "updated_at": r.updated_at.isoformat() if r.updated_at else None,
                }
                for r in results
            ],
            "total": len(results),
        }
    except Exception as e:
        logger.error(f"생산 결과 목록 조회 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/production-results")
def create_production_results(
    body: List[ProductionResultCreate],
    db: Session = Depends(get_db),
):
    """생산 결과 생성 (단건/복수건 지원)"""
    try:
        from app.db_models import ScmProductionResult

        created = []
        for item in body:
            result = ScmProductionResult(
                production_date=item.production_date,
                team_name=item.team_name,
                work_shift=item.work_shift,
                product_code=item.product_code,
                product_name=item.product_name,
                sale_price=item.sale_price,
                cost_rate=item.cost_rate,
                production_hours=item.production_hours,
                expected_sales=item.expected_sales,
                profit=item.profit,
                hourly_rate=item.hourly_rate,
                profitability=item.profitability,
                quality_status=item.quality_status,
            )
            db.add(result)
            db.flush()
            created.append({"id": result.id, "product_name": result.product_name})

        db.commit()
        return {"success": True, "data": created, "count": len(created)}
    except Exception as e:
        db.rollback()
        logger.error(f"생산 결과 생성 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/production-results/{result_id}")
def update_production_result(
    result_id: int,
    body: ProductionResultUpdate,
    db: Session = Depends(get_db),
):
    """생산 결과 단건 수정"""
    try:
        from app.db_models import ScmProductionResult

        result = db.query(ScmProductionResult).filter(ScmProductionResult.id == result_id).first()
        if not result:
            raise HTTPException(status_code=404, detail="생산 결과를 찾을 수 없습니다")

        update_data = body.model_dump(exclude_unset=True)
        for key, value in update_data.items():
            setattr(result, key, value)

        db.commit()
        return {"success": True, "message": "생산 결과가 수정되었습니다"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"생산 결과 수정 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/production-results/{result_id}")
def delete_production_result(
    result_id: int,
    db: Session = Depends(get_db),
):
    """생산 결과 삭제"""
    try:
        from app.db_models import ScmProductionResult

        result = db.query(ScmProductionResult).filter(ScmProductionResult.id == result_id).first()
        if not result:
            raise HTTPException(status_code=404, detail="생산 결과를 찾을 수 없습니다")

        db.delete(result)
        db.commit()
        return {"success": True, "message": "생산 결과가 삭제되었습니다"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"생산 결과 삭제 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/production-results/bulk")
def bulk_production_results(
    body: ProductionResultBulkRequest,
    db: Session = Depends(get_db),
):
    """생산 결과 일괄 생성/수정 (Excel-like paste / Ctrl+V)"""
    try:
        from app.db_models import ScmProductionResult

        created_count = 0
        updated_count = 0

        for item in body.items:
            if item.id:
                result = db.query(ScmProductionResult).filter(ScmProductionResult.id == item.id).first()
                if result:
                    for key, value in item.model_dump(exclude={"id"}).items():
                        if value is not None:
                            setattr(result, key, value)
                    updated_count += 1
            else:
                result = ScmProductionResult(
                    production_date=item.production_date,
                    team_name=item.team_name,
                    work_shift=item.work_shift,
                    product_code=item.product_code,
                    product_name=item.product_name,
                    sale_price=item.sale_price,
                    cost_rate=item.cost_rate,
                    production_hours=item.production_hours,
                    expected_sales=item.expected_sales,
                    profit=item.profit,
                    hourly_rate=item.hourly_rate,
                    profitability=item.profitability,
                    quality_status=item.quality_status,
                )
                db.add(result)
                created_count += 1

        db.commit()
        return {
            "success": True,
            "message": f"생성 {created_count}건, 수정 {updated_count}건 처리되었습니다",
            "created": created_count,
            "updated": updated_count,
        }
    except Exception as e:
        db.rollback()
        logger.error(f"생산 결과 일괄 처리 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/production-results/summary")
def production_results_summary(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """생산 결과 요약 통계 (총 생산, 평균 시간당 생산량, 차트 데이터)"""
    try:
        from app.db_models import ScmProductionResult

        query = db.query(ScmProductionResult)

        if start_date:
            query = query.filter(ScmProductionResult.production_date >= date.fromisoformat(start_date))
        if end_date:
            query = query.filter(ScmProductionResult.production_date <= date.fromisoformat(end_date))

        total_count = query.count()
        total_expected_sales = query.with_entities(
            func.coalesce(func.sum(ScmProductionResult.expected_sales), 0)
        ).scalar()
        total_profit = query.with_entities(
            func.coalesce(func.sum(ScmProductionResult.profit), 0)
        ).scalar()
        avg_hourly_rate = query.with_entities(
            func.coalesce(func.avg(ScmProductionResult.hourly_rate), 0)
        ).scalar()
        total_production_hours = query.with_entities(
            func.coalesce(func.sum(ScmProductionResult.production_hours), 0)
        ).scalar()

        # 일별 생산 추이 차트 데이터
        daily_chart = (
            query.with_entities(
                ScmProductionResult.production_date.label("date"),
                func.count(ScmProductionResult.id).label("count"),
                func.coalesce(func.sum(ScmProductionResult.expected_sales), 0).label("expected_sales"),
                func.coalesce(func.sum(ScmProductionResult.profit), 0).label("profit"),
                func.coalesce(func.avg(ScmProductionResult.hourly_rate), 0).label("avg_hourly_rate"),
            )
            .group_by(ScmProductionResult.production_date)
            .order_by(ScmProductionResult.production_date)
            .all()
        )

        # 팀별 생산 요약
        team_summary = (
            query.with_entities(
                ScmProductionResult.team_name,
                func.count(ScmProductionResult.id).label("count"),
                func.coalesce(func.sum(ScmProductionResult.expected_sales), 0).label("expected_sales"),
                func.coalesce(func.avg(ScmProductionResult.hourly_rate), 0).label("avg_hourly_rate"),
            )
            .group_by(ScmProductionResult.team_name)
            .all()
        )

        return {
            "success": True,
            "data": {
                "total_count": total_count,
                "total_expected_sales": float(total_expected_sales),
                "total_profit": float(total_profit),
                "avg_hourly_rate": round(float(avg_hourly_rate), 2),
                "total_production_hours": float(total_production_hours),
                "daily_chart": [
                    {
                        "date": str(r.date),
                        "count": r.count,
                        "expected_sales": float(r.expected_sales),
                        "profit": float(r.profit),
                        "avg_hourly_rate": round(float(r.avg_hourly_rate), 2),
                    }
                    for r in daily_chart
                ],
                "team_summary": [
                    {
                        "team_name": r.team_name,
                        "count": r.count,
                        "expected_sales": float(r.expected_sales),
                        "avg_hourly_rate": round(float(r.avg_hourly_rate), 2),
                    }
                    for r in team_summary
                ],
            },
        }
    except Exception as e:
        logger.error(f"생산 결과 요약 조회 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/production-results/hourly-rates")
def get_hourly_rates_by_product(
    product_name: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """제품별 과거 시간당 생산량 조회 (생산 계획 수립 참고용)"""
    try:
        from app.db_models import ScmProductionResult

        query = db.query(
            ScmProductionResult.product_name,
            func.avg(ScmProductionResult.hourly_rate).label("avg_hourly_rate"),
            func.min(ScmProductionResult.hourly_rate).label("min_hourly_rate"),
            func.max(ScmProductionResult.hourly_rate).label("max_hourly_rate"),
            func.count(ScmProductionResult.id).label("data_count"),
        )

        if product_name:
            query = query.filter(ScmProductionResult.product_name.ilike(f"%{product_name}%"))

        rows = (
            query.group_by(ScmProductionResult.product_name)
            .order_by(ScmProductionResult.product_name)
            .all()
        )

        return {
            "success": True,
            "data": [
                {
                    "product_name": r.product_name,
                    "avg_hourly_rate": round(float(r.avg_hourly_rate), 2) if r.avg_hourly_rate else 0,
                    "min_hourly_rate": round(float(r.min_hourly_rate), 2) if r.min_hourly_rate else 0,
                    "max_hourly_rate": round(float(r.max_hourly_rate), 2) if r.max_hourly_rate else 0,
                    "data_count": r.data_count,
                }
                for r in rows
            ],
        }
    except Exception as e:
        logger.error(f"시간당 생산량 조회 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ══════════════════════════════════════════════
#  7. 생산 계획 v2 (Production Plans V2)
# ══════════════════════════════════════════════

@router.get("/production-plans-v2")
def list_production_plans_v2(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    product_name: Optional[str] = None,
    status: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """생산 계획 v2 목록 조회"""
    try:
        from app.db_models import ScmProductionPlanV2

        query = db.query(ScmProductionPlanV2)

        if start_date:
            query = query.filter(ScmProductionPlanV2.plan_date >= date.fromisoformat(start_date))
        if end_date:
            query = query.filter(ScmProductionPlanV2.plan_date <= date.fromisoformat(end_date))
        if product_name:
            query = query.filter(ScmProductionPlanV2.product_name.ilike(f"%{product_name}%"))
        if status:
            query = query.filter(ScmProductionPlanV2.status == status)

        plans = query.order_by(
            ScmProductionPlanV2.plan_date.desc(),
            ScmProductionPlanV2.id.desc(),
        ).all()

        return {
            "success": True,
            "data": [
                {
                    "id": p.id,
                    "plan_date": str(p.plan_date) if p.plan_date else None,
                    "product_name": p.product_name,
                    "product_code": p.product_code,
                    "planned_qty": p.planned_qty,
                    "required_hours": p.required_hours,
                    "required_manpower": p.required_manpower,
                    "avg_hourly_rate": p.avg_hourly_rate,
                    "order_plan_qty": p.order_plan_qty,
                    "safety_stock_deficit": p.safety_stock_deficit,
                    "ai_recommended_qty": p.ai_recommended_qty,
                    "status": p.status,
                    "notes": p.notes,
                    "created_at": p.created_at.isoformat() if p.created_at else None,
                    "updated_at": p.updated_at.isoformat() if p.updated_at else None,
                }
                for p in plans
            ],
            "total": len(plans),
        }
    except Exception as e:
        logger.error(f"생산 계획 v2 목록 조회 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/production-plans-v2")
def create_production_plans_v2(
    body: List[ProductionPlanV2Create],
    db: Session = Depends(get_db),
):
    """생산 계획 v2 생성 (단건/복수건 지원)"""
    try:
        from app.db_models import ScmProductionPlanV2

        created = []
        for item in body:
            plan = ScmProductionPlanV2(
                plan_date=item.plan_date,
                product_name=item.product_name,
                product_code=item.product_code,
                planned_qty=item.planned_qty,
                required_hours=item.required_hours,
                required_manpower=item.required_manpower,
                avg_hourly_rate=item.avg_hourly_rate,
                order_plan_qty=item.order_plan_qty,
                safety_stock_deficit=item.safety_stock_deficit,
                ai_recommended_qty=item.ai_recommended_qty,
                status=item.status,
                notes=item.notes,
            )
            db.add(plan)
            db.flush()
            created.append({"id": plan.id, "product_name": plan.product_name})

        db.commit()
        return {"success": True, "data": created, "count": len(created)}
    except Exception as e:
        db.rollback()
        logger.error(f"생산 계획 v2 생성 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/production-plans-v2/{plan_id}")
def update_production_plan_v2(
    plan_id: int,
    body: ProductionPlanV2Update,
    db: Session = Depends(get_db),
):
    """생산 계획 v2 수정"""
    try:
        from app.db_models import ScmProductionPlanV2

        plan = db.query(ScmProductionPlanV2).filter(ScmProductionPlanV2.id == plan_id).first()
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
        logger.error(f"생산 계획 v2 수정 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/production-plans-v2/{plan_id}")
def delete_production_plan_v2(
    plan_id: int,
    db: Session = Depends(get_db),
):
    """생산 계획 v2 삭제"""
    try:
        from app.db_models import ScmProductionPlanV2

        plan = db.query(ScmProductionPlanV2).filter(ScmProductionPlanV2.id == plan_id).first()
        if not plan:
            raise HTTPException(status_code=404, detail="생산 계획을 찾을 수 없습니다")

        db.delete(plan)
        db.commit()
        return {"success": True, "message": "생산 계획이 삭제되었습니다"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"생산 계획 v2 삭제 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/production-plans-v2/ai-recommend")
def ai_recommend_production(
    body: AiRecommendRequest,
    db: Session = Depends(get_db),
):
    """AI 추천 생산량 계산
    - 안전재고 부족분 조회 (ScmInventoryItem)
    - 주문 계획 수량 합산 (ScmOrderPlan)
    - 과거 시간당 생산량 평균 (ScmProductionResult)
    - 추천 수량 = max(안전재고 부족분, 주문계획 합계)
    - 필요 시간 = 추천 수량 / 평균 시간당 생산량
    - 필요 인력 = 필요 시간 / 8
    """
    try:
        from app.db_models import ScmInventoryItem, ScmOrderPlan, ScmProductionResult

        product_name = body.product_name
        plan_date = body.plan_date

        # 1. 안전재고 부족분 조회
        inventory = (
            db.query(ScmInventoryItem)
            .filter(ScmInventoryItem.product_name.ilike(f"%{product_name}%"))
            .first()
        )

        safety_stock_deficit = 0
        current_stock = 0
        safety_stock = 0
        if inventory:
            current_stock = inventory.current_stock or 0
            safety_stock = inventory.safety_stock or 0
            safety_stock_deficit = max(0, safety_stock - current_stock)

        # 2. 해당 날짜의 주문 계획 수량 합산
        order_plan_total = (
            db.query(func.coalesce(func.sum(ScmOrderPlan.planned_qty), 0))
            .filter(
                ScmOrderPlan.product_name.ilike(f"%{product_name}%"),
                ScmOrderPlan.plan_date == plan_date,
            )
            .scalar()
        )
        order_plan_total = int(order_plan_total)

        # 3. 과거 시간당 생산량 평균
        avg_hourly = (
            db.query(func.avg(ScmProductionResult.hourly_rate))
            .filter(ScmProductionResult.product_name.ilike(f"%{product_name}%"))
            .scalar()
        )
        avg_hourly_rate = float(avg_hourly) if avg_hourly else 0

        # 4. 추천 수량 계산
        recommended_qty = max(safety_stock_deficit, order_plan_total)

        # 5. 필요 시간 / 인력 계산
        if avg_hourly_rate > 0:
            required_hours = round(recommended_qty / avg_hourly_rate, 2)
        else:
            required_hours = 0

        required_manpower = math.ceil(required_hours / 8) if required_hours > 0 else 0

        return {
            "success": True,
            "data": {
                "product_name": product_name,
                "plan_date": str(plan_date),
                "safety_stock_deficit": safety_stock_deficit,
                "current_stock": current_stock,
                "safety_stock": safety_stock,
                "order_plan_total": order_plan_total,
                "avg_hourly_rate": round(avg_hourly_rate, 2),
                "recommended_qty": recommended_qty,
                "required_hours": required_hours,
                "required_manpower": required_manpower,
            },
        }
    except Exception as e:
        logger.error(f"AI 추천 생산량 계산 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/production-plans-v2/share")
def share_production_plan(
    body: SharePlanRequest,
    db: Session = Depends(get_db),
):
    """생산 계획 공유 (intent 저장 - 실제 발송은 별도 처리)"""
    try:
        from app.db_models import ScmProductionPlanV2

        # 해당 plan들이 존재하는지 확인
        plans = (
            db.query(ScmProductionPlanV2)
            .filter(ScmProductionPlanV2.id.in_(body.plan_ids))
            .all()
        )

        if not plans:
            raise HTTPException(status_code=404, detail="공유할 생산 계획을 찾을 수 없습니다")

        # 공유 데이터 구성
        shared_plans = [
            {
                "id": p.id,
                "plan_date": str(p.plan_date) if p.plan_date else None,
                "product_name": p.product_name,
                "planned_qty": p.planned_qty,
                "status": p.status,
            }
            for p in plans
        ]

        return {
            "success": True,
            "message": f"{len(plans)}건의 생산 계획 공유가 요청되었습니다",
            "data": {
                "format": body.format,
                "recipients": body.recipients,
                "message": body.message,
                "plans": shared_plans,
                "plan_count": len(plans),
            },
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"생산 계획 공유 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))
