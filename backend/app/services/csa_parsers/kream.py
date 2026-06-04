"""크림(KREAM) 파서."""
from __future__ import annotations
from typing import Iterable

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import read_excel_safe, to_datetime, to_float, to_str


@register("크림")
@register("KREAM")
def parse(path: str) -> Iterable[ParsedLine]:
    df = read_excel_safe(path, header=0)
    for _, row in df.iterrows():
        sale_dt = (
            to_datetime(row.get("결제 일시"))
            or to_datetime(row.get("결제일시"))
            or to_datetime(row.get("주문 일시"))
        )
        if not sale_dt:
            continue
        prod = to_str(row.get("한글 상품명") or row.get("영문 상품명"))
        if not prod:
            continue

        # 주문 상태 '취소' — is_cancelled로 표시
        status = to_str(row.get("주문 상태") or "") or ""
        is_cancel = "취소" in status

        # 매출 = 상품 주문 금액(K) − 할인쿠폰 사용(L)
        order_amt = to_float(row.get("상품 주문 금액") or row.get("결제 금액"))
        coupon = to_float(row.get("할인쿠폰 사용") or row.get("할인 쿠폰 사용") or 0)
        net = order_amt - coupon
        yield ParsedLine(
            sale_date=sale_dt.date(),
            sale_datetime=sale_dt,
            order_no=to_str(row.get("주문 번호")),
            line_no=to_str(row.get("상품 번호")),
            raw_product_name=prod,
            raw_option_name=to_str(row.get("주문 옵션")),
            raw_qty=to_float(row.get("주문 수량") or 1),
            gross_amount=0 if is_cancel else order_amt,
            net_amount=0 if is_cancel else net,
            refund_amount=net if is_cancel else 0,
            is_cancelled=is_cancel,
        )
