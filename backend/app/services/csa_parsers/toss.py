"""토스 쇼핑 파서.

엑셀 구조: row0 = 그룹 헤더(일시 정보/주문 정보/...), row1 = 실제 컬럼명,
row2 = '수정 불가/수정 가능' 가이드. 수출 버전에 따라 행 위치가 달라
'주문일시'+'주문번호'가 있는 행을 찾아 헤더로 사용.
"""
from __future__ import annotations
from typing import Iterable

import pandas as pd

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import read_excel_safe, to_datetime, to_float, to_str


def _read_toss(path: str) -> pd.DataFrame:
    raw = read_excel_safe(path, header=None)
    header_idx = None
    for i in range(min(6, len(raw))):
        vals = set(str(v).strip() for v in raw.iloc[i].tolist())
        if "주문일시" in vals and "주문번호" in vals:
            header_idx = i
            break
    if header_idx is None:
        return read_excel_safe(path, header=2)  # 구버전 fallback
    df = raw.iloc[header_idx + 1 :].copy()
    df.columns = [str(c).strip() for c in raw.iloc[header_idx].tolist()]
    return df


@register("토스")
def parse(path: str) -> Iterable[ParsedLine]:
    df = _read_toss(path)
    for _, row in df.iterrows():
        # 가이드 행('수정 불가/수정 가능') 스킵
        if str(row.get("주문일시") or "").startswith("수정 "):
            continue
        sale_dt = to_datetime(row.get("주문일시") or row.get("발송처리일시"))
        if not sale_dt:
            continue
        prod = to_str(row.get("상품명"))
        if not prod:
            continue

        # 주문상태에 '취소' 포함 시 취소건 (취소일시가 있는 행 포함)
        status = to_str(row.get("주문상태") or "") or ""
        is_cancel = "취소" in status

        amt = to_float(row.get("주문금액"))
        yield ParsedLine(
            sale_date=sale_dt.date(),
            sale_datetime=sale_dt,
            order_no=to_str(row.get("주문번호")),
            line_no=to_str(row.get("주문상품번호")),
            raw_product_name=prod,
            raw_option_name=to_str(row.get("옵션명")),
            raw_qty=to_float(row.get("주문건수") or row.get("수량") or 1),
            gross_amount=0 if is_cancel else amt,
            net_amount=0 if is_cancel else amt,
            refund_amount=amt if is_cancel else 0,
            is_cancelled=is_cancel,
        )
