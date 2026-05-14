"""B마트 (배민 비마트) 정산 상세 파서."""
from __future__ import annotations
from typing import Iterable

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import read_excel_safe, to_datetime, to_float, to_str


@register("B마트")
@register("비마트")
def parse(path: str) -> Iterable[ParsedLine]:
    df = read_excel_safe(path, header=0)
    for _, row in df.iterrows():
        sale_dt = (
            to_datetime(row.get("입/출고 완료일시"))
            or to_datetime(row.get("발주/반품 마감일시"))
        )
        if not sale_dt:
            continue
        prod = to_str(row.get("관리용 SKU명") or row.get("상품명"))
        if not prod:
            continue
        qty_sign = 1
        if str(row.get("발주유형") or "").strip() in ("반품", "출고"):
            qty_sign = -1
        qty = to_float(row.get("수량") or 1) * qty_sign
        yield ParsedLine(
            sale_date=sale_dt.date(),
            sale_datetime=sale_dt,
            order_no=to_str(row.get("발주번호/반품번호") or row.get("주문번호")),
            line_no=to_str(row.get("SKU코드")),
            raw_product_name=prod,
            raw_qty=qty,
            gross_amount=to_float(row.get("공급가액") or row.get("판매가")) * qty_sign,
            net_amount=to_float(row.get("정산금액") or row.get("공급가액")) * qty_sign,
        )
