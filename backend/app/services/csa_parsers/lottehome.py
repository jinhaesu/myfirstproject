"""롯데홈쇼핑 파서. .xlsx이지만 실제로는 OLE2(.xls). xlrd로 시도, 실패 시 read_html.

다양한 변형이 있어 여러 전략 시도.
"""
from __future__ import annotations
from typing import Iterable

import pandas as pd

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import to_date, to_datetime, to_float, to_str


def _read(path: str) -> pd.DataFrame:
    try:
        return pd.read_excel(path, engine="xlrd")
    except Exception:
        pass
    try:
        return pd.read_excel(path, engine="openpyxl")
    except Exception:
        pass
    try:
        tables = pd.read_html(path, encoding="utf-8", header=0)
        return tables[0] if tables else pd.DataFrame()
    except Exception:
        pass
    return pd.DataFrame()


@register("롯데홈쇼핑")
@register("롯데 홈쇼핑")
def parse(path: str) -> Iterable[ParsedLine]:
    df = _read(path)
    if df.empty:
        return
    for _, row in df.iterrows():
        sale_dt = to_datetime(row.get("주문일시") or row.get("결제일시"))
        sale_d = sale_dt.date() if sale_dt else (
            to_date(row.get("주문일자")) or to_date(row.get("매출일자")) or to_date(row.get("정산일"))
        )
        if not sale_d:
            continue
        prod = to_str(row.get("상품명") or row.get("판매상품명"))
        if not prod:
            continue
        yield ParsedLine(
            sale_date=sale_d,
            sale_datetime=sale_dt,
            order_no=to_str(row.get("주문번호")),
            line_no=to_str(row.get("상품코드")),
            raw_product_name=prod,
            raw_option_name=to_str(row.get("옵션") or row.get("단품명")),
            raw_qty=to_float(row.get("수량") or row.get("주문수량") or 1),
            gross_amount=to_float(row.get("결제금액") or row.get("판매가") or row.get("매출금액")),
            net_amount=to_float(row.get("정산금액") or row.get("결제금액")),
        )
