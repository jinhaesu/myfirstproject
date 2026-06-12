"""롯데온 파서."""
from __future__ import annotations
from typing import Iterable

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import read_excel_safe, to_datetime, to_float, to_str


@register("롯데온")
def parse(path: str) -> Iterable[ParsedLine]:
    df = read_excel_safe(path, header=0)
    for _, row in df.iterrows():
        sale_dt = to_datetime(row.get("주문접수일시") or row.get("결제일시") or row.get("주문완료일시"))
        if not sale_dt:
            continue
        prod = to_str(row.get("전시상품명") or row.get("판매자상품명") or row.get("상품명"))
        if not prod:
            continue
        qty = to_float(row.get("수량") or 1)

        # 취소 판별: U열 [진행단계]가 '취소'면 취소건 (검수 반영 2026-06-12)
        stage = to_str(row.get("진행단계") or row.get("진행상태 (약식)") or "") or ""
        is_cancel = "취소" in stage

        # 매출 = 행별 [AV 결제금액] × [AX 수량]  ← 검수 반영(2026-06-12)
        unit_pay = to_float(row.get("결제금액"))
        if unit_pay:
            gross = unit_pay * qty
        else:
            # 구양식 fallback: 정산금액(총액) 등
            gross = to_float(
                row.get("판매자정산금액") or row.get("정산금액") or row.get("공급금액")
                or row.get("판매가")
            )
        yield ParsedLine(
            sale_date=sale_dt.date(),
            sale_datetime=sale_dt,
            order_no=to_str(row.get("주문번호")),
            line_no=to_str(row.get("상품주문번호") or row.get("판매자상품번호")),
            raw_product_name=prod,
            raw_option_name=to_str(row.get("전시단품명") or row.get("판매자단품명") or row.get("추가옵션")),
            raw_qty=qty,
            gross_amount=0 if is_cancel else gross,
            net_amount=0 if is_cancel else gross,
            refund_amount=gross if is_cancel else 0,
            shipping_fee=to_float(row.get("배송비")),
            is_cancelled=is_cancel,
        )
