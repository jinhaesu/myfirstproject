"""토스 쇼핑 파서. 헤더는 row 2, row 3은 가이드 안내(수정 불가)."""
from __future__ import annotations
from typing import Iterable

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import read_excel_safe, to_datetime, to_float, to_str


@register("토스")
def parse(path: str) -> Iterable[ParsedLine]:
    df = read_excel_safe(path, header=2)
    for _, row in df.iterrows():
        # 가이드 행 스킵
        if str(row.get("주문일시") or "").startswith("수정 "):
            continue
        sale_dt = to_datetime(row.get("주문일시") or row.get("발송처리일시"))
        if not sale_dt:
            continue
        prod = to_str(row.get("상품명"))
        if not prod:
            continue
        yield ParsedLine(
            sale_date=sale_dt.date(),
            sale_datetime=sale_dt,
            order_no=to_str(row.get("주문번호")),
            line_no=to_str(row.get("주문상품번호")),
            raw_product_name=prod,
            raw_option_name=to_str(row.get("옵션명")),
            raw_qty=to_float(row.get("주문건수") or row.get("수량") or 1),
            gross_amount=to_float(row.get("주문금액")),
            net_amount=to_float(row.get("주문금액")),
        )
