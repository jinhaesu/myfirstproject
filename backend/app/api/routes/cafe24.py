"""카페24 API 연동 라우트"""
import os
import secrets
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, HTTPException, Depends, Query
from fastapi.responses import RedirectResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel

from app.services.cafe24_service import get_cafe24_service, Cafe24Service
from app.services.channel_service import ChannelService
from app.services.auth_service import AuthService

router = APIRouter(prefix="/cafe24", tags=["cafe24"])
security = HTTPBearer()


def get_auth_service() -> AuthService:
    return AuthService()


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    auth_service: AuthService = Depends(get_auth_service),
) -> dict:
    token = credentials.credentials
    payload = auth_service.verify_token(token)
    if payload is None:
        raise HTTPException(status_code=401, detail="유효하지 않은 토큰입니다")
    return {"email": payload.get("sub")}


def get_channel_service() -> ChannelService:
    return ChannelService()


def _get_frontend_url() -> str:
    """FRONTEND_URL 환경변수에서 https:// 보장"""
    url = os.getenv("FRONTEND_URL", "http://localhost:3000")
    if url and not url.startswith("http"):
        url = f"https://{url}"
    return url


class SyncRequest(BaseModel):
    start_date: Optional[str] = None  # YYYY-MM-DD
    end_date: Optional[str] = None    # YYYY-MM-DD
    year: Optional[int] = None        # 하위 호환
    month: Optional[int] = None       # 하위 호환
    channel_id: Optional[str] = None


@router.get("/status")
async def get_status(
    _: dict = Depends(get_current_user),
    channel_service: ChannelService = Depends(get_channel_service),
):
    """카페24 API 연결 상태 확인"""
    service = get_cafe24_service()

    if not service.is_configured():
        return {
            "configured": False,
            "connected": False,
            "has_token": False,
            "message": "API 인증 정보가 설정되지 않았습니다",
        }

    # 채널 ID 조회
    channel = channel_service.get_channel_by_name("카페24")
    channel_id = channel["id"] if channel else None

    has_token = False
    if channel_id:
        has_token = service.has_token(channel_id)

    if not has_token:
        return {
            "configured": True,
            "connected": False,
            "has_token": False,
            "message": "OAuth 인증이 필요합니다",
        }

    result = await service.test_connection(channel_id)
    return {
        "configured": True,
        "connected": result["success"],
        "has_token": True,
        "message": result["message"],
    }


@router.get("/oauth/authorize")
async def oauth_authorize(_: dict = Depends(get_current_user)):
    """카페24 OAuth 인가 URL 반환"""
    service = get_cafe24_service()

    if not service.is_configured():
        raise HTTPException(status_code=400, detail="카페24 API 인증 정보가 설정되지 않았습니다")

    state = secrets.token_urlsafe(32)
    authorize_url = service.get_authorize_url(state)

    return {
        "authorize_url": authorize_url,
        "state": state,
    }


@router.get("/oauth/callback")
async def oauth_callback(
    code: str = Query(...),
    state: str = Query(default=""),
    channel_service: ChannelService = Depends(get_channel_service),
):
    """카페24 OAuth 콜백 - 토큰 교환 및 저장 후 프론트로 리다이렉트

    브라우저에서 직접 접근하므로 Bearer 인증 불필요
    """
    service = get_cafe24_service()

    if not service.is_configured():
        frontend_url = _get_frontend_url()
        return RedirectResponse(
            url=f"{frontend_url}/channels?cafe24_error=not_configured"
        )

    try:
        # 인가 코드를 토큰으로 교환
        token_data = await service.exchange_code_for_token(code)

        # 카페24 채널 조회 또는 생성
        channel = channel_service.get_channel_by_name("카페24")
        if not channel:
            channel = channel_service.create_channel({
                "name": "카페24",
                "category": "오픈마켓",
                "integration_type": "api",
            })
        channel_id = channel["id"]

        # 토큰을 Channel.config에 저장
        service._save_token_to_channel(channel_id, token_data)

        frontend_url = _get_frontend_url()
        return RedirectResponse(
            url=f"{frontend_url}/channels?cafe24_connected=true"
        )

    except Exception as e:
        frontend_url = _get_frontend_url()
        return RedirectResponse(
            url=f"{frontend_url}/channels?cafe24_error={str(e)[:100]}"
        )


@router.post("/sync")
async def sync_sales(
    data: SyncRequest,
    _: dict = Depends(get_current_user),
    channel_service: ChannelService = Depends(get_channel_service),
):
    """카페24 매출 데이터 동기화"""
    service = get_cafe24_service()

    if not service.is_configured():
        raise HTTPException(status_code=400, detail="API 인증 정보가 설정되지 않았습니다")

    # 채널 ID 조회 또는 생성
    channel_id = data.channel_id
    channel_name = "카페24"

    if not channel_id:
        channel = channel_service.get_channel_by_name(channel_name)
        if channel:
            channel_id = channel["id"]
        else:
            channel = channel_service.create_channel({
                "name": channel_name,
                "category": "오픈마켓",
                "integration_type": "api",
            })
            channel_id = channel["id"]

    if not service.has_token(channel_id):
        raise HTTPException(status_code=400, detail="OAuth 인증이 필요합니다. 먼저 카페24 연동을 진행해주세요.")

    # 동기화 로그 생성
    sync_log = channel_service.create_sync_log(channel_id, channel_name, "api")

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
            raise HTTPException(
                status_code=400,
                detail="start_date/end_date 또는 year/month를 지정해주세요",
            )

    try:
        # 날짜 범위로 매출 데이터 조회
        monthly_data = await service.get_daily_sales_by_range(
            channel_id, start_date, end_date
        )

        # 채널 매출 데이터로 변환
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
                    "source": "cafe24_api",
                })

        # 데이터 저장
        result = channel_service.bulk_upsert_sales(sales_list, sync_log["id"])

        # 동기화 로그 업데이트
        channel_service.update_sync_log(sync_log["id"], {
            "status": "success" if not result["errors"] else "partial",
            "completed_at": datetime.utcnow(),
            "records_processed": total_days,
            "records_created": result["created"],
            "error_message": str(result["errors"][:3]) if result["errors"] else None,
        })

        return {
            "success": True,
            "message": f"{start_date} ~ {end_date} 매출 동기화 완료",
            "channel_id": channel_id,
            "period": f"{start_date} ~ {end_date}",
            "processed": total_days,
            "created": result["created"],
            "errors": len(result["errors"]),
        }

    except Exception as e:
        channel_service.update_sync_log(sync_log["id"], {
            "status": "failed",
            "completed_at": datetime.utcnow(),
            "error_message": str(e),
        })
        raise HTTPException(status_code=500, detail=f"동기화 실패: {str(e)}")


@router.get("/debug-raw")
async def debug_raw_orders(
    start_date: str = Query(default="2026-02-01"),
    end_date: str = Query(default="2026-02-01"),
    channel_service: ChannelService = Depends(get_channel_service),
):
    """카페24 API 원본 응답 확인 (디버그용)"""
    service = get_cafe24_service()

    if not service.is_configured():
        return {"error": "API 인증 정보가 설정되지 않았습니다"}

    channel = channel_service.get_channel_by_name("카페24")
    if not channel:
        return {"error": "카페24 채널이 없습니다"}

    channel_id = channel["id"]
    if not service.has_token(channel_id):
        return {"error": "OAuth 토큰이 없습니다"}

    try:
        import httpx
        access_token = await service._get_valid_access_token(channel_id)
        async with httpx.AsyncClient(timeout=15) as client:
            data = await service._request(
                client, access_token, "GET",
                "/api/v2/admin/orders",
                params={
                    "start_date": start_date,
                    "end_date": end_date,
                    "limit": 3,
                    "offset": 0,
                },
            )
        # 주문 1~3건의 원본 데이터 반환
        orders = data.get("orders", [])
        return {
            "total_orders": len(orders),
            "raw_orders": orders,
            "all_keys": list(orders[0].keys()) if orders else [],
        }
    except Exception as e:
        return {"error": str(e)}
