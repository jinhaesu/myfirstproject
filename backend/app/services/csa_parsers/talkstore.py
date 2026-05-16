"""톡스토어&선물하기 (통합) 파서.

통합 엑셀에 '채널' 컬럼(선물하기/톡스토어)이 존재.
카카오선물하기 파서는 채널='선물하기' 행만, 카카오톡스토어 파서는 채널='톡스토어' 행만 처리.
취소 주문(주문상태에 '취소' 포함) 제외.
집계 기준: 상품금액 (수량이 이미 반영된 총액).
"""
from __future__ import annotations

from typing import Iterable

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import (
    read_excel_safe, to_datetime, to_float, to_str,
)

# 채널 컬럼값 → 파서 등록명 매핑
_CHANNEL_FILTER = {
    "카카오선물하기": "선물하기",
    "카카오톡스토어": "톡스토어",
}


def _parse_channel(path: str, channel_filter: str) -> Iterable[ParsedLine]:
    df = read_excel_safe(path, header=0)
    for _, row in df.iterrows():
        # 채널 컬럼이 있으면 해당 채널만 처리, 없으면 전체 처리
        ch_col = to_str(row.get("채널"))
        if ch_col is not None and ch_col != channel_filter:
            continue

        # 취소 주문 제외
        status = to_str(row.get("주문상태") or "")
        if status and "취소" in status:
            continue

        sale_dt = to_datetime(row.get("주문일") or row.get("발송요청일") or row.get("결제일") or row.get("주문일시"))
        if not sale_dt:
            continue
        prod = to_str(row.get("상품명"))
        if not prod:
            continue

        # 상품금액은 수량이 이미 반영된 총액
        gross = to_float(row.get("상품금액"))
        yield ParsedLine(
            sale_date=sale_dt.date(),
            sale_datetime=sale_dt,
            order_no=to_str(row.get("주문번호")),
            line_no=to_str(row.get("결제번호")),
            raw_product_name=prod,
            raw_option_name=to_str(row.get("옵션")),
            raw_qty=to_float(row.get("수량") or 1),
            gross_amount=gross,
            net_amount=gross,
        )


@register("카카오선물하기")
def parse_gift(path: str) -> Iterable[ParsedLine]:
    return _parse_channel(path, "선물하기")


@register("카카오톡스토어")
def parse_talk(path: str) -> Iterable[ParsedLine]:
    return _parse_channel(path, "톡스토어")
