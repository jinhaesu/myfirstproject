"""스마트스토어 API 연동 라우트"""
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel

from app.services.smartstore_service import get_smartstore_service, SmartStoreService
from app.services.channel_service import ChannelService
from app.services.auth_service import AuthService

router = APIRouter(prefix="/smartstore", tags=["smartstore"])
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
    year: Optional[int] = None        # 하위 호환
    month: Optional[int] = None       # 하위 호환
    channel_id: Optional[str] = None


class CredentialsUpdate(BaseModel):
    client_id: str
    client_secret: str


@router.get("/status")
async def get_status(_: dict = Depends(get_current_user)):
    """스마트스토어 API 연결 상태 확인"""
    service = get_smartstore_service()

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
        "token_expires_at": result.get("token_expires_at"),
    }


@router.post("/sync")
async def sync_sales(
    data: SyncRequest,
    _: dict = Depends(get_current_user),
    channel_service: ChannelService = Depends(get_channel_service),
):
    """스마트스토어 매출 데이터 동기화"""
    service = get_smartstore_service()

    if not service.is_configured():
        raise HTTPException(status_code=400, detail="API 인증 정보가 설정되지 않았습니다")

    # 채널 ID 조회 또는 생성
    channel_id = data.channel_id
    channel_name = "스마트스토어"

    if not channel_id:
        channel = channel_service.get_channel_by_name(channel_name)
        if channel:
            channel_id = channel["id"]
        else:
            # 채널 자동 생성
            channel = channel_service.create_channel({
                "name": channel_name,
                "category": "오픈마켓",
                "integration_type": "api",
            })
            channel_id = channel["id"]

    # 동기화 로그 생성
    sync_log = channel_service.create_sync_log(channel_id, channel_name, "api")

    # 날짜 범위 결정: start_date/end_date 우선, 없으면 year/month에서 계산
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
        # 날짜 범위로 매출 데이터 조회 (월별 그룹핑)
        monthly_data = await service.get_daily_sales_by_range(start_date, end_date)

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
                    "source": "smartstore_api",
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


@router.get("/orders")
async def get_orders(
    start_date: str,
    end_date: str,
    page: int = 1,
    size: int = 100,
    _: dict = Depends(get_current_user),
):
    """스마트스토어 주문 목록 조회"""
    service = get_smartstore_service()

    if not service.is_configured():
        raise HTTPException(status_code=400, detail="API 인증 정보가 설정되지 않았습니다")

    try:
        result = await service.get_product_orders(
            start_date=start_date,
            end_date=end_date,
            page_index=page,
            page_size=size,
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"주문 조회 실패: {str(e)}")


@router.get("/daily-sales")
async def get_daily_sales(
    start_date: str,
    end_date: str,
    _: dict = Depends(get_current_user),
):
    """스마트스토어 일별 매출 조회 (저장하지 않고 조회만)"""
    service = get_smartstore_service()

    if not service.is_configured():
        raise HTTPException(status_code=400, detail="API 인증 정보가 설정되지 않았습니다")

    try:
        monthly_data = await service.get_daily_sales_by_range(start_date, end_date)

        total_gross = 0
        total_net = 0
        total_orders = 0
        for days in monthly_data.values():
            for d in days:
                total_gross += d["gross_sales"]
                total_net += d["net_sales"]
                total_orders += d["order_count"]

        return {
            "start_date": start_date,
            "end_date": end_date,
            "monthly": monthly_data,
            "summary": {
                "total_gross_sales": total_gross,
                "total_net_sales": total_net,
                "total_orders": total_orders,
            }
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"매출 조회 실패: {str(e)}")


@router.get("/debug-raw")
async def debug_raw_response(
    year: int,
    month: int,
    day: int = 1,
):
    """API 원본 응답 확인 (디버그용 - 인증 불필요)"""
    import httpx

    service = get_smartstore_service()

    if not service.is_configured():
        return {"error": "API 인증 정보가 설정되지 않았습니다"}

    from_time = f"{year}-{month:02d}-{day:02d}T00:00:00.000+09:00"
    results = {}

    async with httpx.AsyncClient(timeout=15) as client:
        # 테스트 1: PAYED 상태 조회
        try:
            raw1 = await service._request(
                client,
                "GET",
                "/external/v1/pay-order/seller/product-orders",
                params={
                    "from": from_time,
                    "rangeType": "PAYED_DATETIME",
                    "productOrderStatuses": "PAYED",
                    "pageSize": 5,
                    "page": 1,
                }
            )
            results["test1_payed"] = raw1
        except Exception as e:
            results["test1_payed_error"] = str(e)

        # 테스트 2: 상태 필터 없이 조회
        try:
            raw2 = await service._request(
                client,
                "GET",
                "/external/v1/pay-order/seller/product-orders",
                params={
                    "from": from_time,
                    "rangeType": "PAYED_DATETIME",
                    "pageSize": 5,
                    "page": 1,
                }
            )
            results["test2_no_status"] = raw2
        except Exception as e:
            results["test2_no_status_error"] = str(e)

    return {
        "query_date": f"{year}-{month:02d}-{day:02d}",
        "from_time": from_time,
        "results": results,
    }
