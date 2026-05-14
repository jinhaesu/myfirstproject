"""신세계라이브쇼핑 파서. SpreadsheetML 2003 XML (Excel XML)."""
from __future__ import annotations
from datetime import date, datetime
from typing import Iterable
import xml.etree.ElementTree as ET

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import to_date, to_datetime, to_float, to_str


NS = "{urn:schemas-microsoft-com:office:spreadsheet}"


def _read_rows(path: str):
    tree = ET.parse(path)
    root = tree.getroot()
    for ws in root.iter(f"{NS}Worksheet"):
        for table in ws.iter(f"{NS}Table"):
            for r in table.iter(f"{NS}Row"):
                cells = []
                # ss:Index 처리: 셀 사이 빈칸이 있으면 인덱스가 점프
                expected_idx = 1
                for c in r.iter(f"{NS}Cell"):
                    idx_attr = c.get(f"{NS}Index")
                    if idx_attr:
                        idx = int(idx_attr)
                        while expected_idx < idx:
                            cells.append(None)
                            expected_idx += 1
                    data = c.find(f"{NS}Data")
                    cells.append(data.text if data is not None else None)
                    expected_idx += 1
                yield cells


@register("신세계라이브쇼핑")
@register("신세계 라이브쇼핑")
def parse(path: str) -> Iterable[ParsedLine]:
    rows = list(_read_rows(path))
    if not rows:
        return
    # 헤더 행 (상품명 포함하는 가장 첫 행)
    header_row_idx = None
    for i, r in enumerate(rows):
        if r and any((c or "") == "상품명" for c in r):
            header_row_idx = i
            break
    if header_row_idx is None:
        return
    header = [(c or "").strip() for c in rows[header_row_idx]]

    def col(row, *names):
        for n in names:
            if n in header:
                idx = header.index(n)
                if idx < len(row):
                    return row[idx]
        return None

    today = date.today()
    for row in rows[header_row_idx + 1:]:
        if not row or not any(row):
            continue
        sale_dt = to_datetime(col(row, "주문일시", "결제일시"))
        sale_d = sale_dt.date() if sale_dt else to_date(
            col(row, "주문일자", "매출일자", "정산일", "출고일자")
        )
        if not sale_d:
            sale_d = today
        prod = to_str(col(row, "상품명", "판매상품명"))
        if not prod:
            continue
        yield ParsedLine(
            sale_date=sale_d,
            sale_datetime=sale_dt,
            order_no=to_str(col(row, "주문번호")),
            raw_product_name=prod,
            raw_option_name=to_str(col(row, "옵션", "단품명")),
            raw_qty=to_float(col(row, "수량", "주문수량", "매출수량") or 1),
            gross_amount=to_float(col(row, "결제금액", "판매가", "매출금액", "주문금액") or 0),
            net_amount=to_float(col(row, "정산금액", "결제금액") or 0),
        )
