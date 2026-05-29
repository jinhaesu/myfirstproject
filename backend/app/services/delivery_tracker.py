"""택배 배송 추적 서비스

스마트택배(Sweet Tracker) API 또는 배송조회 API를 사용하여
운송장번호 기반 실시간 배송 상태를 조회합니다.

Sweet Tracker API가 없을 경우 택배사 직접 조회 fallback.
"""
import logging
from typing import Dict, Any, Optional

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)

# 주요 택배사 코드 매핑 (사방넷 배송사명 → 스마트택배 코드)
COURIER_CODE_MAP = {
    "CJ대한통운": "04",
    "CJ대한통운(B)": "04",
    "한진택배": "05",
    "로젠택배": "06",
    "롯데택배": "08",
    "우체국택배": "01",
    "우체국": "01",
    "경동택배": "23",
    "대신택배": "22",
    "일양로지스": "11",
    "홈픽택배": "54",
    "카카오T당일배송": "58",
    "GS Postbox": "24",
    "건영택배": "18",
    "농협택배": "53",
}

# 배송 상태 코드 → 한국어 매핑
STATUS_MAP = {
    "informationReceived": "접수",
    "at_pickup": "집하",
    "in_transit": "배송중",
    "out_for_delivery": "배달출발",
    "delivered": "배달완료",
    "unknown": "확인불가",
}


class DeliveryTracker:
    """택배 배송 추적"""

    def __init__(self):
        settings = get_settings()
        self.sweettracker_key = getattr(settings, "SWEETTRACKER_API_KEY", "")
        self.sweettracker_url = "http://info.sweettracker.co.kr/api/v1"

    @property
    def is_available(self) -> bool:
        return bool(self.sweettracker_key)

    def resolve_courier_code(self, courier_name: str) -> Optional[str]:
        """사방넷 배송사명으로 택배사 코드 조회"""
        if not courier_name:
            return None
        # 정확한 매핑
        if courier_name in COURIER_CODE_MAP:
            return COURIER_CODE_MAP[courier_name]
        # 부분 매칭
        for name, code in COURIER_CODE_MAP.items():
            if name in courier_name or courier_name in name:
                return code
        return None

    async def track_delivery(self, tracking_number: str, courier_code: str) -> Dict[str, Any]:
        """운송장번호로 배송 상태 추적

        Args:
            tracking_number: 운송장번호
            courier_code: 택배사 코드 (스마트택배 기준) 또는 택배사명
        """
        if not tracking_number:
            return {"success": False, "error": "운송장번호가 없습니다"}

        # 택배사명이 들어온 경우 코드로 변환
        if len(courier_code) > 3:
            resolved = self.resolve_courier_code(courier_code)
            if resolved:
                courier_code = resolved

        # Sweet Tracker API 사용 가능 시
        if self.is_available:
            return await self._track_via_sweettracker(tracking_number, courier_code)

        # API 키 없으면 기본 정보만 반환
        return {
            "success": True,
            "tracking_number": tracking_number,
            "courier_code": courier_code,
            "status": "unknown",
            "status_text": "API 키 미설정 - 수동 확인 필요",
            "last_event": "스마트택배 API 키를 설정하면 실시간 추적이 가능합니다",
            "events": [],
            "estimated_delivery": None,
        }

    async def _track_via_sweettracker(self, tracking_number: str, courier_code: str) -> Dict[str, Any]:
        """스마트택배 API로 배송 추적"""
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.get(
                    f"{self.sweettracker_url}/trackingInfo",
                    params={
                        "t_key": self.sweettracker_key,
                        "t_code": courier_code,
                        "t_invoice": tracking_number,
                    },
                    timeout=10.0,
                )

                if resp.status_code != 200:
                    return {
                        "success": False,
                        "error": f"스마트택배 API 오류: {resp.status_code}",
                        "tracking_number": tracking_number,
                    }

                data = resp.json()

                # 에러 응답 체크
                if data.get("code"):
                    return {
                        "success": False,
                        "error": data.get("msg", "조회 실패"),
                        "tracking_number": tracking_number,
                    }

                # 배송 이벤트 파싱
                events = []
                for item in data.get("trackingDetails", []):
                    events.append({
                        "time": item.get("timeString", ""),
                        "location": item.get("where", ""),
                        "status": item.get("kind", ""),
                        "description": item.get("telno", ""),
                    })

                # 현재 상태 결정
                level = data.get("level", 0)
                if level >= 6:
                    current_status = "delivered"
                elif level >= 4:
                    current_status = "out_for_delivery"
                elif level >= 2:
                    current_status = "in_transit"
                elif level >= 1:
                    current_status = "at_pickup"
                else:
                    current_status = "informationReceived"

                last_event = events[-1]["status"] if events else "정보 없음"
                last_event_time = events[-1]["time"] if events else None

                return {
                    "success": True,
                    "tracking_number": tracking_number,
                    "courier_code": courier_code,
                    "courier_name": data.get("adUrl", ""),
                    "status": current_status,
                    "status_text": STATUS_MAP.get(current_status, current_status),
                    "level": level,
                    "last_event": last_event,
                    "last_event_time": last_event_time,
                    "events": events,
                    "estimated_delivery": data.get("estimate", None),
                    "complete": data.get("complete", False),
                    "recipient": data.get("receiverName", ""),
                }

        except Exception as e:
            logger.error(f"스마트택배 조회 실패 ({tracking_number}): {e}")
            return {
                "success": False,
                "error": str(e),
                "tracking_number": tracking_number,
            }

    async def get_courier_list(self) -> Dict[str, Any]:
        """지원 택배사 목록 조회"""
        if not self.is_available:
            # API 없으면 정적 목록 반환
            return {
                "success": True,
                "companies": [
                    {"code": code, "name": name}
                    for name, code in COURIER_CODE_MAP.items()
                ],
            }

        try:
            async with httpx.AsyncClient() as client:
                resp = await client.get(
                    f"{self.sweettracker_url}/companylist",
                    params={"t_key": self.sweettracker_key},
                    timeout=10.0,
                )
                if resp.status_code == 200:
                    data = resp.json()
                    return {
                        "success": True,
                        "companies": data.get("Company", []),
                    }
        except Exception as e:
            logger.error(f"택배사 목록 조회 실패: {e}")

        return {
            "success": True,
            "companies": [
                {"code": code, "name": name}
                for name, code in COURIER_CODE_MAP.items()
            ],
        }
