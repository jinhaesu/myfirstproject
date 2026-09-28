"""알리익스프레스 파서.

2026-07-28 기준 변경 요청(폼 #49, 임현정 — 적용 시작일 2025-01-01) 반영:
  - 집계 기준 일자: E열[주문시간] (결제 시간 아님). 주문시간 컬럼 자체가 없는 이형 포맷에서만
    결제 시간으로 폴백. 폼 #17(07-14)의 '결제 시간 공란 행 스킵'은 폐지 — 폼 #49 정답이
    '결제 대기' 행까지 포함한 값이다.
  - 취소 판별: B열[주문 상태]가 '주문 종료' 또는 '주문 동결'이면 취소 행
    (is_cancelled=True, refund_amount=M열 주문금액 → 매출·낱개 미반영, 건수·금액만 보존).
  - 순매출 = M열[주문 금액] (÷1.1은 VAT_INCLUDED_CHANNELS 공통 로직에서 ingest 시 처리 — 파서에서 중복 적용 금지)
  - 낱개수량 = T열[제품 정보] 텍스트에서 '(수량:N piece)'의 N × 세트입수(정규식 6순위,
    아래 _ali_set_size 참조 — 2순위는 폼 #49로 '+' 연쇄 합산 확장). 【1】【2】... 형태의
    합주문(한 행에 여러 상품)은 상품 블록별로 각각 계산해 합산한다.
"""
from __future__ import annotations
import re
from typing import Iterable, Optional

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import read_excel_safe, to_datetime, to_float, to_str

# ──────────────────────────────────────────────────────────────
# 낱개수량(입수) 파싱 — 폼3차 요청서(알리익스프레스, 2026-07-14) 규칙
#   + 2순위 '+' 연쇄 합산 확장(폼 #49, 2026-07-28)
# ──────────────────────────────────────────────────────────────

_SEG_SPLIT_RE = re.compile(r"【\d+】")
_BASE_QTY_RE = re.compile(r"수량\s*[:：]\s*(\d+)\s*piece", re.IGNORECASE)

_UNIT = r"(?:개입|구|개|봉|병)"
# 1순위: '총 N구/N개/N봉/N병/N개입'
_P1_RE = re.compile(rf"총\s*(\d+)\s*{_UNIT}")
# 2순위: '+' 연쇄 전체 합산 (폼 #49, 2026-07-28 확장).
#   예) '뚱카롱8구+시즈널 마카롱8구+뚱낭시에8개' → 24, '슬랩 600g 2개+베이글 1개 증정' → 3,
#       '4구+4구' → 8, '12+12병' → 24.
#   - '+' 뒤 항목은 반드시 단위(구/개/봉/병/개입)로 끝나야 한다(구 규칙과 동일 — '1+1' 행사표기,
#     '4+3, 7개'처럼 단위 없는 끝수는 연쇄로 보지 않고 4순위로 넘김). '+'와 숫자 사이의
#     상품명 텍스트(시즈널 마카롱 등)는 허용.
#   - 제목부('(속성'/'(수량' 앞)에서만 찾고, 제목 안 괄호 속 구성 표기는 합산하지 않는다
#     (예: '두바이 쫀득 뚱카롱 8구 1BOX(초코4구+피스타치오4구)' → 괄호 제외 → 4순위 8).
_P2_CHAIN_RE = re.compile(rf"(\d+)\s*{_UNIT}?(?:\s*\+\s*[^\d+(),（）]*?\d+\s*{_UNIT})+")
_TITLE_CUT_RE = re.compile(r"[(（]\s*(?:속성|수량)")
_PAREN_RE = re.compile(r"[(（][^()（）]*[)）]")
# 3순위: 'N종 2세트' / 'N종 2BOX'
_P3_RE = re.compile(r"(\d+)\s*종\s*2\s*(?:세트|box)", re.IGNORECASE)
# 4순위: 'N구/N개/N봉/N병/N개입' — 가장 큰 숫자
_P4_RE = re.compile(rf"(\d+)\s*{_UNIT}")
# 5순위: 'N종'
_P5_RE = re.compile(r"(\d+)\s*종")


def _ali_title(segment: str) -> str:
    """상품 블록에서 제목부만 추출 — '(속성…'/'(수량…' 앞, 괄호(중첩 포함) 내용 제거."""
    m = _TITLE_CUT_RE.search(segment)
    title = segment[:m.start()] if m else segment
    prev = None
    while prev != title:
        prev, title = title, _PAREN_RE.sub(" ", title)
    return title


def _ali_set_size(segment: str) -> int:
    """정규식 1~6순위 조건문을 순차 적용해 상품별 총 입수를 반환."""
    m = _P1_RE.search(segment)
    if m:
        return int(m.group(1))
    m = _P2_CHAIN_RE.search(_ali_title(segment))
    if m:
        # 연쇄 사이 텍스트엔 숫자가 없으므로(정규식상) 매치 안의 숫자 = 각 구성 수량
        return sum(int(x) for x in re.findall(r"\d+", m.group(0)))
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


# 폼 #49(2026-07-28): 주문 상태가 이 값이면 취소 행 — 공백 차이('주문종료')도 허용
_CANCEL_STATUSES = {"주문종료", "주문동결"}


def _first_col(columns, *names: str) -> Optional[str]:
    """후보 컬럼명 중 파일에 실제로 있는 첫 컬럼명."""
    for n in names:
        if n in columns:
            return n
    return None


@register("알리익스프레스")
@register("AliExpress")
def parse(path: str) -> Iterable[ParsedLine]:
    df = read_excel_safe(path, header=0)
    cols = set(df.columns)
    # 폼 #49(2026-07-28): 기준 일자 = 주문시간. 주문시간 컬럼이 없는 이형 포맷에서만 결제 시간 폴백.
    # (폼 #17의 '결제 시간 공란 스킵'은 폐지 — 결제 대기 행도 정답에 포함)
    date_col = _first_col(cols, "주문시간", "주문 시간") or _first_col(cols, "결제 시간", "결제시간")
    status_col = _first_col(cols, "주문 상태", "주문상태")
    # M열 주문금액(할인 적용 후) — 순매출·취소금액 공통 기준
    amt_col = _first_col(cols, "주문 금액", "주문금액", "총 금액", "공급 가격")
    for _, row in df.iterrows():
        sale_dt = to_datetime(row.get(date_col)) if date_col else None
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
        amount = to_float(row.get(amt_col)) if amt_col else 0.0
        status = (to_str(row.get(status_col)) or "") if status_col else ""
        is_cancel = status.replace(" ", "") in _CANCEL_STATUSES
        yield ParsedLine(
            sale_date=sale_dt.date(),
            sale_datetime=sale_dt,
            order_no=to_str(row.get("주문 ID")),
            line_no=to_str(row.get("상품 ID") or row.get("제품 코드") or row.get("EAN코드")),
            raw_product_name=prod,
            raw_option_name=to_str(row.get("선택 사항") or row.get("옵션")),
            raw_qty=raw_qty,
            unit_per_set=unit_per_set,
            # gross도 M열 주문금액으로 통일(구: I열 총 금액) — 2026-09-28 폼 #49 반영 시.
            # dedup 해시 금액이 유효행(gross)·취소행(refund)에서 같아야, 주간 스냅샷 사이에
            # 결제대기/배송 → 주문 종료로 바뀐 같은 주문이 최신 파일 우선 재처리
            # (_REPROCESS_NEWEST_FIRST_CHANNELS)에서 중복으로 걸러져 최신 상태만 남는다.
            # (대시보드 매출은 net 기준이라 금액 영향 없음)
            gross_amount=amount,
            # 매출(net) = M열 주문금액. ÷1.1은 VAT_INCLUDED_CHANNELS 공통 로직(ingest_lines)에서
            # 처리되므로 파서에서는 원본 금액만 넘긴다(이중 환산 금지).
            net_amount=amount,
            shipping_fee=to_float(row.get("배송비")),
            # 폼 #49: 주문 종료·주문 동결 → 취소(매출 제외), 취소금액 = M열 주문금액
            refund_amount=amount if is_cancel else 0,
            is_cancelled=is_cancel,
        )
