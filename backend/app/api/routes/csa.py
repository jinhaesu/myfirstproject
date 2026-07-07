"""채널별 매출 취합(CSA) API."""
from __future__ import annotations

import logging
import os
import tempfile
from datetime import date, datetime
from typing import List, Optional

from fastapi import APIRouter, BackgroundTasks, Body, Depends, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel
from sqlalchemy import func, and_, or_
from sqlalchemy.orm import Session

from app.database import get_db
from app.db_models import (
    Channel,
    ProductMaster,
    ChannelProductMapping,
    ChannelProductMappingComponent,
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
    CsaUploadFile,
)
from app.services.csa_service import (
    seed_product_master,
    seed_channels,
    seed_channel_products,
    ingest_lines,
    rebuild_daily_aggregate,
    resolve_product,
    normalize_channel_name,
    split_by_units,
    compute_dedup_hash,
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
    aliases: Optional[list] = None  # 별칭 (영문 채널 매칭 포함)

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


# ──────────────────────────────────────────────────────────────
# Bootstrap (모든 master endpoint 통합 + 60s 메모리 캐시)
# ──────────────────────────────────────────────────────────────

import time as _btime
_BOOT_CACHE: dict = {"data": None, "expires": 0.0}
_BOOT_TTL_SEC = 300  # master 데이터는 자주 안 바뀜 — 업로드/수정 시 _bust_bootstrap_cache()로 무효화


@router.get("/bootstrap")
def bootstrap(force: bool = False, db: Session = Depends(get_db)):
    """전체 master 데이터 단일 응답 — channels/products/groups/cost-items/variable-costs/employees/batches/unmatched.

    frontend의 fetchAll 6 라운드트립 → 1 라운드트립으로 압축.
    30초 TTL 메모리 캐시: 같은 인스턴스 내 다음 호출은 DB hit 없이 즉시 반환.
    force=true로 캐시 무시 가능.
    """
    now = _btime.time()
    if not force and _BOOT_CACHE["data"] and _BOOT_CACHE["expires"] > now:
        return {**_BOOT_CACHE["data"], "_cached": True, "_ttl_left": int(_BOOT_CACHE["expires"] - now)}

    parsers = set(registered_channels())
    channels = [
        {"id": c.id, "name": c.name, "category": c.category,
         "integration_type": c.integration_type, "is_active": c.is_active,
         "has_parser": c.name in parsers}
        for c in db.query(Channel).order_by(Channel.category, Channel.name).all()
    ]
    products = [
        {"id": p.id, "code": p.code, "name": p.name, "category": p.category,
         "default_unit_size": p.default_unit_size, "is_active": p.is_active,
         "sort_order": p.sort_order}
        for p in db.query(ProductMaster).filter(ProductMaster.is_active.is_(True))
                  .order_by(ProductMaster.sort_order, ProductMaster.id).all()
    ]
    groups = [
        {"id": g.id, "code": g.code, "name": g.name, "big_group": g.big_group,
         "channels": []}
        for g in db.query(ChannelGroup).order_by(ChannelGroup.id).all()
    ]
    cost_items = [
        {"id": ci.id, "code": ci.code, "name": ci.name, "category": ci.category,
         "basis": ci.basis, "description": ci.description,
         "is_active": ci.is_active, "sort_order": ci.sort_order}
        for ci in db.query(__import__('app.db_models', fromlist=['CsaCostItem']).CsaCostItem)
                    .order_by('sort_order').all()
    ]
    variable_costs = [
        {"id": v.id, "product_id": v.product_id, "channel_id": v.channel_id,
         "cost_per_pcs": v.cost_per_pcs, "valid_from": v.valid_from.isoformat() if v.valid_from else None,
         "valid_to": v.valid_to.isoformat() if v.valid_to else None,
         "notes": v.notes}
        for v in db.query(ProductVariableCost).all()
    ]
    # 직원별 담당 채널 (프론트가 e.channels.length 접근 — 누락 시 클라이언트 크래시)
    _emp_ch: dict[int, list[dict]] = {}
    for a in db.query(EmployeeChannelAssignment).all():
        _emp_ch.setdefault(a.employee_id, []).append(
            {"channel_id": a.channel_id, "channel_name": a.channel_name, "is_active": a.is_active}
        )
    employees = [
        {"id": e.id, "name": e.name, "email": e.email, "role": e.role,
         "is_active": e.is_active, "channels": _emp_ch.get(e.id, [])}
        for e in db.query(Employee).order_by(Employee.name).all()
    ]
    batches = [
        {"id": b.id, "channel_id": b.channel_id, "channel_name": b.channel_name,
         "file_name": b.file_name, "status": b.status,
         "period_start": b.period_start.isoformat() if b.period_start else None,
         "period_end": b.period_end.isoformat() if b.period_end else None,
         "row_total": b.row_total, "row_inserted": b.row_inserted,
         "row_duplicate": b.row_duplicate, "row_unmatched": b.row_unmatched,
         "row_excluded": b.row_excluded, "row_cancelled": b.row_cancelled,
         "created_at": b.created_at.isoformat() if b.created_at else None}
        for b in db.query(ChannelSalesUploadBatch).order_by(ChannelSalesUploadBatch.created_at.desc()).limit(200).all()
    ]
    unmatched = [
        {"id": u.id, "channel_id": u.channel_id, "channel_name": u.channel_name,
         "raw_product_name": u.raw_product_name, "raw_option_name": u.raw_option_name,
         "occurrence_count": u.occurrence_count, "total_qty": u.total_qty,
         "llm_suggested_product_id": u.llm_suggested_product_id,
         "llm_suggested_unit_per_set": u.llm_suggested_unit_per_set,
         "llm_confidence": u.llm_confidence, "llm_reason": u.llm_reason}
        for u in db.query(ChannelUnmatchedProduct).filter(ChannelUnmatchedProduct.status == "pending").all()
    ]
    data = {
        "channels": channels, "products": products, "groups": groups,
        "cost_items": cost_items, "variable_costs": variable_costs,
        "employees": employees, "batches": batches, "unmatched": unmatched,
    }
    _BOOT_CACHE["data"] = data
    _BOOT_CACHE["expires"] = now + _BOOT_TTL_SEC
    return {**data, "_cached": False, "_ttl_sec": _BOOT_TTL_SEC}


def _bust_bootstrap_cache():
    _BOOT_CACHE["data"] = None
    _BOOT_CACHE["expires"] = 0.0


# ── 마스터 맵 메모리 캐시 ──────────────────────────────────
# 채널그룹/멤버십/직원/담당/품목카테고리 — 거의 안 바뀌는 마스터.
# 매 요청마다 5개 쿼리(×309ms RTT) 날리던 걸 5분에 1회로 압축.
_MASTER_CACHE: dict = {"data": None, "expires": 0.0}
_MASTER_TTL_SEC = 300


def _get_master_maps(db: Session) -> dict:
    """dashboard/plan_comparison/pnl이 공통으로 쓰는 마스터 맵을 한 번에 캐싱."""
    import time as _t
    now = _t.time()
    c = _MASTER_CACHE
    if c["data"] is not None and c["expires"] > now:
        return c["data"]
    group_map = {m.channel_id: m.group_id for m in db.query(ChannelGroupMembership).all()}
    group_names = {g.id: g.name for g in db.query(ChannelGroup).all()}
    emp_names = {e.id: e.name for e in db.query(Employee).all()}
    emp_channel: dict = {}
    for a in db.query(EmployeeChannelAssignment).filter(
        EmployeeChannelAssignment.is_active.is_(True)
    ).all():
        emp_channel.setdefault(a.channel_id, []).append((a.employee_id, ""))
    prod_categories = {p.id: p.category for p in db.query(ProductMaster).all()}
    data = {
        "group_map": group_map,
        "group_names": group_names,
        "emp_names": emp_names,
        "emp_channel": emp_channel,
        "prod_categories": prod_categories,
    }
    c["data"] = data
    c["expires"] = now + _MASTER_TTL_SEC
    return data


def _bust_master_cache():
    _MASTER_CACHE["data"] = None
    _MASTER_CACHE["expires"] = 0.0


def _bust_all_caches():
    """데이터 변경(업로드/매핑/PNL값/변동비) 시 모든 응답 캐시 무효화.

    TTL을 5분으로 늘린 대신, 실제 변경 시 즉시 무효화해 stale 방지.
    """
    _bust_bootstrap_cache()
    _bust_master_cache()
    for _c in ("_DASH_CACHE", "_PNL_CACHE", "_PLAN_CACHE", "_CHPROD_CACHE"):
        try:
            globals()[_c].clear()
        except Exception:
            pass


_CHPROD_CACHE: dict = {}
_CHPROD_TTL_SEC = 300

# 사업계획 응답 캐시 (plan/summary·plan/comparison·avg-price 공용).
# NOTE: 과거 캐시 도입 시 정의가 누락돼 plan 엔드포인트가 NameError로 500나던 버그 수정.
_PLAN_CACHE: dict = {}
_PLAN_TTL_SEC = 300


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
    aliases: Optional[list] = None  # 별칭(SCM 완제품명 매칭/채널 매핑용)


@router.post("/products")
def upsert_product(payload: ProductMasterIn, db: Session = Depends(get_db)):
    existing = db.query(ProductMaster).filter(ProductMaster.name == payload.name).first()
    if existing:
        for k, v in payload.model_dump(exclude_unset=True).items():
            setattr(existing, k, v)
        db.commit()
        # 모든 활성 채널에 신규 매핑 자동 생성 (멱등)
        seed_channel_products(db)
        _bust_all_caches()
        return {"id": existing.id, "updated": True}
    item = ProductMaster(**payload.model_dump())
    db.add(item); db.commit()
    seed_channel_products(db)
    _bust_all_caches()
    return {"id": item.id, "updated": False}


@router.delete("/products/{product_id}")
def delete_product(product_id: int, db: Session = Depends(get_db)):
    p = db.query(ProductMaster).filter(ProductMaster.id == product_id).first()
    if not p:
        raise HTTPException(404, "product not found")
    # soft delete (is_active=False) — 매핑/매출 데이터 보존
    p.is_active = False
    db.commit()
    _bust_all_caches()
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
    import time as _time
    _cp_key = (channel_id or "", product_id or 0, only_active)
    _cp_now = _time.time()
    _cp_cached = _CHPROD_CACHE.get(_cp_key)
    if _cp_cached and _cp_cached["expires"] > _cp_now:
        return _cp_cached["data"]
    q = db.query(CsaChannelProduct)
    if channel_id:
        q = q.filter(CsaChannelProduct.channel_id == channel_id)
    if product_id:
        q = q.filter(CsaChannelProduct.product_id == product_id)
    if only_active:
        q = q.filter(CsaChannelProduct.is_active.is_(True))
    rows = q.order_by(CsaChannelProduct.channel_name, CsaChannelProduct.product_name).all()
    out = [
        {
            "id": r.id, "channel_id": r.channel_id, "channel_name": r.channel_name,
            "product_id": r.product_id, "product_name": r.product_name,
            "is_active": r.is_active, "added_by": r.added_by,
        } for r in rows
    ]
    _CHPROD_CACHE[_cp_key] = {"data": out, "expires": _cp_now + _CHPROD_TTL_SEC}
    return out


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
        _bust_all_caches()
        return {"id": existing.id, "updated": True}
    item = CsaChannelProduct(
        channel_id=ch.id, channel_name=ch.name,
        product_id=p.id, product_name=p.name,
        is_active=payload.is_active, notes=payload.notes,
        added_by="manual",
    )
    db.add(item); db.commit()
    _bust_all_caches()
    return {"id": item.id, "updated": False}


@router.delete("/channel-products/{cp_id}")
def delete_channel_product(cp_id: int, db: Session = Depends(get_db)):
    item = db.query(CsaChannelProduct).filter(CsaChannelProduct.id == cp_id).first()
    if not item:
        raise HTTPException(404, "not found")
    item.is_active = False
    db.commit()
    _bust_all_caches()
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
    _bust_all_caches()
    return {"channel_id": channel_id, "active_count": len(pid_set), "changed": changed}


class ChannelActiveIn(BaseModel):
    channel_id: str
    is_active: bool


@router.post("/channels/set-active")
def set_channel_active(payload: ChannelActiveIn, db: Session = Depends(get_db)):
    """채널 활성/비활성 토글 — 중복 채널 정리용(비활성 채널은 업로드 목록에서 숨겨짐).
    데이터/매핑은 보존(soft)."""
    ch = db.query(Channel).filter(Channel.id == payload.channel_id).first()
    if not ch:
        raise HTTPException(404, "channel not found")
    ch.is_active = payload.is_active
    db.commit()
    _bust_all_caches()
    return {"channel_id": ch.id, "name": ch.name, "is_active": ch.is_active}


class ChannelRenameIn(BaseModel):
    channel_id: str
    name: str


@router.post("/channels/rename")
def rename_channel(payload: ChannelRenameIn, db: Session = Depends(get_db)):
    """채널 표시명 변경. channel_id 기준이라 누적 매출/매핑(channel_id FK)은 그대로 유지.
    주의: 파서는 채널명으로 조회되므로 새 이름도 파서 레지스트리에 alias 등록돼 있어야 함."""
    ch = db.query(Channel).filter(Channel.id == payload.channel_id).first()
    if not ch:
        raise HTTPException(404, "channel not found")
    old = ch.name
    ch.name = payload.name.strip()
    # 구분 그룹 멤버십에 저장된 표시명도 동기화
    db.query(ChannelGroupMembership).filter(
        ChannelGroupMembership.channel_id == payload.channel_id
    ).update({"channel_name": ch.name}, synchronize_session=False)
    db.commit()
    _bust_all_caches()
    return {"channel_id": ch.id, "old_name": old, "name": ch.name,
            "has_parser": ch.name in set(registered_channels())}


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

def _run_ingest_background(
    tmp_path: str,
    channel_id: str,
    channel_name: str,
    file_name: str,
    fsize: int,
    fhash: str,
    parser_name: str,
):
    """BackgroundTask로 실행되는 ingest 워커.

    별도 DB 세션을 열고 ingest_lines를 실행. 예외는 batch.status='failed'로 마킹.
    """
    from app.database import SessionLocal
    db = SessionLocal()
    try:
        parser = get_parser(parser_name)
        if not parser:
            return
        try:
            lines = list(parser(tmp_path))
            batch = ingest_lines(
                db,
                channel_id=channel_id,
                channel_name=channel_name,
                file_name=file_name,
                file_hash=fhash,
                file_size=fsize,
                parser_version="v1",
                lines=lines,
            )
            # 보관해 둔 원본 파일(batch_id NULL)에 batch_id 연결.
            try:
                if batch is not None:
                    db.query(CsaUploadFile).filter(
                        CsaUploadFile.channel_id == channel_id,
                        CsaUploadFile.file_hash == fhash,
                        CsaUploadFile.batch_id.is_(None),
                    ).update({"batch_id": batch.id}, synchronize_session=False)
                    db.commit()
            except Exception:
                db.rollback()
            # 파서가 0행을 산출하면 '조용한 매출 누락'(done인데 데이터 없음)이 되므로
            # failed로 마킹해 사용자에게 형식 불일치를 드러낸다 (CJ온스타일/SSG 사례).
            if not lines and batch is not None:
                try:
                    batch.status = "failed"
                    batch.error_message = (
                        "파싱 결과 0행 — 파일 형식이 채널 파서와 맞지 않습니다. "
                        "파일이 해당 채널 리포트가 맞는지 확인해 주세요."
                    )
                    db.commit()
                except Exception:
                    db.rollback()
            # 새 매출 적재 완료 → 모든 응답 캐시 무효화 (대시보드/PNL/batches 즉시 반영)
            _bust_all_caches()
        except Exception as e:
            log = logging.getLogger(__name__)
            log.exception("background ingest failed")
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
    finally:
        try:
            os.unlink(tmp_path)
        except Exception:
            pass
        db.close()


def _cleanup_stale_parsing_batches(db: Session, channel_id: str, ttl_minutes: int = 30):
    """업로드 시 진입 시 같은 채널의 오래된 parsing 잔존 batch를 failed로 마킹.

    Railway/uvicorn restart로 워커가 죽으면 parsing 상태가 영원히 stuck됨.
    /upload 호출 때마다 자기 채널의 ttl 지난 parsing batch를 정리.
    """
    from datetime import timedelta
    cutoff = datetime.utcnow() - timedelta(minutes=ttl_minutes)
    stale = db.query(ChannelSalesUploadBatch).filter(
        ChannelSalesUploadBatch.channel_id == channel_id,
        ChannelSalesUploadBatch.status == "parsing",
        ChannelSalesUploadBatch.created_at < cutoff,
    ).all()
    for b in stale:
        b.status = "failed"
        b.error_message = (b.error_message or "") + f" | auto: stale parsing >{ttl_minutes}min"
    if stale:
        db.commit()


@router.get("/debug/daily-count")
def debug_daily_count(
    channel_id: Optional[str] = Query(None),
    name_like: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    """[진단] daily/raw/batch 계층별 행수·매출합을 channel_id 또는 channel_name like로 집계."""
    out: dict = {}
    def _agg(model, has_net):
        q = db.query(model)
        if channel_id:
            q = q.filter(model.channel_id == channel_id)
        if name_like:
            q = q.filter(model.channel_name.ilike(f"%{name_like}%"))
        rows = q.all()
        d = {"count": len(rows),
             "distinct_channel_ids": sorted({r.channel_id for r in rows})[:10]}
        if has_net:
            d["net_sales_sum"] = round(sum(getattr(r, "net_sales", 0) or 0 for r in rows), 1)
        return d
    out["daily"] = _agg(ChannelSalesDailyProduct, True)
    out["raw"] = _agg(ChannelSalesRawLine, False)
    out["batch"] = _agg(ChannelSalesUploadBatch, False)
    # name_like로 daily의 channel_name 분포도 확인
    if name_like:
        nm = db.query(ChannelSalesDailyProduct.channel_name, ChannelSalesDailyProduct.channel_id,
                      func.count(ChannelSalesDailyProduct.id)).filter(
            ChannelSalesDailyProduct.channel_name.ilike(f"%{name_like}%")
        ).group_by(ChannelSalesDailyProduct.channel_name, ChannelSalesDailyProduct.channel_id).all()
        out["daily_name_groups"] = [{"name": n, "cid": c, "rows": cnt} for n, c, cnt in nm]
    return out


@router.get("/debug/parse-dump")
def debug_parse_dump(
    channel_id: str = Query(...),
    name_contains: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    """[진단용] 보관된 원본 파일 1건을 파서로 다시 돌려 결과를 반환.
    PDF면 pdfplumber 표/텍스트도 덤프해 컬럼 인식/금액 추출 문제를 진단."""
    import os as _os, tempfile as _tempfile
    ch = db.query(Channel).filter(Channel.id == channel_id).first()
    channel_name = ch.name if ch else None
    q = db.query(CsaUploadFile).filter(CsaUploadFile.channel_id == channel_id)
    if name_contains:
        q = q.filter(CsaUploadFile.file_name.ilike(f"%{name_contains}%"))
    f = q.order_by(CsaUploadFile.created_at.desc()).first()
    if not f:
        return {"error": "보관된 파일 없음", "channel_name": channel_name}

    suffix = _os.path.splitext(f.file_name or "")[1] or ".bin"
    tmp_path = None
    out: dict = {"channel_name": channel_name, "file_name": f.file_name, "suffix": suffix}
    try:
        with _tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(f.content or b"")
            tmp_path = tmp.name

        if suffix.lower() == ".pdf":
            try:
                import pdfplumber
                pdump = []
                with pdfplumber.open(tmp_path) as pdf:
                    for pi, page in enumerate(pdf.pages[:2]):
                        tables = page.extract_tables() or []
                        pdump.append({
                            "page": pi,
                            "text_head": (page.extract_text() or "")[:600],
                            "tables": [[[ (c or "")[:30] if isinstance(c, str) else c for c in row] for row in t[:12]] for t in tables[:3]],
                        })
                out["pdf"] = pdump
            except Exception as e:
                out["pdf_error"] = f"{type(e).__name__}: {e}"
        else:
            try:
                from app.services.csa_parsers._common import read_excel_safe
                df = read_excel_safe(tmp_path, sheet_name=0, header=None)
                out["excel_head"] = [[ (str(c)[:25]) for c in df.iloc[i].tolist()] for i in range(min(20, len(df)))]
            except Exception as e:
                out["excel_error"] = f"{type(e).__name__}: {e}"

        parser = get_parser(channel_name)
        if not parser:
            out["parser"] = None
            out["parser_note"] = f"채널 '{channel_name}' 파서 미등록"
        else:
            try:
                lines = list(parser(tmp_path))
                out["parsed_count"] = len(lines)
                out["parsed_gross_sum"] = round(sum(getattr(l, "gross_amount", 0) or 0 for l in lines), 1)
                out["parsed_sample"] = [
                    {"prod": getattr(l, "raw_product_name", None), "qty": getattr(l, "raw_qty", None),
                     "gross": getattr(l, "gross_amount", None), "net": getattr(l, "net_amount", None)}
                    for l in lines[:12]
                ]
            except Exception as e:
                out["parse_error"] = f"{type(e).__name__}: {e}"
    finally:
        if tmp_path:
            try:
                _os.unlink(tmp_path)
            except Exception:
                pass
    return out


@router.post("/upload")
async def upload_channel_file(
    background_tasks: BackgroundTasks,
    channel_id: str = Form(...),
    channel_name: str = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    parser = get_parser(channel_name)
    if not parser:
        raise HTTPException(status_code=400, detail=f"채널 '{channel_name}' 파서가 아직 구현되지 않았습니다")

    # 같은 채널의 오래된 parsing stuck batch 자동 정리 (TTL 30분)
    _cleanup_stale_parsing_batches(db, channel_id)

    suffix = os.path.splitext(file.filename or "")[1] or ".xlsx"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name

    fsize = len(content)
    fhash = file_sha256(tmp_path)

    # 동일 파일 재업로드 감지 — failed/canceled batch는 dup으로 잡지 않음
    dup_batch = db.query(ChannelSalesUploadBatch).filter(
        ChannelSalesUploadBatch.channel_id == channel_id,
        ChannelSalesUploadBatch.file_hash == fhash,
        ChannelSalesUploadBatch.status.notin_(["failed", "canceled"]),
    ).first()
    if dup_batch:
        try:
            os.unlink(tmp_path)
        except Exception:
            pass
        return {
            "batch_id": dup_batch.id,
            "duplicate_file": True,
            "row_total": dup_batch.row_total,
            "row_inserted": dup_batch.row_inserted,
            "row_duplicate": dup_batch.row_duplicate,
            "row_unmatched": dup_batch.row_unmatched,
            "row_excluded": dup_batch.row_excluded,
            "row_cancelled": dup_batch.row_cancelled,
            "status": dup_batch.status,
            "message": "이미 업로드된 파일입니다. 새로 적재하지 않았습니다.",
        }

    # 원본 파일 바이트 보관 (원본 양식 그대로 재다운로드용).
    # batch_id는 ingest_lines 내부에서 생성되므로 여기선 channel_id+file_hash로만 저장하고,
    # ingest 완료 후 _run_ingest_background에서 batch_id를 연결한다.
    try:
        db.add(CsaUploadFile(
            batch_id=None,
            channel_id=channel_id,
            file_name=file.filename or "upload",
            file_hash=fhash,
            content=content,
        ))
        db.commit()
    except Exception:
        db.rollback()
        log = logging.getLogger(__name__)
        log.exception("원본 파일 보관 실패 (export용) — 업로드는 계속 진행")

    # BackgroundTask로 ingest 위임 — ingest_lines 내부에서 batch 생성/commit.
    # 대용량 엑셀(95k+ 라인)도 워커 timeout 없이 처리 가능.
    background_tasks.add_task(
        _run_ingest_background,
        tmp_path,
        channel_id,
        channel_name,
        file.filename or "upload",
        fsize,
        fhash,
        channel_name,
    )

    return {
        "duplicate_file": False,
        "status": "queued",
        "channel_id": channel_id,
        "file_hash": fhash,
        "message": "업로드를 큐에 넣었습니다. 잠시 후 'batches' 목록에서 진행 상황을 확인하세요.",
    }


@router.get("/batches")
def list_batches(
    channel_id: Optional[str] = None,
    limit: int = 200,
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
            "file_hash": b.file_hash,
            "status": b.status,
            "period_start": b.period_start.isoformat() if b.period_start else None,
            "period_end": b.period_end.isoformat() if b.period_end else None,
            "row_total": b.row_total,
            "row_inserted": b.row_inserted,
            "row_duplicate": b.row_duplicate,
            "row_unmatched": b.row_unmatched,
            "row_excluded": b.row_excluded,
            "row_cancelled": b.row_cancelled,
            "error_message": b.error_message,
            "created_at": b.created_at.isoformat() if b.created_at else None,
        }
        for b in rows
    ]


# ──────────────────────────────────────────────────────────────
# 채널 데이터 삭제 (운영자용 — 잘못/중복 업로드 정리 후 재업로드)
# ──────────────────────────────────────────────────────────────

@router.delete("/channel-data")
def delete_channel_data(
    channel_id: str = Query(..., description="삭제 대상 채널 id (필수)"),
    period_start: Optional[date] = Query(None, description="기간 시작(미지정 시 채널 전체 삭제)"),
    period_end: Optional[date] = Query(None, description="기간 종료"),
    db: Session = Depends(get_db),
):
    """채널의 매출 데이터(raw_lines·daily_product·upload_batches·upload_files)를 삭제.

    - period_start/period_end 둘 다 주어지면 해당 기간만, 아니면 채널 전체 삭제.
    - raw_lines·daily_product는 sale_date 기준으로 기간 필터.
    - batches·files는 channel 전체(기간 없을 때) 또는 기간과 겹치는 것(기간 있을 때) 삭제.
      · batches: period_start/period_end가 [요청기간]과 겹치면 삭제.
      · files: batch_id로 연결된 batch가 삭제 대상이면 삭제. 연결 안 된(batch_id NULL) 파일은
        기간 지정 시 created_at으로 보수적 판단(날짜 메타가 없어 created_at 범위로 근사),
        기간 미지정 시 채널 전체 삭제.
    - 삭제 후 남은 데이터로 daily_aggregate 재계산.
    """
    ch = db.query(Channel).filter(Channel.id == channel_id).first()
    if not ch:
        raise HTTPException(404, "channel not found")

    scoped = period_start is not None and period_end is not None
    if (period_start is None) != (period_end is None):
        raise HTTPException(400, "period_start와 period_end는 둘 다 지정하거나 둘 다 비워야 합니다")
    if scoped and period_start > period_end:
        raise HTTPException(400, "period_start가 period_end보다 늦습니다")

    # 1) raw_lines (sale_date 기준)
    raw_q = db.query(ChannelSalesRawLine).filter(ChannelSalesRawLine.channel_id == channel_id)
    if scoped:
        raw_q = raw_q.filter(
            ChannelSalesRawLine.sale_date >= period_start,
            ChannelSalesRawLine.sale_date <= period_end,
        )
    raw_deleted = raw_q.delete(synchronize_session=False)

    # 2) daily_product (sale_date 기준)
    daily_q = db.query(ChannelSalesDailyProduct).filter(
        ChannelSalesDailyProduct.channel_id == channel_id
    )
    if scoped:
        daily_q = daily_q.filter(
            ChannelSalesDailyProduct.sale_date >= period_start,
            ChannelSalesDailyProduct.sale_date <= period_end,
        )
    daily_deleted = daily_q.delete(synchronize_session=False)

    # 3) 삭제 대상 batch id 수집 (files를 batch_id로 함께 지우기 위해 먼저 id를 모은다)
    batch_q = db.query(ChannelSalesUploadBatch).filter(
        ChannelSalesUploadBatch.channel_id == channel_id
    )
    if scoped:
        # 기간이 겹치는 batch (period_start/period_end가 NULL인 batch는 보수적으로 포함)
        batch_q = batch_q.filter(
            or_(
                ChannelSalesUploadBatch.period_start.is_(None),
                ChannelSalesUploadBatch.period_end.is_(None),
                and_(
                    ChannelSalesUploadBatch.period_start <= period_end,
                    ChannelSalesUploadBatch.period_end >= period_start,
                ),
            )
        )
    candidate_batch_ids = [b.id for b in batch_q.all()]

    # 3b) 기간 삭제 후에도 raw_lines가 남아 참조 중인 batch는 삭제 금지(FK 위반 방지).
    #     기간이 batch 전체를 덮지 않는 경우(예: 6월만 삭제하는데 batch는 5~7월),
    #     남은 raw_lines가 batch를 여전히 참조 → csa_sales_raw_lines_batch_id_fkey 위반으로
    #     500(브라우저에는 "Failed to fetch")이 나던 문제. 남은 참조가 없는 batch만 삭제한다.
    if scoped and candidate_batch_ids:
        surviving_batch_ids = {
            row[0]
            for row in db.query(ChannelSalesRawLine.batch_id)
            .filter(
                ChannelSalesRawLine.channel_id == channel_id,
                ChannelSalesRawLine.batch_id.in_(candidate_batch_ids),
            )
            .distinct()
            .all()
            if row[0] is not None
        }
        target_batch_ids = [b for b in candidate_batch_ids if b not in surviving_batch_ids]
    else:
        target_batch_ids = candidate_batch_ids

    # 4) upload_files 삭제
    #    - batch_id가 삭제 대상 batch면 삭제
    #    - batch_id가 NULL인 보관 파일: 기간 미지정 시 채널 전체, 기간 지정 시 created_at 범위로 근사
    files_deleted = 0
    if target_batch_ids:
        files_deleted += db.query(CsaUploadFile).filter(
            CsaUploadFile.batch_id.in_(target_batch_ids)
        ).delete(synchronize_session=False)
    orphan_files_q = db.query(CsaUploadFile).filter(
        CsaUploadFile.channel_id == channel_id,
        CsaUploadFile.batch_id.is_(None),
    )
    if scoped:
        # batch_id 미연결 파일은 sale_date 메타가 없으므로 업로드 시각(created_at)으로 근사 판단.
        from datetime import datetime as _dt, time as _time_cls
        orphan_files_q = orphan_files_q.filter(
            CsaUploadFile.created_at >= _dt.combine(period_start, _time_cls.min),
            CsaUploadFile.created_at <= _dt.combine(period_end, _time_cls.max),
        )
    files_deleted += orphan_files_q.delete(synchronize_session=False)

    # 5) batch row 삭제
    batches_deleted = 0
    if target_batch_ids:
        batches_deleted = db.query(ChannelSalesUploadBatch).filter(
            ChannelSalesUploadBatch.id.in_(target_batch_ids)
        ).delete(synchronize_session=False)

    # 6) 채널 전체 삭제 시 미매핑 큐도 정리 (잔여 깨진 값 방지)
    unmatched_deleted = 0
    if not scoped:
        unmatched_deleted = db.query(ChannelUnmatchedProduct).filter(
            ChannelUnmatchedProduct.channel_id == channel_id
        ).delete(synchronize_session=False)

    db.commit()

    # 7) 남은 데이터로 daily_aggregate 정합화 (채널 스코프)
    rebuild_daily_aggregate(db, channel_id=channel_id)
    _bust_all_caches()

    return {
        "channel_id": channel_id,
        "channel_name": ch.name,
        "scoped": scoped,
        "period_start": period_start.isoformat() if period_start else None,
        "period_end": period_end.isoformat() if period_end else None,
        "raw_lines_deleted": raw_deleted,
        "daily_rows_deleted": daily_deleted,
        "batches_deleted": batches_deleted,
        "files_deleted": files_deleted,
        "unmatched_queue_deleted": unmatched_deleted,
    }


# ──────────────────────────────────────────────────────────────
# 재처리 (재업로드 없이 보관 원본을 최신 파서로 다시 파싱·집계)
# ──────────────────────────────────────────────────────────────

def _run_reprocess_background(channel_id: str, channel_name: str):
    """BackgroundTask로 실행되는 재처리 워커.

    채널의 보관 원본(csa_upload_files)을 최신 파서로 다시 파싱·적재한다.
    - 보관 원본(upload_files)은 절대 삭제하지 않는다(보관본 보존).
    - 기존 raw_lines / daily_product / upload_batches는 삭제 후 새로 적재.
    - upload_files.batch_id는 batch 삭제 전 NULL로 끊고, 재적재 후 새 batch_id로 재연결.
    - 새 csa_upload_files insert는 하지 않는다(중복 보관 방지) — ingest_lines가 저장하지 않음.
    """
    from app.database import SessionLocal
    db = SessionLocal()
    try:
        files = (
            db.query(CsaUploadFile)
            .filter(CsaUploadFile.channel_id == channel_id)
            .order_by(CsaUploadFile.created_at.asc())
            .all()
        )
        if not files:
            return

        # 1) upload_files.batch_id를 먼저 NULL로 끊어 FK 위반 방지 (보관본은 보존)
        db.query(CsaUploadFile).filter(
            CsaUploadFile.channel_id == channel_id
        ).update({"batch_id": None}, synchronize_session=False)

        # 2) 기존 매출 데이터 삭제 (upload_files는 제외)
        db.query(ChannelSalesRawLine).filter(
            ChannelSalesRawLine.channel_id == channel_id
        ).delete(synchronize_session=False)
        db.query(ChannelSalesDailyProduct).filter(
            ChannelSalesDailyProduct.channel_id == channel_id
        ).delete(synchronize_session=False)
        db.query(ChannelSalesUploadBatch).filter(
            ChannelSalesUploadBatch.channel_id == channel_id
        ).delete(synchronize_session=False)
        db.commit()

        parser = get_parser(channel_name)
        if not parser:
            log.warning("reprocess: 파서 없음 channel_name=%s", channel_name)
            # 파서가 없으면 적재는 못하지만 삭제는 이미 반영됨 → 집계만 재계산
            rebuild_daily_aggregate(db, channel_id=channel_id)
            _bust_all_caches()
            return

        # 3) 각 보관 원본을 임시파일로 풀어 동일 적재 로직 실행
        for f in files:
            suffix = os.path.splitext(f.file_name or "")[1] or ".xlsx"
            tmp_path = None
            tmp_dir = None
            try:
                # 원본 파일명 보존 — 파일명에서 날짜/정보를 추출하는 파서(ably·gsshop 등)가
                # 재처리 시 임시 난수 파일명 때문에 오작동(당월 미표시)하지 않도록 한다.
                tmp_dir = tempfile.mkdtemp()
                safe_name = os.path.basename(f.file_name or f"reprocess{suffix}")
                tmp_path = os.path.join(tmp_dir, safe_name)
                with open(tmp_path, "wb") as tmp:
                    tmp.write(f.content or b"")
                lines = list(parser(tmp_path))
                fsize = len(f.content or b"")
                fhash = f.file_hash
                batch = ingest_lines(
                    db,
                    channel_id=channel_id,
                    channel_name=channel_name,
                    file_name=f.file_name or "reprocess",
                    file_hash=fhash,
                    file_size=fsize,
                    parser_version="v1",
                    lines=lines,
                )
                # 이 보관 파일을 새 batch에 재연결
                if batch is not None:
                    f.batch_id = batch.id
                    db.commit()
            except Exception:
                db.rollback()
                log.exception("reprocess: 파일 재처리 실패 file_id=%s", f.id)
            finally:
                if tmp_path:
                    try:
                        os.unlink(tmp_path)
                    except Exception:
                        pass
                if tmp_dir:
                    try:
                        os.rmdir(tmp_dir)
                    except Exception:
                        pass

        # 4) 집계 재계산 + 캐시 무효화
        rebuild_daily_aggregate(db, channel_id=channel_id)
        _bust_all_caches()
    except Exception:
        db.rollback()
        log.exception("reprocess background failed channel_id=%s", channel_id)
    finally:
        db.close()


@router.post("/reprocess")
def reprocess_channel(
    background_tasks: BackgroundTasks,
    channel_id: str = Query(..., description="재처리 대상 채널 id (필수)"),
    db: Session = Depends(get_db),
):
    """재업로드 없이, DB에 보관된 원본 엑셀을 최신 파서로 다시 파싱·집계.

    파서 로직이 바뀌었을 때 사용자가 파일을 다시 올리지 않아도 되게 한다.
    보관 원본(csa_upload_files)은 보존하고, raw_lines/daily_product/upload_batches만
    재생성한다. 대용량(8만행 등) 처리는 BackgroundTask로 큐잉하고 즉시 응답하며,
    프론트는 batches 폴링으로 진행 상황을 확인한다.
    """
    ch = db.query(Channel).filter(Channel.id == channel_id).first()
    if not ch:
        raise HTTPException(404, "channel not found")

    file_count = db.query(CsaUploadFile).filter(
        CsaUploadFile.channel_id == channel_id
    ).count()
    if file_count == 0:
        raise HTTPException(
            404,
            "보관된 원본 파일이 없습니다. 한 번 재업로드하면 이후부터 재처리 가능합니다.",
        )

    parser = get_parser(ch.name)
    if not parser:
        raise HTTPException(
            400, f"채널 '{ch.name}' 파서가 아직 구현되지 않았습니다",
        )

    background_tasks.add_task(_run_reprocess_background, channel_id, ch.name)

    return {
        "status": "queued",
        "channel_id": channel_id,
        "channel_name": ch.name,
        "file_count": file_count,
        "message": "재처리를 큐에 넣었습니다. 잠시 후 'batches' 목록에서 진행 상황을 확인하세요.",
    }


# ──────────────────────────────────────────────────────────────
# 원본 양식 엑셀 다운로드 (채널 + 기간)
# ──────────────────────────────────────────────────────────────

# 원본 엑셀에서 날짜 컬럼을 찾을 때 시도할 후보 토큰(부분 일치).
# 채널마다 날짜 컬럼명이 제각각이라, 컬럼명에 아래 토큰이 포함되면 날짜 컬럼으로 간주.
# 우선순위가 높은(정확한) 토큰을 앞에 배치.
_EXPORT_DATE_COL_TOKENS = [
    "주문일시", "결제일시", "주문일자", "주문일", "결제일",
    "구매 날짜", "구매날짜", "공급일자", "수불일", "판매일",
    "입고", "반출", "정산일", "발주일", "출고일",
    "일자", "일시", "날짜", "date",
]


def _find_date_column(df) -> Optional[str]:
    """DataFrame 컬럼 중 날짜 컬럼명을 후보 토큰 순서로 탐색."""
    cols = [str(c) for c in df.columns]
    for token in _EXPORT_DATE_COL_TOKENS:
        for c in cols:
            if token in c:
                return c
    return None


@router.get("/export-excel")
def export_excel(
    channel_id: str = Query(...),
    period_start: date = Query(...),
    period_end: date = Query(...),
    db: Session = Depends(get_db),
):
    """채널 + 기간 지정 → 업로드했던 원본 엑셀 양식 그대로 해당 기간 행만 모아 다운로드.

    저장해 둔 원본 파일 바이트(csa_upload_files)를 각각 DataFrame으로 재읽기 후,
    각 파일의 날짜 컬럼을 식별해 기간 범위 행만 남겨 concat → 단일 엑셀로 출력.
    날짜 컬럼을 못 찾는 파일은 전체 행 포함(누락보다 과포함이 안전).
    """
    import io
    import os as _os
    import tempfile as _tempfile

    import pandas as pd
    from fastapi.responses import StreamingResponse

    from app.services.csa_parsers._common import read_excel_safe

    files = (
        db.query(CsaUploadFile)
        .filter(CsaUploadFile.channel_id == channel_id)
        .order_by(CsaUploadFile.created_at.asc())
        .all()
    )
    if not files:
        raise HTTPException(status_code=404, detail="해당 채널의 보관된 원본 파일이 없습니다. (이 기능 적용 이후 업로드분만 다운로드 가능)")

    ch = db.query(Channel).filter(Channel.id == channel_id).first()
    channel_name = (ch.name if ch else None) or files[0].channel_id

    ps = pd.Timestamp(period_start)
    pe = pd.Timestamp(period_end)

    frames: list = []
    for f in files:
        suffix = _os.path.splitext(f.file_name or "")[1] or ".xlsx"
        tmp_path = None
        try:
            with _tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
                tmp.write(f.content)
                tmp_path = tmp.name
            df = read_excel_safe(tmp_path)
        except Exception:
            log.exception("export: 파일 재읽기 실패 file_id=%s", f.id)
            continue
        finally:
            if tmp_path:
                try:
                    _os.unlink(tmp_path)
                except Exception:
                    pass

        if df is None or df.empty:
            continue

        date_col = _find_date_column(df)
        if date_col is not None:
            parsed = pd.to_datetime(df[date_col], errors="coerce")
            # 기간 필터 (날짜만 비교). 파싱 실패(NaT) 행은 안전하게 포함.
            mask = parsed.isna() | ((parsed.dt.normalize() >= ps) & (parsed.dt.normalize() <= pe))
            df = df[mask]
        # 날짜 컬럼 못 찾으면 전체 행 포함

        if not df.empty:
            frames.append(df)

    if frames:
        out_df = pd.concat(frames, ignore_index=True)
    else:
        # 빈 결과: 첫 파일의 컬럼 구조라도 유지
        out_df = pd.DataFrame()

    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as writer:
        out_df.to_excel(writer, index=False)
    buf.seek(0)

    from urllib.parse import quote
    fname = f"{channel_name}_{period_start.isoformat()}_{period_end.isoformat()}.xlsx"
    headers = {
        "Content-Disposition": f"attachment; filename*=UTF-8''{quote(fname)}",
    }
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers=headers,
    )


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
        _bust_all_caches()

    return {"mapping_id": mapping_id, "raw_lines_updated": updated}


# ──────────────────────────────────────────────────────────────
# 다중 매핑 (옵션 1건 → 복수 표준 품목, 낱개수량 비율로 매출 안분)
# ──────────────────────────────────────────────────────────────

class MultiMappingComponentIn(BaseModel):
    product_id: int
    unit_per_set: int = 1


class MultiMappingIn(BaseModel):
    channel_id: str
    channel_name: Optional[str] = None
    raw_product_name: str
    raw_option_name: Optional[str] = None
    components: List[MultiMappingComponentIn]


@router.get("/mapping/multi")
def list_multi_mappings(
    channel_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    """다중 매핑 목록 — (채널·원본명·옵션) 키별로 컴포넌트 묶음 반환."""
    q = db.query(ChannelProductMappingComponent)
    if channel_id:
        q = q.filter(ChannelProductMappingComponent.channel_id == channel_id)
    rows = q.order_by(
        ChannelProductMappingComponent.channel_id,
        ChannelProductMappingComponent.raw_product_name,
        ChannelProductMappingComponent.sort_order,
        ChannelProductMappingComponent.id,
    ).all()
    grouped: dict = {}
    for r in rows:
        key = (r.channel_id, r.raw_product_name, r.raw_option_name or "")
        g = grouped.setdefault(key, {
            "channel_id": r.channel_id,
            "channel_name": r.channel_name,
            "raw_product_name": r.raw_product_name,
            "raw_option_name": r.raw_option_name,
            "components": [],
        })
        g["components"].append({
            "id": r.id,
            "product_id": r.product_id,
            "unit_per_set": r.unit_per_set,
        })
    return list(grouped.values())


@router.post("/mapping/multi")
def upsert_multi_mapping(payload: MultiMappingIn, db: Session = Depends(get_db)):
    """옵션 1건을 복수 표준 품목으로 매핑(다중 매핑) 저장.

    저장 즉시, 보관된 동일 옵션의 기존 raw_line(분할 전 원본 1행)을 컴포넌트별로
    낱개수량 비율 안분해 분할 적재한다. 이미 분할된(line_no '#m') 행은 건드리지 않으며,
    매핑 정의를 수정한 경우엔 채널 재처리(/reprocess)로 재구성하는 것을 권장.
    """
    rp = payload.raw_product_name.strip()
    ro = (payload.raw_option_name or "").strip() or None
    if not payload.components:
        raise HTTPException(400, "components가 비어있습니다 (최소 1개 품목 필요)")

    # 1) 기존 컴포넌트 교체
    db.query(ChannelProductMappingComponent).filter(
        ChannelProductMappingComponent.channel_id == payload.channel_id,
        ChannelProductMappingComponent.raw_product_name == rp,
        ChannelProductMappingComponent.raw_option_name == ro,
    ).delete(synchronize_session=False)

    ch = db.query(Channel).filter(Channel.id == payload.channel_id).first()
    ch_name = payload.channel_name or (ch.name if ch else None)
    for i, c in enumerate(payload.components):
        db.add(ChannelProductMappingComponent(
            channel_id=payload.channel_id,
            channel_name=ch_name,
            raw_product_name=rp,
            raw_option_name=ro,
            product_id=c.product_id,
            unit_per_set=c.unit_per_set or 1,
            sort_order=i,
        ))
    db.commit()

    # 2) unmatched 큐 해결 처리
    pend_q = db.query(ChannelUnmatchedProduct).filter(
        ChannelUnmatchedProduct.channel_id == payload.channel_id,
        ChannelUnmatchedProduct.raw_product_name == rp,
        ChannelUnmatchedProduct.status == "pending",
    )
    if ro:
        pend_q = pend_q.filter(ChannelUnmatchedProduct.raw_option_name == ro)
    for p in pend_q.all():
        p.status = "resolved"
        p.resolved_at = datetime.utcnow()

    # 3) 기존 원본 raw_line(분할 전, '#m' 미포함) 즉시 분할
    comps = [
        type("C", (), {"product_id": c.product_id, "unit_per_set": c.unit_per_set or 1})()
        for c in payload.components
    ]
    line_q = db.query(ChannelSalesRawLine).filter(
        ChannelSalesRawLine.channel_id == payload.channel_id,
        ChannelSalesRawLine.raw_product_name == rp,
        ChannelSalesRawLine.mapping_status != "cancelled",
        ~ChannelSalesRawLine.line_no.like("%#m%"),
    )
    if ro:
        line_q = line_q.filter(ChannelSalesRawLine.raw_option_name == ro)

    split_count = 0
    min_d = max_d = None
    for ln in line_q.all():
        # 보관 금액은 이미 VAT 환산 완료 → 그대로 안분(÷1.1 재적용 금지)
        for pid, pcs, g_i, n_i, _ups in split_by_units(
            ln.gross_amount or 0, ln.net_amount or ln.gross_amount or 0, ln.raw_qty or 0, comps
        ):
            ln_no_i = f"{ln.line_no or ''}#m{pid}"[:100]
            dedup_i = compute_dedup_hash(
                payload.channel_id, ln.order_no, ln_no_i, ln.sale_date,
                ln.raw_product_name, ln.raw_qty, g_i,
            )
            db.add(ChannelSalesRawLine(
                batch_id=ln.batch_id,
                channel_id=payload.channel_id,
                channel_name=ln.channel_name,
                order_no=ln.order_no,
                line_no=ln_no_i,
                dedup_hash=dedup_i,
                sale_date=ln.sale_date,
                sale_datetime=ln.sale_datetime,
                raw_product_name=ln.raw_product_name,
                raw_option_name=ln.raw_option_name,
                raw_qty=ln.raw_qty,
                gross_amount=g_i,
                net_amount=n_i,
                refund_amount=ln.refund_amount,
                product_id=pid,
                pcs_qty=pcs,
                mapping_status="matched",
                raw_row=ln.raw_row,
            ))
        if min_d is None or ln.sale_date < min_d:
            min_d = ln.sale_date
        if max_d is None or ln.sale_date > max_d:
            max_d = ln.sale_date
        db.delete(ln)
        split_count += 1
    db.commit()

    if split_count:
        rebuild_daily_aggregate(db, channel_id=payload.channel_id, since=min_d, until=max_d)
    _bust_all_caches()

    return {
        "channel_id": payload.channel_id,
        "raw_product_name": rp,
        "raw_option_name": ro,
        "component_count": len(payload.components),
        "raw_lines_split": split_count,
    }


@router.delete("/mapping/multi")
def delete_multi_mapping(
    channel_id: str = Query(...),
    raw_product_name: str = Query(...),
    raw_option_name: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    """다중 매핑 삭제. (이미 분할된 raw_line은 채널 재처리로 원복 필요)"""
    ro = (raw_option_name or "").strip() or None
    n = db.query(ChannelProductMappingComponent).filter(
        ChannelProductMappingComponent.channel_id == channel_id,
        ChannelProductMappingComponent.raw_product_name == raw_product_name.strip(),
        ChannelProductMappingComponent.raw_option_name == ro,
    ).delete(synchronize_session=False)
    db.commit()
    _bust_all_caches()
    return {"deleted": n}


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
    _bust_all_caches()
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
    # True = 정산차감형: 변동비가 아니라 매출에서 차감 (예: 쿠팡 로켓프레시 월정액)
    deduct_from_revenue: bool = False
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
    # 채널 한정 규칙이면 그 채널만 동기 재계산, 전역 규칙이면 백그라운드로
    # 전체 재계산 (동기 전체 rebuild는 요청 타임아웃 유발. 2026-07-07 수정)
    if payload.channel_id:
        rebuild_daily_with_costs(db, channel_id=payload.channel_id)
        _bust_all_caches()
        return {"id": rule_id, "rebuild": "done"}
    import threading
    threading.Thread(target=_rebuild_all_costs_background, daemon=True).start()
    return {"id": rule_id, "rebuild": "background"}


def _rebuild_all_costs_background():
    from app.database import SessionLocal
    _db = SessionLocal()
    try:
        rebuild_daily_with_costs(_db)
        _bust_all_caches()
    except Exception:
        log.exception("전역 변동비 재계산 실패")
    finally:
        _db.close()


@router.delete("/cost-rules/{rule_id}")
def delete_cost_rule(rule_id: int, db: Session = Depends(get_db)):
    rule = db.query(CsaCostRule).filter(CsaCostRule.id == rule_id).first()
    if not rule:
        return {"deleted": 0}
    _ch = rule.channel_id
    db.delete(rule)
    db.commit()
    if _ch:
        rebuild_daily_with_costs(db, channel_id=_ch)
        _bust_all_caches()
        return {"deleted": rule_id, "rebuild": "done"}
    import threading
    threading.Thread(target=_rebuild_all_costs_background, daemon=True).start()
    return {"deleted": rule_id, "rebuild": "background"}


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
            "deduct_from_revenue": bool(r.deduct_from_revenue),
            "notes": r.notes,
        } for r in rows
    ]


def _month_range(year: int, month: int) -> tuple[date, date]:
    from calendar import monthrange as _mr
    return date(year, month, 1), date(year, month, _mr(year, month)[1])


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
        existing.deduct_from_revenue = payload.deduct_from_revenue
        existing.notes = payload.notes
        db.commit()
        eid = existing.id
    else:
        m = CsaChannelMonthlyCost(**payload.model_dump())
        db.add(m)
        db.commit()
        eid = m.id
    # 해당 채널×월만 재계산. (과거엔 전 채널·전 기간 rebuild가 동기로 돌아
    # 수분 소요 → 요청 타임아웃으로 '저장 안 됨' 오류. 2026-07-07 수정)
    _s, _e = _month_range(payload.year, payload.month)
    rebuilt = rebuild_daily_with_costs(db, channel_id=payload.channel_id, since=_s, until=_e)
    _bust_all_caches()
    return {"id": eid, "rebuilt_rows": rebuilt}


@router.delete("/channel-monthly-costs/{cost_id}")
def delete_channel_monthly_cost(cost_id: int, db: Session = Depends(get_db)):
    m = db.query(CsaChannelMonthlyCost).filter(CsaChannelMonthlyCost.id == cost_id).first()
    if not m:
        return {"deleted": 0}
    _ch, _y, _mo = m.channel_id, m.year, m.month
    db.delete(m)
    db.commit()
    _s, _e = _month_range(_y, _mo)
    rebuild_daily_with_costs(db, channel_id=_ch, since=_s, until=_e)
    _bust_all_caches()
    return {"deleted": cost_id}


@router.get("/admin/db-stats")
def admin_db_stats(db: Session = Depends(get_db)):
    """pg_stat_activity 요약 — 연결 포화/장기 쿼리/락 대기 진단."""
    from sqlalchemy import text as _text
    rows = db.execute(_text(
        "SELECT state, wait_event_type, count(*) AS n, "
        "       max(EXTRACT(EPOCH FROM (now() - query_start)))::int AS max_age_s "
        "FROM pg_stat_activity WHERE datname = current_database() "
        "GROUP BY state, wait_event_type ORDER BY n DESC"
    )).fetchall()
    long_q = db.execute(_text(
        "SELECT pid, state, EXTRACT(EPOCH FROM (now() - query_start))::int AS age_s, "
        "       left(query, 160) AS q "
        "FROM pg_stat_activity "
        "WHERE datname = current_database() AND state <> 'idle' "
        "  AND query_start < now() - interval '10 seconds' "
        "ORDER BY query_start LIMIT 15"
    )).fetchall()
    return {
        "summary": [dict(r._mapping) for r in rows],
        "long_running": [dict(r._mapping) for r in long_q],
    }


@router.post("/admin/create-channel")
def admin_create_channel(
    name: str,
    category: str = "온라인",
    group_name: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """채널 신규 생성 (+선택적으로 그룹 배정). 이미 있으면 그대로 반환."""
    import uuid as _uuid
    ch = db.query(Channel).filter(Channel.name == name).first()
    created = False
    if ch is None:
        ch = Channel(
            id=str(_uuid.uuid4()), name=name, category=category,
            integration_type="manual", is_active=True,
        )
        db.add(ch)
        db.commit()
        created = True
    group_id = None
    if group_name:
        grp = db.query(ChannelGroup).filter(ChannelGroup.name == group_name).first()
        if grp:
            existing = db.query(ChannelGroupMembership).filter(
                ChannelGroupMembership.channel_id == ch.id
            ).first()
            if existing:
                existing.group_id = grp.id
            else:
                db.add(ChannelGroupMembership(
                    channel_id=ch.id, channel_name=ch.name, group_id=grp.id,
                ))
            db.commit()
            group_id = grp.id
    _bust_all_caches()
    return {"channel_id": ch.id, "name": ch.name, "created": created, "group_id": group_id}


@router.get("/admin/dump-raw-lines")
def admin_dump_raw_lines(
    channel_id: str,
    period_start: date,
    period_end: date,
    limit: int = 2000,
    db: Session = Depends(get_db),
):
    """채널×기간 raw_lines 원자료 덤프 (담당자 시트와 건별 대조용)."""
    rows = db.query(ChannelSalesRawLine).filter(
        ChannelSalesRawLine.channel_id == channel_id,
        ChannelSalesRawLine.sale_date >= period_start,
        ChannelSalesRawLine.sale_date <= period_end,
    ).order_by(ChannelSalesRawLine.sale_date, ChannelSalesRawLine.order_no).limit(limit).all()
    return [
        {
            "sale_date": r.sale_date.isoformat(),
            "order_no": r.order_no,
            "line_no": r.line_no,
            "product": r.raw_product_name,
            "qty": r.raw_qty,
            "gross": r.gross_amount,
            "net": r.net_amount,
            "status": r.mapping_status,
            "batch_id": r.batch_id,
        } for r in rows
    ]


@router.post("/admin/dedup-cross-batch")
def admin_dedup_cross_batch(
    channel_id: str,
    dry_run: bool = True,
    db: Session = Depends(get_db),
):
    """월별 파일 경계 겹침으로 생긴 배치 간 중복 raw_lines 제거.

    같은 (sale_date, order_no, 상품명, 옵션, qty, gross) 키가 서로 다른 배치에
    존재하면, 행의 월과 배치의 주력 월이 일치하는 쪽을 남기고 나머지 삭제.
    (예: 농협몰 25.10.xls에 섞인 9월말 주문 = 25.09.xls와 이중 적재 — line_no의
    행 시퀀스 때문에 dedup_hash가 달라져 업로드 시점 dedup이 못 걸렀음.)
    같은 배치 내 동일 키 복수 행은 정상 라인으로 보고 건드리지 않는다.
    """
    from collections import Counter as _Counter, defaultdict as _dd
    rows = db.query(ChannelSalesRawLine).filter(
        ChannelSalesRawLine.channel_id == channel_id
    ).all()
    bm: dict = _dd(_Counter)
    for r in rows:
        bm[r.batch_id][(r.sale_date.year, r.sale_date.month)] += 1
    dominant = {b: c.most_common(1)[0][0] for b, c in bm.items()}
    def _norm_order(v) -> str:
        """주문번호 정규화 — 배치마다 '000875'(텍스트) vs '875.0'(숫자 변환)로
        저장 형식이 갈려 중복 키가 어긋나는 문제 해소."""
        s = str(v or "").strip()
        if s.endswith(".0"):
            s = s[:-2]
        return s.lstrip("0") or s

    groups: dict = _dd(list)
    for r in rows:
        key = (
            r.sale_date, _norm_order(r.order_no),
            (r.raw_product_name or "").strip(), (r.raw_option_name or "").strip(),
            float(r.raw_qty or 0), round(float(r.gross_amount or 0), 2),
        )
        groups[key].append(r)
    to_delete = []
    samples = []
    for key, rs in groups.items():
        if len({r.batch_id for r in rs}) < 2:
            continue
        month = (key[0].year, key[0].month)
        keep = [r for r in rs if dominant.get(r.batch_id) == month]
        if not keep:
            keep = [rs[0]]
        keep_ids = {r.id for r in keep}
        drop = [r for r in rs if r.id not in keep_ids]
        to_delete.extend(drop)
        if drop and len(samples) < 20:
            samples.append({
                "date": key[0].isoformat(), "order": key[1],
                "amt": key[5], "drop_n": len(drop),
            })
    total = sum(float(r.net_amount or 0) for r in to_delete)
    if not dry_run and to_delete:
        for r in to_delete:
            db.delete(r)
        db.commit()
        rebuild_daily_aggregate(db, channel_id=channel_id)
        _bust_all_caches()
    return {
        "candidates": len(to_delete), "net_sum": total,
        "dry_run": dry_run, "samples": samples,
    }


@router.post("/admin/apply-vat-division")
def admin_apply_vat_division(
    channel_id: str,
    db: Session = Depends(get_db),
):
    """VAT_INCLUDED 누락 채널의 기존 raw_lines에 ÷1.1 일괄 소급 적용 (1회성).

    ingest 시점에 환산하는 구조라 세트에 뒤늦게 추가된 채널의 과거 데이터는
    소비자가 그대로 저장돼 있음 → gross/net/refund/settlement ÷1.1 후 daily 재계산.
    ⚠️ 두 번 호출하면 이중 환산되므로 주의.
    """
    factor = 1 / 1.1
    n = db.query(ChannelSalesRawLine).filter(
        ChannelSalesRawLine.channel_id == channel_id,
    ).update({
        "gross_amount": ChannelSalesRawLine.gross_amount * factor,
        "net_amount": ChannelSalesRawLine.net_amount * factor,
        "refund_amount": ChannelSalesRawLine.refund_amount * factor,
        "settlement_amount": ChannelSalesRawLine.settlement_amount * factor,
    }, synchronize_session=False)
    db.commit()
    rebuilt = rebuild_daily_aggregate(db, channel_id=channel_id)
    _bust_all_caches()
    return {"raw_lines_updated": n, "daily_rebuilt": rebuilt}


@router.post("/admin/resolve-stale-unmatched")
def admin_resolve_stale_unmatched(
    channel_id: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """매핑이 이미 생겼는데 pending으로 남은 미매칭 큐 항목을 resolved 처리.

    auto-map은 raw_lines/매핑만 갱신하고 검토 큐는 안 건드려 스테일이 남는다.
    """
    q = db.query(ChannelUnmatchedProduct).filter(
        ChannelUnmatchedProduct.status == "pending"
    )
    if channel_id:
        q = q.filter(ChannelUnmatchedProduct.channel_id == channel_id)
    resolved = 0
    for u in q.all():
        mq = db.query(ChannelProductMapping).filter(
            ChannelProductMapping.channel_id == u.channel_id,
            ChannelProductMapping.raw_product_name == u.raw_product_name,
            ChannelProductMapping.product_id.isnot(None),
        )
        if u.raw_option_name:
            m = (
                mq.filter(ChannelProductMapping.raw_option_name == u.raw_option_name).first()
                or mq.filter(ChannelProductMapping.raw_option_name.is_(None)).first()
            )
        else:
            m = mq.filter(ChannelProductMapping.raw_option_name.is_(None)).first() or mq.first()
        if m is None:
            continue
        u.status = "resolved"
        u.resolved_product_id = m.product_id
        u.resolved_unit_per_set = m.unit_per_set
        u.resolved_at = datetime.utcnow()
        resolved += 1
    db.commit()
    return {"resolved": resolved}


@router.post("/admin/set-monthly-cost-deduct")
def set_monthly_cost_deduct(
    channel_id: str,
    cost_item_id: int,
    deduct: bool = True,
    db: Session = Depends(get_db),
):
    """채널×비용항목의 모든 월정액 입력에 매출차감 플래그 일괄 설정.

    건별 upsert는 매 건 전체 rebuild가 돌아 무거우므로, 일괄 UPDATE 후
    해당 채널만 스코프 재계산. (스코프 rebuild는 raw가 daily를 전부 커버하는
    채널에만 안전 — BQ-only daily가 있는 채널이면 손실 위험.)
    """
    n = db.query(CsaChannelMonthlyCost).filter(
        CsaChannelMonthlyCost.channel_id == channel_id,
        CsaChannelMonthlyCost.cost_item_id == cost_item_id,
    ).update({"deduct_from_revenue": deduct}, synchronize_session=False)
    db.commit()
    rebuilt = rebuild_daily_with_costs(db, channel_id=channel_id)
    _bust_all_caches()
    return {"updated": n, "rebuilt_rows": rebuilt, "deduct": deduct}


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


_DASH_CACHE: dict = {}
_DASH_TTL_SEC = 300  # 업로드/매핑 변경 시 _bust_dash_cache()로 무효화


@router.get("/dashboard")
def dashboard(
    period_start: date,
    period_end: date,
    granularity: str = Query("month", regex="^(day|month|quarter|year)$"),
    channel_ids: Optional[str] = Query(None, description="콤마구분 channel_id"),
    product_ids: Optional[str] = Query(None, description="콤마구분 product_id"),
    employee_ids: Optional[str] = Query(None, description="콤마구분 employee_id (담당 채널로 변환)"),
    force: bool = False,
    db: Session = Depends(get_db),
):
    import time as _time
    def _dlap(label):
        pass
    # 날짜 입력 중 키 입력마다 fetch가 나가면 '0002-07-01' 같은 연도가 들어와
    # 2000년치 범위를 만들다 인스턴스가 죽는(OOM→503) 사고 방지 (2026-07-01 실사고).
    # 데이터는 2024년 이후뿐이므로 그 이전/비정상 연도는 클램프.
    if period_start.year < 2020:
        period_start = date(2020, 1, 1)
    if period_end.year > 2100:
        period_end = date(2100, 12, 31)
    if period_end < period_start:
        raise HTTPException(400, "period_end가 period_start보다 빠릅니다")
    cache_key = (str(period_start), str(period_end), granularity,
                 channel_ids or "", product_ids or "", employee_ids or "")
    now = _time.time()
    if not force:
        cached = _DASH_CACHE.get(cache_key)
        if cached and cached["expires"] > now:
            return {**cached["data"], "_cached": True}

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

    _dlap("filters")
    if product_ids:
        ids = [int(s) for s in product_ids.split(",") if s.strip()]
        if ids:
            q = q.filter(ChannelSalesDailyProduct.product_id.in_(ids))

    rows = q.all()
    _dlap(f"main_query({len(rows)} rows)")

    # 집계 — 매출은 매출차감형 월정액(revenue_deduction, 예: 쿠팡 로켓프레시)을 뺀 실수령 기준
    def _rev(r) -> float:
        return (r.net_sales or 0) - (r.revenue_deduction or 0)

    total_deduction = sum(r.revenue_deduction or 0 for r in rows)
    total_revenue = sum(_rev(r) for r in rows)
    total_pcs = sum(r.pcs_qty or 0 for r in rows)
    total_orders = sum(r.order_count or 0 for r in rows)
    total_cost = sum(r.variable_cost or 0 for r in rows)
    total_commission = sum(r.commission or 0 for r in rows)
    total_cm = sum(r.contribution_margin or 0 for r in rows)
    cm_rate = (total_cm / total_revenue * 100) if total_revenue else 0

    # 취소/환불 확정 집계 — 매출엔 미반영(daily에서 제외됨), 별도 지표로 표시.
    # raw_lines의 mapping_status='cancelled' 행을 기간/채널 필터로 직접 집계.
    _cancel_q = db.query(
        func.count(ChannelSalesRawLine.id),
        func.coalesce(func.sum(ChannelSalesRawLine.refund_amount), 0),
    ).filter(
        ChannelSalesRawLine.mapping_status == "cancelled",
        ChannelSalesRawLine.sale_date >= period_start,
        ChannelSalesRawLine.sale_date <= period_end,
    )
    if selected_channels:
        _cancel_q = _cancel_q.filter(ChannelSalesRawLine.channel_id.in_(list(selected_channels)))
    _cancel_count, _cancel_amount = _cancel_q.one()

    # 변동비 카테고리별 분해
    cost_breakdown = {
        "cogs": sum(r.cost_cogs or 0 for r in rows),
        "labor": sum(r.cost_labor or 0 for r in rows),
        "overhead": sum(r.cost_overhead or 0 for r in rows),
        "logistics_work": sum(r.cost_logistics_work or 0 for r in rows),
        "logistics_oh": sum(r.cost_logistics_oh or 0 for r in rows),
        "advertising": sum(r.cost_advertising or 0 for r in rows),
        "platform_fee": sum(r.cost_platform_fee or 0 for r in rows),
        "commission_rate": sum(r.cost_commission_rate or 0 for r in rows),
        "commission_fixed": sum(r.cost_commission_fixed or 0 for r in rows),
        "shipping": sum(r.cost_shipping or 0 for r in rows),
        "packaging": sum(r.cost_packaging or 0 for r in rows),
    }

    # 구분(그룹) 집계 — 3종 (온라인(위탁)/온라인(사입)/오프라인)
    # 마스터 맵은 메모리 캐시(5분)에서 — 매 요청 2쿼리(×309ms) 제거
    _mm = _get_master_maps(db)
    _dlap("master_maps")
    group_map = _mm["group_map"]
    group_names = _mm["group_names"]
    by_group: dict = {}
    for r in rows:
        gname = group_names.get(group_map.get(r.channel_id)) or "미분류"
        slot = by_group.setdefault(gname, {
            "group": gname, "revenue": 0, "pcs": 0,
            "contribution_margin": 0, "orders": 0,
        })
        slot["revenue"] += _rev(r)
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
        slot["revenue"] += _rev(r)
        slot["pcs"] += r.pcs_qty or 0
        slot["orders"] += r.order_count or 0
        slot["cost"] += r.variable_cost or 0
        slot["commission"] += r.commission or 0
        slot["contribution_margin"] += r.contribution_margin or 0
    series = sorted(series_map.values(), key=lambda x: x["period"])

    # 담당자 × 기간 히트맵 (매출/수량) — 채널→담당자 매핑으로 집계
    def _pkey(r) -> str:
        if granularity == "day":
            return r.sale_date.isoformat()
        if granularity == "month":
            return f"{r.year}-{r.month:02d}"
        if granularity == "quarter":
            return f"{r.year}-Q{r.quarter}"
        return f"{r.year}"

    ch_to_emp: dict[str, str] = {}
    _emp_rows = db.query(
        EmployeeChannelAssignment.channel_id, Employee.name,
    ).join(Employee, Employee.id == EmployeeChannelAssignment.employee_id).filter(
        EmployeeChannelAssignment.is_active.is_(True)
    ).all()
    for cid, ename in _emp_rows:
        ch_to_emp.setdefault(cid, ename)

    heat_cells: dict[tuple, dict] = {}
    heat_emp_total: dict[str, float] = {}
    heat_periods: set[str] = set()
    for r in rows:
        ename = ch_to_emp.get(r.channel_id) or "미배정"
        pk = _pkey(r)
        heat_periods.add(pk)
        slot = heat_cells.setdefault((ename, pk), {
            "employee": ename, "period": pk,
            "revenue": 0, "pcs": 0, "contribution_margin": 0,
        })
        slot["revenue"] += _rev(r)
        slot["pcs"] += r.pcs_qty or 0
        slot["contribution_margin"] += r.contribution_margin or 0
        heat_emp_total[ename] = heat_emp_total.get(ename, 0) + _rev(r)
    heatmap = {
        "periods": sorted(heat_periods),
        "employees": sorted(heat_emp_total.keys(), key=lambda e: -heat_emp_total[e]),
        "cells": list(heat_cells.values()),
    }

    # 채널별 합계
    by_channel: dict[str, dict] = {}
    for r in rows:
        slot = by_channel.setdefault(r.channel_id, {
            "channel_id": r.channel_id,
            "channel_name": r.channel_name,
            "channel_category": r.channel_category,
            "revenue": 0, "pcs": 0, "orders": 0,
            "contribution_margin": 0, "revenue_deduction": 0,
        })
        slot["revenue"] += _rev(r)
        slot["revenue_deduction"] += r.revenue_deduction or 0
        slot["pcs"] += r.pcs_qty or 0
        slot["orders"] += r.order_count or 0
        slot["contribution_margin"] += r.contribution_margin or 0
    channels_summary = sorted(by_channel.values(), key=lambda x: -x["revenue"])

    # 품목별 합계 — 미매핑(product_id=None)은 '(미매핑)' 단일 항목으로 묶어 포함.
    # (제외하면 품목별 합계가 상단 KPI/채널별 합계와 어긋남.)
    by_product: dict[int, dict] = {}
    for r in rows:
        pid = r.product_id if r.product_id is not None else 0
        pname = r.product_name if r.product_id is not None else "(미매핑)"
        slot = by_product.setdefault(pid, {
            "product_id": pid,
            "product_name": pname,
            "revenue": 0, "pcs": 0, "orders": 0,
            "contribution_margin": 0,
        })
        slot["revenue"] += _rev(r)
        slot["pcs"] += r.pcs_qty or 0
        slot["orders"] += r.order_count or 0
        slot["contribution_margin"] += r.contribution_margin or 0
    products_summary = sorted(by_product.values(), key=lambda x: -x["revenue"])
    for p in products_summary:
        p["cm_rate"] = (p["contribution_margin"] / p["revenue"] * 100) if p["revenue"] else 0
    for c in channels_summary:
        c["cm_rate"] = (c["contribution_margin"] / c["revenue"] * 100) if c["revenue"] else 0

    resp = {
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
            "cancelled_count": int(_cancel_count or 0),
            "cancelled_amount": float(_cancel_amount or 0),
            # 매출차감형 월정액 합계 (예: 쿠팡 로켓프레시) — 위 revenue는 이미 차감 후 금액
            "revenue_deduction": total_deduction,
        },
        "cost_breakdown": cost_breakdown,
        "series": series,
        "heatmap": heatmap,
        "channels": channels_summary,
        "products": products_summary,
        "groups": groups_summary,
        "granularity": granularity,
        "period_start": period_start.isoformat(),
        "period_end": period_end.isoformat(),
        "_cached": False,
    }
    _DASH_CACHE[cache_key] = {"data": {k: v for k, v in resp.items() if k != "_cached"},
                              "expires": now + _DASH_TTL_SEC}
    return resp


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
        _bust_all_caches()
        return {"id": existing.id, "updated": True}
    e = Employee(**payload.model_dump())
    db.add(e)
    db.commit()
    _bust_all_caches()
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
    _bust_all_caches()
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
    _bust_all_caches()
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
    _bust_all_caches()
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
    import time as _time
    _ps_key = ("summary", year)
    _ps_now = _time.time()
    _ps_cached = _PLAN_CACHE.get(_ps_key)
    if _ps_cached and _ps_cached["expires"] > _ps_now:
        return {**_ps_cached["data"], "_cached": True}
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
    _ps_resp = {
        "year": year,
        "total_revenue_target": rev_total,
        "total_pcs_target": qty_total,
        "by_group": [{"group": g or "미분류", "target_revenue": float(v or 0)} for g, v in by_group_rev],
        "by_employee": [
            {"employee_id": eid, "employee": en or "미배정", "target_revenue": float(v or 0)}
            for eid, en, v in by_employee
        ],
        "_cached": False,
    }
    _PLAN_CACHE[_ps_key] = {"data": {k: v for k, v in _ps_resp.items() if k != "_cached"},
                            "expires": _ps_now + _PLAN_TTL_SEC}
    return _ps_resp


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
    import time as _time
    _pc_key = (year, month, up_to_today, by)
    _pc_now = _time.time()
    _pc_cached = _PLAN_CACHE.get(_pc_key)
    if _pc_cached and _pc_cached["expires"] > _pc_now:
        return {**_pc_cached["data"], "_cached": True}

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

    # 채널-그룹/직원 매핑 — 메모리 캐시(5분)에서 (매 요청 5쿼리×309ms 제거)
    _mm = _get_master_maps(db)
    group_map = _mm["group_map"]
    group_names = _mm["group_names"]
    emp_channel = _mm["emp_channel"]
    emp_names = _mm["emp_names"]
    prod_categories = _mm["prod_categories"]

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
        slot["actual_revenue"] += (r.net_sales or 0) - (r.revenue_deduction or 0)
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
    _pc_resp = {"year": year, "month": month, "by": by, "items": items, "_cached": False}
    _PLAN_CACHE[_pc_key] = {"data": {k: v for k, v in _pc_resp.items() if k != "_cached"},
                            "expires": _pc_now + _PLAN_TTL_SEC}
    return _pc_resp


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


_PNL_CACHE: dict = {}  # year -> {"data":..., "expires":...}
_PNL_TTL_SEC = 300  # 업로드/PNL값 수정 시 _bust_pnl_cache()로 무효화


@router.get("/pnl")
def pnl_matrix(year: int, force: bool = False, db: Session = Depends(get_db)):
    import time as _time
    now = _time.time()
    cached = _PNL_CACHE.get(year)
    if not force and cached and cached["expires"] > now:
        return {**cached["data"], "_timing_ms": 0, "_cached": True}
    _t0 = _time.time()
    result = get_pnl_matrix(db, year)
    elapsed_ms = int((_time.time() - _t0) * 1000)
    if isinstance(result, dict):
        result["_timing_ms"] = elapsed_ms
        result["_cached"] = False
        _PNL_CACHE[year] = {"data": {k: v for k, v in result.items() if not k.startswith("_")},
                            "expires": now + _PNL_TTL_SEC}
    return result


def _bust_pnl_cache():
    _PNL_CACHE.clear()


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
    _bust_pnl_cache()  # PNL 값 수정 → 캐시 무효화
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

@router.get("/admin/db-latency")
def admin_db_latency(n: int = 8, db: Session = Depends(get_db)):
    """백엔드↔Supabase 순수 네트워크 RTT 측정.

    SELECT 1을 n회 반복해 쿼리당 왕복 시간을 잰다.
    - 같은 지역(예: Railway Singapore ↔ Supabase Seoul): 보통 1쿼리 70~90ms
    - 다른 대륙(예: Railway US ↔ Supabase Seoul): 250~350ms
    첫 쿼리는 pool_pre_ping + 연결 수립 비용이 포함되어 더 느릴 수 있음.
    """
    import time as _time
    from sqlalchemy import text as _text
    timings = []
    for i in range(max(1, min(n, 30))):
        t = _time.time()
        db.execute(_text("SELECT 1")).scalar()
        timings.append(round((_time.time() - t) * 1000, 1))
    warm = timings[1:] if len(timings) > 1 else timings
    import os as _os
    region_env = {k: v for k, v in _os.environ.items()
                  if "REGION" in k.upper() or "RAILWAY_REPLICA" in k.upper()}
    # 컨테이너 외부 IP geolocation (실제 물리 위치 확인)
    geo = {}
    try:
        import httpx as _httpx
        r = _httpx.get("https://ipinfo.io/json", timeout=4.0)
        if r.status_code == 200:
            j = r.json()
            geo = {"ip": j.get("ip"), "city": j.get("city"), "region": j.get("region"), "country": j.get("country"), "org": j.get("org")}
    except Exception as _e:
        geo = {"error": str(_e)[:100]}
    return {
        "per_query_ms": timings,
        "first_ms": timings[0],
        "warm_avg_ms": round(sum(warm) / len(warm), 1),
        "warm_min_ms": min(warm),
        "railway_region_env": region_env,
        "container_geo": geo,
        "note": "warm_min_ms가 순수 1쿼리 RTT. container_geo.country로 실제 위치 확인.",
    }


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


@router.post("/admin/auto-map-unmatched")
def admin_auto_map_unmatched(
    channel_id: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """unmatched 상태 raw_lines를 표준 SKU/alias 기반으로 자동 매핑.

    각 unique (channel, raw_product_name, raw_option_name)에 대해
    resolve_product 호출 → matched이면 ChannelProductMapping 등록 +
    raw_lines 갱신. 마지막에 daily 재build.
    """
    from app.services.csa_service import resolve_product
    from app.db_models import ChannelSalesRawLine, ChannelProductMapping, ProductMaster
    from sqlalchemy import func as sa_func

    masters = db.query(ProductMaster).filter(ProductMaster.is_active.is_(True)).all()

    q = db.query(
        ChannelSalesRawLine.channel_id,
        ChannelSalesRawLine.channel_name,
        ChannelSalesRawLine.raw_product_name,
        ChannelSalesRawLine.raw_option_name,
        sa_func.count(ChannelSalesRawLine.id).label("lines"),
    ).filter(ChannelSalesRawLine.mapping_status == "unmatched")
    if channel_id:
        q = q.filter(ChannelSalesRawLine.channel_id == channel_id)
    q = q.group_by(
        ChannelSalesRawLine.channel_id,
        ChannelSalesRawLine.channel_name,
        ChannelSalesRawLine.raw_product_name,
        ChannelSalesRawLine.raw_option_name,
    )
    groups = q.all()

    matched_keys = 0
    matched_lines = 0
    samples = []
    for g in groups:
        result = resolve_product(
            db, g.channel_id, g.raw_product_name or "", g.raw_option_name,
            masters_cache=masters,
        )
        if result.status != "matched" or result.product_id is None:
            continue

        existing = db.query(ChannelProductMapping).filter(
            ChannelProductMapping.channel_id == g.channel_id,
            ChannelProductMapping.raw_product_name == g.raw_product_name,
            ChannelProductMapping.raw_option_name == g.raw_option_name,
        ).first()
        if existing:
            existing.product_id = result.product_id
            existing.is_excluded = False
            existing.confidence = "auto"
        else:
            db.add(ChannelProductMapping(
                channel_id=g.channel_id,
                channel_name=g.channel_name,
                raw_product_name=g.raw_product_name,
                raw_option_name=g.raw_option_name,
                product_id=result.product_id,
                unit_per_set=result.unit_per_set or 1,
                confidence="auto",
                is_excluded=False,
            ))

        upd = db.query(ChannelSalesRawLine).filter(
            ChannelSalesRawLine.channel_id == g.channel_id,
            ChannelSalesRawLine.raw_product_name == g.raw_product_name,
            ChannelSalesRawLine.mapping_status == "unmatched",
        )
        if g.raw_option_name is None:
            upd = upd.filter(ChannelSalesRawLine.raw_option_name.is_(None))
        else:
            upd = upd.filter(ChannelSalesRawLine.raw_option_name == g.raw_option_name)
        n = upd.update({
            "product_id": result.product_id,
            "pcs_qty": ChannelSalesRawLine.raw_qty * (result.unit_per_set or 1),
            "mapping_status": "matched",
        }, synchronize_session=False)
        matched_keys += 1
        matched_lines += n
        if len(samples) < 20:
            samples.append({
                "raw": g.raw_product_name,
                "product": result.product_name,
                "lines": n,
            })
    db.commit()

    rebuilt = rebuild_daily_aggregate(db, channel_id=channel_id)
    return {
        "matched_keys": matched_keys,
        "matched_lines": matched_lines,
        "samples": samples,
        "daily_rebuilt": rebuilt,
    }


@router.get("/admin/diag-product-units")
def admin_diag_product_units(
    channel_id: str,
    period_start: date,
    period_end: date,
    db: Session = Depends(get_db),
):
    """채널/기간의 SKU(product_id)별 raw_qty/매출/평균단가 집계.

    낱개 단가가 비현실적이면 unit_per_set 환산이 잘못된 신호.
    """
    from app.db_models import ChannelSalesRawLine, ProductMaster
    from sqlalchemy import func as sa_func
    rows = db.query(
        ChannelSalesRawLine.product_id,
        ProductMaster.name.label("product_name"),
        sa_func.count(ChannelSalesRawLine.id).label("lines"),
        sa_func.sum(ChannelSalesRawLine.raw_qty).label("qty"),
        sa_func.sum(ChannelSalesRawLine.pcs_qty).label("pcs"),
        sa_func.sum(ChannelSalesRawLine.gross_amount).label("gross"),
    ).outerjoin(
        ProductMaster, ProductMaster.id == ChannelSalesRawLine.product_id
    ).filter(
        ChannelSalesRawLine.channel_id == channel_id,
        ChannelSalesRawLine.sale_date >= period_start,
        ChannelSalesRawLine.sale_date <= period_end,
        ChannelSalesRawLine.mapping_status == "matched",
    ).group_by(
        ChannelSalesRawLine.product_id, ProductMaster.name,
    ).order_by(sa_func.sum(ChannelSalesRawLine.gross_amount).desc()).all()
    return [
        {
            "product_id": r.product_id,
            "product_name": r.product_name,
            "lines": r.lines,
            "raw_qty": float(r.qty or 0),
            "pcs_qty": float(r.pcs or 0),
            "gross": float(r.gross or 0),
            "unit_price_per_raw": float(r.gross or 0) / float(r.qty or 1) if r.qty else 0,
            "unit_price_per_pcs": float(r.gross or 0) / float(r.pcs or 1) if r.pcs else 0,
        }
        for r in rows
    ]


@router.post("/admin/bulk-set-unit-by-product")
def admin_bulk_set_unit_by_product(
    channel_id: str,
    product_id: int,
    unit_per_set: int,
    db: Session = Depends(get_db),
):
    """채널의 특정 product_id에 해당하는 모든 매핑의 unit_per_set 일괄 변경.

    매핑이 없으면 자동 생성하지 않음(이미 매칭된 raw_lines에는 영향 없음).
    raw_lines.pcs_qty도 함께 재계산.
    """
    from app.db_models import ChannelProductMapping, ChannelSalesRawLine
    n_map = db.query(ChannelProductMapping).filter(
        ChannelProductMapping.channel_id == channel_id,
        ChannelProductMapping.product_id == product_id,
    ).update({"unit_per_set": unit_per_set}, synchronize_session=False)
    n_raw = db.query(ChannelSalesRawLine).filter(
        ChannelSalesRawLine.channel_id == channel_id,
        ChannelSalesRawLine.product_id == product_id,
        ChannelSalesRawLine.mapping_status == "matched",
    ).update({"pcs_qty": ChannelSalesRawLine.raw_qty * unit_per_set}, synchronize_session=False)
    db.commit()
    rebuilt = rebuild_daily_aggregate(db, channel_id=channel_id)
    return {
        "mappings_updated": n_map,
        "raw_lines_pcs_updated": n_raw,
        "daily_rebuilt": rebuilt,
    }


@router.get("/admin/list-mappings")
def admin_list_mappings(channel_id: str, db: Session = Depends(get_db)):
    """채널의 ChannelProductMapping 전체 조회 (product 이름 join)."""
    from app.db_models import ChannelProductMapping, ProductMaster, ChannelSalesRawLine
    from sqlalchemy import func as sa_func
    rows = db.query(
        ChannelProductMapping.id,
        ChannelProductMapping.raw_product_name,
        ChannelProductMapping.raw_option_name,
        ChannelProductMapping.product_id,
        ChannelProductMapping.unit_per_set,
        ChannelProductMapping.is_excluded,
        ProductMaster.name.label("product_name"),
    ).outerjoin(
        ProductMaster, ProductMaster.id == ChannelProductMapping.product_id
    ).filter(
        ChannelProductMapping.channel_id == channel_id,
    ).all()
    out = []
    for r in rows:
        # 라인 수와 매출 합계 추가
        stats = db.query(
            sa_func.count(ChannelSalesRawLine.id).label("lines"),
            sa_func.sum(ChannelSalesRawLine.raw_qty).label("qty"),
            sa_func.sum(ChannelSalesRawLine.gross_amount).label("gross"),
        ).filter(
            ChannelSalesRawLine.channel_id == channel_id,
            ChannelSalesRawLine.raw_product_name == r.raw_product_name,
        ).first()
        out.append({
            "id": r.id,
            "raw_product_name": r.raw_product_name,
            "raw_option_name": r.raw_option_name,
            "product_id": r.product_id,
            "product_name": r.product_name,
            "unit_per_set": r.unit_per_set,
            "is_excluded": r.is_excluded,
            "lines": stats.lines or 0,
            "raw_qty": float(stats.qty or 0),
            "gross": float(stats.gross or 0),
        })
    return out


@router.post("/admin/set-mapping-unit")
def admin_set_mapping_unit(
    mapping_id: int,
    unit_per_set: int,
    db: Session = Depends(get_db),
):
    """단일 매핑의 unit_per_set 변경."""
    from app.db_models import ChannelProductMapping
    m = db.query(ChannelProductMapping).filter(ChannelProductMapping.id == mapping_id).first()
    if not m:
        raise HTTPException(404, "mapping not found")
    old = m.unit_per_set
    m.unit_per_set = unit_per_set
    db.commit()
    return {"mapping_id": mapping_id, "old": old, "new": unit_per_set}


@router.get("/admin/list-unmatched-raw")
def admin_list_unmatched_raw(
    channel_id: str,
    limit: int = 100,
    db: Session = Depends(get_db),
):
    """채널의 unmatched raw_product_name 목록 (집계)."""
    from app.db_models import ChannelSalesRawLine
    from sqlalchemy import func as sa_func
    q = db.query(
        ChannelSalesRawLine.raw_product_name,
        ChannelSalesRawLine.raw_option_name,
        sa_func.count(ChannelSalesRawLine.id).label("lines"),
        sa_func.sum(ChannelSalesRawLine.gross_amount).label("gross"),
    ).filter(
        ChannelSalesRawLine.channel_id == channel_id,
        ChannelSalesRawLine.mapping_status == "unmatched",
    ).group_by(
        ChannelSalesRawLine.raw_product_name,
        ChannelSalesRawLine.raw_option_name,
    ).order_by(sa_func.sum(ChannelSalesRawLine.gross_amount).desc()).limit(limit)
    return [
        {
            "raw_product_name": r.raw_product_name,
            "raw_option_name": r.raw_option_name,
            "lines": r.lines,
            "gross": float(r.gross or 0),
        }
        for r in q.all()
    ]


@router.delete("/admin/delete-channel/{channel_id}")
def admin_delete_channel(channel_id: str, db: Session = Depends(get_db)):
    """채널 자체와 그에 딸린 모든 데이터를 완전 삭제 (raw/daily/batches/매핑/큐).

    중복 채널 정리용. DEFAULT_CHANNELS 시드에 있는 채널은 다음 시드 시 재생성됨.
    """
    from app.db_models import (
        Channel,
        ChannelSalesRawLine,
        ChannelSalesUploadBatch,
        ChannelSalesDailyProduct,
        ChannelUnmatchedProduct,
        ChannelProductMapping,
    )
    raw_n = db.query(ChannelSalesRawLine).filter(
        ChannelSalesRawLine.channel_id == channel_id
    ).delete(synchronize_session=False)
    daily_n = db.query(ChannelSalesDailyProduct).filter(
        ChannelSalesDailyProduct.channel_id == channel_id
    ).delete(synchronize_session=False)
    batch_n = db.query(ChannelSalesUploadBatch).filter(
        ChannelSalesUploadBatch.channel_id == channel_id
    ).delete(synchronize_session=False)
    unm_n = db.query(ChannelUnmatchedProduct).filter(
        ChannelUnmatchedProduct.channel_id == channel_id
    ).delete(synchronize_session=False)
    map_n = db.query(ChannelProductMapping).filter(
        ChannelProductMapping.channel_id == channel_id
    ).delete(synchronize_session=False)
    ch = db.query(Channel).filter(Channel.id == channel_id).first()
    name = ch.name if ch else None
    if ch:
        db.delete(ch)
    db.commit()
    return {
        "channel_id": channel_id,
        "channel_name": name,
        "channel_deleted": ch is not None,
        "raw_lines_deleted": raw_n,
        "daily_rows_deleted": daily_n,
        "batches_deleted": batch_n,
        "unmatched_queue_deleted": unm_n,
        "mappings_deleted": map_n,
    }


@router.post("/admin/merge-channels")
def admin_merge_channels(
    src_channel_id: str,
    dst_channel_id: str,
    db: Session = Depends(get_db),
):
    """src 채널의 모든 데이터(raw/daily/batches/매핑/큐)를 dst 채널로 이전 후 src 삭제."""
    from app.db_models import (
        Channel,
        ChannelSalesRawLine,
        ChannelSalesUploadBatch,
        ChannelSalesDailyProduct,
        ChannelUnmatchedProduct,
        ChannelProductMapping,
    )
    dst = db.query(Channel).filter(Channel.id == dst_channel_id).first()
    if not dst:
        raise HTTPException(404, "dst channel not found")

    # channel_id를 dst로 갱신
    raw_n = db.query(ChannelSalesRawLine).filter(
        ChannelSalesRawLine.channel_id == src_channel_id
    ).update({"channel_id": dst_channel_id, "channel_name": dst.name}, synchronize_session=False)
    daily_n = db.query(ChannelSalesDailyProduct).filter(
        ChannelSalesDailyProduct.channel_id == src_channel_id
    ).update({"channel_id": dst_channel_id, "channel_name": dst.name}, synchronize_session=False)
    batch_n = db.query(ChannelSalesUploadBatch).filter(
        ChannelSalesUploadBatch.channel_id == src_channel_id
    ).update({"channel_id": dst_channel_id, "channel_name": dst.name}, synchronize_session=False)
    unm_n = db.query(ChannelUnmatchedProduct).filter(
        ChannelUnmatchedProduct.channel_id == src_channel_id
    ).update({"channel_id": dst_channel_id, "channel_name": dst.name}, synchronize_session=False)
    map_n = db.query(ChannelProductMapping).filter(
        ChannelProductMapping.channel_id == src_channel_id
    ).update({"channel_id": dst_channel_id, "channel_name": dst.name}, synchronize_session=False)

    src = db.query(Channel).filter(Channel.id == src_channel_id).first()
    if src:
        db.delete(src)
    db.commit()

    rebuilt = rebuild_daily_aggregate(db, channel_id=dst_channel_id)
    return {
        "src_channel_id": src_channel_id,
        "dst_channel_id": dst_channel_id,
        "raw_lines_moved": raw_n,
        "daily_rows_moved": daily_n,
        "batches_moved": batch_n,
        "unmatched_moved": unm_n,
        "mappings_moved": map_n,
        "src_channel_deleted": src is not None,
        "daily_rebuilt": rebuilt,
    }


@router.post("/admin/cleanup-vat-incl-channels")
def admin_cleanup_vat_incl_channels(db: Session = Depends(get_db)):
    """B2C(부가세 포함) 채널들의 모든 raw/daily/batches/큐를 일괄 cleanup.

    부가세 별도 통일 정책 도입 후 신규 ingest는 자동 환산되지만,
    기존 적재 데이터는 환산 안 된 상태라 cleanup 후 재업로드 필요.
    매핑은 보존.
    """
    from app.db_models import (
        Channel,
        ChannelSalesRawLine,
        ChannelSalesUploadBatch,
        ChannelSalesDailyProduct,
        ChannelUnmatchedProduct,
    )
    from app.services.csa_service import VAT_INCLUDED_CHANNELS

    # 채널명이 VAT_INCLUDED_CHANNELS에 속하는 채널들의 id 모두 추출
    channels = db.query(Channel).filter(
        Channel.name.in_(list(VAT_INCLUDED_CHANNELS))
    ).all()

    results = []
    total_raw = total_daily = total_batch = total_unm = 0
    for ch in channels:
        raw_n = db.query(ChannelSalesRawLine).filter(
            ChannelSalesRawLine.channel_id == ch.id
        ).delete(synchronize_session=False)
        daily_n = db.query(ChannelSalesDailyProduct).filter(
            ChannelSalesDailyProduct.channel_id == ch.id
        ).delete(synchronize_session=False)
        batch_n = db.query(ChannelSalesUploadBatch).filter(
            ChannelSalesUploadBatch.channel_id == ch.id
        ).delete(synchronize_session=False)
        unm_n = db.query(ChannelUnmatchedProduct).filter(
            ChannelUnmatchedProduct.channel_id == ch.id
        ).delete(synchronize_session=False)
        if raw_n or daily_n or batch_n or unm_n:
            results.append({
                "channel_id": ch.id,
                "channel_name": ch.name,
                "raw_lines": raw_n,
                "daily_rows": daily_n,
                "batches": batch_n,
                "unmatched": unm_n,
            })
        total_raw += raw_n
        total_daily += daily_n
        total_batch += batch_n
        total_unm += unm_n
    db.commit()
    return {
        "channels_processed": len(channels),
        "channels_with_data": len(results),
        "totals": {
            "raw_lines": total_raw,
            "daily_rows": total_daily,
            "batches": total_batch,
            "unmatched_queue": total_unm,
        },
        "details": results,
    }


@router.post("/admin/cleanup-channel")
def admin_cleanup_channel(channel_id: str, db: Session = Depends(get_db)):
    """채널의 batch + raw_lines + daily 모두 삭제. 재업로드 전 깨끗한 상태로.

    Channel/Mapping 자체는 보존. 운영자가 같은 raw 파일을 재업로드할 때
    중복 적재(서로 다른 dedup_hash로 인식)나 잔여 daily 행과의 충돌을 방지.
    """
    from app.db_models import (
        ChannelSalesRawLine,
        ChannelSalesUploadBatch,
        ChannelSalesDailyProduct,
        ChannelUnmatchedProduct,
    )
    raw_n = db.query(ChannelSalesRawLine).filter(
        ChannelSalesRawLine.channel_id == channel_id
    ).delete(synchronize_session=False)
    daily_n = db.query(ChannelSalesDailyProduct).filter(
        ChannelSalesDailyProduct.channel_id == channel_id
    ).delete(synchronize_session=False)
    batch_n = db.query(ChannelSalesUploadBatch).filter(
        ChannelSalesUploadBatch.channel_id == channel_id
    ).delete(synchronize_session=False)
    # 미매핑 큐도 함께 정리 (이전에 잘못 적재된 raw_lines의 깨진 값이 큐에 남는 문제 방지)
    unm_n = db.query(ChannelUnmatchedProduct).filter(
        ChannelUnmatchedProduct.channel_id == channel_id
    ).delete(synchronize_session=False)
    db.commit()
    return {
        "channel_id": channel_id,
        "raw_lines_deleted": raw_n,
        "daily_rows_deleted": daily_n,
        "batches_deleted": batch_n,
        "unmatched_queue_deleted": unm_n,
    }


@router.post("/admin/rebuild-daily-all")
def admin_rebuild_daily_all(db: Session = Depends(get_db)):
    """모든 채널·모든 기간의 daily_aggregate를 통째로 재계산.

    코드 변경(예: unmatched 포함, unit_per_set 환산 변경)이 있을 때 호출.
    raw_lines는 그대로 두고 ChannelSalesDailyProduct만 다시 build.
    """
    n = rebuild_daily_aggregate(db)
    return {"rows_rebuilt": n}


@router.get("/admin/diag-raw-sums")
def admin_diag_raw_sums(
    channel_id: str,
    period_start: date,
    period_end: date,
    db: Session = Depends(get_db),
):
    """raw_lines 합계(매출/수량)를 직접 조회 — daily 집계와 비교하여 누락 원인 파악."""
    from app.db_models import ChannelSalesRawLine
    from sqlalchemy import func as sa_func, case
    q = db.query(
        sa_func.count(ChannelSalesRawLine.id).label("lines"),
        sa_func.sum(ChannelSalesRawLine.raw_qty).label("raw_qty"),
        sa_func.sum(ChannelSalesRawLine.pcs_qty).label("pcs_qty"),
        sa_func.sum(ChannelSalesRawLine.gross_amount).label("gross"),
        sa_func.sum(ChannelSalesRawLine.net_amount).label("net"),
        ChannelSalesRawLine.mapping_status,
    ).filter(
        ChannelSalesRawLine.channel_id == channel_id,
        ChannelSalesRawLine.sale_date >= period_start,
        ChannelSalesRawLine.sale_date <= period_end,
    ).group_by(ChannelSalesRawLine.mapping_status)
    by_status = [
        {
            "status": r.mapping_status,
            "lines": r.lines,
            "raw_qty": float(r.raw_qty or 0),
            "pcs_qty": float(r.pcs_qty or 0),
            "gross": float(r.gross or 0),
            "net": float(r.net or 0),
        }
        for r in q.all()
    ]
    totals = {
        "lines": sum(b["lines"] for b in by_status),
        "raw_qty": sum(b["raw_qty"] for b in by_status),
        "pcs_qty": sum(b["pcs_qty"] for b in by_status),
        "gross": sum(b["gross"] for b in by_status),
        "net": sum(b["net"] for b in by_status),
    }
    return {"by_status": by_status, "totals": totals}


@router.post("/admin/remap-raw-lines")
def admin_remap_raw_lines(
    channel_id: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """모든(또는 특정 채널) raw_lines에 대해 resolve_product를 재실행하여
    product_id / pcs_qty / mapping_status를 새 매핑 규칙으로 갱신.

    pcs_qty 환산 로직 변경(예: unit_per_set 자동 추출 비활성)이 있을 때
    과거 적재된 raw_lines를 다시 매핑해 daily 재계산까지 함께 진행.
    """
    from app.services.csa_service import resolve_product
    from app.db_models import ChannelSalesRawLine, ProductMaster

    masters = db.query(ProductMaster).filter(ProductMaster.is_active.is_(True)).all()

    q = db.query(ChannelSalesRawLine)
    if channel_id:
        q = q.filter(ChannelSalesRawLine.channel_id == channel_id)

    total = 0
    changed = 0
    BATCH = 500
    offset = 0
    while True:
        rows = q.order_by(ChannelSalesRawLine.id).offset(offset).limit(BATCH).all()
        if not rows:
            break
        for r in rows:
            total += 1
            mapping = resolve_product(
                db, r.channel_id, r.raw_product_name or "", r.raw_option_name,
                masters_cache=masters,
            )
            new_pcs = (r.raw_qty or 0) * mapping.unit_per_set
            if (
                r.product_id != mapping.product_id
                or r.pcs_qty != new_pcs
                or r.mapping_status != mapping.status
            ):
                r.product_id = mapping.product_id
                r.pcs_qty = new_pcs
                r.mapping_status = mapping.status
                changed += 1
        db.commit()
        offset += BATCH

    # raw_lines 갱신 후 daily 재계산
    rebuilt = rebuild_daily_aggregate(db, channel_id=channel_id)
    return {"total": total, "changed": changed, "daily_rebuilt": rebuilt}


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
    import time as _time
    _ap_key = (str(period_start), str(period_end), by)
    _ap_now = _time.time()
    _ap_cached = _PLAN_CACHE.get(_ap_key)
    if _ap_cached and _ap_cached["expires"] > _ap_now:
        return {**_ap_cached["data"], "_cached": True}
    rows = db.query(ChannelSalesDailyProduct).filter(
        ChannelSalesDailyProduct.sale_date >= period_start,
        ChannelSalesDailyProduct.sale_date <= period_end,
    ).all()
    # 마스터 맵 메모리 캐시 사용 (그룹 2쿼리 제거)
    _mm = _get_master_maps(db)
    group_map = _mm["group_map"]
    group_names = _mm["group_names"]

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
        slot["revenue"] += (r.net_sales or 0) - (r.revenue_deduction or 0)
        slot["pcs"] += r.pcs_qty or 0
        slot["orders"] += r.order_count or 0

    items = list(bucket.values())
    for it in items:
        it["avg_price_per_pcs"] = (it["revenue"] / it["pcs"]) if it["pcs"] else 0
        it["avg_price_per_order"] = (it["revenue"] / it["orders"]) if it["orders"] else 0
    items.sort(key=lambda x: -x["revenue"])
    _ap_resp = {"by": by, "period_start": period_start.isoformat(),
                "period_end": period_end.isoformat(), "items": items[:200], "_cached": False}
    _PLAN_CACHE[_ap_key] = {"data": {k: v for k, v in _ap_resp.items() if k != "_cached"},
                            "expires": _ap_now + _PLAN_TTL_SEC}
    return _ap_resp


@router.get("/admin/diag-excluded-mappings")
def admin_diag_excluded_mappings(
    channel_id: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """is_excluded=True 매핑 + 그 매핑이 적용된 raw_lines 통계.

    잘못 excluded 처리된 매핑을 자동 탐지하기 위함.
    avg_line_gross가 큰 매핑일수록 식품일 가능성이 높아 의심됨.
    """
    from sqlalchemy import func as sa_func

    q = db.query(ChannelProductMapping).filter(ChannelProductMapping.is_excluded.is_(True))
    if channel_id:
        q = q.filter(ChannelProductMapping.channel_id == channel_id)

    results = []
    for m in q.all():
        stats = db.query(
            sa_func.count(ChannelSalesRawLine.id).label("lines"),
            sa_func.sum(ChannelSalesRawLine.raw_qty).label("qty"),
            sa_func.sum(ChannelSalesRawLine.gross_amount).label("gross"),
        ).filter(
            ChannelSalesRawLine.channel_id == m.channel_id,
            ChannelSalesRawLine.raw_product_name == m.raw_product_name,
            ChannelSalesRawLine.mapping_status == "excluded",
        ).first()
        lines = int(stats.lines or 0)
        gross = float(stats.gross or 0)
        results.append({
            "mapping_id": m.id,
            "channel_id": m.channel_id,
            "channel_name": m.channel_name,
            "raw_product_name": m.raw_product_name,
            "raw_option_name": m.raw_option_name,
            "notes": m.notes,
            "lines": lines,
            "qty": float(stats.qty or 0),
            "gross": gross,
            "avg_line_gross": (gross / lines) if lines else 0,
        })
    results.sort(key=lambda r: -r["avg_line_gross"])
    return results


@router.post("/admin/unexclude-mappings")
def admin_unexclude_mappings(
    mapping_ids: List[int] = Body(..., embed=True),
    db: Session = Depends(get_db),
):
    """잘못 excluded 처리된 매핑들을 is_excluded=False로 일괄 해제.

    호출 후에는 /admin/remap-raw-lines 로 raw_lines를 재매핑하고
    /admin/rebuild-daily-all 로 daily aggregate를 다시 계산해야 함.
    """
    if not mapping_ids:
        raise HTTPException(400, "mapping_ids is empty")
    rows = db.query(ChannelProductMapping).filter(
        ChannelProductMapping.id.in_(mapping_ids)
    ).all()
    updated = []
    for m in rows:
        if m.is_excluded:
            m.is_excluded = False
            updated.append({
                "mapping_id": m.id,
                "channel_id": m.channel_id,
                "raw_product_name": m.raw_product_name,
            })
    db.commit()
    return {"updated_count": len(updated), "updated": updated}


class SetMappingProductIn(BaseModel):
    mapping_id: int
    product_code: str
    unit_per_set: int = 1


@router.post("/admin/set-mapping-product")
def admin_set_mapping_product(
    payload: SetMappingProductIn,
    db: Session = Depends(get_db),
):
    """특정 ChannelProductMapping에 ProductMaster.code 기준으로 product_id를 설정.

    is_excluded=False 도 함께 보장.
    """
    product = db.query(ProductMaster).filter(
        ProductMaster.code == payload.product_code
    ).first()
    if not product:
        raise HTTPException(404, f"ProductMaster with code='{payload.product_code}' not found")

    mapping = db.query(ChannelProductMapping).filter(
        ChannelProductMapping.id == payload.mapping_id
    ).first()
    if not mapping:
        raise HTTPException(404, f"ChannelProductMapping id={payload.mapping_id} not found")

    mapping.product_id = product.id
    mapping.unit_per_set = payload.unit_per_set
    mapping.is_excluded = False
    mapping.confidence = "manual"
    db.commit()
    db.refresh(mapping)
    return {
        "mapping_id": mapping.id,
        "raw_product_name": mapping.raw_product_name,
        "product_id": product.id,
        "product_code": product.code,
        "product_name": product.name,
        "unit_per_set": mapping.unit_per_set,
        "is_excluded": mapping.is_excluded,
    }
