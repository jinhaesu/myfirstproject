"""아워홈 (입고/매입) 파서.

샘플 헤더 (1행):
  No. / 공급사코드 / 공급사명 / 입고센터 / 출하센터 /
  배송처코드 / 배송처명 / 공급일자 / 반품여부 / 재고매입여부 /
  상품코드 / 상품명 / 단위 및 규격 / 과세구분 / 발주수량 / 입고수량 / 입고단가 / 매입금액 / 담당MD / ...
  발주번호 / 발주항번 / 자동여부

매출 단위: BOX 단위로 입고됨. '단위 및 규격' 예: 'BOX(50g*15ea)' — 입수 환산은 csa_service._extract_unit_per_set 규칙에 위임.
"""
from __future__ import annotations

from typing import Iterable

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import (
    read_excel_safe, to_date, to_float, to_str,
)


@register("아워홈")
def parse(path: str) -> Iterable[ParsedLine]:
    # 시트 이름이 'undefined'인 경우가 있어 첫 시트를 자동 로드
    df = read_excel_safe(path, header=0)
    for _, row in df.iterrows():
        sale_d = to_date(row.get("공급일자") or row.get("입고일자"))
        if not sale_d:
            continue
        prod = to_str(row.get("상품명"))
        if not prod:
            continue
        qty = to_float(row.get("입고수량") or row.get("발주수량"))
        if to_str(row.get("반품여부")) == "Y":
            qty = -abs(qty)
        gross = to_float(row.get("매입금액"))
        unit_spec = to_str(row.get("단위 및 규격"))
        order_no = to_str(row.get("발주번호"))
        line_no = to_str(row.get("발주항번"))
        yield ParsedLine(
            sale_date=sale_d,
            order_no=order_no,
            line_no=line_no,
            raw_product_name=prod,
            raw_option_name=unit_spec,
            raw_qty=qty,
            gross_amount=gross,
            net_amount=gross,
            settlement_amount=gross,
        )
