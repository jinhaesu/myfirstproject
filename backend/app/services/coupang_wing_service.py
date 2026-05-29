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
        # 중요: httpx가 보내는 query string과 동일한 형식으로 서명해야 함
        params = kwargs.get("params", {})
        if params:
            # httpx는 quote(safe=...) 방식으로 인코딩 — urllib과 동일하게 맞춤
            query = urllib.parse.urlencode(params, quote_via=urllib.parse.quote)
        else:
            query = ""
        authorization = self._generate_authorization(method, path, query, datetime_str)

        headers = kwargs.pop("headers", {})
        headers["Authorization"] = authorization
        headers["Content-Type"] = "application/json;charset=UTF-8"
        headers["X-EXTENDED-TIMEOUT"] = "90000"
        headers["X-Requested-By"] = self.config.access_key

        url = f"{self.config.base_url}{path}"
        if params:
            # query string을 직접 URL에 붙여서 서명과 100% 일치시킴
            url = f"{url}?{query}"
            kwargs.pop("params", None)

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

        result = response.json()
        logger.debug(f"API 응답: {method} {path} -> keys={list(result.keys()) if isinstance(result, dict) else type(result)}")
        return result

    async def _fetch_ordersheets(
        self,
        client: httpx.AsyncClient,
        created_from: str,
        created_to: str,
        status: Optional[str] = "INSTRUCT",
    ) -> list[dict]:
        """주문서 조회 (페이지네이션 포함)

        Args:
            created_from: 시작일 (YYYY-MM-DD, e.g. "2026-02-01")
            created_to: 종료일 (YYYY-MM-DD, e.g. "2026-02-28")
            status: 주문 상태 필터 (필수: ACCEPT, INSTRUCT, DEPARTURE, DELIVERING, FINAL_DELIVERY)
        """
        path = f"/v2/providers/openapi/apis/api/v4/vendors/{self.config.vendor_id}/ordersheets"
        all_orders = []
        next_token = ""
        max_pages = 20  # 무한루프 방지

        for page in range(max_pages):
            params = {
                "createdAtFrom": created_from,
                "createdAtTo": created_to,
                "status": status,
                "maxPerPage": 50,
            }
            if next_token:
                params["nextToken"] = next_token

            data = await self._request(client, "GET", path, params=params)

            # 응답 구조 파싱
            raw_data = data.get("data", [])
            orders = []
            new_token = ""

            if isinstance(raw_data, list):
                orders = raw_data
                new_token = data.get("nextToken", "")
            elif isinstance(raw_data, dict):
                orders = raw_data.get("content", raw_data.get("orderSheets", []))
                if not isinstance(orders, list):
                    orders = []
                new_token = raw_data.get("nextToken", "") or data.get("nextToken", "")
            else:
                new_token = data.get("nextToken", "")

            if orders:
                all_orders.extend(orders)
                logger.info(f"주문 조회 ({status}, {created_from}~{created_to}): page {page+1}, {len(orders)}건")

            # 다음 페이지 토큰 갱신 (매 반복마다 새로 설정)
            next_token = new_token
            if not next_token or not orders:
                break

        return all_orders

    async def _fetch_orders_for_period(
        self,
        start_date: str,
        end_date: str,
    ) -> list[dict]:
        """기간별 주문 조회 — 순차 호출, 빠른 타임아웃

        Args:
            start_date: 시작일 (YYYY-MM-DD)
            end_date: 종료일 (YYYY-MM-DD)
        """
        start_dt = datetime.strptime(start_date, "%Y-%m-%d")
        end_dt = datetime.strptime(end_date, "%Y-%m-%d")

        today = datetime.now()
        if end_dt > today:
            end_dt = today

        actual_start = start_dt.strftime("%Y-%m-%d")
        actual_end = end_dt.strftime("%Y-%m-%d")

        # 31일 초과면 청크로 분할
        chunks = []
        chunk_start = start_dt
        while chunk_start <= end_dt:
            chunk_end = min(chunk_start + timedelta(days=30), end_dt)
            chunks.append((chunk_start.strftime("%Y-%m-%d"), chunk_end.strftime("%Y-%m-%d")))
            chunk_start = chunk_end + timedelta(days=1)

        if not chunks:
            return []

        all_orders = []
        all_statuses = ["INSTRUCT", "DEPARTURE", "DELIVERING", "FINAL_DELIVERY"]

        async with httpx.AsyncClient(timeout=15) as client:
            for chunk_from, chunk_to in chunks:
                # 순차 호출 (안정성 우선)
                for status in all_statuses:
                    try:
                        orders = await self._fetch_ordersheets(
                            client, chunk_from, chunk_to, status=status,
                        )
                        if orders:
                            logger.info(f"주문: {status} ({chunk_from}~{chunk_to}) -> {len(orders)}건")
                            all_orders.extend(orders)
                    except Exception as e:
                        logger.warning(f"주문 조회 실패: {status} ({chunk_from}~{chunk_to}): {e}")

        logger.info(f"전체 주문 조회 완료: {len(all_orders)}건 ({actual_start}~{actual_end})")
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
                # salesPrice: 판매가, orderPrice: 주문가, discountPrice: 할인
                sales_price = item.get("salesPrice", 0) or 0
                order_price = item.get("orderPrice", 0) or 0
                discount = item.get("discountPrice", 0) or 0
                qty = item.get("shippingCount", 1) or 1

                entry["gross_sales"] += sales_price * qty
                entry["net_sales"] += (order_price - discount) * qty
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
                    "createdAtFrom": today,
                    "createdAtTo": today,
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
