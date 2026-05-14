"""테무 파서. '구매 날짜'는 '2026년 5월 12일 09:15 KST(UTC+9)' 형식."""
from __future__ import annotations
import re
from datetime import datetime
from typing import Iterable, Optional

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import read_excel_safe, to_datetime, to_float, to_str


def _parse_korean_date(v) -> Optional[datetime]:
    if v is None:
        return None
    s = str(v)
    m = re.search(r"(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일(?:\s+(\d{1,2}):(\d{1,2}))?", s)
    if not m:
        return None
    y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
    hh = int(m.group(4)) if m.group(4) else 0
    mm = int(m.group(5)) if m.group(5) else 0
    try:
        return datetime(y, mo, d, hh, mm)
    except Exception:
        return None


@register("테무")
@register("Temu")
def parse(path: str) -> Iterable[ParsedLine]:
    df = read_excel_safe(path, header=0)
    for _, row in df.iterrows():
        sale_dt = (
            _parse_korean_date(row.get("구매 날짜"))
            or to_datetime(row.get("구매 날짜"))
            or to_datetime(row.get("결제 시간"))
            or to_datetime(row.get("주문 시간"))
            or to_datetime(row.get("주문일시"))
        )
        if not sale_dt:
            continue
        prod = to_str(row.get("제품 이름") or row.get("고객 주문별 제품 이름") or row.get("상품명"))
        if not prod:
            continue
        yield ParsedLine(
            sale_date=sale_dt.date(),
            sale_datetime=sale_dt,
            order_no=to_str(row.get("주문 ID") or row.get("주문 상품 ID")),
            line_no=to_str(row.get("SKU ID") or row.get("제공 sku")),
            raw_product_name=prod,
            raw_option_name=to_str(row.get("선택 사항")),
            raw_qty=to_float(row.get("구매 수량") or row.get("수량") or 1),
            gross_amount=to_float(
                row.get("기본 가격 총액") or row.get("할인 후 기본 가격 총액")
                or row.get("주문 금액") or row.get("상품 기본 가격")
            ),
            net_amount=to_float(
                row.get("할인 후 기본 가격 총액") or row.get("기본 가격 총액")
                or row.get("주문 금액")
            ),
        )
