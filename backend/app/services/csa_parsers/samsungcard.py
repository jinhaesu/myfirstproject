"""삼성카드쇼핑 파서.

집계 기준: 수량 × 공급가 (세전 공급가 합계).
공급가는 개당 단가 컬럼이며, 수량과 곱해 총 공급가를 산출.
"""
from __future__ import annotations
from typing import Iterable

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import read_excel_safe, to_date, to_float, to_str


@register("삼성카드쇼핑")
@register("삼성카드")
def parse(path: str) -> Iterable[ParsedLine]:
    df = read_excel_safe(path, header=0)
    for _, row in df.iterrows():
        sale_d = to_date(row.get("주문일자"))
        if not sale_d:
            continue
        prod = to_str(row.get("상품명"))
        if not prod:
            continue
        qty = to_float(row.get("수량") or row.get("주문수량") or 1)

        # 집계 기준: 수량 × 공급가
        supply_price = to_float(row.get("공급가"))
        gross = qty * supply_price if supply_price else to_float(row.get("판매가") or row.get("결제금액"))

        yield ParsedLine(
            sale_date=sale_d,
            order_no=to_str(row.get("주문번호")),
            line_no=to_str(row.get("상품코드")),
            raw_product_name=prod,
            raw_option_name=to_str(row.get("단품명")),
            raw_qty=qty,
            gross_amount=gross,
            net_amount=gross,
        )
