"""테무 파서. '구매 날짜'는 '2026년 5월 12일 09:15 KST(UTC+9)' 형식.

낱개수량(2026-07 기준변경요청서, 김재경/MD):
  낱개 = J열[선택 사항] 파싱값 × N열[구매 수량].
  선택 사항은 '+' 로 구분된 각 항목을 전부 합산. 각 항목에서
  "N구/N개/N봉/N캔" 을 찾고 "M박스"가 있으면 N×M (없으면 M=1).
  예외: 개수 없이 박스만 있는 쿠키 2종(르뱅/아메리칸, I열[제품 이름]으로 판별)은
  6개(고정) × 박스수. 패턴 미매칭 시 unit_per_set=None(미파싱, 매핑값으로 폴백).
  6월 샘플 검증: 낱개 9,113 = 담당자 정답 9,113 (정확 일치).
"""
from __future__ import annotations
import re
from datetime import datetime
from typing import Iterable, Optional

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import read_excel_safe, to_datetime, to_float, to_str


def _parse_korean_date(v) -> Optional[datetime]:
    if v is None:
        return None
    s = str(v)
    m = re.search(r"(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일(?:\s+(\d{1,2}):(\d{1,2}))?", s)
    if not m:
        return None
    y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
    hh = int(m.group(4)) if m.group(4) else 0
    mm = int(m.group(5)) if m.group(5) else 0
    try:
        return datetime(y, mo, d, hh, mm)
    except Exception:
        return None


# 선택 사항[J열] 낱개 파싱 — "N구/N개/N봉/N캔" (+ "M박스"가 있으면 ×M)
_UNIT_CNT = re.compile(r"(\d+)\s*(?:구|개|봉|캔)")
_BOX_CNT = re.compile(r"(\d+)\s*박스")
# 예외: 선택 사항에 개수 없이 박스만 있는 쿠키 2종 → 6개(고정) × 박스수
_COOKIE_EXCEPTION_UNIT = 6.0


def _is_cookie_exception(product_name: Optional[str]) -> bool:
    if not product_name:
        return False
    return ("르뱅 쿠키" in product_name) or ("아메리칸 쿠키" in product_name)


def _parse_option_units(option_text: Optional[str], product_name: Optional[str]) -> Optional[float]:
    """선택 사항[J열] → 낱개수량(입수). '+' 구분 항목 전부 합산. 실패 시 None(미파싱)."""
    if not option_text:
        return None
    total = 0.0
    matched_any = False
    for seg in option_text.split("+"):
        seg = seg.strip()
        if not seg:
            continue
        cnt_m = _UNIT_CNT.search(seg)
        if cnt_m:
            n = int(cnt_m.group(1))
            box_m = _BOX_CNT.search(seg)
            m = int(box_m.group(1)) if box_m else 1
            total += n * m
            matched_any = True
            continue
        # 개수 토큰이 없고 박스만 있는 경우: 쿠키 2종 예외만 허용
        box_m = _BOX_CNT.search(seg)
        if box_m and _is_cookie_exception(product_name):
            total += _COOKIE_EXCEPTION_UNIT * int(box_m.group(1))
            matched_any = True
            continue
        # 패턴 미매칭 항목이 하나라도 있으면 라인 전체 미파싱 처리
        return None
    return total if matched_any else None


@register("테무")
@register("Temu")
def parse(path: str) -> Iterable[ParsedLine]:
    df = read_excel_safe(path, header=0)
    for _, row in df.iterrows():
        sale_dt = (
            _parse_korean_date(row.get("구매 날짜"))
            or to_datetime(row.get("구매 날짜"))
            or to_datetime(row.get("결제 시간"))
            or to_datetime(row.get("주문 시간"))
            or to_datetime(row.get("주문일시"))
        )
        if not sale_dt:
            continue
        prod = to_str(row.get("제품 이름") or row.get("고객 주문별 제품 이름") or row.get("상품명"))
        if not prod:
            continue

        # 주문 상태 '취소됨' — 매출/수량에서 제외(is_cancelled로 표시)
        status = to_str(row.get("주문 상태") or row.get("주문 상품 상태") or "") or ""
        is_cancel = "취소" in status

        # 매출(net) = 할인 후 기본 가격 총액 (AO). to_float가 '원'·콤마 제거.
        # is_vat_included(csa_service)가 VAT_INCLUDED_CHANNELS 소속 채널에 대해 ÷1.1 적용.
        net = to_float(
            row.get("할인 후 기본 가격 총액") or row.get("기본 가격 총액")
            or row.get("주문 금액")
        )
        gross = to_float(
            row.get("기본 가격 총액") or row.get("할인 후 기본 가격 총액")
            or row.get("주문 금액") or row.get("상품 기본 가격")
        )
        opt = to_str(row.get("선택 사항"))
        # 낱개(입수) = 선택 사항 파싱값. 구버전 원본(컬럼 없음)이나 패턴 미매칭 시
        # None → csa_service에서 ChannelProductMapping.unit_per_set으로 자동 폴백.
        unit_per_set = _parse_option_units(opt, prod)
        yield ParsedLine(
            sale_date=sale_dt.date(),
            sale_datetime=sale_dt,
            order_no=to_str(row.get("주문 ID") or row.get("주문 상품 ID")),
            line_no=to_str(row.get("SKU ID") or row.get("제공 sku")),
            raw_product_name=prod,
            raw_option_name=opt,
            raw_qty=to_float(row.get("구매 수량") or row.get("수량") or 1),
            gross_amount=0 if is_cancel else gross,
            net_amount=0 if is_cancel else net,
            refund_amount=net if is_cancel else 0,
            is_cancelled=is_cancel,
            unit_per_set=unit_per_set,
        )
