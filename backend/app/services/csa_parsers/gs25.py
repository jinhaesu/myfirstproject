"""GS25 편의점 파서.

GS Retail 본사 '상품별/거래처/일별 매출' 리포트 (.xlsx) 일관 처리.

특징:
- 헤더 row 위치가 파일마다 다름 (row=2, row=5 등) → '상품명/금액' 셀이 같이
  들어있는 row를 헤더로 자동 탐색.
- 컬럼 9개 표준 레이아웃 (납품일자/상품코드/상품명/사이즈/색상/점포코드/점포명/
  납품수량/납품금액). 일부 리포트는 첫 헤더 라벨이 '상품종류'로 잘못되어 있음.
- 첫 컬럼이 정수 YYYYMMDD(예: 20260101) → 자체 파싱(_common.to_date 버그 회피).
- '납품금액'은 VAT 포함 매출액 → 부가세 별도 정책 따라 ingest 적재 전에 /1.1.
- 같은 (sku, store, date) 라인이 다수 등장 → line_no에 row idx 포함해 dedup unique.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Iterable, Optional

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import read_excel_safe, to_float, to_str


def _to_date_yyyymmdd(v) -> Optional[date]:
    if v is None:
        return None
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    s = str(v).strip().replace(".0", "")
    if len(s) == 8 and s.isdigit():
        try:
            return datetime.strptime(s, "%Y%m%d").date()
        except Exception:
            return None
    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%Y.%m.%d"):
        try:
            return datetime.strptime(s[:10], fmt).date()
        except Exception:
            continue
    return None


def _find_col(header_cells: list[str], keywords: list[str]) -> Optional[int]:
    for j, h in enumerate(header_cells):
        for kw in keywords:
            if kw in h:
                return j
    return None


def _find_header_row(df) -> Optional[int]:
    for i in range(min(20, len(df))):
        cells = [str(c).strip() if c is not None else "" for c in df.iloc[i]]
        has_prod = any("상품명" in c for c in cells)
        has_qty = any(("수량" in c) for c in cells)
        has_amt = any(("금액" in c) for c in cells)
        if has_prod and has_qty and has_amt:
            return i
    return None


@register("GS25")
def parse(path: str) -> Iterable[ParsedLine]:
    df = read_excel_safe(path, sheet_name=0, header=None)
    if df is None or df.empty:
        return

    header_idx = _find_header_row(df)
    if header_idx is None:
        return

    header_cells = [str(c).strip() if c is not None else "" for c in df.iloc[header_idx]]

    date_col = _find_col(header_cells, ["납품일자", "판매일자", "일자"])
    if date_col is None:
        date_col = 0  # 첫 컬럼이 YYYYMMDD인 케이스 (헤더 라벨이 '상품종류' 등으로 잘못됨)
    prod_col = _find_col(header_cells, ["상품명"])
    qty_col = _find_col(header_cells, ["납품수량", "상품수량", "수량"])
    amt_col = _find_col(header_cells, ["납품금액", "상품금액", "판매금액", "금액"])
    sku_col = _find_col(header_cells, ["상품코드"])
    store_col = _find_col(header_cells, ["점포코드", "점포명"])
    size_col = _find_col(header_cells, ["사이즈"])

    if prod_col is None or qty_col is None or amt_col is None:
        return

    line_idx = 0
    for _, row in df.iloc[header_idx + 1:].iterrows():
        if len(row) <= max(prod_col, qty_col, amt_col):
            continue
        sale_d = _to_date_yyyymmdd(row.iloc[date_col])
        if not sale_d:
            continue
        prod = to_str(row.iloc[prod_col])
        if not prod:
            continue
        qty = to_float(row.iloc[qty_col])
        gross_incl = to_float(row.iloc[amt_col])
        if qty == 0 and gross_incl == 0:
            continue
        gross = gross_incl / 1.1  # VAT 포함 매출액 → 공급가
        sku = to_str(row.iloc[sku_col]) if sku_col is not None else ""
        store = to_str(row.iloc[store_col]) if store_col is not None else ""
        size = to_str(row.iloc[size_col]) if size_col is not None else None
        line_no = f"{(sku or '').strip()}@{(store or '').strip()}#L{line_idx}"
        yield ParsedLine(
            sale_date=sale_d,
            line_no=line_no,
            raw_product_name=prod,
            raw_option_name=size,
            raw_qty=qty,
            gross_amount=gross,
            net_amount=gross,
        )
        line_idx += 1
