"""에이블리 파서. 기간별 상품 집계 파일 (날짜 컬럼 없음).

시트명: 통계
컬럼 구조 (header=0):
  [0] 상품명  [1] 옵션명  [2] 거래액  [3] 판매수량  [4] 상품찜 수  [5] 장바구니 수

sale_date는 파일명에서 추출 (예: 에이블리_2026-05-01_2026-05-12.xlsx → 2026-05-01).
gross_amount = 거래액 (소비자 결제 총액, 수량 포함).

방어 로직: openpyxl이 시트명을 제대로 읽지 못할 경우 인덱스 0번 시트 사용.
컬럼명 매칭 실패 대비 iloc 인덱스 fallback 추가.
"""
from __future__ import annotations
import re
from datetime import date
from typing import Iterable
import os

import pandas as pd

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import read_excel_safe, to_datetime, to_float, to_str


def _parse_order_list(df: pd.DataFrame) -> Iterable[ParsedLine]:
    """에이블리 '전체주문내역'(주문 단위) 양식.
    컬럼: 결제일 / 상품주문번호 / 주문번호 / 상품명 / 판매가 / 수량 / 결제액 / 주문상태 ...
    날짜=결제일, 매출(net)=결제액(실결제), 주문상태 '취소'는 is_cancelled.
    """
    for _, row in df.iterrows():
        sale_dt = to_datetime(row.get("결제일") or row.get("주문일") or row.get("결제일시"))
        if not sale_dt:
            continue
        prod = to_str(row.get("상품명"))
        if not prod:
            continue
        status = to_str(row.get("주문상태") or "") or ""
        is_cancel = ("취소" in status) or ("반품" in status) or ("환불" in status)
        qty = to_float(row.get("수량") or 1)
        # 매출 = 결제액(L) 그대로. 결제액=0(쿠폰 전액결제)도 0으로 둠
        # → gross도 결제액으로 둬서 ingest의 (net or gross) 폴백이 판매가를 끌어오지 않게 함.
        net = to_float(row.get("결제액"))
        gross = net
        yield ParsedLine(
            sale_date=sale_dt.date(),
            sale_datetime=sale_dt,
            order_no=to_str(row.get("주문번호")),
            line_no=to_str(row.get("상품주문번호")),
            raw_product_name=prod,
            raw_option_name=to_str(row.get("옵션 정보") or row.get("옵션명")),
            raw_qty=qty,
            gross_amount=0 if is_cancel else gross,
            net_amount=0 if is_cancel else net,
            refund_amount=net if is_cancel else 0,
            is_cancelled=is_cancel,
        )


def _extract_date_from_filename(path: str) -> date:
    """파일명에서 시작 날짜 추출 (예: '에이블리_2026-05-01_2026-05-12.xlsx')."""
    name = os.path.basename(path)
    m = re.search(r"(\d{4})[-_./](\d{1,2})[-_./](\d{1,2})", name)
    if m:
        try:
            return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        except Exception:
            pass
    return date.today()


def _read_ably(path: str) -> pd.DataFrame:
    """에이블리 xlsx 읽기. 시트 인덱스 0 강제 사용으로 시트명 인코딩 문제 회피."""
    try:
        # sheet_name=0: 시트명 대신 인덱스로 읽어 한글 시트명 인코딩 문제 방지
        return pd.read_excel(path, engine="openpyxl", sheet_name=0, header=0)
    except Exception:
        pass
    # fallback: read_excel_safe
    return read_excel_safe(path, header=0)


@register("에이블리")
@register("Ably")
def parse(path: str) -> Iterable[ParsedLine]:
    df = _read_ably(path)
    if df.empty:
        return

    # 양식 감지: '전체주문내역'(결제일+결제액 컬럼) vs '통계'(기간집계)
    cols_set = {str(c).strip() for c in df.columns}
    if "결제일" in cols_set and ("결제액" in cols_set or "판매가" in cols_set):
        yield from _parse_order_list(df)
        return

    sale_d = _extract_date_from_filename(path)
    cols = list(df.columns)

    for _, row in df.iterrows():
        # 컬럼명 우선, 실패 시 iloc 인덱스 fallback
        prod = to_str(row.get("상품명") or (row.iloc[0] if len(cols) > 0 else None))
        if not prod:
            continue

        # 거래액 = 소비자 결제 기준 총액 (수량 포함)
        gross = to_float(
            row.get("거래액")
            if row.get("거래액") is not None
            else (row.iloc[2] if len(cols) > 2 else 0)
        )
        qty = to_float(
            row.get("판매수량")
            if row.get("판매수량") is not None
            else (row.iloc[3] if len(cols) > 3 else 0)
        )
        opt = to_str(
            row.get("옵션명")
            if row.get("옵션명") is not None
            else (row.iloc[1] if len(cols) > 1 else None)
        )

        if qty == 0 and gross == 0:
            continue

        yield ParsedLine(
            sale_date=sale_d,
            raw_product_name=prod,
            raw_option_name=opt,
            raw_qty=qty,
            gross_amount=gross,
            net_amount=gross,
        )
