"""사업계획 엑셀 임포터.

4개 시트 인식:
  1) 채널별 매출 대시보드 — 담당자/구분/판매채널/1~12월 매출
  2) 채널별 판매수량 — 판매채널/품목/1~12월 낱개
  3) 판매수량 대시보드 — 품목류/1~12월 낱개 (전체)
  4) 대시보드 — 그룹별 (위탁/사입/오프라인) 매출+비중, 마케팅 매출대비
"""
from __future__ import annotations

import logging
import re
import uuid
from datetime import datetime
from typing import Optional

import pandas as pd
from sqlalchemy.orm import Session

from app.db_models import (
    Channel,
    ProductMaster,
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
from app.services.csa_service import normalize_channel_name

log = logging.getLogger(__name__)


DEFAULT_GROUPS = [
    {"code": "online_consign", "name": "온라인(위탁)", "big_group": "온라인", "sort_order": 1},
    {"code": "online_purchase", "name": "온라인(사입)", "big_group": "온라인", "sort_order": 2},
    {"code": "offline", "name": "오프라인", "big_group": "오프라인", "sort_order": 3},
]


# 사업계획 엑셀의 세분 구분 → 3대 그룹 매핑
GROUP_3_MAP = {
    "온라인(위탁)": "온라인(위탁)",
    "온라인(사입)": "온라인(사입)",
    "오프라인": "오프라인",
    "오프라인(급식)": "오프라인",
    "오프라인(기타)": "오프라인",
    "오프라인(마트)": "오프라인",
    "오프라인(창고형)": "오프라인",
    "오프라인(CVS)": "오프라인",
}


MONTH_COLS = [f"{m}월" for m in range(1, 13)]


def seed_channel_groups(db: Session) -> int:
    created = 0
    for g in DEFAULT_GROUPS:
        existing = db.query(ChannelGroup).filter(ChannelGroup.code == g["code"]).first()
        if existing:
            continue
        db.add(ChannelGroup(**g))
        created += 1
    db.commit()
    return created


def _resolve_channel_id(db: Session, channel_name: str) -> Optional[str]:
    name = normalize_channel_name(channel_name)
    if not name:
        return None
    ch = db.query(Channel).filter(Channel.name == name).first()
    if ch:
        return ch.id
    # Substring search fallback
    candidates = db.query(Channel).filter(Channel.name.ilike(f"%{name}%")).all()
    if len(candidates) == 1:
        return candidates[0].id
    return None


def _resolve_product_id(db: Session, product_name: str) -> Optional[int]:
    if not product_name:
        return None
    p = db.query(ProductMaster).filter(ProductMaster.name == product_name.strip()).first()
    if p:
        return p.id
    # 대안: 이름이 포함되는 경우
    ps = db.query(ProductMaster).all()
    for prod in sorted(ps, key=lambda x: -len(x.name)):
        if prod.name in product_name or product_name in prod.name:
            return prod.id
    return None


def _is_summary_row(*values) -> bool:
    """소계/합계/총합계 행 판별."""
    for v in values:
        if v is None:
            continue
        s = str(v)
        if "소계" in s or "합계" in s or "총 합계" in s:
            return True
    return False


# ──────────────────────────────────────────────────────────────
# 시트 1: 채널별 매출 대시보드
# ──────────────────────────────────────────────────────────────

def import_channel_revenue(
    db: Session, file_path: str, year: int,
) -> tuple[int, list[str]]:
    """담당자×구분×채널 × 월 매출 목표 임포트.
    부산물로 직원 마스터·채널 그룹 매핑·직원-채널 매핑도 자동 생성."""
    df = pd.read_excel(file_path, sheet_name="채널별 매출 대시보드", header=2)
    df.columns = [str(c).strip() for c in df.columns]
    notes: list[str] = []

    seed_channel_groups(db)
    groups = {g.name: g for g in db.query(ChannelGroup).all()}

    rows = 0
    # 담당자/구분이 NaN인 행은 소계/공백 → 직전 행의 값을 forward-fill
    df["담당자"] = df["담당자"].ffill()
    df["구분"] = df["구분"].ffill()

    # 기존 plan 행 (해당 year) 모두 삭제 후 재삽입 (멱등성)
    db.query(BusinessPlanChannelRevenue).filter(
        BusinessPlanChannelRevenue.year == year
    ).delete(synchronize_session=False)
    db.commit()

    for _, row in df.iterrows():
        employee_name = (str(row.get("담당자") or "")).strip()
        group_name = (str(row.get("구분") or "")).strip()
        channel_raw = str(row.get("판매채널") or "").strip()
        if not channel_raw or channel_raw == "nan":
            continue
        if _is_summary_row(channel_raw):
            continue
        if not employee_name or employee_name == "nan":
            continue
        if not group_name or group_name == "nan":
            continue

        # 직원 upsert (이메일 모르면 자리값으로 생성, 추후 관리자가 매핑)
        emp = db.query(Employee).filter(Employee.name == employee_name).first()
        if not emp:
            placeholder_email = f"{employee_name}@joinnjoin.local"
            emp = Employee(email=placeholder_email, name=employee_name, role="staff", is_active=True)
            db.add(emp)
            db.flush()

        # 그룹 정규화 — 사업계획의 세분 구분을 3대 그룹으로 압축
        normalized_group = GROUP_3_MAP.get(group_name, group_name)
        group = groups.get(normalized_group)
        if not group:
            db.add(ChannelGroup(
                code=re.sub(r"[^a-zA-Z0-9_]", "_", normalized_group).lower(),
                name=normalized_group,
                big_group="오프라인" if "오프라인" in normalized_group else "온라인",
                sort_order=99,
            ))
            db.commit()
            group = db.query(ChannelGroup).filter(ChannelGroup.name == normalized_group).first()
            groups[normalized_group] = group

        # 채널 정규화
        channel_id = _resolve_channel_id(db, channel_raw)
        if not channel_id:
            # 마스터에 없으면 새 채널 생성 (기본 카테고리는 그룹 big_group)
            new_ch = Channel(
                id=str(uuid.uuid4()),
                name=normalize_channel_name(channel_raw) or channel_raw,
                category=group.big_group,
                integration_type="manual",
                is_active=True,
            )
            db.add(new_ch)
            db.flush()
            channel_id = new_ch.id

        # 채널-그룹 매핑 upsert
        mem = db.query(ChannelGroupMembership).filter(
            ChannelGroupMembership.channel_id == channel_id
        ).first()
        if not mem:
            db.add(ChannelGroupMembership(
                channel_id=channel_id,
                channel_name=normalize_channel_name(channel_raw) or channel_raw,
                group_id=group.id,
            ))
        else:
            mem.group_id = group.id

        # 직원-채널 매핑 upsert
        assign = db.query(EmployeeChannelAssignment).filter(
            EmployeeChannelAssignment.employee_id == emp.id,
            EmployeeChannelAssignment.channel_id == channel_id,
        ).first()
        if not assign:
            db.add(EmployeeChannelAssignment(
                employee_id=emp.id,
                channel_id=channel_id,
                channel_name=normalize_channel_name(channel_raw) or channel_raw,
                is_active=True,
            ))

        # 12개월 매출 목표
        for month in range(1, 13):
            col = f"{month}월"
            if col not in df.columns:
                continue
            val = row.get(col)
            try:
                rev = float(val) if val is not None and not pd.isna(val) else 0
            except Exception:
                rev = 0
            db.add(BusinessPlanChannelRevenue(
                year=year, month=month,
                employee_id=emp.id, employee_name=emp.name,
                group_id=group.id, group_name=group.name,
                channel_id=channel_id,
                channel_name=normalize_channel_name(channel_raw) or channel_raw,
                target_revenue=rev,
            ))
            rows += 1
    db.commit()
    return rows, notes


# ──────────────────────────────────────────────────────────────
# 시트 2: 채널별 판매수량
# ──────────────────────────────────────────────────────────────

def import_channel_product_qty(db: Session, file_path: str, year: int) -> int:
    df = pd.read_excel(file_path, sheet_name="채널별 판매수량", header=3)
    df.columns = [str(c).strip() for c in df.columns]
    df["판매채널"] = df["판매채널"].ffill()

    db.query(BusinessPlanProductQty).filter(
        BusinessPlanProductQty.year == year
    ).delete(synchronize_session=False)
    db.commit()

    rows = 0
    for _, row in df.iterrows():
        channel_raw = str(row.get("판매채널") or "").strip()
        product_raw = str(row.get("품목") or "").strip()
        if not channel_raw or not product_raw or product_raw == "nan":
            continue
        if _is_summary_row(channel_raw, product_raw):
            continue
        channel_id = _resolve_channel_id(db, channel_raw)
        if not channel_id:
            continue
        product_id = _resolve_product_id(db, product_raw)

        for month in range(1, 13):
            col = f"{month}월"
            if col not in df.columns:
                continue
            v = row.get(col)
            try:
                qty = float(v) if v is not None and not pd.isna(v) else 0
            except Exception:
                qty = 0
            db.add(BusinessPlanProductQty(
                year=year, month=month,
                channel_id=channel_id,
                channel_name=normalize_channel_name(channel_raw) or channel_raw,
                product_id=product_id,
                product_name=product_raw,
                target_pcs=qty,
            ))
            rows += 1
    db.commit()
    return rows


# ──────────────────────────────────────────────────────────────
# 시트 3: 판매수량 대시보드 (품목류 전체)
# ──────────────────────────────────────────────────────────────

def import_category_qty(db: Session, file_path: str, year: int) -> int:
    df = pd.read_excel(file_path, sheet_name="판매수량 대시보드", header=3)
    df.columns = [str(c).strip() for c in df.columns]
    cat_col = "품목류" if "품목류" in df.columns else df.columns[0]

    db.query(BusinessPlanCategoryQty).filter(
        BusinessPlanCategoryQty.year == year
    ).delete(synchronize_session=False)
    db.commit()

    rows = 0
    for _, row in df.iterrows():
        cat = str(row.get(cat_col) or "").strip()
        if not cat or cat == "nan":
            continue
        if _is_summary_row(cat):
            continue
        for month in range(1, 13):
            col = f"{month}월"
            if col not in df.columns:
                continue
            v = row.get(col)
            try:
                qty = float(v) if v is not None and not pd.isna(v) else 0
            except Exception:
                qty = 0
            db.add(BusinessPlanCategoryQty(
                year=year, month=month,
                product_category=cat, target_pcs=qty,
            ))
            rows += 1
    db.commit()
    return rows


# ──────────────────────────────────────────────────────────────
# 시트 4: 대시보드 (그룹별 매출 + 마케팅)
# ──────────────────────────────────────────────────────────────

def import_group_summary(db: Session, file_path: str, year: int) -> int:
    # 대시보드 시트는 헤더 위치가 변동적. 'header=None'으로 읽고 직접 탐색.
    df = pd.read_excel(file_path, sheet_name="대시보드", header=None)
    rows = 0

    db.query(BusinessPlanGroupSummary).filter(
        BusinessPlanGroupSummary.year == year
    ).delete(synchronize_session=False)

    # '구분' 행 찾기 → 그 다음 4~7개 행이 그룹별 데이터
    plan_data: dict[tuple[str, int], dict] = {}

    sections = []  # 각 섹션: (header_idx, type) type ∈ {"revenue","marketing"}
    for i in range(len(df)):
        c0 = str(df.iat[i, 0]).strip()
        if c0 == "구분":
            # 다음 비어있지 않은 컬럼이 1월이면 revenue, 매출\n대비/매출\n비중에 따라 타입
            # 우측 두번째 컬럼이 1월인지 확인 (header row)
            sections.append(i)

    if len(sections) == 0:
        return 0

    # 첫 번째 섹션: 연간 매출 계획 (혼합 매출+비중)
    # 두 번째 섹션: 마케팅 (매출 대비)
    for sec_idx, hdr in enumerate(sections):
        # 헤더 행에서 'X월' 위치 식별
        month_cols: dict[int, int] = {}  # month → column index
        for col_idx in range(df.shape[1]):
            v = df.iat[hdr, col_idx]
            if v is None or pd.isna(v):
                continue
            s = str(v).strip()
            m = re.match(r"^(\d{1,2})월$", s)
            if m:
                month_cols[int(m.group(1))] = col_idx
        if not month_cols:
            continue
        # 데이터 행: hdr+1 ~ 다음 섹션 직전 or 빈줄
        end = sections[sec_idx + 1] if sec_idx + 1 < len(sections) else len(df)
        for r in range(hdr + 1, end):
            grp = df.iat[r, 0]
            if grp is None or pd.isna(grp):
                continue
            grp_s = str(grp).strip()
            if grp_s in ("합계", "총 합계", ""):
                continue
            # 정규화: 오프라인(전체) / 오프라인 → 오프라인
            for month, col_idx in month_cols.items():
                v = df.iat[r, col_idx]
                try:
                    val = float(v) if v is not None and not pd.isna(v) else 0
                except Exception:
                    val = 0
                # 비중 컬럼은 다음 컬럼에 있음 (있을 수 있음)
                share = None
                share_col = col_idx + 1
                if share_col < df.shape[1]:
                    sv = df.iat[hdr, share_col]
                    if sv is not None and not pd.isna(sv) and "비중" in str(sv) or (
                        sv is not None and not pd.isna(sv) and "대비" in str(sv)
                    ):
                        sv_val = df.iat[r, share_col]
                        try:
                            share = float(sv_val) if sv_val is not None and not pd.isna(sv_val) else None
                        except Exception:
                            share = None
                key = (grp_s, month)
                bucket = plan_data.setdefault(key, {})
                if sec_idx == 0:
                    bucket["target_revenue"] = val
                    bucket["revenue_share"] = share
                else:
                    bucket["target_marketing"] = val
                    bucket["marketing_share"] = share

    for (grp, month), d in plan_data.items():
        db.add(BusinessPlanGroupSummary(
            year=year, month=month, group_name=grp,
            target_revenue=d.get("target_revenue", 0) or 0,
            revenue_share=d.get("revenue_share"),
            target_marketing=d.get("target_marketing", 0) or 0,
            marketing_share=d.get("marketing_share"),
        ))
        rows += 1
    db.commit()
    return rows


# ──────────────────────────────────────────────────────────────
# 통합 엔트리 포인트
# ──────────────────────────────────────────────────────────────

def import_business_plan(
    db: Session, file_path: str, file_name: str, year: int,
    uploaded_by: Optional[str] = None,
) -> BusinessPlanUploadBatch:
    batch_id = str(uuid.uuid4())
    batch = BusinessPlanUploadBatch(
        id=batch_id, year=year, file_name=file_name,
        uploaded_by=uploaded_by, status="done",
    )
    notes = []
    try:
        batch.revenue_rows, n = import_channel_revenue(db, file_path, year)
        notes.extend(n)
        batch.qty_rows = import_channel_product_qty(db, file_path, year)
        batch.category_rows = import_category_qty(db, file_path, year)
        batch.summary_rows = import_group_summary(db, file_path, year)
    except Exception as e:
        batch.status = "failed"
        batch.notes = f"{type(e).__name__}: {e}"
        log.exception("plan import failed")
    if notes and not batch.notes:
        batch.notes = " / ".join(notes)
    db.add(batch)
    db.commit()
    return batch
