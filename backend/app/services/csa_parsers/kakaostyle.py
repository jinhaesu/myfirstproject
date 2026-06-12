"""카카오스타일 (지그재그) 파서.  (검수 반영 2026-06-12)

- 제외: [F 주문상태] '미입금 취소' 행은 집계 대상에서 최종 제외
- 취소: [I 클레임상태] '취소완료'
- 주문수: [B 상품주문번호] 고유값 기준 → order_no = 상품주문번호
- 매출: 행별 [S 상품가격] × [T 수량] (취소 제외)
"""
from __future__ import annotations
from typing import Iterable

import pandas as pd

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import read_excel_safe, to_datetime, to_float, to_str


def _id_str(v) -> str | None:
    """상품주문번호가 float(1.85e+17)로 읽히는 경우 정수 문자열로 정규화."""
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return None
    if isinstance(v, float):
        return f"{int(v)}"
    return to_str(v)


@register("카카오스타일")
def parse(path: str) -> Iterable[ParsedLine]:
    df = read_excel_safe(path, header=0)
    for _, row in df.iterrows():
        # [F 주문상태] '미입금 취소'는 주문 성립 자체가 안 된 건 — 최종 제외
        order_status = to_str(row.get("주문상태") or "") or ""
        if "미입금" in order_status:
            continue

        # 취소완료(클레임상태에 '취소') — 버리지 않고 is_cancelled로 표시
        claim = to_str(row.get("클레임상태") or "")
        is_cancel = bool(claim and "취소" in claim)

        sale_dt = to_datetime(row.get("주문일시"))
        if not sale_dt:
            continue
        prod = to_str(row.get("상품명"))
        if not prod:
            continue
        qty = to_float(row.get("수량") or 1)

        # 매출 = [S 상품가격(원)] × [T 수량]
        unit_price = to_float(row.get("상품가격 (원)") or row.get("상품주문액 (원)") or row.get("판매가 (원)"))
        gross = unit_price * qty
        net = gross
        yield ParsedLine(
            sale_date=sale_dt.date(),
            sale_datetime=sale_dt,
            order_no=_id_str(row.get("상품주문번호")) or to_str(row.get("주문번호")),
            line_no=_id_str(row.get("주문번호")),
            raw_product_name=prod,
            raw_option_name=to_str(row.get("옵션정보")),
            raw_qty=qty,
            gross_amount=0 if is_cancel else gross,
            net_amount=0 if is_cancel else net,
            refund_amount=net if is_cancel else 0,
            is_cancelled=is_cancel,
        )
