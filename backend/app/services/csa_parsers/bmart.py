"""B마트 (배민 비마트) 정산 상세 파서.

컬럼 구조 (한국어 또는 영문 헤더 모두 지원):
  - 공급가액 / supply_amount: 단가(개당 공급가)
  - 합계금액 / total_amount: 수량 × 공급가액 = 실제 정산금액
  - 발주유형 / order_type: '구매발주' / '반품' 또는 '구매발주 반품'

부호 처리: B마트 export는 반품 라인의 수량·합계금액을 이미 음수로 제공한다.
따라서 별도 부호 반전을 적용하지 않고 원본 값을 그대로 사용한다.
(단, 일부 구버전 export는 양수로 내려오는 경우가 보고되어,
 order_type이 반품인데 값이 양수일 때만 보정적으로 음수화한다.)

2026-Q2 이후 B마트가 컬럼 헤더를 영문 스네이크케이스로 변경한 export 포맷도
혼재되어 들어오므로, 양쪽 헤더를 모두 시도한다.
"""
from __future__ import annotations
from typing import Any, Iterable

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import read_excel_safe, to_datetime, to_float, to_str

# 반품·환불로 간주할 발주유형 (양수→음수 보정 후보).
_NEGATIVE_TYPES = {"반품", "구매발주 반품", "purchase_return", "return"}


def _pick(row, *keys: str) -> Any:
    """첫 번째로 NaN/None이 아닌 값을 가진 컬럼 값을 반환."""
    import pandas as pd
    for k in keys:
        if k in row.index:
            v = row.get(k)
            if v is not None and not (isinstance(v, float) and pd.isna(v)):
                return v
    return None


@register("B마트")
@register("비마트")
def parse(path: str) -> Iterable[ParsedLine]:
    df = read_excel_safe(path, header=0)
    for _, row in df.iterrows():
        sale_dt = (
            to_datetime(_pick(row, "입/출고 완료일시", "inout_completed_at"))
            or to_datetime(_pick(row, "발주/반품 마감일시", "order_return_closed_at"))
        )
        if not sale_dt:
            continue
        prod = to_str(_pick(row, "관리용 SKU명", "sku_name", "상품명"))
        if not prod:
            continue

        order_type = str(_pick(row, "발주유형", "order_type") or "").strip()
        is_return = order_type in _NEGATIVE_TYPES

        qty = to_float(_pick(row, "수량", "quantity") or 1)

        # 합계금액 = 수량 × 공급가액(단가). 없을 경우 단가 × 수량으로 fallback.
        total = to_float(_pick(row, "합계금액", "total_amount"))
        if total == 0:
            unit_price = to_float(_pick(row, "공급가액", "supply_amount", "판매가"))
            total = unit_price * abs(qty)

        # 반품인데 값이 양수면 음수로 보정 (구버전 export 안전망).
        # 이미 음수면 그대로 둔다 (이중 부호 반전 방지).
        if is_return:
            if qty > 0:
                qty = -qty
            if total > 0:
                total = -total

        yield ParsedLine(
            sale_date=sale_dt.date(),
            sale_datetime=sale_dt,
            order_no=to_str(_pick(row, "발주번호/반품번호", "order_return_number", "주문번호", "order_number")),
            line_no=to_str(_pick(row, "SKU코드", "sku_code")),
            raw_product_name=prod,
            raw_qty=qty,
            gross_amount=total,
            net_amount=total,
        )
