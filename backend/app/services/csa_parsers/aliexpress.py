"""알리익스프레스 파서."""
from __future__ import annotations
from typing import Iterable

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import read_excel_safe, to_datetime, to_float, to_str


@register("알리익스프레스")
@register("AliExpress")
def parse(path: str) -> Iterable[ParsedLine]:
    df = read_excel_safe(path, header=0)
    for _, row in df.iterrows():
        sale_dt = (
            to_datetime(row.get("결제 시간"))
            or to_datetime(row.get("주문시간"))
        )
        if not sale_dt:
            continue
        prod = to_str(row.get("제품 정보") or row.get("제품 이름") or row.get("상품명"))
        if not prod:
            continue
        yield ParsedLine(
            sale_date=sale_dt.date(),
            sale_datetime=sale_dt,
            order_no=to_str(row.get("주문 ID")),
            line_no=to_str(row.get("상품 ID") or row.get("제품 코드") or row.get("EAN코드")),
            raw_product_name=prod,
            raw_option_name=to_str(row.get("선택 사항") or row.get("옵션")),
            raw_qty=to_float(row.get("수량") or 1),
            gross_amount=to_float(row.get("총 금액") or row.get("주문 금액") or row.get("공급 가격")),
            net_amount=to_float(row.get("주문 금액") or row.get("총 금액")),
            shipping_fee=to_float(row.get("배송비")),
        )
