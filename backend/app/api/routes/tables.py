from fastapi import APIRouter, Depends, HTTPException

from app.config import get_settings
from app.api.deps import get_bigquery_service
from app.services.bigquery_service import BigQueryService
from app.models.schemas import TableListResponse, TableSchema
from app.api.routes.auth import get_current_user

router = APIRouter()


@router.get("/datasets")
async def list_datasets(
    current_user: dict = Depends(get_current_user),
    bq_service: BigQueryService = Depends(get_bigquery_service)
) -> dict:
    """데이터셋 목록 조회"""
    try:
        datasets = bq_service.list_datasets()
        return {"datasets": datasets}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/tables")
async def list_tables(
    dataset_id: str | None = None,
    current_user: dict = Depends(get_current_user),
    bq_service: BigQueryService = Depends(get_bigquery_service)
) -> TableListResponse:
    """테이블 목록 조회"""
    settings = get_settings()
    ds_id = dataset_id or settings.BIGQUERY_DATASET_ID

    if not ds_id:
        raise HTTPException(status_code=400, detail="dataset_id가 필요합니다")

    try:
        tables = bq_service.list_tables(ds_id)
        return TableListResponse(tables=tables, dataset_id=ds_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/tables/{table_id}/schema")
async def get_table_schema(
    table_id: str,
    dataset_id: str | None = None,
    current_user: dict = Depends(get_current_user),
    bq_service: BigQueryService = Depends(get_bigquery_service)
) -> TableSchema:
    """테이블 스키마 조회"""
    settings = get_settings()
    ds_id = dataset_id or settings.BIGQUERY_DATASET_ID

    if not ds_id:
        raise HTTPException(status_code=400, detail="dataset_id가 필요합니다")

    try:
        schema = bq_service.get_table_schema(ds_id, table_id)
        return schema
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
