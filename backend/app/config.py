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

    # 도메인 자동 허용 — 이 도메인의 이메일은 사전 등록 없이 OTP 로그인 허용 (쉼표 구분)
    ALLOWED_EMAIL_DOMAINS: str = "joinandjoin.com"

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

    # 사방넷 API (쇼핑몰 통합관리)
    SABANGNET_API_KEY: str = ""        # 인증키 (SEND_AUTH_KEY)
    SABANGNET_API_URL: str = ""        # 미사용 (하위호환)
    SABANGNET_LOGIN_ID: str = ""       # 로그인 아이디 (SEND_COMPAYNY_ID)
    SABANGNET_ADMIN_NO: str = ""       # 관리자 번호 (sbadminXX의 XX)
    BACKEND_PUBLIC_URL: str = ""       # 백엔드 공개 URL (Railway 배포 URL)

    # Vapi (AI 전화 응대)
    VAPI_API_KEY: str = ""

    # ElevenLabs (음성 클로닝/TTS)
    ELEVENLABS_API_KEY: str = ""

    # 스마트택배 (배송 추적)
    SWEETTRACKER_API_KEY: str = ""

    # Local RPA Agent
    LOCAL_AGENT_API_KEY: str = ""

    @property
    def allowed_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.ALLOWED_ORIGINS.split(",")]

    @property
    def allowed_email_domains_list(self) -> list[str]:
        return [d.strip().lower() for d in self.ALLOWED_EMAIL_DOMAINS.split(",") if d.strip()]

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


@lru_cache
def get_settings() -> Settings:
    return Settings()
