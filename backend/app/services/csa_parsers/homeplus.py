"""홈플러스 (복합보고서 - 상품별/일자별) 파서.

시트명은 매번 다름 (예: 'Sales_20260512091114') → 첫 시트 자동.
실제 헤더는 6번째 행(0-indexed=5):
  납품일자(YYYYMMDD) / 상품코드 / TPNB / 상품명 / 사이즈 / 색상 /
  점포코드 / 점포명 / 납품수량 / 납품금액

중간 '상품합계'/'일합계' 집계 row가 섞여 있어 skip 필요.
"""
from __future__ import annotations

from datetime import datetime
from typing import Iterable

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import (
    read_excel_safe, to_date, to_float, to_str,
)


def _yyyymmdd_to_date(v):
    s = to_str(v)
    if not s:
        return None
    s = s.replace("-", "").replace(".", "").replace("/", "").strip()
    if len(s) == 8 and s.isdigit():
        try:
            return datetime.strptime(s, "%Y%m%d").date()
        except Exception:
            return None
    return to_date(v)


@register("홈플러스")
def parse(path: str) -> Iterable[ParsedLine]:
    # 시트명이 매번 다른 timestamp 포함 → 첫 시트 자동 선택
    df = read_excel_safe(path, sheet_name=0, header=5)
    for _, row in df.iterrows():
        prod_code_raw = to_str(row.get("상품코드"))
        prod_name = to_str(row.get("상품명"))
        # 집계 row 제거
        if not prod_code_raw or not prod_name:
            continue
        if prod_code_raw in ("상품합계", "일합계", "총합계", "합계"):
            continue
        if any(x in prod_code_raw for x in ("합계", "소계")):
            continue
        sale_d = _yyyymmdd_to_date(row.get("납품일자"))
        if not sale_d:
            continue
        qty = to_float(row.get("납품수량"))
        gross = to_float(row.get("납품금액"))
        store = to_str(row.get("점포명")) or to_str(row.get("점포코드"))
        size = to_str(row.get("사이즈"))
        # 옵션명 우선순위: 점포명 (단위 환산이 필요한 경우 size로 fallback)
        opt = store
        if size and size not in ("FREE", "nan"):
            opt = f"{store} / {size}" if store else size
        order_no = to_str(row.get("TPNB")) or prod_code_raw
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
