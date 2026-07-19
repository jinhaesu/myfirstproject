"""알리익스프레스 파서.

2026-07-14 기준 변경 요청(임현정) 반영:
  - 매출 유효성: F열[결제 시간]이 비어있지 않은 행만 유효(미결제 허수 주문 제외).
    (결제 시간 컬럼이 있는 최신 포맷에서는 값이 없는 행을 스킵 — 값 존재 여부로만 판단,
     '주문시간'으로 폴백하지 않는다. 컬럼 자체가 없는 구버전 포맷에서만 주문시간으로 폴백.)
  - 순매출 = M열[주문 금액] (÷1.1은 VAT_INCLUDED_CHANNELS 공통 로직에서 ingest 시 처리 — 파서에서 중복 적용 금지)
  - 낱개수량 = T열[제품 정보] 텍스트에서 '(수량:N piece)'의 N × 세트입수(정규식 6순위,
    아래 _ali_pcs_from_text 참조). 【1】【2】... 형태의 합주문(한 행에 여러 상품)은
    상품 블록별로 각각 계산해 합산한다.
"""
from __future__ import annotations
import re
from typing import Iterable, Optional

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import read_excel_safe, to_datetime, to_float, to_str

# ──────────────────────────────────────────────────────────────
# 낱개수량(입수) 파싱 — 폼3차 요청서(알리익스프레스, 2026-07-14) 규칙
# ──────────────────────────────────────────────────────────────

_SEG_SPLIT_RE = re.compile(r"【\d+】")
_BASE_QTY_RE = re.compile(r"수량\s*[:：]\s*(\d+)\s*piece", re.IGNORECASE)

_UNIT = r"(?:개입|구|개|봉|병)"
# 1순위: '총 N구/N개/N봉/N병/N개입'
_P1_RE = re.compile(rf"총\s*(\d+)\s*{_UNIT}")
# 2순위: 'N+N' (예: 4+4구, 12+12병, 4구+4구 등 — 앞 숫자 단위는 선택, 인접한 경우)
_P2_RE = re.compile(rf"(\d+)\s*{_UNIT}?\s*\+\s*(\d+)\s*{_UNIT}")
# 3순위: 'N종 2세트' / 'N종 2BOX'
_P3_RE = re.compile(r"(\d+)\s*종\s*2\s*(?:세트|box)", re.IGNORECASE)
# 4순위: 'N구/N개/N봉/N병/N개입' — 가장 큰 숫자
_P4_RE = re.compile(rf"(\d+)\s*{_UNIT}")
# 5순위: 'N종'
_P5_RE = re.compile(r"(\d+)\s*종")

def _ali_set_size(segment: str) -> int:
    """정규식 1~6순위 조건문을 순차 적용해 상품별 총 입수를 반환."""
    m = _P1_RE.search(segment)
    if m:
        return int(m.group(1))
    m = _P2_RE.search(segment)
    if m:
        return int(m.group(1)) + int(m.group(2))
    m = _P3_RE.search(segment)
    if m:
        return int(m.group(1)) * 2
    matches = _P4_RE.findall(segment)
    if matches:
        return max(int(x) for x in matches)
    m = _P5_RE.search(segment)
    if m:
        return int(m.group(1))
    return 1


def _ali_pcs_from_text(text: Optional[str]) -> Optional[float]:
    """T열[제품 정보] 텍스트 → 낱개수량(총 pcs).

    【1】【2】... 로 구분된 상품 블록별로 '(수량:N piece)'의 N × 세트입수를
    각각 계산해 합산한다(합주문 1행에 여러 상품이 실리는 경우 대비).
    '수량:N piece' 패턴을 하나도 못 찾으면(구버전/이형 포맷) None을 반환해
    호출부가 기존 로직(매핑값 기반)으로 폴백하게 한다.
    """
    if not text:
        return None
    segments = [s for s in _SEG_SPLIT_RE.split(text) if s.strip()]
    if not segments:
        segments = [text]
    total = 0.0
    found_any = False
    for seg in segments:
        qm = _BASE_QTY_RE.search(seg)
        if not qm:
            continue
        found_any = True
        base = int(qm.group(1))
        total += base * _ali_set_size(seg)
    if not found_any:
        return None
    return total


@register("알리익스프레스")
@register("AliExpress")
def parse(path: str) -> Iterable[ParsedLine]:
    df = read_excel_safe(path, header=0)
    # 결제 시간 컬럼이 존재하는 최신 포맷은 값이 없는 행을 폴백 없이 스킵(미결제 허수 제외).
    # 컬럼 자체가 없는 구버전 포맷에서만 주문시간으로 폴백(하위호환).
    has_payment_col = any(c in df.columns for c in ("결제 시간", "결제시간"))
    for _, row in df.iterrows():
        if has_payment_col:
            sale_dt = to_datetime(row.get("결제 시간") if "결제 시간" in df.columns else row.get("결제시간"))
        else:
            sale_dt = to_datetime(row.get("주문시간") or row.get("주문 시간"))
        if not sale_dt:
            continue
        prod = to_str(row.get("제품 정보") or row.get("제품 이름") or row.get("상품명"))
        if not prod:
            continue
        pcs = _ali_pcs_from_text(prod)
        if pcs is not None:
            raw_qty = 1.0
            unit_per_set: Optional[float] = pcs
        else:
            # 구버전/이형 포맷 폴백 — 기존 로직 그대로.
            raw_qty = to_float(row.get("수량") or 1)
            unit_per_set = None
        yield ParsedLine(
            sale_date=sale_dt.date(),
            sale_datetime=sale_dt,
            order_no=to_str(row.get("주문 ID")),
            line_no=to_str(row.get("상품 ID") or row.get("제품 코드") or row.get("EAN코드")),
            raw_product_name=prod,
            raw_option_name=to_str(row.get("선택 사항") or row.get("옵션")),
            raw_qty=raw_qty,
            unit_per_set=unit_per_set,
            gross_amount=to_float(row.get("총 금액") or row.get("주문 금액") or row.get("주문금액") or row.get("공급 가격")),
            # 매출(net) = M열 주문금액. ÷1.1은 VAT_INCLUDED_CHANNELS 공통 로직(ingest_lines)에서
            # 처리되므로 파서에서는 원본 금액만 넘긴다(이중 환산 금지).
            net_amount=to_float(row.get("주문 금액") or row.get("주문금액") or row.get("총 금액")),
            shipping_fee=to_float(row.get("배송비")),
        )
