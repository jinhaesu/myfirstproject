"""SSG 파서. HTML 위장 xls. 약 65컬럼이며 출고기준일·상품명·수량·결제금액 사용."""
from __future__ import annotations
from typing import Iterable

import pandas as pd

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import to_date, to_datetime, to_float, to_str


@register("SSG")
@register("SSG닷컴")
def parse(path: str) -> Iterable[ParsedLine]:
    tables = pd.read_html(path, encoding="utf-8", header=0)
    if not tables:
        return
    df = tables[0]
    for _, row in df.iterrows():
        sale_d = (
            to_date(row.get("출고기준일"))
            or to_date(row.get("출고예정일"))
            or to_date(row.get("주문일자"))
        )
        if not sale_d:
            continue
        prod = to_str(row.get("상품명"))
        if not prod:
            continue
        yield ParsedLine(
            sale_date=sale_d,
            order_no=to_str(row.get("주문번호")),
            line_no=to_str(row.get("상품번호") or row.get("배송번호")),
            raw_product_name=prod,
            raw_option_name=to_str(row.get("옵션")),
            raw_qty=to_float(row.get("수량") or row.get("주문수량") or 1),
            gross_amount=to_float(row.get("결제금액") or row.get("판매가") or row.get("상품금액")),
            net_amount=to_float(row.get("정산금액") or row.get("결제금액")),
        )
