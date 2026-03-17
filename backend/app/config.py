from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    # Google Cloud
    GOOGLE_APPLICATION_CREDENTIALS: str = ""
    GOOGLE_APPLICATION_CREDENTIALS_JSON: str = ""  # JSON 문자열로 직접 입력
    GCP_PROJECT_ID: str = ""
    BIGQUERY_DATASET_ID: str = ""

    # Anthropic Claude
    ANTHROPIC_API_KEY: str = ""

    # CORS
    ALLOWED_ORIGINS: str = "http://localhost:3000"

    # JWT 설정
    JWT_SECRET_KEY: str = "your-secret-key-change-in-production"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRATION_HOURS: int = 24

    # 사용자 설정 (JSON 형식: [{"email":"admin@example.com","password":"hashed","name":"Admin"}])
    USERS_JSON: str = "[]"

    # 카페24
    CAFE24_CLIENT_ID: str = ""
    CAFE24_CLIENT_SECRET: str = ""
    CAFE24_MALL_ID: str = ""
    CAFE24_REDIRECT_URI: str = ""
    FRONTEND_URL: str = "http://localhost:3000"

    # Meta (Facebook) Ads
    META_ACCESS_TOKEN: str = ""
    META_AD_ACCOUNT_ID: str = ""

    # Naver API (시장 분석)
    NAVER_CLIENT_ID: str = ""
    NAVER_CLIENT_SECRET: str = ""

    # YouTube Data API
    YOUTUBE_API_KEY: str = ""

    # Instagram (Meta Graph API 토큰 공유)
    INSTAGRAM_ACCESS_TOKEN: str = ""

    # Resend 이메일 설정
    RESEND_API_KEY: str = ""
    RESEND_FROM_EMAIL: str = "noreply@yourdomain.com"
    OTP_EXPIRATION_MINUTES: int = 5

    # Local RPA Agent
    LOCAL_AGENT_API_KEY: str = ""

    @property
    def allowed_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.ALLOWED_ORIGINS.split(",")]

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


@lru_cache
def get_settings() -> Settings:
    return Settings()
