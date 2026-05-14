"""에이블리 파서. 일자 컬럼이 없는 집계 파일 → 파일명에서 기간 추출."""
from __future__ import annotations
import re
from datetime import date, datetime
from typing import Iterable
import os

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import read_excel_safe, to_float, to_str


def _extract_date_from_filename(path: str) -> date:
    """파일명에서 시작 날짜 추출 (예: '에이블리_2026-05-01_2026-05-12.xlsx')."""
    name = os.path.basename(path)
    m = re.search(r"(\d{4})[-_./](\d{1,2})[-_./](\d{1,2})", name)
    if m:
        try:
            return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        except Exception:
            pass
    return date.today()


@register("에이블리")
@register("Ably")
def parse(path: str) -> Iterable[ParsedLine]:
    df = read_excel_safe(path, header=0)
    sale_d = _extract_date_from_filename(path)
    for _, row in df.iterrows():
        prod = to_str(row.get("상품명"))
        if not prod:
            continue
        qty = to_float(row.get("판매수량") or 0)
        gross = to_float(row.get("거래액") or 0)
        if qty == 0 and gross == 0:
            continue
        yield ParsedLine(
            sale_date=sale_d,
            raw_product_name=prod,
            raw_option_name=to_str(row.get("옵션명")),
            raw_qty=qty,
            gross_amount=gross,
            net_amount=gross,
        )
