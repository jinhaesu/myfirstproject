"""쿠팡 로켓(Supplier Hub) RPA 연동 라우트"""
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel

from app.services.coupang_rocket_service import get_coupang_rocket_service, CoupangRocketService
from app.services.channel_service import ChannelService
from app.services.auth_service import AuthService

router = APIRouter(prefix="/coupang-rocket", tags=["coupang-rocket"])
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
    login_id: str
    login_password: str


@router.get("/status")
async def get_status(
    _: dict = Depends(get_current_user),
    channel_service: ChannelService = Depends(get_channel_service),
):
    """쿠팡 로켓 RPA 상태 확인"""
    service = get_coupang_rocket_service()

    # Playwright 설치 확인
    playwright_available = service.is_playwright_available()

    # DB에서 credential 로드
    channel = channel_service.get_channel_by_name("쿠팡 로켓")
    if channel and channel.get("config"):
        config = channel["config"]
        if config.get("login_id") and config.get("login_password"):
            service.update_config(config["login_id"], config["login_password"])

    if not playwright_available:
        return {
            "configured": service.is_configured(),
            "connected": False,
            "message": "Playwright가 설치되어 있지 않습니다. RPA 기능을 사용하려면 서버에 Playwright를 설치해주세요.",
            "playwright_installed": False,
        }

    if not service.is_configured():
        return {
            "configured": False,
            "connected": False,
            "message": "로그인 정보가 설정되지 않았습니다",
            "playwright_installed": True,
        }

    return {
        "configured": True,
        "connected": True,
        "message": "RPA 준비 완료 (로그인 정보 설정됨)",
        "playwright_installed": True,
    }


@router.post("/credentials")
async def save_credentials(
    data: CredentialsUpdate,
    _: dict = Depends(get_current_user),
    channel_service: ChannelService = Depends(get_channel_service),
):
    """쿠팡 로켓 로그인 정보 저장"""
    channel_name = "쿠팡 로켓"
    channel = channel_service.get_channel_by_name(channel_name)

    if not channel:
        channel = channel_service.create_channel({
            "name": channel_name,
            "category": "오픈마켓",
            "integration_type": "rpa",
        })

    # Channel.config에 저장
    channel_service.update_channel(channel["id"], {
        "config": {
            "login_id": data.login_id,
            "login_password": data.login_password,
        }
    })

    # 서비스 인스턴스 갱신
    service = get_coupang_rocket_service()
    service.update_config(data.login_id, data.login_password)

    # 로그인 테스트
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
    """쿠팡 로켓 매출 데이터 동기화 (RPA)"""
    service = get_coupang_rocket_service()

    # Playwright 확인
    if not service.is_playwright_available():
        raise HTTPException(status_code=400, detail="Playwright가 설치되어 있지 않습니다")

    # DB에서 credential 로드
    channel_name = "쿠팡 로켓"
    channel = channel_service.get_channel_by_name(channel_name)
    if channel and channel.get("config"):
        config = channel["config"]
        if config.get("login_id") and config.get("login_password"):
            service.update_config(config["login_id"], config["login_password"])

    if not service.is_configured():
        raise HTTPException(status_code=400, detail="로그인 정보가 설정되지 않았습니다")

    # 채널 ID 조회 또는 생성
    channel_id = data.channel_id
    if not channel_id:
        if channel:
            channel_id = channel["id"]
        else:
            channel = channel_service.create_channel({
                "name": channel_name,
                "category": "오픈마켓",
                "integration_type": "rpa",
            })
            channel_id = channel["id"]

    # 동기화 로그 생성
    sync_log = channel_service.create_sync_log(channel_id, channel_name, "rpa")

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
                    "source": "coupang_rocket_rpa",
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
            "message": f"{start_date} ~ {end_date} 매출 동기화 완료 (RPA)",
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
