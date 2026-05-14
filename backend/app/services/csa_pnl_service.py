"""월별 P&L 엑셀 뷰 서비스.

행 계층:
  1. 매출액 (auto)
  2. 원가(변동비) (auto subtotal)
     ├ 원재료 (manual)
     ├ 부재료 (manual)
     ├ 노무비 (auto)
     └ 제조간접비 (auto)
  3. 원가(고정비) (manual subtotal)
  4. 매출총이익 (formula: 1 - 2 - 3)
  5. 판관비(변동비) (auto subtotal)
     ├ 광고비 (auto)
     ├ 판매수수료 (auto)
     ├ 운반비 (auto)
     ├ 포장비 (auto)
     └ 물류비 (auto)
  6. 판관비(고정비) (manual subtotal)
  7. 영업이익 (formula: 4 - 5 - 6)
  8. 공헌이익 (formula: 1 - 2 - 5)
"""
from __future__ import annotations

import logging
from typing import Optional

import bcrypt
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db_models import (
    CsaPnlRow,
    CsaPnlValue,
    CsaPnlConfig,
    ChannelSalesDailyProduct,
    BusinessPlanChannelRevenue,
    BusinessPlanProductQty,
)

log = logging.getLogger(__name__)


OWNER_EMAIL = "lion9080@joinandjoin.com"


# ──────────────────────────────────────────────────────────────
# 행 시드
# ──────────────────────────────────────────────────────────────

ROW_SEED = [
    # (code, label, section, parent_code, sign, is_subtotal, is_computed, formula_code, sort_order)
    ("revenue",          "매출액",          "revenue",      None,             1, True,  True,  "revenue",          100),
    ("cogs_var",         "원가(변동비)",     "cogs_var",     None,             -1, True,  True,  "cogs_var_subtotal", 200),
    ("cogs_raw",         "원재료",          "cogs_var",     "cogs_var",       1, False, False, None,                210),
    ("cogs_sub",         "부재료",          "cogs_var",     "cogs_var",       1, False, False, None,                220),
    ("cogs_labor",       "노무비",          "cogs_var",     "cogs_var",       1, False, True,  "labor",             230),
    ("cogs_overhead",    "제조간접비",      "cogs_var",     "cogs_var",       1, False, True,  "overhead",          240),
    ("cogs_fixed",       "원가(고정비)",     "cogs_fixed",   None,             -1, True,  False, None,                300),
    ("gross_profit",     "매출총이익",      "gross_profit", None,             1, True,  True,  "gross_profit",     400),
    ("sga_var",          "판관비(변동비)",   "sga_var",      None,             -1, True,  True,  "sga_var_subtotal",  500),
    ("sga_ads",          "광고비",          "sga_var",      "sga_var",        1, False, True,  "advertising",       510),
    ("sga_commission",   "판매수수료",      "sga_var",      "sga_var",        1, False, True,  "commission_all",    520),
    ("sga_shipping",     "운반비(택배비)",   "sga_var",      "sga_var",        1, False, True,  "shipping",          530),
    ("sga_packaging",    "포장비",          "sga_var",      "sga_var",        1, False, True,  "packaging",         540),
    ("sga_logistics",    "물류비",          "sga_var",      "sga_var",        1, False, True,  "logistics",         550),
    ("sga_fixed",        "판관비(고정비)",   "sga_fixed",    None,             -1, True,  False, None,                600),
    ("op_profit",        "영업이익",        "op_profit",    None,             1, True,  True,  "op_profit",        700),
    ("cm",               "공헌이익",        "cm",           None,             1, True,  True,  "contribution_margin", 800),
]


def seed_pnl_rows(db: Session) -> int:
    code_to_id: dict[str, int] = {}
    created = 0
    # 1차: 모든 행 (parent 없이) 삽입 — 코드 충돌 시 skip
    for code, label, section, parent_code, sign, is_subtotal, is_computed, formula, sort in ROW_SEED:
        existing = db.query(CsaPnlRow).filter(CsaPnlRow.code == code).first()
        if existing:
            code_to_id[code] = existing.id
            continue
        row = CsaPnlRow(
            code=code, label=label, section=section, sign=sign,
            is_subtotal=is_subtotal, is_computed=is_computed,
            formula_code=formula, sort_order=sort,
        )
        db.add(row); db.flush()
        code_to_id[code] = row.id
        created += 1
    db.commit()
    # 2차: parent_id 매핑
    for code, _, _, parent_code, *_ in ROW_SEED:
        if parent_code:
            r = db.query(CsaPnlRow).filter(CsaPnlRow.code == code).first()
            p = code_to_id.get(parent_code)
            if r and p and r.parent_id != p:
                r.parent_id = p
    db.commit()
    return created


# ──────────────────────────────────────────────────────────────
# 자동 계산 — 실측(actual) 및 계획(plan)
# ──────────────────────────────────────────────────────────────

def _sum_daily_field(db: Session, year: int, month: int, field: str) -> float:
    col = getattr(ChannelSalesDailyProduct, field)
    v = db.query(func.sum(col)).filter(
        ChannelSalesDailyProduct.year == year,
        ChannelSalesDailyProduct.month == month,
    ).scalar()
    return float(v or 0)


def compute_actual(db: Session, year: int) -> dict[tuple[str, int], float]:
    """{(formula_code, month): value} 형태로 자동 계산값 반환."""
    out: dict[tuple[str, int], float] = {}
    for month in range(1, 13):
        rev = _sum_daily_field(db, year, month, "net_sales")
        labor = _sum_daily_field(db, year, month, "cost_labor")
        overhead = _sum_daily_field(db, year, month, "cost_overhead")
        cogs_basic = _sum_daily_field(db, year, month, "cost_cogs")  # 원가 항목 (rule 기준)
        adv = _sum_daily_field(db, year, month, "cost_advertising")
        commr = _sum_daily_field(db, year, month, "cost_commission_rate")
        commf = _sum_daily_field(db, year, month, "cost_commission_fixed")
        ship = _sum_daily_field(db, year, month, "cost_shipping")
        pack = _sum_daily_field(db, year, month, "cost_packaging")
        lw = _sum_daily_field(db, year, month, "cost_logistics_work")
        lo = _sum_daily_field(db, year, month, "cost_logistics_oh")

        out[("revenue", month)] = rev
        # cost_cogs는 csa_cost_rule '원가' 규칙으로 계산된 값 → 자동 행 cogs_raw에 일단 반영하지 않음
        # (원재료/부재료는 manual 우선). 단 자동 계산 cogs_raw_auto는 별도 키로 노출.
        out[("cogs_raw_auto", month)] = cogs_basic  # 정보 제공용
        out[("labor", month)] = labor
        out[("overhead", month)] = overhead
        out[("advertising", month)] = adv
        out[("commission_all", month)] = commr + commf
        out[("shipping", month)] = ship
        out[("packaging", month)] = pack
        out[("logistics", month)] = lw + lo
    return out


def compute_plan(db: Session, year: int) -> dict[tuple[str, int], float]:
    """사업계획 매출 합계만 자동 (그 외는 manual)."""
    out: dict[tuple[str, int], float] = {}
    rows = db.query(
        BusinessPlanChannelRevenue.month,
        func.sum(BusinessPlanChannelRevenue.target_revenue),
    ).filter(BusinessPlanChannelRevenue.year == year).group_by(
        BusinessPlanChannelRevenue.month
    ).all()
    for month, total in rows:
        out[("revenue", month)] = float(total or 0)
    return out


# ──────────────────────────────────────────────────────────────
# 조회 — 8행 트리 × 12월 매트릭스
# ──────────────────────────────────────────────────────────────

def get_pnl_matrix(db: Session, year: int) -> dict:
    seed_pnl_rows(db)
    rows = db.query(CsaPnlRow).filter(CsaPnlRow.is_active).order_by(CsaPnlRow.sort_order).all()
    actual_calc = compute_actual(db, year)
    plan_calc = compute_plan(db, year)

    # DB에 저장된 manual 값
    manual_vals: dict[tuple[int, int, str], float] = {}
    for v in db.query(CsaPnlValue).filter(CsaPnlValue.year == year).all():
        manual_vals[(v.row_id, v.month, v.scope)] = v.value

    # 행별 월 값 계산 (자동 우선, manual override 가능)
    matrix: dict[int, dict] = {}  # row_id → {actual: [..12..], plan: [..12..]}

    code_by_id = {r.id: r.code for r in rows}

    def base_value(r: CsaPnlRow, scope: str, month: int) -> float:
        # manual 입력값이 있으면 우선
        mv = manual_vals.get((r.id, month, scope))
        if mv is not None:
            return mv
        if not r.is_computed:
            return 0.0
        if r.formula_code:
            calc = actual_calc if scope == "actual" else plan_calc
            return calc.get((r.formula_code, month), 0.0)
        return 0.0

    # 단순 자동 행 먼저 (formula_code 있는 leaf)
    leaf_results: dict[int, dict[str, list[float]]] = {}
    for r in rows:
        if r.is_subtotal:
            continue
        actuals = [base_value(r, "actual", m) for m in range(1, 13)]
        plans = [base_value(r, "plan", m) for m in range(1, 13)]
        leaf_results[r.id] = {"actual": actuals, "plan": plans}

    # 소계 행 계산
    children_by_parent: dict[int, list[CsaPnlRow]] = {}
    for r in rows:
        if r.parent_id:
            children_by_parent.setdefault(r.parent_id, []).append(r)

    def subtotal_value(parent_id: int, scope: str, month_idx: int) -> float:
        total = 0.0
        for child in children_by_parent.get(parent_id, []):
            child_vals = leaf_results.get(child.id)
            if child_vals:
                total += child_vals[scope][month_idx] * (child.sign or 1)
        return total

    subtotal_results: dict[int, dict[str, list[float]]] = {}
    by_code: dict[str, CsaPnlRow] = {r.code: r for r in rows}

    for r in rows:
        if not r.is_subtotal:
            continue
        # 1) 수동 입력 우선 (월별 manual_vals)
        actuals = []; plans = []
        for idx, m in enumerate(range(1, 13)):
            ma = manual_vals.get((r.id, m, "actual"))
            mp = manual_vals.get((r.id, m, "plan"))
            if ma is not None:
                actuals.append(ma)
            elif r.is_computed and r.formula_code in ("revenue", "advertising", "labor", "overhead",
                                                       "commission_all", "shipping", "packaging", "logistics"):
                actuals.append(actual_calc.get((r.formula_code, m), 0.0))
            elif r.is_computed and r.formula_code in ("cogs_var_subtotal", "sga_var_subtotal"):
                actuals.append(subtotal_value(r.id, "actual", idx))
            else:
                actuals.append(0.0)

            if mp is not None:
                plans.append(mp)
            elif r.is_computed and r.formula_code == "revenue":
                plans.append(plan_calc.get(("revenue", m), 0.0))
            elif r.is_computed and r.formula_code in ("cogs_var_subtotal", "sga_var_subtotal"):
                plans.append(subtotal_value(r.id, "plan", idx))
            else:
                plans.append(0.0)
        subtotal_results[r.id] = {"actual": actuals, "plan": plans}

    # formula 행 (gross_profit, op_profit, cm) 계산
    def formula_row(code: str, scope: str, idx: int) -> float:
        def get(c: str) -> float:
            row = by_code.get(c)
            if not row:
                return 0.0
            if row.is_subtotal and row.id in subtotal_results:
                return subtotal_results[row.id][scope][idx]
            if row.id in leaf_results:
                return leaf_results[row.id][scope][idx]
            return 0.0
        if code == "gross_profit":
            return get("revenue") - get("cogs_var") - get("cogs_fixed")
        if code == "op_profit":
            return get("gross_profit") - get("sga_var") - get("sga_fixed")
        if code == "contribution_margin":
            return get("revenue") - get("cogs_var") - get("sga_var")
        return 0.0

    for code in ("gross_profit", "op_profit", "cm"):
        r = by_code.get(code)
        if not r:
            continue
        if r.id in subtotal_results:
            continue
        formula_actuals = [formula_row(r.formula_code, "actual", i) for i in range(12)]
        formula_plans = [formula_row(r.formula_code, "plan", i) for i in range(12)]
        # manual override 적용
        for i, m in enumerate(range(1, 13)):
            ma = manual_vals.get((r.id, m, "actual"))
            mp = manual_vals.get((r.id, m, "plan"))
            if ma is not None: formula_actuals[i] = ma
            if mp is not None: formula_plans[i] = mp
        subtotal_results[r.id] = {"actual": formula_actuals, "plan": formula_plans}

    # 응답 구조 (계층 순서대로)
    out_rows = []
    for r in rows:
        vals = subtotal_results.get(r.id) or leaf_results.get(r.id) or {"actual": [0]*12, "plan": [0]*12}
        out_rows.append({
            "id": r.id, "code": r.code, "label": r.label,
            "section": r.section, "parent_id": r.parent_id,
            "sign": r.sign, "is_subtotal": r.is_subtotal,
            "is_computed": r.is_computed,
            "formula_code": r.formula_code,
            "sort_order": r.sort_order,
            "actual": vals["actual"],
            "plan": vals["plan"],
        })
    return {"year": year, "rows": out_rows}


# ──────────────────────────────────────────────────────────────
# 셀 저장 / 행 추가 / 행 삭제
# ──────────────────────────────────────────────────────────────

def upsert_value(db: Session, *, year: int, month: int, row_id: int, scope: str,
                 value: float, updated_by: Optional[str] = None) -> int:
    existing = db.query(CsaPnlValue).filter(
        CsaPnlValue.year == year, CsaPnlValue.month == month,
        CsaPnlValue.row_id == row_id, CsaPnlValue.scope == scope,
    ).first()
    if existing:
        existing.value = value
        existing.is_manual = True
        existing.updated_by = updated_by
        db.commit()
        return existing.id
    new = CsaPnlValue(
        year=year, month=month, row_id=row_id, scope=scope,
        value=value, is_manual=True, updated_by=updated_by,
    )
    db.add(new); db.commit()
    return new.id


def add_custom_row(db: Session, *, parent_id: int, label: str, section: str) -> int:
    """고정비 등에 사용자 정의 sub-row 추가."""
    parent = db.query(CsaPnlRow).filter(CsaPnlRow.id == parent_id).first()
    if not parent:
        raise ValueError("parent row not found")
    code = f"custom_{section}_{db.query(CsaPnlRow).filter(CsaPnlRow.parent_id == parent_id).count() + 1}_{label[:20]}"
    code = code.replace(" ", "_")
    row = CsaPnlRow(
        code=code, label=label, section=parent.section,
        parent_id=parent_id, sign=1, is_subtotal=False,
        is_computed=False, formula_code=None,
        sort_order=(parent.sort_order or 0) + 1,
    )
    db.add(row); db.commit()
    return row.id


def delete_row(db: Session, row_id: int) -> bool:
    row = db.query(CsaPnlRow).filter(CsaPnlRow.id == row_id).first()
    if not row:
        return False
    # 시드 행(parent_id가 None인 핵심 8행 + 자동 leaf)은 삭제 금지
    SEED_CODES = {r[0] for r in ROW_SEED}
    if row.code in SEED_CODES:
        raise ValueError("기본 행은 삭제할 수 없습니다")
    db.query(CsaPnlValue).filter(CsaPnlValue.row_id == row_id).delete()
    db.delete(row); db.commit()
    return True


# ──────────────────────────────────────────────────────────────
# 비밀번호
# ──────────────────────────────────────────────────────────────

def _get_or_create_config(db: Session) -> CsaPnlConfig:
    cfg = db.query(CsaPnlConfig).first()
    if not cfg:
        cfg = CsaPnlConfig(id=1, owner_email=OWNER_EMAIL)
        db.add(cfg); db.commit()
    return cfg


def is_password_set(db: Session) -> bool:
    cfg = _get_or_create_config(db)
    return bool(cfg.password_hash)


def can_set_password(user_email: str) -> bool:
    return user_email.lower() == OWNER_EMAIL.lower()


def set_password(db: Session, *, new_password: str, current_user: str) -> bool:
    if not can_set_password(current_user):
        raise PermissionError(f"비밀번호는 {OWNER_EMAIL} 만 설정할 수 있습니다")
    cfg = _get_or_create_config(db)
    cfg.password_hash = bcrypt.hashpw(new_password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
    cfg.updated_by = current_user
    db.commit()
    return True


def verify_password(db: Session, password: str) -> bool:
    cfg = _get_or_create_config(db)
    if not cfg.password_hash:
        return False
    try:
        return bcrypt.checkpw(password.encode("utf-8"), cfg.password_hash.encode("utf-8"))
    except Exception:
        return False
