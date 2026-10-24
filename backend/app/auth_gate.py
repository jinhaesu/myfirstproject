"""전역 인증 게이트 (ASGI 미들웨어).

2026-10-24 대표 지시: 로그인 없이 열려 있던 서버 API(/api/csa, /api/management,
/api/sabangnet, 재고·생산·물류·구매 조회, 생산실적 쓰기 등 310여 개)를 전부 인증 필요로 막는다.

라우트마다 Depends(get_current_user)를 붙이는 방식은 새 라우트를 만들 때 빠뜨리면
다시 열린다. 그래서 앱 전체 앞단에서 "기본 차단, 명시 허용"으로 막는다.

통과 조건 (Authorization: Bearer <값>):
  1) JARVIS_API_KEY 와 정확히 일치하는 서비스 키 (기계 호출자: JARVIS, 회계 시스템,
     마케팅 시스템, 주간 경영 리포트 작업, Cloud Scheduler)
  2) 이 앱이 발급한 사용자 JWT (SSO 교환 /api/auth/sso, 허브 게이트웨이, MES self-JWT 포함)

인증 없이 통과시키는 경로(PUBLIC_*)는 아래 목록뿐이다. 목록에 넣을 때는 그 경로가
자체 인증(외부 키·OAuth state 등)을 갖고 있거나 데이터를 노출하지 않는지 확인할 것.
"""
from __future__ import annotations

import hmac
import json
import os

from app.services.auth_service import AuthService

# 정확히 일치해야 통과하는 공개 경로
PUBLIC_EXACT = frozenset({
    "/",
    "/health",
    # 로그인 흐름 (각 엔드포인트가 자체 검증)
    "/api/auth/login",
    "/api/auth/send-otp",
    "/api/auth/verify-otp",
    "/api/auth/sso",
    # Cafe24 OAuth 리다이렉트 (브라우저가 Cafe24에서 돌아오는 경로, 헤더 없음)
    "/api/cafe24/oauth/callback",
    # 로컬 정산 에이전트: X-Agent-Key(LOCAL_AGENT_API_KEY)로 자체 인증, 키 미설정 시 항상 401
    "/api/settlement/agent/configs",
    "/api/settlement/agent/submit",
    "/api/settlement/agent/log",
    "/api/settlement/agent/heartbeat",
})

# 접두사로 통과하는 공개 경로
PUBLIC_PREFIX = (
    # 사방넷 서버가 가져가는 XML 요청 파일 (uuid4 1회용, 읽으면 즉시 삭제)
    "/api/sabangnet/xml-host/",
)

_auth_service = AuthService()


def _is_public(path: str) -> bool:
    if path in PUBLIC_EXACT:
        return True
    return any(path.startswith(p) for p in PUBLIC_PREFIX)


def _bearer(scope) -> str | None:
    for k, v in scope.get("headers") or []:
        if k == b"authorization":
            try:
                s = v.decode("latin-1").strip()
            except Exception:
                return None
            if s[:7].lower() == "bearer ":
                return s[7:].strip() or None
            return None
    return None


def is_authorized_token(token: str | None) -> bool:
    if not token:
        return False
    jarvis_key = os.getenv("JARVIS_API_KEY")
    if jarvis_key and hmac.compare_digest(token.encode(), jarvis_key.encode()):
        return True
    payload = _auth_service.verify_token(token)
    return bool(payload and payload.get("sub"))


class AuthGateMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        method = scope.get("method", "GET")
        path = scope.get("path", "")
        # CORS preflight 는 CORSMiddleware(바깥쪽)가 처리하지만 방어적으로 통과
        if method == "OPTIONS" or _is_public(path):
            return await self.app(scope, receive, send)
        if is_authorized_token(_bearer(scope)):
            return await self.app(scope, receive, send)

        body = json.dumps({"detail": "인증이 필요합니다"}, ensure_ascii=False).encode("utf-8")
        await send({
            "type": "http.response.start",
            "status": 401,
            "headers": [
                (b"content-type", b"application/json; charset=utf-8"),
                (b"content-length", str(len(body)).encode()),
                (b"www-authenticate", b"Bearer"),
            ],
        })
        await send({"type": "http.response.body", "body": body})
