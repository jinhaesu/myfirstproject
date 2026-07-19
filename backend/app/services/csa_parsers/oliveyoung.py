"""올리브영 파서.

매출(net) = 원판매금액(K) − 협력사할인금액(M).  ← 사용자 지정(2026-06-05)
gross(정가)는 원판매금액(K) 그대로 보관(할인 전).

⚠️ 합주문건(같은 주문번호에 여러 라인) 중복 제외 방지:
  dedup_hash = sha256(channel, order_no, line_no, date, name, qty, gross).
  올리브영은 합주문에서 동일 (주문번호·상품코드·상품명·수량·금액) 라인이
  복수로 존재 → line_no를 상품코드만으로 잡으면 상위 1건만 남고 나머지가
  중복으로 제외됨. line_no에 단품명 + 주문 내 라인 시퀀스를 포함해 물리적
  행을 고유화한다(같은 파일 재업로드 시 시퀀스 안정 → 정상 dedup 유지).

낱개수량(2026-07 기준변경요청서, 임현정):
  낱개 = 상품명(F)+단품명(G) 결합 텍스트에서 정규식 6순위로 세트 입수(N)를
  추출한 뒤 × 수량(I).
    1순위: '총 N구/개/봉/병/개입' → N
    2순위: 'N(+unit)?+N unit' (예: 4+4구, 4구+4구, 12+12병) → N+N 합산
    3순위: 'N종 M세트/BOX' (예: 5종 2세트/2BOX) → N × M
    4순위: 'N구/개/봉/병/개입' → N (여러 개면 최댓값)
    5순위: 'N종' → N
    6순위: 해당 없으면 기본값 1
  6월 샘플 검증: 낱개 합 1,449 = 담당자 정답 1,449 (정확 일치).
"""
from __future__ import annotations

import re
from collections import defaultdict
from typing import Iterable, Optional

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import (
    read_excel_safe, to_date, to_float, to_str,
)

_UNIT = r"개입|구|개|봉|병"
_P1 = re.compile(rf"총\s*(\d+)\s*(?:{_UNIT})")
_P2 = re.compile(rf"(\d+)\s*(?:{_UNIT})?\s*\+\s*(\d+)\s*(?:{_UNIT})")
_P3 = re.compile(r"(\d+)\s*종\s*(\d+)\s*(?:세트|셋트|box)", re.I)
_P4 = re.compile(rf"(\d+)\s*(?:{_UNIT})")
_P5 = re.compile(r"(\d+)\s*종")


def _oy_unit_per_set(prod: Optional[str], opt: Optional[str]) -> float:
    """상품명+단품명 결합 텍스트에서 세트 입수(N)를 정규식 6순위로 추출."""
    t = f"{prod or ''} {opt or ''}"
    m = _P1.search(t)
    if m:
        return float(m.group(1))
    m = _P2.search(t)
    if m:
        return float(int(m.group(1)) + int(m.group(2)))
    m = _P3.search(t)
    if m:
        return float(int(m.group(1)) * int(m.group(2)))
    ms = _P4.findall(t)
    if ms:
        return float(max(int(x) for x in ms))
    m = _P5.search(t)
    if m:
        return float(m.group(1))
    return 1.0


@register("올리브영")
def parse(path: str) -> Iterable[ParsedLine]:
    df = read_excel_safe(path, header=0)
    _seq: dict[str, int] = defaultdict(int)
    for _, row in df.iterrows():
        sale_d = to_date(row.get("매출일자"))
        if not sale_d:
            continue
        prod = to_str(row.get("상품명"))
        if not prod:
            continue
        qty = to_float(row.get("수량") or 1)

        # 매출 = 원판매금액(K) − 협력사할인금액(M)
        gross = to_float(row.get("원판매금액"))
        if not gross:
            gross = to_float(row.get("단가")) * qty
        discount = to_float(row.get("협력사할인금액"))
        net = gross - discount

        order_no = to_str(row.get("주문번호"))
        prod_code = to_str(row.get("온라인상품코드")) or ""
        opt = to_str(row.get("단품명")) or ""
        # 합주문 내 라인 고유화: 상품코드|단품명|주문내 시퀀스
        seq_key = f"{order_no}|{prod_code}|{opt}"
        _seq[seq_key] += 1
        line_no = f"{prod_code}|{opt}|{_seq[seq_key]}"

        yield ParsedLine(
            sale_date=sale_d,
            order_no=order_no,
            line_no=line_no,
            raw_product_name=prod,
            raw_option_name=opt or None,
            raw_qty=qty,
            gross_amount=gross,
            net_amount=net,
            unit_per_set=_oy_unit_per_set(prod, opt),
        )
