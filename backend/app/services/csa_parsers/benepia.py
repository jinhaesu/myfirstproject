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
    """베네피아 파일을 형태별로 읽는다.
      - .xlsx (일반)           → openpyxl
      - 비밀번호 .xls (OLE2)   → msoffcrypto 복호화 후 xlrd
      - 일반 .xls              → xlrd
    """
    # 1) xlsx 는 openpyxl (xlrd는 xlsx를 못 읽음 — 과거 45행 파일이 2행만 잡히던 원인)
    if path.lower().endswith(".xlsx"):
        try:
            return pd.read_excel(path, engine="openpyxl", header=0)
        except Exception:
            pass

    # 2) 암호화 OLE2(.xls) → 복호화 후 xlrd
    try:
        import olefile
        is_ole = olefile.isOleFile(path)
    except Exception:
        is_ole = path.lower().endswith(".xls")
    if is_ole:
        try:
            import msoffcrypto  # type: ignore
            with open(path, "rb") as f:
                office_file = msoffcrypto.OfficeFile(f)
                office_file.load_key(password=_PASSWORD)
                decrypted = io.BytesIO()
                office_file.decrypt(decrypted)
            return pd.read_excel(decrypted, engine="xlrd", header=0)
        except Exception:
            pass

    # 3) 일반 xls / 기타
    try:
        return pd.read_excel(path, engine="xlrd", header=0)
    except Exception:
        try:
            return pd.read_excel(path, engine="openpyxl", header=0)
        except Exception:
            return pd.DataFrame()


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

        # 주문/배송상태에 '취소'/'반품' 포함 시 취소건으로 표시
        status = to_str(row.get("주문/배송상태") or row.get("주문상태") or "") or ""
        is_cancel = ("취소" in status) or ("반품" in status) or (net_qty <= 0)

        gross = to_float(row.get("주문금액") or row.get("결제금액") or row.get("공급가"))
        net = to_float(row.get("공급가") or row.get("매입액") or row.get("결제금액"))
        yield ParsedLine(
            sale_date=sale_dt.date(),
            sale_datetime=sale_dt,
            order_no=to_str(row.get("주문번호")),
            line_no=to_str(row.get("주문순번") or row.get("상품코드")),
            raw_product_name=prod,
            raw_option_name=to_str(row.get("옵션명")),
            raw_qty=net_qty if net_qty > 0 else qty,
            gross_amount=0 if is_cancel else gross,
            net_amount=0 if is_cancel else net,
            refund_amount=net if is_cancel else 0,
            is_cancelled=is_cancel,
        )
