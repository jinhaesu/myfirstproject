"""세분화된 변동비 계산 서비스.

규칙 우선순위:
  channel_id + product_id 모두 일치 (specific)
  > channel_id 일치
  > product_id 일치
  > global (둘 다 NULL)

광고비/제조간접비/물류비는 채널 월별 입력값을 일별 매출 비례로 분배 (rebuild 시점에).
"""
from __future__ import annotations

import logging
from calendar import monthrange
from collections import defaultdict
from datetime import date
from typing import Optional

from sqlalchemy import and_, or_, func
from sqlalchemy.orm import Session

from app.db_models import (
    Channel,
    ProductMaster,
    CsaCostItem,
    CsaCostRule,
    CsaChannelMonthlyCost,
    ChannelSalesDailyProduct,
    ChannelSalesRawLine,
)

log = logging.getLogger(__name__)


# ──────────────────────────────────────────────────────────────
# 기본 변동비 항목 (8종)
# ──────────────────────────────────────────────────────────────

DEFAULT_COST_ITEMS = [
    {"code": "cogs",              "name": "원가",          "category": "cogs",              "basis": "product_pcs",         "sort_order": 1, "description": "낱개당 표준 원가"},
    {"code": "labor",             "name": "노무비",        "category": "labor",             "basis": "product_pcs",         "sort_order": 2, "description": "낱개당 노무비"},
    {"code": "overhead",          "name": "제조간접비",    "category": "overhead",          "basis": "channel_revenue_rate","sort_order": 3, "description": "채널 매출 정률 (제조간접 배부)"},
    {"code": "logistics_work",    "name": "물류작업비",    "category": "logistics_work",    "basis": "channel_revenue_rate","sort_order": 4, "description": "채널 매출 정률"},
    {"code": "logistics_oh",      "name": "물류간접비",    "category": "logistics_oh",      "basis": "channel_revenue_rate","sort_order": 5, "description": "채널 매출 정률"},
    {"code": "advertising",       "name": "광고비",        "category": "advertising",       "basis": "channel_monthly_fixed","sort_order": 6, "description": "월 채널 광고비 (일별 매출 비례 분배)"},
    {"code": "commission_rate",   "name": "판매수수료(정률)","category": "commission_rate", "basis": "channel_revenue_rate","sort_order": 7, "description": "채널 매출 × 수수료율"},
    {"code": "commission_fixed",  "name": "판매수수료(정액)","category": "commission_fixed","basis": "order_fixed",          "sort_order": 8, "description": "주문건당 정액 수수료"},
    {"code": "shipping",          "name": "운반비",        "category": "shipping",          "basis": "order_fixed",         "sort_order": 9, "description": "주문(박스) 당 정액 또는 매출 정률"},
    {"code": "packaging",         "name": "포장비",        "category": "packaging",         "basis": "order_fixed",         "sort_order": 10, "description": "주문당 포장 부자재 (아이스팩·박스 등)"},
]


def seed_cost_items(db: Session) -> int:
    created = 0
    for it in DEFAULT_COST_ITEMS:
        existing = db.query(CsaCostItem).filter(CsaCostItem.code == it["code"]).first()
        if existing:
            continue
        db.add(CsaCostItem(**it, is_active=True))
        created += 1
    db.commit()
    return created


# ──────────────────────────────────────────────────────────────
# 규칙 매칭
# ──────────────────────────────────────────────────────────────

def _best_rule(
    rules: list[CsaCostRule],
    channel_id: str,
    product_id: Optional[int],
    sale_date: Optional[date] = None,
) -> Optional[CsaCostRule]:
    """주어진 channel/product/date에 대해 가장 구체적인 규칙 선택.

    valid_from / valid_to가 설정된 규칙은 해당 기간 내일 때만 매칭.
    여러 시즌 규칙이 동시 매칭되면 더 좁은 기간을 우선.
    """
    candidates = []
    for r in rules:
        if not r.is_active:
            continue
        if r.channel_id and r.channel_id != channel_id:
            continue
        if r.product_id and r.product_id != product_id:
            continue
        # 유효 기간
        if sale_date is not None:
            if r.valid_from and sale_date < r.valid_from:
                continue
            if r.valid_to and sale_date > r.valid_to:
                continue
        # 우선순위 점수
        score = (4 if r.channel_id else 0) + (2 if r.product_id else 0)
        # 기간 한정 규칙이 더 구체적
        if r.valid_from or r.valid_to:
            score += 1
        candidates.append((score, r.id, r))
    if not candidates:
        return None
    candidates.sort(key=lambda x: (-x[0], -x[1]))
    return candidates[0][2]


def _rules_by_item(db: Session) -> dict[int, list[CsaCostRule]]:
    out: dict[int, list[CsaCostRule]] = defaultdict(list)
    for r in db.query(CsaCostRule).filter(CsaCostRule.is_active.is_(True)).all():
        out[r.cost_item_id].append(r)
    return out


# ──────────────────────────────────────────────────────────────
# 일별 집계 재계산 (세분 변동비 반영)
# ──────────────────────────────────────────────────────────────

def rebuild_daily_with_costs(
    db: Session,
    *,
    channel_id: Optional[str] = None,
    since: Optional[date] = None,
    until: Optional[date] = None,
) -> int:
    """raw_lines → daily_product 재계산. 세분화된 변동비 적용.

    공헌이익 = 순매출 - (원가 + 노무비 + 제조간접비 + 물류작업비 + 물류간접비
                       + 광고비 + 정률수수료 + 정액수수료 + 운반비 + 포장비)
    raw에서 채널이 직접 표기한 commission은 별도로 누적 보존 (사용자가 직접 입력한 수수료와 중복 방지를 위해 모델 분리).
    """
    # 1) raw_lines를 (date, channel, product) 단위로 집계
    rq = db.query(
        ChannelSalesRawLine.sale_date,
        ChannelSalesRawLine.channel_id,
        ChannelSalesRawLine.channel_name,
        ChannelSalesRawLine.product_id,
        func.sum(ChannelSalesRawLine.raw_qty).label("raw_qty"),
        func.sum(ChannelSalesRawLine.pcs_qty).label("pcs_qty"),
        func.sum(ChannelSalesRawLine.gross_amount).label("gross"),
        func.sum(ChannelSalesRawLine.net_amount).label("net"),
        func.sum(ChannelSalesRawLine.settlement_amount).label("settlement"),
        func.sum(ChannelSalesRawLine.commission).label("commission_raw"),
        func.sum(ChannelSalesRawLine.refund_amount).label("refund"),
        func.count(func.distinct(ChannelSalesRawLine.order_no)).label("order_count"),
    # NOTE: 과거에는 mapping_status == 'matched' 만 집계했으나, 그 결과
    # 미매핑 라인의 매출/수량이 대시보드 summary에서 통째로 빠지는 문제
    # (세븐일레븐 매출 0, 삼성웰스토리·CU 매출 -20% 등) 가 발생.
    # 이제는 unmatched(product_id NULL)도 함께 집계해 daily에 적재한다.
    # 변동비 규칙은 product_id별로 매칭되므로 미매핑 라인엔 자연스럽게 0이 적용.
    # 'excluded' 상태는 의도적으로 제외 유지.
    ).filter(ChannelSalesRawLine.mapping_status != "excluded")

    if channel_id:
        rq = rq.filter(ChannelSalesRawLine.channel_id == channel_id)
    if since:
        rq = rq.filter(ChannelSalesRawLine.sale_date >= since)
    if until:
        rq = rq.filter(ChannelSalesRawLine.sale_date <= until)

    rq = rq.group_by(
        ChannelSalesRawLine.sale_date,
        ChannelSalesRawLine.channel_id,
        ChannelSalesRawLine.channel_name,
        ChannelSalesRawLine.product_id,
    )
    rows = rq.all()

    # 2) 영향 받는 범위 삭제
    del_q = db.query(ChannelSalesDailyProduct)
    if channel_id:
        del_q = del_q.filter(ChannelSalesDailyProduct.channel_id == channel_id)
    if since:
        del_q = del_q.filter(ChannelSalesDailyProduct.sale_date >= since)
    if until:
        del_q = del_q.filter(ChannelSalesDailyProduct.sale_date <= until)
    del_q.delete(synchronize_session=False)

    # 3) 캐시
    rules_by_item = _rules_by_item(db)
    items = {it.code: it for it in db.query(CsaCostItem).filter(CsaCostItem.is_active.is_(True)).all()}
    ch_cat = {c.id: c.category for c in db.query(Channel).all()}
    prod_names = {p.id: p.name for p in db.query(ProductMaster).all()}

    # 4) 채널×월 매출 합산 (광고비 등 monthly_fixed 분배용)
    monthly_revenue: dict[tuple[str, int, int], float] = defaultdict(float)
    for r in rows:
        monthly_revenue[(r.channel_id, r.sale_date.year, r.sale_date.month)] += r.net or 0

    monthly_fixed: dict[tuple[str, int, int, int], float] = {}  # (channel_id, year, month, item_id) -> amount
    for m in db.query(CsaChannelMonthlyCost).all():
        monthly_fixed[(m.channel_id, m.year, m.month, m.cost_item_id)] = m.amount or 0

    def get_rule(code: str, ch_id: str, prod_id: Optional[int], sale_date: Optional[date] = None) -> Optional[CsaCostRule]:
        it = items.get(code)
        if not it:
            return None
        return _best_rule(rules_by_item.get(it.id, []), ch_id, prod_id, sale_date)

    # 5) 행별 분해 + 적재
    count = 0
    for r in rows:
        sd: date = r.sale_date
        ch = r.channel_id
        pid = r.product_id
        pcs = float(r.pcs_qty or 0)
        net = float(r.net or 0)
        orders = int(r.order_count or 0)

        def rule_pcs(code: str) -> float:
            rule = get_rule(code, ch, pid, sd)
            return (rule.amount_per_pcs or 0) if rule else 0

        def rule_rate(code: str) -> float:
            rule = get_rule(code, ch, pid, sd)
            return (rule.rate or 0) if rule else 0

        def rule_order(code: str) -> float:
            rule = get_rule(code, ch, pid, sd)
            return (rule.amount_per_order or 0) if rule else 0

        c_cogs = pcs * rule_pcs("cogs")
        c_labor = pcs * rule_pcs("labor")
        c_overhead = net * rule_rate("overhead")
        c_log_work = net * rule_rate("logistics_work")
        c_log_oh = net * rule_rate("logistics_oh")
        c_comm_rate = net * rule_rate("commission_rate")
        c_comm_fixed = orders * rule_order("commission_fixed")
        # 운반비: order_fixed 우선, 없으면 매출 정률(rate)
        shipping_rule = get_rule("shipping", ch, pid, sd)
        c_shipping = 0.0
        if shipping_rule:
            if shipping_rule.amount_per_order:
                c_shipping = orders * shipping_rule.amount_per_order
            elif shipping_rule.rate:
                c_shipping = net * shipping_rule.rate
        c_packaging = orders * rule_order("packaging")

        # 광고비: 그 채널의 (year, month) 월 광고비 × (행 매출 / 채널 월 매출)
        adv_item = items.get("advertising")
        c_adv = 0.0
        if adv_item:
            m_amount = monthly_fixed.get((ch, sd.year, sd.month, adv_item.id), 0)
            ch_month_rev = monthly_revenue.get((ch, sd.year, sd.month), 0)
            if m_amount and ch_month_rev:
                c_adv = m_amount * (net / ch_month_rev) if ch_month_rev else 0

        total_cost = (
            c_cogs + c_labor + c_overhead + c_log_work + c_log_oh
            + c_adv + c_comm_rate + c_comm_fixed + c_shipping + c_packaging
        )
        cm = net - total_cost

        db.add(ChannelSalesDailyProduct(
            sale_date=sd,
            year=sd.year, month=sd.month, quarter=(sd.month - 1) // 3 + 1,
            channel_id=ch, channel_name=r.channel_name,
            channel_category=ch_cat.get(ch),
            product_id=pid, product_name=prod_names.get(pid),
            raw_qty=r.raw_qty or 0,
            pcs_qty=pcs,
            gross_sales=r.gross or 0,
            net_sales=net,
            settlement_amount=r.settlement or 0,
            commission=r.commission_raw or 0,
            refund_amount=r.refund or 0,
            order_count=orders,
            variable_cost=total_cost,
            contribution_margin=cm,
            cost_cogs=c_cogs,
            cost_labor=c_labor,
            cost_overhead=c_overhead,
            cost_logistics_work=c_log_work,
            cost_logistics_oh=c_log_oh,
            cost_advertising=c_adv,
            cost_commission_rate=c_comm_rate,
            cost_commission_fixed=c_comm_fixed,
            cost_shipping=c_shipping,
            cost_packaging=c_packaging,
        ))
        count += 1
    db.commit()
    return count
