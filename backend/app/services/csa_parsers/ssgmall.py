"""신세계몰 (SSG닷컴 위탁) 파서. '업체주문관리 조회' — HTML 위장 xls (UTF-8).

컬럼: 순번, 주문번호, 원주문번호, 주문일시, 주문구분, 주문상품상태,
      상품번호, 상품명, 옵션, 주문수량, 주문금액,
      할인금액 판매자 부담, 할인금액 당사 부담, 실주문금액, ...

기준 (2026-06-12 신설):
  - 매출 = 주문금액 − 할인금액 판매자 부담 (당사(신세계) 부담 할인은 매출에 포함)
    → VAT 포함 소비자가이므로 ingest에서 ÷1.1 (VAT_INCLUDED_CHANNELS)
  - 행수 = 주문번호 고유값
  - 취소 = 주문구분 또는 주문상품상태에 '취소'/'반품' 포함

낱개수량(2026-07 기준변경요청서, 임현정):
  낱개 = 상품명[H]+옵션[I] 결합 텍스트에서 아래 우선순위로 입수(N)를 추출 × 주문수량[J].
  1순위 '총 N구/개/봉/개입' → N
  2순위 'N+N(+N...)' 체인(각 숫자에 단위 선택적 부착, 예 4+4구·3+3+3봉·4구+4구) → 전부 합산
  3순위 'N개입 N세트' / 'N구 N박스(box)' / 'N구 N세트' / 'N개입 N박스(box)' → N×N
  4순위 'N구'/'N개'/'N봉'/'N개입' → 가장 큰 숫자
  5순위 기본값 1
  6월 샘플 검증: 낱개 합 1,336 = 담당자 정답 1,336 (정확 일치).
"""
from __future__ import annotations
import io
import re
from typing import Iterable, Optional

import pandas as pd

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import to_datetime, to_float, to_str

# 낱개수량(입수) 추출용 — 상품명+옵션 결합 텍스트에 순차 적용
_RE_TOTAL = re.compile(r"총\s*(\d+)\s*(?:개입|구|개|봉)")
_RE_CHAIN = re.compile(r"\d+(?:개입|구|개|봉)?(?:\+\d+(?:개입|구|개|봉)?)+")
_RE_CHAIN_NUM = re.compile(r"\d+")
_RE_SET = re.compile(r"(\d+)\s*(?:개입|구)\s*(\d+)\s*(?:박스|box|세트)", re.IGNORECASE)
_RE_UNIT = re.compile(r"(\d+)\s*(?:개입|구|개|봉)")


def _extract_unit_count(product_name: Optional[str], option_name: Optional[str]) -> float:
    text = f"{product_name or ''} {option_name or ''}".strip()
    if not text:
        return 1.0

    m = _RE_TOTAL.search(text)
    if m:
        return float(m.group(1))

    m = _RE_CHAIN.search(text)
    if m:
        nums = [int(x) for x in _RE_CHAIN_NUM.findall(m.group(0))]
        return float(sum(nums))

    m = _RE_SET.search(text)
    if m:
        return float(int(m.group(1)) * int(m.group(2)))

    nums = [int(x) for x in _RE_UNIT.findall(text)]
    if nums:
        return float(max(nums))

    return 1.0


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
        opt_name = to_str(row.get("옵션"))
        unit_cnt = _extract_unit_count(prod, opt_name)

        yield ParsedLine(
            sale_date=sale_dt.date(),
            sale_datetime=sale_dt,
            order_no=to_str(row.get("주문번호")),
            # 같은 주문에 동일 상품 복수 행 dedup 탈락 방지 — 행 시퀀스 부여
            line_no=f"{to_str(row.get('상품번호')) or ''}-{_idx}",
            raw_product_name=prod,
            raw_option_name=opt_name,
            raw_qty=qty,
            gross_amount=0 if is_cancel else gross,
            net_amount=0 if is_cancel else net,
            refund_amount=net if is_cancel else 0,
            is_cancelled=is_cancel,
            unit_per_set=unit_cnt,
        )
