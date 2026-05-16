"""GS SHOP 홈쇼핑 파서. HTML 위장 xls (UTF-8).

read_html(path, encoding='utf-8')로 직접 넘기면 lxml/BS4가 내부 재인코딩으로
컬럼명이 깨지는 문제 발생 → 파일을 먼저 str로 읽어 StringIO로 전달.

컬럼 구조 (직송주문 기준):
  상품상세코드 / 상품코드 / 브랜드명 / 상품명 / 주문옵션 / 매입구분
  매출수량 / 매출금액 / 반품수량 / 반품금액 / 순매출수량 / 협력사지급액
  순매출금액 (고객판매금액)

gross_amount = 순매출금액(고객판매금액)  →  실제 소비자 결제액
net_amount   = 협력사지급액             →  GS가 협력사에 주는 금액
"""
from __future__ import annotations
import io
import os
import re
from datetime import date
from typing import Iterable, Optional

import pandas as pd

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import to_float, to_str


_DATE_PATTERNS = [
    re.compile(r"(20\d\d)[\-\.](\d{1,2})[\-\.](\d{1,2})"),
    re.compile(r"(20\d\d)(\d{2})(\d{2})"),
]


def _extract_date_from_filename(path: str) -> Optional[date]:
    name = os.path.basename(path)
    for pat in _DATE_PATTERNS:
        m = pat.search(name)
        if m:
            try:
                return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
            except Exception:
                continue
    return None


def _read_gs(path: str) -> pd.DataFrame:
    """GS SHOP HTML-xls 파일을 안전하게 읽는다.

    pandas read_html이 파일 경로를 직접 받으면 인코딩 처리 과정에서
    컬럼명이 깨지는 버그가 있어, 파일을 직접 str로 읽어 StringIO 전달.
    """
    # 1) HTML 위장 xls (UTF-8) — 대부분의 GS SHOP 직송주문 파일
    for enc in ("utf-8", "utf-8-sig", "cp949", "euc-kr"):
        try:
            with open(path, "r", encoding=enc) as f:
                content = f.read()
            tables = pd.read_html(io.StringIO(content), header=0)
            if tables:
                return tables[0]
        except Exception:
            continue

    # 2) 진짜 xls (xlrd)
    try:
        return pd.read_excel(path, engine="xlrd")
    except Exception:
        pass

    # 3) xlsx (openpyxl)
    try:
        return pd.read_excel(path, engine="openpyxl")
    except Exception:
        pass

    return pd.DataFrame()


@register("GS샵")
@register("GS 샵")
@register("GS SHOP")
@register("GS샵쇼핑")
def parse(path: str) -> Iterable[ParsedLine]:
    df = _read_gs(path)
    if df.empty:
        return

    sale_d = _extract_date_from_filename(path) or date.today()

    for _, row in df.iterrows():
        prod = to_str(row.get("상품명"))
        if not prod:
            continue

        # 순매출수량 우선, 없으면 매출수량
        qty = to_float(row.get("순매출수량") or row.get("매출수량") or 0)

        # gross: 소비자 결제 기준 총액 (순매출금액 > 매출금액 순)
        gross = to_float(
            row.get("순매출금액 (고객판매금액)")
            or row.get("순매출금액(고객판매금액)")
            or row.get("매출금액")
            or 0
        )

        if qty == 0 and gross == 0:
            continue

        yield ParsedLine(
            sale_date=sale_d,
            line_no=to_str(row.get("상품코드") or row.get("상품상세코드")),
            raw_product_name=prod,
            raw_option_name=to_str(row.get("주문옵션")),
            raw_qty=qty,
            gross_amount=gross,
            net_amount=to_float(row.get("협력사지급액") or gross),
        )
