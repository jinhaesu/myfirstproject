"""사방넷 API 연동 서비스

사방넷 API 인증 방식:
- api-access-key와 api-secret-key를 사용하여 HMAC-SHA256 signature 생성
- Authorization 헤더: LIVE-HMAC-SHA256 {signature}
- 실제 API URL과 키는 환경변수에서 가져옴

참고: 사방넷의 정확한 API 스펙은 https://www.sbfulfillment.co.kr/developers/ver2 참조
현재는 일반적인 사방넷 API 패턴을 기반으로 구현하되,
실제 연동 시 사방넷 개발가이드 확인 후 조정이 필요할 수 있음
"""
import hmac
import hashlib
import time
import logging
from typing import Optional

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)


class SabangnetAPI:
    """사방넷 API 클라이언트"""

    def __init__(self):
        settings = get_settings()
        self.api_key = settings.SABANGNET_API_KEY
        self.api_url = settings.SABANGNET_API_URL
        self._available = bool(self.api_key and self.api_url)

    @property
    def is_available(self) -> bool:
        return self._available

    def _generate_signature(self, timestamp: str) -> str:
        """HMAC-SHA256 서명 생성"""
        message = f"{self.api_key}{timestamp}"
        signature = hmac.new(
            self.api_key.encode("utf-8"),
            message.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()
        return signature

    def _get_headers(self) -> dict:
        """인증 헤더 생성"""
        timestamp = str(int(time.time() * 1000))
        signature = self._generate_signature(timestamp)
        return {
            "Content-Type": "application/json",
            "Authorization": f"LIVE-HMAC-SHA256 {signature}",
            "x-api-key": self.api_key,
            "x-api-timestamp": timestamp,
        }

    async def _request(self, method: str, endpoint: str, data: dict = None) -> dict:
        """공통 API 요청"""
        if not self._available:
            raise ValueError("사방넷 API가 설정되지 않았습니다")

        url = f"{self.api_url.rstrip('/')}/{endpoint.lstrip('/')}"
        headers = self._get_headers()

        try:
            async with httpx.AsyncClient() as client:
                if method == "GET":
                    resp = await client.get(url, headers=headers, params=data, timeout=15.0)
                elif method == "POST":
                    resp = await client.post(url, headers=headers, json=data, timeout=15.0)
                elif method == "PUT":
                    resp = await client.put(url, headers=headers, json=data, timeout=15.0)
                else:
                    raise ValueError(f"Unsupported method: {method}")

                if resp.status_code == 200:
                    return resp.json()
                else:
                    logger.error(f"사방넷 API 오류: {resp.status_code} - {resp.text[:500]}")
                    return {
                        "error": True,
                        "status_code": resp.status_code,
                        "message": resp.text[:500],
                    }
        except httpx.TimeoutException:
            logger.error(f"사방넷 API 타임아웃: {url}")
            return {"error": True, "message": "API 요청 시간 초과"}
        except Exception as e:
            logger.error(f"사방넷 API 호출 실패: {e}")
            return {"error": True, "message": str(e)}

    # ── 상품 관련 ──

    async def get_products(self, page: int = 1, limit: int = 100) -> dict:
        """사방넷 등록 상품 목록 조회"""
        return await self._request("GET", "/api/v2/products", {
            "page": page,
            "limit": limit,
        })

    async def get_product(self, product_code: str) -> dict:
        """상품 상세 조회"""
        return await self._request("GET", f"/api/v2/products/{product_code}")

    async def create_product(self, product_data: dict) -> dict:
        """상품 등록"""
        return await self._request("POST", "/api/v2/products", product_data)

    async def update_product(self, product_code: str, product_data: dict) -> dict:
        """상품 수정"""
        return await self._request("PUT", f"/api/v2/products/{product_code}", product_data)

    # ── 주문 관련 ──

    async def get_orders(
        self,
        status: Optional[str] = None,
        date_from: Optional[str] = None,
        date_to: Optional[str] = None,
        page: int = 1,
    ) -> dict:
        """주문 목록 조회"""
        params: dict = {"page": page}
        if status:
            params["status"] = status
        if date_from:
            params["date_from"] = date_from
        if date_to:
            params["date_to"] = date_to
        return await self._request("GET", "/api/v2/orders", params)

    async def get_order_by_phone(self, phone_number: str) -> dict:
        """전화번호로 주문 조회 (음성 CS에서 사용)"""
        # 전화번호 포맷 정리 (하이픈/공백 제거)
        clean_phone = phone_number.replace("-", "").replace(" ", "")
        return await self._request("GET", "/api/v2/orders", {
            "buyer_phone": clean_phone,
            "sort": "order_date_desc",
            "limit": 5,
        })

    # ── 문의사항 관련 ──

    async def get_inquiries(self, status: Optional[str] = None, page: int = 1) -> dict:
        """문의사항 목록 조회 (게시판 CS)"""
        params: dict = {"page": page}
        if status:
            params["status"] = status
        return await self._request("GET", "/api/v2/inquiries", params)

    async def send_inquiry_response(self, inquiry_id: str, response_text: str) -> dict:
        """문의사항 답변 송신"""
        return await self._request(
            "POST",
            f"/api/v2/inquiries/{inquiry_id}/response",
            {"response": response_text},
        )

    # ── 매핑 관련 ──

    async def get_unmapped_products(self) -> dict:
        """매핑되지 않은 쇼핑몰 상품 조회"""
        return await self._request("GET", "/api/v2/products/unmapped")

    async def set_product_mapping(
        self, mall_product_code: str, sabangnet_product_code: str
    ) -> dict:
        """상품 매핑 설정"""
        return await self._request("POST", "/api/v2/products/mapping", {
            "mall_product_code": mall_product_code,
            "sabangnet_product_code": sabangnet_product_code,
        })


def get_sabangnet_api() -> SabangnetAPI:
    """SabangnetAPI 인스턴스 반환"""
    return SabangnetAPI()
