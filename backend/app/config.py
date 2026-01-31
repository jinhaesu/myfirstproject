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

    @property
    def allowed_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.ALLOWED_ORIGINS.split(",")]

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


@lru_cache
def get_settings() -> Settings:
    return Settings()
