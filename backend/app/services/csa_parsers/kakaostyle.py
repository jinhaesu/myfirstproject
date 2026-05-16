"""카카오스타일 (지그재그) 파서.

집계 기준: 상품주문액 (쿠폰·마일리지 할인 후 실제 결제금액).
취소완료(클레임상태=취소완료) 행은 매출에서 제외.
"""
from __future__ import annotations
from typing import Iterable

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import read_excel_safe, to_datetime, to_float, to_str


@register("카카오스타일")
def parse(path: str) -> Iterable[ParsedLine]:
    df = read_excel_safe(path, header=0)
    for _, row in df.iterrows():
        # 취소완료 행 제외
        claim = to_str(row.get("클레임상태") or "")
        if claim and "취소" in claim:
            continue

        sale_dt = to_datetime(row.get("주문일시"))
        if not sale_dt:
            continue
        prod = to_str(row.get("상품명"))
        if not prod:
            continue
        qty = to_float(row.get("수량") or 1)

        # 집계 기준: 상품주문액 (할인 반영 실결제액)
        order_amt = to_float(row.get("상품주문액 (원)") or row.get("상품가격 (원)") or row.get("판매가 (원)"))
        yield ParsedLine(
            sale_date=sale_dt.date(),
            sale_datetime=sale_dt,
            order_no=to_str(row.get("주문번호")),
            line_no=to_str(row.get("상품주문번호")),
            raw_product_name=prod,
            raw_option_name=to_str(row.get("옵션정보")),
            raw_qty=qty,
            gross_amount=order_amt,
            net_amount=order_amt,
        )
