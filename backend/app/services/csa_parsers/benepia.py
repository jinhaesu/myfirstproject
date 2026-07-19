"""베네피아 파서.

비밀번호로 보호된 .xls 파일을 msoffcrypto로 복호화한 후 파싱한다.
비밀번호: nuldam2026!

컬럼 구조(2026-07 기준변경요청서, 김재경 / MD):
  주문번호(B) / 주문일(D) / 상품명(O) / 옵션명(P) / 주문금액(Q) / 공급가(R) /
  취소/반품 상태(U) / 수량(AB) / 취교반수량(AC) / 배송비(AD)

순매출(2026-07 기준변경요청서):
  순매출 = 공급가(R) 합계 (취소행 제외). 공급가는 이미 수량이 반영된 라인
  총액이며 VAT 별도 금액이므로 그대로 net_amount로 사용(÷1.1 재환산 금지,
  '베네피아'는 VAT_INCLUDED_CHANNELS 미등록 채널). 배송비(AD)는 매출 미포함.

낱개수량(입수) 산식:
  낱개 = (상품별 낱개 입수) × 수량(AB).
  입수 판정: 옵션명(P)이 있으면 옵션명에서, 없으면 상품명(O)에서 파싱.
  '/'로 구분된 항목은 각각 파싱해 전부 합산.
  'N개입'/'N구'/'N봉'/'N개' → N. 'M BOX'(또는 M박스)가 붙으면 곱함.
  '총 N구/개/봉'이 있으면 그 값을 그 파트의 최종값으로 우선 사용
  (예: '사랑&감동 각 1BOX씩(총 16구) / 휘낭시에 8개입 1BOX' → 16 + 8 = 24).
  6월 샘플 검증: 낱개 합 525 = 담당자 정답 525 (정확 일치).

행수(주문건수): 주문번호(B) 고유값 (취소행 제외). 한 주문번호가 여러 옵션
행으로 분리될 수 있어 line_no에 행 시퀀스를 부여해 dedup 충돌을 방지한다.

취소·반품 판별: 취소/반품 상태(U)가 비어있지 않으면 취소.
보조: 취교반수량(AC) ≥ 1 이면 취소로 판별(구버전 호환).
"""
from __future__ import annotations
import io
import re
from typing import Iterable, Optional

import pandas as pd

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import to_datetime, to_float, to_str

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


# ──────────────────────────────────────────────────────────────
# 낱개수량(입수) 파싱
# ──────────────────────────────────────────────────────────────

# '총 N구/개입/봉/개' — 파트 내 최우선 값 (예: '(총 16구)')
_TOTAL_RE = re.compile(r"총\s*(\d+)\s*(?:개입|구|봉|개)")
# 'N개입' / 'N구' / 'N봉' / 'N개' — 기본 낱개 카운트
_CNT_RE = re.compile(r"(\d+)\s*(?:개입|구|봉|개)")
# 'M BOX' / 'M박스' — 배수
_BOX_RE = re.compile(r"(\d+)\s*(?:BOX|박스)", re.I)


def _part_val(part: str) -> float:
    """옵션/상품명 '/'분리 파트 하나의 낱개수량."""
    m_total = _TOTAL_RE.search(part)
    if m_total:
        v = int(m_total.group(1))
        if 1 <= v <= 200:
            return float(v)
    m_cnt = _CNT_RE.search(part)
    n = int(m_cnt.group(1)) if m_cnt and 1 <= int(m_cnt.group(1)) <= 200 else 0
    if n <= 0:
        return 0.0
    m_box = _BOX_RE.search(part)
    box = int(m_box.group(1)) if m_box and 1 <= int(m_box.group(1)) <= 20 else 1
    return float(n * box)


def _benepia_ups(opt: Optional[str], prod: Optional[str]) -> Optional[float]:
    """옵션명이 있으면 옵션명, 없으면 상품명에서 낱개수량을 파싱.

    '/'로 구분된 항목을 각각 파싱해 합산. 아무 파트도 파싱되지 않으면
    None(매핑값 폴백)을 반환한다.
    """
    text = opt if (opt and opt.strip()) else prod
    if not text:
        return None
    parts = text.split("/")
    total = 0.0
    matched = False
    for p in parts:
        v = _part_val(p)
        if v > 0:
            matched = True
            total += v
    if not matched:
        return None
    return total


@register("베네피아")
@register("Benepia")
def parse(path: str) -> Iterable[ParsedLine]:
    df = _read_benepia(path)
    for _idx, (_, row) in enumerate(df.iterrows()):
        sale_dt = (
            to_datetime(row.get("주문일"))
            or to_datetime(row.get("주문일자"))
        )
        if not sale_dt:
            continue
        prod = to_str(row.get("상품명"))
        if not prod:
            continue
        opt = to_str(row.get("옵션명"))

        qty = to_float(row.get("수량") or 1)
        cancel_qty = to_float(row.get("취교반수량") or 0)

        # 취소 판별: U열 [취소/반품 상태]에 내역이 있으면 취소건.
        # 보조: 취교반수량 ≥ 1 이면 취소건(구버전 호환 — U열이 없는 과거 파일).
        claim = to_str(row.get("취소/반품 상태") or row.get("취소/반품") or "") or ""
        is_cancel = bool(claim.strip()) or (cancel_qty >= 1)

        gross = to_float(row.get("주문금액") or row.get("결제금액") or row.get("공급가"))
        # 순매출 = 공급가(R열) 그대로 (이미 라인 총액, VAT 별도 — ÷1.1 재환산 금지)
        net = to_float(row.get("공급가") or row.get("매입액") or row.get("결제금액"))

        yield ParsedLine(
            sale_date=sale_dt.date(),
            sale_datetime=sale_dt,
            order_no=to_str(row.get("주문번호")),
            # 다품목 주문이 같은 (주문번호, 주문순번)으로 dedup 탈락하지 않게
            # 행 시퀀스 부여 (검수 반영 2026-06-12)
            line_no=f"{to_str(row.get('주문순번') or row.get('상품코드')) or ''}-{_idx}",
            raw_product_name=prod,
            raw_option_name=opt,
            raw_qty=qty,
            gross_amount=0 if is_cancel else gross,
            net_amount=0 if is_cancel else net,
            refund_amount=net if is_cancel else 0,
            is_cancelled=is_cancel,
            unit_per_set=_benepia_ups(opt, prod),
        )
