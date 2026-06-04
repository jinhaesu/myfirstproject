"""쿠팡 로켓프레시 (Stocked Data List, 입고/반출 정산서) 파서.

컬럼: 구분(발주/반출) / 번호 / SKU번호 / SKU명 / 입고/반출시각 / 물류센터 /
      세금타입 / 수량 / 단가 / 공급가액 / 세액 / 총단가 / 총공급가액 / 총세액 ...

매출 기준: **총공급가액** (= 수량 × 공급가액). 결측 시 단가×수량 fallback.
구분=반출은 음수 처리.

dedup: 같은 (SKU/물류센터/시간)이라도 여러 라인이 나올 수 있으므로 line_no에
파일 내 row index 포함.
"""
from __future__ import annotations
from typing import Iterable

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import read_excel_safe, to_datetime, to_float, to_str


@register("쿠팡 로켓")
@register("쿠팡 로켓프레시")
@register("쿠팡 (로켓프레시)")
@register("쿠팡(로켓프레시)")
@register("쿠팡로켓프레시")
@register("쿠팡로켓")
def parse(path: str) -> Iterable[ParsedLine]:
    df = read_excel_safe(path, header=0)
    for idx, (_, row) in enumerate(df.iterrows()):
        sale_dt = to_datetime(row.get("입고/반출시각"))
        if not sale_dt:
            continue
        prod = to_str(row.get("SKU명"))
        if not prod:
            continue
        # 반출(반품)은 매출 차감. 단, 파일이 금액을 이미 음수("-88,400")로 주는
        # 경우가 있어 sign 곱셈을 또 하면 양수로 뒤집힌다(이중부호 버그).
        # → 반출이면 수량·금액을 -abs()로 강제 음수화(파일 부호 무관).
        is_return = str(row.get("구분") or "").strip() == "반출"
        qty = to_float(row.get("수량") or 0)

        # 매출: 총공급가액(=수량×공급가액) 우선, 결측이면 수량×단가 fallback
        gross = to_float(row.get("총공급가액") or 0)
        if gross == 0:
            unit_supply = to_float(row.get("공급가액") or 0)
            gross = unit_supply * abs(qty)
        if is_return:
            qty = -abs(qty)
            gross = -abs(gross)

        sku = to_str(row.get("SKU번호")) or ""
        line_no = f"{sku}#L{idx}"

        yield ParsedLine(
            sale_date=sale_dt.date(),
            sale_datetime=sale_dt,
            order_no=to_str(row.get("번호")),
            line_no=line_no,
            raw_product_name=prod,
            raw_qty=qty,
            gross_amount=gross,
            net_amount=gross,
        )
