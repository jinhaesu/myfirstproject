"""올웨이즈 파서."""
from __future__ import annotations
from typing import Iterable

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import read_excel_safe, to_datetime, to_date, to_float, to_str


@register("올웨이즈")
def parse(path: str) -> Iterable[ParsedLine]:
    df = read_excel_safe(path, header=0)
    for _, row in df.iterrows():
        sale_dt = (
            to_datetime(row.get("주문 성사 시점"))
            or to_datetime(row.get("배송 완료 시점"))
            or to_datetime(row.get("구매(취소) 확정 시점"))
        )
        if not sale_dt:
            continue
        prod = to_str(row.get("상품명"))
        if not prod:
            continue
        yield ParsedLine(
            sale_date=sale_dt.date(),
            sale_datetime=sale_dt,
            order_no=to_str(row.get("주문아이디") or row.get("합배송 아이디")),
            raw_product_name=prod,
            raw_option_name=to_str(row.get("옵션")),
            raw_qty=to_float(row.get("수량") or 1),
            gross_amount=to_float(row.get("상품 구매금액")),
            net_amount=to_float(row.get("정산 대상 금액(수수료 제)") or row.get("상품 구매금액")),
            commission=to_float(row.get("수수료") or row.get("특별 수수료(기타 매출)")),
        )
