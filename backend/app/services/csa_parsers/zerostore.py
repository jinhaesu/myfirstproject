"""제로스토어 발주서 (PDF) 파서. pdfplumber로 표 추출.

표 컬럼 (헤더 row):
  품 목 / 규격 / 수 량 / 단가 (vat+) / 총 소박스 수량 / 박스 입수량

매출: 수량 × 단가 (단가는 VAT 포함 — '단가 (vat+)').
부가세 별도 정책에 따라 매출 적재 시 /1.1.
"""
from __future__ import annotations

import re
from datetime import date
from typing import Iterable, Optional

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import to_float, to_str


_DATE_RE = re.compile(r"(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일")


def _extract_date_from_pdf(path: str) -> Optional[date]:
    try:
        import pdfplumber
    except ImportError:
        return None
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ""
            m = _DATE_RE.search(text)
            if m:
                try:
                    return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
                except Exception:
                    continue
    return None


@register("제로스토어")
def parse(path: str) -> Iterable[ParsedLine]:
    import pdfplumber

    sale_d = _extract_date_from_pdf(path) or date.today()

    line_idx = 0
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            tables = page.extract_tables()
            for table in tables:
                # 헤더 row 찾기 (품 목/수 량/단가 포함)
                header_idx = None
                for i, row in enumerate(table):
                    flat = " ".join(str(c or "") for c in row)
                    if "품" in flat and "수" in flat and "단가" in flat:
                        header_idx = i
                        break
                if header_idx is None:
                    continue

                header = table[header_idx]
                # 컬럼 위치 매핑
                col_map = {}
                for j, cell in enumerate(header):
                    s = str(cell or "")
                    if "품" in s:
                        col_map["prod"] = j
                    elif "수 량" in s or s.strip() == "수량":
                        col_map["qty"] = j
                    elif "단가" in s:
                        col_map["price"] = j

                # 데이터 row 처리
                for row in table[header_idx + 1 :]:
                    prod = to_str(row[col_map.get("prod", 0)]) if "prod" in col_map else None
                    if not prod or "널담" not in prod:
                        continue
                    qty = to_float(row[col_map["qty"]]) if "qty" in col_map else 0
                    unit_price = to_float(row[col_map["price"]]) if "price" in col_map else 0
                    if qty == 0 or unit_price == 0:
                        continue
                    gross = qty * unit_price / 1.1  # VAT 포함 단가 → 공급가
                    yield ParsedLine(
                        sale_date=sale_d,
                        line_no=f"#L{line_idx}",
                        raw_product_name=prod,
                        raw_qty=qty,
                        gross_amount=gross,
                        net_amount=gross,
                        # 제로스토어 발주 수량 = 낱개(1:1). 매핑의 입수(쫀득쿠키 75·바게트 10 등)가
                        # 곱해져 과대계상되던 문제 → 입수 1로 고정.
                        unit_per_set=1,
                    )
                    line_idx += 1
