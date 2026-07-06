"""삼성웰스토리 (입고/납품) 파서.

샘플 헤더 (1행):
  No / 플랜트 / 플랜트명 / 협력사 코드 / 협력사명 /
  입고문서번호 / 입고문서 Item / 입고 일자 / 상태 /
  품목번호 / 품목명 / 단위 / 수량 / 단가 / 납품금액 /
  통화 / 환율 / 예약금액 / 송장번호 / 발주번호 / 발주항번 /
  발주형태 / Delivery / Delivery Item / IR Document No / IR Date /
  창고코드 / 창고명

매출 단위: 낱개(EA). 단위 컬럼이 BOX인 경우 입수 추출은 unit_per_set 규칙에 위임.
"""
from __future__ import annotations

from typing import Iterable

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import (
    read_excel_safe, to_date, to_float, to_str, ea_per_box,
)


@register("삼성웰스토리")
def parse(path: str) -> Iterable[ParsedLine]:
    df = read_excel_safe(path, header=0)
    for _, row in df.iterrows():
        sale_d = to_date(row.get("입고 일자") or row.get("입고일자"))
        if not sale_d:
            continue
        prod = to_str(row.get("품목명"))
        if not prod:
            continue
        qty = to_float(row.get("수량"))
        # 상태 R(Receipt) = 입고, 그 외 (반품성)은 음수 처리
        status = to_str(row.get("상태")) or ""
        if status and status.upper().startswith(("RT", "RR", "RV")):
            qty = -abs(qty)
        unit = to_str(row.get("단위"))
        gross = to_float(row.get("납품금액"))
        # 낱개 입수: 단위=EA면 낱개 판매(1), 단위=BOX면 품목명의 '(WG*NEA)/BOX'에서 추출.
        #   예) 뚱카롱 750G(50G*15EA)/BOX·BOX → 15, 배꼽베이글 130G/EA·EA → 1,
        #       에너지드링크 355ML/EA(24EA/BOX)·EA → 1, 번들(355ML*24EA)/BOX·BOX → 24.
        unit_col = (unit or "").strip().upper()
        # 베이글 ×15 하드코딩 제거(2026-07-06 사용자 지정: 1개씩) — 일반 규칙 적용
        if unit_col == "EA":
            ups = 1.0
        elif unit_col == "BOX":
            ups = ea_per_box(prod)
        else:
            ups = ea_per_box(prod)
        order_no = to_str(row.get("송장번호")) or to_str(row.get("발주번호")) or to_str(row.get("입고문서번호"))
        line_no = to_str(row.get("입고문서 Item")) or to_str(row.get("발주항번"))
        yield ParsedLine(
            sale_date=sale_d,
            order_no=order_no,
            line_no=line_no,
            raw_product_name=prod,
            raw_option_name=unit,
            raw_qty=qty,
            gross_amount=gross,
            net_amount=gross,
            settlement_amount=gross,
            unit_per_set=ups,
        )
