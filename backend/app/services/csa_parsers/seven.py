"""세븐일레븐 파서.

두 가지 리포트 포맷을 헤더 자동 감지로 모두 지원:

  A) 상품별 주문정보 (col=12):
     주문일자 | 입고일자 | 매입형태 | 상품코드 | 판매코드 | 상품명 |
     규격 | 입수 | 주문수 | 주문수량 | 단가 | 주문금액

  B) 매입상품별 (col=10):
     매입일 | 상품코드 | 판매코드 | 상품명 | 규격 |
     주문수량 | 주문금액 | 매입구분 | 매입수량 | 매입금액

엑셀 상단(0~3행)은 메타정보. 헤더 row를 텍스트로 탐색해 위치 결정.
"""
from __future__ import annotations
from typing import Iterable

import pandas as pd

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import read_excel_safe, to_date, to_float, to_str


def _find_header_row(df: pd.DataFrame) -> int | None:
    """헤더 row 자동 탐색 (0~10행 사이)."""
    for i in range(min(11, len(df))):
        cells = [str(v).strip() for v in df.iloc[i] if pd.notna(v)]
        joined = "|".join(cells)
        if ("상품명" in joined) and ("상품코드" in joined) and (
            "주문일자" in joined or "매입일" in joined
        ):
            return i
    return None


@register("세븐일레븐")
@register("7/11")
def parse(path: str) -> Iterable[ParsedLine]:
    df = read_excel_safe(path, header=None)
    header_row = _find_header_row(df)
    if header_row is None:
        return

    header = df.iloc[header_row]
    col_map: dict[str, int] = {}
    for j, name in enumerate(header):
        if pd.notna(name):
            col_map[str(name).strip()] = j

    def cell(row, *names):
        for n in names:
            if n in col_map:
                return row[col_map[n]]
        return None

    for idx in range(header_row + 1, len(df)):
        row = df.iloc[idx]
        sale_d = to_date(cell(row, "주문일자", "매입일"))
        if not sale_d:
            continue
        prod = to_str(cell(row, "상품명"))
        if not prod:
            continue

        # 수량/금액: 매입 기준 우선 (정산 기준), 없으면 주문 기준 fallback
        qty = to_float(cell(row, "매입수량", "주문수량") or 0)
        amount = to_float(cell(row, "매입금액", "주문금액") or 0)
        if qty == 0 and amount == 0:
            continue

        line_no = (
            to_str(cell(row, "상품코드"))
            or to_str(cell(row, "판매코드"))
            or ""
        )

        yield ParsedLine(
            sale_date=sale_d,
            line_no=f"{line_no}#L{idx}",
            raw_product_name=prod,
            raw_option_name=to_str(cell(row, "규격")),
            raw_qty=qty,
            gross_amount=amount,
            net_amount=amount,
        )
