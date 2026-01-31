from functools import lru_cache

from app.config import get_settings
from app.services.bigquery_service import BigQueryService
from app.services.llm_service import LLMService
from app.services.sql_generator import SQLGenerator


@lru_cache
def get_bigquery_service() -> BigQueryService:
    settings = get_settings()
    return BigQueryService(
        credentials_path=settings.GOOGLE_APPLICATION_CREDENTIALS,
        project_id=settings.GCP_PROJECT_ID,
        credentials_json=settings.GOOGLE_APPLICATION_CREDENTIALS_JSON
    )


@lru_cache
def get_llm_service() -> LLMService:
    settings = get_settings()
    return LLMService(api_key=settings.ANTHROPIC_API_KEY)


@lru_cache
def get_sql_generator() -> SQLGenerator:
    llm_service = get_llm_service()
    return SQLGenerator(llm_service=llm_service)
