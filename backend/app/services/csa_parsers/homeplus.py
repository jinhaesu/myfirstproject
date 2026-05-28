"""홈플러스 본사 리포트(상품별/일자별) 파서.

특징:
- 시트명은 매번 다름 (예: 'Sales_20260512091114') → 첫 시트 자동.
- 헤더 row 위치가 파일마다 다름 (보통 row=5) → 상품명+수량+금액 셀이
  같이 들어있는 row를 헤더로 자동 탐색.
- 일부 리포트는 첫 컬럼 라벨이 '상품종류'로 잘못 박혀있지만 실제 데이터는
  YYYYMMDD 정수 일자. 따라서 라벨 키워드 매칭 실패 시 첫 컬럼을 일자로 사용.
- 컬럼 라벨도 시점마다 다름 ('납품수량/납품금액' vs '상품수량/상품금액').
- 중간 '상품합계'/'일합계' 집계 row가 섞여 있어 skip 필요.
- 정산형 B2B → 공급가(부가세 별도) 그대로 적재.
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
    s = s.replace("-", "").replace(".", "").replace("/", "")
    if len(s) == 8 and s.isdigit():
        try:
            return datetime.strptime(s, "%Y%m%d").date()
        except Exception:
            return None
    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%Y.%m.%d"):
        try:
            return datetime.strptime(str(v).strip()[:10], fmt).date()
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
        has_qty = any("수량" in c for c in cells)
        has_amt = any("금액" in c for c in cells)
        if has_prod and has_qty and has_amt:
            return i
    return None


@register("홈플러스")
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
        date_col = 0  # 라벨이 '상품종류' 등으로 잘못된 케이스 → 첫 컬럼이 YYYYMMDD
    code_col = _find_col(header_cells, ["상품코드"])
    prod_col = _find_col(header_cells, ["상품명"])
    qty_col = _find_col(header_cells, ["납품수량", "상품수량", "수량"])
    amt_col = _find_col(header_cells, ["납품금액", "상품금액", "판매금액", "금액"])
    tpnb_col = _find_col(header_cells, ["TPNB"])
    store_col = _find_col(header_cells, ["점포명"])
    storecode_col = _find_col(header_cells, ["점포코드"])
    size_col = _find_col(header_cells, ["사이즈"])

    if prod_col is None or qty_col is None or amt_col is None:
        return

    SKIP_TOKENS = ("합계", "소계")
    for _, row in df.iloc[header_idx + 1:].iterrows():
        if len(row) <= max(prod_col, qty_col, amt_col):
            continue
        prod_code_raw = to_str(row.iloc[code_col]) if code_col is not None else None
        prod_name = to_str(row.iloc[prod_col])
        if not prod_name:
            continue
        # 집계 row 제거 — 상품코드 자리에 '상품합계'/'일합계' 등이 박혀있음
        if prod_code_raw and any(t in prod_code_raw for t in SKIP_TOKENS):
            continue
        if not prod_code_raw:
            continue
        sale_d = _to_date_yyyymmdd(row.iloc[date_col])
        if not sale_d:
            continue
        qty = to_float(row.iloc[qty_col])
        gross = to_float(row.iloc[amt_col])
        if qty == 0 and gross == 0:
            continue
        store = (to_str(row.iloc[store_col]) if store_col is not None else None) \
            or (to_str(row.iloc[storecode_col]) if storecode_col is not None else None)
        size = to_str(row.iloc[size_col]) if size_col is not None else None
        opt = store
        if size and size not in ("FREE", "nan"):
            opt = f"{store} / {size}" if store else size
        tpnb = to_str(row.iloc[tpnb_col]) if tpnb_col is not None else None
        order_no = tpnb or prod_code_raw
        yield ParsedLine(
            sale_date=sale_d,
            order_no=order_no,
            raw_product_name=prod_name,
            raw_option_name=opt,
            raw_qty=qty,
            gross_amount=gross,
            net_amount=gross,
            settlement_amount=gross,
        )
