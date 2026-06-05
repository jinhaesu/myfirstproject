"""마켓컬리 (정산상세) 파서. CSV."""
from __future__ import annotations

import re
from typing import Iterable, Optional

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import (
    read_excel_safe, to_date, to_float, to_str,
)


def _kurly_unit_per_set(name: Optional[str]) -> Optional[float]:
    """컬리 낱개 입수 산출 — 상품명 기반.
      · 'N개입' / 'N입' / 'N구' (예: (4개입), 6입, 8구 세트) → N (가장 앞 표기 사용)
      · 개입 정보 없고 '파운드' 포함 → 기본 3개입
      · [널담] 비건 브라우니 → 기본 3개입 (1건=3개 납품, 상품명에 수량 표기 없음)
      · 그 외 → None (매핑 기본값 사용)
    """
    if not name:
        return None
    m = re.search(r"(\d+)\s*(?:개입|입|구)", name)
    if m:
        v = int(m.group(1))
        if 1 <= v <= 200:
            return float(v)
    if "파운드" in name:
        return 3.0
    compact = name.replace(" ", "")
    if "브라우니" in compact and ("비건" in compact or "널담" in compact):
        return 3.0
    return None


@register("마켓컬리")
@register("컬리")
def parse(path: str) -> Iterable[ParsedLine]:
    df = read_excel_safe(path, header=0)
    for _, row in df.iterrows():
        # 입고가 음수=반품. 수불일=일자, 상품명, 수량, 공급단가, 공급가액
        sale_d = to_date(row.get("수불일"))
        if not sale_d:
            continue
        qty = to_float(row.get("수량"))
        if row.get("구분") == "반품":
            qty = -abs(qty)
        prod = to_str(row.get("상품명"))
        if not prod:
            continue
        gross = to_float(row.get("공급가액"))
        # 낱개 = 수량 × 개입(상품명에서 추출, 파운드는 기본 3)
        unit = _kurly_unit_per_set(prod)
        yield ParsedLine(
            sale_date=sale_d,
            order_no=to_str(row.get("발주/반품 코드")),
            line_no=to_str(row.get("마스터코드")),
            raw_product_name=prod,
            raw_qty=qty,
            gross_amount=gross,
            net_amount=gross,
            settlement_amount=to_float(row.get("정산합계")),
            unit_per_set=unit,
        )
