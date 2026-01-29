from pydantic import BaseModel
from typing import Any


class ColumnInfo(BaseModel):
    name: str
    type: str
    description: str | None = None


class TableSchema(BaseModel):
    table_name: str
    dataset_id: str
    columns: list[ColumnInfo]


class TableListResponse(BaseModel):
    tables: list[str]
    dataset_id: str


class QueryRequest(BaseModel):
    sql: str
    limit: int = 1000


class QueryResponse(BaseModel):
    columns: list[str]
    rows: list[dict[str, Any]]
    row_count: int


class ChatRequest(BaseModel):
    question: str
    table_id: str
    dataset_id: str | None = None


class ChatResponse(BaseModel):
    question: str
    sql: str
    explanation: str
    columns: list[str]
    rows: list[dict[str, Any]]
    row_count: int


class ErrorResponse(BaseModel):
    error: str
    detail: str | None = None
