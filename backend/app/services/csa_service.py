"""채널별 매출 취합(CSA, Channel Sales Aggregation) 서비스

- 표준 품목 마스터 + 채널 매핑 + 일×채널×품목 집계
- 핵심 단위: 낱개(pcs). 채널 표기 수량 × 입수(unit_per_set) = pcs_qty
- 변동비는 낱개당 입력 → 공헌이익 = 매출 − (pcs × 변동비)
"""
from __future__ import annotations

import hashlib
import logging
import uuid
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any, Iterable, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.db_models import (
    ProductMaster,
    ChannelProductMapping,
    ChannelSalesUploadBatch,
    ChannelSalesRawLine,
    ChannelSalesDailyProduct,
    ProductVariableCost,
    ChannelUnmatchedProduct,
    Channel,
)

log = logging.getLogger(__name__)


# ──────────────────────────────────────────────────────────────
# 표준 품목 마스터 (판매채널별 판매 제품명.xlsx 기준 자사몰 26종)
# ──────────────────────────────────────────────────────────────

DEFAULT_PRODUCTS: list[dict[str, Any]] = [
    {"code": "MACA", "name": "마카롱", "category": "디저트", "default_unit_size": 1, "sort_order": 1},
    {"code": "DUNG", "name": "뚱낭시에", "category": "디저트", "default_unit_size": 1, "sort_order": 2},
    {"code": "BAGL", "name": "베이글", "category": "베이커리", "default_unit_size": 1, "sort_order": 3},
    {"code": "NEMO", "name": "네모바게트", "category": "베이커리", "default_unit_size": 1, "sort_order": 4},
    {"code": "SCON", "name": "스콘", "category": "베이커리", "default_unit_size": 1, "sort_order": 5},
    {"code": "REVB", "name": "르뱅쿠키", "category": "쿠키", "default_unit_size": 1, "sort_order": 6},
    {"code": "FOCC", "name": "포카치아", "category": "베이커리", "default_unit_size": 1, "sort_order": 7},
    {"code": "JJON", "name": "상온 쫀득쿠키", "category": "쿠키", "default_unit_size": 1, "sort_order": 8},
    {"code": "AMER", "name": "아메쿠키", "category": "쿠키", "default_unit_size": 1, "sort_order": 9},
    {"code": "SLAP", "name": "슬랩", "category": "베이커리", "default_unit_size": 1, "sort_order": 10},
    {"code": "JJBR", "name": "쫀득빵", "category": "베이커리", "default_unit_size": 1, "sort_order": 11},
    {"code": "KKAM", "name": "깜빠뉴", "category": "베이커리", "default_unit_size": 1, "sort_order": 12},
    {"code": "EDRK", "name": "에너지드링크", "category": "음료", "default_unit_size": 1, "sort_order": 13},
    {"code": "SKBR", "name": "식빵", "category": "베이커리", "default_unit_size": 1, "sort_order": 14},
    {"code": "TSPK", "name": "티스파클링", "category": "음료", "default_unit_size": 1, "sort_order": 15},
    {"code": "CHIA", "name": "치아바타", "category": "베이커리", "default_unit_size": 1, "sort_order": 16},
    {"code": "DUBA", "name": "두바이 쫀득쿠키", "category": "쿠키", "default_unit_size": 1, "sort_order": 17},
    {"code": "LITE", "name": "라이트번", "category": "베이커리", "default_unit_size": 1, "sort_order": 18},
    {"code": "CROI", "name": "크루와상", "category": "베이커리", "default_unit_size": 1, "sort_order": 19},
    {"code": "BROW", "name": "브라우니", "category": "디저트", "default_unit_size": 1, "sort_order": 20},
    {"code": "POUN", "name": "파운드", "category": "베이커리", "default_unit_size": 1, "sort_order": 21},
    {"code": "CREM", "name": "크림빵", "category": "베이커리", "default_unit_size": 1, "sort_order": 22},
    {"code": "NUTR", "name": "뉴트리션 미니 쿠키", "category": "쿠키", "default_unit_size": 1, "sort_order": 23},
    {"code": "MADE", "name": "마들렌", "category": "디저트", "default_unit_size": 1, "sort_order": 24},
    {"code": "VGCK", "name": "비건 케이크", "category": "디저트", "default_unit_size": 1, "sort_order": 25},
    {"code": "STOL", "name": "슈톨렌", "category": "디저트", "default_unit_size": 1, "sort_order": 26},
]


# 마스터 파일의 채널명 → 시스템 채널 정규화 (별칭/오타 통일)
CHANNEL_ALIAS: dict[str, str] = {
    "이베이(지마켓, 옥션": "이베이",
    "이베이": "이베이",
    "GS샵": "GS샵",
    "GS SHOP": "GS샵",
    "GS25": "GS25",
    "쿠팡 WING": "쿠팡 WING",
    "쿠팡 (로켓프레시)": "쿠팡 로켓프레시",
    "B마트": "B마트",
    "비마트": "B마트",
    "삼성웰스토리": "삼성웰스토리",
    "CJ프레시웨이": "CJ프레시웨이",
    "이마트 트레이더스": "이마트 트레이더스",
    "이마트24": "이마트24",
    "이마트": "이마트",
    "노브랜드": "노브랜드",
    "롯데마트": "롯데마트",
    "홈플러스": "홈플러스",
    "7/11": "세븐일레븐",
    "CU": "CU",
    "제로스토어": "제로스토어",
    "B2B파트너스": "B2B파트너스",
    "파르나스": "파르나스",
    "SIK": "SIK",
    "PX": "PX",
    "스마트스토어": "스마트스토어",
    "카카오선물하기": "카카오선물하기",
    "카카오톡스토어": "카카오톡스토어",
    "토스": "토스",
    "자사몰": "자사몰",
    "코스트코": "코스트코",
    "컬리": "마켓컬리",
    "아워홈": "아워홈",
}


def normalize_channel_name(raw: Optional[str]) -> Optional[str]:
    if not raw:
        return None
    return CHANNEL_ALIAS.get(raw.strip(), raw.strip())


# ──────────────────────────────────────────────────────────────
# 시드
# ──────────────────────────────────────────────────────────────

def seed_product_master(db: Session) -> dict[str, int]:
    """표준 품목 마스터 시드. 이미 있으면 skip."""
    created = 0
    for p in DEFAULT_PRODUCTS:
        existing = db.query(ProductMaster).filter(ProductMaster.name == p["name"]).first()
        if existing:
            continue
        db.add(ProductMaster(**p, is_active=True))
        created += 1
    db.commit()
    return {"created": created, "total": db.query(ProductMaster).count()}


def seed_channels(db: Session) -> dict[str, int]:
    """마스터 파일 기준 31개 채널 시드."""
    from app.services.channel_service import DEFAULT_CHANNELS  # noqa
    created = 0
    for c in DEFAULT_CHANNELS:
        name = normalize_channel_name(c["name"])
        existing = db.query(Channel).filter(Channel.name == name).first()
        if existing:
            continue
        db.add(Channel(
            id=str(uuid.uuid4()),
            name=name,
            category=c.get("category", "기타"),
            integration_type=c.get("integration_type", "manual"),
            is_active=True,
        ))
        created += 1
    db.commit()
    return {"created": created, "total": db.query(Channel).count()}


# ──────────────────────────────────────────────────────────────
# 매핑 + 입수 환산
# ──────────────────────────────────────────────────────────────

@dataclass
class MappingResult:
    product_id: Optional[int]
    product_name: Optional[str]
    unit_per_set: int
    status: str  # matched/unmatched/excluded


def _get_or_cache_master(db: Session, _cache: dict | None = None) -> list[ProductMaster]:
    return db.query(ProductMaster).filter(ProductMaster.is_active.is_(True)).all()


def resolve_product(
    db: Session,
    channel_id: str,
    raw_product_name: str,
    raw_option_name: Optional[str] = None,
    *,
    masters_cache: Optional[list[ProductMaster]] = None,
) -> MappingResult:
    """채널 원본 상품명 → 표준 품목 매핑.

    1) channel_product_mapping에 정확히 일치하는 매핑이 있으면 사용
    2) 없으면 표준 품목명이 raw에 포함되는지 룰베이스 검색 (가장 긴 매칭 우선)
    3) 입수 추출 — 옵션명/상품명에서 "Nㄴ" 또는 "N개", "N구" 패턴 추출
    """
    raw_name = (raw_product_name or "").strip()
    raw_opt = (raw_option_name or "").strip() if raw_option_name else None

    # 1) 정확 매핑
    q = db.query(ChannelProductMapping).filter(
        ChannelProductMapping.channel_id == channel_id,
        ChannelProductMapping.raw_product_name == raw_name,
    )
    if raw_opt:
        m = q.filter(ChannelProductMapping.raw_option_name == raw_opt).first()
        if m is None:
            m = q.filter(ChannelProductMapping.raw_option_name.is_(None)).first()
    else:
        m = q.filter(ChannelProductMapping.raw_option_name.is_(None)).first()

    if m is not None:
        if m.is_excluded:
            return MappingResult(None, None, 1, "excluded")
        if m.product_id is None:
            return MappingResult(None, None, m.unit_per_set or 1, "unmatched")
        prod = db.query(ProductMaster).get(m.product_id)
        return MappingResult(prod.id, prod.name, m.unit_per_set or 1, "matched")

    # 2) 룰베이스 — 가장 긴 표준명이 raw에 포함되는지
    masters = masters_cache or _get_or_cache_master(db)
    haystack = f"{raw_name} {raw_opt or ''}"
    # 공백 제거 버전도 함께
    haystack_compact = haystack.replace(" ", "")
    best: Optional[ProductMaster] = None
    for prod in sorted(masters, key=lambda x: -len(x.name)):
        name = prod.name
        name_compact = name.replace(" ", "")
        if name in haystack or name_compact in haystack_compact:
            best = prod
            break
        # 별칭 일부 (예: 마카롱→뚱카롱)
        if name == "마카롱" and ("뚱카롱" in haystack_compact or "마카롱" in haystack_compact):
            best = prod
            break
        if name == "베이글" and "베이글" in haystack_compact:
            best = prod
            break

    if best is None:
        return MappingResult(None, None, 1, "unmatched")

    # 3) 입수 추출
    unit = _extract_unit_per_set(haystack)
    return MappingResult(best.id, best.name, unit, "matched")


def _extract_unit_per_set(text: str) -> int:
    """'8개', '8구', '8입', 'x8', '8ea', '8 ea' 등에서 입수 추출. 못 찾으면 1."""
    import re
    if not text:
        return 1
    candidates = re.findall(r"(\d+)\s*(?:개입|개|구|입|봉|병|박스|ea|EA)", text)
    if candidates:
        # 가장 큰 값 (8개입 vs 1세트 → 8 선택)
        try:
            return max(int(c) for c in candidates)
        except Exception:
            pass
    # 'x8', '×8' 패턴
    m = re.search(r"[x×X]\s*(\d+)", text)
    if m:
        try:
            return int(m.group(1))
        except Exception:
            pass
    return 1


# ──────────────────────────────────────────────────────────────
# 라인 적재 (dedup)
# ──────────────────────────────────────────────────────────────

def compute_dedup_hash(
    channel_id: str,
    order_no: Optional[str],
    line_no: Optional[str],
    sale_date: date,
    raw_product_name: Optional[str],
    raw_qty: float,
    gross_amount: float,
) -> str:
    key = f"{channel_id}|{order_no or ''}|{line_no or ''}|{sale_date.isoformat()}|{raw_product_name or ''}|{raw_qty}|{gross_amount}"
    return hashlib.sha256(key.encode("utf-8")).hexdigest()


@dataclass
class ParsedLine:
    sale_date: date
    sale_datetime: Optional[datetime] = None
    order_no: Optional[str] = None
    line_no: Optional[str] = None
    raw_product_name: Optional[str] = None
    raw_option_name: Optional[str] = None
    raw_qty: float = 0
    gross_amount: float = 0
    net_amount: float = 0
    settlement_amount: float = 0
    commission: float = 0
    shipping_fee: float = 0
    refund_amount: float = 0
    raw_row: Optional[dict] = None


def ingest_lines(
    db: Session,
    *,
    channel_id: str,
    channel_name: str,
    file_name: str,
    file_hash: Optional[str],
    file_size: int,
    parser_version: str,
    lines: Iterable[ParsedLine],
    uploaded_by: Optional[str] = None,
) -> ChannelSalesUploadBatch:
    """파싱된 라인 적재. 중복은 자동 스킵, 매핑 실패는 unmatched 큐로."""
    batch_id = str(uuid.uuid4())
    batch = ChannelSalesUploadBatch(
        id=batch_id,
        channel_id=channel_id,
        channel_name=channel_name,
        file_name=file_name,
        file_size=file_size,
        file_hash=file_hash,
        parser_version=parser_version,
        status="parsing",
        uploaded_by=uploaded_by,
    )
    db.add(batch)
    db.commit()

    masters_cache = _get_or_cache_master(db)
    inserted = duplicate = unmatched = excluded = total = 0
    min_date = max_date = None

    for ln in lines:
        total += 1
        if min_date is None or ln.sale_date < min_date:
            min_date = ln.sale_date
        if max_date is None or ln.sale_date > max_date:
            max_date = ln.sale_date

        dedup = compute_dedup_hash(
            channel_id, ln.order_no, ln.line_no, ln.sale_date,
            ln.raw_product_name, ln.raw_qty, ln.gross_amount,
        )
        exists = db.query(ChannelSalesRawLine.id).filter(
            ChannelSalesRawLine.dedup_hash == dedup
        ).first()
        if exists:
            duplicate += 1
            continue

        mapping = resolve_product(
            db, channel_id, ln.raw_product_name or "", ln.raw_option_name, masters_cache=masters_cache
        )
        pcs = ln.raw_qty * mapping.unit_per_set
        status = mapping.status
        if status == "unmatched":
            unmatched += 1
            _bump_unmatched(db, channel_id, channel_name, ln.raw_product_name, ln.raw_option_name, ln.raw_qty)
        elif status == "excluded":
            excluded += 1

        db.add(ChannelSalesRawLine(
            batch_id=batch_id,
            channel_id=channel_id,
            channel_name=channel_name,
            order_no=ln.order_no,
            line_no=ln.line_no,
            dedup_hash=dedup,
            sale_date=ln.sale_date,
            sale_datetime=ln.sale_datetime,
            raw_product_name=ln.raw_product_name,
            raw_option_name=ln.raw_option_name,
            raw_qty=ln.raw_qty,
            gross_amount=ln.gross_amount,
            net_amount=ln.net_amount or ln.gross_amount,
            settlement_amount=ln.settlement_amount,
            commission=ln.commission,
            shipping_fee=ln.shipping_fee,
            refund_amount=ln.refund_amount,
            product_id=mapping.product_id,
            pcs_qty=pcs,
            mapping_status=status,
            raw_row=ln.raw_row,
        ))
        inserted += 1

    batch.row_total = total
    batch.row_inserted = inserted
    batch.row_duplicate = duplicate
    batch.row_unmatched = unmatched
    batch.row_excluded = excluded
    batch.period_start = min_date
    batch.period_end = max_date
    batch.status = "done"
    batch.completed_at = datetime.utcnow()
    db.commit()

    rebuild_daily_aggregate(db, channel_id=channel_id, since=min_date, until=max_date)

    return batch


def _bump_unmatched(
    db: Session,
    channel_id: str,
    channel_name: str,
    raw_name: Optional[str],
    raw_opt: Optional[str],
    qty: float,
) -> None:
    if not raw_name:
        return
    existing = db.query(ChannelUnmatchedProduct).filter(
        ChannelUnmatchedProduct.channel_id == channel_id,
        ChannelUnmatchedProduct.raw_product_name == raw_name,
        ChannelUnmatchedProduct.raw_option_name == raw_opt,
        ChannelUnmatchedProduct.status == "pending",
    ).first()
    if existing:
        existing.occurrence_count = (existing.occurrence_count or 0) + 1
        existing.total_qty = (existing.total_qty or 0) + qty
        existing.last_seen_at = datetime.utcnow()
    else:
        db.add(ChannelUnmatchedProduct(
            channel_id=channel_id,
            channel_name=channel_name,
            raw_product_name=raw_name,
            raw_option_name=raw_opt,
            occurrence_count=1,
            total_qty=qty,
        ))


# ──────────────────────────────────────────────────────────────
# 일×채널×품목 집계 재구성
# ──────────────────────────────────────────────────────────────

def rebuild_daily_aggregate(
    db: Session,
    *,
    channel_id: Optional[str] = None,
    since: Optional[date] = None,
    until: Optional[date] = None,
) -> int:
    """raw_lines → daily_product 재계산 (세분 변동비 반영).

    실제 분해 로직은 csa_cost_service.rebuild_daily_with_costs에 위임.
    """
    from app.services.csa_cost_service import rebuild_daily_with_costs
    return rebuild_daily_with_costs(db, channel_id=channel_id, since=since, until=until)


def is_db_available() -> bool:
    from app.services.channel_service import is_db_available as _f
    return _f()
