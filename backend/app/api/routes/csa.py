"""채널별 매출 취합(CSA) API."""
from __future__ import annotations

import logging
import os
import tempfile
from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel
from sqlalchemy import func, and_, or_
from sqlalchemy.orm import Session

from app.database import get_db
from app.db_models import (
    Channel,
    ProductMaster,
    ChannelProductMapping,
    ChannelSalesUploadBatch,
    ChannelSalesRawLine,
    ChannelSalesDailyProduct,
    ProductVariableCost,
    ChannelUnmatchedProduct,
    ChannelBusinessPlan,
)
from app.services.csa_service import (
    seed_product_master,
    seed_channels,
    ingest_lines,
    rebuild_daily_aggregate,
    resolve_product,
    normalize_channel_name,
)
from app.services.csa_parsers import get_parser, registered_channels
from app.services.csa_parsers._common import file_sha256

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/csa", tags=["csa"])


# ──────────────────────────────────────────────────────────────
# Schemas
# ──────────────────────────────────────────────────────────────

class ProductMasterOut(BaseModel):
    id: int
    code: Optional[str] = None
    name: str
    category: Optional[str] = None
    default_unit_size: int = 1
    is_active: bool = True
    sort_order: int = 0

    model_config = {"from_attributes": True}


class MappingIn(BaseModel):
    channel_id: str
    channel_name: str
    raw_product_name: str
    raw_option_name: Optional[str] = None
    product_id: Optional[int] = None
    unit_per_set: int = 1
    is_excluded: bool = False
    notes: Optional[str] = None


class VariableCostIn(BaseModel):
    product_id: int
    channel_id: Optional[str] = None
    cost_per_pcs: float
    valid_from: Optional[date] = None
    valid_to: Optional[date] = None
    notes: Optional[str] = None


# ──────────────────────────────────────────────────────────────
# Seed / Master
# ──────────────────────────────────────────────────────────────

@router.post("/seed")
def seed(db: Session = Depends(get_db)):
    p = seed_product_master(db)
    c = seed_channels(db)
    return {"products": p, "channels": c, "parsers": registered_channels()}


@router.get("/products", response_model=list[ProductMasterOut])
def list_products(db: Session = Depends(get_db)):
    return (
        db.query(ProductMaster)
        .filter(ProductMaster.is_active.is_(True))
        .order_by(ProductMaster.sort_order, ProductMaster.id)
        .all()
    )


@router.get("/channels")
def list_channels(db: Session = Depends(get_db)):
    rows = db.query(Channel).order_by(Channel.category, Channel.name).all()
    parsers = set(registered_channels())
    return [
        {
            "id": c.id,
            "name": c.name,
            "category": c.category,
            "integration_type": c.integration_type,
            "is_active": c.is_active,
            "has_parser": c.name in parsers,
        }
        for c in rows
    ]


# ──────────────────────────────────────────────────────────────
# Upload + Parse
# ──────────────────────────────────────────────────────────────

@router.post("/upload")
async def upload_channel_file(
    channel_id: str = Form(...),
    channel_name: str = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    parser = get_parser(channel_name)
    if not parser:
        raise HTTPException(status_code=400, detail=f"채널 '{channel_name}' 파서가 아직 구현되지 않았습니다")

    suffix = os.path.splitext(file.filename or "")[1] or ".xlsx"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name

    try:
        fsize = len(content)
        fhash = file_sha256(tmp_path)

        # 동일 파일 재업로드 감지
        dup_batch = db.query(ChannelSalesUploadBatch).filter(
            ChannelSalesUploadBatch.channel_id == channel_id,
            ChannelSalesUploadBatch.file_hash == fhash,
        ).first()
        if dup_batch:
            return {
                "batch_id": dup_batch.id,
                "duplicate_file": True,
                "row_total": dup_batch.row_total,
                "row_inserted": dup_batch.row_inserted,
                "row_duplicate": dup_batch.row_duplicate,
                "row_unmatched": dup_batch.row_unmatched,
                "message": "이미 업로드된 파일입니다. 새로 적재하지 않았습니다.",
            }

        lines = list(parser(tmp_path))
        batch = ingest_lines(
            db,
            channel_id=channel_id,
            channel_name=channel_name,
            file_name=file.filename or "upload",
            file_hash=fhash,
            file_size=fsize,
            parser_version="v1",
            lines=lines,
        )
        return {
            "batch_id": batch.id,
            "duplicate_file": False,
            "row_total": batch.row_total,
            "row_inserted": batch.row_inserted,
            "row_duplicate": batch.row_duplicate,
            "row_unmatched": batch.row_unmatched,
            "row_excluded": batch.row_excluded,
            "period_start": batch.period_start.isoformat() if batch.period_start else None,
            "period_end": batch.period_end.isoformat() if batch.period_end else None,
        }
    finally:
        try:
            os.unlink(tmp_path)
        except Exception:
            pass


@router.get("/batches")
def list_batches(
    channel_id: Optional[str] = None,
    limit: int = 50,
    db: Session = Depends(get_db),
):
    q = db.query(ChannelSalesUploadBatch).order_by(ChannelSalesUploadBatch.created_at.desc())
    if channel_id:
        q = q.filter(ChannelSalesUploadBatch.channel_id == channel_id)
    rows = q.limit(limit).all()
    return [
        {
            "id": b.id,
            "channel_id": b.channel_id,
            "channel_name": b.channel_name,
            "file_name": b.file_name,
            "status": b.status,
            "period_start": b.period_start.isoformat() if b.period_start else None,
            "period_end": b.period_end.isoformat() if b.period_end else None,
            "row_total": b.row_total,
            "row_inserted": b.row_inserted,
            "row_duplicate": b.row_duplicate,
            "row_unmatched": b.row_unmatched,
            "created_at": b.created_at.isoformat() if b.created_at else None,
        }
        for b in rows
    ]


# ──────────────────────────────────────────────────────────────
# Unmatched queue + mapping
# ──────────────────────────────────────────────────────────────

@router.get("/unmatched")
def list_unmatched(db: Session = Depends(get_db)):
    rows = (
        db.query(ChannelUnmatchedProduct)
        .filter(ChannelUnmatchedProduct.status == "pending")
        .order_by(ChannelUnmatchedProduct.occurrence_count.desc())
        .all()
    )
    return [
        {
            "id": r.id,
            "channel_id": r.channel_id,
            "channel_name": r.channel_name,
            "raw_product_name": r.raw_product_name,
            "raw_option_name": r.raw_option_name,
            "occurrence_count": r.occurrence_count,
            "total_qty": r.total_qty,
            "llm_suggested_product_id": r.llm_suggested_product_id,
            "llm_suggested_unit_per_set": r.llm_suggested_unit_per_set,
            "llm_confidence": r.llm_confidence,
            "llm_reason": r.llm_reason,
        }
        for r in rows
    ]


@router.post("/mapping")
def upsert_mapping(payload: MappingIn, db: Session = Depends(get_db)):
    existing = db.query(ChannelProductMapping).filter(
        ChannelProductMapping.channel_id == payload.channel_id,
        ChannelProductMapping.raw_product_name == payload.raw_product_name,
        ChannelProductMapping.raw_option_name == payload.raw_option_name,
    ).first()
    if existing:
        existing.product_id = payload.product_id
        existing.unit_per_set = payload.unit_per_set
        existing.is_excluded = payload.is_excluded
        existing.notes = payload.notes
        existing.confidence = "manual"
        db.commit()
        mapping_id = existing.id
    else:
        m = ChannelProductMapping(**payload.model_dump(), confidence="manual")
        db.add(m)
        db.commit()
        mapping_id = m.id

    # 매핑 해결 큐 처리
    pending = db.query(ChannelUnmatchedProduct).filter(
        ChannelUnmatchedProduct.channel_id == payload.channel_id,
        ChannelUnmatchedProduct.raw_product_name == payload.raw_product_name,
        ChannelUnmatchedProduct.raw_option_name == payload.raw_option_name,
        ChannelUnmatchedProduct.status == "pending",
    ).first()
    if pending:
        pending.status = "resolved"
        pending.resolved_product_id = payload.product_id
        pending.resolved_unit_per_set = payload.unit_per_set
        pending.resolved_at = datetime.utcnow()
        db.commit()

    # 기존 raw_lines 재매핑
    affected = db.query(ChannelSalesRawLine).filter(
        ChannelSalesRawLine.channel_id == payload.channel_id,
        ChannelSalesRawLine.raw_product_name == payload.raw_product_name,
    )
    if payload.raw_option_name:
        affected = affected.filter(ChannelSalesRawLine.raw_option_name == payload.raw_option_name)

    updated = 0
    min_d, max_d = None, None
    for ln in affected.all():
        if payload.is_excluded:
            ln.mapping_status = "excluded"
            ln.product_id = None
            ln.pcs_qty = 0
        elif payload.product_id:
            ln.product_id = payload.product_id
            ln.pcs_qty = (ln.raw_qty or 0) * (payload.unit_per_set or 1)
            ln.mapping_status = "matched"
        if min_d is None or ln.sale_date < min_d:
            min_d = ln.sale_date
        if max_d is None or ln.sale_date > max_d:
            max_d = ln.sale_date
        updated += 1
    db.commit()

    if updated:
        rebuild_daily_aggregate(db, channel_id=payload.channel_id, since=min_d, until=max_d)

    return {"mapping_id": mapping_id, "raw_lines_updated": updated}


# ──────────────────────────────────────────────────────────────
# Variable cost
# ──────────────────────────────────────────────────────────────

@router.get("/variable-costs")
def list_variable_costs(db: Session = Depends(get_db)):
    rows = db.query(ProductVariableCost).all()
    return [
        {
            "id": r.id,
            "product_id": r.product_id,
            "channel_id": r.channel_id,
            "cost_per_pcs": r.cost_per_pcs,
            "valid_from": r.valid_from.isoformat() if r.valid_from else None,
            "valid_to": r.valid_to.isoformat() if r.valid_to else None,
            "notes": r.notes,
        }
        for r in rows
    ]


@router.post("/variable-costs")
def upsert_variable_cost(payload: VariableCostIn, db: Session = Depends(get_db)):
    existing = db.query(ProductVariableCost).filter(
        ProductVariableCost.product_id == payload.product_id,
        ProductVariableCost.channel_id == payload.channel_id,
    ).first()
    if existing:
        existing.cost_per_pcs = payload.cost_per_pcs
        existing.valid_from = payload.valid_from
        existing.valid_to = payload.valid_to
        existing.notes = payload.notes
    else:
        existing = ProductVariableCost(**payload.model_dump())
        db.add(existing)
    db.commit()
    rebuild_daily_aggregate(db)
    return {"id": existing.id}


# ──────────────────────────────────────────────────────────────
# Dashboard query
# ──────────────────────────────────────────────────────────────

def _granularity_columns(g: str):
    """granularity → SQL group_by columns + label expression."""
    if g == "day":
        return ["sale_date"], "sale_date"
    if g == "month":
        return ["year", "month"], None
    if g == "quarter":
        return ["year", "quarter"], None
    if g == "year":
        return ["year"], None
    raise HTTPException(400, "invalid granularity")


@router.get("/dashboard")
def dashboard(
    period_start: date,
    period_end: date,
    granularity: str = Query("month", regex="^(day|month|quarter|year)$"),
    channel_ids: Optional[str] = Query(None, description="콤마구분 channel_id"),
    product_ids: Optional[str] = Query(None, description="콤마구분 product_id"),
    db: Session = Depends(get_db),
):
    q = db.query(ChannelSalesDailyProduct).filter(
        ChannelSalesDailyProduct.sale_date >= period_start,
        ChannelSalesDailyProduct.sale_date <= period_end,
    )
    if channel_ids:
        ids = [s.strip() for s in channel_ids.split(",") if s.strip()]
        if ids:
            q = q.filter(ChannelSalesDailyProduct.channel_id.in_(ids))
    if product_ids:
        ids = [int(s) for s in product_ids.split(",") if s.strip()]
        if ids:
            q = q.filter(ChannelSalesDailyProduct.product_id.in_(ids))

    rows = q.all()

    # 집계
    total_revenue = sum(r.net_sales or 0 for r in rows)
    total_pcs = sum(r.pcs_qty or 0 for r in rows)
    total_orders = sum(r.order_count or 0 for r in rows)
    total_cost = sum(r.variable_cost or 0 for r in rows)
    total_commission = sum(r.commission or 0 for r in rows)
    total_cm = sum(r.contribution_margin or 0 for r in rows)
    cm_rate = (total_cm / total_revenue * 100) if total_revenue else 0

    # 기간 시리즈
    series_map: dict[str, dict] = {}
    for r in rows:
        if granularity == "day":
            key = r.sale_date.isoformat()
        elif granularity == "month":
            key = f"{r.year}-{r.month:02d}"
        elif granularity == "quarter":
            key = f"{r.year}-Q{r.quarter}"
        else:
            key = f"{r.year}"
        slot = series_map.setdefault(key, {
            "period": key, "revenue": 0, "pcs": 0, "orders": 0,
            "cost": 0, "commission": 0, "contribution_margin": 0,
        })
        slot["revenue"] += r.net_sales or 0
        slot["pcs"] += r.pcs_qty or 0
        slot["orders"] += r.order_count or 0
        slot["cost"] += r.variable_cost or 0
        slot["commission"] += r.commission or 0
        slot["contribution_margin"] += r.contribution_margin or 0
    series = sorted(series_map.values(), key=lambda x: x["period"])

    # 채널별 합계
    by_channel: dict[str, dict] = {}
    for r in rows:
        slot = by_channel.setdefault(r.channel_id, {
            "channel_id": r.channel_id,
            "channel_name": r.channel_name,
            "channel_category": r.channel_category,
            "revenue": 0, "pcs": 0, "orders": 0,
            "contribution_margin": 0,
        })
        slot["revenue"] += r.net_sales or 0
        slot["pcs"] += r.pcs_qty or 0
        slot["orders"] += r.order_count or 0
        slot["contribution_margin"] += r.contribution_margin or 0
    channels_summary = sorted(by_channel.values(), key=lambda x: -x["revenue"])

    # 품목별 합계
    by_product: dict[int, dict] = {}
    for r in rows:
        if r.product_id is None:
            continue
        slot = by_product.setdefault(r.product_id, {
            "product_id": r.product_id,
            "product_name": r.product_name,
            "revenue": 0, "pcs": 0, "orders": 0,
            "contribution_margin": 0,
        })
        slot["revenue"] += r.net_sales or 0
        slot["pcs"] += r.pcs_qty or 0
        slot["orders"] += r.order_count or 0
        slot["contribution_margin"] += r.contribution_margin or 0
    products_summary = sorted(by_product.values(), key=lambda x: -x["revenue"])
    for p in products_summary:
        p["cm_rate"] = (p["contribution_margin"] / p["revenue"] * 100) if p["revenue"] else 0
    for c in channels_summary:
        c["cm_rate"] = (c["contribution_margin"] / c["revenue"] * 100) if c["revenue"] else 0

    return {
        "summary": {
            "revenue": total_revenue,
            "pcs": total_pcs,
            "orders": total_orders,
            "variable_cost": total_cost,
            "commission": total_commission,
            "contribution_margin": total_cm,
            "cm_rate": cm_rate,
        },
        "series": series,
        "channels": channels_summary,
        "products": products_summary,
        "granularity": granularity,
        "period_start": period_start.isoformat(),
        "period_end": period_end.isoformat(),
    }
