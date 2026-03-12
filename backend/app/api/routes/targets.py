import os
import re
import tempfile
from collections import OrderedDict

from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Form
from pydantic import BaseModel
from typing import Optional

from app.services.targets_service import TargetsService
from app.api.routes.auth import get_current_user


router = APIRouter(prefix="/targets", tags=["targets"])


# === Excel 파싱 유틸리티 ===

MONTH_HEADERS = [f"{m}월" for m in range(1, 13)]
SKIP_KEYWORDS = {"소계", "합계", "Total", "total", "TOTAL"}


def _parse_cell_value(value) -> int:
    """셀 값을 정수로 변환 (쉼표, 공백 등 제거)"""
    if value is None or value == "":
        return 0
    if isinstance(value, (int, float)):
        return int(value)
    cleaned = re.sub(r"[^\d.\-]", "", str(value))
    try:
        return int(float(cleaned)) if cleaned else 0
    except ValueError:
        return 0


def _should_skip_row(row_values: list) -> bool:
    """소계/합계/Total 행인지 또는 빈 행인지 판별"""
    for val in row_values:
        if val is not None and str(val).strip() in SKIP_KEYWORDS:
            return True
    return False


def _parse_excel_sheet(wb):
    """워크북에서 적절한 시트를 찾아 파싱한 결과를 반환.

    Returns:
        list of dicts, each with keys: manager, category, channel, monthly (list of 12 values)
    """
    from openpyxl.utils import get_column_letter

    parsed_rows = []

    for ws in wb.worksheets:
        # 1) 헤더 행 자동 탐색: "담당자"가 있고, "판매채널" 또는 "채널"이 있는 행
        header_row_idx = None
        col_manager = None
        col_category = None  # 구분
        col_channel = None   # 판매채널
        month_cols = {}      # {0: col_index_for_1월, 1: col_index_for_2월, ...}

        for row_idx, row in enumerate(ws.iter_rows(min_row=1, max_row=min(20, ws.max_row), values_only=False), start=1):
            cell_values = [cell.value for cell in row]
            str_values = [str(v).strip() if v is not None else "" for v in cell_values]

            has_manager = "담당자" in str_values
            has_channel = any(v in ("판매채널", "채널") for v in str_values)

            if has_manager and has_channel:
                header_row_idx = row_idx
                for ci, sv in enumerate(str_values):
                    if sv == "담당자":
                        col_manager = ci
                    elif sv == "구분":
                        col_category = ci
                    elif sv in ("판매채널", "채널"):
                        col_channel = ci
                    else:
                        for mi, mh in enumerate(MONTH_HEADERS):
                            if sv == mh:
                                month_cols[mi] = ci
                break

        if header_row_idx is None:
            continue  # 이 시트에는 해당 헤더가 없으므로 다음 시트로

        if col_manager is None or col_channel is None:
            continue

        # 12개월 컬럼이 모두 있는지 확인 (없는 월은 None으로 처리)
        if len(month_cols) == 0:
            continue

        # 2) 데이터 행 읽기
        current_manager = None
        current_category = None

        for row in ws.iter_rows(min_row=header_row_idx + 1, max_row=ws.max_row, values_only=False):
            cell_values = [cell.value for cell in row]

            # 빈 행 스킵: 판매채널 열이 비어있으면 스킵
            channel_val = cell_values[col_channel] if col_channel < len(cell_values) else None
            if channel_val is None or str(channel_val).strip() == "":
                continue

            # 소계/합계/Total 행 스킵
            if _should_skip_row(cell_values):
                continue

            # 담당자: 병합 셀이면 이전 값 유지
            manager_val = cell_values[col_manager] if col_manager < len(cell_values) else None
            if manager_val is not None and str(manager_val).strip():
                current_manager = str(manager_val).strip()

            # 구분: 병합 셀이면 이전 값 유지
            if col_category is not None:
                category_val = cell_values[col_category] if col_category < len(cell_values) else None
                if category_val is not None and str(category_val).strip():
                    current_category = str(category_val).strip()
            else:
                current_category = ""

            channel_str = str(channel_val).strip()

            # 월별 데이터 추출
            monthly = []
            for mi in range(12):
                if mi in month_cols:
                    ci = month_cols[mi]
                    val = cell_values[ci] if ci < len(cell_values) else None
                    monthly.append(_parse_cell_value(val))
                else:
                    monthly.append(0)

            parsed_rows.append({
                "manager": current_manager or "",
                "category": current_category or "",
                "channel": channel_str,
                "monthly": monthly,
            })

        # 첫 번째 유효한 시트를 찾으면 종료
        if parsed_rows:
            break

    return parsed_rows


def _group_by_manager(parsed_rows: list) -> OrderedDict:
    """파싱된 행을 담당자별로 그룹핑.

    Returns:
        OrderedDict: manager_name -> list of row dicts
    """
    groups: OrderedDict = OrderedDict()
    for row in parsed_rows:
        mgr = row["manager"]
        if mgr not in groups:
            groups[mgr] = []
        groups[mgr].append(row)
    return groups


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


@router.post("/preview-excel")
async def preview_excel(
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    """엑셀 파일을 파싱하여 미리보기 데이터 반환"""
    import openpyxl

    if not file.filename.endswith((".xlsx", ".xls")):
        raise HTTPException(status_code=400, detail="엑셀 파일(.xlsx)만 업로드 가능합니다")

    tmp_path = None
    try:
        # 임시 파일로 저장
        suffix = os.path.splitext(file.filename)[1]
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp_path = tmp.name
            content = await file.read()
            tmp.write(content)

        wb = openpyxl.load_workbook(tmp_path, read_only=True, data_only=True)
        parsed_rows = _parse_excel_sheet(wb)
        wb.close()

        if not parsed_rows:
            raise HTTPException(status_code=400, detail="엑셀에서 유효한 데이터를 찾을 수 없습니다. 헤더에 '담당자', '판매채널' 열이 필요합니다.")

        groups = _group_by_manager(parsed_rows)

        managers = []
        for mgr_name, rows in groups.items():
            channels = []
            for r in rows:
                channels.append({
                    "category": r["category"],
                    "channel": r["channel"],
                    "monthly": r["monthly"],
                })
            managers.append({
                "manager": mgr_name,
                "channels": channels,
            })

        return {
            "managers": managers,
            "total_channels": len(parsed_rows),
            "total_managers": len(groups),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"엑셀 파일 파싱 중 오류가 발생했습니다: {str(e)}")
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)


@router.post("/upload-excel")
async def upload_excel(
    file: UploadFile = File(...),
    department: str = Form(...),
    year: int = Form(...),
    kpi_type: str = Form(...),
    current_user: dict = Depends(get_current_user),
    service: TargetsService = Depends(get_targets_service),
):
    """엑셀 파일을 파싱하여 담당자별 목표 데이터를 일괄 생성"""
    import openpyxl

    if not file.filename.endswith((".xlsx", ".xls")):
        raise HTTPException(status_code=400, detail="엑셀 파일(.xlsx)만 업로드 가능합니다")

    tmp_path = None
    try:
        # 임시 파일로 저장
        suffix = os.path.splitext(file.filename)[1]
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp_path = tmp.name
            content = await file.read()
            tmp.write(content)

        wb = openpyxl.load_workbook(tmp_path, read_only=True, data_only=True)
        parsed_rows = _parse_excel_sheet(wb)
        wb.close()

        if not parsed_rows:
            raise HTTPException(status_code=400, detail="엑셀에서 유효한 데이터를 찾을 수 없습니다. 헤더에 '담당자', '판매채널' 열이 필요합니다.")

        groups = _group_by_manager(parsed_rows)

        created_targets = []
        for mgr_name, rows in groups.items():
            # grid_data 구성: 각 행 = ["구분-판매채널", 1월값, 2월값, ..., 12월값]
            grid_data = []
            for r in rows:
                label = f"{r['category']}-{r['channel']}" if r["category"] else r["channel"]
                grid_row = [label] + r["monthly"]
                grid_data.append(grid_row)

            target_data = {
                "department": department,
                "year": year,
                "title": f"{year}년 {mgr_name} 매출 목표",
                "manager": mgr_name,
                "kpi_type": kpi_type,
                "grid_data": grid_data,
            }
            created = service.create_target(target_data)
            created_targets.append(created)

        return created_targets
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"엑셀 파일 처리 중 오류가 발생했습니다: {str(e)}")
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)


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
    until_today: bool = True,
    current_user: dict = Depends(get_current_user),
    service: TargetsService = Depends(get_targets_service)
):
    """책임자별 매출 데이터 조회 (당일 기준)"""
    sales_data = service.get_sales_by_manager(year, month, until_today)
    target_data = service.get_targets_by_manager_until_day(year, month)
    return {
        "sales": sales_data,
        "targets": target_data,
    }


@router.get("/sales/chart/by-criteria")
async def get_sales_by_criteria(
    year: int,
    month: int,
    until_today: bool = True,
    current_user: dict = Depends(get_current_user),
    service: TargetsService = Depends(get_targets_service)
):
    """기준별 매출 데이터 조회 (당일 기준)"""
    sales_data = service.get_sales_by_criteria(year, month, until_today)
    target_data = service.get_targets_by_criteria_until_day(year, month)
    return {
        "sales": sales_data,
        "targets": target_data,
    }


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
