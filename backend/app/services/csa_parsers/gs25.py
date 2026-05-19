"""GS25 편의점 파서. 헤더가 row=5.

dedup 주의: GS25 raw는 점포별 납품 라인을 각각 별도 row로 보여준다.
점포코드/점포명을 dedup_hash 자체에 직접 포함시킬 수 없으므로 line_no에
파일 내 row index를 포함해 unique를 보장. 같은 파일 재업로드 시에는 idx가
동일하게 재생산되어 정상 dedup 동작.
"""
from __future__ import annotations
from typing import Iterable

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import read_excel_safe, to_date, to_float, to_str


@register("GS25")
def parse(path: str) -> Iterable[ParsedLine]:
    df = read_excel_safe(path, header=5)
    for idx, (_, row) in enumerate(df.iterrows()):
        sale_d = to_date(row.get("납품일자"))
        if not sale_d:
            continue
        prod = to_str(row.get("상품명"))
        if not prod:
            continue
        qty = to_float(row.get("납품수량") or 1)
        store = to_str(row.get("점포코드")) or to_str(row.get("점포명")) or ""
        base_line = to_str(row.get("상품코드")) or ""
        line_no = f"{base_line}@{store}#L{idx}"
        yield ParsedLine(
            sale_date=sale_d,
            line_no=line_no,
            raw_product_name=prod,
            raw_option_name=to_str(row.get("사이즈") or row.get("색상")),
            raw_qty=qty,
            gross_amount=to_float(row.get("납품금액")),
            net_amount=to_float(row.get("납품금액")),
        )
