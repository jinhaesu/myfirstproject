"""CJ 온스타일 파서. 세 가지 포맷 지원.

1) '인기상품분석현황' 집계 포맷:
  row0: 메타 ("인기상품분석현황")
  row1: 헤더 (순위, 상품코드, 상품명, 총주문수량, 총주문금액)
  row2+: 데이터. 일자 컬럼 없음 → 업로드 일자로 임시 적재.

2) B2B 납품형: 상품명 + 납품예정 금액/납품금액.

3) '배송통합조회' 배송 단위 포맷 (74컬럼):
  No·배송상태·배송지시일·주문번호·상품명·옵션명·수량·결제일·
  공급가(협력사 공급가, VAT별도)·판매가(소비자 단가)·결제가(실결제)·취소예정 …
  → 매출(net) = 수량 × 판매가 (VAT포함 → ingest ÷1.1).
    기준변경요청서(임현정 MD, 대표 승인 2026-07-06). 검증: 26년 5월
    2,090,200원(VAT포함)/107행/수량141. 과거 공급가 기준(GS샵 convention)은 폐기.

openpyxl CellStyle 버그 우회 → python-calamine 사용.
"""
from __future__ import annotations
from datetime import date
from typing import Iterable

import pandas as pd

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import to_date, to_float, to_str


def _read(path: str) -> pd.DataFrame:
    """header=None으로 읽고 상품명/총주문금액이 있는 행을 헤더로 사용."""
    for engine in ("calamine", "openpyxl"):
        try:
            df = pd.read_excel(path, engine=engine, header=None)
            return df
        except Exception:
            continue
    from openpyxl import load_workbook
    wb = load_workbook(path, read_only=True, data_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    return pd.DataFrame(rows) if rows else pd.DataFrame()


_VAT = 1.1  # ingest의 ÷1.1과 상쇄용 (공급가는 이미 VAT별도)
_CANCEL_TOKENS = ("취소", "반품", "환불")


def _parse_delivery_report(df: pd.DataFrame, header_row: int) -> Iterable[ParsedLine]:
    """'배송통합조회' 배송 단위 포맷."""
    header = [str(x or "").strip() for x in df.iloc[header_row].tolist()]
    for idx in range(header_row + 1, len(df)):
        d = {h: v for h, v in zip(header, df.iloc[idx].tolist())}
        prod = to_str(d.get("상품명"))
        if not prod or prod == "상품명":
            continue
        # 취소/반품 행 제외 — 취소예정 플래그·상태 텍스트·배송취소일 모두 확인
        state = (to_str(d.get("배송상태")) or "") + (to_str(d.get("주문상태")) or "")
        if (
            (to_str(d.get("취소예정")) or "").upper() == "Y"
            or any(t in state for t in _CANCEL_TOKENS)
            or to_date(d.get("배송취소일"))
        ):
            continue
        qty = to_float(d.get("수량") or 0)
        supply = to_float(d.get("공급가") or 0)   # 협력사 공급가 (VAT별도)
        price = to_float(d.get("판매가") or 0)    # 소비자 판매 단가 (VAT포함)
        paid = to_float(d.get("결제가") or 0)     # 실결제액 (VAT포함)
        if qty == 0 and supply == 0 and price == 0:
            continue
        # 순매출 = 수량 × 판매가 (VAT포함 → ingest ÷1.1).
        # 기준변경요청서(임현정 MD) 대표 승인 2026-07-06 — 기존 공급가 기준에서 전환.
        # 판매가 없으면 결제가, 그것도 없으면 공급가×1.1(상쇄용) 폴백.
        net = (price * qty) if price and qty else (paid or supply * _VAT)
        gross = net
        sale_d = (
            to_date(d.get("결제일")) or to_date(d.get("배송지시일"))
            or to_date(d.get("출고일")) or date.today()
        )
        yield ParsedLine(
            sale_date=sale_d,
            order_no=to_str(d.get("주문번호")),
            line_no=f"{to_str(d.get('상품코드')) or ''}-{idx}",
            raw_product_name=prod,
            raw_option_name=to_str(d.get("옵션명")),
            raw_qty=qty,
            gross_amount=gross,
            net_amount=net,
        )


@register("CJ온스타일")
@register("CJ 온스타일")
@register("CJ ON STYLE")
def parse(path: str) -> Iterable[ParsedLine]:
    df = _read(path)
    if df.empty:
        return

    # 헤더 행 찾기 — 집계형(총주문금액) / B2B 납품형(납품예정 금액) /
    # 배송통합조회형(공급가·배송상태) 모두 대응
    header_row = None
    is_delivery = False
    for i in range(min(8, len(df))):
        vals = [str(x or "").strip() for x in df.iloc[i].tolist()]
        has_prod = "상품명" in vals
        if has_prod and "공급가" in vals and "배송상태" in vals:
            header_row = i
            is_delivery = True
            break
        has_amount = any(
            kw in v
            for v in vals
            for kw in ("총주문금액", "주문금액", "총금액", "납품예정 금액", "납품금액")
        )
        if has_prod and has_amount:
            header_row = i
            break
    if header_row is None:
        return
    if is_delivery:
        yield from _parse_delivery_report(df, header_row)
        return

    header = [str(x or "").strip() for x in df.iloc[header_row].tolist()]
    today = date.today()
    for idx in range(header_row + 1, len(df)):
        row = df.iloc[idx].tolist()
        d = {h: v for h, v in zip(header, row)}
        prod = to_str(d.get("상품명"))
        if not prod or prod == "상품명":
            continue
        qty = to_float(d.get("총주문수량") or d.get("주문수량") or d.get("상품 수량") or d.get("수량") or 0)
        gross = to_float(
            d.get("총주문금액") or d.get("주문금액") or d.get("총금액")
            or d.get("납품예정 금액") or d.get("납품금액") or 0
        )
        if qty == 0 and gross == 0:
            continue
        # 날짜: 집계형은 업로드 일자, B2B형은 납품일자 우선
        from app.services.csa_parsers._common import to_date
        sale_d = (
            to_date(d.get("납품일자") or d.get("발주일자") or d.get("납품예정일자"))
            or today
        )
        yield ParsedLine(
            sale_date=sale_d,
            line_no=to_str(d.get("상품코드") or d.get("납품예정번호")),
            raw_product_name=prod,
            raw_qty=qty,
            gross_amount=gross,
            net_amount=gross,
        )
