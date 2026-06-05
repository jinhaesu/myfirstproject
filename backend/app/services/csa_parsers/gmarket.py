"""G마켓 파서.

실제 컬럼 기준 (xlrd 또는 HTML-fallback):
  날짜  : 체결일 (구매결정일은 항상 NaN)
  주문번호: 주문번호
  상품번호: 상품번호
  상품명 : 상품명
  수량  : 주문수량
  gross : 판매가격  (천단위 쉼표 포함 텍스트)
  net   : 판매자 최종정산금 (천단위 쉼표 포함 텍스트)
  수수료: 서비스이용료
"""
from __future__ import annotations

from typing import Iterable

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import (
    read_excel_safe, to_datetime, to_date, to_float, to_str,
)


@register("지마켓")
@register("G마켓")
def parse(path: str) -> Iterable[ParsedLine]:
    df = read_excel_safe(path, header=0)
    for _, row in df.iterrows():
        # 일자: 입금확인일 기준(파일이 '입금확인' 기준 추출 → 전 행 해당월).
        # 구매결정일/체결일은 매출확정 시점이 익월로 넘어가 당월 조회에서 누락됨.
        sale_d = (
            to_date(row.get("입금확인일"))
            or to_date(row.get("체결일"))
            or to_date(row.get("구매결정일"))
        )
        if not sale_d:
            continue

        prod = to_str(row.get("상품명"))
        if not prod:
            continue

        # 취소/환불: '환불일'이 있으면 환불 확정 건 → is_cancelled(매출 제외·건수 집계).
        is_cancel = to_date(row.get("환불일")) is not None

        # 수량 컬럼: 실제 파일은 '주문수량', 과거 포맷 fallback '수량'
        qty = to_float(row.get("주문수량") or row.get("수량") or 1)

        # 금액 컬럼: 모두 천단위 쉼표 포함 텍스트 → to_float 으로 처리
        gross = to_float(
            row.get("판매가격")
            or row.get("판매가")
            or row.get("고객결제금(구. 구매대금)")
            or row.get("결제금액")
        )
        # 매출(net) = X열 고객결제금(구. 구매대금)  ← 사용자 지정(2026-06-05)
        net = to_float(
            row.get("고객결제금(구. 구매대금)")
            or row.get("고객결제금")
            or row.get("결제금액")
        )
        commission = to_float(
            row.get("서비스이용료")
            or row.get("판매수수료")
        )

        # line_no: 장바구니번호가 더 고유하나, 없으면 상품번호 사용
        line_no = to_str(row.get("장바구니번호") or row.get("상품번호"))

        # 환불 건은 환불금액(원 판매가 기준)만 집계, 매출/순매출 0.
        refund = abs(net or gross or to_float(row.get("판매가격"))) if is_cancel else 0
        yield ParsedLine(
            sale_date=sale_d,
            sale_datetime=to_datetime(row.get("체결일")),
            order_no=to_str(row.get("주문번호")),
            line_no=line_no,
            raw_product_name=prod,
            raw_qty=qty,
            gross_amount=0 if is_cancel else gross,
            net_amount=0 if is_cancel else (net or gross),
            commission=0 if is_cancel else commission,
            refund_amount=refund,
            is_cancelled=is_cancel,
        )
