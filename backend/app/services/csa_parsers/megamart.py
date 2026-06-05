"""메가마트 파서.

엑셀 구조(header=0):
  입고일자 / 점포코드 / 점포명 / 전표번호 / 바코드 / 상품코드 / 상품명 /
  분류명 / 입수 / 수량 / 원단가 / 원가금액

규칙(사용자 지정 2026-06-05):
  - 매출 = 원가금액 (부가세 '별도'로 이미 표시된 금액 → ÷1.1 환산 안 함).
  - 낱개수량 = 상품명의 'N구'(팩당 개수) × '입수' 컬럼 × 수량 (세 값 모두 곱).
    예) '널담 뚱카롱 6구', 입수 10, 수량 48 → 6 × 10 × 48 = 2,880개.
  - '일별점포별합계' / '합계' 등 집계 행은 skip.
  - 같은 (전표·상품·점포)도 여러 행 가능 → line_no에 시퀀스 포함.
"""
from __future__ import annotations

import re
from collections import defaultdict
from typing import Iterable, Optional

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import read_excel_safe, to_date, to_float, to_str

# 상품명에서 1팩당 낱개 입수 추출: 'N구' / 'N개입' / 'N개'
_UNIT_RE = re.compile(r"(\d+)\s*(?:구|개입|개)")


def _unit_from_name(name: Optional[str]) -> Optional[float]:
    if not name:
        return None
    m = _UNIT_RE.search(name)
    if m:
        v = int(m.group(1))
        if 1 <= v <= 500:
            return float(v)
    return None


@register("메가마트")
def parse(path: str) -> Iterable[ParsedLine]:
    df = read_excel_safe(path, header=0)
    _seq: dict[str, int] = defaultdict(int)
    for _, row in df.iterrows():
        prod = to_str(row.get("상품명"))
        if not prod:
            continue
        # 집계/합계 행 skip
        slip = to_str(row.get("전표번호")) or ""
        ddate = to_str(row.get("입고일자")) or ""
        if "합계" in slip or "합계" in ddate:
            continue

        sale_d = to_date(row.get("입고일자"))
        if not sale_d:
            continue

        qty = to_float(row.get("수량"))
        gross = to_float(row.get("원가금액"))  # 부가세 별도 = 매출
        if qty == 0 and gross == 0:
            continue

        # 낱개 입수 = 상품명 'N구'(팩당) × '입수' 컬럼(박스/케이스당 팩수).
        # 낱개수량 = 이 입수 × 수량.  예) 6구 × 입수10 × 수량48 = 2,880.
        gu = _unit_from_name(prod) or 1.0
        ipsu = to_float(row.get("입수")) or 1.0
        unit = gu * ipsu

        store_code = to_str(row.get("점포코드")) or ""
        store_name = to_str(row.get("점포명"))
        prod_code = to_str(row.get("상품코드")) or ""
        key = f"{slip}|{prod_code}|{store_code}"
        _seq[key] += 1
        line_no = f"{key}#{_seq[key]}"

        yield ParsedLine(
            sale_date=sale_d,
            order_no=slip or None,
            line_no=line_no,
            raw_product_name=prod,
            raw_option_name=store_name,
            raw_qty=qty,
            gross_amount=gross,
            net_amount=gross,
            unit_per_set=unit,
        )
