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


def _extract_month_end(df: pd.DataFrame) -> Optional[date]:
    """row 5 부근 셀에서 '조회년월 : 2026년 05월' 패턴 추출."""
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
    sale_d = _extract_month_end(df) or date.today()

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

        yield ParsedLine(
            sale_date=sale_d,
            line_no=line_no,
            raw_product_name=cur_prod,
            raw_option_name=option,
            raw_qty=qty,
            gross_amount=0,  # PX raw에는 매출(원) 정보가 없음
            net_amount=0,
        )
