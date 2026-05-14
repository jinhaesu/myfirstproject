"""스마트스토어 파서. 원본 파일은 비밀번호 보호이므로 사전에 해제된 파일 전제.

업로드 시점에 비밀번호(기본 0000)를 받아서 미리 풀어주는 처리는 라우터에서.
"""
from __future__ import annotations

from typing import Iterable

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import (
    read_excel_safe, to_datetime, to_float, to_str,
)


@register("스마트스토어")
def parse(path: str) -> Iterable[ParsedLine]:
    df = read_excel_safe(path, header=0)
    for _, row in df.iterrows():
        sale_dt = (
            to_datetime(row.get("결제일시"))
            or to_datetime(row.get("주문일시"))
            or to_datetime(row.get("결제일"))
        )
        if not sale_dt:
            continue
        prod = to_str(row.get("상품명")) or to_str(row.get("상품 종류"))
        if not prod:
            continue
        yield ParsedLine(
            sale_date=sale_dt.date(),
            sale_datetime=sale_dt,
            order_no=to_str(row.get("주문번호")),
            line_no=to_str(row.get("상품주문번호")),
            raw_product_name=prod,
            raw_option_name=to_str(row.get("옵션정보") or row.get("옵션")),
            raw_qty=to_float(row.get("수량")),
            gross_amount=to_float(row.get("상품가격") or row.get("총 결제금액") or row.get("정산금액")),
            net_amount=to_float(row.get("정산금액") or row.get("상품가격")),
            commission=to_float(row.get("수수료") or row.get("네이버페이 결제수수료")),
        )
