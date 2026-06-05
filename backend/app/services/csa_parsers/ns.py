"""NS 홈쇼핑 파서. 일자 컬럼이 없는 집계 파일 → 업로드 시점의 일자로 임시 적재.

추후 NS측 일자 컬럼이 있는 파일이 들어오면 우선 사용.
"""
from __future__ import annotations
from collections import defaultdict
from datetime import date
from typing import Iterable

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import read_excel_safe, to_date, to_float, to_str


@register("NS MALL")
@register("NS")
def parse(path: str) -> Iterable[ParsedLine]:
    df = read_excel_safe(path, header=0)
    today = date.today()
    # 일자 컬럼 없는 집계 파일: 같은 (상품코드·단품코드)가 여러 행에 반복 →
    # line_no를 상품코드만으로 잡으면 dedup_hash 충돌로 중복 제외됨.
    # 상품코드|단품코드|단품명 + 시퀀스로 물리행 고유화(같은 파일 재처리 시 안정).
    _seq: dict[str, int] = defaultdict(int)
    for _, row in df.iterrows():
        sale_d = (
            to_date(row.get("주문일자"))
            or to_date(row.get("입고일자"))
            or to_date(row.get("정산일"))
            or to_date(row.get("매출일자"))
            or today  # 일자 컬럼이 없는 집계 파일 — 업로드 일자로
        )
        prod = to_str(row.get("상품명") or row.get("단품명"))
        if not prod:
            continue
        qty = to_float(row.get("매출수량") or row.get("수량") or row.get("주문수량") or 1)
        # 반품수량은 음수 보정
        qty -= to_float(row.get("반품수량") or 0)
        if qty == 0:
            continue
        # 매출(net) = O열 매출금액  ← 사용자 지정(2026-06-05). NS는 온라인(위탁) → VAT 환산 안 함.
        gross = to_float(
            row.get("매출금액") or row.get("정산금액") or row.get("공급금액")
            or row.get("공급가") or row.get("판매가") or row.get("원가(VAT)별도")
        )
        # 반품금액 차감
        gross -= to_float(row.get("반품금액") or 0)

        prod_code = to_str(row.get("상품코드")) or ""
        unit_code = to_str(row.get("단품코드")) or ""
        opt = to_str(row.get("단품명")) or ""
        seq_key = f"{prod_code}|{unit_code}|{opt}"
        _seq[seq_key] += 1
        line_no = f"{prod_code}|{unit_code}|{_seq[seq_key]}"

        yield ParsedLine(
            sale_date=sale_d,
            order_no=to_str(row.get("주문번호") or row.get("발주번호")),
            line_no=line_no,
            raw_product_name=prod,
            raw_option_name=opt or None,
            raw_qty=qty,
            gross_amount=gross,
            net_amount=gross,
        )
