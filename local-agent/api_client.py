"""백엔드 API 클라이언트 — Railway 서버와 통신합니다."""
import logging
import platform
import socket
from typing import Optional

import httpx

logger = logging.getLogger(__name__)


class BackendClient:
    """FastAPI 백엔드와 통신하는 HTTP 클라이언트"""

    def __init__(self, backend_url: str, api_key: str):
        self.backend_url = backend_url.rstrip("/")
        self.api_key = api_key
        self.client = httpx.Client(
            base_url=self.backend_url,
            headers={
                "X-Agent-Key": self.api_key,
                "Content-Type": "application/json",
            },
            timeout=30.0,
        )

    def get_configs(self) -> list[dict]:
        """서버에서 채널 RPA 설정 목록을 가져옵니다.

        Returns:
            list[dict]: 채널별 RPA 설정 (login_url, login_id, login_password 등)
        """
        try:
            resp = self.client.get("/api/settlement/agent/configs")
            resp.raise_for_status()
            data = resp.json()
            # API가 리스트를 직접 반환하거나 {"configs": [...]} 형태일 수 있음
            if isinstance(data, list):
                return data
            return data.get("configs", data.get("data", []))
        except httpx.HTTPStatusError as e:
            logger.error(f"서버 응답 오류 (configs): {e.response.status_code} — {e.response.text[:200]}")
            return []
        except Exception as e:
            logger.error(f"설정 가져오기 실패: {e}")
            return []

    def submit_data(self, channel_name: str, year: int, month: int, data: dict) -> Optional[dict]:
        """수집된 정산 데이터를 서버에 제출합니다.

        Args:
            channel_name: 채널명
            year: 연도
            month: 월
            data: 수집된 정산 데이터 (settlement_amount, gross_sales 등)

        Returns:
            dict: 서버 응답 또는 None (실패 시)
        """
        try:
            payload = {
                "channel_name": channel_name,
                "year": year,
                "month": month,
                "data": data,
            }
            resp = self.client.post("/api/settlement/agent/submit", json=payload)
            resp.raise_for_status()
            return resp.json()
        except httpx.HTTPStatusError as e:
            logger.error(f"데이터 제출 오류 ({channel_name}): {e.response.status_code} — {e.response.text[:200]}")
            return None
        except Exception as e:
            logger.error(f"데이터 제출 실패 ({channel_name}): {e}")
            return None

    def report_log(
        self,
        channel_name: str,
        year: int,
        month: int,
        status: str,
        error_message: Optional[str] = None,
        settlement_amount: Optional[float] = None,
        details: Optional[dict] = None,
    ) -> Optional[dict]:
        """수집 로그를 서버에 보고합니다.

        Args:
            channel_name: 채널명
            year: 연도
            month: 월
            status: 상태 (running, success, failed)
            error_message: 에러 메시지 (실패 시)
            settlement_amount: 정산 금액 (성공 시)
            details: 추가 상세 정보
        """
        try:
            payload = {
                "channel_name": channel_name,
                "year": year,
                "month": month,
                "status": status,
            }
            if error_message:
                payload["error_message"] = error_message
            if settlement_amount is not None:
                payload["settlement_amount"] = settlement_amount
            if details:
                payload["details"] = details
            resp = self.client.post("/api/settlement/agent/log", json=payload)
            resp.raise_for_status()
            return resp.json()
        except httpx.HTTPStatusError as e:
            logger.error(f"로그 보고 오류 ({channel_name}): {e.response.status_code}")
            return None
        except Exception as e:
            logger.error(f"로그 보고 실패 ({channel_name}): {e}")
            return None

    def heartbeat(
        self,
        status: str,
        current_channel: Optional[str] = None,
        channels_completed: int = 0,
        channels_total: int = 0,
    ) -> Optional[dict]:
        """에이전트 상태를 서버에 보고합니다 (하트비트).

        Args:
            status: 에이전트 상태 (idle, collecting, error)
            current_channel: 현재 수집 중인 채널
            channels_completed: 완료된 채널 수
            channels_total: 전체 채널 수

        Returns:
            dict: 서버 응답 또는 None (실패 시)
        """
        try:
            payload = {
                "status": status,
                "hostname": socket.gethostname(),
                "platform": platform.platform(),
                "channels_completed": channels_completed,
                "channels_total": channels_total,
            }
            if current_channel:
                payload["current_channel"] = current_channel
            resp = self.client.post("/api/settlement/agent/heartbeat", json=payload)
            resp.raise_for_status()
            return resp.json()
        except httpx.HTTPStatusError as e:
            logger.error(f"하트비트 오류: {e.response.status_code}")
            return None
        except Exception as e:
            logger.error(f"하트비트 실패: {e}")
            return None
