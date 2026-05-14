"""세븐일레븐 파서. 실제 데이터는 row 4 이후이지만 헤더와 데이터 열 수가 일치하지 않아 positional로 처리.

데이터 컬럼 순서 (관찰):
  0:주문일자, 1:입고일자, 2:판매코드, 3:상품코드(barcode), 4:상품명, 5:규격,
  6:입수, 7:주문수, 8:주문수량, 9:단가, 10:주문금액
"""
from __future__ import annotations
from typing import Iterable

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import read_excel_safe, to_date, to_float, to_str


@register("세븐일레븐")
@register("7/11")
def parse(path: str) -> Iterable[ParsedLine]:
    df = read_excel_safe(path, header=None)
    # 첫 5행은 메타정보, 4번째 행이 header → 데이터는 row 5+
    for idx in range(5, len(df)):
        row = df.iloc[idx]
        sale_d = to_date(row[0])
        if not sale_d:
            continue
        prod = to_str(row[4])
        if not prod:
            continue
        yield ParsedLine(
            sale_date=sale_d,
            line_no=to_str(row[2]) or to_str(row[3]),
            raw_product_name=prod,
            raw_option_name=to_str(row[5]) if len(row) > 5 else None,  # 규격
            raw_qty=to_float(row[8]) if len(row) > 8 else 0,  # 주문수량
            gross_amount=to_float(row[10]) if len(row) > 10 else 0,  # 주문금액
            net_amount=to_float(row[10]) if len(row) > 10 else 0,
        )
