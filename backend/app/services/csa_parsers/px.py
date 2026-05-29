"""국군 복지단(PX) 월누적 판매 파서.

특이사항:
  - PX 시스템은 일별이 아니라 **조회시점까지의 해당 월 누적**으로 데이터 제공
  - 매출 정보(원) 없음, 판매수량만 존재
  - 한 라인 = (SKU코드, 지역대, 지역) 별 한 달치 합산

엑셀 구조:
  - row 5: 메타 ("조회년월 : 2026년 05월")
  - row 6: 헤더-1 (물품 / 지역대 / 지역 / 이월 / 납품 / 반납 / 판매 / 재고)
  - row 7: 총계 행 (skip)
  - row 8~: 데이터 (SKU 컬럼은 merged cell로 일부 NaN — forward fill 필요)

컬럼 인덱스:
   1: SKU코드,  3: 상품명,  7: 지역대,  10: 지역,
  16: 이월,  18: 납품,  21: 반납,  24: 판매,  27: 재고

sale_date: 조회년월의 마지막 일.
"""
from __future__ import annotations

import re
from calendar import monthrange
from datetime import date
from typing import Iterable, Optional

import pandas as pd

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import read_excel_safe, to_float, to_str


_YM_RE = re.compile(r"(\d{4})\D+(\d{1,2})")
_YMD_RE = re.compile(r"(\d{4})\D+(\d{1,2})\D+(\d{1,2})")


# PX는 raw 엑셀에 매출(원) 정보가 없으므로 SKU별 표준 단가로 매출을 산정한다.
# 단가는 "부가세 포함" 소비자가. 매출 적재 시 부가세 별도(=공급가)로 환산.
#   gross_amount = raw_qty × (vat_incl_price / 1.1)
# 키는 PX 엑셀의 SKU코드(col 1)를 문자열로 변환한 값.
PX_PRICES_VAT_INCL: dict[str, float] = {
    "260499": 4800.0,  # 널담뚱카롱 6구 (1구당 4,800원, 부가세 포함)
}


def _gross_for(sku: Optional[str], qty: float) -> float:
    """SKU의 부가세 포함 단가를 부가세 별도(공급가)로 환산해 매출 계산."""
    if not sku:
        return 0.0
    price_incl = PX_PRICES_VAT_INCL.get(str(sku).strip())
    if price_incl is None:
        return 0.0
    return qty * price_incl / 1.1


def _extract_print_date(df: pd.DataFrame) -> Optional[date]:
    """footer의 '출력일자: 2026년05월19일' 패턴 추출 (우선순위 1)."""
    # 끝부분부터 역방향 탐색
    start = max(0, len(df) - 15)
    for i in range(len(df) - 1, start - 1, -1):
        for j in range(df.shape[1]):
            v = df.iat[i, j]
            if pd.isna(v):
                continue
            if "출력일자" in str(v):
                # 같은 행의 다음 셀들에서 YYYY/MM/DD 찾기
                for k in range(j + 1, min(j + 6, df.shape[1])):
                    nx = df.iat[i, k]
                    if pd.isna(nx):
                        continue
                    m = _YMD_RE.search(str(nx))
                    if m:
                        try:
                            return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
                        except Exception:
                            continue
    return None


def _extract_month_end(df: pd.DataFrame) -> Optional[date]:
    """row 5 부근 셀에서 '조회년월 : 2026년 05월' 패턴 추출 (fallback)."""
    for i in range(min(10, len(df))):
        for j in range(df.shape[1]):
            v = df.iat[i, j]
            if pd.isna(v):
                continue
            s = str(v)
            if "조회년월" in s or "년월" in s:
                # 같은 행 다음 셀들에서 YYYY/MM 찾기
                for k in range(j + 1, min(j + 6, df.shape[1])):
                    nx = df.iat[i, k]
                    if pd.isna(nx):
                        continue
                    m = _YM_RE.search(str(nx))
                    if m:
                        y, mo = int(m.group(1)), int(m.group(2))
                        return date(y, mo, monthrange(y, mo)[1])
    return None


_EXACT_META = {
    # 두 번째 페이지에 다시 등장하는 헤더 텍스트 (정확히 셀 = 이 값)
    "물 품", "물품", "물 품 계", "물품계",
    "지역대", "지 역", "지역",
    "이 월", "이월", "납 품", "납품", "반 납", "반납",
    "판 매", "판매", "재 고", "재고",
    "총 계", "총계",
}

# 셀에 포함되면 footer/메타로 간주
_CONTAINS_META = (
    "출력기준", "조회년월", "페이지",
    "IP:", "ID:",
    "※", "참고",
    "물 품 계", "물품계",  # 다양한 공백 케이스 대비
)


def _looks_like_meta(s: Optional[str]) -> bool:
    """SKU/지역대 셀이 메타/푸터/페이지 구분 행을 가리키는지."""
    if not s:
        return False
    t = " ".join(str(s).split())  # 다중 공백 정규화
    if not t:
        return False
    if t in _EXACT_META:
        return True
    for tok in _CONTAINS_META:
        if tok in t:
            return True
    return False


@register("PX")
@register("국군 복지단(PX)")
@register("국군 복지단")
@register("국군복지단")
def parse(path: str) -> Iterable[ParsedLine]:
    df = read_excel_safe(path, header=None)
    # sale_date 우선순위: footer의 '출력일자' → 조회년월의 말일 → 오늘
    sale_d = _extract_print_date(df) or _extract_month_end(df) or date.today()

    # row 7은 총계, row 8부터 데이터. 2페이지 구조라 페이지 사이에
    # 메타/페이지헤더가 다시 등장하므로 명시적으로 skip.
    cur_sku: Optional[str] = None
    cur_prod: Optional[str] = None
    cur_region_g: Optional[str] = None

    for idx in range(8, len(df)):
        row = df.iloc[idx]

        cell_sku = to_str(row[1]) if 1 < df.shape[1] else None
        cell_prod = to_str(row[3]) if 3 < df.shape[1] else None
        cell_region_g = to_str(row[7]) if 7 < df.shape[1] else None
        cell_region = to_str(row[10]) if 10 < df.shape[1] else None
        qty_raw = row[24] if 24 < df.shape[1] else None

        # footer/메타 행은 통째로 skip (그리고 현재 SKU 컨텍스트도 끊음 — 다음 페이지 헤더 대비)
        if _looks_like_meta(cell_sku) or _looks_like_meta(cell_region_g):
            cur_sku = None
            cur_prod = None
            cur_region_g = None
            continue

        # forward fill (merged cell 보존)
        if cell_sku:
            cur_sku = cell_sku
        if cell_prod:
            cur_prod = cell_prod
        if cell_region_g:
            cur_region_g = cell_region_g

        if not cur_prod or not cell_region:
            continue

        qty = to_float(qty_raw)
        if qty == 0:
            continue

        option = " ".join(p for p in (cur_region_g, cell_region) if p) or None
        line_no = f"{cur_sku or ''}@{cur_region_g or ''}-{cell_region}#L{idx}"

        gross = _gross_for(cur_sku, qty)

        yield ParsedLine(
            sale_date=sale_d,
            line_no=line_no,
            raw_product_name=cur_prod,
            raw_option_name=option,
            raw_qty=qty,
            gross_amount=gross,
            net_amount=gross,
        )
