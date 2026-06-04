"""농협몰 파서. 결제금액이 없는 주문 리스트일 수 있어 수량만 신뢰."""
from __future__ import annotations
from typing import Iterable

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import read_excel_safe, to_date, to_float, to_str


@register("농협몰")
@register("농협")
def parse(path: str) -> Iterable[ParsedLine]:
    df = read_excel_safe(path, header=0)
    for _, row in df.iterrows():
        sale_d = to_date(row.get("주문일자") or row.get("결제완료일시"))
        if not sale_d:
            continue
        prod = to_str(row.get("상품명"))
        if not prod:
            continue
        qty = to_float(row.get("수량") or row.get("주문수량") or 1) - to_float(row.get("취소수량") or 0)
        if qty == 0:
            continue

        status = to_str(row.get("정산상태") or row.get("주문상태") or "") or ""
        is_cancel = ("취소" in status) or ("반품" in status)

        # 매출 = 주문금액(합계) (N열). 정산/결제 컬럼이 없는 양식이라 주문금액 기준.
        amt = to_float(
            row.get("주문금액합계") or row.get("주문금액")
            or row.get("정산대상금액") or row.get("결제금액") or row.get("판매가")
        )
        yield ParsedLine(
            sale_date=sale_d,
            order_no=to_str(row.get("주문번호")),
            line_no=to_str(row.get("주문순번") or row.get("상품코드")),
            raw_product_name=prod,
            raw_option_name=to_str(row.get("단품명") or row.get("규격") or row.get("옵션명")),
            raw_qty=qty,
            gross_amount=0 if is_cancel else amt,
            net_amount=0 if is_cancel else amt,
            refund_amount=amt if is_cancel else 0,
            is_cancelled=is_cancel,
        )
