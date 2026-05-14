"""신세계 TV 쇼핑 (주문집계조회) 파서.

파일은 SpreadsheetML XML (.xls 확장자, MIME application/vnd.ms-excel).
구조:
  Row 0: 제목
  Row 1: 메타 ("기간: 2026/04/01~2026/04/30" 등 — 기간 추출 후 시작일을 sale_date로)
  Row 2: 헤더 (No, 상품코드, 상품명, 배송형태, 주문수량, 주문금액, ..., 합계수량, 합계금액)
  Row 3..N-1: 데이터
  마지막 Row: 합계 ('합계'로 시작) — skip
"""
from __future__ import annotations

import re
from datetime import date
from typing import Iterable, Optional

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import to_float, to_str


_ROW_RE = re.compile(r"<Row[^>]*>.*?</Row>", re.DOTALL)
_DATA_RE = re.compile(r"<Data[^>]*>([^<]*)</Data>")
_PERIOD_RE = re.compile(r"기간[^\d]*(\d{4})/(\d{1,2})/(\d{1,2})\s*~\s*(\d{4})/(\d{1,2})/(\d{1,2})")


def _extract_period(meta: str) -> Optional[date]:
    m = _PERIOD_RE.search(meta)
    if not m:
        return None
    try:
        return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    except Exception:
        return None


@register("신세계 TV 쇼핑")
@register("신세계TV쇼핑")
@register("신세계TV")
def parse(path: str) -> Iterable[ParsedLine]:
    with open(path, "r", encoding="utf-8") as f:
        text = f.read()
    rows = _ROW_RE.findall(text)
    if len(rows) < 4:
        return
    # 메타 (Row 1)
    meta_cells = _DATA_RE.findall(rows[1]) if len(rows) > 1 else []
    meta_text = " ".join(meta_cells)
    sale_d = _extract_period(meta_text) or date.today()

    # 헤더 (Row 2)
    header_cells = _DATA_RE.findall(rows[2])
    col_idx = {name: i for i, name in enumerate(header_cells)}

    def cell(cells: list[str], name: str) -> Optional[str]:
        i = col_idx.get(name)
        if i is None or i >= len(cells):
            return None
        return cells[i]

    # 데이터 (Row 3..)
    for r in rows[3:]:
        cells = _DATA_RE.findall(r)
        if not cells:
            continue
        no = cell(cells, "No") or ""
        if no.strip() in ("합계", "총합계", ""):
            continue
        prod = to_str(cell(cells, "상품명"))
        if not prod:
            continue
        # 합계수량/합계금액 (주문 - 취소 - 반품 = 합계) 우선
        qty = to_float(cell(cells, "합계수량") or cell(cells, "주문수량"))
        gross = to_float(cell(cells, "합계금액") or cell(cells, "주문금액"))
        if qty == 0 and gross == 0:
            continue
        yield ParsedLine(
            sale_date=sale_d,
            line_no=to_str(cell(cells, "상품코드")),
            raw_product_name=prod,
            raw_qty=qty,
            gross_amount=gross,
            net_amount=gross,
            settlement_amount=gross,
        )
