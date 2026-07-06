"""팔도감 파서 (운영 종료 채널 — 25년 데이터 소급 입력용, 기준변경요청서 2026-07-06 김재경).

컬럼: 정산기준일/거래발생일/배송완료일/브랜드명/판매형태/주문번호/합배송번호/
  개별주문번호/거래유형/판매자상품코드/상품명/옵션명/수량/메모/상품가액(A)/
  판매수수료(B)/팔도감 부담 할인액/셀러 부담 할인액(C)/셀러 보상 금액(D)/
  정산금액(A-B-C+D)/결제방법/정산상태

- 순매출 = 상품가액(A) 합계. 거래유형='상품 환불' 행은 음수로 들어오며
  그대로 상계 적재 (B마트/NS식 음수 상계형 — 검증 합계 988,500 일치 확인).
- VAT 포함가 → VAT_INCLUDED_CHANNELS 등재 (ingest ÷1.1).
- 날짜 = 거래발생일 ('YYYY.MM.DD').
"""
from __future__ import annotations

from typing import Iterable

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import read_excel_safe, to_date, to_float, to_str


@register("팔도감")
def parse(path: str) -> Iterable[ParsedLine]:
    df = read_excel_safe(path, header=0)
    for _idx, (_, row) in enumerate(df.iterrows()):
        sale_d = to_date(row.get("거래발생일")) or to_date(row.get("정산기준일"))
        if not sale_d:
            continue
        prod = to_str(row.get("상품명"))
        if not prod:
            continue
        qty = to_float(row.get("수량") or 0)
        amt = to_float(row.get("상품가액(A)") or row.get("상품가액") or 0)
        if qty == 0 and amt == 0:
            continue
        yield ParsedLine(
            sale_date=sale_d,
            order_no=to_str(row.get("개별주문번호") or row.get("주문번호")),
            line_no=f"{to_str(row.get('판매자상품코드')) or ''}-{_idx}",
            raw_product_name=prod,
            raw_option_name=to_str(row.get("옵션명")),
            raw_qty=qty,
            gross_amount=amt,
            net_amount=amt,
        )
