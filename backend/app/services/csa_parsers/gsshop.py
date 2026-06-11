"""GS SHOP 홈쇼핑 파서. HTML 위장 xls (UTF-8).

두 가지 컬럼 포맷 지원:
  A) 직송주문(주문관리) — 컬럼 예시:
       주문일자, 상품상세코드, 상품명(송장|인터넷), 협력사상품명, 주문옵션,
       수량, 판매가, 고객결제액, 협력사지급금액, 상태(주문취소 등)
  B) 매출집계(과거 형식) — 컬럼 예시:
       상품명, 매출수량, 매출금액, 순매출수량, 순매출금액 (고객판매금액),
       반품수량, 반품금액, 협력사지급액

원본이 HTML이라 read_html이 경로를 직접 받으면 인코딩 깨짐 → 파일을 str로 읽고 StringIO 전달.
"""
from __future__ import annotations
import io
import os
import re
from datetime import date
from typing import Iterable, Optional

import pandas as pd

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import to_date, to_float, to_str


_DATE_PATTERNS = [
    re.compile(r"(20\d\d)[\-\.](\d{1,2})[\-\.](\d{1,2})"),
    re.compile(r"(20\d\d)(\d{2})(\d{2})"),
]


def _extract_date_from_filename(path: str) -> Optional[date]:
    name = os.path.basename(path)
    for pat in _DATE_PATTERNS:
        m = pat.search(name)
        if m:
            try:
                return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
            except Exception:
                continue
    return None


def _read_gs(path: str) -> pd.DataFrame:
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
        pass
    return pd.DataFrame()


def _pick(row, *names):
    for n in names:
        v = row.get(n)
        if v is not None and not (isinstance(v, float) and pd.isna(v)):
            return v
    return None


@register("GS샵")
@register("GS 샵")
@register("GS SHOP")
@register("GS샵쇼핑")
def parse(path: str) -> Iterable[ParsedLine]:
    df = _read_gs(path)
    if df.empty:
        return

    cols = set(str(c) for c in df.columns)
    is_direct = "고객결제액" in cols or "협력사지급금액" in cols or "판매가" in cols

    file_date = _extract_date_from_filename(path)

    for _idx, (_, row) in enumerate(df.iterrows()):
        prod = to_str(_pick(row, "상품명(송장)", "상품명(인터넷)", "협력사상품명", "상품명"))
        if not prod:
            continue

        # 주문취소/반품 — 버리지 않고 is_cancelled로 표시
        status = (to_str(_pick(row, "상태", "주문상태")) or "").strip()
        is_cancel = status in ("주문취소", "취소", "취소완료", "반품완료") or "취소" in status or "반품" in status

        if is_direct:
            # 직송주문 포맷
            qty = to_float(_pick(row, "수량") or 0)
            # gross: 판매가 (라인별 정가 총액)
            gross = to_float(_pick(row, "판매가격", "판매가") or 0)
            # 매출(net) = V열 협력사지급금액 (당사 수령액)  ← 사용자 지정(2026-06-05)
            net = to_float(
                _pick(row, "협력사지급금액", "협력사 지급금액", "협력사지급액", "고객결제액") or gross
            )
            if not gross:
                gross = net
            # 일자: '주문매출실적_상세' 양식은 원주문일자/접수일자/출고완료일을 사용
            # (주문일자/출하지시일자 컬럼 없음 → 과거엔 파일명/today로 잘못 잡혀 당월 미표시).
            sale_d = (
                to_date(_pick(row, "주문일자", "원주문일자", "접수일자",
                              "출하지시일자", "출고완료일", "배송완료일", "매출완료일"))
                or file_date or date.today()
            )
            # 같은 주문에 동일 상품코드·금액 행이 여러 개면 dedup 해시가 충돌해
            # 행이 탈락(수량 과소) → 행 시퀀스를 붙여 라인 고유성 보장.
            line_no = f"{to_str(_pick(row, '상품상세코드', '협력사상품코드')) or ''}-{_idx}"
            order_no = to_str(_pick(row, "주문번호"))
            opt = to_str(_pick(row, "주문옵션"))
        else:
            # 매출집계 포맷
            qty = to_float(_pick(row, "순매출수량", "매출수량") or 0)
            gross = to_float(
                _pick(row, "순매출금액 (고객판매금액)", "순매출금액(고객판매금액)", "매출금액") or 0
            )
            net = to_float(_pick(row, "협력사지급액") or gross)
            sale_d = file_date or date.today()
            line_no = f"{to_str(_pick(row, '상품코드', '상품상세코드')) or ''}-{_idx}"
            order_no = None
            opt = to_str(_pick(row, "주문옵션"))

        # 고객결제액·판매가가 0이라도 협력사지급금액(net)이 있으면 인식(영업주문 등 누락 방지)
        if qty == 0 and gross == 0 and net == 0 and not is_cancel:
            continue

        yield ParsedLine(
            sale_date=sale_d,
            order_no=order_no,
            line_no=line_no,
            raw_product_name=prod,
            raw_option_name=opt,
            raw_qty=qty,
            gross_amount=0 if is_cancel else gross,
            net_amount=0 if is_cancel else net,
            refund_amount=net if is_cancel else 0,
            is_cancelled=is_cancel,
        )
