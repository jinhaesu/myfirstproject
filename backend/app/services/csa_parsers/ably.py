"""에이블리 파서. 기간별 상품 집계 파일 (날짜 컬럼 없음).

시트명: 통계
컬럼 구조 (header=0):
  [0] 상품명  [1] 옵션명  [2] 거래액  [3] 판매수량  [4] 상품찜 수  [5] 장바구니 수

sale_date는 파일명에서 추출 (예: 에이블리_2026-05-01_2026-05-12.xlsx → 2026-05-01).
gross_amount = 거래액 (소비자 결제 총액, 수량 포함).

방어 로직: openpyxl이 시트명을 제대로 읽지 못할 경우 인덱스 0번 시트 사용.
컬럼명 매칭 실패 대비 iloc 인덱스 fallback 추가.
"""
from __future__ import annotations
import re
from datetime import date
from typing import Iterable
import os

import pandas as pd

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import read_excel_safe, to_datetime, to_float, to_str


# ---- 낱개수량 (2026-07 기준변경요청서, 장현진) ----
# 낱개 = 옵션 정보[H]를 '/'로 분할, 파트별 개수 곱(르뱅 6개입 2개입 → 12) 합산 × 수량[I].
# · 개수 없는 'N세트' 파트는 수량 배수(뚱낭시에/2세트 → 상품명 8개 × 2 = 16).
# · 파트에 개수 없고 괄호 안에 구성(마카롱 8ea 뚱낭시에 8ea…)이 있으면 그 합(랜덤박스 → 28, 음료 포함).
# · 옵션에 개수 없으면 상품명[E] 기준(휘낭시에 8개 1세트 → 8).
# 취소·환불 = 주문상태[X] '취소 완료'/'반품 완료'.
# 6월 샘플 검증: 낱개 합 1,355 = 담당자 정답 1,355 (정확 일치).
_WEIGHT = re.compile(r"\d+(?:\.\d+)?\s*(?:kg|g|ml|l|cm|mm)(?![a-zA-Z가-힣0-9])", re.I)
_CNT = re.compile(r"(\d+)\s*(?:개입|구|개|봉|병|입|매|장|팩|캔|포|알|스틱)")
_CNT_INNER = re.compile(r"(\d+)\s*(?:ea|개입|구|개|봉|병|입|매|장|캔)", re.I)
_SET = re.compile(r"(\d+)\s*(?:세트|셋트|박스|box|set)", re.I)


def _prod_base(prod: str) -> float:
    t = re.sub(r"\([^)]*\)", " ", _WEIGHT.sub(" ", prod or ""))
    cnts = [int(c) for c in _CNT.findall(t) if 1 <= int(c) <= 200]
    return float(cnts[0]) if cnts else 0.0


def _ably_ups(opt: str | None, prod: str | None) -> float:
    t = _WEIGHT.sub(" ", opt or "")
    vals: list[float] = []
    mult = 1
    if t.strip():
        for part in t.split("/"):
            part = part.strip()
            if not part:
                continue
            p2 = re.sub(r"\([^)]*\)", " ", part)
            cnts = [int(c) for c in _CNT.findall(p2) if 1 <= int(c) <= 200]
            sm = _SET.search(p2)
            if not cnts and sm and 1 <= int(sm.group(1)) <= 20:
                mult *= int(sm.group(1))
                continue
            if not cnts:
                inner = " ".join(re.findall(r"\(([^)]*)\)", part))
                ic = [int(x) for x in _CNT_INNER.findall(inner) if 1 <= int(x) <= 200]
                if ic:
                    vals.append(float(sum(ic)))
                continue
            v = 1.0
            for c in cnts:
                v *= c
            if sm and 1 <= int(sm.group(1)) <= 20:
                v *= int(sm.group(1))
            vals.append(v)
    if vals:
        return sum(vals) * mult
    base = _prod_base(prod or "")
    return (base if base else 1.0) * mult


def _parse_order_list(df: pd.DataFrame) -> Iterable[ParsedLine]:
    """에이블리 '전체주문내역'(주문 단위) 양식.
    컬럼: 결제일 / 상품주문번호 / 주문번호 / 상품명 / 판매가 / 수량 / 결제액 / 주문상태 ...
    날짜=결제일, 매출(net)=결제액(실결제), 주문상태 '취소 완료'/'반품 완료'는 is_cancelled.
    """
    for _, row in df.iterrows():
        sale_dt = to_datetime(row.get("결제일") or row.get("주문일") or row.get("결제일시"))
        if not sale_dt:
            continue
        prod = to_str(row.get("상품명"))
        if not prod:
            continue
        status = to_str(row.get("주문상태") or "") or ""
        # 담당자 검증: X열 '취소 완료'/'반품 완료'만 취소·환불 (웹 취소건수와 6개월 100% 일치)
        is_cancel = ("취소 완료" in status) or ("반품 완료" in status) or ("환불" in status)
        qty = to_float(row.get("수량") or 1)
        opt = to_str(row.get("옵션 정보") or row.get("옵션명"))
        # 매출 = 결제액(L) 그대로. 결제액=0(쿠폰 전액결제)도 0으로 둠
        # → gross도 결제액으로 둬서 ingest의 (net or gross) 폴백이 판매가를 끌어오지 않게 함.
        net = to_float(row.get("결제액"))
        gross = net
        yield ParsedLine(
            sale_date=sale_dt.date(),
            sale_datetime=sale_dt,
            order_no=to_str(row.get("주문번호")),
            line_no=to_str(row.get("상품주문번호")),
            raw_product_name=prod,
            raw_option_name=opt,
            raw_qty=qty,
            gross_amount=0 if is_cancel else gross,
            net_amount=0 if is_cancel else net,
            refund_amount=net if is_cancel else 0,
            is_cancelled=is_cancel,
            unit_per_set=_ably_ups(opt, prod),
        )


def _extract_date_from_filename(path: str) -> date:
    """파일명에서 시작 날짜 추출 (예: '에이블리_2026-05-01_2026-05-12.xlsx')."""
    name = os.path.basename(path)
    m = re.search(r"(\d{4})[-_./](\d{1,2})[-_./](\d{1,2})", name)
    if m:
        try:
            return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        except Exception:
            pass
    return date.today()


def _read_ably(path: str) -> pd.DataFrame:
    """에이블리 xlsx 읽기. 시트 인덱스 0 강제 사용으로 시트명 인코딩 문제 회피."""
    try:
        # sheet_name=0: 시트명 대신 인덱스로 읽어 한글 시트명 인코딩 문제 방지
        return pd.read_excel(path, engine="openpyxl", sheet_name=0, header=0)
    except Exception:
        pass
    # fallback: read_excel_safe
    return read_excel_safe(path, header=0)


@register("에이블리")
@register("Ably")
def parse(path: str) -> Iterable[ParsedLine]:
    df = _read_ably(path)
    if df.empty:
        return

    # 양식 감지: '전체주문내역'(결제일+결제액 컬럼) vs '통계'(기간집계)
    cols_set = {str(c).strip() for c in df.columns}
    if "결제일" in cols_set and ("결제액" in cols_set or "판매가" in cols_set):
        yield from _parse_order_list(df)
        return

    sale_d = _extract_date_from_filename(path)
    cols = list(df.columns)

    for _, row in df.iterrows():
        # 컬럼명 우선, 실패 시 iloc 인덱스 fallback
        prod = to_str(row.get("상품명") or (row.iloc[0] if len(cols) > 0 else None))
        if not prod:
            continue

        # 거래액 = 소비자 결제 기준 총액 (수량 포함)
        gross = to_float(
            row.get("거래액")
            if row.get("거래액") is not None
            else (row.iloc[2] if len(cols) > 2 else 0)
        )
        qty = to_float(
            row.get("판매수량")
            if row.get("판매수량") is not None
            else (row.iloc[3] if len(cols) > 3 else 0)
        )
        opt = to_str(
            row.get("옵션명")
            if row.get("옵션명") is not None
            else (row.iloc[1] if len(cols) > 1 else None)
        )

        if qty == 0 and gross == 0:
            continue

        yield ParsedLine(
            sale_date=sale_d,
            raw_product_name=prod,
            raw_option_name=opt,
            raw_qty=qty,
            gross_amount=gross,
            net_amount=gross,
        )
