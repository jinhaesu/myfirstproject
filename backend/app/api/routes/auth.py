import os

import jwt
from fastapi import APIRouter, HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, EmailStr

from app.services.auth_service import AuthService
from app.services.otp_service import OTPService


router = APIRouter(prefix="/auth", tags=["authentication"])
security = HTTPBearer()


# ── 회사 계정 SSO (중앙 auth.nuldam.com 허브 발급 RS256 토큰 검증) ──────────
# 기존 OTP/비밀번호 로그인과 완전히 독립적인 추가 경로. 기존 흐름을 건드리지 않는다.
SSO_ISSUER = "https://auth.nuldam.com"
SSO_AUDIENCE = "scm"
SSO_JWKS_URL = "https://auth-api.nuldam.com/.well-known/jwks.json"

# 모듈 로드 시 클라이언트를 캐싱(생성자는 네트워크 호출 없음 — 실제 fetch는
# get_signing_key_from_jwt 호출 시점에 지연 수행되고 내부적으로 키를 캐싱한다).
_sso_jwks_client = jwt.PyJWKClient(SSO_JWKS_URL)


# Synthetic user returned when the request authenticates with the
# JARVIS service key instead of a real user JWT.
_JARVIS_USER = {"email": "jarvis@joinandjoin.com", "name": "JARVIS"}


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class SendOTPRequest(BaseModel):
    email: EmailStr


class VerifyOTPRequest(BaseModel):
    email: EmailStr
    otp: str


class SSORequest(BaseModel):
    token: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict


class UserResponse(BaseModel):
    email: str
    name: str


class MessageResponse(BaseModel):
    message: str
    success: bool


def get_auth_service() -> AuthService:
    return AuthService()


def get_otp_service() -> OTPService:
    return OTPService()


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    auth_service: AuthService = Depends(get_auth_service)
) -> dict:
    """현재 로그인한 사용자 조회.

    Auth resolution order:
      1. If JARVIS_API_KEY env var is set AND the incoming Bearer token
         matches it exactly, return a synthetic JARVIS service user.
         This lets the JARVIS orchestrator call the API with one static
         key instead of juggling JWT renewal.
      2. Otherwise verify the token as a regular user JWT.
    """
    token = credentials.credentials

    jarvis_key = os.getenv("JARVIS_API_KEY")
    if jarvis_key and token == jarvis_key:
        return _JARVIS_USER

    payload = auth_service.verify_token(token)

    if payload is None:
        raise HTTPException(
            status_code=401,
            detail="유효하지 않거나 만료된 토큰입니다",
            headers={"WWW-Authenticate": "Bearer"},
        )

    email = payload.get("sub")
    user = auth_service.get_user_by_email(email)

    if user is None:
        raise HTTPException(
            status_code=401,
            detail="사용자를 찾을 수 없습니다",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return {"email": user["email"], "name": user["name"]}


@router.post("/login", response_model=LoginResponse)
async def login(
    request: LoginRequest,
    auth_service: AuthService = Depends(get_auth_service)
):
    """로그인"""
    user = auth_service.authenticate_user(request.email, request.password)

    if not user:
        raise HTTPException(
            status_code=401,
            detail="이메일 또는 비밀번호가 올바르지 않습니다"
        )

    access_token = auth_service.create_access_token(
        data={"sub": user["email"]}
    )
    _record_login(user["email"], user.get("name") or "")

    return LoginResponse(
        access_token=access_token,
        user={"email": user["email"], "name": user["name"]}
    )


def _record_login(email: str, name: str):
    """로그인한 이메일을 디렉토리에 기록(권한 관리 대상). 실패해도 로그인 흐름 방해 X."""
    try:
        from app.database import SessionLocal
        from app.db_models import UserDirectory
        from datetime import datetime as _dt
        if not SessionLocal:
            return
        db = SessionLocal()
        try:
            u = db.get(UserDirectory, email)
            if not u:
                u = UserDirectory(email=email, name=name, login_count=0)
                db.add(u)
            u.name = name or u.name
            u.last_login = _dt.utcnow()
            u.login_count = (u.login_count or 0) + 1
            db.commit()
        finally:
            db.close()
    except Exception:
        pass


def _sync_menu_permissions(email: str, payload: dict):
    """허브 SSO 토큰의 권한을 이 앱의 메뉴 조회 권한(UserMenuPermission)으로 동기화.

    - payload["super"] == True  → 이 앱의 모든 scm 메뉴 부여(오너 상당).
    - 그 외                     → payload["perms"]의 키 목록을 그대로 저장.
      (perms 비어있으면 메뉴 없음. 저장값은 admin._menus_for가 유효 키만 필터링.)

    프론트(Navigation.tsx → /api/admin/my-menus → _menus_for)가 읽는 형태와 동일한
    콤마조인 문자열로 upsert 한다. 실패해도 로그인 흐름을 막지 않는다(OTP/비번 경로 불변).
    """
    try:
        from app.database import SessionLocal
        from app.db_models import UserMenuPermission
        if not SessionLocal:
            return
        # 이 앱이 실제로 표시할 수 있는 정식 메뉴 키(단일 소스).
        try:
            from app.api.routes.admin import MENUS as _MENUS
            all_keys = [m["key"] for m in _MENUS]
        except Exception:
            all_keys = ["sales", "scm", "logistics", "mapping", "purchase", "management", "cs"]

        if payload.get("super"):
            keys = list(all_keys)
        else:
            perms = payload.get("perms") or {}
            keys = list(perms.keys()) if isinstance(perms, dict) else []

        db = SessionLocal()
        try:
            p = db.get(UserMenuPermission, email)
            if not p:
                p = UserMenuPermission(email=email)
                db.add(p)
            p.menu_keys = ",".join(keys)
            p.updated_by = "hub-sso"
            db.commit()
        finally:
            db.close()
    except Exception:
        pass


@router.get("/me", response_model=UserResponse)
async def get_me(current_user: dict = Depends(get_current_user)):
    """현재 로그인한 사용자 정보"""
    return UserResponse(**current_user)


@router.post("/verify")
async def verify_token(current_user: dict = Depends(get_current_user)):
    """토큰 유효성 검증"""
    return {"valid": True, "user": current_user}


@router.post("/send-otp", response_model=MessageResponse)
async def send_otp(
    request: SendOTPRequest,
    auth_service: AuthService = Depends(get_auth_service),
    otp_service: OTPService = Depends(get_otp_service)
):
    """이메일로 OTP 발송"""
    # 사용자 존재 확인
    user = auth_service.get_user_by_email(request.email)
    if not user:
        raise HTTPException(
            status_code=404,
            detail="등록되지 않은 이메일입니다"
        )

    # OTP 생성 및 발송
    success = otp_service.create_and_send_otp(request.email)

    if not success:
        raise HTTPException(
            status_code=500,
            detail="인증 코드 발송에 실패했습니다. 잠시 후 다시 시도해주세요."
        )

    return MessageResponse(
        message="인증 코드가 이메일로 발송되었습니다",
        success=True
    )


@router.post("/verify-otp", response_model=LoginResponse)
async def verify_otp_login(
    request: VerifyOTPRequest,
    auth_service: AuthService = Depends(get_auth_service),
    otp_service: OTPService = Depends(get_otp_service)
):
    """OTP 검증 후 로그인"""
    # 사용자 존재 확인
    user = auth_service.get_user_by_email(request.email)
    if not user:
        raise HTTPException(
            status_code=404,
            detail="등록되지 않은 이메일입니다"
        )

    # OTP 검증
    if not otp_service.verify_otp(request.email, request.otp):
        raise HTTPException(
            status_code=401,
            detail="인증 코드가 올바르지 않거나 만료되었습니다"
        )

    # 로그인 성공 - JWT 토큰 발급
    access_token = auth_service.create_access_token(
        data={"sub": user["email"]}
    )
    _record_login(user["email"], user.get("name") or "")

    return LoginResponse(
        access_token=access_token,
        user={"email": user["email"], "name": user["name"]}
    )


@router.post("/sso", response_model=LoginResponse)
async def sso_login(
    request: SSORequest,
    auth_service: AuthService = Depends(get_auth_service)
):
    """회사 계정 SSO 로그인.

    중앙 auth.nuldam.com 허브가 발급한 RS256 토큰을 JWKS로 검증한 뒤,
    이 앱의 자체 access 토큰(OTP 로그인과 동일한 형태)을 발급한다.
    기존 로그인 경로를 대체하지 않는 완전 추가 경로.
    """
    try:
        signing_key = _sso_jwks_client.get_signing_key_from_jwt(request.token)
        payload = jwt.decode(
            request.token,
            signing_key.key,
            algorithms=["RS256"],
            audience=SSO_AUDIENCE,
            issuer=SSO_ISSUER,
        )
    except Exception:
        raise HTTPException(
            status_code=401,
            detail="유효하지 않은 SSO 토큰입니다",
            headers={"WWW-Authenticate": "Bearer"},
        )

    email = payload.get("email") or payload.get("sub")
    if not email:
        raise HTTPException(
            status_code=401,
            detail="SSO 토큰에 이메일 정보가 없습니다",
        )
    name = payload.get("name") or email.rsplit("@", 1)[0]

    # ── 접근 게이트 ──────────────────────────────────────────────────────
    # 중앙 허브가 이 scm 시스템 접근을 허용한 사용자만 로그인 허용.
    # super-admin 이거나, scm 메뉴 권한(perms)이 하나라도 있어야 한다.
    # 권한이 없으면 토큰을 발급하지 않고 메뉴 동기화도 하지 않는다.
    super = payload.get("super") is True
    perms = payload.get("perms")
    if not (super or (isinstance(perms, dict) and len(perms) > 0)):
        raise HTTPException(
            status_code=403,
            detail="이 시스템에 대한 접근 권한이 없습니다. 관리자에게 문의하세요.",
        )

    # 허브 super/perms → 이 앱의 메뉴 조회 권한 동기화(중앙 관리자 콘솔 반영).
    _sync_menu_permissions(email, payload)

    # 이 앱은 실제 user 테이블이 없다(OTP verify 경로와 동일하게 처리).
    access_token = auth_service.create_access_token(
        data={"sub": email}
    )
    _record_login(email, name)

    return LoginResponse(
        access_token=access_token,
        user={"email": email, "name": name}
    )
