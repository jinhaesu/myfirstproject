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
        # 구매결정일은 샘플 전체 NaN → 체결일 우선, 입금확인일 fallback
        sale_d = (
            to_date(row.get("구매결정일"))
            or to_date(row.get("체결일"))
            or to_date(row.get("입금확인일"))
        )
        if not sale_d:
            continue

        prod = to_str(row.get("상품명"))
        if not prod:
            continue

        # 수량 컬럼: 실제 파일은 '주문수량', 과거 포맷 fallback '수량'
        qty = to_float(row.get("주문수량") or row.get("수량") or 1)

        # 금액 컬럼: 모두 천단위 쉼표 포함 텍스트 → to_float 으로 처리
        gross = to_float(
            row.get("판매가격")
            or row.get("판매가")
            or row.get("고객결제금(구. 구매대금)")
            or row.get("결제금액")
        )
        net = to_float(
            row.get("판매자 최종정산금")
            or row.get("정산예정금액")
            or row.get("판매자 정산요청가(구. 공급원가)")
        )
        commission = to_float(
            row.get("서비스이용료")
            or row.get("판매수수료")
        )

        # line_no: 장바구니번호가 더 고유하나, 없으면 상품번호 사용
        line_no = to_str(row.get("장바구니번호") or row.get("상품번호"))

        yield ParsedLine(
            sale_date=sale_d,
            sale_datetime=to_datetime(row.get("체결일")),
            order_no=to_str(row.get("주문번호")),
            line_no=line_no,
            raw_product_name=prod,
            raw_qty=qty,
            gross_amount=gross,
            net_amount=net or gross,
            commission=commission,
        )
