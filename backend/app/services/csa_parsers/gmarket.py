"""G마켓 파서."""
from __future__ import annotations

from typing import Iterable

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import (
    read_excel_safe, to_datetime, to_date, to_float, to_str,
)


@register("지마켓")
@register("G마켓")
def parse(path: str) -> Iterable[ParsedLine]:
    df = read_excel_safe(path, header=0)
    for _, row in df.iterrows():
        sale_d = to_date(row.get("구매결정일")) or to_date(row.get("체결일"))
        if not sale_d:
            continue
        prod = to_str(row.get("상품명"))
        if not prod:
            continue
        yield ParsedLine(
            sale_date=sale_d,
            sale_datetime=to_datetime(row.get("체결일")),
            order_no=to_str(row.get("주문번호")),
            line_no=to_str(row.get("상품번호")),
            raw_product_name=prod,
            raw_qty=to_float(row.get("수량") or 1),
            gross_amount=to_float(row.get("판매가") or row.get("결제금액")),
            net_amount=to_float(row.get("정산예정금액") or row.get("판매가")),
            commission=to_float(row.get("판매수수료")),
        )
