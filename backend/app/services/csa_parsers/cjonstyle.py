"""CJ 온스타일 파서. '인기상품분석현황' 집계 포맷.

데이터 구조:
  row0: 메타 ("인기상품분석현황")
  row1: 헤더 (순위, 상품코드, 상품명, 총주문수량, 총주문금액)
  row2+: 데이터

openpyxl CellStyle 버그 우회 → python-calamine 사용.
일자 컬럼 없는 집계 → 업로드 일자로 임시 적재.
"""
from __future__ import annotations
from datetime import date
from typing import Iterable

import pandas as pd

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import to_float, to_str


def _read(path: str) -> pd.DataFrame:
    """header=None으로 읽고 상품명/총주문금액이 있는 행을 헤더로 사용."""
    for engine in ("calamine", "openpyxl"):
        try:
            df = pd.read_excel(path, engine=engine, header=None)
            return df
        except Exception:
            continue
    from openpyxl import load_workbook
    wb = load_workbook(path, read_only=True, data_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    return pd.DataFrame(rows) if rows else pd.DataFrame()


@register("CJ온스타일")
@register("CJ 온스타일")
@register("CJ ON STYLE")
def parse(path: str) -> Iterable[ParsedLine]:
    df = _read(path)
    if df.empty:
        return

    # 헤더 행 찾기
    header_row = None
    for i in range(min(8, len(df))):
        vals = [str(x or "").strip() for x in df.iloc[i].tolist()]
        if "상품명" in vals and any("총주문금액" in v or "주문금액" in v or "총금액" in v for v in vals):
            header_row = i
            break
    if header_row is None:
        return

    header = [str(x or "").strip() for x in df.iloc[header_row].tolist()]
    today = date.today()
    for idx in range(header_row + 1, len(df)):
        row = df.iloc[idx].tolist()
        d = {h: v for h, v in zip(header, row)}
        prod = to_str(d.get("상품명"))
        if not prod or prod == "상품명":
            continue
        qty = to_float(d.get("총주문수량") or d.get("주문수량") or 0)
        gross = to_float(d.get("총주문금액") or d.get("주문금액") or d.get("총금액") or 0)
        if qty == 0 and gross == 0:
            continue
        yield ParsedLine(
            sale_date=today,
            line_no=to_str(d.get("상품코드")),
            raw_product_name=prod,
            raw_qty=qty,
            gross_amount=gross,
            net_amount=gross,
        )
