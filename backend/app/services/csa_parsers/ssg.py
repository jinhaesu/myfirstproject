"""SSG 파서. HTML 위장 xls. 약 65컬럼.

SSG.xls는 HTML을 xls로 저장한 파일이므로 pd.read_html로 읽는다.
단, read_html(header=0)로 읽으면 첫 번째 행이 실제 헤더 데이터인데도
인덱스(0,1,2...)가 컬럼명으로 잡히는 현상이 있다. 따라서 header=None으로
읽은 뒤 iloc[0]을 컬럼명으로 승격한다.
"""
from __future__ import annotations
from typing import Iterable

import pandas as pd

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import to_date, to_float, to_str


@register("SSG")
@register("SSG닷컴")
def parse(path: str) -> Iterable[ParsedLine]:
    tables = pd.read_html(path, encoding="utf-8", header=None)
    if not tables:
        return
    df = tables[0]
    # 첫 행이 실제 컬럼명
    new_header = df.iloc[0]
    df = df[1:].reset_index(drop=True)
    df.columns = new_header

    for _, row in df.iterrows():
        # 출고기준일은 YYYYMMDD 정수 또는 문자열
        sale_d = (
            to_date(row.get("출고기준일"))
            or to_date(row.get("출고예정일"))
            or to_date(row.get("주문일자"))
        )
        if not sale_d:
            continue
        prod = to_str(row.get("상품명"))
        if not prod:
            continue
        qty = to_float(row.get("지시수량") or row.get("주문수량") or 1)
        cancel_qty = to_float(row.get("취소수량") or 0)
        net_qty = qty - cancel_qty
        if net_qty <= 0:
            continue
        yield ParsedLine(
            sale_date=sale_d,
            order_no=to_str(row.get("주문번호")),
            line_no=to_str(row.get("상품번호") or row.get("배송번호")),
            raw_product_name=prod,
            raw_option_name=to_str(row.get("옵션명") or row.get("옵션")),
            raw_qty=net_qty,
            gross_amount=to_float(row.get("판매가") or row.get("결제금액") or row.get("상품금액")),
            net_amount=to_float(row.get("공급가") or row.get("정산금액") or row.get("판매가")),
        )
