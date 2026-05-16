"""B마트 (배민 비마트) 정산 상세 파서.

컬럼 구조:
  - 공급가액: 단가(개당 공급가)
  - 합계금액: 수량 × 공급가액 = 실제 정산금액
  - 발주유형: '구매발주'(+) / '반품'(-)
"""
from __future__ import annotations
from typing import Iterable

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import read_excel_safe, to_datetime, to_float, to_str

# 반품·환불로 간주해 수량/금액을 음수 처리할 발주유형
_NEGATIVE_TYPES = {"반품"}


@register("B마트")
@register("비마트")
def parse(path: str) -> Iterable[ParsedLine]:
    df = read_excel_safe(path, header=0)
    for _, row in df.iterrows():
        sale_dt = (
            to_datetime(row.get("입/출고 완료일시"))
            or to_datetime(row.get("발주/반품 마감일시"))
        )
        if not sale_dt:
            continue
        prod = to_str(row.get("관리용 SKU명") or row.get("상품명"))
        if not prod:
            continue

        order_type = str(row.get("발주유형") or "").strip()
        qty_sign = -1 if order_type in _NEGATIVE_TYPES else 1

        qty = to_float(row.get("수량") or 1) * qty_sign

        # 합계금액 = 수량 × 공급가액(단가). 없을 경우 단가 × 수량으로 fallback.
        total = to_float(row.get("합계금액"))
        if total == 0:
            unit_price = to_float(row.get("공급가액") or row.get("판매가"))
            total = unit_price * abs(qty)
        total *= qty_sign

        yield ParsedLine(
            sale_date=sale_dt.date(),
            sale_datetime=sale_dt,
            order_no=to_str(row.get("발주번호/반품번호") or row.get("주문번호")),
            line_no=to_str(row.get("SKU코드")),
            raw_product_name=prod,
            raw_qty=qty,
            gross_amount=total,
            net_amount=total,
        )
