"""올리브영 파서."""
from __future__ import annotations

from typing import Iterable

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import (
    read_excel_safe, to_date, to_float, to_str,
)


@register("올리브영")
def parse(path: str) -> Iterable[ParsedLine]:
    df = read_excel_safe(path, header=0)
    for _, row in df.iterrows():
        sale_d = to_date(row.get("매출일자"))
        if not sale_d:
            continue
        prod = to_str(row.get("상품명"))
        if not prod:
            continue
        yield ParsedLine(
            sale_date=sale_d,
            order_no=to_str(row.get("주문번호")),
            line_no=to_str(row.get("온라인상품코드")),
            raw_product_name=prod,
            raw_option_name=to_str(row.get("단품명")),
            raw_qty=to_float(row.get("수량") or 1),
            gross_amount=to_float(row.get("원판매금액") or row.get("단가")),
            net_amount=to_float(row.get("원판매금액(VAT제외)") or row.get("원판매금액")),
        )
