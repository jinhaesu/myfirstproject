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
        # 결제구분 'F' = 취소/환불 확정 행. 제외하지 않고 is_cancelled로 표시
        # (대시보드·업로드 결과에서 취소/환불 건수·금액으로 노출).
        pay_type = to_str(row.get("결제구분"))
        is_cancel = bool(pay_type and pay_type.upper() == "F")

        # 날짜: 결제일시(입금확인일) 우선, 없으면 주문일시 fallback.
        # (취소 행은 결제일시가 NaT인 경우가 많아 주문일시로 잡힘)
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

        # gross: 판매가 (정가, 할인 전)
        gross = to_float(
            row.get("판매가")
            or row.get("상품구매금액(KRW)")
        )
        # 매출(a) = 판매가 − 상품별 추가할인금액  (둘 다 품목별 라인 값)
        extra_discount = to_float(row.get("상품별 추가할인금액") or 0)
        net = gross - extra_discount

        # line_no: 상품품목코드(SKU) > 상품코드 > 상품번호
        line_no = (
            to_str(row.get("상품품목코드"))
            or to_str(row.get("상품코드"))
            or to_str(row.get("상품번호"))
        )

        if is_cancel:
            # 취소/환불 확정: 매출엔 0으로 잡고 refund_amount에 취소금액 기록
            yield ParsedLine(
                sale_date=sale_dt.date(),
                sale_datetime=sale_dt,
                order_no=to_str(row.get("주문번호")),
                line_no=line_no,
                raw_product_name=prod_name,
                raw_option_name=to_str(row.get("상품옵션")),
                raw_qty=qty,
                gross_amount=0,
                net_amount=0,
                refund_amount=net,
                is_cancelled=True,
            )
        else:
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
