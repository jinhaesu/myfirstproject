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


@lru_cache
def get_omni_llm_service() -> LLMService:
    """전사 통합 AI 비서 전용 LLM (Opus 5.0). CEO 지정 — 매출·원가·물류·생산·구매
    전체를 아우르는 경영 질의 응답용. 일반 CSA 채팅(Opus 4.8)과 분리."""
    settings = get_settings()
    return LLMService(api_key=settings.ANTHROPIC_API_KEY, model="claude-opus-5")


@lru_cache
def get_omni_sql_generator() -> SQLGenerator:
    return SQLGenerator(llm_service=get_omni_llm_service())


# NOTE: get_bigquery_service는 /api/tables, /api/query 등 다른 라우트에서 여전히 사용됨.
# AI 채팅(/api/chat)은 CSA(Postgres) 기반으로 전환되어 더 이상 BigQuery에 의존하지 않는다.
