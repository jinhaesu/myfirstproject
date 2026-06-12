"""신세계몰 (SSG닷컴 위탁) 파서. '업체주문관리 조회' — HTML 위장 xls (UTF-8).

컬럼: 순번, 주문번호, 원주문번호, 주문일시, 주문구분, 주문상품상태,
      상품번호, 상품명, 옵션, 주문수량, 주문금액,
      할인금액 판매자 부담, 할인금액 당사 부담, 실주문금액, ...

기준 (2026-06-12 신설):
  - 매출 = 주문금액 − 할인금액 판매자 부담 (당사(신세계) 부담 할인은 매출에 포함)
    → VAT 포함 소비자가이므로 ingest에서 ÷1.1 (VAT_INCLUDED_CHANNELS)
  - 행수 = 주문번호 고유값
  - 취소 = 주문구분 또는 주문상품상태에 '취소'/'반품' 포함
"""
from __future__ import annotations
import io
from typing import Iterable

import pandas as pd

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import to_datetime, to_float, to_str


def _read(path: str) -> pd.DataFrame:
    for enc in ("utf-8", "utf-8-sig", "cp949", "euc-kr"):
        try:
            with open(path, "r", encoding=enc) as f:
                content = f.read()
            tables = pd.read_html(io.StringIO(content), header=0)
            if tables:
                return tables[0]
        except Exception:
            continue
    try:
        return pd.read_excel(path, engine="xlrd")
    except Exception:
        pass
    try:
        return pd.read_excel(path, engine="openpyxl")
    except Exception:
        return pd.DataFrame()


@register("신세계몰")
@register("신세계몰(SSG)")
def parse(path: str) -> Iterable[ParsedLine]:
    df = _read(path)
    if df.empty:
        return

    for _idx, (_, row) in enumerate(df.iterrows()):
        prod = to_str(row.get("상품명"))
        if not prod:
            continue
        sale_dt = to_datetime(row.get("주문일시"))
        if sale_dt is None or pd.isna(sale_dt):
            continue

        # 취소: 주문구분(취소/반품/교환) 또는 주문상품상태에 '취소'
        kind = to_str(row.get("주문구분") or "") or ""
        status = to_str(row.get("주문상품상태") or "") or ""
        is_cancel = any(k in kind for k in ("취소", "반품")) or any(k in status for k in ("취소", "반품"))

        qty = to_float(row.get("주문수량") or 1)
        gross = to_float(row.get("주문금액"))
        seller_disc = to_float(row.get("할인금액 판매자 부담") or row.get("할인금액 판매자부담") or 0)
        net = gross - seller_disc

        yield ParsedLine(
            sale_date=sale_dt.date(),
            sale_datetime=sale_dt,
            order_no=to_str(row.get("주문번호")),
            # 같은 주문에 동일 상품 복수 행 dedup 탈락 방지 — 행 시퀀스 부여
            line_no=f"{to_str(row.get('상품번호')) or ''}-{_idx}",
            raw_product_name=prod,
            raw_option_name=to_str(row.get("옵션")),
            raw_qty=qty,
            gross_amount=0 if is_cancel else gross,
            net_amount=0 if is_cancel else net,
            refund_amount=net if is_cancel else 0,
            is_cancelled=is_cancel,
        )
