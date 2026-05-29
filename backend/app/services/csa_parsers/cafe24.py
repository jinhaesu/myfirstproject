"""카페24 (자사몰) 파서.

실제 컬럼 기준 (openpyxl):
  날짜  : 결제일시(입금확인일)  — datetime64, F(환불) 행은 NaT
  필터  : 결제구분 == 'T'  (F = 취소/환불 행, 제외)
  주문번호: 주문번호
  상품번호: 상품품목코드 (SKU 수준), fallback 상품코드 / 상품번호
  상품명 : 상품명(한국어 쇼핑몰)  fallback 상품명
  옵션  : 상품옵션
  수량  : 수량  (int64)
  gross : 상품구매금액(KRW)  (int64, 이미 숫자)
  net   : 상품구매금액(KRW) 그대로 사용
         ('품목별 결제금액' 컬럼은 전부 NaN)
"""
from __future__ import annotations

import pandas as pd
from typing import Iterable

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import (
    read_excel_safe, to_date, to_datetime, to_float, to_str,
)


@register("자사몰")
@register("카페24")
def parse(path: str) -> Iterable[ParsedLine]:
    df = read_excel_safe(path, header=0)

    for _, row in df.iterrows():
        # 취소/환불 행 제외 (결제구분 'F')
        pay_type = to_str(row.get("결제구분"))
        if pay_type and pay_type.upper() == "F":
            continue

        # 결제일시(입금확인일) 우선, 없으면 주문일시 fallback
        # NaT(pd.NaT)는 bool 평가 불가 → pd.isna 체크
        dt_val = row.get("결제일시(입금확인일)")
        if dt_val is None or (hasattr(dt_val, '__class__') and pd.isna(dt_val)):
            dt_val = row.get("주문일시")

        sale_dt = to_datetime(dt_val)
        if not sale_dt:
            continue

        prod_name = to_str(row.get("상품명(한국어 쇼핑몰)") or row.get("상품명"))
        if not prod_name:
            continue

        qty = to_float(row.get("수량") or 1)

        # gross: 상품구매금액(KRW) (정상가, 쿠폰 전 금액)
        gross = to_float(
            row.get("상품구매금액(KRW)")
            or row.get("판매가")
        )
        # net: 실 결제금액 (품목별 결제금액이 있으면 사용, 전부 NaN이면 gross 사용)
        net_raw = row.get("품목별 결제금액")
        if net_raw is not None and not (isinstance(net_raw, float) and pd.isna(net_raw)):
            net = to_float(net_raw)
        else:
            net = gross

        # line_no: 상품품목코드(SKU) > 상품코드 > 상품번호
        line_no = (
            to_str(row.get("상품품목코드"))
            or to_str(row.get("상품코드"))
            or to_str(row.get("상품번호"))
        )

        yield ParsedLine(
            sale_date=sale_dt.date(),
            sale_datetime=sale_dt,
            order_no=to_str(row.get("주문번호")),
            line_no=line_no,
            raw_product_name=prod_name,
            raw_option_name=to_str(row.get("상품옵션")),
            raw_qty=qty,
            gross_amount=gross,
            net_amount=net,
        )
