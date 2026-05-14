"""GS SHOP 홈쇼핑 파서. HTML 위장 xls. 상품 단위 집계.

엑셀 자체에 날짜 컬럼이 없어, 파일명에서 YYYY-MM-DD / YYYY.MM.DD / YYYYMMDD 패턴
또는 'YYYY-MM-DD~YYYY-MM-DD' 기간을 추출해 sale_date로 사용. 못 찾으면 today.
"""
from __future__ import annotations
import os
import re
from datetime import date, datetime
from typing import Iterable, Optional

import pandas as pd

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import to_float, to_str


_DATE_PATTERNS = [
    re.compile(r"(20\d\d)[\-\.](\d{1,2})[\-\.](\d{1,2})"),
    re.compile(r"(20\d\d)(\d{2})(\d{2})"),
]


def _extract_date_from_filename(path: str) -> Optional[date]:
    name = os.path.basename(path)
    for pat in _DATE_PATTERNS:
        m = pat.search(name)
        if m:
            try:
                return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
            except Exception:
                continue
    return None


@register("GS샵")
@register("GS 샵")
@register("GS SHOP")
@register("GS샵쇼핑")
def parse(path: str) -> Iterable[ParsedLine]:
    tables = pd.read_html(path, encoding="utf-8", header=0)
    if not tables:
        return
    df = tables[0]
    sale_d = _extract_date_from_filename(path) or date.today()
    for _, row in df.iterrows():
        prod = to_str(row.get("상품명"))
        if not prod:
            continue
        qty = to_float(row.get("순매출수량") or row.get("매출수량") or 0)
        gross = to_float(row.get("순매출금액 (고객판매금액)") or row.get("매출금액") or 0)
        if qty == 0 and gross == 0:
            continue
        yield ParsedLine(
            sale_date=sale_d,
            line_no=to_str(row.get("상품코드") or row.get("상품상세코드")),
            raw_product_name=prod,
            raw_option_name=to_str(row.get("주문옵션")),
            raw_qty=qty,
            gross_amount=gross,
            net_amount=to_float(row.get("협력사지급액") or gross),
        )
