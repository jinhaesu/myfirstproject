"""이마트 노브랜드 (납품현황) 파서.

샘플 헤더 (1행, 시트명 '납품현황'):
  No / 배달일시 / 수신일시 / 상태 / 문서번호 / 전표구분 / 전표상세구분 /
  납품형태 / 업태 / 점포코드 / 점포명 / 센터코드 / 센터명 /
  매입일자(YYYYMMDD) / 주문일자 / 주문 낱개 수량 / 주문금액

상품명 컬럼이 없어 단일 가상 상품으로 적재. 매핑 큐에서 표준 품목으로 묶어주면 됨.
점포명은 raw_option_name으로 보관해 매핑 추적 가능.
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


@register("이마트 노브랜드")
def parse(path: str) -> Iterable[ParsedLine]:
    df = read_excel_safe(path, sheet_name="납품현황", header=0)
    for _, row in df.iterrows():
        sale_d = _yyyymmdd_to_date(row.get("매입일자")) or to_date(row.get("배달일시"))
        if not sale_d:
            continue
        qty = to_float(row.get("주문 낱개 수량"))
        gross = to_float(row.get("주문금액"))
        state = (to_str(row.get("상태")) or "").strip()
        sub_type = (to_str(row.get("전표상세구분")) or "").strip()
        if "반품" in state or "반품" in sub_type or "취소" in sub_type:
            qty = -abs(qty)
        # 상품명이 엑셀에 없음 → 단일 가상 SKU로 적재. 매핑 큐에서 표준 품목 1개로 매핑
        store = to_str(row.get("점포명")) or to_str(row.get("센터명"))
        order_no = to_str(row.get("문서번호"))
        yield ParsedLine(
            sale_date=sale_d,
            order_no=order_no,
            raw_product_name="이마트 노브랜드 납품",
            raw_option_name=store,
            raw_qty=qty,
            gross_amount=gross,
            net_amount=gross,
            settlement_amount=gross,
        )
