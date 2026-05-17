"""CJ프레시웨이 (납품예정) 파서.

샘플 헤더 (1행):
  No / 진행 상태 / 물류센터 / 납품예정번호 / 상품명 /
  상품 수량 / 납품예정 금액 / 배송유형 / 직송구분 / 발주유형 /
  발주일자 / 납품일자 / 납품예정일자 / 지급보류 대상 여부

매출 단위: 낱개(EA). 진행 상태 '취소'/'반품' 시 수량 음수.
"""
from __future__ import annotations

from typing import Iterable

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import (
    read_excel_safe, to_date, to_float, to_str,
)


@register("CJ프레시웨이")
def parse(path: str) -> Iterable[ParsedLine]:
    df = read_excel_safe(path, header=0)
    for _, row in df.iterrows():
        sale_d = to_date(row.get("납품일자") or row.get("납품예정일자") or row.get("발주일자"))
        if not sale_d:
            continue
        prod = to_str(row.get("상품명"))
        if not prod:
            continue
        qty = to_float(row.get("상품 수량") or row.get("수량"))
        status = (to_str(row.get("진행 상태")) or "").strip()
        if status in ("취소", "반품"):
            qty = -abs(qty)
        gross = to_float(row.get("납품예정 금액") or row.get("납품금액"))
        order_no = to_str(row.get("납품예정번호"))
        yield ParsedLine(
            sale_date=sale_d,
            order_no=order_no,
            raw_product_name=prod,
            raw_qty=qty,
            gross_amount=gross,
            net_amount=gross,
            settlement_amount=gross,
        )
