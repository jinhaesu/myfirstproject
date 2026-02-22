"""스마트스토어 API 연동 서비스

네이버 커머스 API를 통해 스마트스토어 매출 데이터를 조회합니다.
API 문서: https://apicenter.commerce.naver.com/
"""
import os
import time
import bcrypt
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
        """bcrypt 전자서명 생성"""
        password = f"{self.config.client_id}_{timestamp}"
        hashed = bcrypt.hashpw(
            password.encode('utf-8'),
            self.config.client_secret.encode('utf-8'),
        )
        return base64.b64encode(hashed).decode('utf-8')

    async def _get_access_token(self) -> str:
        """OAuth 토큰 발급"""
        # 캐시된 토큰이 유효하면 재사용
        if self._token and self._token_expires_at:
            if datetime.now() < self._token_expires_at - timedelta(minutes=5):
                return self._token

        timestamp = str(int((time.time() - 3) * 1000))
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

    async def _fetch_orders_for_period(
        self,
        start_date: str,
        end_date: str,
    ) -> list[dict]:
        """기간별 주문 목록 조회 (최대 24시간 단위로 분할 요청)

        Args:
            start_date: 시작일 (YYYY-MM-DD)
            end_date: 종료일 (YYYY-MM-DD)
        """
        start_dt = datetime.strptime(start_date, "%Y-%m-%d")
        end_dt = datetime.strptime(end_date, "%Y-%m-%d")

        all_product_order_ids = []

        # 하루 단위로 분할 조회 (API 제한: 최대 24시간)
        current = start_dt
        while current <= end_dt:
            from_time = current.strftime("%Y-%m-%dT00:00:00.000+09:00")
            to_time = current.strftime("%Y-%m-%dT23:59:59.999+09:00")

            try:
                data = await self._request(
                    "GET",
                    "/external/v1/pay-order/seller/product-orders/last-changed-statuses",
                    params={
                        "lastChangedFrom": from_time,
                        "lastChangedTo": to_time,
                        "lastChangedType": "PAYED",
                    }
                )
                statuses = data.get("data", {}).get("lastChangeStatuses", [])
                for item in statuses:
                    pid = item.get("productOrderId")
                    if pid:
                        all_product_order_ids.append(pid)
            except httpx.HTTPStatusError as e:
                if e.response.status_code != 404:
                    raise
            current += timedelta(days=1)

        if not all_product_order_ids:
            return []

        # 상품 주문 상세 조회 (최대 300개씩)
        all_orders = []
        for i in range(0, len(all_product_order_ids), 300):
            batch = all_product_order_ids[i:i+300]
            try:
                detail = await self._request(
                    "POST",
                    "/external/v1/pay-order/seller/product-orders/query",
                    json={"productOrderIds": batch}
                )
                orders = detail.get("data", [])
                all_orders.extend(orders)
            except httpx.HTTPStatusError:
                pass

        return all_orders

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
        orders = await self._fetch_orders_for_period(start_date, end_date)

        # 일별 집계
        daily_sales = {}
        for order in orders:
            product_order = order.get("productOrder", {})
            paid_at = product_order.get("paymentDate", "")
            if paid_at:
                try:
                    paid_date = datetime.fromisoformat(paid_at.replace("+09:00", "+09:00").split("+")[0])
                    day = paid_date.day
                except (ValueError, IndexError):
                    continue

                if day not in daily_sales:
                    daily_sales[day] = {
                        "day": day,
                        "gross_sales": 0,
                        "net_sales": 0,
                        "order_count": 0,
                        "quantity": 0,
                        "commission": 0,
                    }

                daily_sales[day]["gross_sales"] += product_order.get("totalPaymentAmount", 0)
                daily_sales[day]["net_sales"] += product_order.get("expectedSettlementAmount", 0)
                daily_sales[day]["order_count"] += 1
                daily_sales[day]["quantity"] += product_order.get("quantity", 0)
                daily_sales[day]["commission"] += product_order.get("commissionAmount", 0)

        result = sorted(daily_sales.values(), key=lambda x: x["day"])
        return result

    async def get_product_orders(
        self,
        start_date: str,
        end_date: str,
    ) -> list[dict]:
        """상품 주문 목록 조회

        Args:
            start_date: 시작일 (YYYY-MM-DD)
            end_date: 종료일 (YYYY-MM-DD)
        """
        return await self._fetch_orders_for_period(start_date, end_date)

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
