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
            # 요청 시 사용되는 IP 확인용
            try:
                ip_res = await client.get("https://api.ipify.org?format=json", timeout=5)
                outbound_ip = ip_res.json().get("ip", "unknown")
            except Exception:
                outbound_ip = "unknown"

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
            if response.status_code != 200:
                error_body = response.text
                raise Exception(
                    f"토큰 발급 실패 (status={response.status_code}, ip={outbound_ip}): {error_body}"
                )
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

        async with httpx.AsyncClient(timeout=30) as client:
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
        """조건형 상품 주문 조회 (하루 단위 분할)

        Args:
            start_date: 시작일 (YYYY-MM-DD)
            end_date: 종료일 (YYYY-MM-DD)
        """
        start_dt = datetime.strptime(start_date, "%Y-%m-%d")
        end_dt = datetime.strptime(end_date, "%Y-%m-%d")

        # 오늘 이후 날짜는 조회하지 않음
        today = datetime.now()
        if end_dt > today:
            end_dt = today

        all_orders = []

        # 하루 단위로 분할 조회 (API 제한: 최대 24시간)
        current = start_dt
        while current <= end_dt:
            from_time = current.strftime("%Y-%m-%dT00:00:00.000+09:00")

            page = 1
            while True:
                data = await self._request(
                    "GET",
                    "/external/v1/pay-order/seller/product-orders",
                    params={
                        "from": from_time,
                        "rangeType": "PAYED_DATETIME",
                        "pageSize": 100,
                        "page": page,
                    }
                )
                orders = data.get("data", {}).get("contents", [])
                all_orders.extend(orders)

                # 다음 페이지가 있는지 확인
                has_next = data.get("data", {}).get("pagination", {}).get("hasNext", False)
                if not has_next or len(orders) < 100:
                    break
                page += 1

            current += timedelta(days=1)

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
        # 응답 구조: contents[].content.order.paymentDate, contents[].content.productOrder.*
        daily_sales = {}
        for item in orders:
            content = item.get("content", item)
            order_info = content.get("order", {})
            product_order = content.get("productOrder", {})

            # 취소된 주문 제외
            status = product_order.get("productOrderStatus", "")
            if status in ("CANCELED", "RETURNED"):
                continue

            paid_at = order_info.get("paymentDate", "")
            if not paid_at:
                continue

            try:
                date_str = paid_at.split("T")[0]
                paid_date = datetime.strptime(date_str, "%Y-%m-%d")
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
            commission = (
                product_order.get("paymentCommission", 0)
                + product_order.get("saleCommission", 0)
                + product_order.get("knowledgeShoppingSellingInterlockCommission", 0)
                + product_order.get("channelCommission", 0)
            )
            daily_sales[day]["commission"] += commission

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
