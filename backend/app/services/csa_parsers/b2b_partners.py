"""널담 B2B파트너스(파트너스몰) CSV 파서.

컬럼:
  쇼핑몰, 쇼핑몰번호, 주문번호, 품목별 주문번호, 배송메시지,
  총 주문금액, 총 결제금액, 상품번호, 주문상품명, 주문상품명(옵션포함),
  수량, 판매가, 수령인, 수령인 휴대전화, 수령인 우편번호,
  수령인 주소, 수령인 상세 주소, 결제구분, 결제수단, 발주일, 배송국가

매출 계산:
  - 라인별 매출 = 수량 × 판매가 (라인별 단가가 있는 경우)
  - 판매가 0인 라인(샘플/증정)도 적재 (매핑/수량 카운트에 의미가 있음)
"""
from __future__ import annotations

from typing import Iterable

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import (
    read_excel_safe, to_date, to_datetime, to_float, to_str,
)


@register("B2B파트너스")
@register("파트너스몰")
@register("널담파트너스몰")
def parse(path: str) -> Iterable[ParsedLine]:
    df = read_excel_safe(path, header=0)
    for idx, (_, row) in enumerate(df.iterrows()):
        sale_dt = to_datetime(row.get("발주일"))
        if not sale_dt:
            continue
        prod = to_str(row.get("주문상품명")) or to_str(row.get("주문상품명(옵션포함)"))
        if not prod:
            continue
        qty = to_float(row.get("수량"))
        unit_price = to_float(row.get("판매가"))
        gross = qty * unit_price
        if qty == 0 and gross == 0:
            continue

        order_no = to_str(row.get("주문번호"))
        line_no = to_str(row.get("품목별 주문번호")) or f"#L{idx}"
        sku = to_str(row.get("상품번호"))

        yield ParsedLine(
            sale_date=sale_dt.date(),
            sale_datetime=sale_dt,
            order_no=order_no,
            line_no=line_no,
            raw_product_name=prod,
            raw_option_name=to_str(row.get("주문상품명(옵션포함)")) if prod != to_str(row.get("주문상품명(옵션포함)")) else None,
            raw_qty=qty,
            gross_amount=gross,
            net_amount=gross,
        )
