"""카페24 API 연동 서비스

카페24 OAuth 2.0 Authorization Code Grant 방식으로 매출 데이터를 조회합니다.
API 문서: https://developers.cafe24.com/
"""
import os
import asyncio
import base64
import httpx
from datetime import datetime, timedelta
from typing import Optional
from dataclasses import dataclass

from app.database import SessionLocal
from app.db_models import Channel


@dataclass
class Cafe24Config:
    """카페24 API 설정"""
    client_id: str
    client_secret: str
    mall_id: str
    redirect_uri: str


class Cafe24Service:
    """카페24 API 서비스"""

    def __init__(self, config: Optional[Cafe24Config] = None):
        if config:
            self.config = config
        else:
            self.config = Cafe24Config(
                client_id=os.getenv("CAFE24_CLIENT_ID", ""),
                client_secret=os.getenv("CAFE24_CLIENT_SECRET", ""),
                mall_id=os.getenv("CAFE24_MALL_ID", ""),
                redirect_uri=os.getenv("CAFE24_REDIRECT_URI", ""),
            )

    @property
    def _base_url(self) -> str:
        return f"https://{self.config.mall_id}.cafe24api.com"

    @property
    def _auth_url(self) -> str:
        return f"https://{self.config.mall_id}.cafe24api.com/api/v2/oauth/authorize"

    @property
    def _token_url(self) -> str:
        return f"https://{self.config.mall_id}.cafe24api.com/api/v2/oauth/token"

    def _get_basic_auth(self) -> str:
        """Basic 인증 헤더 생성"""
        credentials = f"{self.config.client_id}:{self.config.client_secret}"
        return base64.b64encode(credentials.encode()).decode()

    def get_authorize_url(self, state: str) -> str:
        """OAuth 인가 URL 생성"""
        params = (
            f"response_type=code"
            f"&client_id={self.config.client_id}"
            f"&state={state}"
            f"&redirect_uri={self.config.redirect_uri}"
            f"&scope=mall.read_order"
        )
        return f"{self._auth_url}?{params}"

    async def exchange_code_for_token(self, code: str) -> dict:
        """인가 코드를 토큰으로 교환"""
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.post(
                self._token_url,
                headers={
                    "Authorization": f"Basic {self._get_basic_auth()}",
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                data={
                    "grant_type": "authorization_code",
                    "code": code,
                    "redirect_uri": self.config.redirect_uri,
                },
            )
            if response.status_code != 200:
                raise Exception(
                    f"토큰 교환 실패 (status={response.status_code}): {response.text}"
                )
            return response.json()

    async def _refresh_access_token(self, refresh_token: str) -> dict:
        """리프레시 토큰으로 액세스 토큰 갱신"""
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.post(
                self._token_url,
                headers={
                    "Authorization": f"Basic {self._get_basic_auth()}",
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                data={
                    "grant_type": "refresh_token",
                    "refresh_token": refresh_token,
                },
            )
            if response.status_code != 200:
                raise Exception(
                    f"토큰 갱신 실패 (status={response.status_code}): {response.text}"
                )
            return response.json()

    def _save_token_to_channel(self, channel_id: str, token_data: dict):
        """토큰 정보를 Channel.config에 저장"""
        db = SessionLocal()
        try:
            channel = db.query(Channel).filter(Channel.id == channel_id).first()
            if not channel:
                raise Exception(f"채널을 찾을 수 없습니다: {channel_id}")

            now = datetime.utcnow()
            expires_in = token_data.get("expires_in", 7200)  # 기본 2시간
            refresh_expires_in = token_data.get("refresh_token_expires_in", 1209600)  # 기본 2주

            config = dict(channel.config) if channel.config else {}
            config.update({
                "mall_id": self.config.mall_id,
                "access_token": token_data["access_token"],
                "refresh_token": token_data["refresh_token"],
                "token_expires_at": (now + timedelta(seconds=expires_in)).isoformat(),
                "refresh_token_expires_at": (now + timedelta(seconds=refresh_expires_in)).isoformat(),
            })
            channel.config = config
            db.commit()
        finally:
            db.close()

    def _load_token_from_channel(self, channel_id: str) -> Optional[dict]:
        """Channel.config에서 토큰 정보 로드"""
        db = SessionLocal()
        try:
            channel = db.query(Channel).filter(Channel.id == channel_id).first()
            if not channel or not channel.config:
                return None
            config = channel.config
            if not config.get("access_token"):
                return None
            return config
        finally:
            db.close()

    async def _get_valid_access_token(self, channel_id: str) -> str:
        """유효한 액세스 토큰 반환 (만료 시 자동 갱신)"""
        config = self._load_token_from_channel(channel_id)
        if not config:
            raise Exception("카페24 토큰이 없습니다. OAuth 인증을 먼저 진행해주세요.")

        now = datetime.utcnow()
        token_expires_at = datetime.fromisoformat(config["token_expires_at"])

        # 액세스 토큰이 아직 유효 (5분 여유)
        if now < token_expires_at - timedelta(minutes=5):
            return config["access_token"]

        # 리프레시 토큰 만료 확인
        refresh_expires_at = datetime.fromisoformat(config["refresh_token_expires_at"])
        if now >= refresh_expires_at:
            raise Exception("리프레시 토큰이 만료되었습니다. OAuth 인증을 다시 진행해주세요.")

        # 액세스 토큰 갱신
        token_data = await self._refresh_access_token(config["refresh_token"])
        self._save_token_to_channel(channel_id, token_data)
        return token_data["access_token"]

    async def _request(
        self,
        client: httpx.AsyncClient,
        access_token: str,
        method: str,
        endpoint: str,
        **kwargs,
    ) -> dict:
        """API 요청"""
        headers = kwargs.pop("headers", {})
        headers["Authorization"] = f"Bearer {access_token}"
        headers["Content-Type"] = "application/json"
        headers["X-Cafe24-Api-Version"] = "2025-12-01"

        response = await client.request(
            method,
            f"{self._base_url}{endpoint}",
            headers=headers,
            **kwargs,
        )
        if response.status_code >= 400:
            error_body = response.text
            raise Exception(
                f"Cafe24 API 오류 (status={response.status_code}, "
                f"url={response.url}): {error_body}"
            )
        return response.json()

    async def get_daily_sales_by_range(
        self,
        channel_id: str,
        start_date: str,
        end_date: str,
    ) -> dict[str, list[dict]]:
        """날짜 범위 기반 일별 매출 데이터 조회

        Args:
            channel_id: 채널 ID (토큰 로드용)
            start_date: 시작일 (YYYY-MM-DD)
            end_date: 종료일 (YYYY-MM-DD)

        Returns:
            월별로 그룹핑된 일별 매출 데이터 {"2026-01": [...], "2026-02": [...]}
        """
        access_token = await self._get_valid_access_token(channel_id)
        orders = await self._fetch_orders_for_period(access_token, start_date, end_date)

        # 월별 → 일별 집계
        monthly_sales: dict[str, dict[int, dict]] = {}
        for order in orders:
            order_date = order.get("order_date", "")
            if not order_date:
                continue

            # 취소/반품 주문 제외
            order_status = order.get("order_status", "")
            if order_status in ("canceled", "returned", "N40", "N50"):
                continue

            try:
                date_str = order_date.split("T")[0]
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

            # 주문 금액 집계
            payment_amount = float(order.get("payment_amount", 0) or 0)
            entry["gross_sales"] += payment_amount
            entry["net_sales"] += payment_amount
            entry["order_count"] += 1

            # 수량 집계
            items = order.get("items", [])
            if items:
                for item in items:
                    entry["quantity"] += int(item.get("quantity", 0) or 0)
            else:
                # items가 embed되지 않은 경우 주문 1건으로 집계
                entry["quantity"] += int(order.get("total_quantity", 1) or 1)

        # 정렬하여 반환
        result = {}
        for ym, days in monthly_sales.items():
            result[ym] = sorted(days.values(), key=lambda x: x["day"])

        return result

    async def _fetch_orders_for_period(
        self,
        access_token: str,
        start_date: str,
        end_date: str,
    ) -> list[dict]:
        """기간 주문 조회 (페이지네이션)"""
        all_orders = []

        async with httpx.AsyncClient(timeout=30) as client:
            offset = 0
            limit = 100

            while True:
                # Rate limit 대응
                await asyncio.sleep(0.1)

                try:
                    data = await self._request(
                        client,
                        access_token,
                        "GET",
                        "/api/v2/admin/orders",
                        params={
                            "start_date": start_date,
                            "end_date": end_date,
                            "limit": limit,
                            "offset": offset,
                        },
                    )
                except Exception as e:
                    if "429" in str(e):
                        # Rate limit: 잠시 대기 후 재시도
                        await asyncio.sleep(1)
                        continue
                    raise

                orders = data.get("orders", [])
                all_orders.extend(orders)

                # 더 이상 데이터가 없으면 종료
                if len(orders) < limit:
                    break
                offset += limit

        return all_orders

    async def test_connection(self, channel_id: str) -> dict:
        """API 연결 테스트"""
        try:
            access_token = await self._get_valid_access_token(channel_id)
            async with httpx.AsyncClient(timeout=10) as client:
                # 간단한 API 호출로 연결 테스트
                await self._request(
                    client,
                    access_token,
                    "GET",
                    "/api/v2/admin/orders/count",
                )
            return {
                "success": True,
                "message": "카페24 API 연결 성공",
            }
        except Exception as e:
            return {
                "success": False,
                "message": f"연결 실패: {str(e)}",
            }

    def is_configured(self) -> bool:
        """API 설정 여부 확인"""
        return bool(
            self.config.client_id
            and self.config.client_secret
            and self.config.mall_id
        )

    def has_token(self, channel_id: str) -> bool:
        """토큰 존재 여부 확인"""
        config = self._load_token_from_channel(channel_id)
        return config is not None and bool(config.get("access_token"))


# 싱글톤 인스턴스
_cafe24_service: Optional[Cafe24Service] = None


def get_cafe24_service() -> Cafe24Service:
    """카페24 서비스 인스턴스 반환"""
    global _cafe24_service
    if _cafe24_service is None:
        _cafe24_service = Cafe24Service()
    return _cafe24_service
