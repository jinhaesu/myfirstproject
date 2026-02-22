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
    year: int
    month: int
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

    try:
        # 매출 데이터 조회
        daily_sales = await service.get_daily_sales(data.year, data.month)

        # 채널 매출 데이터로 변환
        sales_list = []
        for day_data in daily_sales:
            sales_list.append({
                "channel_id": channel_id,
                "channel_name": channel_name,
                "year": data.year,
                "month": data.month,
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
            "records_processed": len(daily_sales),
            "records_created": result["created"],
            "error_message": str(result["errors"][:3]) if result["errors"] else None,
        })

        # raw 주문 수도 확인
        raw_orders = await service._fetch_orders_for_period(
            f"{data.year}-{data.month:02d}-01",
            f"{data.year}-{data.month:02d}-{__import__('calendar').monthrange(data.year, data.month)[1]:02d}"
        )

        return {
            "success": True,
            "message": f"{data.year}년 {data.month}월 매출 데이터 동기화 완료",
            "channel_id": channel_id,
            "processed": len(daily_sales),
            "created": result["created"],
            "errors": len(result["errors"]),
            "debug": {
                "raw_orders_count": len(raw_orders),
                "daily_sales_count": len(daily_sales),
                "sample_raw_order": raw_orders[0] if raw_orders else None,
            }
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
    year: int,
    month: int,
    _: dict = Depends(get_current_user),
):
    """스마트스토어 일별 매출 조회 (저장하지 않고 조회만)"""
    service = get_smartstore_service()

    if not service.is_configured():
        raise HTTPException(status_code=400, detail="API 인증 정보가 설정되지 않았습니다")

    try:
        daily_sales = await service.get_daily_sales(year, month)
        total_gross = sum(d["gross_sales"] for d in daily_sales)
        total_net = sum(d["net_sales"] for d in daily_sales)
        total_orders = sum(d["order_count"] for d in daily_sales)

        return {
            "year": year,
            "month": month,
            "daily": daily_sales,
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
    service = get_smartstore_service()

    if not service.is_configured():
        return {"error": "API 인증 정보가 설정되지 않았습니다"}

    from_time = f"{year}-{month:02d}-{day:02d}T00:00:00.000+09:00"
    results = {}

    # 테스트 1: PAYED 상태 조회
    try:
        raw1 = await service._request(
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

    # 테스트 3: rangeType 없이 조회
    try:
        raw3 = await service._request(
            "GET",
            "/external/v1/pay-order/seller/product-orders",
            params={
                "from": from_time,
                "pageSize": 5,
                "page": 1,
            }
        )
        results["test3_no_range_type"] = raw3
    except Exception as e:
        results["test3_no_range_type_error"] = str(e)

    return {
        "query_date": f"{year}-{month:02d}-{day:02d}",
        "from_time": from_time,
        "results": results,
    }
