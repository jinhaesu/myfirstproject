"""월별 결산 매출 API 라우트"""
import asyncio
import logging
from datetime import datetime, timezone
from typing import Optional
from io import BytesIO

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, BackgroundTasks
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

import pandas as pd

from app.api.routes.auth import get_current_user
from app.services.settlement_service import SettlementService
from app.services.settlement_rpa_service import get_settlement_rpa_service, CHANNEL_RPA_DEFAULTS
from app.services.settlement_email_service import SettlementEmailService

router = APIRouter(prefix="/settlement", tags=["settlement"])
logger = logging.getLogger(__name__)


# === Pydantic Models ===
class SettlementUpsert(BaseModel):
    channel_id: str
    channel_name: str
    category: str = "기타"
    year: int
    month: int
    gross_sales: float = 0
    net_sales: float = 0
    settlement_amount: float = 0
    commission: float = 0
    shipping_cost: float = 0
    refund_amount: float = 0
    order_count: int = 0
    quantity: int = 0
    status: str = "pending"
    source: str = "manual"
    notes: Optional[str] = None

class SettlementConfirm(BaseModel):
    confirmed_by: str

class FinalizeMonth(BaseModel):
    year: int
    month: int
    confirmed_by: str

class RpaConfigUpsert(BaseModel):
    channel_id: str
    channel_name: str
    login_url: Optional[str] = None
    login_id: Optional[str] = None
    login_password: Optional[str] = None
    selectors: Optional[dict] = None
    settlement_url: Optional[str] = None
    date_format: str = "%Y-%m-%d"
    download_type: str = "scrape"
    excel_column_mapping: Optional[dict] = None
    excel_skip_rows: int = 0
    excel_sheet_name: Optional[str] = None
    auto_collect_day: int = 5
    is_enabled: bool = True
    extra_config: Optional[dict] = None

class RpaCollectRequest(BaseModel):
    channel_name: str
    year: int
    month: int

class RpaCollectAllRequest(BaseModel):
    year: int
    month: int

class RpaTestRequest(BaseModel):
    channel_name: str
    login_url: Optional[str] = None
    login_id: str
    login_password: str
    selectors: Optional[dict] = None

class ReportCreate(BaseModel):
    report_name: str
    year: int
    month: int
    recipients: list[str]
    schedule_day: int = 10
    schedule_time: str = "09:00"
    is_auto_send: bool = False
    include_channels: Optional[list[str]] = None
    include_chart: bool = True
    include_comparison: bool = True

class ReportSendNow(BaseModel):
    year: int
    month: int
    recipients: list[str]

class ExcelUpload(BaseModel):
    channel_id: str
    channel_name: str
    category: str
    year: int
    month: int


# === 결산 데이터 API ===
@router.get("/monthly")
async def get_monthly_settlements(year: int, month: int, user=Depends(get_current_user)):
    svc = SettlementService()
    return svc.get_monthly_settlements(year, month)

@router.get("/yearly")
async def get_yearly_settlements(year: int, channel_id: Optional[str] = None, user=Depends(get_current_user)):
    svc = SettlementService()
    return svc.get_yearly_settlements(year, channel_id)

@router.get("/yearly-summary")
async def get_yearly_summary(year: int, user=Depends(get_current_user)):
    svc = SettlementService()
    return svc.get_yearly_summary(year)

@router.get("/comparison")
async def get_month_comparison(year: int, month: int, user=Depends(get_current_user)):
    svc = SettlementService()
    return svc.get_month_comparison(year, month)

@router.post("/upsert")
async def upsert_settlement(data: SettlementUpsert, user=Depends(get_current_user)):
    svc = SettlementService()
    return svc.upsert_settlement(data.dict())

@router.post("/confirm/{settlement_id}")
async def confirm_settlement(settlement_id: str, data: SettlementConfirm, user=Depends(get_current_user)):
    svc = SettlementService()
    result = svc.confirm_settlement(settlement_id, data.confirmed_by)
    if not result:
        raise HTTPException(404, "결산 데이터를 찾을 수 없습니다")
    return result

@router.post("/finalize")
async def finalize_month(data: FinalizeMonth, user=Depends(get_current_user)):
    svc = SettlementService()
    return svc.finalize_month(data.year, data.month, data.confirmed_by)

@router.delete("/{settlement_id}")
async def delete_settlement(settlement_id: str, user=Depends(get_current_user)):
    svc = SettlementService()
    if not svc.delete_settlement(settlement_id):
        raise HTTPException(404, "결산 데이터를 찾을 수 없습니다")
    return {"success": True}


# === 엑셀 다운로드 ===
@router.get("/download-excel")
async def download_settlement_excel(year: int, month: int, user=Depends(get_current_user)):
    svc = SettlementService()
    settlements = svc.get_monthly_settlements(year, month)

    rows = []
    for s in settlements:
        rows.append({
            "카테고리": s.get("category", ""),
            "채널명": s.get("channel_name", ""),
            "총매출": s.get("gross_sales", 0),
            "순매출": s.get("net_sales", 0),
            "정산금액": s.get("settlement_amount", 0),
            "수수료": s.get("commission", 0),
            "배송비": s.get("shipping_cost", 0),
            "환불금액": s.get("refund_amount", 0),
            "주문건수": s.get("order_count", 0),
            "판매수량": s.get("quantity", 0),
            "상태": s.get("status", ""),
            "데이터소스": s.get("source", ""),
            "메모": s.get("notes", ""),
        })

    df = pd.DataFrame(rows)
    buffer = BytesIO()
    with pd.ExcelWriter(buffer, engine="openpyxl") as writer:
        df.to_excel(writer, sheet_name=f"{year}년 {month}월", index=False)
    buffer.seek(0)

    filename = f"settlement_{year}_{month:02d}.xlsx"
    return StreamingResponse(
        buffer,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


# === 엑셀 업로드 (수동 채널용) ===
@router.post("/upload-excel")
async def upload_settlement_excel(
    channel_id: str,
    channel_name: str,
    category: str,
    year: int,
    month: int,
    file: UploadFile = File(...),
    user=Depends(get_current_user),
):
    try:
        contents = await file.read()
        df = pd.read_excel(BytesIO(contents))

        data = {"channel_id": channel_id, "channel_name": channel_name, "category": category, "year": year, "month": month, "source": "upload"}

        # 컬럼 자동 매핑
        for col in df.columns:
            col_lower = col.strip().lower()
            if "정산" in col or "settlement" in col_lower:
                data["settlement_amount"] = float(df[col].sum())
            elif "총매출" in col or "매출" in col or "gross" in col_lower:
                data["gross_sales"] = float(df[col].sum())
            elif "수수료" in col or "commission" in col_lower:
                data["commission"] = float(df[col].sum())
            elif "환불" in col or "반품" in col or "refund" in col_lower:
                data["refund_amount"] = float(df[col].sum())
            elif "주문" in col or "order" in col_lower:
                data["order_count"] = int(df[col].sum())
            elif "수량" in col or "quantity" in col_lower:
                data["quantity"] = int(df[col].sum())
            elif "배송" in col or "shipping" in col_lower:
                data["shipping_cost"] = float(df[col].sum())

        # 순매출 계산
        if "net_sales" not in data:
            data["net_sales"] = data.get("gross_sales", 0) - data.get("refund_amount", 0)
        if "settlement_amount" not in data:
            data["settlement_amount"] = data.get("net_sales", 0) - data.get("commission", 0)

        data["raw_data"] = df.head(10).to_dict(orient="records")

        svc = SettlementService()
        result = svc.upsert_settlement(data)
        return {"success": True, "settlement": result}

    except Exception as e:
        raise HTTPException(400, f"엑셀 업로드 실패: {str(e)}")


# === RPA 설정 API ===
@router.get("/rpa-configs")
async def get_rpa_configs(user=Depends(get_current_user)):
    svc = SettlementService()
    return svc.get_all_rpa_configs()

@router.get("/rpa-config/{channel_id}")
async def get_rpa_config(channel_id: str, user=Depends(get_current_user)):
    svc = SettlementService()
    config = svc.get_rpa_config(channel_id)
    if not config:
        raise HTTPException(404, "RPA 설정을 찾을 수 없습니다")
    return config

@router.post("/rpa-config")
async def upsert_rpa_config(data: RpaConfigUpsert, user=Depends(get_current_user)):
    svc = SettlementService()
    return svc.upsert_rpa_config(data.dict())

@router.delete("/rpa-config/{channel_id}")
async def delete_rpa_config(channel_id: str, user=Depends(get_current_user)):
    svc = SettlementService()
    if not svc.delete_rpa_config(channel_id):
        raise HTTPException(404, "RPA 설정을 찾을 수 없습니다")
    return {"success": True}

@router.get("/rpa-defaults")
async def get_rpa_defaults(user=Depends(get_current_user)):
    """채널별 기본 RPA 설정 조회"""
    return CHANNEL_RPA_DEFAULTS

@router.post("/rpa-test")
async def test_rpa_connection(data: RpaTestRequest, user=Depends(get_current_user)):
    """RPA 로그인 테스트"""
    rpa_svc = get_settlement_rpa_service()
    result = await rpa_svc.test_channel_connection(data.channel_name, data.dict())
    return result


# === RPA 수집 API ===
@router.post("/rpa-collect")
async def collect_settlement_rpa(
    data: RpaCollectRequest,
    background_tasks: BackgroundTasks,
    user=Depends(get_current_user),
):
    """단일 채널 RPA 결산 수집"""
    svc = SettlementService()
    rpa_svc = get_settlement_rpa_service()

    # 수집 로그 생성
    # 채널 정보 조회
    from app.services.channel_service import ChannelService
    ch_svc = ChannelService()
    channel = ch_svc.get_channel_by_name(data.channel_name)
    channel_id = channel["id"] if channel else "unknown"

    log = svc.create_collection_log({
        "channel_id": channel_id,
        "channel_name": data.channel_name,
        "year": data.year,
        "month": data.month,
        "collection_type": "rpa",
    })

    # RPA 설정 조회
    rpa_config = svc.get_rpa_config(channel_id)

    async def _bg_collect():
        try:
            svc2 = SettlementService()
            svc2.update_collection_log(log["id"], {"status": "running"})

            result = await rpa_svc.collect_settlement(data.channel_name, data.year, data.month, rpa_config)

            if result.get("success") and result.get("data"):
                # 결산 데이터 저장
                settlement_data = {
                    "channel_id": channel_id,
                    "channel_name": data.channel_name,
                    "category": channel.get("category", "기타") if channel else "기타",
                    "year": data.year,
                    "month": data.month,
                    "source": "rpa",
                    **result["data"],
                }
                svc2.upsert_settlement(settlement_data)

                svc2.update_collection_log(log["id"], {
                    "status": "success",
                    "completed_at": datetime.now(timezone.utc),
                    "settlement_amount": result["data"].get("settlement_amount"),
                    "screenshot_path": result.get("screenshot"),
                    "details": result,
                })
            else:
                svc2.update_collection_log(log["id"], {
                    "status": "failed",
                    "completed_at": datetime.now(timezone.utc),
                    "error_message": result.get("message"),
                    "screenshot_path": result.get("screenshot"),
                    "details": result,
                })
        except Exception as e:
            svc2 = SettlementService()
            svc2.update_collection_log(log["id"], {
                "status": "failed",
                "completed_at": datetime.now(timezone.utc),
                "error_message": str(e),
            })

    background_tasks.add_task(asyncio.ensure_future, _bg_collect())
    return {"log_id": log["id"], "status": "started", "channel_name": data.channel_name}

@router.post("/rpa-collect-all")
async def collect_all_settlements_rpa(
    data: RpaCollectAllRequest,
    background_tasks: BackgroundTasks,
    user=Depends(get_current_user),
):
    """전체 RPA 채널 일괄 수집"""
    svc = SettlementService()
    configs = svc.get_all_rpa_configs()
    config_map = {c["channel_name"]: c for c in configs}

    logs = []
    from app.services.channel_service import ChannelService
    ch_svc = ChannelService()

    for channel_name, defaults in CHANNEL_RPA_DEFAULTS.items():
        if defaults.get("method") == "manual":
            continue
        channel = ch_svc.get_channel_by_name(channel_name)
        if not channel:
            continue
        config = config_map.get(channel_name, {})
        if not config.get("login_id"):
            continue

        log = svc.create_collection_log({
            "channel_id": channel["id"],
            "channel_name": channel_name,
            "year": data.year,
            "month": data.month,
            "collection_type": "rpa",
        })
        logs.append({"log_id": log["id"], "channel_name": channel_name})

    async def _bg_collect_all():
        rpa_svc = get_settlement_rpa_service()
        for log_info in logs:
            svc2 = SettlementService()
            try:
                svc2.update_collection_log(log_info["log_id"], {"status": "running"})
                channel = ch_svc.get_channel_by_name(log_info["channel_name"])
                config = config_map.get(log_info["channel_name"], {})
                result = await rpa_svc.collect_settlement(log_info["channel_name"], data.year, data.month, config)

                if result.get("success") and result.get("data"):
                    settlement_data = {
                        "channel_id": channel["id"],
                        "channel_name": log_info["channel_name"],
                        "category": channel.get("category", "기타"),
                        "year": data.year,
                        "month": data.month,
                        "source": "rpa",
                        **result["data"],
                    }
                    svc2.upsert_settlement(settlement_data)
                    svc2.update_collection_log(log_info["log_id"], {
                        "status": "success",
                        "completed_at": datetime.now(timezone.utc),
                        "settlement_amount": result["data"].get("settlement_amount"),
                    })
                else:
                    svc2.update_collection_log(log_info["log_id"], {
                        "status": "failed",
                        "completed_at": datetime.now(timezone.utc),
                        "error_message": result.get("message"),
                    })
            except Exception as e:
                svc2.update_collection_log(log_info["log_id"], {
                    "status": "failed",
                    "completed_at": datetime.now(timezone.utc),
                    "error_message": str(e),
                })

    background_tasks.add_task(asyncio.ensure_future, _bg_collect_all())
    return {"status": "started", "logs": logs, "total": len(logs)}


# === 수집 로그 API ===
@router.get("/collection-logs")
async def get_collection_logs(
    channel_id: Optional[str] = None,
    year: Optional[int] = None,
    month: Optional[int] = None,
    user=Depends(get_current_user),
):
    svc = SettlementService()
    return svc.get_collection_logs(channel_id, year, month)

@router.get("/collection-log/{log_id}")
async def get_collection_log(log_id: str, user=Depends(get_current_user)):
    svc = SettlementService()
    log = svc.update_collection_log(log_id, {})  # just get it
    if not log:
        raise HTTPException(404, "로그를 찾을 수 없습니다")
    return log


# === 리포트 API ===
@router.get("/reports")
async def get_reports(year: Optional[int] = None, user=Depends(get_current_user)):
    svc = SettlementService()
    return svc.get_reports(year)

@router.post("/reports")
async def create_report(data: ReportCreate, user=Depends(get_current_user)):
    svc = SettlementService()
    return svc.create_report(data.dict())

@router.put("/reports/{report_id}")
async def update_report(report_id: str, data: dict, user=Depends(get_current_user)):
    svc = SettlementService()
    result = svc.update_report(report_id, data)
    if not result:
        raise HTTPException(404, "리포트를 찾을 수 없습니다")
    return result

@router.delete("/reports/{report_id}")
async def delete_report(report_id: str, user=Depends(get_current_user)):
    svc = SettlementService()
    if not svc.delete_report(report_id):
        raise HTTPException(404, "리포트를 찾을 수 없습니다")
    return {"success": True}

@router.post("/reports/send-now")
async def send_report_now(data: ReportSendNow, user=Depends(get_current_user)):
    """즉시 리포트 발송"""
    svc = SettlementService()
    settlements = svc.get_monthly_settlements(data.year, data.month)
    comparison = svc.get_month_comparison(data.year, data.month)

    email_svc = SettlementEmailService()
    result = email_svc.send_settlement_report(data.recipients, data.year, data.month, settlements, comparison)
    return result
