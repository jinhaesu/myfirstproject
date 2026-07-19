"""카카오스타일 (지그재그) 파서.  (기준변경 반영 2026-07-19, 김재경 MD 요청)

- 매출 = U열[상품주문액 (원)] 라인 총액('18,900' 콤마 문자열 → 숫자 정제).
  T열[수량]을 다시 곱하지 않는다(이미 라인 총액). 쿠폰·마일리지 할인(V/W열)은
  플랫폼 부담분이라 차감하지 않는다. VAT 포함 채널(카카오스타일)이라
  ingest 시점에 시스템이 자동 ÷1.1 처리(csa_service.VAT_INCLUDED_CHANNELS).
- 취소·반품·교환 판별(해당하면 is_cancelled=True → 매출·낱개·행수 제외):
    · F열[주문상태] = '미입금취소'
    · I열[클레임상태] ∈ {취소완료, 구매확정 후 취소, 반품완료, 교환검수완료}
  (반품완료·교환검수완료도 제외 — 기존엔 매출에 포함하고 있었음)
- 행수(주문건수) dedup 키 = C열[주문번호] (order_no). B열[상품주문번호]는
  라인 식별자(line_no)일 뿐 dedup 키가 아님 — 한 주문에 여러 상품주문번호가
  붙어 행이 나뉘므로 기존(상품주문번호 기준) 대비 주문건수가 줄어드는 게 정상.
- 낱개수량 = P열[옵션정보] '/' 구분 각 항목에서 "N개입/N개/N봉/N구/N캔"을
  추출해 합산, 같은 항목에 "M세트/M박스/MBOX"가 붙으면 곱함. '미선택'은 0.
  통밀식빵 '2+1set(4개입*3세트)' 계열은 12 고정(상품명에 '통밀' 포함 시).
  숫자를 전혀 못 찾은 비공백 옵션은 '미파싱'(unit_per_set=None)으로 두어
  csa_service가 상품 매핑값으로 폴백하게 한다.
- 구버전 보관 원본 하위호환: U열[상품주문액 (원)]이 없는 파일은 기존 로직
  (S/T열 상품가격×수량, 상품주문번호 dedup)으로 폴백해 0행/예외를 방지한다.
"""
from __future__ import annotations

import re
from typing import Iterable, Optional

import pandas as pd

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import read_excel_safe, to_datetime, to_float, to_str


def _id_str(v) -> Optional[str]:
    """상품주문번호/주문번호가 float(1.85e+17)로 읽히는 경우 정수 문자열로 정규화."""
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return None
    if isinstance(v, float):
        return f"{int(v)}"
    return to_str(v)


# 클레임상태 — 아래 값이면 취소·반품·교환 확정으로 보고 제외 (재경 기준, 2026-07-19)
_CANCEL_CLAIMS = {"취소완료", "구매확정 후 취소", "반품완료", "교환검수완료"}

_CNT_RE = re.compile(r"(\d+)\s*(?:개입|개|봉|구|캔)")
_SET_RE = re.compile(r"(\d+)\s*(?:세트|박스|box)", re.I)
_TONGMIL_RE = re.compile(r"\d+\s*\+\s*\d+\s*set", re.I)
# '(총 N개)'류 명시적 합계 표기 — 있으면 구성 요소별 곱셈보다 우선(예:
# '네모바게트 5종 1개씩+베이글 7종 1개씩(총 12개)' → 12, 5*1 아님).
_TOTAL_RE = re.compile(r"총\s*(\d+)\s*(?:개입|구|봉|캔|개|입)")


def _part_val(text: str) -> Optional[float]:
    """옵션정보 '/' 분할 항목 하나: N개입/개/봉/구/캔 (× M세트/박스/BOX)."""
    tm = _TOTAL_RE.search(text)
    if tm:
        v = int(tm.group(1))
        if 1 <= v <= 300:
            return float(v)
    cm = _CNT_RE.search(text)
    if not cm:
        return None
    n = int(cm.group(1))
    if not (1 <= n <= 300):
        return None
    sm = _SET_RE.search(text)
    m = int(sm.group(1)) if sm and 1 <= int(sm.group(1)) <= 50 else 1
    return float(n * m)


def _unit_per_set(opt: Optional[str], prod: Optional[str]) -> Optional[float]:
    """P열[옵션정보] → 낱개(입수). '미선택'=0, 파싱 실패=None(매핑값 폴백)."""
    if not opt:
        return None
    text = opt.strip()
    if not text:
        return None

    # 통밀식빵 '2+1set(4개입*3세트)' 계열 — 상품명에 '통밀' 있으면 12 고정
    if "통밀" in (prod or "") and _TONGMIL_RE.search(text):
        return 12.0

    parts = [p.strip() for p in text.split("/") if p.strip()]
    if not parts:
        return None

    total = 0.0
    any_numeric = False
    all_unselected = True
    for p in parts:
        if p == "미선택":
            continue
        all_unselected = False
        v = _part_val(p)
        if v:
            total += v
            any_numeric = True

    if any_numeric:
        return total
    if all_unselected:
        return 0.0
    return None  # 숫자 못 찾음 — 미파싱


@register("카카오스타일")
def parse(path: str) -> Iterable[ParsedLine]:
    df = read_excel_safe(path, header=0)
    has_line_amount = "상품주문액 (원)" in df.columns

    for _, row in df.iterrows():
        sale_dt = to_datetime(row.get("주문일시"))
        if not sale_dt:
            continue
        prod = to_str(row.get("상품명"))
        if not prod:
            continue

        # 취소·반품·교환·미입금 판별 — 버리지 않고 is_cancelled로 표시
        order_status = to_str(row.get("주문상태")) or ""
        claim = to_str(row.get("클레임상태")) or ""
        is_cancel = ("미입금" in order_status) or (claim.strip() in _CANCEL_CLAIMS)

        qty = to_float(row.get("수량") or 1)
        opt = to_str(row.get("옵션정보"))

        if has_line_amount:
            # 신규 기준: U열[상품주문액 (원)] 라인 총액 그대로 (수량 재곱셈 없음).
            # to_float가 콤마('18,900')·비숫자 문자를 자동 제거.
            amount = to_float(row.get("상품주문액 (원)"))
            order_no = to_str(row.get("주문번호")) or _id_str(row.get("상품주문번호"))
            line_no = _id_str(row.get("상품주문번호")) or to_str(row.get("주문번호"))
        else:
            # 구버전 보관 원본 폴백: 상품가격 × 수량, 상품주문번호 dedup
            unit_price = to_float(
                row.get("상품가격 (원)") or row.get("판매가 (원)")
            )
            amount = unit_price * qty
            order_no = _id_str(row.get("상품주문번호")) or to_str(row.get("주문번호"))
            line_no = _id_str(row.get("주문번호"))

        yield ParsedLine(
            sale_date=sale_dt.date(),
            sale_datetime=sale_dt,
            order_no=order_no,
            line_no=line_no,
            raw_product_name=prod,
            raw_option_name=opt,
            raw_qty=qty,
            gross_amount=0 if is_cancel else amount,
            net_amount=0 if is_cancel else amount,
            refund_amount=amount if is_cancel else 0,
            is_cancelled=is_cancel,
            unit_per_set=_unit_per_set(opt, prod) if has_line_amount else None,
        )
