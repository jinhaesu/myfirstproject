import logging
from fastapi import APIRouter, Depends, HTTPException

from app.api.deps import get_sql_generator
from app.services.sql_generator import SQLGenerator
from app.services.csa_query_service import execute_readonly_query
from app.models.csa_chat_schema import get_csa_schema_text
from app.models.schemas import ChatRequest, ChatResponse
from app.api.routes.auth import get_current_user

logger = logging.getLogger(__name__)
router = APIRouter()

MAX_SQL_RETRIES = 2


@router.post("/chat")
async def chat(
    request: ChatRequest,
    current_user: dict = Depends(get_current_user),
    sql_gen: SQLGenerator = Depends(get_sql_generator)
) -> ChatResponse:
    """자연어 질문으로 CSA(채널별 매출 취합) 데이터 분석.

    BigQuery가 아닌 앱 DB(PostgreSQL/Supabase)의 CSA 테이블을 대상으로 SQL을
    생성·실행한다. request.table_id/dataset_id는 하위호환을 위해 남아있으나
    사용되지 않는다 (정적 큐레이션 스키마를 항상 사용).
    """
    schema_text = get_csa_schema_text()

    try:
        # 1. 자연어 → SQL 변환 (Postgres, CSA 정적 스키마 기반)
        sql = sql_gen.generate_sql(question=request.question, schema_text=schema_text)

        # 2. SQL 실행 (실패 시 자동 수정 재시도)
        columns, rows = None, None
        last_error = None

        for attempt in range(1 + MAX_SQL_RETRIES):
            try:
                columns, rows = execute_readonly_query(sql)
                last_error = None
                break
            except Exception as e:
                last_error = e
                error_msg = str(e)
                logger.warning(f"SQL 실행 실패 (시도 {attempt + 1}): {error_msg[:200]}")

                if attempt < MAX_SQL_RETRIES:
                    # Claude에게 에러를 피드백하여 SQL 수정
                    try:
                        sql = sql_gen.fix_sql(
                            question=request.question,
                            schema_text=schema_text,
                            failed_sql=sql,
                            error_message=error_msg
                        )
                        logger.info(f"SQL 자동 수정 완료 (시도 {attempt + 2})")
                    except ValueError as fix_err:
                        logger.error(f"SQL 수정 실패: {fix_err}")
                        break

        if last_error is not None:
            raise last_error

        # 3. 결과 설명 생성
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
        logger.error(f"채팅 처리 중 예기치 않은 오류: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail="요청 처리 중 오류가 발생했습니다. 다시 시도해주세요."
        )
