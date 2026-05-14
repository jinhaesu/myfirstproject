"""CU 편의점 파서.

납품금액 컬럼이 '총액(=단가×수량)' 기준이라고 가정.
이전에는 '단가'로 잘못 보고 ×수량을 한 번 더 곱해 매출이 수량배 부풀려졌음.
"""
from __future__ import annotations
from typing import Iterable

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import read_excel_safe, to_date, to_float, to_str


@register("CU")
def parse(path: str) -> Iterable[ParsedLine]:
    df = read_excel_safe(path, header=0)
    for _, row in df.iterrows():
        sale_d = to_date(row.get("입고일자") or row.get("납품예정일자"))
        if not sale_d:
            continue
        prod = to_str(row.get("상품명"))
        if not prod:
            continue
        qty = to_float(row.get("납품수량") or 1)
        # 납품금액 = 총액 (단가가 아님). 결측 시에만 단가(원가)×수량으로 fallback
        amount = to_float(row.get("납품금액"))
        if amount == 0:
            unit_price = to_float(row.get("원가"))
            amount = unit_price * qty
        yield ParsedLine(
            sale_date=sale_d,
            order_no=to_str(row.get("전표번호")),
            line_no=to_str(row.get("상품코드")),
            raw_product_name=prod,
            raw_option_name=to_str(row.get("규격")),
            raw_qty=qty,
            gross_amount=amount,
            net_amount=amount,
        )
