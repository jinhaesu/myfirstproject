"""쿠팡 (WING) 파서.

낱개수량(2026-07 기준변경요청서, 장현진):
  낱개 = 등록옵션명[L]의 개수 × 구매수(수량)[W].
  · 등록옵션명에서 무게(g)·용량(ml) 제거 후 첫 개수 토큰(140g 8개 → 8).
  · 박스/세트형은 박스·세트당 8구 고정(400g 2박스 → 16).
  · 옵션명에 개수 없으면 노출상품명(옵션명)[M]의 마지막 개수(맛별 2개씩 6개 → 6).
  6월 샘플 검증: 낱개 합 35,185 = 담당자 정답 35,185 (정확 일치).
"""
from __future__ import annotations

import re
from typing import Iterable

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import (
    read_excel_safe, to_date, to_datetime, to_float, to_int, to_str,
)

_WEIGHT = re.compile(r"\d+(?:\.\d+)?\s*(?:kg|g|ml|l|cm|mm)(?![a-zA-Z가-힣0-9])", re.I)
_CNT = re.compile(r"(\d+)\s*(?:개입|구|개|봉|병|입|매|장|팩|캔|포|알|스틱)")
_SET = re.compile(r"(\d+)\s*(?:세트|셋트|박스|box|set)", re.I)


def _ups(opt: str | None, m_name: str | None) -> float:
    t = _WEIGHT.sub(" ", opt or "")
    if t.strip():
        cm = _CNT.search(t)
        if cm and 1 <= int(cm.group(1)) <= 200:
            return float(cm.group(1))
        sm = _SET.search(t)
        if sm and 1 <= int(sm.group(1)) <= 20:
            # 박스/세트당 8구 (마카롱·휘낭시에 기준, 담당자 지정)
            return float(8 * int(sm.group(1)))
    tm = _WEIGHT.sub(" ", m_name or "")
    if tm.strip():
        cnts = [int(c) for c in _CNT.findall(tm) if 1 <= int(c) <= 200]
        if cnts:
            return float(cnts[-1])
    return 1.0


@register("쿠팡 WING")
def parse(path: str) -> Iterable[ParsedLine]:
    df = read_excel_safe(path, header=0)
    # 등록상품명/등록옵션명/주문일/구매수(수량)/결제액/주문번호/번호
    for _, row in df.iterrows():
        sale_dt = to_datetime(row.get("주문일") or row.get("출고일(발송일)"))
        if not sale_dt:
            continue
        qty = to_float(row.get("구매수(수량)") or row.get("수량"))
        gross = to_float(row.get("결제액") or row.get("옵션판매가(판매단가)"))
        prod_name = to_str(row.get("등록상품명") or row.get("노출상품명(옵션명)"))
        opt = to_str(row.get("등록옵션명"))
        if not prod_name and not opt:
            continue
        yield ParsedLine(
            sale_date=sale_dt.date(),
            sale_datetime=sale_dt,
            order_no=to_str(row.get("주문번호")),
            line_no=to_str(row.get("번호")),
            raw_product_name=prod_name,
            raw_option_name=opt,
            raw_qty=qty,
            gross_amount=gross,
            net_amount=gross,
            shipping_fee=to_float(row.get("배송비")),
            unit_per_set=_ups(opt, to_str(row.get("노출상품명(옵션명)"))),
        )
