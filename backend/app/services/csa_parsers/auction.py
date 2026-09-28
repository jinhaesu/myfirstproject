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

환불(기준변경요청서 #48, 2026-07-28 임현정 → 2026-09 반영, 지마켓 #47과 동일 로직·컬럼만 W/Q):
  원본의 환불은 원 주문행(양수)과 별개인 '음수행'(주문수량<0, W열 결제금액<0, 환불일 기재).
  순매출 = W열 '전체 합산' ÷1.1, 낱개 = N × Q열 '전체 합산' → 상태 필터 없이 상계.
  · 환불행 판정: 주문수량<0 또는 W열<0 (이전엔 환불일 행을 is_cancelled(매출 0)로 적재 → 환불 미차감).
  · 환불행 일자 = 환불일(없으면 입금확인일), order_no=None(주문건수 미가산).
  · line_no='R|주문번호|상품번호|환불일YYYYMMDD' — 옥션 line_no(상품번호)는 여러 주문이 공유해
    그대로 쓰면 order_no=None인 환불행끼리 dedup_hash가 충돌하므로 주문번호를 포함.
  7/1~7/27 검증: W 합 3,345,770(÷1.1 3,041,609) / 낱개 2,023 — 담당자 정답과 일치.
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
    # 환불행 line_no 동일키 발생 횟수 — dedup_hash 구성요소(키·상품명·수량·금액)까지 '완전 동일'한
    # 환불행이 2건 이상일 때만 '#2..' 접미. 키만 같고 수량·금액이 다른 행은 해시가 이미 달라 접미하지
    # 않는다 → 겹치는 주간 파일끼리 행 순서가 달라도 같은 행은 같은 line_no(재처리 시 이중 차감 방지).
    refund_seen: dict[tuple, int] = {}
    for _, row in df.iterrows():
        # 일자: 입금확인일 기준(파일이 '입금확인' 기준 추출 → 전 행 해당월).
        # 매출기준일/구매결정일은 익월로 넘어가 당월 조회에서 누락됨.
        sale_d = (
            to_date(row.get("입금확인일"))
            or to_date(row.get("주문일"))
            or to_date(row.get("매출기준일"))
        )
        prod = to_str(row.get("상품명"))
        if not prod:
            continue
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
        order_no = to_str(row.get("주문번호"))
        line_no = to_str(row.get("상품번호"))

        # 환불행(폼 #48, 2026-09): 주문수량<0 또는 W열<0 → 음수 그대로 적재해 매출·낱개에서 차감.
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
            # 상품번호는 비고유 → 주문번호를 넣어 환불행끼리 dedup_hash 충돌 방지
            r_key = f"R|{order_no or ''}|{line_no or ''}|{refund_d.strftime('%Y%m%d')}"
            seen_key = (r_key, prod, r_qty, r_gross)   # dedup_hash와 같은 구성(정규화 값 기준)
            refund_seen[seen_key] = refund_seen.get(seen_key, 0) + 1
            if refund_seen[seen_key] > 1:
                r_key = f"{r_key}#{refund_seen[seen_key]}"
            yield ParsedLine(
                sale_date=refund_d,
                sale_datetime=refund_dt or to_datetime(row.get("주문일")),
                order_no=None,   # 환불이 주문건수에 더해지지 않게(원 주문은 양수행이 이미 셈)
                line_no=r_key,
                raw_product_name=prod,
                raw_option_name=opt_name,
                unit_per_set=ups,
                raw_qty=r_qty,
                gross_amount=r_gross,
                net_amount=r_net,
                commission=to_float(row.get("판매수수료")),
                refund_amount=abs(net or gross),   # 대시보드 취소 지표용(기존 취소행 refund 의미 유지)
                is_cancelled=False,
            )
            continue

        if not sale_d:
            continue
        yield ParsedLine(
            sale_date=sale_d,
            sale_datetime=to_datetime(row.get("주문일")),
            order_no=order_no,
            line_no=line_no,
            raw_product_name=prod,
            raw_option_name=opt_name,
            unit_per_set=ups,
            raw_qty=qty,
            gross_amount=gross,
            net_amount=net,
            commission=to_float(row.get("판매수수료")),
            refund_amount=0,
        )
