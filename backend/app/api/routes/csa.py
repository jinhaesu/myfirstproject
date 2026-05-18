"""채널별 매출 취합(CSA) API."""
from __future__ import annotations

import logging
import os
import tempfile
from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, Query, UploadFile
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
    Employee,
    ChannelGroup,
    ChannelGroupMembership,
    EmployeeChannelAssignment,
    BusinessPlanChannelRevenue,
    BusinessPlanProductQty,
    BusinessPlanCategoryQty,
    BusinessPlanGroupSummary,
    BusinessPlanUploadBatch,
)
from app.services.csa_service import (
    seed_product_master,
    seed_channels,
    seed_channel_products,
    ingest_lines,
    rebuild_daily_aggregate,
    resolve_product,
    normalize_channel_name,
)
from app.services.csa_plan_service import (
    seed_channel_groups,
    import_business_plan,
)
from app.services.csa_retention import (
    setup_retention_functions,
    setup_pg_cron_schedules,
    migrate_to_partitions,
    run_retention_now,
    get_storage_status,
)
from app.services.csa_cost_service import seed_cost_items, rebuild_daily_with_costs
from app.services.csa_pnl_service import (
    seed_pnl_rows, get_pnl_matrix, upsert_value,
    add_custom_row, delete_row,
    is_password_set, can_set_password, set_password, verify_password,
    OWNER_EMAIL,
)
from app.db_models import (
    CsaCostItem, CsaCostRule, CsaChannelMonthlyCost,
    CsaPnlRow, CsaPnlValue, CsaPnlConfig,
    CsaChannelProduct,
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
    g = seed_channel_groups(db)
    ci = seed_cost_items(db)
    cp = seed_channel_products(db)
    return {
        "products": p, "channels": c, "groups": g,
        "cost_items": ci, "channel_products_created": cp,
        "parsers": registered_channels(),
    }


@router.get("/products", response_model=list[ProductMasterOut])
def list_products(db: Session = Depends(get_db)):
    return (
        db.query(ProductMaster)
        .filter(ProductMaster.is_active.is_(True))
        .order_by(ProductMaster.sort_order, ProductMaster.id)
        .all()
    )


class ProductMasterIn(BaseModel):
    name: str
    code: Optional[str] = None
    category: Optional[str] = None
    default_unit_size: int = 1
    is_active: bool = True
    sort_order: int = 100
    notes: Optional[str] = None


@router.post("/products")
def upsert_product(payload: ProductMasterIn, db: Session = Depends(get_db)):
    existing = db.query(ProductMaster).filter(ProductMaster.name == payload.name).first()
    if existing:
        for k, v in payload.model_dump(exclude_unset=True).items():
            setattr(existing, k, v)
        db.commit()
        # 모든 활성 채널에 신규 매핑 자동 생성 (멱등)
        seed_channel_products(db)
        return {"id": existing.id, "updated": True}
    item = ProductMaster(**payload.model_dump())
    db.add(item); db.commit()
    seed_channel_products(db)
    return {"id": item.id, "updated": False}


@router.delete("/products/{product_id}")
def delete_product(product_id: int, db: Session = Depends(get_db)):
    p = db.query(ProductMaster).filter(ProductMaster.id == product_id).first()
    if not p:
        raise HTTPException(404, "product not found")
    # soft delete (is_active=False) — 매핑/매출 데이터 보존
    p.is_active = False
    db.commit()
    return {"deactivated": product_id}


# ──────────────────────────────────────────────────────────────
# 채널 × 품목 매핑
# ──────────────────────────────────────────────────────────────

class ChannelProductIn(BaseModel):
    channel_id: str
    product_id: int
    is_active: bool = True
    notes: Optional[str] = None


@router.get("/channel-products")
def list_channel_products(
    channel_id: Optional[str] = None,
    product_id: Optional[int] = None,
    only_active: bool = True,
    db: Session = Depends(get_db),
):
    q = db.query(CsaChannelProduct)
    if channel_id:
        q = q.filter(CsaChannelProduct.channel_id == channel_id)
    if product_id:
        q = q.filter(CsaChannelProduct.product_id == product_id)
    if only_active:
        q = q.filter(CsaChannelProduct.is_active.is_(True))
    rows = q.order_by(CsaChannelProduct.channel_name, CsaChannelProduct.product_name).all()
    return [
        {
            "id": r.id, "channel_id": r.channel_id, "channel_name": r.channel_name,
            "product_id": r.product_id, "product_name": r.product_name,
            "is_active": r.is_active, "added_by": r.added_by,
        } for r in rows
    ]


@router.post("/channel-products")
def upsert_channel_product(payload: ChannelProductIn, db: Session = Depends(get_db)):
    ch = db.query(Channel).filter(Channel.id == payload.channel_id).first()
    p = db.query(ProductMaster).filter(ProductMaster.id == payload.product_id).first()
    if not ch:
        raise HTTPException(404, "channel not found")
    if not p:
        raise HTTPException(404, "product not found")
    existing = db.query(CsaChannelProduct).filter(
        CsaChannelProduct.channel_id == payload.channel_id,
        CsaChannelProduct.product_id == payload.product_id,
    ).first()
    if existing:
        existing.is_active = payload.is_active
        existing.notes = payload.notes
        db.commit()
        return {"id": existing.id, "updated": True}
    item = CsaChannelProduct(
        channel_id=ch.id, channel_name=ch.name,
        product_id=p.id, product_name=p.name,
        is_active=payload.is_active, notes=payload.notes,
        added_by="manual",
    )
    db.add(item); db.commit()
    return {"id": item.id, "updated": False}


@router.delete("/channel-products/{cp_id}")
def delete_channel_product(cp_id: int, db: Session = Depends(get_db)):
    item = db.query(CsaChannelProduct).filter(CsaChannelProduct.id == cp_id).first()
    if not item:
        raise HTTPException(404, "not found")
    item.is_active = False
    db.commit()
    return {"deactivated": cp_id}


@router.post("/channel-products/bulk-set")
def bulk_set_channel_products(
    channel_id: str,
    product_ids: list[int] = Body(...),
    db: Session = Depends(get_db),
):
    """채널의 활성 품목을 product_ids로 일괄 세팅 (그 외 모두 비활성)."""
    ch = db.query(Channel).filter(Channel.id == channel_id).first()
    if not ch:
        raise HTTPException(404, "channel not found")
    products = {p.id: p for p in db.query(ProductMaster).filter(ProductMaster.is_active.is_(True)).all()}
    existing = {r.product_id: r for r in db.query(CsaChannelProduct).filter(
        CsaChannelProduct.channel_id == channel_id
    ).all()}
    pid_set = set(product_ids)
    changed = 0
    for pid in pid_set:
        if pid not in products:
            continue
        r = existing.get(pid)
        if r:
            if not r.is_active:
                r.is_active = True; changed += 1
        else:
            db.add(CsaChannelProduct(
                channel_id=channel_id, channel_name=ch.name,
                product_id=pid, product_name=products[pid].name,
                is_active=True, added_by="bulk",
            ))
            changed += 1
    for pid, r in existing.items():
        if pid not in pid_set and r.is_active:
            r.is_active = False; changed += 1
    db.commit()
    return {"channel_id": channel_id, "active_count": len(pid_set), "changed": changed}


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

        try:
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
        except Exception as e:
            # 부분 진행된 batch가 'parsing' 상태로 남지 않도록 failed로 마킹
            try:
                stuck = db.query(ChannelSalesUploadBatch).filter(
                    ChannelSalesUploadBatch.channel_id == channel_id,
                    ChannelSalesUploadBatch.file_hash == fhash,
                    ChannelSalesUploadBatch.status == "parsing",
                ).first()
                if stuck:
                    stuck.status = "failed"
                    stuck.error_message = f"{type(e).__name__}: {str(e)[:500]}"
                    db.commit()
            except Exception:
                db.rollback()
            raise HTTPException(status_code=500, detail=f"파싱 실패: {type(e).__name__}: {e}")
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
# 세분 변동비 (Cost Items / Rules / Monthly fixed)
# ──────────────────────────────────────────────────────────────

class CostItemIn(BaseModel):
    code: str
    name: str
    category: str
    basis: str
    description: Optional[str] = None
    sort_order: int = 0
    is_active: bool = True


class CostRuleIn(BaseModel):
    cost_item_id: int
    channel_id: Optional[str] = None
    product_id: Optional[int] = None
    rate: Optional[float] = None
    amount_per_pcs: Optional[float] = None
    amount_per_order: Optional[float] = None
    notes: Optional[str] = None
    valid_from: Optional[date] = None
    valid_to: Optional[date] = None
    is_active: bool = True


class ChannelMonthlyCostIn(BaseModel):
    year: int
    month: int
    channel_id: str
    channel_name: str
    cost_item_id: int
    amount: float
    notes: Optional[str] = None


@router.get("/cost-items")
def list_cost_items(db: Session = Depends(get_db)):
    rows = db.query(CsaCostItem).order_by(CsaCostItem.sort_order, CsaCostItem.id).all()
    return [
        {
            "id": r.id, "code": r.code, "name": r.name,
            "category": r.category, "basis": r.basis,
            "description": r.description, "is_active": r.is_active,
            "sort_order": r.sort_order,
        } for r in rows
    ]


@router.post("/cost-items")
def upsert_cost_item(payload: CostItemIn, db: Session = Depends(get_db)):
    existing = db.query(CsaCostItem).filter(CsaCostItem.code == payload.code).first()
    if existing:
        for k, v in payload.model_dump().items():
            setattr(existing, k, v)
        db.commit()
        return {"id": existing.id, "updated": True}
    item = CsaCostItem(**payload.model_dump())
    db.add(item)
    db.commit()
    return {"id": item.id, "updated": False}


@router.get("/cost-rules")
def list_cost_rules(
    cost_item_id: Optional[int] = None,
    channel_id: Optional[str] = None,
    db: Session = Depends(get_db),
):
    q = db.query(CsaCostRule)
    if cost_item_id:
        q = q.filter(CsaCostRule.cost_item_id == cost_item_id)
    if channel_id:
        q = q.filter(CsaCostRule.channel_id == channel_id)
    rows = q.order_by(CsaCostRule.cost_item_id, CsaCostRule.id).all()
    return [
        {
            "id": r.id, "cost_item_id": r.cost_item_id,
            "channel_id": r.channel_id, "product_id": r.product_id,
            "rate": r.rate, "amount_per_pcs": r.amount_per_pcs,
            "amount_per_order": r.amount_per_order,
            "valid_from": r.valid_from.isoformat() if r.valid_from else None,
            "valid_to": r.valid_to.isoformat() if r.valid_to else None,
            "notes": r.notes, "is_active": r.is_active,
        } for r in rows
    ]


@router.post("/cost-rules")
def upsert_cost_rule(payload: CostRuleIn, db: Session = Depends(get_db)):
    # 동일 (item, channel, product) + 동일 기간이면 upsert, 기간이 다르면 새 규칙 추가 허용
    existing = db.query(CsaCostRule).filter(
        CsaCostRule.cost_item_id == payload.cost_item_id,
        CsaCostRule.channel_id == payload.channel_id,
        CsaCostRule.product_id == payload.product_id,
        CsaCostRule.valid_from == payload.valid_from,
        CsaCostRule.valid_to == payload.valid_to,
    ).first()
    if existing:
        for k, v in payload.model_dump().items():
            setattr(existing, k, v)
        db.commit()
        rule_id = existing.id
    else:
        rule = CsaCostRule(**payload.model_dump())
        db.add(rule)
        db.commit()
        rule_id = rule.id
    rebuild_daily_with_costs(db)
    return {"id": rule_id}


@router.delete("/cost-rules/{rule_id}")
def delete_cost_rule(rule_id: int, db: Session = Depends(get_db)):
    db.query(CsaCostRule).filter(CsaCostRule.id == rule_id).delete()
    db.commit()
    rebuild_daily_with_costs(db)
    return {"deleted": rule_id}


@router.get("/channel-monthly-costs")
def list_channel_monthly_costs(
    year: Optional[int] = None,
    channel_id: Optional[str] = None,
    cost_item_id: Optional[int] = None,
    db: Session = Depends(get_db),
):
    q = db.query(CsaChannelMonthlyCost)
    if year:
        q = q.filter(CsaChannelMonthlyCost.year == year)
    if channel_id:
        q = q.filter(CsaChannelMonthlyCost.channel_id == channel_id)
    if cost_item_id:
        q = q.filter(CsaChannelMonthlyCost.cost_item_id == cost_item_id)
    rows = q.order_by(CsaChannelMonthlyCost.year.desc(), CsaChannelMonthlyCost.month, CsaChannelMonthlyCost.channel_name).all()
    return [
        {
            "id": r.id, "year": r.year, "month": r.month,
            "channel_id": r.channel_id, "channel_name": r.channel_name,
            "cost_item_id": r.cost_item_id, "amount": r.amount,
            "notes": r.notes,
        } for r in rows
    ]


@router.post("/channel-monthly-costs")
def upsert_channel_monthly_cost(payload: ChannelMonthlyCostIn, db: Session = Depends(get_db)):
    existing = db.query(CsaChannelMonthlyCost).filter(
        CsaChannelMonthlyCost.year == payload.year,
        CsaChannelMonthlyCost.month == payload.month,
        CsaChannelMonthlyCost.channel_id == payload.channel_id,
        CsaChannelMonthlyCost.cost_item_id == payload.cost_item_id,
    ).first()
    if existing:
        existing.amount = payload.amount
        existing.channel_name = payload.channel_name
        existing.notes = payload.notes
        db.commit()
        eid = existing.id
    else:
        m = CsaChannelMonthlyCost(**payload.model_dump())
        db.add(m)
        db.commit()
        eid = m.id
    rebuild_daily_with_costs(db)
    return {"id": eid}


@router.delete("/channel-monthly-costs/{cost_id}")
def delete_channel_monthly_cost(cost_id: int, db: Session = Depends(get_db)):
    db.query(CsaChannelMonthlyCost).filter(CsaChannelMonthlyCost.id == cost_id).delete()
    db.commit()
    rebuild_daily_with_costs(db)
    return {"deleted": cost_id}


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
    employee_ids: Optional[str] = Query(None, description="콤마구분 employee_id (담당 채널로 변환)"),
    db: Session = Depends(get_db),
):
    q = db.query(ChannelSalesDailyProduct).filter(
        ChannelSalesDailyProduct.sale_date >= period_start,
        ChannelSalesDailyProduct.sale_date <= period_end,
    )

    # 채널 필터 (직원별 담당 채널 우선 합집합)
    selected_channels: set[str] = set()
    if channel_ids:
        selected_channels.update(s.strip() for s in channel_ids.split(",") if s.strip())
    if employee_ids:
        emp_id_list = [int(s) for s in employee_ids.split(",") if s.strip()]
        if emp_id_list:
            emp_channels = db.query(EmployeeChannelAssignment.channel_id).filter(
                EmployeeChannelAssignment.employee_id.in_(emp_id_list),
                EmployeeChannelAssignment.is_active.is_(True),
            ).all()
            for (cid,) in emp_channels:
                selected_channels.add(cid)
    if selected_channels:
        q = q.filter(ChannelSalesDailyProduct.channel_id.in_(list(selected_channels)))

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

    # 변동비 카테고리별 분해
    cost_breakdown = {
        "cogs": sum(r.cost_cogs or 0 for r in rows),
        "labor": sum(r.cost_labor or 0 for r in rows),
        "overhead": sum(r.cost_overhead or 0 for r in rows),
        "logistics_work": sum(r.cost_logistics_work or 0 for r in rows),
        "logistics_oh": sum(r.cost_logistics_oh or 0 for r in rows),
        "advertising": sum(r.cost_advertising or 0 for r in rows),
        "commission_rate": sum(r.cost_commission_rate or 0 for r in rows),
        "commission_fixed": sum(r.cost_commission_fixed or 0 for r in rows),
        "shipping": sum(r.cost_shipping or 0 for r in rows),
        "packaging": sum(r.cost_packaging or 0 for r in rows),
    }

    # 구분(그룹) 집계 — 3종 (온라인(위탁)/온라인(사입)/오프라인)
    group_map = {m.channel_id: m.group_id for m in db.query(ChannelGroupMembership).all()}
    group_names = {g.id: g.name for g in db.query(ChannelGroup).all()}
    by_group: dict = {}
    for r in rows:
        gname = group_names.get(group_map.get(r.channel_id)) or "미분류"
        slot = by_group.setdefault(gname, {
            "group": gname, "revenue": 0, "pcs": 0,
            "contribution_margin": 0, "orders": 0,
        })
        slot["revenue"] += r.net_sales or 0
        slot["pcs"] += r.pcs_qty or 0
        slot["orders"] += r.order_count or 0
        slot["contribution_margin"] += r.contribution_margin or 0
    groups_summary = sorted(by_group.values(), key=lambda x: -x["revenue"])
    for g in groups_summary:
        g["cm_rate"] = (g["contribution_margin"] / g["revenue"] * 100) if g["revenue"] else 0

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
            "avg_price_per_pcs": (total_revenue / total_pcs) if total_pcs else 0,
            "avg_price_per_order": (total_revenue / total_orders) if total_orders else 0,
        },
        "cost_breakdown": cost_breakdown,
        "series": series,
        "channels": channels_summary,
        "products": products_summary,
        "groups": groups_summary,
        "granularity": granularity,
        "period_start": period_start.isoformat(),
        "period_end": period_end.isoformat(),
    }


# ──────────────────────────────────────────────────────────────
# 직원 / 채널 그룹 / 담당 매핑
# ──────────────────────────────────────────────────────────────

class EmployeeIn(BaseModel):
    email: str
    name: str
    role: str = "staff"
    is_active: bool = True


class EmployeeChannelIn(BaseModel):
    employee_id: int
    channel_ids: list[str]


@router.get("/employees")
def list_employees(db: Session = Depends(get_db)):
    rows = db.query(Employee).order_by(Employee.role.desc(), Employee.name).all()
    # 채널 매핑도 같이 반환
    assignments = db.query(EmployeeChannelAssignment).all()
    by_emp: dict[int, list[dict]] = {}
    for a in assignments:
        by_emp.setdefault(a.employee_id, []).append({
            "channel_id": a.channel_id, "channel_name": a.channel_name,
            "is_active": a.is_active,
        })
    return [
        {
            "id": e.id, "email": e.email, "name": e.name,
            "role": e.role, "is_active": e.is_active,
            "channels": by_emp.get(e.id, []),
        } for e in rows
    ]


@router.post("/employees")
def upsert_employee(payload: EmployeeIn, db: Session = Depends(get_db)):
    existing = db.query(Employee).filter(Employee.email == payload.email).first()
    if existing:
        existing.name = payload.name
        existing.role = payload.role
        existing.is_active = payload.is_active
        db.commit()
        return {"id": existing.id, "updated": True}
    e = Employee(**payload.model_dump())
    db.add(e)
    db.commit()
    return {"id": e.id, "updated": False}


@router.delete("/employees/{emp_id}")
def delete_employee(emp_id: int, db: Session = Depends(get_db)):
    emp = db.query(Employee).filter(Employee.id == emp_id).first()
    if not emp:
        raise HTTPException(404, "employee not found")
    # 의존 데이터 먼저 해제
    db.query(EmployeeChannelAssignment).filter(
        EmployeeChannelAssignment.employee_id == emp_id
    ).delete(synchronize_session=False)
    # 사업계획 매출 행은 employee_id를 NULL로 (역사 보존)
    db.query(BusinessPlanChannelRevenue).filter(
        BusinessPlanChannelRevenue.employee_id == emp_id
    ).update(
        {"employee_id": None, "employee_name": None},
        synchronize_session=False,
    )
    db.commit()
    db.delete(emp)
    db.commit()
    return {"deleted": emp_id}


@router.post("/employees/assign")
def assign_employee_channels(payload: EmployeeChannelIn, db: Session = Depends(get_db)):
    # 기존 매핑 비활성화 후 새 매핑 추가/활성화
    db.query(EmployeeChannelAssignment).filter(
        EmployeeChannelAssignment.employee_id == payload.employee_id
    ).delete(synchronize_session=False)
    for ch_id in payload.channel_ids:
        ch = db.query(Channel).filter(Channel.id == ch_id).first()
        if not ch:
            continue
        db.add(EmployeeChannelAssignment(
            employee_id=payload.employee_id,
            channel_id=ch.id,
            channel_name=ch.name,
            is_active=True,
        ))
    db.commit()
    return {"employee_id": payload.employee_id, "channel_count": len(payload.channel_ids)}


@router.get("/groups")
def list_groups(db: Session = Depends(get_db)):
    rows = db.query(ChannelGroup).order_by(ChannelGroup.sort_order, ChannelGroup.id).all()
    memberships = db.query(ChannelGroupMembership).all()
    by_group: dict[int, list[dict]] = {}
    for m in memberships:
        by_group.setdefault(m.group_id, []).append({
            "channel_id": m.channel_id, "channel_name": m.channel_name,
        })
    return [
        {
            "id": g.id, "code": g.code, "name": g.name, "big_group": g.big_group,
            "channels": by_group.get(g.id, []),
        } for g in rows
    ]


class GroupAssignIn(BaseModel):
    channel_id: str
    group_id: int


@router.post("/groups/assign")
def assign_channel_group(payload: GroupAssignIn, db: Session = Depends(get_db)):
    ch = db.query(Channel).filter(Channel.id == payload.channel_id).first()
    if not ch:
        raise HTTPException(404, "channel not found")
    existing = db.query(ChannelGroupMembership).filter(
        ChannelGroupMembership.channel_id == payload.channel_id
    ).first()
    if existing:
        existing.group_id = payload.group_id
    else:
        db.add(ChannelGroupMembership(
            channel_id=payload.channel_id,
            channel_name=ch.name,
            group_id=payload.group_id,
        ))
    db.commit()
    return {"channel_id": payload.channel_id, "group_id": payload.group_id}


# ──────────────────────────────────────────────────────────────
# 사업계획 업로드 + 비교
# ──────────────────────────────────────────────────────────────

@router.post("/plan/upload")
async def upload_business_plan(
    year: int = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    suffix = os.path.splitext(file.filename or "")[1] or ".xlsx"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name
    try:
        batch = import_business_plan(
            db, tmp_path, file.filename or "business_plan.xlsx", year
        )
        return {
            "batch_id": batch.id,
            "year": batch.year,
            "status": batch.status,
            "revenue_rows": batch.revenue_rows,
            "qty_rows": batch.qty_rows,
            "category_rows": batch.category_rows,
            "summary_rows": batch.summary_rows,
            "notes": batch.notes,
        }
    finally:
        try:
            os.unlink(tmp_path)
        except Exception:
            pass


@router.get("/plan/summary")
def plan_summary(year: int, db: Session = Depends(get_db)):
    """사업계획 요약 (연간 총합)."""
    rev_total = db.query(func.sum(BusinessPlanChannelRevenue.target_revenue)).filter(
        BusinessPlanChannelRevenue.year == year
    ).scalar() or 0
    qty_total = db.query(func.sum(BusinessPlanProductQty.target_pcs)).filter(
        BusinessPlanProductQty.year == year
    ).scalar() or 0
    by_group_rev = db.query(
        BusinessPlanChannelRevenue.group_name,
        func.sum(BusinessPlanChannelRevenue.target_revenue),
    ).filter(BusinessPlanChannelRevenue.year == year).group_by(
        BusinessPlanChannelRevenue.group_name
    ).all()
    by_employee = db.query(
        BusinessPlanChannelRevenue.employee_id,
        BusinessPlanChannelRevenue.employee_name,
        func.sum(BusinessPlanChannelRevenue.target_revenue),
    ).filter(BusinessPlanChannelRevenue.year == year).group_by(
        BusinessPlanChannelRevenue.employee_id, BusinessPlanChannelRevenue.employee_name,
    ).all()
    return {
        "year": year,
        "total_revenue_target": rev_total,
        "total_pcs_target": qty_total,
        "by_group": [{"group": g or "미분류", "target_revenue": float(v or 0)} for g, v in by_group_rev],
        "by_employee": [
            {"employee_id": eid, "employee": en or "미배정", "target_revenue": float(v or 0)}
            for eid, en, v in by_employee
        ],
    }


@router.get("/plan/comparison")
def plan_comparison(
    year: int,
    month: Optional[int] = None,
    up_to_today: bool = False,
    by: str = Query("channel", regex="^(channel|product|group|employee|category)$"),
    db: Session = Depends(get_db),
):
    """사업계획 vs 실적 비교.

    실적: csa_sales_daily_product (해당 year/month, 또는 up_to_today=true면 1/1~오늘 누계)
    계획: csa_plan_* 테이블 (up_to_today=true면 1/1~오늘 비율 안분)

    공통 키: channel_id / product_id / group / employee / category
    """
    from datetime import date as _date
    from calendar import monthrange as _monthrange
    today = _date.today()
    # YTD 모드: 해당 연도 1/1~오늘 (해당 연도가 미래/과거면 12/31 또는 미적용)
    ytd_last_month = None
    ytd_partial_ratio = 1.0  # 마지막 월 안분 비율
    if up_to_today:
        if year < today.year:
            ytd_last_month = 12
            ytd_partial_ratio = 1.0
        elif year > today.year:
            ytd_last_month = 0  # 데이터 없음
        else:
            ytd_last_month = today.month
            month_days = _monthrange(year, today.month)[1]
            ytd_partial_ratio = today.day / month_days

    # 실적 집계
    actual_q = db.query(ChannelSalesDailyProduct).filter(
        ChannelSalesDailyProduct.year == year
    )
    if up_to_today:
        actual_q = actual_q.filter(ChannelSalesDailyProduct.sale_date <= today)
    elif month:
        actual_q = actual_q.filter(ChannelSalesDailyProduct.month == month)
    actual_rows = actual_q.all()

    # 채널-그룹/직원 매핑
    group_map = {m.channel_id: m.group_id for m in db.query(ChannelGroupMembership).all()}
    group_names = {g.id: g.name for g in db.query(ChannelGroup).all()}
    emp_channel = {}  # channel_id -> [(emp_id, emp_name)]
    for a in db.query(EmployeeChannelAssignment).filter(EmployeeChannelAssignment.is_active.is_(True)).all():
        emp_channel.setdefault(a.channel_id, []).append((a.employee_id, ""))
    emp_names = {e.id: e.name for e in db.query(Employee).all()}
    prod_categories = {p.id: p.category for p in db.query(ProductMaster).all()}

    def key_actual(r):
        if by == "channel":
            return (r.channel_id, r.channel_name)
        if by == "product":
            return (r.product_id, r.product_name)
        if by == "group":
            gid = group_map.get(r.channel_id)
            return (gid, group_names.get(gid, "미분류"))
        if by == "employee":
            emps = emp_channel.get(r.channel_id, [])
            if not emps:
                return ("unassigned", "미배정")
            eid, _ = emps[0]
            return (eid, emp_names.get(eid, ""))
        if by == "category":
            return (prod_categories.get(r.product_id) or "-", prod_categories.get(r.product_id) or "-")

    actual_map: dict = {}
    for r in actual_rows:
        k = key_actual(r)
        if k is None or k[0] is None:
            continue
        slot = actual_map.setdefault(k, {
            "key": k[0], "label": k[1],
            "actual_revenue": 0, "actual_pcs": 0,
            "target_revenue": 0, "target_pcs": 0,
        })
        slot["actual_revenue"] += r.net_sales or 0
        slot["actual_pcs"] += r.pcs_qty or 0

    def plan_factor(m: int) -> Optional[float]:
        """up_to_today 모드: 미래 월은 None(제외), 현재 월은 비율 안분, 과거 월은 1.0.
        평시: month 필터 매칭 시 1.0, 아니면 None."""
        if up_to_today:
            if ytd_last_month is None or ytd_last_month == 0:
                return None
            if m > ytd_last_month: return None
            if m == ytd_last_month: return ytd_partial_ratio
            return 1.0
        if month is not None:
            return 1.0 if m == month else None
        return 1.0

    # 계획 데이터
    if by == "channel":
        for p in db.query(BusinessPlanChannelRevenue).filter(BusinessPlanChannelRevenue.year == year).all():
            f = plan_factor(p.month)
            if f is None: continue
            k = (p.channel_id, p.channel_name)
            slot = actual_map.setdefault(k, {
                "key": k[0], "label": k[1],
                "actual_revenue": 0, "actual_pcs": 0,
                "target_revenue": 0, "target_pcs": 0,
            })
            slot["target_revenue"] += (p.target_revenue or 0) * f
        for p in db.query(BusinessPlanProductQty).filter(BusinessPlanProductQty.year == year).all():
            f = plan_factor(p.month)
            if f is None: continue
            k = (p.channel_id, p.channel_name)
            slot = actual_map.setdefault(k, {
                "key": k[0], "label": k[1],
                "actual_revenue": 0, "actual_pcs": 0,
                "target_revenue": 0, "target_pcs": 0,
            })
            slot["target_pcs"] += (p.target_pcs or 0) * f
    elif by == "product":
        for p in db.query(BusinessPlanProductQty).filter(BusinessPlanProductQty.year == year).all():
            f = plan_factor(p.month)
            if f is None or p.product_id is None: continue
            k = (p.product_id, p.product_name)
            slot = actual_map.setdefault(k, {
                "key": k[0], "label": k[1],
                "actual_revenue": 0, "actual_pcs": 0,
                "target_revenue": 0, "target_pcs": 0,
            })
            slot["target_pcs"] += (p.target_pcs or 0) * f
    elif by == "group":
        for p in db.query(BusinessPlanChannelRevenue).filter(BusinessPlanChannelRevenue.year == year).all():
            f = plan_factor(p.month)
            if f is None or p.group_id is None: continue
            k = (p.group_id, p.group_name)
            slot = actual_map.setdefault(k, {
                "key": k[0], "label": k[1],
                "actual_revenue": 0, "actual_pcs": 0,
                "target_revenue": 0, "target_pcs": 0,
            })
            slot["target_revenue"] += (p.target_revenue or 0) * f
    elif by == "employee":
        for p in db.query(BusinessPlanChannelRevenue).filter(BusinessPlanChannelRevenue.year == year).all():
            f = plan_factor(p.month)
            if f is None or p.employee_id is None: continue
            k = (p.employee_id, p.employee_name)
            slot = actual_map.setdefault(k, {
                "key": k[0], "label": k[1],
                "actual_revenue": 0, "actual_pcs": 0,
                "target_revenue": 0, "target_pcs": 0,
            })
            slot["target_revenue"] += (p.target_revenue or 0) * f
    elif by == "category":
        for p in db.query(BusinessPlanCategoryQty).filter(BusinessPlanCategoryQty.year == year).all():
            f = plan_factor(p.month)
            if f is None: continue
            k = (p.product_category, p.product_category)
            slot = actual_map.setdefault(k, {
                "key": k[0], "label": k[1],
                "actual_revenue": 0, "actual_pcs": 0,
                "target_revenue": 0, "target_pcs": 0,
            })
            slot["target_pcs"] += (p.target_pcs or 0) * f

    items = list(actual_map.values())
    for it in items:
        it["rev_ach"] = (it["actual_revenue"] / it["target_revenue"] * 100) if it["target_revenue"] else None
        it["pcs_ach"] = (it["actual_pcs"] / it["target_pcs"] * 100) if it["target_pcs"] else None
        # 객단가
        it["actual_avg_price"] = (it["actual_revenue"] / it["actual_pcs"]) if it["actual_pcs"] else 0
        it["target_avg_price"] = (it["target_revenue"] / it["target_pcs"]) if it["target_pcs"] else 0
    items.sort(key=lambda x: -(x["target_revenue"] or 0))
    return {"year": year, "month": month, "by": by, "items": items}


# ──────────────────────────────────────────────────────────────
# P&L 월별 매트릭스
# ──────────────────────────────────────────────────────────────

class PnlValueIn(BaseModel):
    year: int
    month: int
    row_id: int
    scope: str = "actual"  # 'actual' | 'plan'
    value: float
    password: Optional[str] = None
    user_email: Optional[str] = None


class PnlRowIn(BaseModel):
    parent_id: int
    label: str
    password: Optional[str] = None


class PnlPasswordIn(BaseModel):
    new_password: str
    user_email: str


class PnlVerifyIn(BaseModel):
    password: str


@router.get("/pnl")
def pnl_matrix(year: int, db: Session = Depends(get_db)):
    return get_pnl_matrix(db, year)


@router.post("/pnl/value")
def pnl_save_value(payload: PnlValueIn, db: Session = Depends(get_db)):
    # 비밀번호 검증 (비밀번호 미설정 상태에서는 OWNER만 저장 가능)
    if not is_password_set(db):
        if not (payload.user_email and can_set_password(payload.user_email)):
            raise HTTPException(403, "P&L 수정 비밀번호가 설정되지 않았습니다. 직원·채널 관리 탭에서 먼저 설정하세요.")
    else:
        if not payload.password or not verify_password(db, payload.password):
            raise HTTPException(403, "비밀번호가 일치하지 않습니다")

    if payload.scope not in ("actual", "plan"):
        raise HTTPException(400, "scope must be 'actual' or 'plan'")
    vid = upsert_value(
        db, year=payload.year, month=payload.month, row_id=payload.row_id,
        scope=payload.scope, value=payload.value, updated_by=payload.user_email,
    )
    return {"id": vid}


@router.post("/pnl/row")
def pnl_add_row(payload: PnlRowIn, db: Session = Depends(get_db)):
    if not is_password_set(db):
        raise HTTPException(403, "P&L 비밀번호가 설정되지 않았습니다")
    if not payload.password or not verify_password(db, payload.password):
        raise HTTPException(403, "비밀번호가 일치하지 않습니다")
    try:
        rid = add_custom_row(db, parent_id=payload.parent_id, label=payload.label, section="custom")
    except Exception as e:
        raise HTTPException(400, str(e))
    return {"id": rid}


@router.delete("/pnl/row/{row_id}")
def pnl_delete_row(row_id: int, password: str, db: Session = Depends(get_db)):
    if not verify_password(db, password):
        raise HTTPException(403, "비밀번호가 일치하지 않습니다")
    try:
        ok = delete_row(db, row_id)
    except Exception as e:
        raise HTTPException(400, str(e))
    return {"deleted": ok, "row_id": row_id}


@router.get("/pnl/password-status")
def pnl_password_status(db: Session = Depends(get_db)):
    return {
        "is_set": is_password_set(db),
        "owner_email": OWNER_EMAIL,
    }


@router.post("/pnl/password")
def pnl_set_password(payload: PnlPasswordIn, db: Session = Depends(get_db)):
    try:
        set_password(db, new_password=payload.new_password, current_user=payload.user_email)
    except PermissionError as e:
        raise HTTPException(403, str(e))
    return {"ok": True}


@router.post("/pnl/verify")
def pnl_verify(payload: PnlVerifyIn, db: Session = Depends(get_db)):
    return {"ok": verify_password(db, payload.password)}


# ──────────────────────────────────────────────────────────────
# 저장 효율화 (Phase 3) — retention + 월 파티션
# ──────────────────────────────────────────────────────────────

@router.get("/admin/storage")
def admin_storage(db: Session = Depends(get_db)):
    """저장소 상태 조회."""
    return get_storage_status(db)


@router.post("/admin/setup-retention")
def admin_setup_retention(db: Session = Depends(get_db)):
    """보존 함수 + pg_cron 스케줄 등록 (멱등)."""
    funcs = setup_retention_functions(db)
    cron_res = setup_pg_cron_schedules(db)
    return {"functions": funcs, "cron": cron_res}


@router.post("/admin/migrate-partitions")
def admin_migrate_partitions(db: Session = Depends(get_db)):
    """1회성: csa_sales_raw_lines를 월 파티션 테이블로 전환.

    멱등하며 데이터 보존. 운영 중에는 짧은 lock 발생 가능.
    """
    return migrate_to_partitions(db)


@router.post("/admin/run-retention-now")
def admin_run_retention_now(db: Session = Depends(get_db)):
    """수동으로 retention 1회 실행 (스케줄 외 즉시)."""
    return run_retention_now(db)


@router.get("/admin/diag-batches")
def admin_diag_batches(limit: int = 50, db: Session = Depends(get_db)):
    """업로드 batch 상태 진단.

    1) status별 카운트
    2) parsing/failed batch 상세 + 그 batch의 raw_lines 적재 수
    3) done batch 중 daily_aggregate가 비어 있는 케이스 (재집계 필요)
    """
    from sqlalchemy import func as sa_func
    counts = dict(
        db.query(
            ChannelSalesUploadBatch.status,
            sa_func.count(ChannelSalesUploadBatch.id),
        ).group_by(ChannelSalesUploadBatch.status).all()
    )

    # parsing / failed 상세
    stuck = (
        db.query(ChannelSalesUploadBatch)
        .filter(ChannelSalesUploadBatch.status.in_(["parsing", "failed"]))
        .order_by(ChannelSalesUploadBatch.created_at.desc())
        .limit(limit).all()
    )
    stuck_rows = []
    for b in stuck:
        raw_count = db.query(sa_func.count(ChannelSalesRawLine.id)).filter(
            ChannelSalesRawLine.batch_id == b.id
        ).scalar() or 0
        stuck_rows.append({
            "id": b.id, "status": b.status,
            "channel": b.channel_name, "file_name": b.file_name,
            "file_size": b.file_size,
            "created_at": b.created_at.isoformat() if b.created_at else None,
            "row_total": b.row_total, "row_inserted": b.row_inserted,
            "raw_lines_in_db": raw_count,
            "error_message": (b.error_message or "")[:300],
        })

    # done batch 중 daily_aggregate 비어 있는 케이스
    done_batches = (
        db.query(ChannelSalesUploadBatch)
        .filter(ChannelSalesUploadBatch.status == "done")
        .order_by(ChannelSalesUploadBatch.created_at.desc())
        .limit(limit).all()
    )
    done_empty = []
    for b in done_batches:
        if not b.period_start or not b.period_end:
            continue
        daily_count = db.query(sa_func.count(ChannelSalesDailyProduct.id)).filter(
            ChannelSalesDailyProduct.channel_id == b.channel_id,
            ChannelSalesDailyProduct.sale_date >= b.period_start,
            ChannelSalesDailyProduct.sale_date <= b.period_end,
        ).scalar() or 0
        raw_matched = db.query(sa_func.count(ChannelSalesRawLine.id)).filter(
            ChannelSalesRawLine.batch_id == b.id,
            ChannelSalesRawLine.mapping_status == "matched",
        ).scalar() or 0
        if daily_count == 0 and raw_matched > 0:
            done_empty.append({
                "id": b.id, "channel": b.channel_name, "file_name": b.file_name,
                "period": f"{b.period_start}~{b.period_end}",
                "row_inserted": b.row_inserted,
                "raw_matched": raw_matched,
                "daily_aggregate_count": daily_count,
            })

    return {
        "status_counts": counts,
        "stuck_batches": stuck_rows,
        "done_but_empty_daily": done_empty,
    }


@router.post("/admin/cleanup-stuck-batches")
def admin_cleanup_stuck_batches(
    mode: str = "delete",  # delete | mark_failed
    include_done_zero: bool = True,
    cleanup_orphans: bool = True,
    db: Session = Depends(get_db),
):
    """업로드 batch 비정상 상태 종합 정리.

    대상:
    1) status='parsing' 잔존 batch
    2) include_done_zero=True: status='done'인데 row_total=0인 비정상 batch
    3) cleanup_orphans=True: 어떤 batch에도 연결되지 않은 orphan raw_lines

    - mode=delete: batch 완전 삭제 (raw_lines도 함께)
    - mode=mark_failed: status를 failed로 변경 (이력 보존, raw_lines는 그대로)
    """
    from sqlalchemy import func as sa_func
    targets = list(db.query(ChannelSalesUploadBatch).filter(
        ChannelSalesUploadBatch.status == "parsing"
    ).all())
    if include_done_zero:
        targets += list(db.query(ChannelSalesUploadBatch).filter(
            ChannelSalesUploadBatch.status == "done",
            (ChannelSalesUploadBatch.row_total == 0) | (ChannelSalesUploadBatch.row_total.is_(None)),
        ).all())

    deleted_batches = 0
    marked_failed = 0
    deleted_raw = 0
    details = []
    for b in targets:
        raw_count = db.query(sa_func.count(ChannelSalesRawLine.id)).filter(
            ChannelSalesRawLine.batch_id == b.id
        ).scalar() or 0
        if mode == "delete":
            if raw_count > 0:
                db.query(ChannelSalesRawLine).filter(
                    ChannelSalesRawLine.batch_id == b.id
                ).delete(synchronize_session=False)
                deleted_raw += raw_count
            details.append({"id": b.id, "status_was": b.status, "channel": b.channel_name, "file": b.file_name, "action": "deleted", "raw_lines": raw_count})
            db.delete(b)
            deleted_batches += 1
        else:
            b.status = "failed"
            b.error_message = b.error_message or "cleanup: 비정상 상태 → failed 마킹"
            details.append({"id": b.id, "channel": b.channel_name, "file": b.file_name, "action": "marked_failed", "raw_lines": raw_count})
            marked_failed += 1
    db.commit()

    orphan_deleted = 0
    if cleanup_orphans:
        # batch_id가 더 이상 csa_upload_batches에 없는 raw_lines
        valid_ids_subq = db.query(ChannelSalesUploadBatch.id).subquery()
        orphan_q = db.query(ChannelSalesRawLine).filter(
            ~ChannelSalesRawLine.batch_id.in_(db.query(valid_ids_subq.c.id))
        )
        orphan_deleted = orphan_q.count()
        if orphan_deleted > 0:
            orphan_q.delete(synchronize_session=False)
            db.commit()

    return {
        "deleted_batches": deleted_batches,
        "marked_failed": marked_failed,
        "deleted_raw_lines": deleted_raw + orphan_deleted,
        "orphan_raw_lines_deleted": orphan_deleted,
        "details": details,
    }


@router.post("/admin/delete-batch/{batch_id}")
def admin_delete_batch(batch_id: str, db: Session = Depends(get_db)):
    """특정 batch 완전 삭제: raw_lines + daily_aggregate(그 채널/기간) + unmatched(그 채널의 pending) + batch row."""
    b = db.query(ChannelSalesUploadBatch).filter(ChannelSalesUploadBatch.id == batch_id).first()
    if not b:
        raise HTTPException(404, "batch not found")
    # raw_lines 삭제
    raw_deleted = db.query(ChannelSalesRawLine).filter(
        ChannelSalesRawLine.batch_id == batch_id
    ).delete(synchronize_session=False)
    # daily_aggregate(그 채널의 batch 기간) 삭제
    daily_deleted = 0
    if b.period_start and b.period_end:
        daily_deleted = db.query(ChannelSalesDailyProduct).filter(
            ChannelSalesDailyProduct.channel_id == b.channel_id,
            ChannelSalesDailyProduct.sale_date >= b.period_start,
            ChannelSalesDailyProduct.sale_date <= b.period_end,
        ).delete(synchronize_session=False)
    # 해당 채널의 unmatched pending 모두 삭제 (다시 빌드 시 새로 생성됨)
    unmatched_deleted = db.query(ChannelUnmatchedProduct).filter(
        ChannelUnmatchedProduct.channel_id == b.channel_id,
        ChannelUnmatchedProduct.status == "pending",
    ).delete(synchronize_session=False)
    db.delete(b)
    db.commit()
    # 남은 batch가 있다면 daily_aggregate 재구성
    other_batches = db.query(ChannelSalesUploadBatch).filter(
        ChannelSalesUploadBatch.channel_id == b.channel_id,
        ChannelSalesUploadBatch.status == "done",
    ).count()
    if other_batches > 0:
        rebuild_daily_aggregate(db, channel_id=b.channel_id)
    return {
        "deleted_batch": batch_id,
        "channel": b.channel_name,
        "raw_lines_deleted": raw_deleted,
        "daily_aggregate_deleted": daily_deleted,
        "unmatched_pending_deleted": unmatched_deleted,
    }


@router.post("/admin/dedup-unmatched")
def admin_dedup_unmatched(db: Session = Depends(get_db)):
    """매핑 큐 정규화: 옵션 공백/nan/빈문자 → NULL로 통일, 중복 row 병합."""
    from sqlalchemy import func as sa_func
    # 1) 옵션 정규화 (공백, 'nan', 'None', 빈 문자열 → NULL)
    affected = db.query(ChannelUnmatchedProduct).filter(
        ChannelUnmatchedProduct.status == "pending"
    ).all()
    normalized = 0
    for u in affected:
        raw = u.raw_option_name
        if raw is None:
            continue
        s = str(raw).strip()
        if not s or s.lower() in ("nan", "none", "null"):
            u.raw_option_name = None
            normalized += 1
        elif raw != s:
            u.raw_option_name = s
            normalized += 1
    db.commit()

    # 2) 중복 병합: 같은 (channel_id, raw_product_name, raw_option_name) → 첫 row에 합산, 나머지 삭제
    duplicates_query = db.query(
        ChannelUnmatchedProduct.channel_id,
        ChannelUnmatchedProduct.raw_product_name,
        ChannelUnmatchedProduct.raw_option_name,
        sa_func.count(ChannelUnmatchedProduct.id),
    ).filter(
        ChannelUnmatchedProduct.status == "pending"
    ).group_by(
        ChannelUnmatchedProduct.channel_id,
        ChannelUnmatchedProduct.raw_product_name,
        ChannelUnmatchedProduct.raw_option_name,
    ).having(sa_func.count(ChannelUnmatchedProduct.id) > 1).all()

    merged = 0
    for ch_id, name, opt, cnt in duplicates_query:
        q = db.query(ChannelUnmatchedProduct).filter(
            ChannelUnmatchedProduct.channel_id == ch_id,
            ChannelUnmatchedProduct.raw_product_name == name,
            ChannelUnmatchedProduct.status == "pending",
        )
        if opt is None:
            rows = q.filter(ChannelUnmatchedProduct.raw_option_name.is_(None)).order_by(ChannelUnmatchedProduct.id).all()
        else:
            rows = q.filter(ChannelUnmatchedProduct.raw_option_name == opt).order_by(ChannelUnmatchedProduct.id).all()
        if len(rows) <= 1:
            continue
        keeper = rows[0]
        for dup in rows[1:]:
            keeper.occurrence_count = (keeper.occurrence_count or 0) + (dup.occurrence_count or 0)
            keeper.total_qty = (keeper.total_qty or 0) + (dup.total_qty or 0)
            db.delete(dup)
            merged += 1
    db.commit()
    return {"normalized_options": normalized, "merged_duplicates": merged}


@router.get("/admin/diag-channel-data")
def admin_diag_channel_data(channel_id: Optional[str] = None, db: Session = Depends(get_db)):
    """채널별 raw_lines / batches 상태 종합 진단.

    - 각 채널의 batch 카운트(상태별)
    - 각 채널의 raw_lines 카운트 + dedup_hash 중복 의심 그룹
    """
    from sqlalchemy import func as sa_func
    chs = db.query(Channel)
    if channel_id:
        chs = chs.filter(Channel.id == channel_id)
    out = []
    for ch in chs.all():
        batches_by_status = dict(
            db.query(
                ChannelSalesUploadBatch.status,
                sa_func.count(ChannelSalesUploadBatch.id),
            ).filter(ChannelSalesUploadBatch.channel_id == ch.id)
            .group_by(ChannelSalesUploadBatch.status).all()
        )
        raw_count = db.query(sa_func.count(ChannelSalesRawLine.id)).filter(
            ChannelSalesRawLine.channel_id == ch.id
        ).scalar() or 0
        if sum(batches_by_status.values()) == 0 and raw_count == 0:
            continue
        out.append({
            "channel_id": ch.id,
            "channel_name": ch.name,
            "batches": batches_by_status,
            "raw_lines_total": raw_count,
        })
    return out


@router.post("/admin/rebuild-daily/{batch_id}")
def admin_rebuild_daily(batch_id: str, db: Session = Depends(get_db)):
    """특정 batch 기간의 daily_aggregate를 재계산."""
    b = db.query(ChannelSalesUploadBatch).filter(ChannelSalesUploadBatch.id == batch_id).first()
    if not b:
        raise HTTPException(404, "batch not found")
    if not b.period_start or not b.period_end:
        raise HTTPException(400, "batch has no period")
    n = rebuild_daily_aggregate(
        db, channel_id=b.channel_id,
        since=b.period_start, until=b.period_end,
    )
    return {"batch_id": batch_id, "rows_rebuilt": n}


@router.post("/admin/rebuild-daily-all")
def admin_rebuild_daily_all(db: Session = Depends(get_db)):
    """모든 채널·모든 기간의 daily_aggregate를 통째로 재계산.

    코드 변경(예: unmatched 포함, unit_per_set 환산 변경)이 있을 때 호출.
    raw_lines는 그대로 두고 ChannelSalesDailyProduct만 다시 build.
    """
    n = rebuild_daily_aggregate(db)
    return {"rows_rebuilt": n}


@router.get("/admin/diag-pnl-plan")
def admin_diag_pnl_plan(year: int = 2026, db: Session = Depends(get_db)):
    """P&L plan 진단: 어떤 데이터가 비어서 0이 되는지 핀포인트.

    각 leaf row의 plan 값과, 그 산출에 쓰인 원천 데이터 카운트를 함께 반환.
    """
    from sqlalchemy import func as sa_func
    from app.services.csa_pnl_service import compute_plan

    sources = {
        "BusinessPlanChannelRevenue": db.query(sa_func.count(BusinessPlanChannelRevenue.id)).filter_by(year=year).scalar() or 0,
        "BusinessPlanProductQty": db.query(sa_func.count(BusinessPlanProductQty.id)).filter_by(year=year).scalar() or 0,
        "BusinessPlanGroupSummary": db.query(sa_func.count(BusinessPlanGroupSummary.id)).filter_by(year=year).scalar() or 0,
        "CsaCostItem(active)": db.query(sa_func.count(CsaCostItem.id)).filter_by(is_active=True).scalar() or 0,
        "CsaCostRule(active)": db.query(sa_func.count(CsaCostRule.id)).filter_by(is_active=True).scalar() or 0,
        "CsaChannelMonthlyCost": db.query(sa_func.count(CsaChannelMonthlyCost.id)).filter_by(year=year).scalar() or 0,
    }
    # 그룹별 cm 합 (target_cm 채워졌는지)
    cm_total = 0
    try:
        cm_total = float(db.query(sa_func.sum(BusinessPlanGroupSummary.target_cm)).filter_by(year=year).scalar() or 0)
    except Exception as e:
        cm_total = f"error: {e}"

    rev_total = float(db.query(sa_func.sum(BusinessPlanChannelRevenue.target_revenue)).filter_by(year=year).scalar() or 0)
    # '대시보드' 시트 기반 매출 합 (BusinessPlanGroupSummary)
    rev_group_total = float(db.query(sa_func.sum(BusinessPlanGroupSummary.target_revenue)).filter_by(year=year).scalar() or 0)

    # 월별 매출 비교 (두 시트가 동일해야 정상)
    monthly_compare = []
    for m in range(1, 13):
        ch_m = float(db.query(sa_func.sum(BusinessPlanChannelRevenue.target_revenue)).filter_by(year=year, month=m).scalar() or 0)
        gp_m = float(db.query(sa_func.sum(BusinessPlanGroupSummary.target_revenue)).filter_by(year=year, month=m).scalar() or 0)
        monthly_compare.append({
            "month": m,
            "channel_revenue_sheet": ch_m,
            "group_summary_sheet": gp_m,
            "diff": ch_m - gp_m,
        })

    try:
        plan = compute_plan(db, year)
        plan_by_key = {}
        for k in {key[0] for key in plan}:
            plan_by_key[k] = {f"m{m}": plan.get((k, m), 0) for m in range(1, 13)}
            plan_by_key[k]["sum"] = sum(plan.get((k, m), 0) for m in range(1, 13))
    except Exception as e:
        plan_by_key = {"error": f"{type(e).__name__}: {e}"}

    # 변동비 rule별 카운트 (어떤 코드가 비어있는지)
    items = {it.id: it.code for it in db.query(CsaCostItem).all()}
    rule_counts = {}
    for r in db.query(CsaCostRule).filter_by(is_active=True).all():
        code = items.get(r.cost_item_id, "?")
        rule_counts[code] = rule_counts.get(code, 0) + 1

    return {
        "year": year,
        "data_sources": sources,
        "totals": {
            "channel_revenue_sheet_year": rev_total,
            "group_summary_sheet_revenue_year": rev_group_total,
            "group_summary_sheet_cm_year": cm_total,
        },
        "monthly_revenue_comparison": monthly_compare,
        "cost_rule_counts_by_code": rule_counts,
        "compute_plan": plan_by_key,
        "_note": (
            "compute_plan.revenue 값은 channel_revenue_sheet 합계 기반. "
            "사업계획 엑셀의 '대시보드' 시트 합계는 group_summary_sheet에 들어감. "
            "둘이 다르면 시트 간 합산 차이. "
            "공헌이익 plan은 group_summary.target_cm이 0이면 0으로 표시됨 (사업계획 재import 필요)."
        ),
    }


@router.post("/admin/migrate-pnl-plan-cm")
def admin_migrate_pnl_plan_cm(year: int = 2026, db: Session = Depends(get_db)):
    """target_cm/cm_share 컬럼 강제 추가 + 현재 plan/group summary 진단.

    1) ALTER TABLE ADD COLUMN IF NOT EXISTS — 멱등
    2) BusinessPlanGroupSummary 데이터 진단 (월별 cm 합계 등)
    3) get_pnl_matrix의 plan 컬럼 표시값 미리보기
    """
    from sqlalchemy import text
    from app.db_models import BusinessPlanGroupSummary
    from app.services.csa_pnl_service import compute_plan

    alter_result = {}
    try:
        with db.bind.connect() as conn:
            conn.execute(text(
                "ALTER TABLE csa_plan_group_summary ADD COLUMN IF NOT EXISTS target_cm DOUBLE PRECISION DEFAULT 0"
            ))
            conn.execute(text(
                "ALTER TABLE csa_plan_group_summary ADD COLUMN IF NOT EXISTS cm_share DOUBLE PRECISION"
            ))
            conn.commit()
        alter_result["status"] = "ok"
    except Exception as e:
        alter_result["status"] = "failed"
        alter_result["error"] = str(e)

    rows = db.query(BusinessPlanGroupSummary).filter_by(year=year).all()
    by_month: dict[int, dict] = {}
    for r in rows:
        b = by_month.setdefault(r.month, {"revenue": 0, "marketing": 0, "cm": 0, "groups": []})
        b["revenue"] += float(r.target_revenue or 0)
        b["marketing"] += float(r.target_marketing or 0)
        b["cm"] += float(getattr(r, "target_cm", 0) or 0)
        b["groups"].append({
            "group": r.group_name,
            "revenue": float(r.target_revenue or 0),
            "marketing": float(r.target_marketing or 0),
            "cm": float(getattr(r, "target_cm", 0) or 0),
        })

    try:
        plan = compute_plan(db, year)
        plan_preview = {
            f"month_{m}": {
                "revenue": plan.get(("revenue", m), 0),
                "advertising": plan.get(("advertising", m), 0),
                "contribution_margin": plan.get(("contribution_margin", m), 0),
            } for m in range(1, 13)
        }
    except Exception as e:
        plan_preview = {"error": str(e)}

    return {
        "year": year,
        "alter": alter_result,
        "group_summary_count": len(rows),
        "monthly_totals": by_month,
        "compute_plan_preview": plan_preview,
    }


# ──────────────────────────────────────────────────────────────
# 객단가 분석
# ──────────────────────────────────────────────────────────────

@router.get("/avg-price")
def avg_price_analysis(
    period_start: date,
    period_end: date,
    by: str = Query("channel_product", regex="^(channel|product|channel_product|group)$"),
    db: Session = Depends(get_db),
):
    """객단가(매출/낱개) 분석. 실적 기준."""
    rows = db.query(ChannelSalesDailyProduct).filter(
        ChannelSalesDailyProduct.sale_date >= period_start,
        ChannelSalesDailyProduct.sale_date <= period_end,
    ).all()
    group_map = {m.channel_id: m.group_id for m in db.query(ChannelGroupMembership).all()}
    group_names = {g.id: g.name for g in db.query(ChannelGroup).all()}

    bucket: dict = {}
    for r in rows:
        if by == "channel":
            k = (r.channel_id, r.channel_name)
        elif by == "product":
            if r.product_id is None: continue
            k = (r.product_id, r.product_name)
        elif by == "group":
            gid = group_map.get(r.channel_id)
            k = (gid or "x", group_names.get(gid, "미분류"))
        else:  # channel_product
            if r.product_id is None: continue
            k = (f"{r.channel_id}_{r.product_id}", f"{r.channel_name} × {r.product_name}")
        slot = bucket.setdefault(k, {
            "key": k[0], "label": k[1],
            "revenue": 0, "pcs": 0, "orders": 0,
        })
        slot["revenue"] += r.net_sales or 0
        slot["pcs"] += r.pcs_qty or 0
        slot["orders"] += r.order_count or 0

    items = list(bucket.values())
    for it in items:
        it["avg_price_per_pcs"] = (it["revenue"] / it["pcs"]) if it["pcs"] else 0
        it["avg_price_per_order"] = (it["revenue"] / it["orders"]) if it["orders"] else 0
    items.sort(key=lambda x: -x["revenue"])
    return {"by": by, "period_start": period_start.isoformat(),
            "period_end": period_end.isoformat(), "items": items[:200]}
