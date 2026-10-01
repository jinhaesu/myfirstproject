"""11번가 파서. 판매완료 내역(배송전체내역) 기준.

원본 파일은 1~5행이 제목·빈 줄, 6행이 헤더 — 헤더 행은 위치 고정이 아니라
'주문번호'+'상품명' 셀이 있는 행을 찾아 승격한다(제목 행을 지우고 올린 파일도 대응).

컬럼 구조(원본 열 문자):
  번호 / 주문일시[B] / 결제일시[C] / 배송번호[G] / 주문번호[H]
  상품명[I] / 옵션[J] / 수량[M]
  판매단가[AG] / 주문금액[AI] / 판매자기본할인금액[AJ] / 정산예정금액[AK]
  주문상세번호[AM] / 판매자추가할인금액[AO] / 복수구매할인금액[AP]
  서비스이용료(상품)[AS]

gross_amount = 주문금액 (소비자 결제 기준 총액, 수량 포함)
net_amount   = 주문금액 − 판매자기본할인금액 − 판매자추가할인금액 − 복수구매할인금액
               (기준변경요청 폼 #79, 남윤주 MD — 매출일보와 기준 통일. VAT 포함가이며
                ÷1.1은 VAT_INCLUDED_CHANNELS 공통 로직에서 ingest 시 처리 — 파서에서 중복 적용 금지)
  ※ 적용 시작일 2026-08-01(주문일시 기준). 그 이전 주문은 기존대로 정산예정금액
    (11번가 수수료 차감 후 금액)을 유지해 과거 월 매출이 움직이지 않게 한다.

line_no = 주문상세번호 (주문 내 상품 순번 1,2,3… — 행 위치와 무관, 주문 내 고유).
  '번호' 컬럼은 파일 내 행 순번이라 조회 기간이 바뀌면 달라지므로 사용 금지.

주의: 판매단가는 1개 단가이므로 gross_amount 대신 사용 금지(수량 곱셈 2배 위험).
"""
from __future__ import annotations
from datetime import date
from typing import Iterable

import pandas as pd

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import read_excel_safe, to_datetime, to_float, to_str

# 순매출 신규 산식(주문금액 − 판매자 부담 할인 3종) 적용 시작일 — 폼 #79
_NET_RULE_FROM = date(2026, 8, 1)


def _find_header_row(df: pd.DataFrame) -> int | None:
    """'주문번호'와 '상품명' 셀이 함께 있는 행(상단 30행 내)을 헤더로 본다."""
    for i in range(min(len(df), 30)):
        cells = {str(v).strip() for v in df.iloc[i].tolist() if pd.notna(v)}
        if "주문번호" in cells and "상품명" in cells:
            return i
    return None


@register("11번가")
def parse(path: str) -> Iterable[ParsedLine]:
    raw = read_excel_safe(path, header=None)
    if raw.empty:
        return
    header_row = _find_header_row(raw)
    if header_row is None:
        return
    df = raw.iloc[header_row + 1:].copy()
    df.columns = [str(c).strip() if pd.notna(c) else "" for c in raw.iloc[header_row].tolist()]

    for _, row in df.iterrows():
        # 주문일시 우선, 없으면 결제일시
        sale_dt = to_datetime(row.get("주문일시")) or to_datetime(row.get("결제일시"))
        if not sale_dt:
            continue

        prod = to_str(row.get("상품명"))
        if not prod:
            continue

        qty = to_float(row.get("수량")) or 1.0

        # gross: 주문금액(수량 포함 총액) 우선
        # 판매단가는 단가이므로 총액 컬럼이 없을 때만 qty 곱하여 fallback
        gross = to_float(row.get("주문금액"))
        if gross == 0:
            unit_price = to_float(row.get("판매단가"))
            gross = unit_price * qty

        settle = to_float(row.get("정산예정금액"))
        if sale_dt.date() >= _NET_RULE_FROM:
            # 판매자 부담 할인(즉시할인·할인쿠폰·복수구매할인) 차감 — 수수료는 차감하지 않음
            net = (
                gross
                - to_float(row.get("판매자기본할인금액"))
                - to_float(row.get("판매자추가할인금액"))
                - to_float(row.get("복수구매할인금액"))
            )
        else:
            net = settle or gross

        yield ParsedLine(
            sale_date=sale_dt.date(),
            sale_datetime=sale_dt,
            order_no=to_str(row.get("주문번호")),
            line_no=(
                to_str(row.get("주문상세번호"))
                or to_str(row.get("배송번호"))
                or to_str(row.get("상품번호"))
            ),
            raw_product_name=prod,
            raw_option_name=to_str(row.get("옵션")),
            raw_qty=qty,
            gross_amount=gross,
            net_amount=net,
            settlement_amount=settle,
            commission=to_float(row.get("서비스이용료(상품)")),
        )
