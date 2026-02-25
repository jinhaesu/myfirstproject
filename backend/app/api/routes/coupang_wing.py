"""쿠팡 Wing API 연동 라우트"""
import asyncio
import logging
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, HTTPException, Depends, Query, BackgroundTasks
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel

from app.services.coupang_wing_service import get_coupang_wing_service, CoupangWingService
from app.services.channel_service import ChannelService
from app.services.auth_service import AuthService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/coupang-wing", tags=["coupang-wing"])
security = HTTPBearer()


def get_auth_service() -> AuthService:
    return AuthService()


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    auth_service: AuthService = Depends(get_auth_service)
) -> dict:
    token = credentials.credentials
    payload = auth_service.verify_token(token)
    if payload is None:
        raise HTTPException(status_code=401, detail="유효하지 않은 토큰입니다")
    return {"email": payload.get("sub")}


def get_channel_service() -> ChannelService:
    return ChannelService()


class SyncRequest(BaseModel):
    start_date: Optional[str] = None  # YYYY-MM-DD
    end_date: Optional[str] = None    # YYYY-MM-DD
    year: Optional[int] = None
    month: Optional[int] = None
    channel_id: Optional[str] = None


class CredentialsUpdate(BaseModel):
    vendor_id: str
    access_key: str
    secret_key: str


@router.get("/status")
async def get_status(
    _: dict = Depends(get_current_user),
    channel_service: ChannelService = Depends(get_channel_service),
):
    """쿠팡 Wing API 연결 상태 확인"""
    service = get_coupang_wing_service()

    # DB에 저장된 credential이 있으면 로드
    channel = channel_service.get_channel_by_name("쿠팡 WING")
    if channel and channel.get("config"):
        config = channel["config"]
        if config.get("vendor_id") and config.get("access_key") and config.get("secret_key"):
            service.update_config(
                config["vendor_id"],
                config["access_key"],
                config["secret_key"],
            )

    if not service.is_configured():
        return {
            "configured": False,
            "connected": False,
            "message": "API 인증 정보가 설정되지 않았습니다",
        }

    result = await service.test_connection()
    return {
        "configured": True,
        "connected": result["success"],
        "message": result["message"],
    }


@router.post("/credentials")
async def save_credentials(
    data: CredentialsUpdate,
    _: dict = Depends(get_current_user),
    channel_service: ChannelService = Depends(get_channel_service),
):
    """쿠팡 Wing API 인증 정보 저장"""
    channel_name = "쿠팡 WING"
    channel = channel_service.get_channel_by_name(channel_name)

    if not channel:
        channel = channel_service.create_channel({
            "name": channel_name,
            "category": "오픈마켓",
            "integration_type": "api",
        })

    # Channel.config에 저장
    channel_service.update_channel(channel["id"], {
        "config": {
            "vendor_id": data.vendor_id,
            "access_key": data.access_key,
            "secret_key": data.secret_key,
        }
    })

    # 서비스 인스턴스 갱신
    service = get_coupang_wing_service()
    service.update_config(data.vendor_id, data.access_key, data.secret_key)

    # 연결 테스트
    result = await service.test_connection()

    return {
        "success": result["success"],
        "message": result["message"],
        "channel_id": channel["id"],
    }


async def _run_sync_task(
    service: CoupangWingService,
    channel_id: str,
    channel_name: str,
    start_date: str,
    end_date: str,
    sync_log_id: str,
):
    """백그라운드에서 실행되는 동기화 작업"""
    channel_service = ChannelService()
    try:
        channel_service.update_sync_log(sync_log_id, {"status": "running"})

        monthly_data = await service.get_daily_sales_by_range(start_date, end_date)

        sales_list = []
        total_days = 0
        for _ym, days in monthly_data.items():
            total_days += len(days)
            for day_data in days:
                sales_list.append({
                    "channel_id": channel_id,
                    "channel_name": channel_name,
                    "year": day_data["year"],
                    "month": day_data["month"],
                    "day": day_data["day"],
                    "gross_sales": day_data["gross_sales"],
                    "net_sales": day_data["net_sales"],
                    "order_count": day_data["order_count"],
                    "quantity": day_data["quantity"],
                    "commission": day_data["commission"],
                    "source": "coupang_wing_api",
                })

        result = channel_service.bulk_upsert_sales(sales_list, sync_log_id)

        channel_service.update_sync_log(sync_log_id, {
            "status": "success" if not result["errors"] else "partial",
            "completed_at": datetime.utcnow(),
            "records_processed": total_days,
            "records_created": result["created"],
            "error_message": str(result["errors"][:3]) if result["errors"] else None,
        })
        logger.info(
            f"쿠팡 Wing 동기화 완료: {start_date}~{end_date}, "
            f"{total_days}일, {result['created']}건"
        )

    except Exception as e:
        error_detail = f"동기화 실패 ({start_date}~{end_date}): {str(e)}"
        logger.error(error_detail)
        channel_service.update_sync_log(sync_log_id, {
            "status": "failed",
            "completed_at": datetime.utcnow(),
            "error_message": error_detail,
        })


@router.post("/sync")
async def sync_sales(
    data: SyncRequest,
    background_tasks: BackgroundTasks,
    _: dict = Depends(get_current_user),
    channel_service: ChannelService = Depends(get_channel_service),
):
    """쿠팡 Wing 매출 데이터 동기화 (백그라운드 실행)"""
    service = get_coupang_wing_service()

    # DB에서 credential 로드
    channel_name = "쿠팡 WING"
    channel = channel_service.get_channel_by_name(channel_name)
    if channel and channel.get("config"):
        config = channel["config"]
        if config.get("vendor_id") and config.get("access_key") and config.get("secret_key"):
            service.update_config(
                config["vendor_id"],
                config["access_key"],
                config["secret_key"],
            )

    if not service.is_configured():
        raise HTTPException(status_code=400, detail="API 인증 정보가 설정되지 않았습니다")

    # 채널 ID 조회 또는 생성
    channel_id = data.channel_id
    if not channel_id:
        if channel:
            channel_id = channel["id"]
        else:
            channel = channel_service.create_channel({
                "name": channel_name,
                "category": "오픈마켓",
                "integration_type": "api",
            })
            channel_id = channel["id"]

    # 날짜 범위 결정
    start_date = data.start_date
    end_date = data.end_date
    if not start_date or not end_date:
        if data.year and data.month:
            from calendar import monthrange
            days_in_month = monthrange(data.year, data.month)[1]
            start_date = f"{data.year}-{data.month:02d}-01"
            end_date = f"{data.year}-{data.month:02d}-{days_in_month:02d}"
        else:
            raise HTTPException(status_code=400, detail="start_date/end_date 또는 year/month를 지정해주세요")

    # 동기화 로그 생성
    sync_log = channel_service.create_sync_log(channel_id, channel_name, "api")

    # 백그라운드 작업 등록 — 즉시 응답
    background_tasks.add_task(
        _run_sync_task,
        service, channel_id, channel_name, start_date, end_date, sync_log["id"],
    )

    return {
        "success": True,
        "message": f"{start_date} ~ {end_date} 동기화 시작됨",
        "sync_log_id": sync_log["id"],
        "channel_id": channel_id,
        "period": f"{start_date} ~ {end_date}",
    }


@router.get("/sync-status/{sync_log_id}")
async def get_sync_status(
    sync_log_id: str,
    _: dict = Depends(get_current_user),
    channel_service: ChannelService = Depends(get_channel_service),
):
    """동기화 작업 상태 조회 (폴링용)"""
    log = channel_service.get_sync_log(sync_log_id)
    if not log:
        raise HTTPException(status_code=404, detail="동기화 로그를 찾을 수 없습니다")

    finished = log["status"] in ("success", "partial", "failed")
    return {
        "sync_log_id": log["id"],
        "status": log["status"],
        "finished": finished,
        "records_processed": log.get("records_processed", 0),
        "records_created": log.get("records_created", 0),
        "error_message": log.get("error_message"),
        "started_at": log.get("started_at"),
        "completed_at": log.get("completed_at"),
    }


@router.get("/debug-orders")
async def debug_orders(
    start_date: str = Query(..., description="시작일 (YYYY-MM-DD)"),
    end_date: str = Query(..., description="종료일 (YYYY-MM-DD)"),
    _: dict = Depends(get_current_user),
    channel_service: ChannelService = Depends(get_channel_service),
):
    """디버그용 주문 원본 데이터 조회 (최대 10건)

    지정된 날짜 범위의 주문 데이터를 원본 형태로 반환합니다.
    모든 주문 상태(ACCEPT, INSTRUCT, DEPARTURE, DELIVERING, FINAL_DELIVERY)를 조회합니다.
    """
    service = get_coupang_wing_service()

    # DB에서 credential 로드
    channel = channel_service.get_channel_by_name("쿠팡 WING")
    if channel and channel.get("config"):
        config = channel["config"]
        if config.get("vendor_id") and config.get("access_key") and config.get("secret_key"):
            service.update_config(config["vendor_id"], config["access_key"], config["secret_key"])

    if not service.is_configured():
        return {"error": "API 인증 정보가 설정되지 않았습니다"}

    try:
        import httpx as _httpx
        async with _httpx.AsyncClient(timeout=30) as client:
            orders = await service._fetch_ordersheets(
                client,
                start_date,
                end_date,
            )

        # 최대 10건만 반환
        limited_orders = orders[:10]

        return {
            "vendor_id": service.config.vendor_id,
            "period": f"{start_date} ~ {end_date}",
            "total_orders": len(orders),
            "returned_orders": len(limited_orders),
            "orders": limited_orders,
        }
    except Exception as e:
        logger.error(f"디버그 주문 조회 실패 ({start_date} ~ {end_date}): {str(e)}")
        return {
            "error": f"주문 조회 실패: {str(e)}",
            "period": f"{start_date} ~ {end_date}",
        }


@router.get("/debug-raw")
async def debug_raw_response(
    start_date: str,
    end_date: str,
    channel_service: ChannelService = Depends(get_channel_service),
):
    """API 원본 응답 확인 (디버그용)"""
    service = get_coupang_wing_service()

    # DB에서 credential 로드
    channel = channel_service.get_channel_by_name("쿠팡 WING")
    if channel and channel.get("config"):
        config = channel["config"]
        if config.get("vendor_id") and config.get("access_key") and config.get("secret_key"):
            service.update_config(config["vendor_id"], config["access_key"], config["secret_key"])

    if not service.is_configured():
        return {"error": "API 인증 정보가 설정되지 않았습니다"}

    import httpx
    path = f"/v2/providers/openapi/apis/api/v4/vendors/{service.config.vendor_id}/ordersheets"

    results = {}
    async with httpx.AsyncClient(timeout=15) as client:
        # 여러 상태로 테스트
        for test_status in ["INSTRUCT", "ACCEPT", "DEPARTURE"]:
            try:
                raw = await service._request(
                    client, "GET", path,
                    params={
                        "createdAtFrom": start_date,
                        "createdAtTo": end_date,
                        "status": test_status,
                        "maxPerPage": 5,
                    }
                )
                results[test_status] = raw
            except Exception as e:
                results[f"{test_status}_error"] = str(e)

        # status 없이 조회
        try:
            raw2 = await service._request(
                client, "GET", path,
                params={
                    "createdAtFrom": start_date,
                    "createdAtTo": end_date,
                    "maxPerPage": 5,
                }
            )
            results["no_status"] = raw2
        except Exception as e:
            results["no_status_error"] = str(e)

    return {
        "vendor_id": service.config.vendor_id,
        "query": f"{start_date} ~ {end_date}",
        "note": "날짜 형식: YYYY-MM-DD (예: 2026-02-01)",
        "results": results,
    }
