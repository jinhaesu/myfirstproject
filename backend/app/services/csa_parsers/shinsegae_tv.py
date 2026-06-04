"""신세계 TV 쇼핑 파서.

두 가지 포맷 지원:
  A) "주문집계조회" (SpreadsheetML XML, .xls)
     - Row 0: 제목 / Row 1: 메타 (기간) / Row 2: 헤더 / Row 3..: 데이터
     - 헤더: No, 상품코드, 상품명, 주문수량, 주문금액, 합계수량, 합계금액 ...
  B) "주문접수상세조회(실시간)" (정규 xlsx)
     - Row 0: 제목 / Row 1: 메타 / Row 2: 헤더 / Row 3..: 데이터
     - 헤더: No, 주문구분, 진행단계, 주문번호, 상품코드, 상품명, 접수수량,
             잔여수량(접수-취소), 판매금액, 주문금액, ..., 원주문접수일
"""
from __future__ import annotations

import re
from datetime import date
from typing import Iterable, Optional

import pandas as pd

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import read_excel_safe, to_date, to_float, to_str


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


def _is_spreadsheetml(path: str) -> bool:
    """파일 헤더로 SpreadsheetML XML(=구 .xls 텍스트) 여부 판별."""
    try:
        with open(path, "rb") as f:
            head = f.read(512)
        return b"<?xml" in head or b"<Workbook" in head or b"SpreadsheetML" in head
    except Exception:
        return False


def _parse_xml(path: str) -> Iterable[ParsedLine]:
    with open(path, "r", encoding="utf-8") as f:
        text = f.read()
    rows = _ROW_RE.findall(text)
    if len(rows) < 4:
        return
    meta_cells = _DATA_RE.findall(rows[1]) if len(rows) > 1 else []
    sale_d = _extract_period(" ".join(meta_cells)) or date.today()

    header_cells = _DATA_RE.findall(rows[2])
    col_idx = {name: i for i, name in enumerate(header_cells)}

    def cell(cells, name):
        i = col_idx.get(name)
        if i is None or i >= len(cells):
            return None
        return cells[i]

    for r in rows[3:]:
        cells = _DATA_RE.findall(r)
        if not cells:
            continue
        no = (cell(cells, "No") or "").strip()
        if no in ("합계", "총합계", ""):
            continue
        prod = to_str(cell(cells, "상품명"))
        if not prod:
            continue
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


def _parse_xlsx(path: str) -> Iterable[ParsedLine]:
    # 헤더가 row=2 (메타 2행 + 헤더 1행)
    df = read_excel_safe(path, header=2)
    if df.empty:
        return

    for _, row in df.iterrows():
        # 합계 행 / 빈 행 제외
        no = to_str(row.get("No"))
        if not no or no.strip() in ("합계", "총합계"):
            continue

        # 진행단계=주문취소/반품 — 버리지 않고 is_cancelled로 표시
        status = (to_str(row.get("진행단계")) or "").strip()
        is_cancel = status in ("주문취소", "취소", "취소완료") or "취소" in status or "반품" in status

        prod = to_str(row.get("상품명"))
        if not prod:
            continue

        # 잔여수량(접수-취소) 우선, 없으면 접수수량
        qty = to_float(
            row.get("잔여수량(접수-취소)")
            if pd.notna(row.get("잔여수량(접수-취소)"))
            else row.get("접수수량")
        )

        # 판매금액 = 주문금액 (보통 동일). 둘 중 사용 가능한 값.
        gross = to_float(row.get("판매금액") or row.get("주문금액"))
        if qty == 0 and gross == 0 and not is_cancel:
            continue

        # 일자: 원주문접수일 (예: "2026/05/12 22:42:11")
        sale_d = to_date(row.get("원주문접수일")) or date.today()

        yield ParsedLine(
            sale_date=sale_d,
            order_no=to_str(row.get("주문번호")),
            line_no=to_str(row.get("상품코드") or row.get("단품코드")),
            raw_product_name=prod,
            raw_option_name=to_str(row.get("단품상세")),
            raw_qty=qty,
            gross_amount=0 if is_cancel else gross,
            net_amount=0 if is_cancel else gross,
            settlement_amount=0 if is_cancel else gross,
            refund_amount=gross if is_cancel else 0,
            is_cancelled=is_cancel,
        )


@register("신세계 TV 쇼핑")
@register("신세계TV쇼핑")
@register("신세계TV")
def parse(path: str) -> Iterable[ParsedLine]:
    if path.lower().endswith(".xls") and _is_spreadsheetml(path):
        yield from _parse_xml(path)
    else:
        yield from _parse_xlsx(path)
