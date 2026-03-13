import os
import re
import json
import tempfile
import logging
from collections import OrderedDict
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Form
from pydantic import BaseModel
from typing import Optional, List

from app.services.targets_service import TargetsService
from app.api.routes.auth import get_current_user
from app.database import get_db, SessionLocal
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


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


# === 리포트 스케줄 관리 ===

class ReportScheduleCreate(BaseModel):
    name: str = "영업 지표 리포트"
    recipients: str  # comma-separated emails
    schedule_days: str  # comma-separated: 월,화,수
    schedule_time: str = "09:00"
    year: int
    month: Optional[int] = None
    auto_send: bool = True


class ReportScheduleUpdate(BaseModel):
    name: Optional[str] = None
    recipients: Optional[str] = None
    schedule_days: Optional[str] = None
    schedule_time: Optional[str] = None
    year: Optional[int] = None
    month: Optional[int] = None
    auto_send: Optional[bool] = None


@router.get("/report/schedules")
async def list_report_schedules(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """리포트 이메일 스케줄 목록 조회"""
    from app.db_models import TargetReportSchedule
    schedules = db.query(TargetReportSchedule).filter(
        TargetReportSchedule.user_id == current_user.get("sub", "")
    ).order_by(TargetReportSchedule.created_at.desc()).all()
    return [
        {
            "id": s.id,
            "name": s.name,
            "recipients": s.recipients,
            "schedule_days": s.schedule_days,
            "schedule_time": s.schedule_time,
            "year": s.year,
            "month": s.month,
            "auto_send": s.auto_send,
            "created_at": s.created_at.isoformat() if s.created_at else None,
        }
        for s in schedules
    ]


@router.post("/report/schedules")
async def create_report_schedule(
    data: ReportScheduleCreate,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """리포트 이메일 스케줄 생성"""
    from app.db_models import TargetReportSchedule
    schedule = TargetReportSchedule(
        name=data.name,
        recipients=data.recipients,
        schedule_days=data.schedule_days,
        schedule_time=data.schedule_time,
        year=data.year,
        month=data.month,
        auto_send=data.auto_send,
        user_id=current_user.get("sub", ""),
    )
    db.add(schedule)
    db.commit()
    db.refresh(schedule)
    return {
        "id": schedule.id,
        "name": schedule.name,
        "recipients": schedule.recipients,
        "schedule_days": schedule.schedule_days,
        "schedule_time": schedule.schedule_time,
        "year": schedule.year,
        "month": schedule.month,
        "auto_send": schedule.auto_send,
    }


@router.put("/report/schedules/{schedule_id}")
async def update_report_schedule(
    schedule_id: int,
    data: ReportScheduleUpdate,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """리포트 이메일 스케줄 수정"""
    from app.db_models import TargetReportSchedule
    schedule = db.query(TargetReportSchedule).filter(
        TargetReportSchedule.id == schedule_id,
        TargetReportSchedule.user_id == current_user.get("sub", ""),
    ).first()
    if not schedule:
        raise HTTPException(status_code=404, detail="스케줄을 찾을 수 없습니다")
    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(schedule, key, value)
    db.commit()
    return {"message": "수정되었습니다"}


@router.delete("/report/schedules/{schedule_id}")
async def delete_report_schedule(
    schedule_id: int,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """리포트 이메일 스케줄 삭제"""
    from app.db_models import TargetReportSchedule
    schedule = db.query(TargetReportSchedule).filter(
        TargetReportSchedule.id == schedule_id,
        TargetReportSchedule.user_id == current_user.get("sub", ""),
    ).first()
    if not schedule:
        raise HTTPException(status_code=404, detail="스케줄을 찾을 수 없습니다")
    db.delete(schedule)
    db.commit()
    return {"message": "삭제되었습니다"}


@router.post("/report/schedules/test-now")
async def test_schedule_now(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
    service: TargetsService = Depends(get_targets_service),
):
    """등록된 스케줄을 즉시 실행하여 이메일 발송 테스트"""
    from app.db_models import TargetReportSchedule
    from datetime import timedelta, timezone as tz

    KST = tz(timedelta(hours=9))
    now = datetime.now(KST)

    schedules = db.query(TargetReportSchedule).filter(
        TargetReportSchedule.auto_send == True,
    ).all()

    if not schedules:
        return {"error": "활성화된 스케줄이 없습니다", "kst_now": now.strftime("%Y-%m-%d %H:%M:%S")}

    results = []
    for sched in schedules:
        sched_info = {
            "id": sched.id,
            "name": sched.name,
            "recipients": sched.recipients,
            "schedule_days": sched.schedule_days,
            "schedule_time": sched.schedule_time,
            "year": sched.year,
            "month": sched.month,
            "user_id": sched.user_id,
        }

        recipients = [e.strip() for e in (sched.recipients or "").split(",") if e.strip()]
        if not recipients:
            sched_info["status"] = "SKIP: 수신자 없음"
            results.append(sched_info)
            continue

        try:
            from app.config import get_settings
            import resend

            settings = get_settings()
            if not settings.RESEND_API_KEY:
                sched_info["status"] = "SKIP: RESEND_API_KEY 없음"
                results.append(sched_info)
                continue

            resend.api_key = settings.RESEND_API_KEY

            year = sched.year or now.year
            month = sched.month or now.month

            targets = service.get_targets_by_year_month(year, month)
            sales = service.get_sales_by_year_month(year, month)
            by_mgr_target = service.get_targets_by_manager(year, month)
            by_mgr_sales = service.get_sales_by_manager(year, month, until_today=False)
            html = _build_report_html(year, month, targets, sales, by_mgr_target, by_mgr_sales)

            resend.Emails.send({
                "from": settings.RESEND_FROM_EMAIL,
                "to": recipients,
                "subject": f"[Nuldam] {year}년 {month}월 영업 지표 리포트 (테스트)",
                "html": html,
            })

            sched.last_sent_at = now.replace(tzinfo=None)
            db.commit()
            sched_info["status"] = f"SUCCESS: {recipients} 에게 발송 완료"

        except Exception as e:
            sched_info["status"] = f"ERROR: {str(e)}"

        results.append(sched_info)

    return {
        "kst_now": now.strftime("%Y-%m-%d %H:%M:%S %A"),
        "total_schedules": len(schedules),
        "results": results,
    }


@router.get("/report/schedules/debug")
async def debug_schedules(
    db: Session = Depends(get_db),
):
    """스케줄 디버그 정보 조회"""
    from app.db_models import TargetReportSchedule
    from datetime import timedelta, timezone as tz

    KST = tz(timedelta(hours=9))
    now = datetime.now(KST)
    DAY_MAP = {"월": 0, "화": 1, "수": 2, "목": 3, "금": 4, "토": 5, "일": 6}
    WEEKDAY_KR = ["월", "화", "수", "목", "금", "토", "일"]

    schedules = db.query(TargetReportSchedule).all()

    items = []
    for s in schedules:
        days_str = s.schedule_days or ""
        sched_days = [DAY_MAP.get(d.strip(), -1) for d in days_str.split(",") if d.strip()]
        today_match = now.weekday() in sched_days
        time_match = now.strftime("%H:%M") == (s.schedule_time or "09:00")

        items.append({
            "id": s.id,
            "name": s.name,
            "recipients": s.recipients,
            "schedule_days": s.schedule_days,
            "schedule_days_parsed": sched_days,
            "schedule_time": s.schedule_time,
            "auto_send": s.auto_send,
            "user_id": s.user_id,
            "year": s.year,
            "month": s.month,
            "last_sent_at": str(s.last_sent_at) if s.last_sent_at else None,
            "updated_at": str(s.updated_at) if s.updated_at else None,
            "today_day_match": today_match,
            "current_time_match": time_match,
            "would_fire_now": today_match and time_match and s.auto_send,
        })

    return {
        "kst_now": now.strftime("%Y-%m-%d %H:%M:%S"),
        "kst_weekday": WEEKDAY_KR[now.weekday()],
        "total_schedules": len(schedules),
        "schedules": items,
    }


class ReportSendRequest(BaseModel):
    year: int
    month: int
    recipients: str  # comma-separated
    html_content: Optional[str] = None


@router.post("/report/send")
async def send_report_email(
    body: ReportSendRequest,
    current_user: dict = Depends(get_current_user),
    service: TargetsService = Depends(get_targets_service),
):
    """리포트를 이메일로 즉시 발송"""
    try:
        from app.config import get_settings
        import resend

        settings = get_settings()
        if not settings.RESEND_API_KEY:
            raise HTTPException(status_code=400, detail="이메일 설정이 되어있지 않습니다 (RESEND_API_KEY)")

        resend.api_key = settings.RESEND_API_KEY

        # 프론트엔드에서 HTML을 보냈으면 그대로 사용, 아니면 서버에서 생성
        if body.html_content:
            html = body.html_content
        else:
            targets = service.get_targets_by_year_month(body.year, body.month)
            sales = service.get_sales_by_year_month(body.year, body.month)
            by_manager_target = service.get_targets_by_manager(body.year, body.month)
            by_manager_sales = service.get_sales_by_manager(body.year, body.month, until_today=False)
            html = _build_report_html(body.year, body.month, targets, sales, by_manager_target, by_manager_sales)

        email_list = [e.strip() for e in body.recipients.split(",") if e.strip()]
        if not email_list:
            raise HTTPException(status_code=400, detail="수신자 이메일이 필요합니다")

        resend.Emails.send({
            "from": settings.RESEND_FROM_EMAIL,
            "to": email_list,
            "subject": f"[Nuldam] {body.year}년 {body.month}월 영업 지표 리포트",
            "html": html,
        })
        return {"message": f"{len(email_list)}명에게 리포트를 발송했습니다"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Report email send failed: {e}")
        raise HTTPException(status_code=500, detail=f"이메일 발송 실패: {str(e)}")


def _build_report_html(year, month, targets, sales, by_manager_target, by_manager_sales):
    """리포트 HTML 생성"""
    managers_target = by_manager_target.get("by_manager", {})
    managers_sales = by_manager_sales.get("by_manager", {})
    all_managers = sorted(set(list(managers_target.keys()) + list(managers_sales.keys())))

    rows_html = ""
    for mgr in all_managers:
        t_sales = managers_target.get(mgr, {}).get("매출", 0)
        a_sales = managers_sales.get(mgr, {}).get("매출", 0)
        rate = round(a_sales / t_sales * 100, 1) if t_sales > 0 else 0
        color = "#10b981" if rate >= 100 else "#f59e0b" if rate >= 80 else "#ef4444"
        rows_html += f"""
        <tr>
            <td style="padding:8px;border:1px solid #e2e8f0">{mgr}</td>
            <td style="padding:8px;border:1px solid #e2e8f0;text-align:right">{t_sales:,.0f}원</td>
            <td style="padding:8px;border:1px solid #e2e8f0;text-align:right">{a_sales:,.0f}원</td>
            <td style="padding:8px;border:1px solid #e2e8f0;text-align:right;color:{color};font-weight:bold">{rate}%</td>
        </tr>"""

    return f"""
    <div style="font-family:sans-serif;max-width:700px;margin:0 auto;padding:20px">
        <h1 style="color:#1e40af;border-bottom:2px solid #3b82f6;padding-bottom:10px">
            {year}년 {month}월 영업 지표 리포트
        </h1>
        <p style="color:#64748b">생성일: {datetime.now().strftime('%Y-%m-%d %H:%M')}</p>
        <h2 style="color:#334155;margin-top:20px">담당자별 목표 vs 실적</h2>
        <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
            <thead>
                <tr style="background:#f1f5f9">
                    <th style="padding:8px;border:1px solid #e2e8f0;text-align:left">담당자</th>
                    <th style="padding:8px;border:1px solid #e2e8f0;text-align:right">목표 매출</th>
                    <th style="padding:8px;border:1px solid #e2e8f0;text-align:right">실적 매출</th>
                    <th style="padding:8px;border:1px solid #e2e8f0;text-align:right">달성률</th>
                </tr>
            </thead>
            <tbody>{rows_html}</tbody>
        </table>
        <p style="color:#94a3b8;font-size:12px;margin-top:30px">
            이 리포트는 Nuldam Analytics에서 자동 생성되었습니다.
        </p>
    </div>
    """
