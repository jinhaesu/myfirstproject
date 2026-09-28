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

낱개수량(2026-07 기준변경요청서, 임현정):
  낱개 = 상품명[E열] 규칙기반 입수(N) × 주문수량[P열].
  N 추출 우선순위(상품명 텍스트, 순차 적용·먼저 매칭되면 확정):
    1순위 '총 N구/개/봉/병/개입' (복수 매칭 시 최댓값)
    2순위 'N+N' 합산 (예: 4+4구, 12+12병, 4구+4구)
    3순위 'N종 2세트' / 'N종 2BOX' → N × 2
    4순위 'N구/개/봉/병/개입' (숫자 여러 개면 최댓값)
    5순위 'N종' → N
    6순위 단품(위 모두 불일치) → 기본값 1
  ※ 과거 양식(AZ열 '세부옵션데이터')의 입수 파싱은 폐기 — 상품명 규칙으로 일원화(구버전 파일도 상품명 컬럼은 항상 존재하므로 하위호환 유지).
    옵션 설명(raw_option_name 매핑용)은 세부옵션데이터가 있으면 계속 그 값을 사용.
  6월 샘플 검증: 낱개 합 15,289 vs 담당자 정답 14,849 (+2.96%, 표본이 5/22~6/30 정산확인 스냅샷이라 전월 경계 밖 오차 가능성 있음).

환불(기준변경요청서 #47, 2026-07-28 임현정 → 2026-09 반영):
  ESM 원본의 환불은 원 주문행(양수)과 별개인 '음수행'(주문수량<0, X열<0, 환불일 기재).
  순매출 = X열 '전체 합산'(양수+음수) ÷1.1, 낱개 = N × P열 '전체 합산' → 상태 필터 없이 상계.
  · 환불행 판정: 주문수량<0 또는 X열<0 (환불일 유무가 아님 — 이전엔 환불일 행을
    is_cancelled(매출 0)로 적재해 원 주문 양수행만 남고 환불이 차감되지 않았음).
  · 환불행 일자 = 환불일(없으면 입금확인일). 원본 파일이 환불일 기준으로 음수행을 담으므로
    6월 결제·7월 환불 건은 7월에 차감(마감월 소급 변경 방지).
  · 환불행 order_no=None — 환불이 채널 주문건수(COUNT DISTINCT order_no)에 더해지지 않게.
    대신 line_no='R|주문번호|원 line_no|환불일YYYYMMDD'로 dedup 고유성·재업로드 결정성 유지.
  7/1~7/27 검증: X 합 35,142,970(÷1.1 31,948,155) / 낱개 26,259 — 담당자 정답과 일치.
"""
from __future__ import annotations

import re
from typing import Iterable, Optional

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import (
    read_excel_safe, to_datetime, to_date, to_float, to_str,
    parse_esm_option_detail,
)

_TOTAL_RE = re.compile(r"총\s*(\d+)\s*(?:개입|구|봉|병|개)")
_PLUS_RE = re.compile(r"(\d+)\s*(?:개입|구|봉|병|개)?\s*\+\s*(\d+)\s*(?:개입|구|봉|병|개)")
_SET2_RE = re.compile(r"(\d+)\s*종\s*2\s*(?:세트|box)", re.I)
_UNIT_RE = re.compile(r"(\d+)\s*(?:개입|구|봉|병|개)")
_JONG_RE = re.compile(r"(\d+)\s*종")


def _gmarket_ups(name: Optional[str]) -> float:
    """상품명 텍스트에서 6단계 우선순위로 낱개 입수(N)를 추출한다."""
    if not name:
        return 1.0
    t = name
    # 1순위: '총 N구/개/봉/병/개입' (복수 매칭 시 최댓값 — 더 세분화된 개별 단위 우선)
    totals = [int(x) for x in _TOTAL_RE.findall(t)]
    if totals:
        return float(max(totals))
    # 2순위: 'N+N' 합산 (4+4구, 12+12병, 4구+4구 등)
    m = _PLUS_RE.search(t)
    if m:
        return float(int(m.group(1)) + int(m.group(2)))
    # 3순위: 'N종 2세트' / 'N종 2BOX' → N × 2
    m = _SET2_RE.search(t)
    if m:
        return float(int(m.group(1)) * 2)
    # 4순위: 'N구/개/봉/병/개입' (숫자 여러 개면 최댓값)
    nums = [int(x) for x in _UNIT_RE.findall(t)]
    if nums:
        return float(max(nums))
    # 5순위: 'N종'
    m = _JONG_RE.search(t)
    if m:
        return float(m.group(1))
    # 6순위: 단품 → 기본값 1
    return 1.0


@register("지마켓")
@register("G마켓")
def parse(path: str) -> Iterable[ParsedLine]:
    df = read_excel_safe(path, header=0)
    # 과거 양식(AZ열 '세부옵션데이터') 존재 시 옵션 설명·낱개입수를 그 값에서 추출
    has_opt_detail = "세부옵션데이터" in {str(c).strip() for c in df.columns}
    # 환불행 line_no 동일키 발생 횟수 — dedup_hash 구성요소(키·상품명·수량·금액)까지 '완전 동일'한
    # 환불행이 2건 이상일 때만 '#2..' 접미. 키만 같고 수량·금액이 다른 행은 해시가 이미 달라 접미하지
    # 않는다 → 겹치는 주간 파일끼리 행 순서가 달라도 같은 행은 같은 line_no(재처리 시 이중 차감 방지).
    refund_seen: dict[tuple, int] = {}
    for _, row in df.iterrows():
        # 일자: 입금확인일 기준(파일이 '입금확인' 기준 추출 → 전 행 해당월).
        # 구매결정일/체결일은 매출확정 시점이 익월로 넘어가 당월 조회에서 누락됨.
        sale_d = (
            to_date(row.get("입금확인일"))
            or to_date(row.get("체결일"))
            or to_date(row.get("구매결정일"))
        )

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
        order_no = to_str(row.get("주문번호"))

        # 세부옵션데이터 → 옵션 설명(매핑용, 과거 양식에서만 존재). 낱개입수는 상품명 규칙(_gmarket_ups)으로 일원화.
        opt_name = None
        if has_opt_detail:
            opt_name, _ = parse_esm_option_detail(row.get("세부옵션데이터"))
        ups = _gmarket_ups(prod)

        # 환불행(폼 #47, 2026-09): 주문수량<0 또는 X열<0 → 음수 그대로 적재해 매출·낱개에서 차감.
        # (is_cancelled 아님 — 취소 처리하면 매출 0이라 원 주문 양수행만 남아 환불 미차감)
        # ※ 양수행에 환불일만 찍힌 경우는 2025-01~2026-09 라이브 전 기간 0건(2026-09-28 확인) —
        #   폼 기준(상태 필터 없이 전체 합산)대로 양수행은 모두 매출로 둔다.
        if qty < 0 or net < 0:
            refund_dt = to_datetime(row.get("환불일"))
            refund_d = to_date(row.get("환불일")) or sale_d
            if not refund_d:
                continue
            # 부호 정규화 — 라이브 전 기간 환불행은 수량·금액 모두 음수라 실제 값 변화 없음(방어용)
            r_qty, r_gross, r_net = -abs(qty), -abs(gross), -abs(net)
            # 고유·결정적 line_no: 장바구니번호는 여러 주문번호가 공유하므로 주문번호를 함께 넣는다.
            r_key = f"R|{order_no or ''}|{line_no or ''}|{refund_d.strftime('%Y%m%d')}"
            seen_key = (r_key, prod, r_qty, r_gross)   # dedup_hash와 같은 구성(정규화 값 기준)
            refund_seen[seen_key] = refund_seen.get(seen_key, 0) + 1
            if refund_seen[seen_key] > 1:
                r_key = f"{r_key}#{refund_seen[seen_key]}"
            yield ParsedLine(
                sale_date=refund_d,
                sale_datetime=refund_dt or to_datetime(row.get("체결일")),
                order_no=None,   # 환불이 주문건수에 더해지지 않게(원 주문은 양수행이 이미 셈)
                line_no=r_key,
                raw_product_name=prod,
                raw_option_name=opt_name,
                unit_per_set=ups,
                raw_qty=r_qty,
                gross_amount=r_gross,
                net_amount=r_net,
                commission=commission,
                refund_amount=abs(net or gross),   # 대시보드 취소 지표용(기존 취소행 refund 의미 유지)
                is_cancelled=False,
            )
            continue

        if not sale_d:
            continue
        yield ParsedLine(
            sale_date=sale_d,
            sale_datetime=to_datetime(row.get("체결일")),
            order_no=order_no,
            line_no=line_no,
            raw_product_name=prod,
            raw_option_name=opt_name,
            unit_per_set=ups,
            raw_qty=qty,
            gross_amount=gross,
            net_amount=net or gross,
            commission=commission,
            refund_amount=0,
        )
