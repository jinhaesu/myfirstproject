"""카페24 (자사몰) 파서."""
from __future__ import annotations

from typing import Iterable

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import (
    read_excel_safe, to_date, to_datetime, to_float, to_str,
)


@register("자사몰")
@register("카페24")
def parse(path: str) -> Iterable[ParsedLine]:
    df = read_excel_safe(path, header=0)
    for _, row in df.iterrows():
        sale_dt = to_datetime(row.get("결제일시(입금확인일)") or row.get("주문일시"))
        if not sale_dt:
            continue
        qty = to_float(row.get("수량") or 1)
        prod_name = to_str(row.get("상품명(한국어 쇼핑몰)") or row.get("상품명"))
        opt = to_str(row.get("상품옵션"))
        if not prod_name:
            continue
        yield ParsedLine(
            sale_date=sale_dt.date(),
            sale_datetime=sale_dt,
            order_no=to_str(row.get("주문번호")),
            line_no=to_str(row.get("상품번호")) or to_str(row.get("상품코드")),
            raw_product_name=prod_name,
            raw_option_name=opt,
            raw_qty=qty,
            gross_amount=to_float(row.get("상품구매금액(KRW)") or row.get("판매가")),
            net_amount=to_float(row.get("품목별 결제금액") or row.get("상품구매금액(KRW)")),
        )
