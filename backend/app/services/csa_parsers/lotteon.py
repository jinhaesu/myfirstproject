"""롯데온 파서."""
from __future__ import annotations
from typing import Iterable

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import read_excel_safe, to_datetime, to_float, to_str


@register("롯데온")
def parse(path: str) -> Iterable[ParsedLine]:
    df = read_excel_safe(path, header=0)
    for _, row in df.iterrows():
        sale_dt = to_datetime(row.get("주문접수일시") or row.get("결제일시") or row.get("주문완료일시"))
        if not sale_dt:
            continue
        prod = to_str(row.get("전시상품명") or row.get("판매자상품명") or row.get("상품명"))
        if not prod:
            continue
        yield ParsedLine(
            sale_date=sale_dt.date(),
            sale_datetime=sale_dt,
            order_no=to_str(row.get("주문번호")),
            line_no=to_str(row.get("상품주문번호") or row.get("판매자상품번호")),
            raw_product_name=prod,
            raw_option_name=to_str(row.get("전시단품명") or row.get("판매자단품명") or row.get("추가옵션")),
            raw_qty=to_float(row.get("수량") or 1),
            gross_amount=to_float(row.get("결제금액") or row.get("판매가")),
            net_amount=to_float(row.get("결제금액") or row.get("판매가")),
            shipping_fee=to_float(row.get("배송비")),
        )
