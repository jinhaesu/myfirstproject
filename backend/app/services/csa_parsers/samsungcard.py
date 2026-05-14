"""삼성카드쇼핑 파서."""
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
        yield ParsedLine(
            sale_date=sale_d,
            order_no=to_str(row.get("주문번호")),
            line_no=to_str(row.get("상품코드")),
            raw_product_name=prod,
            raw_option_name=to_str(row.get("단품명")),
            raw_qty=to_float(row.get("주문수량") or row.get("수량") or 1),
            gross_amount=to_float(row.get("판매가") or row.get("결제금액")),
            net_amount=to_float(row.get("정산예정금액") or row.get("판매가")),
        )
