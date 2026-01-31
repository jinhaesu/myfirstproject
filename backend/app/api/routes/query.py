from fastapi import APIRouter, Depends, HTTPException

from app.api.deps import get_bigquery_service
from app.services.bigquery_service import BigQueryService
from app.models.schemas import QueryRequest, QueryResponse
from app.api.routes.auth import get_current_user

router = APIRouter()


@router.post("/query")
async def execute_query(
    request: QueryRequest,
    current_user: dict = Depends(get_current_user),
    bq_service: BigQueryService = Depends(get_bigquery_service)
) -> QueryResponse:
    """SQL 쿼리 직접 실행"""
    try:
        columns, rows = bq_service.execute_query(request.sql, request.limit)
        return QueryResponse(
            columns=columns,
            rows=rows,
            row_count=len(rows)
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
