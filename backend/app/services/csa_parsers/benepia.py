"""베네피아 파서.

비밀번호로 보호된 .xls 파일을 msoffcrypto로 복호화한 후 파싱한다.
비밀번호: nuldam2026!

컬럼 구조:
  - 주문번호, 주문순번, 주문일, 상품명, 옵션명, 수량, 취교반수량, 결제금액, 공급가
"""
from __future__ import annotations
import io
from typing import Iterable

import pandas as pd

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import to_date, to_datetime, to_float, to_str

_PASSWORD = "nuldam2026!"


def _read_benepia(path: str) -> pd.DataFrame:
    """비밀번호 보호 xls 복호화 후 DataFrame 반환."""
    try:
        import msoffcrypto  # type: ignore
        with open(path, "rb") as f:
            office_file = msoffcrypto.OfficeFile(f)
            office_file.load_key(password=_PASSWORD)
            decrypted = io.BytesIO()
            office_file.decrypt(decrypted)
        return pd.read_excel(decrypted, engine="xlrd", header=0)
    except Exception:
        # 비밀번호 없이 일반 xls로도 시도 (향후 비밀번호 제거된 파일 대비)
        return pd.read_excel(path, engine="xlrd", header=0)


@register("베네피아")
@register("Benepia")
def parse(path: str) -> Iterable[ParsedLine]:
    df = _read_benepia(path)
    for _, row in df.iterrows():
        sale_dt = (
            to_datetime(row.get("주문일"))
            or to_datetime(row.get("주문일자"))
        )
        if not sale_dt:
            continue
        prod = to_str(row.get("상품명"))
        if not prod:
            continue

        qty = to_float(row.get("수량") or 1)
        cancel_qty = to_float(row.get("취교반수량") or 0)
        net_qty = qty - cancel_qty
        if net_qty <= 0:
            continue

        yield ParsedLine(
            sale_date=sale_dt.date(),
            sale_datetime=sale_dt,
            order_no=to_str(row.get("주문번호")),
            line_no=to_str(row.get("주문순번") or row.get("상품코드")),
            raw_product_name=prod,
            raw_option_name=to_str(row.get("옵션명")),
            raw_qty=net_qty,
            gross_amount=to_float(
                row.get("주문금액") or row.get("결제금액") or row.get("공급가")
            ),
            net_amount=to_float(
                row.get("공급가") or row.get("매입액") or row.get("결제금액")
            ),
        )
