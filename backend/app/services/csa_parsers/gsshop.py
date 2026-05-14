"""GS SHOP 홈쇼핑 파서. HTML 위장 xls. 상품 단위 집계 (no date) → 업로드일로 임시 적재."""
from __future__ import annotations
from datetime import date
from typing import Iterable

import pandas as pd

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import to_float, to_str


@register("GS샵")
@register("GS SHOP")
@register("GS샵쇼핑")
def parse(path: str) -> Iterable[ParsedLine]:
    tables = pd.read_html(path, encoding="utf-8", header=0)
    if not tables:
        return
    df = tables[0]
    today = date.today()
    for _, row in df.iterrows():
        prod = to_str(row.get("상품명"))
        if not prod:
            continue
        qty = to_float(row.get("순매출수량") or row.get("매출수량") or 0)
        gross = to_float(row.get("순매출금액 (고객판매금액)") or row.get("매출금액") or 0)
        if qty == 0 and gross == 0:
            continue
        yield ParsedLine(
            sale_date=today,
            line_no=to_str(row.get("상품코드") or row.get("상품상세코드")),
            raw_product_name=prod,
            raw_option_name=to_str(row.get("주문옵션")),
            raw_qty=qty,
            gross_amount=gross,
            net_amount=to_float(row.get("협력사지급액") or gross),
        )
