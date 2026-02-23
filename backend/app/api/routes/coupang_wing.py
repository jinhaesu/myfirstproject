"""쿠팡 Wing API 연동 라우트"""
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel

from app.services.coupang_wing_service import get_coupang_wing_service, CoupangWingService
from app.services.channel_service import ChannelService
from app.services.auth_service import AuthService

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


@router.post("/sync")
async def sync_sales(
    data: SyncRequest,
    _: dict = Depends(get_current_user),
    channel_service: ChannelService = Depends(get_channel_service),
):
    """쿠팡 Wing 매출 데이터 동기화"""
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
            raise HTTPException(status_code=400, detail="start_date/end_date 또는 year/month를 지정해주세요")

    try:
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

        result = channel_service.bulk_upsert_sales(sales_list, sync_log["id"])

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
