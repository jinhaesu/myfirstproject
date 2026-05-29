import os

from fastapi import APIRouter, HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, EmailStr

from app.services.auth_service import AuthService
from app.services.otp_service import OTPService


router = APIRouter(prefix="/auth", tags=["authentication"])
security = HTTPBearer()


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

    return LoginResponse(
        access_token=access_token,
        user={"email": user["email"], "name": user["name"]}
    )


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

    return LoginResponse(
        access_token=access_token,
        user={"email": user["email"], "name": user["name"]}
    )
