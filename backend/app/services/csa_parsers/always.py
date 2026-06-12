"""올웨이즈 파서.

두 가지 양식 지원:
  A) 주문건별정산내역 (2026-06 신양식) — 컬럼:
       결제일자, 정산일자, 배송 완료 시점, 취소 완료 시점, 구매확정 시점,
       주문번호, 합배송 ID, 상품명, 옵션, 수량, 주문 상태, 결제 수단,
       상품 구매액, 배송비, 추가 지원 금액, 판매자 부담 쿠폰, 취소 금액,
       기 정산액, 기 정산 수수료, 수수료율 %, 수수료, 특별 수수료, 정산금액
     - 행수(주문건수) = G열 [합배송 ID] 고유값  ← 사용자 지정(2026-06-12)
     - 낱개수량 = J열 [수량](주문수량) × 매핑 입수
     - 순매출 = M열 [상품 구매액] − P열 [판매자 부담 쿠폰]
  B) 정산 예정 매출 내역 (구양식) — 합배송 아이디 / 상품 구매금액 /
       판매자 부담 쿠폰할인금 / 주문 성사 시점 기반.
"""
from __future__ import annotations
from collections import defaultdict
from typing import Iterable

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import read_excel_safe, to_datetime, to_date, to_float, to_str


@register("올웨이즈")
def parse(path: str) -> Iterable[ParsedLine]:
    df = read_excel_safe(path, header=0)
    cols = set(str(c) for c in df.columns)
    is_new = "합배송 ID" in cols or "상품 구매액" in cols

    # 행수(주문건수) = 합배송 ID 고유값 기준 → order_no를 합배송 ID로.
    # 같은 합배송에 복수 상품행이 있어도 낱개 SUM이 유지되도록 line_no에 시퀀스 부여.
    _seq: dict = defaultdict(int)

    for _, row in df.iterrows():
        if is_new:
            # ── 신양식: 주문건별정산내역 ──
            status = to_str(row.get("주문 상태") or "") or ""
            is_cancel = "취소" in status or "반품" in status

            sale_dt = (
                to_datetime(row.get("결제일자"))
                or to_datetime(row.get("배송 완료 시점"))
                or to_datetime(row.get("구매확정 시점"))
            )
            if not sale_dt:
                continue
            prod = to_str(row.get("상품명"))
            if not prod:
                continue
            gross = to_float(row.get("상품 구매액"))
            seller_coupon = to_float(row.get("판매자 부담 쿠폰"))
            net = gross - seller_coupon
            refund = to_float(row.get("취소 금액"))
            order_no = to_str(row.get("합배송 ID") or row.get("주문번호"))
            opt = to_str(row.get("옵션"))
            commission = to_float(row.get("수수료")) + to_float(row.get("특별 수수료"))
        else:
            # ── 구양식: 정산 예정 매출 내역 ──
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
            refund = net
            order_no = to_str(row.get("합배송 아이디") or row.get("합배송아이디") or row.get("주문아이디"))
            opt = to_str(row.get("옵션"))
            commission = to_float(row.get("수수료") or row.get("특별 수수료(기타 매출)"))

        _seq[order_no or ""] += 1
        line_no = f"{_seq[order_no or '']}"
        yield ParsedLine(
            sale_date=sale_dt.date(),
            sale_datetime=sale_dt,
            order_no=order_no,
            line_no=line_no,
            raw_product_name=prod,
            raw_option_name=opt,
            raw_qty=to_float(row.get("수량") or 1),
            gross_amount=0 if is_cancel else gross,
            net_amount=0 if is_cancel else net,
            refund_amount=refund if is_cancel else 0,
            commission=0 if is_cancel else commission,
            is_cancelled=is_cancel,
        )
