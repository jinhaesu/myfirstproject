import json
import logging
import re
from typing import Any

from app.services.llm_service import LLMService
from app.models.prompts import (
    SQL_GENERATION_SYSTEM, SQL_GENERATION_PROMPT, SQL_FIX_PROMPT,
    RESULT_EXPLANATION_SYSTEM, RESULT_EXPLANATION_PROMPT,
)

logger = logging.getLogger(__name__)


# PostgreSQL 실행 대상 쿼리에서 차단할 명령어. SQLGenerator(생성 단계)와
# csa_query_service(실행 단계) 양쪽에서 재사용해 방어를 이중화한다.
FORBIDDEN_SQL_KEYWORDS = [
    'INSERT', 'UPDATE', 'DELETE', 'DROP', 'TRUNCATE',
    'ALTER', 'CREATE', 'GRANT', 'REVOKE', 'MERGE',
    'COPY', 'CALL', 'EXECUTE', 'VACUUM', 'REINDEX',
    'LOCK', 'REFRESH', 'ATTACH', 'DETACH',
]


def validate_readonly_sql(sql: str) -> None:
    """읽기 전용 SELECT/WITH 단일 쿼리인지 검증한다.

    - INSERT/UPDATE/DELETE/DROP 등 위험 명령어 차단
    - SELECT 또는 WITH(CTE)로 시작하는지 확인
    - 세미콜론으로 연결된 다중 statement 차단 (끝의 세미콜론 1개만 허용)
    """
    if not sql or not sql.strip():
        raise ValueError("빈 SQL 쿼리입니다")

    sql_upper = sql.upper()

    for keyword in FORBIDDEN_SQL_KEYWORDS:
        pattern = r'\b' + keyword + r'\b'
        if re.search(pattern, sql_upper):
            raise ValueError(f"허용되지 않는 SQL 명령어입니다: {keyword}")

    stripped = sql.strip()
    stripped_upper = stripped.upper()
    if not (stripped_upper.startswith('SELECT') or stripped_upper.startswith('WITH')):
        raise ValueError("SELECT 또는 WITH 쿼리만 허용됩니다")

    # 다중 statement(세미콜론 연결) 차단 — 끝의 세미콜론 1개만 허용
    body = stripped[:-1] if stripped.endswith(';') else stripped
    if ';' in body:
        raise ValueError("세미콜론으로 연결된 다중 SQL 문은 허용되지 않습니다")


class SQLGenerator:
    def __init__(self, llm_service: LLMService):
        self.llm = llm_service

    def generate_sql(self, question: str, schema_text: str) -> str:
        """사용자 질문을 PostgreSQL SQL로 변환"""
        prompt = SQL_GENERATION_PROMPT.format(
            schema=schema_text,
            question=question
        )

        sql = self.llm.generate(prompt, system=SQL_GENERATION_SYSTEM, max_tokens=2048)
        sql = self._clean_sql(sql)
        self._validate_sql(sql)

        logger.info(f"Generated SQL for question: {question[:50]}...")
        return sql

    def fix_sql(
        self,
        question: str,
        schema_text: str,
        failed_sql: str,
        error_message: str
    ) -> str:
        """실행 오류가 발생한 SQL을 수정"""
        prompt = SQL_FIX_PROMPT.format(
            schema=schema_text,
            question=question,
            failed_sql=failed_sql,
            error_message=error_message
        )

        sql = self.llm.generate(prompt, system=SQL_GENERATION_SYSTEM, max_tokens=2048)
        sql = self._clean_sql(sql)
        self._validate_sql(sql)

        logger.info(f"Fixed SQL for question: {question[:50]}...")
        return sql

    def explain_results(
        self,
        question: str,
        sql: str,
        rows: list[dict[str, Any]],
        row_count: int
    ) -> str:
        """쿼리 결과를 자연어로 설명"""
        sample_count = min(len(rows), 50)
        sample_rows = rows[:sample_count]
        results_text = json.dumps(sample_rows, ensure_ascii=False, indent=2, default=str)

        prompt = RESULT_EXPLANATION_PROMPT.format(
            question=question,
            sql=sql,
            results=results_text,
            sample_count=sample_count,
            row_count=row_count
        )

        return self.llm.generate(prompt, system=RESULT_EXPLANATION_SYSTEM, max_tokens=8192)

    def _clean_sql(self, sql: str) -> str:
        """SQL에서 불필요한 요소 제거"""
        sql = sql.strip()

        # 코드 블록 내부 SQL 추출 (```sql ... ``` 패턴)
        code_block = re.search(r'```(?:sql)?\s*\n?(.*?)\n?\s*```', sql, re.DOTALL)
        if code_block:
            sql = code_block.group(1).strip()
        else:
            # 코드 블록 없으면 SELECT/WITH 시작 부분 찾아서 추출
            match = re.search(r'\b(SELECT\b|WITH\b)', sql, re.IGNORECASE)
            if match:
                sql = sql[match.start():]

        # 앞뒤 공백 정리
        sql = sql.strip()

        # 세미콜론 이후 텍스트 제거
        semi_idx = sql.rfind(';')
        if semi_idx >= 0:
            sql = sql[:semi_idx + 1]

        # 세미콜론이 없으면 추가
        if not sql.endswith(';'):
            sql += ';'

        return sql

    def _validate_sql(self, sql: str) -> None:
        """위험한 SQL 명령어 차단 (공용 검증 함수 재사용)"""
        validate_readonly_sql(sql)
