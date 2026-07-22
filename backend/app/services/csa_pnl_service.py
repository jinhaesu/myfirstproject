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
    BusinessPlanGroupSummary,
    BusinessPlanUploadBatch,
    CsaCostItem,
    CsaCostRule,
    CsaChannelMonthlyCost,
)

log = logging.getLogger(__name__)


OWNER_EMAIL = "lion9080@joinandjoin.com"


def _migrate_cogs_split_to_material(db: Session) -> None:
    """cogs_raw + cogs_sub 두 행을 cogs_material 단일 행으로 통합.

    1회성 마이그레이션. 멱등하게 동작.
    - 두 행의 manual 값은 cogs_material에 합산
    - 합산 후 cogs_raw, cogs_sub 행은 비활성화 (삭제는 외래키 위험)
    """
    raw = db.query(CsaPnlRow).filter(CsaPnlRow.code == "cogs_raw").first()
    sub = db.query(CsaPnlRow).filter(CsaPnlRow.code == "cogs_sub").first()
    if not raw and not sub:
        return  # 이미 마이그레이션됨

    # cogs_material 행 확보 (없으면 생성)
    material = db.query(CsaPnlRow).filter(CsaPnlRow.code == "cogs_material").first()
    parent = db.query(CsaPnlRow).filter(CsaPnlRow.code == "cogs_var").first()
    if not material:
        material = CsaPnlRow(
            code="cogs_material", label="원가(원재료+부재료)",
            section="cogs_var", parent_id=parent.id if parent else None,
            sign=1, is_subtotal=False, is_computed=True,
            formula_code="cogs_material", sort_order=210,
        )
        db.add(material); db.flush()

    # 기존 manual 값 합산
    legacy_ids = [r.id for r in (raw, sub) if r]
    if legacy_ids:
        legacy_values = db.query(CsaPnlValue).filter(CsaPnlValue.row_id.in_(legacy_ids)).all()
        agg: dict[tuple[int, int, str], float] = {}
        for v in legacy_values:
            key = (v.year, v.month, v.scope)
            agg[key] = agg.get(key, 0) + (v.value or 0)
        for (yr, mo, sc), total in agg.items():
            if total == 0:
                continue
            existing = db.query(CsaPnlValue).filter(
                CsaPnlValue.year == yr, CsaPnlValue.month == mo,
                CsaPnlValue.row_id == material.id, CsaPnlValue.scope == sc,
            ).first()
            if existing:
                existing.value = (existing.value or 0) + total
                existing.is_manual = True
            else:
                db.add(CsaPnlValue(
                    year=yr, month=mo, row_id=material.id, scope=sc,
                    value=total, is_manual=True, notes="migrated from cogs_raw+cogs_sub",
                ))

    # 기존 leaf 행 비활성화 + 시드 외 행으로 표시 (이름 변경)
    for r in (raw, sub):
        if r:
            r.is_active = False
            # code 충돌 방지를 위해 prefix 변경
            if not r.code.startswith("_legacy_"):
                r.code = f"_legacy_{r.code}"

    db.commit()


# ──────────────────────────────────────────────────────────────
# 행 시드
# ──────────────────────────────────────────────────────────────

ROW_SEED = [
    # (code, label, section, parent_code, sign, is_subtotal, is_computed, formula_code, sort_order)
    ("revenue",          "매출액",          "revenue",      None,             1, True,  True,  "revenue",          100),
    ("cogs_var",         "원가(변동비)",     "cogs_var",     None,             -1, True,  True,  "cogs_var_subtotal", 200),
    ("cogs_material",    "원가(원재료+부재료)", "cogs_var",  "cogs_var",       1, False, True,  "cogs_material",    210),
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

    # 기존 cogs_raw/cogs_sub → cogs_material 마이그레이션 (1회성, 멱등)
    _migrate_cogs_split_to_material(db)

    # 1차: 모든 행 (parent 없이) 삽입 — 코드 충돌 시 핵심 속성 갱신
    for code, label, section, parent_code, sign, is_subtotal, is_computed, formula, sort in ROW_SEED:
        existing = db.query(CsaPnlRow).filter(CsaPnlRow.code == code).first()
        if existing:
            # 기존 행이 있어도 label/is_computed/formula_code/section 등 핵심 메타는 시드 정의로 동기화
            changed = False
            if existing.label != label: existing.label = label; changed = True
            if existing.section != section: existing.section = section; changed = True
            if existing.sign != sign: existing.sign = sign; changed = True
            if existing.is_subtotal != is_subtotal: existing.is_subtotal = is_subtotal; changed = True
            if existing.is_computed != is_computed: existing.is_computed = is_computed; changed = True
            if existing.formula_code != formula: existing.formula_code = formula; changed = True
            if existing.sort_order != sort: existing.sort_order = sort; changed = True
            if changed:
                db.add(existing)
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


def compute_actual(db: Session, year: int,
                   channel_ids: Optional[list[str]] = None) -> dict[tuple[str, int], float]:
    """{(formula_code, month): value} 형태로 자동 계산값 반환.

    이전엔 (12개월 × 11개 컬럼 = 132개) 개별 SUM query를 순차 호출했으나
    Supabase pooler RTT × 132 ≈ 30~60초로 PNL endpoint timeout. 단일 GROUP BY 1회 호출로 통합.

    channel_ids: 주어지면 해당 채널만 집계(채널·담당자 필터). None이면 전사.
    """
    q = db.query(
        ChannelSalesDailyProduct.month,
        # 매출 = net_sales − 매출차감형 월정액(revenue_deduction, 예: 쿠팡 로켓프레시)
        func.coalesce(func.sum(
            ChannelSalesDailyProduct.net_sales
            - func.coalesce(ChannelSalesDailyProduct.revenue_deduction, 0.0)
        ), 0),
        func.coalesce(func.sum(ChannelSalesDailyProduct.cost_labor), 0),
        func.coalesce(func.sum(ChannelSalesDailyProduct.cost_overhead), 0),
        func.coalesce(func.sum(ChannelSalesDailyProduct.cost_cogs), 0),
        func.coalesce(func.sum(ChannelSalesDailyProduct.cost_advertising), 0),
        func.coalesce(func.sum(ChannelSalesDailyProduct.cost_commission_rate), 0),
        func.coalesce(func.sum(ChannelSalesDailyProduct.cost_commission_fixed), 0),
        func.coalesce(func.sum(ChannelSalesDailyProduct.cost_shipping), 0),
        func.coalesce(func.sum(ChannelSalesDailyProduct.cost_packaging), 0),
        func.coalesce(func.sum(ChannelSalesDailyProduct.cost_logistics_work), 0),
        func.coalesce(func.sum(ChannelSalesDailyProduct.cost_logistics_oh), 0),
    ).filter(
        ChannelSalesDailyProduct.year == year,
    )
    if channel_ids is not None:
        q = q.filter(ChannelSalesDailyProduct.channel_id.in_(channel_ids))
    rows = q.group_by(ChannelSalesDailyProduct.month).all()

    out: dict[tuple[str, int], float] = {}
    # 데이터 없는 월은 0으로 채움 (frontend는 12개월 전체 노출)
    for m in range(1, 13):
        out[("revenue", m)] = 0.0
        out[("cogs_material", m)] = 0.0
        out[("labor", m)] = 0.0
        out[("overhead", m)] = 0.0
        out[("advertising", m)] = 0.0
        out[("commission_all", m)] = 0.0
        out[("shipping", m)] = 0.0
        out[("packaging", m)] = 0.0
        out[("logistics", m)] = 0.0
    for r in rows:
        m = int(r[0])
        out[("revenue", m)] = float(r[1] or 0)
        out[("labor", m)] = float(r[2] or 0)
        out[("overhead", m)] = float(r[3] or 0)
        # cost_cogs = 변동비 설정의 '원가' 규칙 합 (원재료+부재료 통합)
        out[("cogs_material", m)] = float(r[4] or 0)
        out[("advertising", m)] = float(r[5] or 0)
        out[("commission_all", m)] = float(r[6] or 0) + float(r[7] or 0)
        out[("shipping", m)] = float(r[8] or 0)
        out[("packaging", m)] = float(r[9] or 0)
        out[("logistics", m)] = float(r[10] or 0) + float(r[11] or 0)
    return out


def compute_plan(db: Session, year: int,
                 channel_ids: Optional[list[str]] = None) -> dict[tuple[str, int], float]:
    """사업계획 매출/수량 + 변동비 규칙으로 plan 공헌이익까지 자동 산출.

    사업계획 엑셀에는 매출(채널×월)과 수량(채널×품목×월)만 들어있으므로,
    변동비 설정(채널/품목/기간별 규칙)을 곱해 변동비 plan을 만들고
    공헌이익 plan = 매출 − 변동비(원가+판관) 으로 산출한다.

    channel_ids: 주어지면 해당 채널만 집계. 이때 사업계획 그룹요약(광고비·공헌이익
    target)은 채널 차원이 없어 채널 귀속이 불가하므로 override를 쓰지 않고
    필터된 구성요소로 공헌이익을 다시 산출한다.
    """
    filtered = channel_ids is not None
    import time as _time
    _tp0 = _time.time()
    def _plap(label):
        nonlocal _tp0
        print(f"[compute_plan] {label}: {(_time.time()-_tp0)*1000:.0f}ms", flush=True)
        _tp0 = _time.time()
    from datetime import date as _date
    from app.services.csa_cost_service import _best_rule

    out: dict[tuple[str, int], float] = {}

    # 0) 사업계획 업로드 이력이 없으면 plan 테이블 전체가 비어있음 — 아래 6개 쿼리 스킵.
    #    Railway↔Supabase cross-region RTT 313ms × 6 ≈ 1.9s 낭비 방지.
    plan_exists = db.query(BusinessPlanUploadBatch.id).filter(
        BusinessPlanUploadBatch.year == year,
        BusinessPlanUploadBatch.status == "done",
    ).first()
    if not plan_exists:
        _plap("plan_empty_shortcut")
        return out

    # 1) 채널×월 매출 plan
    rev_q = db.query(
        BusinessPlanChannelRevenue.channel_id,
        BusinessPlanChannelRevenue.month,
        func.sum(BusinessPlanChannelRevenue.target_revenue),
    ).filter(BusinessPlanChannelRevenue.year == year)
    if filtered:
        rev_q = rev_q.filter(BusinessPlanChannelRevenue.channel_id.in_(channel_ids))
    rev_rows = rev_q.group_by(
        BusinessPlanChannelRevenue.channel_id, BusinessPlanChannelRevenue.month,
    ).all()
    _plap("rev_rows")
    channel_month_rev: dict[tuple[str, int], float] = {}
    monthly_rev: dict[int, float] = {}
    for ch, m, total in rev_rows:
        amt = float(total or 0)
        channel_month_rev[(ch, m)] = amt
        monthly_rev[m] = monthly_rev.get(m, 0) + amt
    for m, total in monthly_rev.items():
        out[("revenue", m)] = total

    # 2) 변동비 규칙 캐시
    items = {it.code: it for it in db.query(CsaCostItem).filter(CsaCostItem.is_active.is_(True)).all()}
    rules_by_item: dict[int, list[CsaCostRule]] = {}
    for r in db.query(CsaCostRule).filter(CsaCostRule.is_active.is_(True)).all():
        rules_by_item.setdefault(r.cost_item_id, []).append(r)
    _plap("rules_cache")

    def rule_for(code: str, ch: str, pid: Optional[int], ref_date):
        it = items.get(code)
        if not it:
            return None
        return _best_rule(rules_by_item.get(it.id, []), ch, pid, ref_date)

    # 3) 채널×품목×월 수량 plan → 낱개 기준 (cogs, labor)
    qty_q = db.query(BusinessPlanProductQty).filter(
        BusinessPlanProductQty.year == year
    )
    if filtered:
        qty_q = qty_q.filter(BusinessPlanProductQty.channel_id.in_(channel_ids))
    qty_rows = qty_q.all()
    _plap(f"qty_rows({len(qty_rows)})")
    cogs_by_month: dict[int, float] = {m: 0.0 for m in range(1, 13)}
    labor_by_month: dict[int, float] = {m: 0.0 for m in range(1, 13)}
    for q in qty_rows:
        ref = _date(year, q.month, 15)
        pcs = float(q.target_pcs or 0)
        if pcs == 0:
            continue
        r_cogs = rule_for("cogs", q.channel_id, q.product_id, ref)
        if r_cogs and r_cogs.amount_per_pcs:
            cogs_by_month[q.month] += pcs * float(r_cogs.amount_per_pcs)
        r_labor = rule_for("labor", q.channel_id, q.product_id, ref)
        if r_labor and r_labor.amount_per_pcs:
            labor_by_month[q.month] += pcs * float(r_labor.amount_per_pcs)
    for m in range(1, 13):
        out[("cogs_material", m)] = cogs_by_month[m]
        out[("labor", m)] = labor_by_month[m]
    _plap("qty_loop")

    # 4) 매출 정률 기반: overhead, logistics_work, logistics_oh, commission_rate
    rate_codes = ("overhead", "logistics_work", "logistics_oh", "commission_rate")
    rate_buckets: dict[str, dict[int, float]] = {c: {m: 0.0 for m in range(1, 13)} for c in rate_codes}
    for (ch, m), rev in channel_month_rev.items():
        if rev == 0:
            continue
        ref = _date(year, m, 15)
        for code in rate_codes:
            r = rule_for(code, ch, None, ref)
            if r and r.rate:
                rate_buckets[code][m] += rev * float(r.rate)

    for m in range(1, 13):
        out[("overhead", m)] = rate_buckets["overhead"][m]
        out[("logistics", m)] = rate_buckets["logistics_work"][m] + rate_buckets["logistics_oh"][m]
        out[("commission_all", m)] = rate_buckets["commission_rate"][m]
    _plap("rate_loop")

    # 5) 광고비 plan: 사업계획 그룹별 target_marketing 합 우선, 없으면 채널 월 광고비 합
    adv_by_month: dict[int, float] = {m: 0.0 for m in range(1, 13)}
    group_rows = db.query(
        BusinessPlanGroupSummary.month,
        func.sum(BusinessPlanGroupSummary.target_marketing),
    ).filter(BusinessPlanGroupSummary.year == year).group_by(
        BusinessPlanGroupSummary.month
    ).all()
    # 그룹요약 광고비는 채널 차원이 없어 필터 시 귀속 불가 → 필터 중엔 채널월 광고비만 사용
    if not filtered and any((total or 0) > 0 for _, total in group_rows):
        for m, total in group_rows:
            adv_by_month[m] = float(total or 0)
    else:
        adv_item = items.get("advertising")
        if adv_item:
            adv_q = db.query(
                CsaChannelMonthlyCost.month,
                func.sum(CsaChannelMonthlyCost.amount),
            ).filter(
                CsaChannelMonthlyCost.year == year,
                CsaChannelMonthlyCost.cost_item_id == adv_item.id,
            )
            if filtered:
                adv_q = adv_q.filter(CsaChannelMonthlyCost.channel_id.in_(channel_ids))
            adv_rows = adv_q.group_by(CsaChannelMonthlyCost.month).all()
            for m, total in adv_rows:
                adv_by_month[m] = float(total or 0)
    for m in range(1, 13):
        out[("advertising", m)] = adv_by_month[m]
    _plap("advertising")

    # 사업계획 엑셀의 그룹별 공헌이익 합계 (대시보드 시트 '공헌이익' 섹션)
    # 그룹요약은 채널 차원이 없어 필터 시 override 불가 → 필터 중엔 매출−변동비 산식으로만 산출
    if not filtered:
        cm_by_month: dict[int, float] = {m: 0.0 for m in range(1, 13)}
        cm_rows = db.query(
            BusinessPlanGroupSummary.month,
            func.sum(BusinessPlanGroupSummary.target_cm),
        ).filter(BusinessPlanGroupSummary.year == year).group_by(
            BusinessPlanGroupSummary.month
        ).all()
        for m, total in cm_rows:
            cm_by_month[m] = float(total or 0)
        for m in range(1, 13):
            if cm_by_month[m]:
                out[("contribution_margin", m)] = cm_by_month[m]
    _plap("cm_rows")

    # 주문건수 기반(commission_fixed, shipping order_fixed, packaging)은 plan에 주문수가 없어 0으로 둠
    return out


# ──────────────────────────────────────────────────────────────
# 조회 — 8행 트리 × 12월 매트릭스
# ──────────────────────────────────────────────────────────────

def get_pnl_matrix(db: Session, year: int,
                   channel_ids: Optional[list[str]] = None) -> dict:
    """월별 P&L 매트릭스. channel_ids가 주어지면 해당 채널만(채널·담당자 필터).

    필터 적용 시 수동입력값(원재료 override·고정비 등 회사 전체 값)은 채널 귀속이
    불가하므로 제외한다 → 매출·변동비·공헌이익만 채널/담당자 기준으로 산출되고,
    고정비·매출총이익·영업이익은 0으로 비운다. (frontend가 'filtered' 플래그로 안내)
    """
    import time as _time
    _t0 = _time.time()
    def _lap(label):
        nonlocal _t0
        print(f"[pnl_matrix] {label}: {(_time.time()-_t0)*1000:.0f}ms", flush=True)
        _t0 = _time.time()

    # rows를 먼저 1회 조회하고, seed 필요 여부는 그 결과에서 판단 (count 쿼리 1회 제거).
    rows = db.query(CsaPnlRow).filter(CsaPnlRow.is_active.is_(True)).order_by(CsaPnlRow.sort_order).all()
    _lap("rows")
    seed_codes = {r[0] for r in ROW_SEED}
    existing_seed = sum(1 for r in rows if r.code in seed_codes)
    if existing_seed < len(ROW_SEED):
        seed_pnl_rows(db)
        rows = db.query(CsaPnlRow).filter(CsaPnlRow.is_active.is_(True)).order_by(CsaPnlRow.sort_order).all()
        _lap("seed+reload")
    actual_calc = compute_actual(db, year, channel_ids=channel_ids)
    _lap("compute_actual")
    plan_calc = compute_plan(db, year, channel_ids=channel_ids)
    _lap("compute_plan")

    # DB에 저장된 manual 값 (원재료·부재료·고정비 등). 회사 전체 값이라 채널 차원이
    # 없으므로 채널/담당자 필터 중엔 제외 — 필터 뷰는 변동비·공헌이익만 정확히 표시.
    manual_vals: dict[tuple[int, int, str], float] = {}
    if channel_ids is None:
        for v in db.query(CsaPnlValue).filter(CsaPnlValue.year == year).all():
            manual_vals[(v.row_id, v.month, v.scope)] = v.value
    _lap("manual_vals")

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

    # gross_profit/op_profit/cm은 별도 formula 루프에서 처리하므로 여기서는 skip
    FORMULA_ROWS = {"gross_profit", "op_profit", "contribution_margin"}

    for r in rows:
        if not r.is_subtotal:
            continue
        if r.formula_code in FORMULA_ROWS:
            continue
        # 1) 수동 입력 우선 (월별 manual_vals)
        actuals = []; plans = []
        for idx, m in enumerate(range(1, 13)):
            ma = manual_vals.get((r.id, m, "actual"))
            mp = manual_vals.get((r.id, m, "plan"))
            if ma is not None:
                actuals.append(ma)
            elif r.is_computed and r.formula_code in ("revenue", "advertising", "labor", "overhead",
                                                       "commission_all", "shipping", "packaging", "logistics",
                                                       "cogs_material"):
                actuals.append(actual_calc.get((r.formula_code, m), 0.0))
            elif r.is_computed and r.formula_code in ("cogs_var_subtotal", "sga_var_subtotal"):
                actuals.append(subtotal_value(r.id, "actual", idx))
            else:
                actuals.append(0.0)

            if mp is not None:
                plans.append(mp)
            elif r.is_computed and r.formula_code in ("revenue", "advertising", "labor", "overhead",
                                                       "commission_all", "shipping", "packaging", "logistics",
                                                       "cogs_material"):
                plans.append(plan_calc.get((r.formula_code, m), 0.0))
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
        formula_actuals = [formula_row(r.formula_code, "actual", i) for i in range(12)]
        formula_plans = [formula_row(r.formula_code, "plan", i) for i in range(12)]
        # plan override: 사업계획 엑셀에 직접 들어온 공헌이익(contribution_margin) 우선
        for i, m in enumerate(range(1, 13)):
            pc = plan_calc.get((r.formula_code, m))
            if pc:
                formula_plans[i] = pc
        # manual override 적용 (최우선)
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
    return {"year": year, "rows": out_rows, "filtered": channel_ids is not None}


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
    # 자식 행이 있으면 삭제 금지 (FK 위반 방지)
    if db.query(CsaPnlRow).filter(CsaPnlRow.parent_id == row_id).count() > 0:
        raise ValueError("자식 행이 있어 삭제할 수 없습니다. 자식 행을 먼저 삭제하세요")
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
