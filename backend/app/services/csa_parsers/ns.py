"""NS 홈쇼핑 파서. 일자 컬럼이 없는 집계 파일 → 업로드 시점의 일자로 임시 적재.

추후 NS측 일자 컬럼이 있는 파일이 들어오면 우선 사용.
"""
from __future__ import annotations
import os
import re
from collections import defaultdict
from datetime import date
from typing import Iterable, Optional

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import read_excel_safe, to_date, to_float, to_str


def _date_from_filename(path: str) -> Optional[date]:
    """파일명에서 기준일 추출. 일자 컬럼 없는 NS 집계 파일용.
    예) 'ns260501_31.xlsx' → 2026-05-01 (YYMMDD), 'NS_20260501.xlsx' → 2026-05-01.
    """
    name = os.path.basename(path)
    m = re.search(r"(20\d{2})[-_.]?(\d{2})[-_.]?(\d{2})", name)  # YYYYMMDD
    if m:
        try:
            return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        except Exception:
            pass
    m = re.search(r"(\d{2})(\d{2})(\d{2})", name)  # YYMMDD
    if m:
        yy, mm, dd = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if 1 <= mm <= 12 and 1 <= dd <= 31:
            try:
                return date(2000 + yy, mm, dd)
            except Exception:
                pass
    return None


@register("NS MALL")
@register("NS")
def parse(path: str) -> Iterable[ParsedLine]:
    df = read_excel_safe(path, header=0)
    # 일자 컬럼이 없으면 파일명의 기준월(예: ns260501_31 → 2026-05-01)로, 그것도 없으면 today.
    today = _date_from_filename(path) or date.today()
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
