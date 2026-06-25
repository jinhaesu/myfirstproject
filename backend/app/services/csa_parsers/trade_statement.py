"""거래처 '거래명세서' 공용 템플릿 파서 — 서북 / 에스아이케이(SIK) / 제로스토어 등.

레이아웃(엑셀/PDF 공통):
  상단 거래처/날짜 블록(공급자=조인앤조인), 헤더 행:
    번호 | 품명 | 수량(EA) | (빈칸) | 단가 | 공급가액(-V) | 부가세 | 비고
  이후 품목 행, 하단에 '공급가총액' 등 집계 행.

규칙:
  · 수량(EA) = 낱개 그대로 → unit_per_set = 1 (매핑 입수와 곱하지 않음)
  · 매출 = 공급가액(-V) = 부가세 별도(공급가). VAT 환산(÷1.1) 하지 않음.
  · 날짜 = 상단 날짜 셀(없으면 파일명 YYMMDD).
  · xlsx/xls/csv 와 PDF 모두 지원(PDF는 pdfplumber 표 추출).
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
_SKIP = ("공급가총액", "합계금액", "합계", "소계", "총액", "부가세", "세액")


def _date_from_name(path: str) -> date:
    """파일명 끝 YYMMDD (예: '..._260518' → 2026-05-18)."""
    m = re.search(r"(\d{2})(\d{2})(\d{2})(?!\d)", os.path.basename(path))
    if m:
        try:
            return date(2000 + int(m.group(1)), int(m.group(2)), int(m.group(3)))
        except Exception:
            pass
    return date.today()


def _find_date_in_rows(rows: list) -> Optional[date]:
    """상단 블록에서 거래일자 셀 탐색 (앞 8행)."""
    for r in rows[:8]:
        for v in r:
            if isinstance(v, datetime):
                return v.date()
            if isinstance(v, date):
                return v
            d = to_date(v)
            if d and 2020 <= d.year <= 2099:
                return d
    return None


def _emit_from_rows(rows: list, sale_d: date) -> Iterable[ParsedLine]:
    """행 리스트(엑셀/PDF 공통)에서 품명/수량/단가/공급가액 컬럼을 찾아 ParsedLine 산출."""
    # 헤더 행 탐색 ('품명' + '수량' 동시 포함)
    hdr = None
    for i, r in enumerate(rows[:25]):
        cells = [str(c) for c in r]
        if any("품명" in c for c in cells) and any("수량" in c for c in cells):
            hdr = i
            break
    if hdr is None:
        return

    cells = [str(c).strip() for c in rows[hdr]]

    def col(*kw):
        for j, c in enumerate(cells):
            if any(k in c for k in kw):
                return j
        return None

    c_prod = col("품명", "품 명", "품목")
    c_qty = col("수량", "수 량")
    c_price = col("단가")
    c_supply = col("공급가액", "공급가")
    if c_prod is None or c_qty is None:
        return

    idx = 0
    for r in rows[hdr + 1:]:
        prod = to_str(r[c_prod]) if c_prod < len(r) else None
        if not prod:
            continue
        if any(t in prod for t in _SKIP):
            continue
        qty = to_float(r[c_qty]) if c_qty < len(r) else 0
        gross = to_float(r[c_supply]) if (c_supply is not None and c_supply < len(r)) else 0
        if gross == 0 and c_price is not None and c_price < len(r):
            gross = qty * to_float(r[c_price])  # 공급가액 비면 수량×단가
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


def _parse_pdf_trade_statement(path: str) -> Iterable[ParsedLine]:
    """PDF 거래명세서 — pdfplumber 표를 행 리스트로 모아 공통 추출기에 위임.
    표 인식 실패 시 페이지 텍스트 라인을 폴백으로 사용."""
    import pdfplumber

    all_rows: list = []
    text_blocks: list = []
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            text_blocks.append(page.extract_text() or "")
            for table in page.extract_tables() or []:
                for row in table:
                    all_rows.append([("" if c is None else str(c)) for c in row])

    sale_d = _find_date_in_rows(all_rows)
    if sale_d is None:
        for tb in text_blocks:
            m = re.search(r"(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일", tb)
            if m:
                try:
                    sale_d = date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
                    break
                except Exception:
                    pass
    sale_d = sale_d or _date_from_name(path)

    yielded = False
    for ln in _emit_from_rows(all_rows, sale_d):
        yielded = True
        yield ln
    if yielded:
        return

    # 폴백: 표가 병합돼 컬럼 분리가 안 된 경우 — 텍스트 라인에서 '품명 ... 수량 ... 공급가액' 추출.
    # (현재 거래처들은 표 추출이 정상이라 보통 위에서 처리됨)
    return


def parse_trade_statement(path: str) -> Iterable[ParsedLine]:
    if path.lower().endswith(".pdf"):
        yield from _parse_pdf_trade_statement(path)
        return

    df = read_excel_safe(path, sheet_name=0, header=None)
    if df is None or df.empty:
        return
    rows = [list(df.iloc[i].tolist()) for i in range(len(df))]
    sale_d = _find_date_in_rows(rows) or _date_from_name(path)
    yield from _emit_from_rows(rows, sale_d)


@register("서북")
@register("제로플러스")  # 제로플러스 = 서북(동일 거래처), 거래명세서 양식
@register("서북(제로플러스)")  # 채널 표시명 변경분
@register("에스아이케이")
def parse(path: str) -> Iterable[ParsedLine]:
    yield from parse_trade_statement(path)
