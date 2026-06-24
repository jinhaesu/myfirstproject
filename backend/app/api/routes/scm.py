"""SCM 관리 API 라우트"""
from datetime import datetime, date, timezone, timedelta
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, BackgroundTasks
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
    production_date: date  # 날짜
    manager: str  # 담당자
    location: Optional[str] = None  # 생산 위치
    product_category: Optional[str] = None  # 품목류
    product_name: str  # 품목명
    quantity: float = 0  # 생산량
    total_hours: float = 0  # 생산 투여 총 시간
    unit_price: float = 0  # 생산 단가
    total_value: float = 0  # 총 생산액
    deduction: float = 0  # 공제액
    cost: float = 0  # 원가
    total_cost: float = 0  # 원가 총액
    shift_type: Optional[str] = "주간"  # 주간/야간

class ProductionResultUpdate(BaseModel):
    production_date: Optional[date] = None
    manager: Optional[str] = None
    location: Optional[str] = None
    product_category: Optional[str] = None
    product_name: Optional[str] = None
    quantity: Optional[float] = None
    total_hours: Optional[float] = None
    unit_price: Optional[float] = None
    total_value: Optional[float] = None
    deduction: Optional[float] = None
    cost: Optional[float] = None
    total_cost: Optional[float] = None
    shift_type: Optional[str] = None

class ProductionResultBulkItem(BaseModel):
    id: Optional[int] = None
    production_date: date
    manager: str
    location: Optional[str] = None
    product_category: Optional[str] = None
    product_name: str
    quantity: float = 0
    total_hours: float = 0
    unit_price: float = 0
    total_value: float = 0
    deduction: float = 0
    cost: float = 0
    total_cost: float = 0
    shift_type: Optional[str] = "주간"

class ProductionResultBulkRequest(BaseModel):
    items: List[ProductionResultBulkItem]

# --- Production Plan V2 (생산 계획 v2) ---
class ProductionPlanV2Create(BaseModel):
    plan_date: date  # 날짜
    manager: Optional[str] = None  # 담당자
    location: Optional[str] = None  # 생산 위치
    product_category: Optional[str] = None  # 품목류
    product_name: str  # 품목명
    quantity: float = 0  # 생산량
    total_hours: float = 0  # 생산 투여 총 시간
    unit_price: float = 0  # 생산 단가
    total_value: float = 0  # 총 생산액
    deduction: float = 0  # 공제액
    cost: float = 0  # 원가
    total_cost: float = 0  # 원가 총액
    shift_type: Optional[str] = "주간"  # 주간/야간
    ai_recommended_qty: Optional[float] = 0  # AI 추천 생산량
    status: str = "draft"
    notes: Optional[str] = None

class ProductionPlanV2Update(BaseModel):
    plan_date: Optional[date] = None
    manager: Optional[str] = None
    location: Optional[str] = None
    product_category: Optional[str] = None
    product_name: Optional[str] = None
    quantity: Optional[float] = None
    total_hours: Optional[float] = None
    unit_price: Optional[float] = None
    total_value: Optional[float] = None
    deduction: Optional[float] = None
    cost: Optional[float] = None
    total_cost: Optional[float] = None
    shift_type: Optional[str] = None
    ai_recommended_qty: Optional[float] = None
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


# --- Product Master (품목 관리) ---
class ProductCreate(BaseModel):
    product_name: str
    product_code: Optional[str] = None
    product_category: Optional[str] = None
    item_type: Optional[str] = None  # 원재료/부자재/반제품/완제품/세트/혼합세트
    flavor: Optional[str] = None
    flavor_group: Optional[str] = None
    unit_weight_g: Optional[float] = 0
    labor_cost_per_unit: Optional[float] = 0
    erp_code: Optional[str] = None
    default_location: Optional[str] = None
    default_unit_price: float = 0
    default_cost: float = 0
    safety_stock: float = 0
    notes: Optional[str] = None

class ProductUpdate(BaseModel):
    product_name: Optional[str] = None
    product_code: Optional[str] = None
    product_category: Optional[str] = None
    item_type: Optional[str] = None
    flavor: Optional[str] = None
    flavor_group: Optional[str] = None
    unit_weight_g: Optional[float] = None
    labor_cost_per_unit: Optional[float] = None
    erp_code: Optional[str] = None
    default_location: Optional[str] = None
    default_unit_price: Optional[float] = None
    default_cost: Optional[float] = None
    safety_stock: Optional[float] = None
    avg_hourly_rate: Optional[float] = None
    is_active: Optional[bool] = None
    notes: Optional[str] = None

class ProductBulkItem(BaseModel):
    id: Optional[int] = None
    product_name: str
    product_code: Optional[str] = None
    product_category: Optional[str] = None
    default_location: Optional[str] = None
    default_unit_price: float = 0
    default_cost: float = 0
    safety_stock: float = 0
    notes: Optional[str] = None

class ProductBulkRequest(BaseModel):
    items: List[ProductBulkItem]


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
    manager: Optional[str] = None,
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
        if manager:
            query = query.filter(ScmProductionResult.manager.ilike(f"%{manager}%"))
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
                    "manager": r.manager,
                    "location": r.location,
                    "product_category": r.product_category,
                    "product_name": r.product_name,
                    "quantity": r.quantity,
                    "total_hours": r.total_hours,
                    "unit_price": r.unit_price,
                    "total_value": r.total_value,
                    "deduction": r.deduction,
                    "cost": r.cost,
                    "total_cost": r.total_cost,
                    "shift_type": r.shift_type,
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
                manager=item.manager,
                location=item.location,
                product_category=item.product_category,
                product_name=item.product_name,
                quantity=item.quantity,
                total_hours=item.total_hours,
                unit_price=item.unit_price,
                total_value=item.total_value,
                deduction=item.deduction,
                cost=item.cost,
                total_cost=item.total_cost,
                shift_type=item.shift_type,
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
                    manager=item.manager,
                    location=item.location,
                    product_category=item.product_category,
                    product_name=item.product_name,
                    quantity=item.quantity,
                    total_hours=item.total_hours,
                    unit_price=item.unit_price,
                    total_value=item.total_value,
                    deduction=item.deduction,
                    cost=item.cost,
                    total_cost=item.total_cost,
                    shift_type=item.shift_type,
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
        total_total_value = query.with_entities(
            func.coalesce(func.sum(ScmProductionResult.total_value), 0)
        ).scalar()
        total_deduction = query.with_entities(
            func.coalesce(func.sum(ScmProductionResult.deduction), 0)
        ).scalar()
        avg_cost = query.with_entities(
            func.coalesce(func.avg(ScmProductionResult.cost), 0)
        ).scalar()
        total_total_hours = query.with_entities(
            func.coalesce(func.sum(ScmProductionResult.total_hours), 0)
        ).scalar()
        total_total_cost = query.with_entities(
            func.coalesce(func.sum(ScmProductionResult.total_cost), 0)
        ).scalar()

        # 일별 생산 추이 차트 데이터
        daily_chart = (
            query.with_entities(
                ScmProductionResult.production_date.label("date"),
                func.count(ScmProductionResult.id).label("count"),
                func.coalesce(func.sum(ScmProductionResult.total_value), 0).label("total_value"),
                func.coalesce(func.sum(ScmProductionResult.deduction), 0).label("deduction"),
                func.coalesce(func.avg(ScmProductionResult.cost), 0).label("avg_cost"),
            )
            .group_by(ScmProductionResult.production_date)
            .order_by(ScmProductionResult.production_date)
            .all()
        )

        # 담당자별 생산 요약
        manager_summary = (
            query.with_entities(
                ScmProductionResult.manager,
                func.count(ScmProductionResult.id).label("count"),
                func.coalesce(func.sum(ScmProductionResult.total_value), 0).label("total_value"),
                func.coalesce(func.avg(ScmProductionResult.cost), 0).label("avg_cost"),
            )
            .group_by(ScmProductionResult.manager)
            .all()
        )

        return {
            "success": True,
            "data": {
                "total_count": total_count,
                "total_total_value": float(total_total_value),
                "total_deduction": float(total_deduction),
                "avg_cost": round(float(avg_cost), 2),
                "total_total_hours": float(total_total_hours),
                "total_total_cost": float(total_total_cost),
                "daily_chart": [
                    {
                        "date": str(r.date),
                        "count": r.count,
                        "total_value": float(r.total_value),
                        "deduction": float(r.deduction),
                        "avg_cost": round(float(r.avg_cost), 2),
                    }
                    for r in daily_chart
                ],
                "manager_summary": [
                    {
                        "manager": r.manager,
                        "count": r.count,
                        "total_value": float(r.total_value),
                        "avg_cost": round(float(r.avg_cost), 2),
                    }
                    for r in manager_summary
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
    """제품별 과거 원가 조회 (생산 계획 수립 참고용)"""
    try:
        from app.db_models import ScmProductionResult

        query = db.query(
            ScmProductionResult.product_name,
            func.avg(ScmProductionResult.cost).label("avg_cost"),
            func.min(ScmProductionResult.cost).label("min_cost"),
            func.max(ScmProductionResult.cost).label("max_cost"),
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
                    "avg_cost": round(float(r.avg_cost), 2) if r.avg_cost else 0,
                    "min_cost": round(float(r.min_cost), 2) if r.min_cost else 0,
                    "max_cost": round(float(r.max_cost), 2) if r.max_cost else 0,
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
                    "manager": p.manager,
                    "location": p.location,
                    "product_category": p.product_category,
                    "product_name": p.product_name,
                    "quantity": p.quantity,
                    "total_hours": p.total_hours,
                    "unit_price": p.unit_price,
                    "total_value": p.total_value,
                    "deduction": p.deduction,
                    "cost": p.cost,
                    "total_cost": p.total_cost,
                    "shift_type": p.shift_type,
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
                manager=item.manager,
                location=item.location,
                product_category=item.product_category,
                product_name=item.product_name,
                quantity=item.quantity,
                total_hours=item.total_hours,
                unit_price=item.unit_price,
                total_value=item.total_value,
                deduction=item.deduction,
                cost=item.cost,
                total_cost=item.total_cost,
                shift_type=item.shift_type,
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
    - ScmProduct 마스터에서 avg_hourly_rate, safety_stock 조회
    - 주문 계획 수량 합산 (ScmOrderPlan, 향후 7일)
    - 현재 재고 조회 (ScmInventoryItem)
    - 추천 수량 = max(주문 수요, 안전재고 부족분)
    - 필요 시간 = 추천 수량 / 평균 시간당 생산량
    - 필요 인력 = ceil(필요 시간 / 8)
    """
    try:
        from app.db_models import ScmInventoryItem, ScmOrderPlan, ScmProductionResult, ScmProduct

        product_name = body.product_name
        plan_date = body.plan_date

        # 0. ScmProduct 마스터 조회
        product_master = (
            db.query(ScmProduct)
            .filter(ScmProduct.product_name == product_name, ScmProduct.is_active == True)
            .first()
        )

        # 1. avg_hourly_rate: 마스터 값 우선, 없으면 생산결과에서 계산
        if product_master and product_master.avg_hourly_rate and product_master.avg_hourly_rate > 0:
            avg_hourly_rate = product_master.avg_hourly_rate
        else:
            avg_quantity_per_hour = (
                db.query(
                    func.avg(ScmProductionResult.quantity / func.nullif(ScmProductionResult.total_hours, 0))
                )
                .filter(ScmProductionResult.product_name.ilike(f"%{product_name}%"))
                .scalar()
            )
            avg_hourly_rate = float(avg_quantity_per_hour) if avg_quantity_per_hour else 0

        # 2. safety_stock: 마스터 값 우선
        safety_stock = 0
        if product_master and product_master.safety_stock:
            safety_stock = product_master.safety_stock

        # 3. 현재 재고 조회
        inventory = (
            db.query(ScmInventoryItem)
            .filter(ScmInventoryItem.product_name.ilike(f"%{product_name}%"))
            .first()
        )
        current_inventory = 0
        if inventory:
            current_inventory = inventory.current_stock or 0

        # 4. 안전재고 기반 부족분
        safety_need = max(0, safety_stock - current_inventory)

        # 5. 향후 7일 주문 계획 수량 합산
        end_date_7d = plan_date + timedelta(days=7)
        order_demand = (
            db.query(func.coalesce(func.sum(ScmOrderPlan.planned_qty), 0))
            .filter(
                ScmOrderPlan.product_name.ilike(f"%{product_name}%"),
                ScmOrderPlan.plan_date >= plan_date,
                ScmOrderPlan.plan_date < end_date_7d,
            )
            .scalar()
        )
        order_demand = int(order_demand)

        # 6. 추천 수량 계산
        recommended_qty = max(order_demand, safety_need)

        # 7. 필요 시간 / 인력 계산
        if avg_hourly_rate > 0:
            required_hours = round(recommended_qty / avg_hourly_rate, 2)
        else:
            required_hours = 0

        required_manpower = math.ceil(required_hours / 8) if required_hours > 0 else 0

        # 8. 설명 문자열 생성
        explanation = (
            f"[AI 추천 분석]\n\n"
            f"1. 주문 계획 기반 수요:\n"
            f"   - 향후 7일 주문 계획: {order_demand}개\n\n"
            f"2. 안전재고 기반 수요:\n"
            f"   - 안전재고 기준: {safety_stock}개\n"
            f"   - 현재 추정 재고: {current_inventory}개\n"
            f"   - 부족분: {safety_need}개\n\n"
            f"3. 추천 생산량: max({order_demand}, {safety_need}) = {recommended_qty}개\n\n"
            f"4. 필요 자원:\n"
            f"   - 평균 시간당 생산량: {avg_hourly_rate}개/시 (과거 생산 결과 기준)\n"
            f"   - 필요 시간: {required_hours}시간\n"
            f"   - 필요 인력: {required_manpower}명 (8시간/일 기준)"
        )

        return {
            "success": True,
            "data": {
                "product_name": product_name,
                "plan_date": str(plan_date),
                "recommended_qty": recommended_qty,
                "order_demand": order_demand,
                "safety_need": safety_need,
                "safety_stock": safety_stock,
                "current_inventory": current_inventory,
                "avg_hourly_rate": round(avg_hourly_rate, 2),
                "required_hours": required_hours,
                "required_manpower": required_manpower,
                "explanation": explanation,
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
                "quantity": p.quantity,
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


# ══════════════════════════════════════════════
#  8. 품목 관리 (Product Master)
# ══════════════════════════════════════════════

@router.get("/products/categories")
def list_product_categories(
    db: Session = Depends(get_db),
):
    """품목 카테고리 목록 조회"""
    try:
        from app.db_models import ScmProduct

        rows = (
            db.query(ScmProduct.product_category)
            .filter(ScmProduct.product_category.isnot(None), ScmProduct.product_category != "")
            .distinct()
            .order_by(ScmProduct.product_category)
            .all()
        )

        categories = [r[0] for r in rows]
        return {"success": True, "data": categories}
    except Exception as e:
        logger.error(f"품목 카테고리 조회 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/products")
def list_products(
    category: Optional[str] = None,
    search: Optional[str] = None,
    item_type: Optional[str] = None,
    active_only: bool = True,
    db: Session = Depends(get_db),
):
    """품목 마스터 목록 조회 (item_type 필터: 원재료/부자재/반제품/완제품/세트/혼합세트)"""
    try:
        from app.db_models import ScmProduct

        query = db.query(ScmProduct)

        if active_only:
            query = query.filter(ScmProduct.is_active == True)
        if category:
            query = query.filter(ScmProduct.product_category == category)
        if item_type:
            query = query.filter(ScmProduct.item_type == item_type)
        if search:
            query = query.filter(
                (ScmProduct.product_name.ilike(f"%{search}%"))
                | (ScmProduct.product_code.ilike(f"%{search}%"))
            )

        products = query.order_by(
            ScmProduct.product_category,
            ScmProduct.product_name,
        ).all()

        return {
            "success": True,
            "data": [
                {
                    "id": p.id,
                    "product_name": p.product_name,
                    "product_code": p.product_code,
                    "product_category": p.product_category,
                    "item_type": p.item_type,
                    "flavor": p.flavor,
                    "flavor_group": p.flavor_group,
                    "unit_weight_g": p.unit_weight_g,
                    "labor_cost_per_unit": p.labor_cost_per_unit,
                    "erp_code": p.erp_code,
                    "csa_product_id": p.csa_product_id,
                    "default_location": p.default_location,
                    "default_unit_price": p.default_unit_price,
                    "default_cost": p.default_cost,
                    "avg_hourly_rate": p.avg_hourly_rate,
                    "total_produced": p.total_produced,
                    "total_hours": p.total_hours,
                    "safety_stock": p.safety_stock,
                    "is_active": p.is_active,
                    "notes": p.notes,
                    "created_at": p.created_at.isoformat() if p.created_at else None,
                    "updated_at": p.updated_at.isoformat() if p.updated_at else None,
                }
                for p in products
            ],
            "total": len(products),
        }
    except Exception as e:
        logger.error(f"품목 목록 조회 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/products")
def create_product(
    body: ProductCreate,
    db: Session = Depends(get_db),
):
    """품목 마스터 생성"""
    try:
        from app.db_models import ScmProduct

        # 품목코드 자동생성 (item_type 기반 ERP 코드체계)
        product_code = body.product_code or _gen_item_code(db, body.item_type, body.product_category)

        product = ScmProduct(
            product_name=body.product_name,
            product_code=product_code,
            product_category=body.product_category,
            item_type=body.item_type,
            flavor=body.flavor,
            flavor_group=body.flavor_group,
            unit_weight_g=body.unit_weight_g or 0,
            labor_cost_per_unit=body.labor_cost_per_unit or 0,
            erp_code=body.erp_code or product_code,
            default_location=body.default_location,
            default_unit_price=body.default_unit_price,
            default_cost=body.default_cost,
            safety_stock=body.safety_stock,
            notes=body.notes,
        )
        db.add(product)
        db.commit()
        db.refresh(product)

        return {
            "success": True,
            "data": {
                "id": product.id,
                "product_name": product.product_name,
                "product_code": product.product_code,
                "product_category": product.product_category,
                "default_location": product.default_location,
                "default_unit_price": product.default_unit_price,
                "default_cost": product.default_cost,
                "avg_hourly_rate": product.avg_hourly_rate,
                "total_produced": product.total_produced,
                "total_hours": product.total_hours,
                "safety_stock": product.safety_stock,
                "is_active": product.is_active,
                "notes": product.notes,
                "created_at": product.created_at.isoformat() if product.created_at else None,
                "updated_at": product.updated_at.isoformat() if product.updated_at else None,
            },
        }
    except Exception as e:
        db.rollback()
        logger.error(f"품목 생성 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/products/{product_id}")
def update_product(
    product_id: int,
    body: ProductUpdate,
    db: Session = Depends(get_db),
):
    """품목 마스터 수정"""
    try:
        from app.db_models import ScmProduct

        product = db.query(ScmProduct).filter(ScmProduct.id == product_id).first()
        if not product:
            raise HTTPException(status_code=404, detail="품목을 찾을 수 없습니다")

        update_data = body.model_dump(exclude_unset=True)
        for key, value in update_data.items():
            setattr(product, key, value)

        db.commit()
        db.refresh(product)

        return {
            "success": True,
            "data": {
                "id": product.id,
                "product_name": product.product_name,
                "product_code": product.product_code,
                "product_category": product.product_category,
                "default_location": product.default_location,
                "default_unit_price": product.default_unit_price,
                "default_cost": product.default_cost,
                "avg_hourly_rate": product.avg_hourly_rate,
                "total_produced": product.total_produced,
                "total_hours": product.total_hours,
                "safety_stock": product.safety_stock,
                "is_active": product.is_active,
                "notes": product.notes,
            },
        }
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"품목 수정 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/products/{product_id}")
def delete_product(
    product_id: int,
    db: Session = Depends(get_db),
):
    """품목 삭제 (soft delete: is_active=False)"""
    try:
        from app.db_models import ScmProduct

        product = db.query(ScmProduct).filter(ScmProduct.id == product_id).first()
        if not product:
            raise HTTPException(status_code=404, detail="품목을 찾을 수 없습니다")

        product.is_active = False
        db.commit()

        return {"success": True, "message": f"품목 '{product.product_name}'이(가) 비활성화되었습니다"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"품목 삭제 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/products/bulk")
def bulk_products(
    body: ProductBulkRequest,
    db: Session = Depends(get_db),
):
    """품목 일괄 생성/수정"""
    try:
        from app.db_models import ScmProduct

        created_count = 0
        updated_count = 0

        for item in body.items:
            if item.id:
                product = db.query(ScmProduct).filter(ScmProduct.id == item.id).first()
                if product:
                    for key, value in item.model_dump(exclude={"id"}).items():
                        if value is not None:
                            setattr(product, key, value)
                    updated_count += 1
            else:
                # Auto-generate product_code if not provided
                product_code = item.product_code
                if not product_code:
                    prefix = (item.product_category or "ETC")[:2].upper()
                    last = (
                        db.query(ScmProduct)
                        .filter(ScmProduct.product_code.ilike(f"{prefix}%"))
                        .order_by(ScmProduct.id.desc())
                        .first()
                    )
                    if last and last.product_code:
                        try:
                            num = int(last.product_code[len(prefix):]) + 1
                        except (ValueError, IndexError):
                            num = 1
                    else:
                        num = 1
                    product_code = f"{prefix}{num:04d}"

                product = ScmProduct(
                    product_name=item.product_name,
                    product_code=product_code,
                    product_category=item.product_category,
                    default_location=item.default_location,
                    default_unit_price=item.default_unit_price,
                    default_cost=item.default_cost,
                    safety_stock=item.safety_stock,
                    notes=item.notes,
                )
                db.add(product)
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
        logger.error(f"품목 일괄 처리 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/products/{product_id}/hourly-rate")
def get_product_hourly_rate(
    product_id: int,
    db: Session = Depends(get_db),
):
    """품목별 시간당 생산량 조회 (월별 트렌드 포함)"""
    try:
        from app.db_models import ScmProduct, ScmProductionResult

        product = db.query(ScmProduct).filter(ScmProduct.id == product_id).first()
        if not product:
            raise HTTPException(status_code=404, detail="품목을 찾을 수 없습니다")

        # 전체 합산
        totals = (
            db.query(
                func.coalesce(func.sum(ScmProductionResult.quantity), 0).label("total_qty"),
                func.coalesce(func.sum(ScmProductionResult.total_hours), 0).label("total_hrs"),
            )
            .filter(ScmProductionResult.product_name == product.product_name)
            .first()
        )

        total_produced = float(totals.total_qty)
        total_hours_val = float(totals.total_hrs)
        avg_rate = round(total_produced / total_hours_val, 2) if total_hours_val > 0 else 0

        # 최근 6개월 월별 트렌드
        six_months_ago = date.today() - timedelta(days=180)
        monthly_rows = (
            db.query(
                extract("year", ScmProductionResult.production_date).label("yr"),
                extract("month", ScmProductionResult.production_date).label("mn"),
                func.coalesce(func.sum(ScmProductionResult.quantity), 0).label("qty"),
                func.coalesce(func.sum(ScmProductionResult.total_hours), 0).label("hrs"),
            )
            .filter(
                ScmProductionResult.product_name == product.product_name,
                ScmProductionResult.production_date >= six_months_ago,
            )
            .group_by("yr", "mn")
            .order_by("yr", "mn")
            .all()
        )

        monthly_trend = []
        for row in monthly_rows:
            qty = float(row.qty)
            hrs = float(row.hrs)
            rate = round(qty / hrs, 2) if hrs > 0 else 0
            monthly_trend.append({
                "month": f"{int(row.yr)}-{int(row.mn):02d}",
                "quantity": qty,
                "hours": hrs,
                "rate": rate,
            })

        return {
            "success": True,
            "data": {
                "product_name": product.product_name,
                "avg_hourly_rate": avg_rate,
                "total_produced": total_produced,
                "total_hours": total_hours_val,
                "monthly_trend": monthly_trend,
            },
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"품목 시간당 생산량 조회 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/products/sync-rates")
def sync_product_rates(
    db: Session = Depends(get_db),
):
    """모든 활성 품목의 avg_hourly_rate를 생산 결과에서 재계산"""
    try:
        from app.db_models import ScmProduct, ScmProductionResult

        products = db.query(ScmProduct).filter(ScmProduct.is_active == True).all()
        updated_count = 0

        for product in products:
            totals = (
                db.query(
                    func.coalesce(func.sum(ScmProductionResult.quantity), 0).label("total_qty"),
                    func.coalesce(func.sum(ScmProductionResult.total_hours), 0).label("total_hrs"),
                )
                .filter(ScmProductionResult.product_name == product.product_name)
                .first()
            )

            total_qty = float(totals.total_qty)
            total_hrs = float(totals.total_hrs)

            product.total_produced = total_qty
            product.total_hours = total_hrs
            product.avg_hourly_rate = round(total_qty / total_hrs, 2) if total_hrs > 0 else 0
            updated_count += 1

        db.commit()

        return {
            "success": True,
            "message": f"{updated_count}개 품목의 시간당 생산량이 갱신되었습니다",
            "updated_count": updated_count,
        }
    except Exception as e:
        db.rollback()
        logger.error(f"품목 시간당 생산량 동기화 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/products/{product_name}/defaults")
def get_product_defaults(
    product_name: str,
    db: Session = Depends(get_db),
):
    """품목명으로 기본값 조회 (생산 계획 자동완성용)"""
    try:
        from app.db_models import ScmProduct, ScmProductionResult

        product = (
            db.query(ScmProduct)
            .filter(ScmProduct.product_name == product_name, ScmProduct.is_active == True)
            .first()
        )

        if not product:
            raise HTTPException(status_code=404, detail="품목을 찾을 수 없습니다")

        # 최신 시간당 생산량 계산 (생산 결과 기반)
        totals = (
            db.query(
                func.coalesce(func.sum(ScmProductionResult.quantity), 0).label("total_qty"),
                func.coalesce(func.sum(ScmProductionResult.total_hours), 0).label("total_hrs"),
            )
            .filter(ScmProductionResult.product_name == product_name)
            .first()
        )

        total_qty = float(totals.total_qty)
        total_hrs = float(totals.total_hrs)
        computed_rate = round(total_qty / total_hrs, 2) if total_hrs > 0 else 0

        # 마스터 값이 있으면 마스터 값 우선, 없으면 계산 값
        avg_hourly_rate = product.avg_hourly_rate if product.avg_hourly_rate and product.avg_hourly_rate > 0 else computed_rate

        return {
            "success": True,
            "data": {
                "product_name": product.product_name,
                "product_category": product.product_category,
                "default_location": product.default_location,
                "default_unit_price": product.default_unit_price,
                "default_cost": product.default_cost,
                "avg_hourly_rate": avg_hourly_rate,
                "safety_stock": product.safety_stock,
            },
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"품목 기본값 조회 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ══════════════════════════════════════════════
#  7. BOM / 원부재료 / 생산소요 (Bill of Materials)
# ══════════════════════════════════════════════

class ProductionReqItem(BaseModel):
    item_id: int
    qty: float = 0


class ProductionRequirementRequest(BaseModel):
    items: List[ProductionReqItem]


class ComponentCreate(BaseModel):
    child_item_id: int
    qty: float = 1


class BomLineCreate(BaseModel):
    material_type: str  # raw / sub / semi
    raw_material_id: Optional[int] = None
    sub_material_id: Optional[int] = None
    material_erp_code: Optional[str] = None
    material_name: Optional[str] = None
    qty_per_unit: float = 0
    qty_unit: Optional[str] = None


class LinkCsaRequest(BaseModel):
    csa_product_id: Optional[int] = None


class RawMaterialBody(BaseModel):
    erp_code: Optional[str] = None
    name: str
    supplier: Optional[str] = None
    material_class: Optional[str] = "원재료"
    spec: Optional[str] = None
    spec_unit: Optional[str] = None
    unit: Optional[str] = "kg"
    kg_price: float = 0
    spec_price: float = 0
    notes: Optional[str] = None


class SubMaterialBody(BaseModel):
    erp_code: Optional[str] = None
    name: str
    supplier: Optional[str] = None
    material_class: Optional[str] = "부자재"
    unit: Optional[str] = "ea"
    roll_price: float = 0
    producible_qty: float = 0
    unit_price: float = 0
    notes: Optional[str] = None


class ComposeComponent(BaseModel):
    child_item_id: int
    qty: float = 1


class ComposeBomLine(BaseModel):
    material_type: str  # raw / sub
    raw_material_id: Optional[int] = None
    sub_material_id: Optional[int] = None
    material_name: Optional[str] = None
    material_erp_code: Optional[str] = None
    qty_per_unit: float = 0
    qty_unit: Optional[str] = None


class ComposeRequest(BaseModel):
    """여러 하위품목/자재를 묶어 상위품목(세트/완제품)을 생성."""
    product_name: str
    item_type: str  # 세트 / 혼합세트 / 완제품 / 반제품
    product_category: Optional[str] = None
    flavor_group: Optional[str] = None
    unit_weight_g: Optional[float] = 0
    components: List[ComposeComponent] = []
    bom_lines: List[ComposeBomLine] = []


# ── ERP 코드체계 (item_type → prefix) ──
_TYPE_CODE_PREFIX = {
    "원재료": "RM", "부자재": "SM", "반제품": "SF",
    "완제품": "FG", "세트": "ST", "혼합세트": "MX",
}


def _next_seq(db, model, field, prefix):
    """prefix로 시작하는 코드 중 최대 일련번호 + 1."""
    from sqlalchemy import cast, Integer as SAInt
    rows = db.query(getattr(model, field)).filter(getattr(model, field).ilike(f"{prefix}%")).all()
    mx = 0
    for (code,) in rows:
        if not code:
            continue
        try:
            n = int(str(code)[len(prefix):])
            mx = max(mx, n)
        except (ValueError, TypeError):
            continue
    return mx + 1


def _gen_item_code(db, item_type, category):
    """품목 ERP 코드 자동생성: item_type 우선, 없으면 카테고리 약어."""
    from app.db_models import ScmProduct
    prefix = _TYPE_CODE_PREFIX.get(item_type or "") or (category or "ETC")[:2].upper()
    return f"{prefix}{_next_seq(db, ScmProduct, 'product_code', prefix):04d}"


@router.get("/next-code")
def next_code(item_type: Optional[str] = None, category: Optional[str] = None, kind: str = "product", db: Session = Depends(get_db)):
    """다음 ERP 코드 미리보기 (모달 표시용). kind=product/raw/sub."""
    from app.db_models import ScmProduct, ScmRawMaterial, ScmSubMaterial
    if kind == "raw":
        code = f"RM{_next_seq(db, ScmRawMaterial, 'erp_code', 'RM'):04d}"
    elif kind == "sub":
        code = f"SM{_next_seq(db, ScmSubMaterial, 'erp_code', 'SM'):04d}"
    else:
        code = _gen_item_code(db, item_type, category)
    return {"success": True, "data": {"code": code}}


@router.get("/materials/raw")
def list_raw_materials(search: Optional[str] = None, db: Session = Depends(get_db)):
    """원재료 마스터 목록"""
    from app.db_models import ScmRawMaterial
    q = db.query(ScmRawMaterial).filter(ScmRawMaterial.is_active == True)
    if search:
        q = q.filter((ScmRawMaterial.name.ilike(f"%{search}%")) | (ScmRawMaterial.erp_code.ilike(f"%{search}%")))
    rows = q.order_by(ScmRawMaterial.name).all()
    return {"success": True, "data": [
        {"id": r.id, "erp_code": r.erp_code, "name": r.name, "supplier": r.supplier,
         "material_class": r.material_class, "spec": r.spec, "spec_unit": r.spec_unit, "unit": r.unit,
         "kg_price": r.kg_price, "spec_price": r.spec_price, "notes": r.notes} for r in rows], "total": len(rows)}


@router.post("/materials/raw")
def create_raw_material(body: RawMaterialBody, db: Session = Depends(get_db)):
    """원재료 직접 등록"""
    from app.db_models import ScmRawMaterial
    code = body.erp_code or f"RM{_next_seq(db, ScmRawMaterial, 'erp_code', 'RM'):04d}"
    r = ScmRawMaterial(erp_code=code, name=body.name, supplier=body.supplier,
                       material_class=body.material_class or "원재료", spec=body.spec,
                       spec_unit=body.spec_unit, unit=body.unit or "kg",
                       kg_price=body.kg_price, spec_price=body.spec_price, notes=body.notes)
    db.add(r); db.commit(); db.refresh(r)
    return {"success": True, "data": {"id": r.id, "erp_code": r.erp_code, "name": r.name}}


@router.put("/materials/raw/{rid}")
def update_raw_material(rid: int, body: RawMaterialBody, db: Session = Depends(get_db)):
    """원재료 수정"""
    from app.db_models import ScmRawMaterial
    r = db.query(ScmRawMaterial).filter(ScmRawMaterial.id == rid).first()
    if not r:
        raise HTTPException(status_code=404, detail="원재료를 찾을 수 없습니다")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(r, k, v)
    db.commit()
    return {"success": True}


@router.delete("/materials/raw/{rid}")
def delete_raw_material(rid: int, db: Session = Depends(get_db)):
    from app.db_models import ScmRawMaterial
    r = db.query(ScmRawMaterial).filter(ScmRawMaterial.id == rid).first()
    if not r:
        raise HTTPException(status_code=404, detail="원재료를 찾을 수 없습니다")
    r.is_active = False  # soft delete (BOM 라인 보호)
    db.commit()
    return {"success": True}


@router.get("/materials/sub")
def list_sub_materials(search: Optional[str] = None, db: Session = Depends(get_db)):
    """부자재 마스터 목록"""
    from app.db_models import ScmSubMaterial
    q = db.query(ScmSubMaterial).filter(ScmSubMaterial.is_active == True)
    if search:
        q = q.filter((ScmSubMaterial.name.ilike(f"%{search}%")) | (ScmSubMaterial.erp_code.ilike(f"%{search}%")))
    rows = q.order_by(ScmSubMaterial.name).all()
    return {"success": True, "data": [
        {"id": r.id, "erp_code": r.erp_code, "name": r.name, "supplier": r.supplier,
         "unit": r.unit, "roll_price": r.roll_price, "producible_qty": r.producible_qty,
         "unit_price": r.unit_price, "notes": r.notes} for r in rows], "total": len(rows)}


@router.post("/materials/sub")
def create_sub_material(body: SubMaterialBody, db: Session = Depends(get_db)):
    """부자재 직접 등록"""
    from app.db_models import ScmSubMaterial
    code = body.erp_code or f"SM{_next_seq(db, ScmSubMaterial, 'erp_code', 'SM'):04d}"
    r = ScmSubMaterial(erp_code=code, name=body.name, supplier=body.supplier,
                       material_class=body.material_class or "부자재", unit=body.unit or "ea",
                       roll_price=body.roll_price, producible_qty=body.producible_qty,
                       unit_price=body.unit_price, notes=body.notes)
    db.add(r); db.commit(); db.refresh(r)
    return {"success": True, "data": {"id": r.id, "erp_code": r.erp_code, "name": r.name}}


@router.put("/materials/sub/{sid}")
def update_sub_material(sid: int, body: SubMaterialBody, db: Session = Depends(get_db)):
    """부자재 수정"""
    from app.db_models import ScmSubMaterial
    r = db.query(ScmSubMaterial).filter(ScmSubMaterial.id == sid).first()
    if not r:
        raise HTTPException(status_code=404, detail="부자재를 찾을 수 없습니다")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(r, k, v)
    db.commit()
    return {"success": True}


@router.delete("/materials/sub/{sid}")
def delete_sub_material(sid: int, db: Session = Depends(get_db)):
    from app.db_models import ScmSubMaterial
    r = db.query(ScmSubMaterial).filter(ScmSubMaterial.id == sid).first()
    if not r:
        raise HTTPException(status_code=404, detail="부자재를 찾을 수 없습니다")
    r.is_active = False
    db.commit()
    return {"success": True}


@router.get("/bom/summary")
def bom_summary(db: Session = Depends(get_db)):
    """BOM 적재 현황 요약 (타입별 품목수·자재수·BOM라인수)"""
    from app.db_models import ScmProduct, ScmRawMaterial, ScmSubMaterial, ScmBomLine, ScmItemComponent
    by_type = dict(db.query(ScmProduct.item_type, func.count()).group_by(ScmProduct.item_type).all())
    return {"success": True, "data": {
        "by_type": {k or "미분류": v for k, v in by_type.items()},
        "raw_materials": db.query(ScmRawMaterial).count(),
        "sub_materials": db.query(ScmSubMaterial).count(),
        "bom_lines": db.query(ScmBomLine).count(),
        "components": db.query(ScmItemComponent).count(),
    }}


@router.get("/bom/analytics")
def bom_analytics(item_type: Optional[str] = None, db: Session = Depends(get_db)):
    """카테고리·유형별 개당 재료원가(완전전개) 평균·합계·최소·최대 분석."""
    from collections import defaultdict
    from app.db_models import ScmProduct, ScmRawMaterial, ScmSubMaterial
    raw_price = {r.id: (r.kg_price or 0) for r in db.query(ScmRawMaterial.id, ScmRawMaterial.kg_price).all()}
    sub_price = {s.id: (s.unit_price or 0) for s in db.query(ScmSubMaterial.id, ScmSubMaterial.unit_price).all()}

    q = db.query(ScmProduct).filter(
        ScmProduct.is_active == True,
        ScmProduct.item_type.in_(["완제품", "반제품", "세트", "혼합세트"]),
    )
    if item_type:
        q = q.filter(ScmProduct.item_type == item_type)
    items = q.all()

    def unit_cost(it):
        acc: dict = {}
        _explode_item(it.id, 1, db, acc, {it.id})
        c = 0.0
        for e in acc.values():
            if e["type"] == "raw":
                c += e["qty"] * raw_price.get(e.get("ref_id"), 0)
            elif e["type"] == "sub":
                c += e["qty"] * sub_price.get(e.get("ref_id"), 0)
        return c

    rows = [{"id": it.id, "name": it.product_name, "category": it.product_category or "미분류",
             "item_type": it.item_type, "cost": unit_cost(it)} for it in items]

    def aggregate(key):
        g = defaultdict(list)
        for r in rows:
            g[r[key]].append(r["cost"])
        out = [{key: k, "count": len(v), "avg_cost": round(sum(v) / len(v)),
                "total_cost": round(sum(v)), "min_cost": round(min(v)), "max_cost": round(max(v))}
               for k, v in g.items()]
        out.sort(key=lambda x: -x["total_cost"])
        return out

    # 카테고리 × 유형 매트릭스
    mat = defaultdict(lambda: defaultdict(list))
    for r in rows:
        mat[r["category"]][r["item_type"]].append(r["cost"])
    matrix = []
    for cat, types in mat.items():
        allc = []
        tlist = []
        for t, v in types.items():
            tlist.append({"item_type": t, "count": len(v), "avg_cost": round(sum(v) / len(v)), "total_cost": round(sum(v))})
            allc += v
        tlist.sort(key=lambda x: -x["total_cost"])
        matrix.append({"category": cat, "count": len(allc),
                       "avg_cost": round(sum(allc) / len(allc)) if allc else 0,
                       "total_cost": round(sum(allc)), "types": tlist})
    matrix.sort(key=lambda x: -x["total_cost"])

    # 상·하위 품목 (가장 비싼/싼 개당원가)
    rows_sorted = sorted(rows, key=lambda r: -r["cost"])
    top = [{"name": r["name"], "category": r["category"], "item_type": r["item_type"], "cost": round(r["cost"])} for r in rows_sorted[:5]]

    return {"success": True, "data": {
        "item_count": len(rows),
        "by_category": aggregate("category"),
        "by_type": aggregate("item_type"),
        "matrix": matrix,
        "top_cost": top,
    }}


@router.get("/bom/cost-detail")
def bom_cost_detail(category: Optional[str] = None, item_type: str = "완제품", db: Session = Depends(get_db)):
    """진단용 — 카테고리 내 품목별 개당원가 + 구성(하위품목)·직접라인 분해."""
    from app.db_models import ScmProduct, ScmBomLine, ScmItemComponent, ScmRawMaterial, ScmSubMaterial
    raw_price = {r.id: (r.kg_price or 0) for r in db.query(ScmRawMaterial.id, ScmRawMaterial.kg_price).all()}
    sub_price = {s.id: (s.unit_price or 0) for s in db.query(ScmSubMaterial.id, ScmSubMaterial.unit_price).all()}
    name_by_id = {p.id: p.product_name for p in db.query(ScmProduct.id, ScmProduct.product_name).all()}

    q = db.query(ScmProduct).filter(ScmProduct.is_active == True, ScmProduct.item_type == item_type)
    if category:
        q = q.filter(ScmProduct.product_category == category)
    items = q.all()
    out = []
    for it in items:
        acc: dict = {}
        _explode_item(it.id, 1, db, acc, {it.id})
        cost = 0.0
        for e in acc.values():
            if e["type"] == "raw":
                cost += e["qty"] * raw_price.get(e.get("ref_id"), 0)
            elif e["type"] == "sub":
                cost += e["qty"] * sub_price.get(e.get("ref_id"), 0)
        comps = db.query(ScmItemComponent).filter(ScmItemComponent.parent_item_id == it.id).all()
        lines = db.query(ScmBomLine).filter(ScmBomLine.item_id == it.id).all()
        out.append({
            "id": it.id, "name": it.product_name, "category": it.product_category,
            "cost": round(cost), "unit_weight_g": it.unit_weight_g,
            "components": [{"child_id": c.child_item_id, "child": name_by_id.get(c.child_item_id), "qty": c.qty} for c in comps],
            "direct_lines": [{"type": b.material_type, "name": b.material_name, "qty": b.qty_per_unit, "unit": b.qty_unit} for b in lines],
        })
    out.sort(key=lambda x: -x["cost"])
    return {"success": True, "count": len(out), "items": out}


class SyncCsaCostsRequest(BaseModel):
    include_labor: bool = True
    rebuild: bool = True


@router.post("/sync-csa-costs")
def sync_csa_costs(body: SyncCsaCostsRequest = SyncCsaCostsRequest(), db: Session = Depends(get_db)):
    """SCM BOM에서 산출한 **개당 재료원가(+개당 노무비)**를 CSA 변동비 규칙(cogs/labor)으로 동기화.

    - 완제품: CSA 표준품목(ProductMaster)에 csa_product_id로 연결됐거나 이름이 정확히 일치하면 매칭.
      같은 표준품목에 여러 맛(완제품)이 매핑되면 **평균** 개당 원가/노무비를 사용.
    - 세트/혼합세트: csa_product_id가 명시된 경우에만 동기화(세트 1개 단가 = 풀 BOM 원가).
    - 규칙은 전 채널 공통(channel_id=NULL)·기간 무제한으로 upsert → 채널별 daily 재계산 반영.
    """
    from collections import defaultdict
    from app.db_models import (
        ScmProduct, ScmRawMaterial, ScmSubMaterial,
        ProductMaster, CsaCostItem, CsaCostRule,
    )
    from app.services.csa_cost_service import seed_cost_items, rebuild_daily_with_costs

    body = body or SyncCsaCostsRequest()
    seed_cost_items(db)  # cogs/labor 등 기본 변동비 항목 보장(idempotent)

    raw_price = {r.id: (r.kg_price or 0) for r in db.query(ScmRawMaterial.id, ScmRawMaterial.kg_price).all()}
    sub_price = {s.id: (s.unit_price or 0) for s in db.query(ScmSubMaterial.id, ScmSubMaterial.unit_price).all()}

    def unit_material_cost(item_id):
        acc: dict = {}
        _explode_item(item_id, 1, db, acc, {item_id})
        c = 0.0
        for e in acc.values():
            if e["type"] == "raw":
                c += e["qty"] * raw_price.get(e.get("ref_id"), 0)
            elif e["type"] == "sub":
                c += e["qty"] * sub_price.get(e.get("ref_id"), 0)
        return c

    pms = db.query(ProductMaster).filter(ProductMaster.is_active == True).all()
    pm_by_id = {p.id: p for p in pms}

    # 이름/별칭 → PM 후보. SCM 완제품명("마카롱 딸기요거트 완제품")에 표준품목명("마카롱")이
    # 부분문자열로 포함되면 매칭하고, 여러 개면 가장 긴(=가장 구체적) 표준명을 채택.
    #  - 부자재/샘플 등 비식품 표준품목은 제외(식품 완제품명에 섞일 일 없지만 안전망).
    name_keys: list[tuple[str, ProductMaster]] = []
    for p in pms:
        if (p.category or "") in ("부자재", "샘플"):
            continue
        keys = [(p.name or "").strip()]
        if isinstance(p.aliases, list):
            keys += [str(a).strip() for a in p.aliases if a]
        for k in keys:
            if len(k) >= 2:
                name_keys.append((k, p))

    def resolve_pm(name: str):
        cands = [(k, p) for (k, p) in name_keys if k and k in name]
        if not cands:
            return None
        cands.sort(key=lambda x: -len(x[0]))
        return cands[0][1]

    items = db.query(ScmProduct).filter(
        ScmProduct.is_active == True,
        ScmProduct.item_type.in_(["완제품", "세트", "혼합세트"]),
    ).all()

    agg: dict = defaultdict(lambda: {"costs": [], "labors": [], "names": []})
    unmatched = []
    for it in items:
        pm = None
        if it.csa_product_id and it.csa_product_id in pm_by_id:
            pm = pm_by_id[it.csa_product_id]
        elif it.item_type == "완제품":
            pm = resolve_pm(it.product_name or "")
        if not pm:
            unmatched.append({"id": it.id, "name": it.product_name, "item_type": it.item_type})
            continue
        agg[pm.id]["costs"].append(round(unit_material_cost(it.id)))
        agg[pm.id]["labors"].append(round(it.labor_cost_per_unit or 0))
        agg[pm.id]["names"].append(it.product_name)

    cogs_item = db.query(CsaCostItem).filter(CsaCostItem.code == "cogs").first()
    labor_item = db.query(CsaCostItem).filter(CsaCostItem.code == "labor").first()

    def upsert_rule(cost_item_id, product_id, amount):
        rule = db.query(CsaCostRule).filter(
            CsaCostRule.cost_item_id == cost_item_id,
            CsaCostRule.channel_id.is_(None),
            CsaCostRule.product_id == product_id,
            CsaCostRule.valid_from.is_(None),
            CsaCostRule.valid_to.is_(None),
        ).first()
        if rule:
            rule.amount_per_pcs = amount
            rule.is_active = True
            rule.notes = "SCM BOM 동기화"
        else:
            db.add(CsaCostRule(
                cost_item_id=cost_item_id, channel_id=None, product_id=product_id,
                amount_per_pcs=amount, is_active=True, notes="SCM BOM 동기화",
            ))

    report = []
    for pid, d in agg.items():
        avg_cost = round(sum(d["costs"]) / len(d["costs"])) if d["costs"] else 0
        avg_labor = round(sum(d["labors"]) / len(d["labors"])) if d["labors"] else 0
        if cogs_item:
            upsert_rule(cogs_item.id, pid, avg_cost)
        if body.include_labor and labor_item:
            upsert_rule(labor_item.id, pid, avg_labor)
        report.append({
            "product_id": pid, "product_name": pm_by_id[pid].name,
            "matched_items": len(d["costs"]), "avg_cogs": avg_cost, "avg_labor": avg_labor,
            "source_names": d["names"],
        })
    db.commit()

    if body.rebuild:
        rebuild_daily_with_costs(db)
        try:
            from app.api.routes.csa import _bust_all_caches
            _bust_all_caches()
        except Exception:
            pass

    report.sort(key=lambda x: -x["avg_cogs"])
    return {
        "success": True,
        "synced": len(report),
        "unmatched_count": len(unmatched),
        "include_labor": body.include_labor,
        "report": report,
        "unmatched": unmatched,
    }


@router.get("/items/{item_id}/bom")
def get_item_bom(item_id: int, db: Session = Depends(get_db)):
    """품목의 직접 BOM(자재 라인) + 구성(하위 품목) 조회"""
    from app.db_models import ScmProduct, ScmBomLine, ScmItemComponent
    item = db.query(ScmProduct).filter(ScmProduct.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="품목을 찾을 수 없습니다")
    from app.db_models import ScmRawMaterial, ScmSubMaterial
    lines = db.query(ScmBomLine).filter(ScmBomLine.item_id == item_id).order_by(ScmBomLine.sort_order, ScmBomLine.id).all()
    comps = db.query(ScmItemComponent).filter(ScmItemComponent.parent_item_id == item_id).all()
    child_ids = [c.child_item_id for c in comps]
    child_map = {p.id: p for p in db.query(ScmProduct).filter(ScmProduct.id.in_(child_ids)).all()} if child_ids else {}

    # 단가 일괄 로드 (라인별 금액 계산용)
    raw_ids = [b.raw_material_id for b in lines if b.raw_material_id]
    sub_ids = [b.sub_material_id for b in lines if b.sub_material_id]
    raw_price = {r.id: (r.kg_price or 0) for r in db.query(ScmRawMaterial).filter(ScmRawMaterial.id.in_(raw_ids)).all()} if raw_ids else {}
    sub_price = {s.id: (s.unit_price or 0) for s in db.query(ScmSubMaterial).filter(ScmSubMaterial.id.in_(sub_ids)).all()} if sub_ids else {}

    bom_out, bom_cost = [], 0.0
    for b in lines:
        if b.material_type == "raw":
            unit_price = raw_price.get(b.raw_material_id, 0)
        elif b.material_type == "sub":
            unit_price = sub_price.get(b.sub_material_id, 0)
        else:
            unit_price = 0  # semi: 하위 전개로 계산
        line_cost = (b.qty_per_unit or 0) * unit_price
        bom_cost += line_cost
        bom_out.append({
            "id": b.id, "material_type": b.material_type, "material_name": b.material_name,
            "material_erp_code": b.material_erp_code, "qty_per_unit": b.qty_per_unit,
            "qty_unit": b.qty_unit, "raw_material_id": b.raw_material_id, "sub_material_id": b.sub_material_id,
            "unit_price": unit_price, "line_cost": round(line_cost, 2),
        })
    # ── 중량 집계 (총 투입 중량 vs 기준 제품 중량 → 공정 유실율) ──
    direct_input_kg = sum((b.qty_per_unit or 0) for b in lines if b.material_type == "raw")
    # 완전전개 원재료 중량(반제품 구성 포함)
    wacc: dict = {}
    _explode_item(item_id, 1, db, wacc, {item_id})
    exploded_input_kg = sum(e["qty"] for e in wacc.values() if e["type"] == "raw")
    # 기준 제품 중량: 자체 unit_weight_g 우선, 없으면 구성품 중량 합
    standard_g = (item.unit_weight_g or 0)
    if not standard_g and comps:
        standard_g = sum((child_map[c.child_item_id].unit_weight_g or 0) * (c.qty or 1)
                         for c in comps if c.child_item_id in child_map)
    basis_kg = exploded_input_kg or direct_input_kg
    loss_rate = round((basis_kg * 1000 - standard_g) / (basis_kg * 1000) * 100, 1) if (basis_kg > 0 and standard_g) else None

    return {"success": True, "data": {
        "item": {"id": item.id, "product_name": item.product_name, "item_type": item.item_type,
                 "product_code": item.product_code, "erp_code": item.erp_code, "unit_weight_g": item.unit_weight_g,
                 "labor_cost_per_unit": item.labor_cost_per_unit, "csa_product_id": item.csa_product_id,
                 "flavor": item.flavor, "flavor_group": item.flavor_group, "category": item.product_category},
        "bom_lines": bom_out,
        "bom_cost": round(bom_cost),
        "weight": {
            "direct_input_g": round(direct_input_kg * 1000, 2),
            "exploded_input_g": round(exploded_input_kg * 1000, 2),
            "standard_g": round(standard_g, 2) if standard_g else None,
            "loss_rate": loss_rate,
            "has_components": len(comps) > 0,
        },
        "components": [
            {"id": c.id, "child_item_id": c.child_item_id, "qty": c.qty,
             "child_name": child_map[c.child_item_id].product_name if c.child_item_id in child_map else None,
             "child_type": child_map[c.child_item_id].item_type if c.child_item_id in child_map else None,
             "child_code": child_map[c.child_item_id].product_code if c.child_item_id in child_map else None}
            for c in comps],
    }}


def _explode_item(item_id, qty, db, acc, visited, depth=0):
    """품목 qty개 생산에 필요한 원재료/부자재를 재귀적으로 누적(acc)."""
    from app.db_models import ScmProduct, ScmBomLine, ScmItemComponent
    if depth > 8 or qty <= 0:
        return
    # 1) 구성(하위 품목) 전개 — 경로기반 순환방지(자기참조/사이클 차단)
    comps = db.query(ScmItemComponent).filter(ScmItemComponent.parent_item_id == item_id).all()
    for c in comps:
        if not c.child_item_id or c.child_item_id in visited:
            continue
        _explode_item(c.child_item_id, qty * (c.qty or 1), db, acc, visited | {c.child_item_id}, depth + 1)
    # 2) 직접 BOM 라인
    lines = db.query(ScmBomLine).filter(ScmBomLine.item_id == item_id).all()
    for b in lines:
        need = qty * (b.qty_per_unit or 0)
        if b.material_type == "semi":
            # 중첩 반제품: 이름으로 자식 품목 해석(같은 카테고리 반제품)
            cat = db.query(ScmProduct.product_category).filter(ScmProduct.id == item_id).scalar()
            child = (db.query(ScmProduct)
                     .filter(ScmProduct.item_type == "반제품",
                             ScmProduct.product_category == cat,
                             ScmProduct.product_name.ilike(f"%{b.material_name}%"))
                     .first())
            if child and child.id not in visited:
                _explode_item(child.id, need, db, acc, visited | {child.id}, depth + 1)
            else:
                key = ("semi", b.material_name)
                acc.setdefault(key, {"type": "semi", "name": b.material_name, "qty": 0, "unit": b.qty_unit, "cost": 0})
                acc[key]["qty"] += need
        else:
            key = (b.material_type, b.raw_material_id or b.sub_material_id or b.material_name)
            entry = acc.setdefault(key, {"type": b.material_type, "name": b.material_name,
                                         "erp_code": b.material_erp_code, "qty": 0, "unit": b.qty_unit,
                                         "cost": 0, "ref_id": b.raw_material_id or b.sub_material_id})
            entry["qty"] += need


@router.post("/production-requirement")
def production_requirement(body: ProductionRequirementRequest, db: Session = Depends(get_db)):
    """품목별 생산수량 → 원부재료 소요량·예상 원가 롤업(BOM 전개)."""
    from app.db_models import ScmProduct, ScmRawMaterial, ScmSubMaterial
    acc: dict = {}
    inputs = []
    for it in body.items:
        p = db.query(ScmProduct).filter(ScmProduct.id == it.item_id).first()
        if not p:
            continue
        inputs.append({"item_id": p.id, "name": p.product_name, "type": p.item_type, "qty": it.qty})
        _explode_item(it.item_id, it.qty, db, acc, {it.item_id})
    # 단가 결합 → 원가
    raw_out, sub_out, semi_out = [], [], []
    total_cost = 0.0
    for key, e in acc.items():
        if e["type"] == "raw":
            rm = db.query(ScmRawMaterial).filter(ScmRawMaterial.id == e.get("ref_id")).first() if e.get("ref_id") else None
            price = (rm.kg_price if rm else 0) or 0
            cost = e["qty"] * price
            total_cost += cost
            raw_out.append({"name": e["name"], "erp_code": e.get("erp_code"), "qty_kg": round(e["qty"], 4),
                            "kg_price": price, "cost": round(cost)})
        elif e["type"] == "sub":
            sm = db.query(ScmSubMaterial).filter(ScmSubMaterial.id == e.get("ref_id")).first() if e.get("ref_id") else None
            price = (sm.unit_price if sm else 0) or 0
            cost = e["qty"] * price
            total_cost += cost
            sub_out.append({"name": e["name"], "erp_code": e.get("erp_code"), "qty_ea": round(e["qty"], 2),
                            "unit_price": price, "cost": round(cost)})
        else:
            semi_out.append({"name": e["name"], "qty": round(e["qty"], 4), "unit": e.get("unit")})
    raw_out.sort(key=lambda x: -x["cost"])
    sub_out.sort(key=lambda x: -x["cost"])
    return {"success": True, "data": {
        "inputs": inputs,
        "raw_materials": raw_out,
        "sub_materials": sub_out,
        "unresolved_semi": semi_out,
        "total_material_cost": round(total_cost),
    }}


@router.post("/items/compose")
def compose_item(body: ComposeRequest, db: Session = Depends(get_db)):
    """여러 하위품목/자재를 묶어 상위품목 생성.
    - 완제품 N개 묶기 → 세트/혼합세트
    - 반제품 + 원부재료 묶기 → 완제품
    """
    from app.db_models import ScmProduct, ScmItemComponent, ScmBomLine
    existing = db.query(ScmProduct).filter(ScmProduct.product_name == body.product_name).first()
    if existing:
        raise HTTPException(status_code=400, detail="같은 이름의 품목이 이미 있습니다")

    # 카테고리 미지정 시 첫 구성품의 카테고리 승계
    category = body.product_category
    if not category and body.components:
        first = db.query(ScmProduct).filter(ScmProduct.id == body.components[0].child_item_id).first()
        category = first.product_category if first else None

    code = _gen_item_code(db, body.item_type, category)
    parent = ScmProduct(
        product_name=body.product_name, product_code=code, erp_code=code,
        product_category=category, item_type=body.item_type,
        flavor_group=body.flavor_group, unit_weight_g=body.unit_weight_g or 0,
    )
    db.add(parent); db.flush()

    for i, comp in enumerate(body.components):
        db.add(ScmItemComponent(parent_item_id=parent.id, child_item_id=comp.child_item_id,
                                qty=comp.qty or 1, sort_order=i))
    for i, ln in enumerate(body.bom_lines):
        db.add(ScmBomLine(item_id=parent.id, material_type=ln.material_type,
                          raw_material_id=ln.raw_material_id, sub_material_id=ln.sub_material_id,
                          material_name=ln.material_name, material_erp_code=ln.material_erp_code,
                          qty_per_unit=ln.qty_per_unit, qty_unit=ln.qty_unit, sort_order=i))
    db.commit(); db.refresh(parent)
    return {"success": True, "data": {"id": parent.id, "product_code": parent.product_code,
                                      "product_name": parent.product_name, "item_type": parent.item_type}}


@router.post("/items/{item_id}/components")
def add_component(item_id: int, body: ComponentCreate, db: Session = Depends(get_db)):
    """세트/완제품에 하위 품목 추가"""
    from app.db_models import ScmItemComponent
    c = ScmItemComponent(parent_item_id=item_id, child_item_id=body.child_item_id, qty=body.qty)
    db.add(c); db.commit(); db.refresh(c)
    return {"success": True, "data": {"id": c.id}}


@router.delete("/items/components/{cid}")
def delete_component(cid: int, db: Session = Depends(get_db)):
    from app.db_models import ScmItemComponent
    c = db.query(ScmItemComponent).filter(ScmItemComponent.id == cid).first()
    if not c:
        raise HTTPException(status_code=404, detail="구성을 찾을 수 없습니다")
    db.delete(c); db.commit()
    return {"success": True}


@router.post("/items/{item_id}/bom-lines")
def add_bom_line(item_id: int, body: BomLineCreate, db: Session = Depends(get_db)):
    """품목에 BOM 자재 라인 추가"""
    from app.db_models import ScmBomLine
    b = ScmBomLine(item_id=item_id, material_type=body.material_type,
                   raw_material_id=body.raw_material_id, sub_material_id=body.sub_material_id,
                   material_erp_code=body.material_erp_code, material_name=body.material_name,
                   qty_per_unit=body.qty_per_unit, qty_unit=body.qty_unit)
    db.add(b); db.commit(); db.refresh(b)
    return {"success": True, "data": {"id": b.id}}


class BomLineUpdate(BaseModel):
    qty_per_unit: Optional[float] = None
    qty_unit: Optional[str] = None
    unit_price: Optional[float] = None  # 지정 시 연결 자재 마스터 단가까지 갱신(전체 BOM 반영)


@router.put("/bom-lines/{line_id}")
def update_bom_line(line_id: int, body: BomLineUpdate, db: Session = Depends(get_db)):
    """BOM 라인 투입량 수정 + (선택) 자재 마스터 단가 갱신.
    단가를 보내면 해당 원/부자재 자체의 단가가 바뀌어 모든 BOM·생산소요에 반영됩니다.
    """
    from app.db_models import ScmBomLine, ScmRawMaterial, ScmSubMaterial
    b = db.query(ScmBomLine).filter(ScmBomLine.id == line_id).first()
    if not b:
        raise HTTPException(status_code=404, detail="BOM 라인을 찾을 수 없습니다")
    if body.qty_per_unit is not None:
        b.qty_per_unit = body.qty_per_unit
    if body.qty_unit is not None:
        b.qty_unit = body.qty_unit
    material_updated = None
    if body.unit_price is not None:
        if b.material_type == "raw" and b.raw_material_id:
            rm = db.query(ScmRawMaterial).filter(ScmRawMaterial.id == b.raw_material_id).first()
            if rm:
                rm.kg_price = body.unit_price
                material_updated = {"kind": "raw", "id": rm.id, "name": rm.name, "kg_price": rm.kg_price}
        elif b.material_type == "sub" and b.sub_material_id:
            sm = db.query(ScmSubMaterial).filter(ScmSubMaterial.id == b.sub_material_id).first()
            if sm:
                sm.unit_price = body.unit_price
                material_updated = {"kind": "sub", "id": sm.id, "name": sm.name, "unit_price": sm.unit_price}
    db.commit()
    new_price = body.unit_price if body.unit_price is not None else 0
    return {"success": True, "data": {
        "id": b.id, "qty_per_unit": b.qty_per_unit, "qty_unit": b.qty_unit,
        "material_updated": material_updated,
        "line_cost": round((b.qty_per_unit or 0) * new_price, 2) if body.unit_price is not None else None,
    }}


@router.delete("/bom-lines/{line_id}")
def delete_bom_line(line_id: int, db: Session = Depends(get_db)):
    from app.db_models import ScmBomLine
    b = db.query(ScmBomLine).filter(ScmBomLine.id == line_id).first()
    if not b:
        raise HTTPException(status_code=404, detail="BOM 라인을 찾을 수 없습니다")
    db.delete(b); db.commit()
    return {"success": True}


@router.put("/items/{item_id}/link-csa")
def link_item_to_csa(item_id: int, body: LinkCsaRequest, db: Session = Depends(get_db)):
    """세트 품목 → CSA 표준품목(ProductMaster) 연결"""
    from app.db_models import ScmProduct
    p = db.query(ScmProduct).filter(ScmProduct.id == item_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="품목을 찾을 수 없습니다")
    p.csa_product_id = body.csa_product_id
    db.commit()
    return {"success": True}


@router.post("/bom/backfill-codes")
def backfill_codes(db: Session = Depends(get_db)):
    """코드 없는 품목·자재에 ERP 코드체계(RM/SM/SF/FG/ST/MX) 일괄 부여."""
    from app.db_models import ScmProduct, ScmRawMaterial, ScmSubMaterial
    report = {"products": 0, "raw": 0, "sub": 0}

    # 품목: item_type별 순번
    seq: dict = {}
    prods = db.query(ScmProduct).order_by(ScmProduct.item_type, ScmProduct.id).all()
    # 기존 코드의 최대 순번으로 시드
    for p in prods:
        prefix = _TYPE_CODE_PREFIX.get(p.item_type or "") or (p.product_category or "ETC")[:2].upper()
        if p.product_code:
            try:
                seq[prefix] = max(seq.get(prefix, 0), int(str(p.product_code)[len(prefix):]))
            except (ValueError, TypeError):
                pass
    for p in prods:
        if p.product_code:
            if not p.erp_code:
                p.erp_code = p.product_code
            continue
        prefix = _TYPE_CODE_PREFIX.get(p.item_type or "") or (p.product_category or "ETC")[:2].upper()
        seq[prefix] = seq.get(prefix, 0) + 1
        p.product_code = f"{prefix}{seq[prefix]:04d}"
        p.erp_code = p.erp_code or p.product_code
        report["products"] += 1

    # 자재
    rseq = _next_seq(db, ScmRawMaterial, "erp_code", "RM") - 1
    for r in db.query(ScmRawMaterial).filter((ScmRawMaterial.erp_code == None) | (ScmRawMaterial.erp_code == "")).order_by(ScmRawMaterial.id).all():
        rseq += 1
        r.erp_code = f"RM{rseq:04d}"
        report["raw"] += 1
    sseq = _next_seq(db, ScmSubMaterial, "erp_code", "SM") - 1
    for s in db.query(ScmSubMaterial).filter((ScmSubMaterial.erp_code == None) | (ScmSubMaterial.erp_code == "")).order_by(ScmSubMaterial.id).all():
        sseq += 1
        s.erp_code = f"SM{sseq:04d}"
        report["sub"] += 1

    db.commit()
    return {"success": True, "report": report}


@router.post("/bom/fix-self-components")
def fix_self_components(db: Session = Depends(get_db)):
    """자기참조 구성(parent==child) 제거 — 전개 순환 유발 데이터 정리."""
    from app.db_models import ScmItemComponent
    bad = db.query(ScmItemComponent).filter(ScmItemComponent.parent_item_id == ScmItemComponent.child_item_id).all()
    n = len(bad)
    for c in bad:
        db.delete(c)
    db.commit()
    return {"success": True, "removed": n}


@router.post("/bom/import")
async def import_bom(file: UploadFile = File(...), replace: bool = True, db: Session = Depends(get_db)):
    """BOM 엑셀 업로드 → 원재료·부자재·반제품·완제품·세트 적재"""
    import tempfile, os
    from app.services.bom_importer import import_bom_workbook
    try:
        suffix = os.path.splitext(file.filename or "bom.xlsx")[1] or ".xlsx"
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(await file.read())
            tmp_path = tmp.name
        report = import_bom_workbook(tmp_path, db, replace=replace)
        try:
            os.unlink(tmp_path)
        except Exception:
            pass
        return {"success": True, "report": {
            "raw_materials": report["raw_materials"],
            "sub_materials": report["sub_materials"],
            "errors": report["errors"],
            "sheets": [{"sheet": s.get("sheet"), "items": s.get("items"),
                        "bom_lines": s.get("bom_lines"), "sets": s.get("sets", [])}
                       for s in report["sheets"]],
        }}
    except Exception as e:
        db.rollback()
        logger.error(f"BOM 임포트 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))
