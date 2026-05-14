"""마켓컬리 (정산상세) 파서. CSV."""
from __future__ import annotations

from typing import Iterable

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import (
    read_excel_safe, to_date, to_float, to_str,
)


@register("마켓컬리")
@register("컬리")
def parse(path: str) -> Iterable[ParsedLine]:
    df = read_excel_safe(path, header=0)
    for _, row in df.iterrows():
        # 입고가 음수=반품. 수불일=일자, 상품명, 수량, 공급단가, 공급가액
        sale_d = to_date(row.get("수불일"))
        if not sale_d:
            continue
        qty = to_float(row.get("수량"))
        if row.get("구분") == "반품":
            qty = -abs(qty)
        prod = to_str(row.get("상품명"))
        if not prod:
            continue
        unit_price = to_float(row.get("공급단가"))
        gross = to_float(row.get("공급가액"))
        yield ParsedLine(
            sale_date=sale_d,
            order_no=to_str(row.get("발주/반품 코드")),
            line_no=to_str(row.get("마스터코드")),
            raw_product_name=prod,
            raw_qty=qty,
            gross_amount=gross,
            net_amount=gross,
            settlement_amount=to_float(row.get("정산합계")),
        )
