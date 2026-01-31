import json
from datetime import datetime, timedelta
from typing import Optional
import jwt
from passlib.context import CryptContext

from app.config import get_settings


# 비밀번호 해싱
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


class AuthService:
    def __init__(self):
        self.settings = get_settings()
        self._users = None

    @property
    def users(self) -> list[dict]:
        """환경변수에서 사용자 목록 로드"""
        if self._users is None:
            try:
                self._users = json.loads(self.settings.USERS_JSON)
            except json.JSONDecodeError:
                self._users = []
        return self._users

    def verify_password(self, plain_password: str, hashed_password: str) -> bool:
        """비밀번호 검증"""
        return pwd_context.verify(plain_password, hashed_password)

    def get_password_hash(self, password: str) -> str:
        """비밀번호 해싱"""
        return pwd_context.hash(password)

    def get_user_by_email(self, email: str) -> Optional[dict]:
        """이메일로 사용자 조회"""
        for user in self.users:
            if user.get("email") == email:
                return user
        return None

    def authenticate_user(self, email: str, password: str) -> Optional[dict]:
        """사용자 인증"""
        user = self.get_user_by_email(email)
        if not user:
            return None
        if not self.verify_password(password, user.get("password", "")):
            return None
        return user

    def create_access_token(self, data: dict) -> str:
        """JWT 토큰 생성"""
        to_encode = data.copy()
        expire = datetime.utcnow() + timedelta(hours=self.settings.JWT_EXPIRATION_HOURS)
        to_encode.update({"exp": expire})

        encoded_jwt = jwt.encode(
            to_encode,
            self.settings.JWT_SECRET_KEY,
            algorithm=self.settings.JWT_ALGORITHM
        )
        return encoded_jwt

    def verify_token(self, token: str) -> Optional[dict]:
        """JWT 토큰 검증"""
        try:
            payload = jwt.decode(
                token,
                self.settings.JWT_SECRET_KEY,
                algorithms=[self.settings.JWT_ALGORITHM]
            )
            return payload
        except jwt.ExpiredSignatureError:
            return None
        except jwt.InvalidTokenError:
            return None


# 비밀번호 해시 생성 유틸리티 (초기 사용자 설정용)
def generate_password_hash(password: str) -> str:
    """비밀번호 해시 생성 (CLI 유틸리티)"""
    return pwd_context.hash(password)
