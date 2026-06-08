"""거래처 '거래명세서' 공용 템플릿 파서 — 서북 / 에스아이케이 / 제로스토어 등.

레이아웃(엑셀):
  상단 거래처/날짜 블록(공급자=조인앤조인), 헤더 행:
    번호 | 품명 | 수량(EA) | (빈칸) | 단가 | 공급가액(-V) | 부가세 | 비고
  이후 품목 행, 하단에 '공급가총액' 등 집계 행.

규칙:
  · 수량(EA) = 낱개 그대로 → unit_per_set = 1 (매핑 입수와 곱하지 않음)
  · 매출 = 공급가액(-V) = 부가세 별도(공급가). VAT 환산(÷1.1) 하지 않음.
  · 날짜 = 상단 날짜 셀(없으면 파일명 YYMMDD).
"""
from __future__ import annotations

import os
import re
from datetime import date, datetime
from typing import Iterable, Optional

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import read_excel_safe, to_float, to_str, to_date

# 품명 칸에 들어오는 집계/꼬리 행 토큰 — 데이터로 오인 방지
_SKIP = ("공급가총액", "합계금액", "합계", "소계", "총액", "부가세")


def _find_date(df) -> Optional[date]:
    """상단 블록에서 거래일자 셀 탐색."""
    for i in range(min(8, len(df))):
        for v in df.iloc[i].tolist():
            if isinstance(v, datetime):
                return v.date()
            if isinstance(v, date):
                return v
            d = to_date(v)
            if d and 2020 <= d.year <= 2099:
                return d
    return None


def _date_from_name(path: str) -> date:
    """파일명 끝 YYMMDD (예: '..._260518' → 2026-05-18)."""
    m = re.search(r"(\d{2})(\d{2})(\d{2})(?!\d)", os.path.basename(path))
    if m:
        try:
            return date(2000 + int(m.group(1)), int(m.group(2)), int(m.group(3)))
        except Exception:
            pass
    return date.today()


def parse_trade_statement(path: str) -> Iterable[ParsedLine]:
    df = read_excel_safe(path, sheet_name=0, header=None)
    if df is None or df.empty:
        return

    # 헤더 행 탐색 ('품명' + '수량' 동시 포함)
    hdr = None
    for i in range(min(25, len(df))):
        cells = [str(c) for c in df.iloc[i].tolist()]
        if any("품명" in c for c in cells) and any("수량" in c for c in cells):
            hdr = i
            break
    if hdr is None:
        return

    cells = [str(c).strip() for c in df.iloc[hdr].tolist()]

    def col(*kw):
        for j, c in enumerate(cells):
            if any(k in c for k in kw):
                return j
        return None

    c_prod = col("품명")
    c_qty = col("수량")
    c_price = col("단가")
    c_supply = col("공급가액", "공급가")
    if c_prod is None or c_qty is None:
        return

    sale_d = _find_date(df) or _date_from_name(path)
    idx = 0
    for r in range(hdr + 1, len(df)):
        row = df.iloc[r].tolist()
        prod = to_str(row[c_prod]) if c_prod < len(row) else None
        if not prod:
            continue
        if any(t in prod for t in _SKIP):
            continue
        qty = to_float(row[c_qty]) if c_qty < len(row) else 0
        gross = to_float(row[c_supply]) if (c_supply is not None and c_supply < len(row)) else 0
        if gross == 0 and c_price is not None and c_price < len(row):
            gross = qty * to_float(row[c_price])  # 공급가액 비면 수량×단가
        if qty == 0 and gross == 0:
            continue
        idx += 1
        yield ParsedLine(
            sale_date=sale_d,
            line_no=f"{sale_d.isoformat()}#{idx}",
            raw_product_name=prod,
            raw_qty=qty,
            gross_amount=gross,
            net_amount=gross,
            settlement_amount=gross,
            unit_per_set=1,  # 수량(EA) = 낱개
        )


@register("서북")
@register("에스아이케이")
def parse(path: str) -> Iterable[ParsedLine]:
    yield from parse_trade_statement(path)
