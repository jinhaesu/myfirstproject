import json
import logging
import re
from typing import Any

from app.services.llm_service import LLMService
from app.models.prompts import (
    SQL_GENERATION_SYSTEM, SQL_GENERATION_PROMPT, SQL_FIX_PROMPT,
    RESULT_EXPLANATION_SYSTEM, RESULT_EXPLANATION_PROMPT,
)
from app.models.schemas import TableSchema

logger = logging.getLogger(__name__)


class SQLGenerator:
    FORBIDDEN_KEYWORDS = [
        'INSERT', 'UPDATE', 'DELETE', 'DROP', 'TRUNCATE',
        'ALTER', 'CREATE', 'GRANT', 'REVOKE', 'MERGE'
    ]

    def __init__(self, llm_service: LLMService):
        self.llm = llm_service

    def generate_sql(
        self,
        question: str,
        schema: TableSchema,
        schema_text: str,
        project_id: str
    ) -> str:
        """사용자 질문을 SQL로 변환"""
        prompt = SQL_GENERATION_PROMPT.format(
            project_id=project_id,
            dataset_id=schema.dataset_id,
            table_id=schema.table_name,
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
        schema: TableSchema,
        schema_text: str,
        project_id: str,
        failed_sql: str,
        error_message: str
    ) -> str:
        """BigQuery 실행 오류가 발생한 SQL을 수정"""
        prompt = SQL_FIX_PROMPT.format(
            project_id=project_id,
            dataset_id=schema.dataset_id,
            table_id=schema.table_name,
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

        return self.llm.generate(prompt, system=RESULT_EXPLANATION_SYSTEM, max_tokens=1024)

    def _clean_sql(self, sql: str) -> str:
        """SQL에서 불필요한 요소 제거"""
        sql = sql.strip()

        # 코드 블록 제거 (여러 패턴 대응)
        sql = re.sub(r'^```(?:sql)?\s*\n?', '', sql)
        sql = re.sub(r'\n?\s*```$', '', sql)

        # 앞뒤 공백 정리
        sql = sql.strip()

        # 세미콜론이 없으면 추가
        if not sql.endswith(';'):
            sql += ';'

        return sql

    def _validate_sql(self, sql: str) -> None:
        """위험한 SQL 명령어 차단"""
        sql_upper = sql.upper()

        for keyword in self.FORBIDDEN_KEYWORDS:
            # 단어 경계 확인
            pattern = r'\b' + keyword + r'\b'
            if re.search(pattern, sql_upper):
                raise ValueError(f"허용되지 않는 SQL 명령어입니다: {keyword}")

        # SELECT로 시작하는지 확인 (WITH CTE도 허용)
        stripped = sql_upper.strip()
        if not (stripped.startswith('SELECT') or stripped.startswith('WITH')):
            raise ValueError("SELECT 또는 WITH 쿼리만 허용됩니다")
