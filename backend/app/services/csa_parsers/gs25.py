"""GS25 편의점 파서. 헤더가 row=5."""
from __future__ import annotations
from typing import Iterable

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import read_excel_safe, to_date, to_float, to_str


@register("GS25")
def parse(path: str) -> Iterable[ParsedLine]:
    df = read_excel_safe(path, header=5)
    for _, row in df.iterrows():
        sale_d = to_date(row.get("납품일자"))
        if not sale_d:
            continue
        prod = to_str(row.get("상품명"))
        if not prod:
            continue
        qty = to_float(row.get("납품수량") or 1)
        yield ParsedLine(
            sale_date=sale_d,
            line_no=to_str(row.get("상품코드")),
            raw_product_name=prod,
            raw_option_name=to_str(row.get("사이즈") or row.get("색상")),
            raw_qty=qty,
            gross_amount=to_float(row.get("납품금액")),
            net_amount=to_float(row.get("납품금액")),
        )
