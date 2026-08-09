import logging
from fastapi import APIRouter, Depends, HTTPException

from app.api.deps import get_sql_generator, get_omni_sql_generator
from app.services.sql_generator import SQLGenerator
from app.services.csa_query_service import execute_readonly_query, BOM_BLOCKED_TABLES
from app.models.csa_chat_schema import get_csa_schema_text
from app.models.omni_chat_schema import get_omni_schema_text
from app.models.schemas import ChatRequest, ChatResponse
from app.api.routes.auth import get_current_user

logger = logging.getLogger(__name__)
router = APIRouter()

MAX_SQL_RETRIES = 2


def _run_chat(
    question: str,
    schema_text: str,
    sql_gen: SQLGenerator,
    blocked_tables: tuple[str, ...] = (),
) -> ChatResponse:
    """자연어 질문 → SQL 생성 → 실행(실패 시 자동 수정 재시도) → 결과 설명.

    CSA 채팅과 전사 통합 비서(OMNI)가 공유하는 파이프라인. schema_text/sql_gen만 다르다.
    blocked_tables가 있으면 해당 테이블 참조 SQL은 실행 계층에서 거부된다.
    """
    try:
        sql = sql_gen.generate_sql(question=question, schema_text=schema_text)

        columns, rows = None, None
        last_error = None
        for attempt in range(1 + MAX_SQL_RETRIES):
            try:
                columns, rows = execute_readonly_query(sql, blocked_tables=blocked_tables)
                last_error = None
                break
            except Exception as e:
                last_error = e
                error_msg = str(e)
                logger.warning(f"SQL 실행 실패 (시도 {attempt + 1}): {error_msg[:200]}")
                if attempt < MAX_SQL_RETRIES:
                    try:
                        sql = sql_gen.fix_sql(
                            question=question,
                            schema_text=schema_text,
                            failed_sql=sql,
                            error_message=error_msg,
                        )
                        logger.info(f"SQL 자동 수정 완료 (시도 {attempt + 2})")
                    except ValueError as fix_err:
                        logger.error(f"SQL 수정 실패: {fix_err}")
                        break

        if last_error is not None:
            raise last_error

        explanation = sql_gen.explain_results(
            question=question, sql=sql, rows=rows, row_count=len(rows)
        )
        return ChatResponse(
            question=question, sql=sql, explanation=explanation,
            columns=columns, rows=rows, row_count=len(rows),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"채팅 처리 중 예기치 않은 오류: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail="요청 처리 중 오류가 발생했습니다. 다시 시도해주세요.",
        )


@router.post("/chat")
async def chat(
    request: ChatRequest,
    current_user: dict = Depends(get_current_user),
    sql_gen: SQLGenerator = Depends(get_sql_generator),
) -> ChatResponse:
    """자연어 질문으로 CSA(채널별 매출 취합) 데이터 분석 (Opus 4.8).

    앱 DB(PostgreSQL/Supabase)의 CSA 테이블 대상 SQL을 생성·실행한다.
    request.table_id/dataset_id는 하위호환용으로 남아있으나 사용되지 않는다.
    """
    return _run_chat(request.question, get_csa_schema_text(), sql_gen)


@router.post("/chat/omni")
async def chat_omni(
    request: ChatRequest,
    current_user: dict = Depends(get_current_user),
    sql_gen: SQLGenerator = Depends(get_omni_sql_generator),
) -> ChatResponse:
    """전사 통합 AI 비서 (Opus 5.0). 매출·구매/원가·생산·물류·재고 전체를 아우른다.

    ⚠️ BOM 정확한 배합비는 노출하지 않는다 — 스키마에 미문서화 + 실행 계층에서
    배합 구성 테이블(scm_bom_lines 등) 참조 SQL을 차단한다.
    """
    return _run_chat(
        request.question,
        get_omni_schema_text(),
        sql_gen,
        blocked_tables=BOM_BLOCKED_TABLES,
    )
