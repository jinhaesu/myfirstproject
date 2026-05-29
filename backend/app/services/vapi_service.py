"""Vapi AI 전화 응대 서비스

Vapi API를 사용하여 AI 전화 에이전트를 관리합니다.
- 전화번호 생성/관리
- 어시스턴트(AI 상담원) 생성/관리
- 통화 내역 조회

API 문서: https://docs.vapi.ai/api-reference
"""
import logging
from typing import Optional, Dict, Any, List

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)

VAPI_BASE_URL = "https://api.vapi.ai"


class VapiService:
    """Vapi AI 전화 응대 서비스"""

    def __init__(self):
        settings = get_settings()
        self.api_key = settings.VAPI_API_KEY
        self._available = bool(self.api_key)

    @property
    def is_available(self) -> bool:
        return self._available

    def _headers(self) -> dict:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    async def _request(self, method: str, path: str, data: dict = None) -> dict:
        if not self._available:
            return {"error": True, "message": "Vapi API 키가 설정되지 않았습니다"}

        url = f"{VAPI_BASE_URL}{path}"
        try:
            async with httpx.AsyncClient() as client:
                if method == "GET":
                    resp = await client.get(url, headers=self._headers(), params=data, timeout=15.0)
                elif method == "POST":
                    resp = await client.post(url, headers=self._headers(), json=data, timeout=15.0)
                elif method == "DELETE":
                    resp = await client.delete(url, headers=self._headers(), timeout=15.0)
                elif method == "PATCH":
                    resp = await client.patch(url, headers=self._headers(), json=data, timeout=15.0)
                else:
                    return {"error": True, "message": f"Unsupported method: {method}"}

                if resp.status_code in (200, 201):
                    return resp.json()
                else:
                    logger.error(f"Vapi API 오류: {resp.status_code} - {resp.text[:500]}")
                    return {
                        "error": True,
                        "status_code": resp.status_code,
                        "message": resp.text[:500],
                    }
        except Exception as e:
            logger.error(f"Vapi API 호출 실패: {e}")
            return {"error": True, "message": str(e)}

    # ── 어시스턴트 ──────────────────────────────────

    async def create_assistant(
        self,
        name: str,
        system_prompt: str,
        greeting: str,
        voice_id: str = None,
        elevenlabs_api_key: str = None,
    ) -> dict:
        """CS 어시스턴트 생성"""
        voice_config = {
            "provider": "11labs",
            "voiceId": voice_id or "21m00Tcm4TlvDq8ikWAM",  # default Rachel
        }
        # elevenlabs_api_key는 Vapi 대시보드 > Provider Keys 에서 설정하는 것이 일반적.
        # 필요 시 voice_config 에 apiKey 필드 추가 가능.

        assistant_data = {
            "name": name,
            "model": {
                "provider": "anthropic",
                "model": "claude-sonnet-4-20250514",
                "messages": [{"role": "system", "content": system_prompt}],
            },
            "voice": voice_config,
            "firstMessage": greeting,
            "transcriber": {
                "provider": "deepgram",
                "model": "nova-2",
                "language": "ko",
            },
            "endCallMessage": "통화해 주셔서 감사합니다. 좋은 하루 되세요.",
            "serverUrl": None,  # webhook URL — 배포 후 설정
        }
        return await self._request("POST", "/assistant", assistant_data)

    async def list_assistants(self) -> dict:
        """어시스턴트 목록"""
        return await self._request("GET", "/assistant")

    # ── 전화번호 ────────────────────────────────────

    async def create_phone_number(self, assistant_id: str = None) -> dict:
        """Vapi 전화번호 생성 (미국 번호 무료)"""
        data: dict = {"provider": "vapi"}
        if assistant_id:
            data["assistantId"] = assistant_id
        return await self._request("POST", "/phone-number", data)

    async def import_phone_number(
        self,
        phone_number: str,
        twilio_account_sid: str,
        twilio_auth_token: str,
        assistant_id: str = None,
    ) -> dict:
        """Twilio 번호 import"""
        data: dict = {
            "provider": "twilio",
            "number": phone_number,
            "twilioAccountSid": twilio_account_sid,
            "twilioAuthToken": twilio_auth_token,
        }
        if assistant_id:
            data["assistantId"] = assistant_id
        return await self._request("POST", "/phone-number", data)

    async def list_phone_numbers(self) -> list:
        """전화번호 목록"""
        result = await self._request("GET", "/phone-number")
        if isinstance(result, list):
            return result
        if isinstance(result, dict) and result.get("error"):
            return []
        return result.get("data", result.get("items", []))

    async def delete_phone_number(self, phone_number_id: str) -> dict:
        """전화번호 삭제"""
        return await self._request("DELETE", f"/phone-number/{phone_number_id}")

    async def update_phone_number(self, phone_number_id: str, assistant_id: str) -> dict:
        """전화번호에 어시스턴트 연결"""
        return await self._request(
            "PATCH",
            f"/phone-number/{phone_number_id}",
            {"assistantId": assistant_id},
        )

    # ── 통화 ────────────────────────────────────────

    async def list_calls(self, limit: int = 50) -> list:
        """통화 내역 목록"""
        result = await self._request("GET", "/call", {"limit": limit})
        if isinstance(result, list):
            return result
        if isinstance(result, dict) and result.get("error"):
            return []
        return result.get("data", result.get("items", []))

    async def get_call(self, call_id: str) -> dict:
        """통화 상세"""
        return await self._request("GET", f"/call/{call_id}")


def get_vapi_service() -> VapiService:
    return VapiService()
