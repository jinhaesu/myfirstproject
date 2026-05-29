"""쿠팡 (WING) 파서."""
from __future__ import annotations

from typing import Iterable

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import (
    read_excel_safe, to_date, to_datetime, to_float, to_int, to_str,
)


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
        )
