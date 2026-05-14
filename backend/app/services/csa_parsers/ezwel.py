"""이지웰 파서."""
from __future__ import annotations
from typing import Iterable

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import read_excel_safe, to_date, to_datetime, to_float, to_str


@register("이지웰")
def parse(path: str) -> Iterable[ParsedLine]:
    df = read_excel_safe(path, header=0)
    for _, row in df.iterrows():
        sale_dt = to_datetime(row.get("주문일자") or row.get("주문일시"))
        if not sale_dt:
            continue
        prod = to_str(row.get("상품명"))
        if not prod:
            continue
        qty = to_float(row.get("주문수량") or row.get("배송(발송)수량") or 1) - to_float(row.get("취소수량") or 0)
        yield ParsedLine(
            sale_date=sale_dt.date(),
            sale_datetime=sale_dt,
            order_no=to_str(row.get("주문번호")),
            line_no=to_str(row.get("상품코드")),
            raw_product_name=prod,
            raw_option_name=to_str(row.get("옵션")),
            raw_qty=qty,
            gross_amount=to_float(row.get("매입가") or row.get("결제금액") or row.get("판매가")),
            net_amount=to_float(row.get("정산금액") or row.get("매입가")),
        )
