"""11번가 파서. 배송전체내역 기준 (헤더 row=5).

컬럼 구조:
  번호 / 주문일시[1] / 결제일시[2] / 배송번호[6] / 주문번호[7]
  상품명[8] / 옵션[9] / 수량[12]
  판매단가[32] / 주문금액[34] / 정산예정금액[36]
  주문상세번호[38] / 서비스이용료(상품)[44]

gross_amount = 주문금액 (소비자 결제 기준 총액, 수량 포함)
net_amount   = 정산예정금액

주의: 판매단가는 1개 단가이므로 gross_amount 대신 사용 금지(수량 곱셈 2배 위험).
"""
from __future__ import annotations
from typing import Iterable

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import read_excel_safe, to_datetime, to_float, to_str


@register("11번가")
def parse(path: str) -> Iterable[ParsedLine]:
    df = read_excel_safe(path, header=5)
    if df.empty:
        return

    for _, row in df.iterrows():
        # 주문일시 우선, 없으면 결제일시
        sale_dt = to_datetime(row.get("주문일시") or row.get("결제일시"))
        if not sale_dt:
            continue

        prod = to_str(row.get("상품명"))
        if not prod:
            continue

        qty = to_float(row.get("수량") or 1)

        # gross: 주문금액(수량 포함 총액) 우선
        # 판매단가는 단가이므로 총액 컬럼이 없을 때만 qty 곱하여 fallback
        gross = to_float(row.get("주문금액"))
        if gross == 0:
            unit_price = to_float(row.get("판매단가") or 0)
            gross = unit_price * qty

        net = to_float(row.get("정산예정금액") or gross)

        yield ParsedLine(
            sale_date=sale_dt.date(),
            sale_datetime=sale_dt,
            order_no=to_str(row.get("주문번호")),
            line_no=to_str(
                row.get("주문상세번호")
                or row.get("배송번호")
                or row.get("상품번호")
            ),
            raw_product_name=prod,
            raw_option_name=to_str(row.get("옵션")),
            raw_qty=qty,
            gross_amount=gross,
            net_amount=net,
            commission=to_float(row.get("서비스이용료(상품)")),
        )
