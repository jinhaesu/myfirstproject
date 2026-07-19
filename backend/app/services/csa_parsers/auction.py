"""옥션 (이베이) 파서.

낱개수량(입수) 산식(2026-07 기준변경요청서, 임현정):
  E열[상품명] 텍스트에 정규식 우선순위를 순차 적용해 세트 입수(N)를 추출.
  최종 낱개수량 = N × Q열[주문수량] (Q열 곱은 csa_service의 unit_per_set × raw_qty 공식으로 처리).
    1순위: '총 N구/개/봉/병/개입'                     → N
    2순위: 'N+N' (4+4구·4구+4구·12+12병 등)            → N+N 합산
    3순위: 'N종 2세트' / 'N종 2BOX'                    → N × 2
    4순위: 'N구/개/봉/병/개입' (여러 개면 최댓값)         → N
    5순위: 'N종'                                       → N
    6순위: 위 미해당(단품)                              → 1
  구버전(AZ열 '세부옵션데이터') 보유 원본도 상품명은 항상 존재하므로 동일 규칙 적용.
  세부옵션데이터는 옵션 설명(raw_option_name, 매핑 참고용)에만 계속 사용.
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

_UNIT_SUFFIX = r"(?:개입|구|봉|병|개)"
_RE_TOTAL = re.compile(rf"총\s*(\d+){_UNIT_SUFFIX}")
_RE_PLUS = re.compile(rf"(\d+){_UNIT_SUFFIX}?\s*\+\s*(\d+){_UNIT_SUFFIX}")
_RE_KIND_2SET = re.compile(r"(\d+)\s*종\s*2\s*(?:세트|셋트|box|박스)", re.I)
_RE_UNIT = re.compile(rf"(\d+){_UNIT_SUFFIX}")
_RE_KIND = re.compile(r"(\d+)\s*종")


def _extract_set_count(name: Optional[str]) -> float:
    """상품명에서 세트 입수(N) 추출 — 6순위 우선순위(임현정 요청서 참조)."""
    if not name:
        return 1.0
    t = name.strip()
    m = _RE_TOTAL.search(t)
    if m:
        return float(m.group(1))
    m = _RE_PLUS.search(t)
    if m:
        return float(int(m.group(1)) + int(m.group(2)))
    m = _RE_KIND_2SET.search(t)
    if m:
        return float(int(m.group(1)) * 2)
    nums = [int(n) for n in _RE_UNIT.findall(t)]
    if nums:
        return float(max(nums))
    m = _RE_KIND.search(t)
    if m:
        return float(m.group(1))
    return 1.0


@register("옥션")
@register("이베이")
def parse(path: str) -> Iterable[ParsedLine]:
    df = read_excel_safe(path, header=0)
    # 과거 양식(AZ열 '세부옵션데이터') 존재 시 옵션 설명(매핑 참고용)만 그 값에서 추출.
    # 낱개입수는 상품명 정규식(위 _extract_set_count)으로 통일 산출.
    has_opt_detail = "세부옵션데이터" in {str(c).strip() for c in df.columns}
    for _, row in df.iterrows():
        # 일자: 입금확인일 기준(파일이 '입금확인' 기준 추출 → 전 행 해당월).
        # 매출기준일/구매결정일은 익월로 넘어가 당월 조회에서 누락됨.
        sale_d = (
            to_date(row.get("입금확인일"))
            or to_date(row.get("주문일"))
            or to_date(row.get("매출기준일"))
        )
        if not sale_d:
            continue
        prod = to_str(row.get("상품명"))
        if not prod:
            continue
        # 취소/환불: '환불일'이 있으면 환불 확정 건 → is_cancelled(매출 제외·건수 집계).
        is_cancel = to_date(row.get("환불일")) is not None
        qty = to_float(row.get("주문수량") or row.get("수량") or 1)
        # 매출(net) = W열 결제금액  ← 사용자 지정(2026-06-05)
        net = to_float(row.get("결제금액") or row.get("판매금액"))
        gross = to_float(row.get("판매금액") or row.get("결제금액"))
        # 세부옵션데이터(구버전) → 옵션 설명(매핑 참고용)만 채택.
        # 낱개입수(unit_per_set)는 상품명 정규식으로 통일 산출(2026-07 기준변경, 임현정).
        opt_name = None
        if has_opt_detail:
            opt_name, _legacy_ups = parse_esm_option_detail(row.get("세부옵션데이터"))
        ups = _extract_set_count(prod)
        yield ParsedLine(
            sale_date=sale_d,
            sale_datetime=to_datetime(row.get("주문일")),
            order_no=to_str(row.get("주문번호")),
            line_no=to_str(row.get("상품번호")),
            raw_product_name=prod,
            raw_option_name=opt_name,
            unit_per_set=ups,
            raw_qty=qty,
            gross_amount=0 if is_cancel else gross,
            net_amount=0 if is_cancel else net,
            commission=0 if is_cancel else to_float(row.get("판매수수료")),
            refund_amount=abs(net or gross) if is_cancel else 0,
            is_cancelled=is_cancel,
        )
