"""올웨이즈 파서."""
from __future__ import annotations
from collections import defaultdict
from typing import Iterable

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import read_excel_safe, to_datetime, to_date, to_float, to_str


@register("올웨이즈")
def parse(path: str) -> Iterable[ParsedLine]:
    df = read_excel_safe(path, header=0)
    # 행수(주문건수) = '합배송 아이디' 고유값 기준 → order_no를 합배송 아이디로.
    # 같은 합배송에 복수 상품행이 있어도 낱개 SUM이 유지되도록 line_no에 시퀀스 부여.
    _seq: dict = defaultdict(int)
    for _, row in df.iterrows():
        # 취소/반품 — 버리지 않고 is_cancelled로 표시
        status = to_str(row.get("주문 상태") or row.get("상태") or "") or ""
        cancel_yn = to_str(row.get("취소/반품 여부") or "") or ""
        is_cancel = (
            status in ("취소", "반품", "취소완료", "반품완료")
            or cancel_yn in ("Y", "취소", "반품")
        )

        sale_dt = (
            to_datetime(row.get("주문 성사 시점"))
            or to_datetime(row.get("배송 완료 시점"))
            or to_datetime(row.get("구매(취소) 확정 시점"))
        )
        if not sale_dt:
            continue
        prod = to_str(row.get("상품명"))
        if not prod:
            continue
        # 매출 = 상품 구매금액(H) − 판매자 부담 쿠폰할인금(L)  ← 사용자 지정(2026-06-05)
        gross = to_float(row.get("상품 구매금액"))
        seller_coupon = to_float(
            row.get("판매자 부담 쿠폰할인금")
            or row.get("판매자 부담 쿠폰 할인금")
            or row.get("판매자부담쿠폰할인금")
        )
        net = gross - seller_coupon
        # 합배송 아이디(B) 기준 주문건수 — 없으면 주문아이디로 폴백
        order_no = to_str(row.get("합배송 아이디") or row.get("합배송아이디") or row.get("주문아이디"))
        _seq[order_no or ""] += 1
        line_no = f"{_seq[order_no or '']}"
        yield ParsedLine(
            sale_date=sale_dt.date(),
            sale_datetime=sale_dt,
            order_no=order_no,
            line_no=line_no,
            raw_product_name=prod,
            raw_option_name=to_str(row.get("옵션")),
            raw_qty=to_float(row.get("수량") or 1),
            gross_amount=0 if is_cancel else gross,
            net_amount=0 if is_cancel else net,
            refund_amount=net if is_cancel else 0,
            commission=0 if is_cancel else to_float(row.get("수수료") or row.get("특별 수수료(기타 매출)")),
            is_cancelled=is_cancel,
        )
