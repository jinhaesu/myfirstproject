"""쿠팡 로켓프레시 (입고데이터) 파서."""
from __future__ import annotations
from typing import Iterable

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import read_excel_safe, to_datetime, to_float, to_str


@register("쿠팡 로켓")
@register("쿠팡 로켓프레시")
@register("쿠팡 (로켓프레시)")
def parse(path: str) -> Iterable[ParsedLine]:
    df = read_excel_safe(path, header=0)
    for _, row in df.iterrows():
        sale_dt = to_datetime(row.get("입고/반출시각"))
        if not sale_dt:
            continue
        prod = to_str(row.get("SKU명"))
        if not prod:
            continue
        # 구분이 '반출'이면 음수
        sign = -1 if str(row.get("구분") or "").strip() == "반출" else 1
        qty = to_float(row.get("수량") or 0) * sign
        gross = to_float(row.get("공급가액") or 0) * sign
        yield ParsedLine(
            sale_date=sale_dt.date(),
            sale_datetime=sale_dt,
            order_no=to_str(row.get("번호")),
            line_no=to_str(row.get("SKU번호")),
            raw_product_name=prod,
            raw_qty=qty,
            gross_amount=gross,
            net_amount=gross,
        )
