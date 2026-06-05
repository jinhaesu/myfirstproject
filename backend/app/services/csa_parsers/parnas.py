"""파르나스 (인터컨티넨탈) Purchase Order PDF 파서. pdfplumber로 표 추출.

표 컬럼: Article / Unit / Qty / Unit Price / Amount
Article 예: '187165 쿠키 커피(널담르뱅/20g*60*4팩/박스/수,금발주)'
Amount는 부가세 별도(Excl. VAT). 그대로 매출.
"""
from __future__ import annotations

import re
from datetime import date
from typing import Iterable, Optional

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import to_float, to_str


_DELIVERY_RE = re.compile(r"Date of Delivery\s*:?\s*(\d{4})[\.\-/](\d{1,2})[\.\-/](\d{1,2})")
_ORDER_RE = re.compile(r"Order Date\s*:?\s*(\d{4})[\.\-/](\d{1,2})[\.\-/](\d{1,2})")
_SKU_PROD_RE = re.compile(r"^\s*(\d{4,8})\s+(.+)$", re.MULTILINE)
# Article 규격 '20g*60*4팩/박스' → 박스당 낱개 = 60 × 4 = 240
_PACK_RE = re.compile(r"(\d+)\s*\*\s*(\d+)\s*팩")


def _parnas_unit(name: Optional[str]) -> Optional[float]:
    if not name:
        return None
    m = _PACK_RE.search(name)
    if m:
        return float(int(m.group(1)) * int(m.group(2)))
    return None


def _extract_date_from_pdf(path: str) -> Optional[date]:
    import pdfplumber
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ""
            for pat in (_DELIVERY_RE, _ORDER_RE):
                m = pat.search(text)
                if m:
                    try:
                        return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
                    except Exception:
                        continue
    return None


@register("파르나스")
def parse(path: str) -> Iterable[ParsedLine]:
    import pdfplumber

    sale_d = _extract_date_from_pdf(path) or date.today()

    line_idx = 0
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            tables = page.extract_tables()
            for table in tables:
                # 헤더 row 찾기 (Article / Qty / Amount 등 포함)
                header_idx = None
                for i, row in enumerate(table):
                    flat = " ".join(str(c or "") for c in row)
                    if "Article" in flat and "Qty" in flat and "Amount" in flat:
                        header_idx = i
                        break
                if header_idx is None:
                    continue

                header = table[header_idx]
                col_map = {}
                for j, cell in enumerate(header):
                    s = (str(cell or "")).strip()
                    if s == "Article":
                        col_map["article"] = j
                    elif s == "Unit":
                        col_map["unit"] = j
                    elif s == "Qty":
                        col_map["qty"] = j
                    elif "Unit Price" in s:
                        col_map["unit_price"] = j
                    elif s == "Amount":
                        col_map["amount"] = j

                for row in table[header_idx + 1 :]:
                    article = to_str(row[col_map.get("article", 0)]) if "article" in col_map else None
                    if not article:
                        continue
                    # Article = "187165 쿠키 커피(...)" → 분리
                    m = _SKU_PROD_RE.match(article)
                    if m:
                        sku = m.group(1)
                        prod = m.group(2).strip()
                    else:
                        sku = ""
                        prod = article.strip()

                    # Total 라인 등 skip
                    if "Total" in prod or "VAT" in prod:
                        continue

                    unit_word = to_str(row[col_map["unit"]]) if "unit" in col_map else None
                    qty = to_float(row[col_map["qty"]]) if "qty" in col_map else 0
                    amount = to_float(row[col_map["amount"]]) if "amount" in col_map else 0
                    if qty == 0 or amount == 0:
                        continue

                    yield ParsedLine(
                        sale_date=sale_d,
                        line_no=f"{sku}#L{line_idx}",
                        raw_product_name=prod,
                        raw_option_name=unit_word,
                        raw_qty=qty,
                        gross_amount=amount,
                        net_amount=amount,
                        # 낱개 = 박스수 × 박스입수(Article '60*4팩' → 240)
                        unit_per_set=_parnas_unit(prod),
                    )
                    line_idx += 1
