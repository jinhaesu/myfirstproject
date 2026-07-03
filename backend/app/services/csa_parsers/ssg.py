"""SSG 파서. 두 가지 리포트 포맷 지원.

1) 발주/출고형 (약 65컬럼, HTML 위장 xls):
   출고기준일·지시수량·취소수량·판매가·공급가 …
2) 업체주문관리 조회형 (20컬럼, HTML 위장 xls):
   순번·주문번호·주문일시·주문구분·주문상품상태·상품명·옵션·주문수량·
   주문금액·할인금액…·실주문금액 …
   → 주문일시=매출일, 주문금액=소비자가(VAT포함, ingest에서 ÷1.1),
     취소/반품/환불 상태 행은 제외.

읽기는 read_excel_safe(HTML 위장 xls·인코딩 자동) 사용 후 '상품명' 포함 행을
헤더로 승격 — read_html(header=0)의 인덱스 컬럼명 오인 현상 회피.
"""
from __future__ import annotations
from typing import Iterable

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import read_excel_safe, to_date, to_float, to_str

# 주문구분/주문상품상태에 포함되면 매출에서 제외할 토큰
_CANCEL_TOKENS = ("취소", "반품", "환불")


@register("SSG")
@register("SSG닷컴")
def parse(path: str) -> Iterable[ParsedLine]:
    df = read_excel_safe(path, header=None)
    if df is None or df.empty:
        return

    # '상품명'이 들어 있는 행을 헤더로 승격 (보통 0행)
    hdr = None
    for i in range(min(5, len(df))):
        if any("상품명" in str(c) for c in df.iloc[i].tolist()):
            hdr = i
            break
    if hdr is None:
        return
    new_header = [str(c).strip() for c in df.iloc[hdr].tolist()]
    df = df[hdr + 1:].reset_index(drop=True)
    df.columns = new_header

    for _, row in df.iterrows():
        # 출고기준일(발주형) → 주문일시(주문관리형) 순으로 매출일 결정
        sale_d = (
            to_date(row.get("출고기준일"))
            or to_date(row.get("출고예정일"))
            or to_date(row.get("주문일자"))
            or to_date(row.get("주문일시"))
        )
        if not sale_d:
            continue
        prod = to_str(row.get("상품명"))
        if not prod or prod == "상품명":
            continue
        # 주문관리형: 취소/반품/환불 상태 행 제외
        state = (to_str(row.get("주문상품상태")) or "") + (to_str(row.get("주문구분")) or "")
        if any(t in state for t in _CANCEL_TOKENS):
            continue
        qty = to_float(row.get("지시수량") or row.get("주문수량") or 1)
        cancel_qty = to_float(row.get("취소수량") or 0)
        net_qty = qty - cancel_qty
        if net_qty <= 0:
            continue
        gross = to_float(
            row.get("판매가") or row.get("결제금액") or row.get("상품금액")
            or row.get("주문금액")
        )
        net = to_float(
            row.get("공급가") or row.get("정산금액") or row.get("실주문금액")
        ) or gross
        yield ParsedLine(
            sale_date=sale_d,
            order_no=to_str(row.get("주문번호")),
            line_no=to_str(row.get("상품번호") or row.get("배송번호")),
            raw_product_name=prod,
            raw_option_name=to_str(row.get("옵션명") or row.get("옵션")),
            raw_qty=net_qty,
            gross_amount=gross,
            net_amount=net,
        )
