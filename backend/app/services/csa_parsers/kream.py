"""크림(KREAM) 파서."""
from __future__ import annotations
import re
from typing import Iterable

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import read_excel_safe, to_datetime, to_float, to_str


# 상품명(한글) substring → 낱개 입수. 박스 없는 단품 위주(박스형은 옵션에서 직접 산출).
# (폼 2026-07-26 김재경/MD 요청: 낱개 세트환산, 6월 정답 418)
_KREAM_NAME_MAP = [
    ("네모 바게트 10개", 10),
    ("에너지드링크 24캔", 24),
    ("24캔", 24),
    ("베이글 7개", 7),
    ("포카치아 8개", 8),
    ("상온 쫀득 쿠키 6개", 6),
    ("쫀득 쿠키 6개", 6),
    ("휘낭시에 8개", 8),
    ("르뱅 쿠키 6개", 6),      # 옵션에 박스 없을 때 기본 6
    ("아메리칸 쿠키 6개", 6),
]


_BOX_RE = re.compile(r"(\d+)\s*(?:개|구|봉|캔)\s*(\d+)\s*박스")


def _kream_units(prod: str, opt: str) -> int:
    """낱개 입수 = ① 주문옵션의 'N구/개 M박스'(복수면 합산) → ΣN×M, ② 없으면 상품명 매핑, ③ 기본 1.

    예) '사랑 8구 1박스+감동 8구 1박스' → 8+8=16, '6개 2박스' → 12, '감동 8구 1박스' → 8.
    """
    o = opt or ""
    boxes = _BOX_RE.findall(o)
    if boxes:
        return sum(int(n) * int(m) for n, m in boxes)
    p = prod or ""
    for key, u in _KREAM_NAME_MAP:
        if key in p:
            return u
    boxes_p = _BOX_RE.findall(p)
    if boxes_p:
        return sum(int(n) * int(m) for n, m in boxes_p)
    m3 = re.search(r"(\d+)\s*(?:개|구|봉|캔)\b", p)
    if m3:
        return int(m3.group(1))
    return 1


@register("크림")
@register("KREAM")
def parse(path: str) -> Iterable[ParsedLine]:
    df = read_excel_safe(path, header=0)
    for _, row in df.iterrows():
        sale_dt = (
            to_datetime(row.get("결제 일시"))
            or to_datetime(row.get("결제일시"))
            or to_datetime(row.get("주문 일시"))
        )
        if not sale_dt:
            continue
        prod = to_str(row.get("한글 상품명") or row.get("영문 상품명"))
        if not prod:
            continue

        # 주문 상태 '취소' — is_cancelled로 표시
        status = to_str(row.get("주문 상태") or "") or ""
        is_cancel = "취소" in status

        # 매출 = 상품 주문 금액(K) − 할인쿠폰 사용(L)
        order_amt = to_float(row.get("상품 주문 금액") or row.get("결제 금액"))
        coupon = to_float(row.get("할인쿠폰 사용") or row.get("할인 쿠폰 사용") or 0)
        net = order_amt - coupon
        opt = to_str(row.get("주문 옵션"))
        yield ParsedLine(
            sale_date=sale_dt.date(),
            sale_datetime=sale_dt,
            order_no=to_str(row.get("주문 번호")),
            line_no=to_str(row.get("상품 번호")),
            raw_product_name=prod,
            raw_option_name=opt,
            raw_qty=to_float(row.get("주문 수량") or 1),
            unit_per_set=_kream_units(prod, opt),  # 낱개 입수 직접 지정(세트환산)
            gross_amount=0 if is_cancel else order_amt,
            net_amount=0 if is_cancel else net,
            refund_amount=net if is_cancel else 0,
            is_cancelled=is_cancel,
        )
