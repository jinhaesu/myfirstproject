from fastapi import APIRouter, Depends, HTTPException

from app.config import get_settings
from app.api.deps import get_bigquery_service, get_sql_generator
from app.services.bigquery_service import BigQueryService
from app.services.sql_generator import SQLGenerator
from app.models.schemas import ChatRequest, ChatResponse

router = APIRouter()


@router.post("/chat")
async def chat(
    request: ChatRequest,
    bq_service: BigQueryService = Depends(get_bigquery_service),
    sql_gen: SQLGenerator = Depends(get_sql_generator)
) -> ChatResponse:
    """자연어 질문으로 데이터 분석"""
    settings = get_settings()
    dataset_id = request.dataset_id or settings.BIGQUERY_DATASET_ID

    if not dataset_id:
        raise HTTPException(status_code=400, detail="dataset_id가 필요합니다")

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
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
