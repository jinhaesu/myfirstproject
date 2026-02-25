"""쿠팡 로켓(Supplier Hub) RPA 연동 라우트"""
import logging
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel

from app.services.coupang_rocket_service import get_coupang_rocket_service, CoupangRocketService
from app.services.channel_service import ChannelService
from app.services.auth_service import AuthService

logger = logging.getLogger(__name__)

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


def _load_credentials_from_db(
    service: CoupangRocketService,
    channel_service: ChannelService,
) -> Optional[dict]:
    """DB에서 쿠팡 로켓 credential을 로드하여 서비스에 적용

    Returns:
        채널 딕셔너리 (존재하는 경우) 또는 None
    """
    channel = channel_service.get_channel_by_name("쿠팡 로켓")
    if channel and channel.get("config"):
        config = channel["config"]
        if config.get("login_id") and config.get("login_password"):
            service.update_config(config["login_id"], config["login_password"])
    return channel


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
    _load_credentials_from_db(service, channel_service)

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

    response = {
        "success": result["success"],
        "message": result["message"],
        "channel_id": channel["id"],
    }

    # 실패 시 상세 정보 포함
    if not result["success"] and "details" in result:
        response["debug_info"] = {
            "error_type": result["details"].get("error_type", "unknown"),
            "screenshot_path": result["details"].get("screenshot_path", ""),
            "page_url": result["details"].get("url", ""),
            "page_title": result["details"].get("title", ""),
        }
        logger.warning(
            f"쿠팡 로켓 로그인 실패: error_type={result['details'].get('error_type')}, "
            f"url={result['details'].get('url')}"
        )

    return response


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
        raise HTTPException(
            status_code=400,
            detail="Playwright가 설치되어 있지 않습니다. pip install playwright && playwright install chromium",
        )

    # DB에서 credential 로드
    channel_name = "쿠팡 로켓"
    channel = _load_credentials_from_db(service, channel_service)

    if not service.is_configured():
        raise HTTPException(
            status_code=400,
            detail="로그인 정보가 설정되지 않았습니다. /coupang-rocket/credentials 엔드포인트로 먼저 설정해주세요.",
        )

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
            raise HTTPException(
                status_code=400,
                detail="start_date/end_date 또는 year/month를 지정해주세요. "
                       "예: {\"start_date\": \"2025-01-01\", \"end_date\": \"2025-01-31\"} "
                       "또는 {\"year\": 2025, \"month\": 1}",
            )

    try:
        logger.info(f"쿠팡 로켓 매출 동기화 시작: {start_date} ~ {end_date}")
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

        logger.info(
            f"쿠팡 로켓 매출 동기화 완료: {start_date} ~ {end_date}, "
            f"{total_days}일, {result['created']}건 생성"
        )

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
        error_msg = str(e)
        logger.error(f"쿠팡 로켓 매출 동기화 실패: {error_msg}")

        channel_service.update_sync_log(sync_log["id"], {
            "status": "failed",
            "completed_at": datetime.utcnow(),
            "error_message": error_msg,
        })
        raise HTTPException(
            status_code=500,
            detail=f"동기화 실패: {error_msg}. "
                   f"기간: {start_date} ~ {end_date}. "
                   f"로그인 정보를 확인하거나 /coupang-rocket/debug 엔드포인트로 진단해주세요.",
        )


@router.post("/debug")
async def debug_connection(
    _: dict = Depends(get_current_user),
    channel_service: ChannelService = Depends(get_channel_service),
):
    """쿠팡 로켓 RPA 디버그 (로그인 테스트 + 페이지 정보 반환)

    RPA가 실패할 때 진단용으로 사용합니다.
    로그인 시도 후 현재 페이지의 URL, 타이틀, 스크린샷 경로를 반환합니다.
    """
    service = get_coupang_rocket_service()

    # Playwright 확인
    if not service.is_playwright_available():
        return {
            "success": False,
            "message": "Playwright가 설치되어 있지 않습니다",
            "playwright_installed": False,
            "page_info": None,
            "login_result": None,
        }

    # DB에서 credential 로드
    _load_credentials_from_db(service, channel_service)

    if not service.is_configured():
        return {
            "success": False,
            "message": "로그인 정보가 설정되지 않았습니다",
            "playwright_installed": True,
            "page_info": None,
            "login_result": None,
        }

    try:
        from playwright.async_api import async_playwright

        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            context = await browser.new_context(
                viewport={"width": 1920, "height": 1080},
                locale="ko-KR",
            )
            page = await context.new_page()

            try:
                # 로그인 시도
                logged_in = await service._login(page)

                # 현재 페이지 정보 수집
                page_info = await service.get_page_info(page)

                login_result = {
                    "success": logged_in,
                    "message": "로그인 성공" if logged_in else "로그인 실패",
                }

                return {
                    "success": logged_in,
                    "message": "디버그 완료 - 로그인 " + ("성공" if logged_in else "실패"),
                    "playwright_installed": True,
                    "page_info": {
                        "url": page_info.get("url", ""),
                        "title": page_info.get("title", ""),
                        "screenshot_path": page_info.get("screenshot_path", ""),
                        "body_text_preview": page_info.get("body_text_preview", ""),
                    },
                    "login_result": login_result,
                }
            finally:
                await browser.close()

    except Exception as e:
        logger.error(f"쿠팡 로켓 디버그 실패: {e}")
        return {
            "success": False,
            "message": f"디버그 중 오류 발생: {str(e)}",
            "playwright_installed": True,
            "page_info": None,
            "login_result": None,
            "error": str(e),
        }
