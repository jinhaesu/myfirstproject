"""이지웰 파서.

집계 기준: 매입가 (공급가, 수량이 이미 반영된 총액).
매입가가 없을 경우에만 판매가 fallback 사용.
"""
from __future__ import annotations
from typing import Iterable

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import read_excel_safe, to_date, to_datetime, to_float, to_str


@register("이지웰")
def parse(path: str) -> Iterable[ParsedLine]:
    df = read_excel_safe(path, header=0)
    for _, row in df.iterrows():
        sale_dt = to_datetime(row.get("주문일자") or row.get("주문일시"))
        if not sale_dt:
            continue
        prod = to_str(row.get("상품명"))
        if not prod:
            continue
        qty = to_float(row.get("주문수량") or row.get("배송(발송)수량") or 1) - to_float(row.get("취소수량") or 0)

        # 집계 기준: 매입가 (이미 수량 반영 총액). fallback: 판매가
        buy_price = to_float(row.get("매입가"))
        gross = buy_price if buy_price else to_float(row.get("판매가"))

        yield ParsedLine(
            sale_date=sale_dt.date(),
            sale_datetime=sale_dt,
            order_no=to_str(row.get("주문번호")),
            line_no=to_str(row.get("상품코드")),
            raw_product_name=prod,
            raw_option_name=to_str(row.get("옵션")),
            raw_qty=qty,
            gross_amount=gross,
            net_amount=gross,
        )
