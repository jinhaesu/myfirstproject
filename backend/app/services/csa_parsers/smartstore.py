"""스마트스토어 파서. 원본 파일은 비밀번호 보호이므로 사전에 해제된 파일 전제.

업로드 시점에 비밀번호(기본 0000)를 받아서 미리 풀어주는 처리는 라우터에서.

집계 기준: 최종 상품별 총 주문금액 (할인 후 실결제 총액).
구매확정 파일 기준. 상품가격(정가)은 사용하지 않음.
날짜 기준: 구매확정일 우선 (구매확정 파일이므로). 없으면 결제일/결제일시 fallback.

낱개수량(2026-07 기준변경요청서, 장현진):
  낱개 = 팩 수량 × 수량[W]. 핵심: 고정 SKU는 상품명[Q]의 팩 수량이 정답이고
  옵션정보[U]는 맛 선택일 뿐(선택1 3개입/선택2 4개입 단순 합산 금지).
  · 상품명 '총 N개/봉' 최우선(3봉 3세트(총 9봉) → 9).
  · 'N개+M개' 병기는 합산(레몬얼그레이 3개+4개 → 7). 'N종/N가지'는 맛 종류라 미집계.
  · 옵션 변수형(르뱅쿠키/아메쿠키/에너지드링크)만 옵션 개수 합 × 세트 반영(6개입 2세트 → 12).
  · 휘낭시에·뚱낭시에 세트(상품명 무수량)는 8 × 세트수(8가지맛 3세트 → 24).
  · 마카롱세트 옵션 '+봄카롱 4구'(선택 슬롯 아님)는 가산(16 + 4 → 20).
  6월 샘플 검증: 낱개 합 171,034 vs 담당자 정답 170,327 (+0.41%).
"""
from __future__ import annotations

import re
from typing import Iterable, Optional

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import (
    read_excel_safe, to_datetime, to_float, to_str,
)

_WEIGHT = re.compile(r"\d+(?:\.\d+)?\s*(?:kg|g|ml|l|cm|mm)(?![a-zA-Z가-힣0-9])", re.I)
_CNT = re.compile(r"(\d+)\s*(?:개입|구|개|봉|병|입|매|장|팩|캔|포|알|스틱)")
_SET = re.compile(r"(\d+)\s*(?:세트|셋트|박스|box|set)", re.I)
_TOTAL = re.compile(r"총\s*(\d+)\s*(?:개입|구|개|봉|입|매|장|캔|병)")
_PLUS = re.compile(r"(\d+)\s*(?:개입|구|개|봉|입)?\s*\+\s*(\d+)\s*(?:개입|구|개|봉|입)")

# 옵션이 실제 수량을 정하는 변수형 SKU 키워드
_VARIABLE = ("르뱅", "아메쿠키", "아메리칸 쿠키", "아메리칸쿠키", "에너지드링크", "에너지 드링크")
_FINANCIER = ("휘낭시에", "뚱낭시에")


def _cnts(t: str) -> list[int]:
    return [int(c) for c in _CNT.findall(t) if 1 <= int(c) <= 200]


def _prod_count(name: str) -> int:
    """상품명 팩 총수량: '총N' > 'N+M' 합산 > 첫 개수 토큰."""
    t = _WEIGHT.sub(" ", name or "")
    m = _TOTAL.search(t)
    if m and 1 <= int(m.group(1)) <= 500:
        return int(m.group(1))
    m = _PLUS.search(t)
    if m:
        v = int(m.group(1)) + int(m.group(2))
        if 2 <= v <= 500:
            return v
    c = _cnts(t)
    return c[0] if c else 0


def _ss_ups(prod: Optional[str], opt: Optional[str]) -> float:
    to = _WEIGHT.sub(" ", opt or "")
    pc = _prod_count(prod or "")

    # 옵션 변수형: '총N' > 괄호 제거 후 옵션 개수 합 × 세트
    if any(k in (prod or "") for k in _VARIABLE):
        m = _TOTAL.search(to)
        if m and 1 <= int(m.group(1)) <= 500:
            return float(m.group(1))
        to2 = re.sub(r"\([^)]*\)", " ", to)
        o_c = _cnts(to2)
        o_set = _SET.search(to2)
        n_set = int(o_set.group(1)) if o_set and 1 <= int(o_set.group(1)) <= 20 else 1
        if o_c:
            return float(sum(o_c) * n_set)
        if pc:
            return float(pc * n_set)
        return float(n_set)

    # 고정 SKU: 상품명 팩 수량 (옵션은 맛 선택일 뿐)
    if pc:
        v = float(pc)
        # 마카롱세트 옵션 '+봄카롱 4구' 가산 (선택 슬롯 구조가 아닐 때만)
        if "봄카롱" in to and "+" in to and "선택" not in to and "봄카롱" not in (prod or ""):
            m = re.search(r"봄카롱[^/]*?(\d+)\s*구", to)
            if m:
                v += int(m.group(1))
        return v

    # 상품명 무수량: 휘낭시에·뚱낭시에 세트 = 8 × 세트수
    if any(k in (prod or "") for k in _FINANCIER):
        p_set = _SET.search(_WEIGHT.sub(" ", prod or ""))
        o_set = _SET.search(re.sub(r"\([^)]*\)", " ", to))
        n_set = 1
        if p_set and 1 <= int(p_set.group(1)) <= 20:
            n_set = int(p_set.group(1))
        elif o_set and 1 <= int(o_set.group(1)) <= 20:
            n_set = int(o_set.group(1))
        return float(8 * n_set)

    # 옵션 폴백
    o_c = _cnts(to)
    if o_c:
        o_set = _SET.search(re.sub(r"\([^)]*\)", " ", to))
        n_set = int(o_set.group(1)) if o_set and 1 <= int(o_set.group(1)) <= 20 else 1
        return float(o_c[0] * n_set)
    o_set = _SET.search(to)
    if o_set and 1 <= int(o_set.group(1)) <= 20:
        return float(o_set.group(1))
    return 1.0


@register("스마트스토어")
def parse(path: str) -> Iterable[ParsedLine]:
    df = read_excel_safe(path, header=0)
    for _, row in df.iterrows():
        # 날짜 기준: 구매확정일 우선
        sale_dt = (
            to_datetime(row.get("구매확정일"))
            or to_datetime(row.get("결제일"))
            or to_datetime(row.get("결제일시"))
            or to_datetime(row.get("주문일시"))
        )
        if not sale_dt:
            continue
        prod = to_str(row.get("상품명")) or to_str(row.get("상품 종류"))
        if not prod:
            continue

        # 매출 집계 기준 = 최종 상품별 총 주문금액(AC). (할인 반영 실주문금액)
        # fallback: 최초 상품별 총 주문금액 → 정산예정금액 → 상품가격
        amt = (
            to_float(row.get("최종 상품별 총 주문금액"))
            or to_float(row.get("최초 상품별 총 주문금액"))
            or to_float(row.get("정산예정금액"))
            or to_float(row.get("상품가격"))
        )
        gross = amt
        net = amt

        opt = to_str(row.get("옵션정보") or row.get("옵션"))
        yield ParsedLine(
            sale_date=sale_dt.date(),
            sale_datetime=sale_dt,
            order_no=to_str(row.get("주문번호")),
            line_no=to_str(row.get("상품주문번호")),
            raw_product_name=prod,
            raw_option_name=opt,
            raw_qty=to_float(row.get("수량") or 1),
            gross_amount=gross,
            net_amount=net,
            commission=to_float(row.get("네이버페이 주문관리 수수료") or row.get("매출연동 수수료") or row.get("수수료")),
            unit_per_set=_ss_ups(prod, opt),
        )