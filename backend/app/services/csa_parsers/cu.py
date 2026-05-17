"""CU 편의점 파서.

두 가지 컬럼 포맷을 모두 지원한다:
  - 한글 사방넷 raw: 입고일자/상품명/납품수량/납품금액
  - 영문 빅쿼리 raw: Date/ProductName/TotalQuantity/TotalSales

납품금액(=TotalSales)은 총액(단가×수량) 기준. 결측 시 단가×수량으로 fallback.
"""
from __future__ import annotations
from typing import Iterable

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import read_excel_safe, to_date, to_float, to_str


@register("CU")
def parse(path: str) -> Iterable[ParsedLine]:
    df = read_excel_safe(path, header=0)
    cols = set(str(c) for c in df.columns)
    # 한글 포맷 vs 영문 포맷 자동 감지
    is_eng = "TotalSales" in cols or "ProductName" in cols or "Date" in cols

    for _, row in df.iterrows():
        if is_eng:
            sale_d = to_date(row.get("Date"))
            prod = to_str(row.get("ProductName"))
            qty = to_float(row.get("TotalQuantity") or 1)
            amount = to_float(row.get("TotalSales"))
            if amount == 0:
                unit_price = to_float(row.get("supplyPrice") or row.get("SeperatePrice"))
                amount = unit_price * qty
            order_no = to_str(row.get("ProductCode"))
            line_no = to_str(row.get("ProductCode"))
            opt = to_str(row.get("weigt"))
        else:
            sale_d = to_date(row.get("입고일자") or row.get("납품예정일자"))
            prod = to_str(row.get("상품명"))
            qty = to_float(row.get("납품수량") or 1)
            amount = to_float(row.get("납품금액"))
            if amount == 0:
                unit_price = to_float(row.get("원가"))
                amount = unit_price * qty
            order_no = to_str(row.get("전표번호"))
            line_no = to_str(row.get("상품코드"))
            opt = to_str(row.get("규격"))

        if not sale_d or not prod:
            continue

        yield ParsedLine(
            sale_date=sale_d,
            order_no=order_no,
            line_no=line_no,
            raw_product_name=prod,
            raw_option_name=opt,
            raw_qty=qty,
            gross_amount=amount,
            net_amount=amount,
        )
