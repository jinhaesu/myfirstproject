"""토스 쇼핑 파서.

엑셀 구조: row0 = 안내문구, row1 = 실제 컬럼명, row2 = '수정 불가/수정 가능' 가이드,
row3부터 데이터. 수출 버전에 따라 행 위치가 달라 '주문일시'+'주문번호'가 있는
행을 찾아 헤더로 사용(header=1 고정 대신 동적 탐색 — 안내문구 삽입 위치 변동 대응).

검수 반영 (2026-07-19, 김재경 변경요청서):
 - 순매출: AD열[주문금액] 그대로(라인 총액, VAT 포함) — ÷1.1 환산은
   VAT_INCLUDED_CHANNELS(csa_service)에서 중앙 처리하므로 파서는 원본 그대로 낸다.
 - 행수(주문건수): B열[주문번호] 고유값 — order_no 필드로 이미 산출됨.
 - 낱개(입수): M열[옵션명] "N개/구/봉/캔/입" 맨 앞 숫자. "N box/N박스"는
   상품명 기준 박스당 개수(마카롱 8, 쿠키·르뱅·아메리칸 6)를 곱함.
 - 취소: D열[주문상태]='결제취소'만 취소. '구매확정'만 정상 집계, 그 외
   (배송중/재배송중 등 미확정 상태)는 정상·취소 어디에도 넣지 않고 제외.
   → 2026-10-01 변경요청으로 폐기(아래).

기준 변경 (2026-10-01, 김재경 변경요청서 #78):
 - 토스는 배송완료 후 7~14일 뒤에야 자동 구매확정되므로 '구매확정'만 집계하면
   최근 월이 항상 과소 집계된다(9월 48배 차이). → '취소 제외 전체'를 매출로 본다.
 - 취소: D열[주문상태]가 '결제취소'·'반품요청'·'교환요청'(및 취소/반품/교환/환불이
   들어간 변형 상태)인 행만 취소. 그 외('구매확정'·'배송완료'·'배송중'·'재배송중',
   배송준비/결제완료 등 진행 상태, 상태값 공란)는 전부 정상 매출.
 - 상태값은 판별에만 쓰고 line_no·금액·수량에는 넣지 않는다 — '배송중'으로 올린
   행을 나중에 '구매확정'으로 다시 올려도 dedup 해시가 같아 중복 적재되지 않는다.
"""
from __future__ import annotations
import re
from typing import Iterable, Optional

import pandas as pd

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import read_excel_safe, to_datetime, to_float, to_str


def _read_toss(path: str) -> pd.DataFrame:
    raw = read_excel_safe(path, header=None)
    header_idx = None
    for i in range(min(6, len(raw))):
        vals = set(str(v).strip() for v in raw.iloc[i].tolist())
        if "주문일시" in vals and "주문번호" in vals:
            header_idx = i
            break
    if header_idx is None:
        return read_excel_safe(path, header=2)  # 구버전 fallback
    df = raw.iloc[header_idx + 1 :].copy()
    df.columns = [str(c).strip() for c in raw.iloc[header_idx].tolist()]
    return df


# M열[옵션명] 맨 앞 "N개/구/봉/캔/입" 파싱
_UNIT_RE = re.compile(r"^\s*(\d+)\s*(?:개|구|봉|캔|입)")
# "N box" / "N박스" 파싱 (박스당 개수는 상품명으로 판별)
_BOX_RE = re.compile(r"(\d+)\s*(?:box|박스)", re.I)


def _box_per_unit(product_name: Optional[str]) -> Optional[int]:
    """상품명으로 박스당 낱개 판별. 마카롱류=8, 쿠키/르뱅/아메리칸류=6."""
    p = product_name or ""
    if "마카롱" in p:
        return 8
    if any(k in p for k in ("쿠키", "르뱅", "아메리칸")):
        return 6
    return None


def _parse_unit_per_set(option_name: Optional[str], product_name: Optional[str]) -> Optional[float]:
    if not option_name:
        return None
    m = _UNIT_RE.match(option_name)
    if m:
        return float(m.group(1))
    m2 = _BOX_RE.search(option_name)
    if m2:
        per_box = _box_per_unit(product_name)
        if per_box is not None:
            return float(int(m2.group(1)) * per_box)
        return None  # 박스 규격 미상 상품 — 매핑값으로 폴백
    return None


# D열[주문상태] 취소 판별 키워드 — 결제취소/반품요청/교환요청 + 그 변형(반품완료·환불 등)
_CANCEL_KEYWORDS = ("취소", "반품", "교환", "환불")


def _is_cancel_status(status: str) -> bool:
    return any(k in status for k in _CANCEL_KEYWORDS)


@register("토스")
def parse(path: str) -> Iterable[ParsedLine]:
    df = _read_toss(path)

    for _, row in df.iterrows():
        # 가이드 행('수정 불가/수정 가능') 스킵
        if str(row.get("주문일시") or "").startswith("수정 "):
            continue
        sale_dt = to_datetime(row.get("주문일시") or row.get("발송처리일시"))
        if not sale_dt:
            continue
        prod = to_str(row.get("상품명"))
        if not prod:
            continue

        # 취소/반품/교환만 취소, 그 외(구매확정·배송완료·배송중 등)는 전부 정상 매출
        status = to_str(row.get("주문상태") or "") or ""
        is_cancel = _is_cancel_status(status)

        amt = to_float(row.get("주문금액"))
        opt = to_str(row.get("옵션명"))
        yield ParsedLine(
            sale_date=sale_dt.date(),
            sale_datetime=sale_dt,
            order_no=to_str(row.get("주문번호")),
            line_no=to_str(row.get("주문상품번호")),
            raw_product_name=prod,
            raw_option_name=opt,
            raw_qty=to_float(row.get("주문건수") or row.get("수량") or 1),
            gross_amount=0 if is_cancel else amt,
            net_amount=0 if is_cancel else amt,
            refund_amount=amt if is_cancel else 0,
            is_cancelled=is_cancel,
            unit_per_set=_parse_unit_per_set(opt, prod),
        )
