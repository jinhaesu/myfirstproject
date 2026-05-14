"""카카오스타일 (지그재그) 파서."""
from __future__ import annotations
from typing import Iterable

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import read_excel_safe, to_datetime, to_float, to_str


@register("카카오스타일")
def parse(path: str) -> Iterable[ParsedLine]:
    df = read_excel_safe(path, header=0)
    for _, row in df.iterrows():
        sale_dt = to_datetime(row.get("주문일시"))
        if not sale_dt:
            continue
        prod = to_str(row.get("상품명"))
        if not prod:
            continue
        qty = to_float(row.get("수량") or 1)
        yield ParsedLine(
            sale_date=sale_dt.date(),
            sale_datetime=sale_dt,
            order_no=to_str(row.get("주문번호")),
            line_no=to_str(row.get("상품주문번호")),
            raw_product_name=prod,
            raw_option_name=to_str(row.get("옵션정보")),
            raw_qty=qty,
            gross_amount=to_float(row.get("상품주문액 (원)") or row.get("상품가격 (원)") or row.get("판매가 (원)")),
            net_amount=to_float(row.get("스토어 부담 금액 (원)") or row.get("상품주문액 (원)") or row.get("상품가격 (원)")),
        )
