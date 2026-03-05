import logging
from fastapi import APIRouter, Depends, HTTPException
from google.api_core.exceptions import GoogleAPIError

from app.config import get_settings
from app.api.deps import get_bigquery_service, get_sql_generator
from app.services.bigquery_service import BigQueryService
from app.services.sql_generator import SQLGenerator
from app.models.schemas import ChatRequest, ChatResponse
from app.api.routes.auth import get_current_user

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/chat")
async def chat(
    request: ChatRequest,
    current_user: dict = Depends(get_current_user),
    bq_service: BigQueryService = Depends(get_bigquery_service),
    sql_gen: SQLGenerator = Depends(get_sql_generator)
) -> ChatResponse:
    """자연어 질문으로 데이터 분석"""
    settings = get_settings()
    dataset_id = request.dataset_id or settings.BIGQUERY_DATASET_ID

    if not dataset_id:
        raise HTTPException(status_code=400, detail="dataset_id가 필요합니다. 테이블을 선택해주세요.")

    try:
        # 1. 테이블 스키마 조회
        schema = bq_service.get_table_schema(dataset_id, request.table_id)
        schema_text = bq_service.format_schema_for_prompt(schema)

        # 2. 자연어 → SQL 변환
        sql = sql_gen.generate_sql(
            question=request.question,
            schema=schema,
            schema_text=schema_text,
            project_id=settings.GCP_PROJECT_ID
        )

        # 3. SQL 실행
        columns, rows = bq_service.execute_query(sql)

        # 4. 결과 설명 생성
        explanation = sql_gen.explain_results(
            question=request.question,
            sql=sql,
            rows=rows,
            row_count=len(rows)
        )

        return ChatResponse(
            question=request.question,
            sql=sql,
            explanation=explanation,
            columns=columns,
            rows=rows,
            row_count=len(rows)
        )

    except ValueError as e:
        # AI 서비스 오류 또는 SQL 검증 실패
        raise HTTPException(status_code=400, detail=str(e))
    except GoogleAPIError as e:
        logger.error(f"BigQuery 오류: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"데이터베이스 쿼리 실행 중 오류가 발생했습니다: {str(e).split(chr(10))[0]}"
        )
    except Exception as e:
        logger.error(f"채팅 처리 중 예기치 않은 오류: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail="요청 처리 중 오류가 발생했습니다. 다시 시도해주세요."
        )
