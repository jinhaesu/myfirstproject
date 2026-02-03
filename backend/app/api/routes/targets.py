from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional

from app.services.targets_service import TargetsService
from app.api.routes.auth import get_current_user


router = APIRouter(prefix="/targets", tags=["targets"])


class TargetCreate(BaseModel):
    department: str
    year: int
    title: str
    manager: str
    kpi_type: str  # 매출, 광고선전비, 공헌이익, 판매량
    grid_data: list[list]  # 2D 배열


class TargetUpdate(BaseModel):
    department: Optional[str] = None
    year: Optional[int] = None
    title: Optional[str] = None
    manager: Optional[str] = None
    kpi_type: Optional[str] = None
    grid_data: Optional[list[list]] = None


class SaleCreate(BaseModel):
    year: int
    month: int
    title: str
    manager: str
    kpi_type: str
    grid_data: list[list]


class SaleUpdate(BaseModel):
    year: Optional[int] = None
    month: Optional[int] = None
    title: Optional[str] = None
    manager: Optional[str] = None
    kpi_type: Optional[str] = None
    grid_data: Optional[list[list]] = None


def get_targets_service() -> TargetsService:
    return TargetsService()


# === 목표 데이터 API ===
@router.get("/")
async def get_targets(
    year: Optional[int] = None,
    current_user: dict = Depends(get_current_user),
    service: TargetsService = Depends(get_targets_service)
):
    """모든 목표 데이터 조회"""
    if year:
        return service.get_targets_by_year_month(year)
    return service.get_all_targets()


@router.get("/summary")
async def get_target_summary(
    year: int,
    month: Optional[int] = None,
    current_user: dict = Depends(get_current_user),
    service: TargetsService = Depends(get_targets_service)
):
    """목표 합계 조회"""
    return service.get_target_summary(year, month)


@router.get("/chart/by-manager")
async def get_targets_by_manager(
    year: int,
    month: Optional[int] = None,
    current_user: dict = Depends(get_current_user),
    service: TargetsService = Depends(get_targets_service)
):
    """책임자별 목표 데이터 조회"""
    return service.get_targets_by_manager(year, month)


@router.get("/chart/by-criteria")
async def get_targets_by_criteria(
    year: int,
    month: Optional[int] = None,
    current_user: dict = Depends(get_current_user),
    service: TargetsService = Depends(get_targets_service)
):
    """기준별 목표 데이터 조회"""
    return service.get_targets_by_criteria(year, month)


@router.get("/{target_id}")
async def get_target(
    target_id: str,
    current_user: dict = Depends(get_current_user),
    service: TargetsService = Depends(get_targets_service)
):
    """특정 목표 데이터 조회"""
    target = service.get_target_by_id(target_id)
    if not target:
        raise HTTPException(status_code=404, detail="목표 데이터를 찾을 수 없습니다")
    return target


@router.post("/")
async def create_target(
    data: TargetCreate,
    current_user: dict = Depends(get_current_user),
    service: TargetsService = Depends(get_targets_service)
):
    """새 목표 데이터 생성"""
    return service.create_target(data.model_dump())


@router.put("/{target_id}")
async def update_target(
    target_id: str,
    data: TargetUpdate,
    current_user: dict = Depends(get_current_user),
    service: TargetsService = Depends(get_targets_service)
):
    """목표 데이터 수정"""
    target = service.update_target(target_id, data.model_dump(exclude_unset=True))
    if not target:
        raise HTTPException(status_code=404, detail="목표 데이터를 찾을 수 없습니다")
    return target


@router.delete("/{target_id}")
async def delete_target(
    target_id: str,
    current_user: dict = Depends(get_current_user),
    service: TargetsService = Depends(get_targets_service)
):
    """목표 데이터 삭제"""
    if not service.delete_target(target_id):
        raise HTTPException(status_code=404, detail="목표 데이터를 찾을 수 없습니다")
    return {"message": "삭제되었습니다"}


# === 매출 현황 API ===
@router.get("/sales/list")
async def get_sales(
    year: Optional[int] = None,
    month: Optional[int] = None,
    current_user: dict = Depends(get_current_user),
    service: TargetsService = Depends(get_targets_service)
):
    """매출 현황 데이터 조회"""
    if year:
        return service.get_sales_by_year_month(year, month)
    return service.get_all_sales()


@router.get("/sales/summary")
async def get_sales_summary(
    year: int,
    month: int,
    current_user: dict = Depends(get_current_user),
    service: TargetsService = Depends(get_targets_service)
):
    """매출 현황 합계 조회"""
    return service.get_sales_summary(year, month)


@router.get("/sales/comparison")
async def get_comparison(
    year: int,
    month: int,
    manager: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
    service: TargetsService = Depends(get_targets_service)
):
    """목표 대비 실적, 전월 대비 데이터 조회 (책임자 필터 옵션)"""
    return service.get_comparison_data(year, month, manager)


@router.get("/sales/realtime")
async def get_realtime_indicator(
    year: int,
    month: int,
    manager: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
    service: TargetsService = Depends(get_targets_service)
):
    """실시간 지표 조회 (당일 기준 목표 대비 달성률)"""
    return service.get_realtime_indicator(year, month, manager)


@router.get("/sales/daily-chart")
async def get_daily_sales_chart(
    year: int,
    month: int,
    manager: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
    service: TargetsService = Depends(get_targets_service)
):
    """일별 매출 데이터 (그래프용)"""
    return service.get_daily_sales_data(year, month, manager)


@router.get("/sales/daily-target")
async def get_daily_target_chart(
    year: int,
    month: int,
    manager: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
    service: TargetsService = Depends(get_targets_service)
):
    """일별 목표 데이터 (그래프용) - 월 목표를 일수로 균등 분할"""
    return service.get_daily_target_data(year, month, manager)


@router.get("/sales/chart/by-manager")
async def get_sales_by_manager(
    year: int,
    month: int,
    current_user: dict = Depends(get_current_user),
    service: TargetsService = Depends(get_targets_service)
):
    """책임자별 매출 데이터 조회"""
    return service.get_sales_by_manager(year, month)


@router.get("/sales/chart/by-criteria")
async def get_sales_by_criteria(
    year: int,
    month: int,
    current_user: dict = Depends(get_current_user),
    service: TargetsService = Depends(get_targets_service)
):
    """기준별 매출 데이터 조회"""
    return service.get_sales_by_criteria(year, month)


@router.get("/sales/{sale_id}")
async def get_sale(
    sale_id: str,
    current_user: dict = Depends(get_current_user),
    service: TargetsService = Depends(get_targets_service)
):
    """특정 매출 현황 데이터 조회"""
    sale = service.get_sale_by_id(sale_id)
    if not sale:
        raise HTTPException(status_code=404, detail="매출 현황 데이터를 찾을 수 없습니다")
    return sale


@router.post("/sales")
async def create_sale(
    data: SaleCreate,
    current_user: dict = Depends(get_current_user),
    service: TargetsService = Depends(get_targets_service)
):
    """새 매출 현황 데이터 생성"""
    return service.create_sale(data.model_dump())


@router.put("/sales/{sale_id}")
async def update_sale(
    sale_id: str,
    data: SaleUpdate,
    current_user: dict = Depends(get_current_user),
    service: TargetsService = Depends(get_targets_service)
):
    """매출 현황 데이터 수정"""
    sale = service.update_sale(sale_id, data.model_dump(exclude_unset=True))
    if not sale:
        raise HTTPException(status_code=404, detail="매출 현황 데이터를 찾을 수 없습니다")
    return sale


@router.delete("/sales/{sale_id}")
async def delete_sale(
    sale_id: str,
    current_user: dict = Depends(get_current_user),
    service: TargetsService = Depends(get_targets_service)
):
    """매출 현황 데이터 삭제"""
    if not service.delete_sale(sale_id):
        raise HTTPException(status_code=404, detail="매출 현황 데이터를 찾을 수 없습니다")
    return {"message": "삭제되었습니다"}
