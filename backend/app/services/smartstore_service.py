"""스마트스토어 API 연동 서비스

네이버 커머스 API를 통해 스마트스토어 매출 데이터를 조회합니다.
API 문서: https://apicenter.commerce.naver.com/
"""
import os
import time
import hmac
import hashlib
import base64
import httpx
from datetime import datetime, timedelta
from typing import Optional
from dataclasses import dataclass


@dataclass
class SmartStoreConfig:
    """스마트스토어 API 설정"""
    client_id: str
    client_secret: str
    base_url: str = "https://api.commerce.naver.com"


class SmartStoreService:
    """스마트스토어 API 서비스"""

    def __init__(self, config: Optional[SmartStoreConfig] = None):
        if config:
            self.config = config
        else:
            # 환경변수에서 로드
            self.config = SmartStoreConfig(
                client_id=os.getenv("SMARTSTORE_CLIENT_ID", ""),
                client_secret=os.getenv("SMARTSTORE_CLIENT_SECRET", ""),
            )
        self._token: Optional[str] = None
        self._token_expires_at: Optional[datetime] = None

    def _generate_signature(self, timestamp: str) -> str:
        """HMAC 서명 생성"""
        message = f"{self.config.client_id}_{timestamp}"
        signature = hmac.new(
            self.config.client_secret.encode('utf-8'),
            message.encode('utf-8'),
            hashlib.sha256
        ).digest()
        return base64.b64encode(signature).decode('utf-8')

    async def _get_access_token(self) -> str:
        """OAuth 토큰 발급"""
        # 캐시된 토큰이 유효하면 재사용
        if self._token and self._token_expires_at:
            if datetime.now() < self._token_expires_at - timedelta(minutes=5):
                return self._token

        timestamp = str(int(time.time() * 1000))
        signature = self._generate_signature(timestamp)

        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.config.base_url}/external/v1/oauth2/token",
                headers={
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                data={
                    "client_id": self.config.client_id,
                    "timestamp": timestamp,
                    "client_secret_sign": signature,
                    "grant_type": "client_credentials",
                    "type": "SELF",
                },
            )
            response.raise_for_status()
            data = response.json()

            self._token = data["access_token"]
            # 토큰 만료 시간 설정 (기본 24시간)
            expires_in = data.get("expires_in", 86400)
            self._token_expires_at = datetime.now() + timedelta(seconds=expires_in)

            return self._token

    async def _request(self, method: str, endpoint: str, **kwargs) -> dict:
        """API 요청"""
        token = await self._get_access_token()

        headers = kwargs.pop("headers", {})
        headers["Authorization"] = f"Bearer {token}"
        headers["Content-Type"] = "application/json"

        async with httpx.AsyncClient() as client:
            response = await client.request(
                method,
                f"{self.config.base_url}{endpoint}",
                headers=headers,
                **kwargs
            )
            response.raise_for_status()
            return response.json()

    async def get_order_stats(
        self,
        start_date: str,
        end_date: str,
    ) -> dict:
        """주문 통계 조회

        Args:
            start_date: 시작일 (YYYY-MM-DD)
            end_date: 종료일 (YYYY-MM-DD)
        """
        # 날짜를 datetime으로 변환
        start_dt = datetime.strptime(start_date, "%Y-%m-%d")
        end_dt = datetime.strptime(end_date, "%Y-%m-%d")

        # 커머스 API는 ISO 포맷 필요
        data = await self._request(
            "POST",
            "/external/v1/pay-order/seller/orders/search",
            json={
                "searchTimeType": "PAYED",  # 결제일 기준
                "searchStartDate": start_dt.strftime("%Y-%m-%dT00:00:00.000+09:00"),
                "searchEndDate": end_dt.strftime("%Y-%m-%dT23:59:59.999+09:00"),
            }
        )
        return data

    async def get_daily_sales(
        self,
        year: int,
        month: int,
    ) -> list[dict]:
        """일별 매출 데이터 조회

        Args:
            year: 년도
            month: 월

        Returns:
            일별 매출 데이터 리스트
        """
        from calendar import monthrange

        days_in_month = monthrange(year, month)[1]
        start_date = f"{year}-{month:02d}-01"
        end_date = f"{year}-{month:02d}-{days_in_month:02d}"

        # 주문 목록 조회
        orders_data = await self.get_order_stats(start_date, end_date)

        # 일별 집계
        daily_sales = {}
        for order in orders_data.get("data", []):
            # 결제일 파싱
            paid_at = order.get("paidAt", "")
            if paid_at:
                paid_date = datetime.fromisoformat(paid_at.replace("+09:00", ""))
                day = paid_date.day

                if day not in daily_sales:
                    daily_sales[day] = {
                        "day": day,
                        "gross_sales": 0,
                        "net_sales": 0,
                        "order_count": 0,
                        "quantity": 0,
                        "commission": 0,
                    }

                # 금액 합산
                daily_sales[day]["gross_sales"] += order.get("totalPaymentAmount", 0)
                daily_sales[day]["net_sales"] += order.get("expectedSettlementAmount", 0)
                daily_sales[day]["order_count"] += 1
                daily_sales[day]["quantity"] += sum(
                    item.get("quantity", 0)
                    for item in order.get("productOrders", [])
                )
                daily_sales[day]["commission"] += order.get("commissionAmount", 0)

        # 리스트로 변환 및 정렬
        result = sorted(daily_sales.values(), key=lambda x: x["day"])
        return result

    async def get_product_orders(
        self,
        start_date: str,
        end_date: str,
        page_index: int = 1,
        page_size: int = 100,
    ) -> dict:
        """상품 주문 목록 조회

        Args:
            start_date: 시작일 (YYYY-MM-DD)
            end_date: 종료일 (YYYY-MM-DD)
            page_index: 페이지 번호
            page_size: 페이지 크기
        """
        start_dt = datetime.strptime(start_date, "%Y-%m-%d")
        end_dt = datetime.strptime(end_date, "%Y-%m-%d")

        return await self._request(
            "POST",
            "/external/v1/pay-order/seller/product-orders/search",
            json={
                "searchTimeType": "PAYED",
                "searchStartDate": start_dt.strftime("%Y-%m-%dT00:00:00.000+09:00"),
                "searchEndDate": end_dt.strftime("%Y-%m-%dT23:59:59.999+09:00"),
                "pageIndex": page_index,
                "pageSize": page_size,
            }
        )

    async def test_connection(self) -> dict:
        """API 연결 테스트"""
        try:
            token = await self._get_access_token()
            return {
                "success": True,
                "message": "스마트스토어 API 연결 성공",
                "token_expires_at": self._token_expires_at.isoformat() if self._token_expires_at else None,
            }
        except Exception as e:
            return {
                "success": False,
                "message": f"연결 실패: {str(e)}",
            }

    def is_configured(self) -> bool:
        """API 설정 여부 확인"""
        return bool(self.config.client_id and self.config.client_secret)


# 싱글톤 인스턴스
_smartstore_service: Optional[SmartStoreService] = None


def get_smartstore_service() -> SmartStoreService:
    """스마트스토어 서비스 인스턴스 반환"""
    global _smartstore_service
    if _smartstore_service is None:
        _smartstore_service = SmartStoreService()
    return _smartstore_service
