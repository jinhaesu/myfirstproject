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
    ChannelProductMappingComponent,
    ChannelSalesUploadBatch,
    ChannelSalesRawLine,
    ChannelSalesDailyProduct,
    ProductVariableCost,
    ChannelUnmatchedProduct,
    Channel,
    CsaChannelProduct,
    ChannelGroupMembership,
    ChannelGroup,
)

log = logging.getLogger(__name__)


# ──────────────────────────────────────────────────────────────
# 표준 품목 마스터 (판매채널별 판매 제품명.xlsx 기준 자사몰 26종)
# ──────────────────────────────────────────────────────────────

DEFAULT_PRODUCTS: list[dict[str, Any]] = [
    {"code": "MACA", "name": "마카롱", "category": "디저트", "default_unit_size": 1, "sort_order": 1},
    {"code": "DUNG", "name": "뚱낭시에", "aliases": ["휘낭시에", "피낭시에", "휘낭시"], "category": "디저트", "default_unit_size": 1, "sort_order": 2},
    {"code": "BAGL", "name": "베이글", "category": "베이커리", "default_unit_size": 1, "sort_order": 3},
    {"code": "NEMO", "name": "네모바게트", "category": "베이커리", "default_unit_size": 1, "sort_order": 4},
    {"code": "SCON", "name": "스콘", "category": "베이커리", "default_unit_size": 1, "sort_order": 5},
    {"code": "REVB", "name": "르뱅쿠키", "aliases": ["크럼블쿠키", "크럼블 쿠키", "두바이초코크럼블쿠키", "초코볼크럼블쿠키"], "category": "쿠키", "default_unit_size": 1, "sort_order": 6},
    {"code": "FOCC", "name": "포카치아", "category": "베이커리", "default_unit_size": 1, "sort_order": 7},
    {"code": "JJON", "name": "상온 쫀득쿠키", "category": "쿠키", "default_unit_size": 1, "sort_order": 8},
    {"code": "AMER", "name": "아메쿠키", "aliases": ["아메리칸쿠키", "아메리칸 쿠키", "American Cookie"], "category": "쿠키", "default_unit_size": 1, "sort_order": 9},
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
    "노브랜드": "이마트 노브랜드",
    "이마트노브랜드": "이마트 노브랜드",
    "이마트 노브랜드": "이마트 노브랜드",
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


# B2C 채널 — raw 매출 컬럼이 부가세 포함 소비자가. 매출 적재는
# 부가세 별도(공급가) 기준으로 통일하기 위해 ingest 시점에 1/1.1 환산.
# B2B/정산형(CU/GS25/비마트/쿠팡로켓/B2B급식/PX 등)은 이미 공급가라 변환 X.
VAT_INCLUDED_CHANNELS: set[str] = {
    # 오픈마켓
    "카페24", "자사몰",
    "스마트스토어",
    "쿠팡 WING",
    "11번가",
    "지마켓", "G마켓",
    "옥션",
    "알리익스프레스",
    "테무",
    # 소셜커머스
    "카카오선물하기", "카카오톡스토어", "카카오스타일",
    "토스",
    # 버티컬
    "올리브영",
    "올웨이즈",
    # 마켓컬리/컬리 제외: 파서가 '공급가액'(부가세 별도)을 매출로 쓰므로
    # VAT 환산(÷1.1)을 또 하면 매출이 ~9% 낮아짐.
    "에이블리", "Ably",  # 결제액(부가세 포함) → 공급가(÷1.1)로 환산 (검수 2026-06-06)
    "크림",
    # 홈쇼핑
    "롯데 홈쇼핑", "롯데홈쇼핑",
    "GS샵", "GS 샵", "GS SHOP", "GS샵쇼핑",
    "NS MALL", "NS",
    "신세계 TV 쇼핑", "신세계TV쇼핑", "신세계TV",
    "신세계 라이브쇼핑", "신세계라이브쇼핑",
    "CJ온스타일", "CJ 온스타일", "CJ ON STYLE",
    # 백화점
    "롯데온",
    "SSG", "SSG닷컴",
    "신세계몰", "신세계몰(SSG)",  # SSG닷컴 위탁 — 주문금액(소비자가) 기준 (2026-06-12)
}


def is_vat_included(channel_name: Optional[str]) -> bool:
    if not channel_name:
        return False
    return channel_name.strip() in VAT_INCLUDED_CHANNELS


# '월 누적 스냅샷'으로 데이터를 주는 채널 — 한 달치를 조회시점까지 누적해 내려주므로,
# 같은 월을 재업로드하면 과거 월 데이터를 '교체'(최신 스냅샷만 매출로 인정)해야 한다.
# (그냥 적재하면 동일 월이 여러 번 누적돼 과대계상.)
MONTHLY_SNAPSHOT_CHANNELS: set[str] = {
    "PX", "국군복지단", "국군 복지단", "국군복지단(PX)", "국군 복지단(PX)",
}


def is_monthly_snapshot(channel_name: Optional[str]) -> bool:
    return bool(channel_name) and channel_name.strip() in MONTHLY_SNAPSHOT_CHANNELS


def is_online_consign(db: Session, channel_id: str) -> bool:
    """채널이 '온라인(위탁)' 그룹인지. 위탁 매출은 VAT 포함 그대로 집계(공급가 환산 X) — 사용자 정책."""
    row = (
        db.query(ChannelGroup.name)
        .join(ChannelGroupMembership, ChannelGroupMembership.group_id == ChannelGroup.id)
        .filter(ChannelGroupMembership.channel_id == channel_id)
        .first()
    )
    return bool(row and "위탁" in (row[0] or ""))


_VAT_EXCL_FACTOR = 1.0 / 1.1  # 부가세 10% 별도 환산


# ──────────────────────────────────────────────────────────────
# 시드
# ──────────────────────────────────────────────────────────────

def seed_product_master(db: Session) -> dict[str, int]:
    """표준 품목 마스터 시드. 이미 있으면 aliases만 업데이트."""
    created = 0
    updated = 0
    for p in DEFAULT_PRODUCTS:
        existing = db.query(ProductMaster).filter(ProductMaster.name == p["name"]).first()
        if existing:
            # aliases가 새로 추가/변경된 경우 업데이트
            new_aliases = p.get("aliases")
            if new_aliases and existing.aliases != new_aliases:
                existing.aliases = new_aliases
                updated += 1
            continue
        db.add(ProductMaster(**p, is_active=True))
        created += 1
    db.commit()
    return {"created": created, "updated": updated, "total": db.query(ProductMaster).count()}


def seed_channel_products(db: Session) -> int:
    """모든 채널 × 모든 활성 품목 = 활성 등록 (기존 매핑이 없는 경우만).
    멱등 — 이미 등록된 (channel, product) 조합은 skip."""
    channels = db.query(Channel).filter(Channel.is_active.is_(True)).all()
    products = db.query(ProductMaster).filter(ProductMaster.is_active.is_(True)).all()
    existing = {(m.channel_id, m.product_id) for m in db.query(CsaChannelProduct).all()}
    created = 0
    for ch in channels:
        for p in products:
            if (ch.id, p.id) in existing:
                continue
            db.add(CsaChannelProduct(
                channel_id=ch.id, channel_name=ch.name,
                product_id=p.id, product_name=p.name,
                is_active=True, added_by="seed",
            ))
            created += 1
    db.commit()
    return created


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


def _build_mapping_cache(
    db: Session, channel_id: str
) -> dict[tuple[str, Optional[str]], ChannelProductMapping]:
    """채널의 모든 ChannelProductMapping을 (raw_product_name, raw_option_name) 키로 캐싱.

    Supabase pooler처럼 query 1회당 latency가 큰 환경에서 ingest_lines가 라인마다
    DB query하면 N+1로 GS25 95k 라인 적재가 timeout. 한 번만 가져와서 dict로 검색.
    """
    cache: dict[tuple[str, Optional[str]], ChannelProductMapping] = {}
    for m in db.query(ChannelProductMapping).filter(
        ChannelProductMapping.channel_id == channel_id
    ).all():
        # 조회 키(resolve_product)는 strip된 값 — 엑셀 상품명 앞뒤 공백으로
        # 매핑이 미적용되지 않도록 캐시 키도 strip해서 정규화.
        _k_rn = (m.raw_product_name or "").strip()
        _k_ro = (m.raw_option_name or "").strip() or None
        cache[(_k_rn, _k_ro)] = m
    return cache


def _build_multi_mapping_cache(
    db: Session, channel_id: str
) -> dict[tuple[str, Optional[str]], list[ChannelProductMappingComponent]]:
    """채널의 다중 매핑 컴포넌트를 (raw_product_name, raw_option_name) 키로 캐싱."""
    cache: dict[tuple[str, Optional[str]], list[ChannelProductMappingComponent]] = {}
    rows = (
        db.query(ChannelProductMappingComponent)
        .filter(ChannelProductMappingComponent.channel_id == channel_id)
        .order_by(ChannelProductMappingComponent.sort_order, ChannelProductMappingComponent.id)
        .all()
    )
    for r in rows:
        _k_rn = (r.raw_product_name or "").strip()
        _k_ro = (r.raw_option_name or "").strip() or None
        cache.setdefault((_k_rn, _k_ro), []).append(r)
    return cache


def split_by_units(
    base_gross: float,
    base_net: float,
    raw_qty: float,
    comps: list,
) -> list[tuple]:
    """옵션 매출을 컴포넌트별 '낱개수량(unit_per_set)' 비율로 안분.

    반환: [(product_id, pcs_qty, gross, net, unit_per_set), ...].
    부동소수 합계 보존을 위해 잔여(rounding remainder)는 마지막 컴포넌트에 몰아준다.
    """
    total_ups = sum(max(int(getattr(c, "unit_per_set", 1) or 1), 1) for c in comps) or len(comps)
    out: list[tuple] = []
    g_acc = n_acc = 0.0
    nlen = len(comps)
    for ci, c in enumerate(comps):
        ups_i = max(int(getattr(c, "unit_per_set", 1) or 1), 1)
        if ci < nlen - 1:
            w = ups_i / total_ups
            g_i = base_gross * w
            n_i = base_net * w
            g_acc += g_i
            n_acc += n_i
        else:
            g_i = base_gross - g_acc  # 잔여 → 합계 보존
            n_i = base_net - n_acc
        out.append((c.product_id, (raw_qty or 0) * ups_i, g_i, n_i, ups_i))
    return out


def resolve_product(
    db: Session,
    channel_id: str,
    raw_product_name: str,
    raw_option_name: Optional[str] = None,
    *,
    masters_cache: Optional[list[ProductMaster]] = None,
    mappings_cache: Optional[dict[tuple[str, Optional[str]], ChannelProductMapping]] = None,
    product_by_id: Optional[dict[int, ProductMaster]] = None,
) -> MappingResult:
    """채널 원본 상품명 → 표준 품목 매핑.

    1) channel_product_mapping에 정확히 일치하는 매핑이 있으면 사용
    2) 없으면 표준 품목명이 raw에 포함되는지 룰베이스 검색 (가장 긴 매칭 우선)
    3) 입수 추출 — 옵션명/상품명에서 "Nㄴ" 또는 "N개", "N구" 패턴 추출
    """
    raw_name = (raw_product_name or "").strip()
    raw_opt = (raw_option_name or "").strip() if raw_option_name else None

    # 1) 정확 매핑 — 캐시 우선, 없으면 DB query (단건 호출 fallback)
    m: Optional[ChannelProductMapping] = None
    if mappings_cache is not None:
        if raw_opt:
            m = mappings_cache.get((raw_name, raw_opt)) or mappings_cache.get((raw_name, None))
        else:
            m = mappings_cache.get((raw_name, None))
    else:
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
        if product_by_id is not None:
            prod = product_by_id.get(m.product_id)
        else:
            prod = db.query(ProductMaster).get(m.product_id)
        if prod is None:
            return MappingResult(None, None, m.unit_per_set or 1, "unmatched")
        return MappingResult(prod.id, prod.name, m.unit_per_set or 1, "matched")

    # 2) 룰베이스 — 가장 긴 표준명이 raw에 포함되는지 (aliases 포함)
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
        # aliases 체크 (DB aliases 컬럼 + 하드코딩 별칭)
        aliases: list[str] = list(prod.aliases or [])
        # 하드코딩 보완 별칭 (마카롱↔뚱카롱 등 기존 로직 유지)
        if name == "마카롱":
            aliases += ["뚱카롱"]
        if name == "베이글":
            aliases += ["베이글"]
        for alias in aliases:
            alias_compact = alias.replace(" ", "")
            if alias in haystack or alias_compact in haystack_compact:
                best = prod
                break
        if best is not None:
            break

    if best is None:
        return MappingResult(None, None, 1, "unmatched")

    # 3) 입수 추출 — 룰베이스 매칭은 채널 raw 수량을 그대로 사용 (안전 기본값 1).
    # 입수 환산이 필요한 SKU는 관리자가 ChannelProductMapping에 명시적으로 unit_per_set을 등록해야 한다.
    # (raw_product_name에서 "16개입(8ea x 2box, 8장)" 같은 표기를 max()로 잡아 수량이 과대계상되는 문제 방지)
    return MappingResult(best.id, best.name, 1, "matched")


def _extract_unit_per_set(text: str) -> int:
    """[DEPRECATED] 안전한 보수적 추출만 수행.

    아래 두 가지 매우 명확한 경우에만 입수를 반환한다:
      1) 텍스트 전체(좌우 공백 제외)가 "Nㄴ" 또는 "N개입" 단일 토큰일 때
      2) 그 외에는 무조건 1 (수량 과대계상 방지)

    이전엔 상품명 곳곳에서 (\\d+)(?:개입|개|구|입|봉|병|박스|ea|EA) 패턴을
    max()로 골랐으나, "마카롱 8개입 16개입 박스" / "(8ea x 2box, 8장)" 같은
    표기에서 의도와 다른 큰 값이 선택되어 B마트/세븐일레븐/삼성웰스토리에서
    pcs_qty가 +50~+118% 부풀려지는 버그 발생.
    """
    import re
    if not text:
        return 1
    t = text.strip()
    # case 1: 전체가 "Nㄴ" 또는 "N개입" 단일 토큰
    m = re.fullmatch(r"\s*(\d+)\s*(?:개입|개|구|입|봉|병|박스|ea|EA|장|매)\s*", t)
    if m:
        try:
            v = int(m.group(1))
            # 비현실적 값 차단 (1000개입 같은 광고문구)
            if 1 <= v <= 200:
                return v
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
    is_cancelled: bool = False  # 취소/환불 확정 행 — 매출엔 미반영, 건수·금액만 표시
    unit_per_set: Optional[float] = None  # 파서가 낱개 입수를 직접 지정(상품명 기반 등). None이면 매핑값 사용
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
    product_by_id = {p.id: p for p in masters_cache}
    # ChannelProductMapping 전체를 한 번에 메모리에 캐시.
    # Supabase pooler 환경에서 라인마다 DB query하면 95k 라인 적재가 수 시간.
    mappings_cache = _build_mapping_cache(db, channel_id)
    multi_cache = _build_multi_mapping_cache(db, channel_id)
    inserted = duplicate = unmatched = excluded = cancelled = total = 0
    min_date = max_date = None

    # 월 누적 스냅샷 채널(PX 등): 이번 파일에 포함된 '월'의 기존 데이터를 먼저 삭제해
    # 최신 업로드(누적 스냅샷)로 통째 교체한다. lines를 한 번 소비하므로 리스트로 고정.
    lines = list(lines)
    if is_monthly_snapshot(channel_name):
        from calendar import monthrange as _monthrange
        months = {(l.sale_date.year, l.sale_date.month) for l in lines if l.sale_date}
        for _yy, _mm in months:
            _ms = date(_yy, _mm, 1)
            _me = date(_yy, _mm, _monthrange(_yy, _mm)[1])
            db.query(ChannelSalesRawLine).filter(
                ChannelSalesRawLine.channel_id == channel_id,
                ChannelSalesRawLine.sale_date >= _ms,
                ChannelSalesRawLine.sale_date <= _me,
            ).delete(synchronize_session=False)
            db.query(ChannelSalesDailyProduct).filter(
                ChannelSalesDailyProduct.channel_id == channel_id,
                ChannelSalesDailyProduct.sale_date >= _ms,
                ChannelSalesDailyProduct.sale_date <= _me,
            ).delete(synchronize_session=False)
        if months:
            db.commit()

    # 1) DB의 기존 dedup_hash 미리 캐싱 (채널 단위; 부분 적재된 잔존 라인까지 포함)
    existing_hashes: set[str] = set(
        h for (h,) in db.query(ChannelSalesRawLine.dedup_hash).filter(
            ChannelSalesRawLine.channel_id == channel_id
        ).all()
    )
    # 2) batch 내 라인 간 중복 추적 (commit 전이라 DB query로는 안 보임)
    seen_in_batch: set[str] = set()
    # 3) unmatched aggregation buffer — 라인마다 SELECT/UPDATE하면 N+1.
    #    in-memory에서 집계 후 batch end에 한 번에 upsert.
    unmatched_agg: dict[tuple[str, Optional[str]], dict] = {}

    for ln in lines:
        total += 1
        if min_date is None or ln.sale_date < min_date:
            min_date = ln.sale_date
        if max_date is None or ln.sale_date > max_date:
            max_date = ln.sale_date

        # DB varchar 한도 방어 — 초장문 상품명(예: 알리 합주문 '제품 정보')으로 인한
        # StringDataRightTruncation(=배치 전체 적재 실패·stuck) 방지.
        if ln.raw_product_name and len(ln.raw_product_name) > 500:
            ln.raw_product_name = ln.raw_product_name[:500]
        if ln.raw_option_name and len(ln.raw_option_name) > 500:
            ln.raw_option_name = ln.raw_option_name[:500]
        if ln.order_no and len(ln.order_no) > 200:
            ln.order_no = ln.order_no[:200]
        if ln.line_no and len(ln.line_no) > 100:
            ln.line_no = ln.line_no[:100]

        dedup = compute_dedup_hash(
            channel_id, ln.order_no, ln.line_no, ln.sale_date,
            ln.raw_product_name, ln.raw_qty,
            ln.refund_amount if ln.is_cancelled else ln.gross_amount,
        )
        if dedup in existing_hashes or dedup in seen_in_batch:
            duplicate += 1
            continue
        seen_in_batch.add(dedup)

        # 취소/환불 확정 행: 매출 집계에서 제외(mapping_status='cancelled'), 건수·금액만 보존
        if ln.is_cancelled:
            cancelled += 1
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
                gross_amount=0,
                net_amount=0,
                refund_amount=ln.refund_amount,
                product_id=None,
                pcs_qty=0,
                mapping_status="cancelled",
                raw_row=ln.raw_row,
            ))
            continue

        # 다중 매핑(옵션 1건 → 복수 표준 품목): 낱개수량 비율로 매출 안분 + 컴포넌트별 분할.
        comps = None
        if multi_cache:
            _rn = (ln.raw_product_name or "").strip()
            _ro = (ln.raw_option_name or "").strip() if ln.raw_option_name else None
            comps = multi_cache.get((_rn, _ro)) or multi_cache.get((_rn, None))
        if comps:
            if is_vat_included(channel_name):
                base_gross = ln.gross_amount * _VAT_EXCL_FACTOR
                base_net = (ln.net_amount or ln.gross_amount) * _VAT_EXCL_FACTOR
            else:
                base_gross = ln.gross_amount
                base_net = ln.net_amount or ln.gross_amount
            for comp_pid, comp_pcs, comp_g, comp_n, comp_ups in split_by_units(
                base_gross, base_net, ln.raw_qty, comps
            ):
                ln_no_i = f"{ln.line_no or ''}#m{comp_pid}"
                if len(ln_no_i) > 100:
                    ln_no_i = ln_no_i[:100]
                dedup_i = compute_dedup_hash(
                    channel_id, ln.order_no, ln_no_i, ln.sale_date,
                    ln.raw_product_name, ln.raw_qty, comp_g,
                )
                if dedup_i in existing_hashes or dedup_i in seen_in_batch:
                    duplicate += 1
                    continue
                seen_in_batch.add(dedup_i)
                db.add(ChannelSalesRawLine(
                    batch_id=batch_id,
                    channel_id=channel_id,
                    channel_name=channel_name,
                    order_no=ln.order_no,
                    line_no=ln_no_i,
                    dedup_hash=dedup_i,
                    sale_date=ln.sale_date,
                    sale_datetime=ln.sale_datetime,
                    raw_product_name=ln.raw_product_name,
                    raw_option_name=ln.raw_option_name,
                    raw_qty=ln.raw_qty,
                    gross_amount=comp_g,
                    net_amount=comp_n,
                    settlement_amount=ln.settlement_amount,
                    refund_amount=ln.refund_amount,
                    product_id=comp_pid,
                    pcs_qty=comp_pcs,
                    mapping_status="matched",
                    raw_row=ln.raw_row,
                ))
                inserted += 1
            continue

        mapping = resolve_product(
            db, channel_id, ln.raw_product_name or "", ln.raw_option_name,
            masters_cache=masters_cache,
            mappings_cache=mappings_cache,
            product_by_id=product_by_id,
        )
        # 파서가 입수를 직접 지정했으면(상품명 기반 등) 그 값 우선, 아니면 매핑값.
        _ups = ln.unit_per_set if ln.unit_per_set is not None else mapping.unit_per_set
        pcs = ln.raw_qty * _ups
        status = mapping.status
        if status == "unmatched":
            unmatched += 1
            # in-memory 집계만 (DB query는 batch end에서 한 번에)
            name_norm = (ln.raw_product_name or "").strip()
            if name_norm:
                opt_norm = _normalize_opt(ln.raw_option_name)
                key = (name_norm, opt_norm)
                agg = unmatched_agg.get(key)
                if agg is None:
                    unmatched_agg[key] = {"count": 1, "qty": ln.raw_qty}
                else:
                    agg["count"] += 1
                    agg["qty"] += ln.raw_qty
        elif status == "excluded":
            excluded += 1

        # 대시보드 매출 표준 = 부가세 별도(공급가).
        # VAT 포함으로 들어오는 채널(VAT_INCLUDED_CHANNELS)은 위탁/사입 구분 없이
        # 모두 공급가(÷1.1)로 환산해 적재한다 — 사용자 정책(2026-06-05).
        # (이미 공급가로 들어오는 채널: 컬리 공급가액, GS25 납품금액, 에이블리 결제액 등은
        #  애초에 VAT_INCLUDED_CHANNELS에서 제외돼 있어 환산하지 않음.)
        if is_vat_included(channel_name):
            adj_gross = ln.gross_amount * _VAT_EXCL_FACTOR
            adj_net = (ln.net_amount or ln.gross_amount) * _VAT_EXCL_FACTOR
        else:
            # VAT 별도(공급가)로 들어오는 채널: 원본 금액 그대로
            adj_gross = ln.gross_amount
            adj_net = ln.net_amount or ln.gross_amount

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
            gross_amount=adj_gross,
            net_amount=adj_net,
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

    # 라인 loop 종료 — unmatched 집계를 bulk upsert (라인마다 SELECT/UPDATE 제거).
    if unmatched_agg:
        _flush_unmatched_agg(db, channel_id, channel_name, unmatched_agg)

    # 일괄 commit 시도 → IntegrityError(잔존 DB 행과 충돌) 발생 시
    # 라인별 add/flush로 안전 fallback (실패한 라인만 duplicate 처리)
    from sqlalchemy.exc import IntegrityError
    try:
        db.commit()
    except IntegrityError as e:
        db.rollback()
        log.warning("batch commit failed with IntegrityError, falling back to per-line insert: %s", e)
        # raw_lines를 다시 만들어 라인별 처리
        inserted = duplicate2 = 0
        # 이미 add된 게 rollback됐으니, batch 상태는 살아있어야 하므로 다시 가져옴
        # 위에서 seen_in_batch로 dedup_hash 추적했으므로 그 set을 순회하며 재시도는 어려움
        # → 보수적으로 batch status='failed' 후 raise하여 라우터에서 처리
        batch.status = "failed"
        batch.error_message = f"IntegrityError: {str(e)[:500]}"
        batch.completed_at = datetime.utcnow()
        db.add(batch)
        db.commit()
        raise

    batch.row_total = total
    batch.row_inserted = inserted
    batch.row_duplicate = duplicate
    batch.row_unmatched = unmatched
    batch.row_excluded = excluded
    batch.row_cancelled = cancelled
    batch.period_start = min_date
    batch.period_end = max_date
    batch.status = "done"
    batch.completed_at = datetime.utcnow()
    db.commit()

    rebuild_daily_aggregate(db, channel_id=channel_id, since=min_date, until=max_date)

    return batch


def _normalize_opt(s: Optional[str]) -> Optional[str]:
    if s is None:
        return None
    t = str(s).strip()
    if not t or t.lower() in ("nan", "none", "null"):
        return None
    return t


def _flush_unmatched_agg(
    db: Session,
    channel_id: str,
    channel_name: str,
    agg: dict[tuple[str, Optional[str]], dict],
) -> None:
    """in-memory로 집계된 unmatched (key=(name, opt)) → 한 번의 DB query로 기존 pending row 조회
    + 일괄 update / insert. ingest_lines 내 라인마다 SELECT/UPDATE를 했을 때의 N+1 제거.
    """
    if not agg:
        return
    # 이 채널의 pending unmatched 한 번에 가져오기
    existing = db.query(ChannelUnmatchedProduct).filter(
        ChannelUnmatchedProduct.channel_id == channel_id,
        ChannelUnmatchedProduct.status == "pending",
    ).all()
    by_key: dict[tuple[str, Optional[str]], ChannelUnmatchedProduct] = {
        (row.raw_product_name, row.raw_option_name): row for row in existing
    }
    now = datetime.utcnow()
    for (name, opt), info in agg.items():
        row = by_key.get((name, opt))
        if row is not None:
            row.occurrence_count = (row.occurrence_count or 0) + info["count"]
            row.total_qty = (row.total_qty or 0) + info["qty"]
            row.last_seen_at = now
        else:
            db.add(ChannelUnmatchedProduct(
                channel_id=channel_id,
                channel_name=channel_name,
                raw_product_name=name,
                raw_option_name=opt,
                occurrence_count=info["count"],
                total_qty=info["qty"],
                last_seen_at=now,
            ))


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
    name_norm = str(raw_name).strip()
    opt_norm = _normalize_opt(raw_opt)
    existing = db.query(ChannelUnmatchedProduct).filter(
        ChannelUnmatchedProduct.channel_id == channel_id,
        ChannelUnmatchedProduct.raw_product_name == name_norm,
        ChannelUnmatchedProduct.raw_option_name.is_(None) if opt_norm is None else (ChannelUnmatchedProduct.raw_option_name == opt_norm),
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
            raw_product_name=name_norm,
            raw_option_name=opt_norm,
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
