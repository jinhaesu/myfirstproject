import json
import re
from typing import Any

from app.services.llm_service import LLMService
from app.models.prompts import SQL_GENERATION_PROMPT, RESULT_EXPLANATION_PROMPT
from app.models.schemas import TableSchema


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

        sql = self.llm.generate(prompt, max_tokens=1024)
        sql = self._clean_sql(sql)
        self._validate_sql(sql)

        return sql

    def explain_results(
        self,
        question: str,
        sql: str,
        rows: list[dict[str, Any]],
        row_count: int
    ) -> str:
        """쿼리 결과를 자연어로 설명"""
        # 결과가 너무 길면 처음 10행만 사용
        sample_rows = rows[:10]
        results_text = json.dumps(sample_rows, ensure_ascii=False, indent=2, default=str)

        prompt = RESULT_EXPLANATION_PROMPT.format(
            question=question,
            sql=sql,
            results=results_text,
            row_count=row_count
        )

        return self.llm.generate(prompt, max_tokens=512)

    def _clean_sql(self, sql: str) -> str:
        """SQL에서 불필요한 요소 제거"""
        sql = sql.strip()

        # 코드 블록 제거
        sql = re.sub(r'^```sql?\s*', '', sql)
        sql = re.sub(r'\s*```$', '', sql)

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

        # SELECT로 시작하는지 확인
        if not sql_upper.strip().startswith('SELECT'):
            raise ValueError("SELECT 쿼리만 허용됩니다")
