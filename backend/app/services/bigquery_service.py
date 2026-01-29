from google.cloud import bigquery
from google.oauth2 import service_account
from typing import Any

from app.models.schemas import ColumnInfo, TableSchema


class BigQueryService:
    def __init__(self, credentials_path: str, project_id: str):
        if credentials_path:
            credentials = service_account.Credentials.from_service_account_file(
                credentials_path
            )
            self.client = bigquery.Client(
                credentials=credentials,
                project=project_id
            )
        else:
            # 기본 인증 사용 (ADC)
            self.client = bigquery.Client(project=project_id)

        self.project_id = project_id

    def list_datasets(self) -> list[str]:
        """프로젝트 내 데이터셋 목록 조회"""
        datasets = self.client.list_datasets()
        return [dataset.dataset_id for dataset in datasets]

    def list_tables(self, dataset_id: str) -> list[str]:
        """데이터셋 내 테이블 목록 조회"""
        tables = self.client.list_tables(dataset_id)
        return [table.table_id for table in tables]

    def get_table_schema(self, dataset_id: str, table_id: str) -> TableSchema:
        """테이블 스키마 조회"""
        table_ref = f"{self.project_id}.{dataset_id}.{table_id}"
        table = self.client.get_table(table_ref)

        columns = [
            ColumnInfo(
                name=field.name,
                type=field.field_type,
                description=field.description
            )
            for field in table.schema
        ]

        return TableSchema(
            table_name=table_id,
            dataset_id=dataset_id,
            columns=columns
        )

    def execute_query(self, sql: str, limit: int = 1000) -> tuple[list[str], list[dict[str, Any]]]:
        """SQL 쿼리 실행 및 결과 반환"""
        query_job = self.client.query(sql)
        results = query_job.result()

        # 컬럼명 추출
        columns = [field.name for field in results.schema]

        # 결과를 딕셔너리 리스트로 변환
        rows = []
        for row in results:
            row_dict = {}
            for col in columns:
                value = row[col]
                # BigQuery 타입을 JSON 직렬화 가능한 형태로 변환
                if hasattr(value, 'isoformat'):
                    value = value.isoformat()
                elif hasattr(value, '__float__'):
                    value = float(value)
                row_dict[col] = value
            rows.append(row_dict)

            if len(rows) >= limit:
                break

        return columns, rows

    def format_schema_for_prompt(self, schema: TableSchema) -> str:
        """LLM 프롬프트용 스키마 포맷팅"""
        lines = []
        for col in schema.columns:
            desc = f" - {col.description}" if col.description else ""
            lines.append(f"  - {col.name}: {col.type}{desc}")
        return "\n".join(lines)
