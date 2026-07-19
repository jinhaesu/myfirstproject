"""카페24 (자사몰) 파서.

실제 컬럼 기준 (openpyxl):
  날짜  : 결제일시(입금확인일)  — datetime64, F(환불) 행은 NaT (구양식)
         신양식(AN열 존재)은 K열[주문일시] 기준 (기준변경요청서 2026-07, 김재경)
  필터  : 결제구분 == 'T'  (F = 취소/환불 행, 제외) — 구양식
  주문번호: 주문번호
  상품번호: 상품품목코드 (SKU 수준), fallback 상품코드 / 상품번호
  상품명 : 상품명(한국어 쇼핑몰)  fallback 상품명
  옵션  : 상품옵션
  수량  : 수량  (int64)
  gross : 상품구매금액(KRW)  (int64, 이미 숫자)
  net   : 상품구매금액(KRW) 그대로 사용
         ('품목별 결제금액' 컬럼은 전부 NaN)

신양식(2026-06-12~ 파일부터 AN열[취소구분] 추가) 기준변경 반영 (2026-07, 김재경 MD):
  ① 순매출 = Σ( T열[판매가] − AI열[상품별 추가할인금액] )
     · AN열[취소구분] == '취소' 행만 제외. '취소안함' / '부분취소' 행은 그대로 포함
       (부분취소도 전액 반영 — 쿠폰할인·적립금·'총 실제 환불금액'은 차감하지 않음).
     · 판매가(T)는 이미 공급가(부가세 별도) — csa_service.VAT_INCLUDED_CHANNELS에서
       카페24/자사몰이 제외되어 있어(2026-06-12 검수) 여기서 추가로 ÷1.1 하지 않는다.
       (검증: 2026-06 Σ(T-AI) = 203,773,280원, 웹 노출값과 정확히 일치)
  ② 낱개수량: 상품코드(AK, 196종)별 '기준 낱개 입수' 매핑표가 아직 없어 이 파서는
     unit_per_set을 지정하지 않는다(None 유지) → csa_service.resolve_product의
     ChannelProductMapping/ChannelProductMappingComponent 매핑을 그대로 따른다.
     ⚠ 콜라보 증정품(콩단백 너겟·후무스 등, 펄스랩 세트 등)의 낱개 포함 여부는
       scripts/fix_units_manual_overrides.py에 이미 확정된 매핑으로 등록되어 있음
       — 파서에서 unit_per_set을 설정하면(ParsedLine.unit_per_set이 매핑값보다
       우선) 이 확정 로직을 깨뜨리므로 절대 지정하지 않는다. 196종 매핑표 확정 시
       이 매핑 테이블에 반영할 것(파서 변경 불필요).
  ③ 행수(주문건수) = J열[주문번호] 고유값. 파서는 주문번호(order_no)와 행별
     is_cancelled만 정확히 방출하고, '완전취소 주문'(같은 주문번호의 모든 행이
     취소) 판별·집계는 리포팅 레이어(주문 단위 group-by) 책임.
  ④ 취소구분(AN) 판별: 정확히 '취소' 문자열인 행만 취소. '부분취소'는 신규
     기준에서 정상 취급(구양식 로직과 달라진 부분 — 예전엔 "취소" in flag 로
     부분취소도 취소 처리했으나 신규 요청서로 교정).

구버전 호환: AN열[취소구분]이 없는 원본(2026-06-12 이전 보관분)은 기존 로직
  (결제구분 F=취소, 판매가−추가할인−총실제환불금액, 결제일시 우선 날짜) 그대로 유지.
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

    # 신양식 판별: AN열[취소구분] 존재 여부 (한 번만 계산 — 행마다 재판정하지 않음).
    # 구버전 보관 원본엔 이 컬럼이 없으므로, 없으면 기존(구양식) 로직으로 폴백한다.
    has_cancel_col = "취소구분" in df.columns

    for _idx, (_, row) in enumerate(df.iterrows()):
        prod_name = to_str(row.get("상품명(한국어 쇼핑몰)") or row.get("상품명"))
        if not prod_name:
            continue

        qty = to_float(row.get("수량") or 1)

        # line_no: 상품품목코드(SKU) > 상품코드 > 상품번호 + 행 시퀀스
        #   (같은 주문에 동일 SKU·금액 행 중복 시 dedup 탈락 방지)
        line_no = (
            to_str(row.get("상품품목코드"))
            or to_str(row.get("상품코드"))
            or to_str(row.get("상품번호"))
            or ""
        ) + f"-{_idx}"

        if has_cancel_col:
            # ── 신양식 (AN열[취소구분] 존재) ─────────────────────────────
            # 정확히 '취소'인 행만 제외. '취소안함'·'부분취소'는 매출에 포함.
            cancel_flag = to_str(row.get("취소구분"))
            is_cancel = cancel_flag == "취소"

            # 기간 필터 기준 = 주문일시(K열). 결제일시는 취소 행에서 NaT가 흔해
            # 신양식에서는 더 이상 우선 사용하지 않는다(기준변경요청서 2026-07).
            sale_dt = to_datetime(row.get("주문일시") or row.get("결제일시(입금확인일)"))
            if not sale_dt:
                continue

            gross = to_float(row.get("판매가"))
            extra_discount = to_float(row.get("상품별 추가할인금액") or 0)
            net = gross - extra_discount

            if is_cancel:
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
            continue

        # ── 구양식 (AN열 없음) — 기존 로직 그대로 (검수 2026-06-12) ─────────
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

        # gross: 판매가 (정가, 할인 전)
        gross = to_float(
            row.get("판매가")
            or row.get("상품구매금액(KRW)")
        )
        # 매출 = 판매가 − 상품별 추가할인금액 − 총 실제 환불금액
        #   (부분환불 반영. 취소안함 행이라도 부분환불분은 매출에서 차감 — 검수 2026-06-12)
        extra_discount = to_float(row.get("상품별 추가할인금액") or 0)
        refund_amt = to_float(row.get("총 실제 환불금액") or 0)
        net = gross - extra_discount - refund_amt

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
