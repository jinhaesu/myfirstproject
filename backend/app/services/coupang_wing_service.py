"""쿠팡 Wing(오픈마켓) API 연동 서비스

Coupang Open API를 통해 쿠팡 Wing 매출 데이터를 조회합니다.
인증: HMAC-SHA256 서명 (매 요청마다 서명 생성, 토큰 캐싱 없음)
API 문서: https://developers.coupangcorp.com/
"""
import os
import hmac
import hashlib
import uuid
import asyncio
import logging
import urllib.parse
import httpx
from datetime import datetime, timedelta, timezone
from typing import Optional
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass
class CoupangWingConfig:
    """쿠팡 Wing API 설정"""
    vendor_id: str      # 업체코드
    access_key: str     # HMAC access key
    secret_key: str     # HMAC secret key
    base_url: str = "https://api-gateway.coupang.com"


class CoupangWingService:
    """쿠팡 Wing API 서비스"""

    def __init__(self, config: Optional[CoupangWingConfig] = None):
        if config:
            self.config = config
        else:
            self.config = CoupangWingConfig(
                vendor_id=os.getenv("COUPANG_WING_VENDOR_ID", ""),
                access_key=os.getenv("COUPANG_WING_ACCESS_KEY", ""),
                secret_key=os.getenv("COUPANG_WING_SECRET_KEY", ""),
            )

    def update_config(self, vendor_id: str, access_key: str, secret_key: str):
        """인증 정보 동적 업데이트"""
        self.config = CoupangWingConfig(
            vendor_id=vendor_id,
            access_key=access_key,
            secret_key=secret_key,
        )

    def _generate_authorization(self, method: str, path: str, query: str, datetime_str: str) -> str:
        """HMAC-SHA256 Authorization 헤더 생성

        쿠팡 Open API 인증 규격:
        message = datetime + method + path + query (구분자 없이 직접 연결)
        signature = HMAC-SHA256(secret_key, message)
        """
        message = datetime_str + method.upper() + path + query
        signature = hmac.new(
            self.config.secret_key.encode("utf-8"),
            message.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()

        return (
            f"CEA algorithm=HmacSHA256, "
            f"access-key={self.config.access_key}, "
            f"signed-date={datetime_str}, "
            f"signature={signature}"
        )

    async def _request(
        self,
        client: httpx.AsyncClient,
        method: str,
        path: str,
        **kwargs,
    ) -> dict:
        """API 요청 (HMAC 서명 포함)"""
        # UTC 기준 datetime (yyMMddTHHmmssZ 형식)
        datetime_str = datetime.now(timezone.utc).strftime('%y%m%dT%H%M%SZ')

        # GET 요청이면 query string을 서명에 포함
        params = kwargs.get("params", {})
        query = urllib.parse.urlencode(params) if params else ""
        authorization = self._generate_authorization(method, path, query, datetime_str)

        headers = kwargs.pop("headers", {})
        headers["Authorization"] = authorization
        headers["Content-Type"] = "application/json;charset=UTF-8"
        headers["X-EXTENDED-TIMEOUT"] = "90000"

        url = f"{self.config.base_url}{path}"
        try:
            response = await client.request(method, url, headers=headers, **kwargs)
        except httpx.TimeoutException as e:
            logger.error(f"API 요청 타임아웃: {method} {path} - {str(e)}")
            raise RuntimeError(f"API 요청 타임아웃: {method} {path}") from e

        if response.status_code != 200:
            body_preview = response.text[:500] if response.text else "(빈 응답)"
            logger.error(
                f"API 오류 응답: {method} {path} -> "
                f"status={response.status_code}, body={body_preview}"
            )
            raise RuntimeError(
                f"API 오류: status={response.status_code}, body={body_preview}"
            )

        return response.json()

    async def _fetch_ordersheets(
        self,
        client: httpx.AsyncClient,
        created_from: str,
        created_to: str,
        status: Optional[str] = None,
    ) -> list[dict]:
        """주문서 조회 (페이지네이션 포함, 다중 상태 지원)

        Args:
            created_from: 시작일시 (ISO 8601, e.g. "2026-02-01T00:00:00")
            created_to: 종료일시 (ISO 8601, e.g. "2026-02-28T23:59:59")
            status: 주문 상태 필터 (None이면 모든 상태 조회)
                    지원 상태: ACCEPT, INSTRUCT, DEPARTURE, DELIVERING, FINAL_DELIVERY
        """
        # status가 None이면 모든 상태를 병렬로 조회
        if status is None:
            all_statuses = ["ACCEPT", "INSTRUCT", "DEPARTURE", "DELIVERING", "FINAL_DELIVERY"]
            tasks = [
                self._fetch_ordersheets(client, created_from, created_to, status=s)
                for s in all_statuses
            ]
            results = await asyncio.gather(*tasks, return_exceptions=True)
            all_orders = []
            for i, r in enumerate(results):
                if isinstance(r, Exception):
                    logger.warning(
                        f"주문 상태 '{all_statuses[i]}' 조회 실패 "
                        f"({created_from}~{created_to}): {str(r)}"
                    )
                    continue
                all_orders.extend(r)
            return all_orders

        path = f"/v2/providers/openapi/apis/api/v4/vendors/{self.config.vendor_id}/ordersheets"
        all_orders = []
        next_token = ""

        while True:
            params = {
                "createdAtFrom": created_from,
                "createdAtTo": created_to,
                "status": status,
                "maxPerPage": 50,
            }
            if next_token:
                params["nextToken"] = next_token

            data = await self._request(client, "GET", path, params=params)

            orders = data.get("data", [])
            if isinstance(orders, list):
                all_orders.extend(orders)

            next_token = data.get("nextToken", "")
            if not next_token or not orders:
                break

        return all_orders

    async def _fetch_orders_for_period(
        self,
        start_date: str,
        end_date: str,
    ) -> list[dict]:
        """기간별 주문 조회 (일 단위 분할, 병렬 처리)

        Args:
            start_date: 시작일 (YYYY-MM-DD)
            end_date: 종료일 (YYYY-MM-DD)
        """
        start_dt = datetime.strptime(start_date, "%Y-%m-%d")
        end_dt = datetime.strptime(end_date, "%Y-%m-%d")

        today = datetime.now()
        if end_dt > today:
            end_dt = today

        dates = []
        current = start_dt
        while current <= end_dt:
            dates.append(current.strftime("%Y-%m-%d"))
            current += timedelta(days=1)

        if not dates:
            return []

        all_orders = []

        async with httpx.AsyncClient(timeout=30) as client:
            # 3일씩 병렬 호출 (API rate limit 고려)
            for i in range(0, len(dates), 3):
                batch = dates[i:i + 3]
                tasks = []
                for d in batch:
                    from_dt = f"{d}T00:00:00"
                    to_dt = f"{d}T23:59:59"
                    tasks.append(self._fetch_ordersheets(client, from_dt, to_dt))

                results = await asyncio.gather(*tasks, return_exceptions=True)
                for idx, r in enumerate(results):
                    if isinstance(r, Exception):
                        failed_date = batch[idx] if idx < len(batch) else "unknown"
                        logger.error(
                            f"주문 조회 실패 (날짜: {failed_date}): {str(r)}"
                        )
                        continue
                    all_orders.extend(r)

                # rate limit 방지를 위한 딜레이
                if i + 3 < len(dates):
                    await asyncio.sleep(0.5)

        return all_orders

    async def get_daily_sales_by_range(
        self,
        start_date: str,
        end_date: str,
    ) -> dict[str, list[dict]]:
        """날짜 범위 기반 일별 매출 데이터 조회

        Args:
            start_date: 시작일 (YYYY-MM-DD)
            end_date: 종료일 (YYYY-MM-DD)

        Returns:
            월별로 그룹핑된 일별 매출 데이터 {"2026-01": [...], "2026-02": [...]}
        """
        orders = await self._fetch_orders_for_period(start_date, end_date)

        # orderId 기준 중복 제거 (다중 상태 조회 시 동일 주문 중복 방지)
        seen_order_ids: set = set()
        unique_orders = []
        for order in orders:
            order_id = order.get("orderId")
            if order_id and order_id in seen_order_ids:
                continue
            if order_id:
                seen_order_ids.add(order_id)
            unique_orders.append(order)

        logger.info(
            f"주문 조회 완료: 전체 {len(orders)}건, 중복 제거 후 {len(unique_orders)}건 "
            f"({start_date} ~ {end_date})"
        )
        orders = unique_orders

        monthly_sales: dict[str, dict[int, dict]] = {}

        for order in orders:
            # 결제일 파싱
            paid_at = order.get("paidAt", "") or order.get("orderedAt", "")
            if not paid_at:
                continue

            try:
                date_str = paid_at.split("T")[0]
                paid_date = datetime.strptime(date_str, "%Y-%m-%d")
                year_month = f"{paid_date.year}-{paid_date.month:02d}"
                day = paid_date.day
            except (ValueError, IndexError):
                continue

            if year_month not in monthly_sales:
                monthly_sales[year_month] = {}

            if day not in monthly_sales[year_month]:
                monthly_sales[year_month][day] = {
                    "year": paid_date.year,
                    "month": paid_date.month,
                    "day": day,
                    "gross_sales": 0,
                    "net_sales": 0,
                    "order_count": 0,
                    "quantity": 0,
                    "commission": 0,
                }

            entry = monthly_sales[year_month][day]
            entry["order_count"] += 1

            # 주문 아이템별 금액 집계
            order_items = order.get("orderItems", [])
            for item in order_items:
                price = item.get("vendorItemPrice", 0) or 0
                qty = item.get("quantity", 1) or 1
                shipping = item.get("shippingPrice", 0) or 0

                entry["gross_sales"] += price * qty
                entry["net_sales"] += price * qty  # 정산금 별도 계산 어려움
                entry["quantity"] += qty

        # 정렬하여 반환
        result = {}
        for ym, days in monthly_sales.items():
            result[ym] = sorted(days.values(), key=lambda x: x["day"])

        return result

    async def test_connection(self) -> dict:
        """API 연결 테스트 (상세 오류 정보 포함)"""
        try:
            path = f"/v2/providers/openapi/apis/api/v4/vendors/{self.config.vendor_id}/ordersheets"
            async with httpx.AsyncClient(timeout=10) as client:
                # 오늘 날짜로 1건만 조회 테스트
                today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

                # 직접 HTTP 요청으로 상세 응답 확인
                datetime_str = datetime.now(timezone.utc).strftime('%y%m%dT%H%M%SZ')
                params = {
                    "createdAtFrom": f"{today}T00:00:00",
                    "createdAtTo": f"{today}T23:59:59",
                    "status": "INSTRUCT",
                    "maxPerPage": 1,
                }
                query = urllib.parse.urlencode(params)
                authorization = self._generate_authorization("GET", path, query, datetime_str)

                headers = {
                    "Authorization": authorization,
                    "Content-Type": "application/json;charset=UTF-8",
                    "X-EXTENDED-TIMEOUT": "90000",
                }
                url = f"{self.config.base_url}{path}"
                response = await client.request("GET", url, headers=headers, params=params)

                if response.status_code == 200:
                    return {
                        "success": True,
                        "message": "쿠팡 Wing API 연결 성공",
                        "status_code": 200,
                    }
                else:
                    body_preview = response.text[:300] if response.text else "(빈 응답)"
                    return {
                        "success": False,
                        "message": f"연결 실패: HTTP {response.status_code}",
                        "status_code": response.status_code,
                        "response_body": body_preview,
                    }

        except httpx.TimeoutException:
            return {
                "success": False,
                "message": "연결 실패: 요청 타임아웃 (10초 초과)",
                "status_code": None,
            }
        except Exception as e:
            return {
                "success": False,
                "message": f"연결 실패: {str(e)}",
                "status_code": None,
            }

    def is_configured(self) -> bool:
        """API 설정 여부 확인"""
        return bool(
            self.config.vendor_id
            and self.config.access_key
            and self.config.secret_key
        )


# 싱글톤 인스턴스
_coupang_wing_service: Optional[CoupangWingService] = None


def get_coupang_wing_service() -> CoupangWingService:
    """쿠팡 Wing 서비스 인스턴스 반환"""
    global _coupang_wing_service
    if _coupang_wing_service is None:
        _coupang_wing_service = CoupangWingService()
    return _coupang_wing_service
