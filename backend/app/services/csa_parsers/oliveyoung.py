"""올리브영 파서.

집계 기준: 원판매금액 (VAT 포함, 수량 반영 총액 = 단가 × 수량).
한국 표준: 매출 = 공급가 + 부가세 = 원판매금액.
원판매금액(VAT제외) 컬럼은 net_amount에 사용.
"""
from __future__ import annotations

from typing import Iterable

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import (
    read_excel_safe, to_date, to_float, to_str,
)


@register("올리브영")
def parse(path: str) -> Iterable[ParsedLine]:
    df = read_excel_safe(path, header=0)
    for _, row in df.iterrows():
        sale_d = to_date(row.get("매출일자"))
        if not sale_d:
            continue
        prod = to_str(row.get("상품명"))
        if not prod:
            continue
        qty = to_float(row.get("수량") or 1)

        # 원판매금액 = 단가 × 수량 (VAT 포함 총액) -> 집계 기준
        gross = to_float(row.get("원판매금액"))
        if not gross:
            # fallback: 단가 × 수량
            gross = to_float(row.get("단가")) * qty

        # net = VAT 제외 금액 (공급가 기준)
        net = to_float(row.get("원판매금액(VAT제외)")) or gross

        yield ParsedLine(
            sale_date=sale_d,
            order_no=to_str(row.get("주문번호")),
            line_no=to_str(row.get("온라인상품코드")),
            raw_product_name=prod,
            raw_option_name=to_str(row.get("단품명")),
            raw_qty=qty,
            gross_amount=gross,
            net_amount=net,
        )
