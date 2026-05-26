"""이마트 노브랜드 (납품현황) 파서.

두 가지 시트/컬럼 포맷을 모두 지원:

A) "납품현황" 시트 (기존):
   No / 배달일시 / 수신일시 / 상태 / 문서번호 / 전표구분 / 전표상세구분 /
   납품형태 / 업태 / 점포코드 / 점포명 / 센터코드 / 센터명 /
   매입일자(YYYYMMDD) / 주문일자 / 주문 낱개 수량 / 주문금액
   (상품명 없음 → 단일 가상 SKU "이마트 노브랜드 납품"으로 적재)

B) "엑셀저장" 시트 (신규):
   점포코드 / 업태코드 / 업태명 / 점포명 / 업체코드 / 업체명 /
   상품코드 / 상품명 / 납품일자(YYYYMMDD) / 발주일자 / 문서번호 / 납품구분 /
   발주량 / 납품량 / 발주금액 / 납품금액 / 원가 / 매입구분 / 센터코드 / 센터명 /
   LOT / 매입형태 / 매입구분명 / 원상품코드
   (상품명·상품코드 존재 → 표준 SKU 매핑 가능)
"""
from __future__ import annotations

from datetime import datetime
from typing import Iterable

import pandas as pd

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import (
    read_excel_safe, to_date, to_float, to_str,
)


def _yyyymmdd_to_date(v):
    s = to_str(v)
    if not s:
        return None
    s = s.replace("-", "").replace(".", "").replace("/", "").strip()
    if len(s) == 8 and s.isdigit():
        try:
            return datetime.strptime(s, "%Y%m%d").date()
        except Exception:
            return None
    return to_date(v)


def _detect_sheet_and_format(path: str):
    """파일을 열어 시트명/컬럼으로 포맷 자동 감지."""
    xls = pd.ExcelFile(path)
    sheets = xls.sheet_names
    if "엑셀저장" in sheets:
        return "엑셀저장", "B"
    if "납품현황" in sheets:
        return "납품현황", "A"
    # fallback: 첫 시트 + 컬럼 보고 결정
    s = sheets[0]
    df = pd.read_excel(path, sheet_name=s, nrows=1)
    cols = set(str(c) for c in df.columns)
    if "납품량" in cols and "납품금액" in cols:
        return s, "B"
    return s, "A"


@register("이마트 노브랜드")
def parse(path: str) -> Iterable[ParsedLine]:
    sheet, fmt = _detect_sheet_and_format(path)
    df = read_excel_safe(path, sheet_name=sheet, header=0)

    for idx, (_, row) in enumerate(df.iterrows()):
        if fmt == "B":
            # 신규 "엑셀저장" 포맷
            sale_d = _yyyymmdd_to_date(row.get("납품일자")) or _yyyymmdd_to_date(row.get("발주일자"))
            if not sale_d:
                continue
            prod = to_str(row.get("상품명")) or "이마트 노브랜드 납품"
            qty = to_float(row.get("납품량") or row.get("발주량") or 0)
            gross = to_float(row.get("납품금액") or row.get("발주금액") or 0)

            # 매입구분명 '반품'/'취소' 시 음수
            ctype = (to_str(row.get("매입구분명")) or "").strip()
            if "반품" in ctype or "취소" in ctype:
                qty = -abs(qty)
                gross = -abs(gross)

            store = to_str(row.get("점포명")) or to_str(row.get("센터명"))
            order_no = to_str(row.get("문서번호"))
            sku = to_str(row.get("상품코드")) or to_str(row.get("원상품코드")) or ""
            line_no = f"{sku}@{store or ''}#L{idx}"

            yield ParsedLine(
                sale_date=sale_d,
                order_no=order_no,
                line_no=line_no,
                raw_product_name=prod,
                raw_option_name=store,
                raw_qty=qty,
                gross_amount=gross,
                net_amount=gross,
                settlement_amount=gross,
            )
        else:
            # 기존 "납품현황" 포맷
            sale_d = _yyyymmdd_to_date(row.get("매입일자")) or to_date(row.get("배달일시"))
            if not sale_d:
                continue
            qty = to_float(row.get("주문 낱개 수량"))
            gross = to_float(row.get("주문금액"))
            state = (to_str(row.get("상태")) or "").strip()
            sub_type = (to_str(row.get("전표상세구분")) or "").strip()
            if "반품" in state or "반품" in sub_type or "취소" in sub_type:
                qty = -abs(qty)
            store = to_str(row.get("점포명")) or to_str(row.get("센터명"))
            order_no = to_str(row.get("문서번호"))
            yield ParsedLine(
                sale_date=sale_d,
                order_no=order_no,
                line_no=f"#L{idx}",
                raw_product_name="이마트 노브랜드 납품",
                raw_option_name=store,
                raw_qty=qty,
                gross_amount=gross,
                net_amount=gross,
                settlement_amount=gross,
            )
