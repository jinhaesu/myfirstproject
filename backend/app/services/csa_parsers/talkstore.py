"""톡스토어&선물하기 (통합) 파서.

통합 엑셀에 '채널' 컬럼(선물하기/톡스토어)이 존재.
카카오선물하기 파서는 채널='선물하기' 행만, 카카오톡스토어 파서는 채널='톡스토어' 행만 처리.
집계 기준: 상품금액 (수량이 이미 반영된 총액).

톡스토어 낱개수량·취소판별(2026-07 기준변경요청서, 장현진):
  낱개 = 옵션[I]의 구성 개수 × 수량[J].
  · '총 N구/개' 표기가 있으면 그 값을 최종값으로 우선(뚱낭시에 8구 2세트 (총16구) → 16).
  · 괄호 안 내역은 총량의 분해이므로 무시(8구(4구+4구) → 8).
  · 골라담기(선택1/선택2…)는 각 선택 파트의 개수×세트를 합산(5개+5개 → 10).
  · 옵션에 개수 없으면 상품명[H] 기준(아메리칸쿠키 6종 1박스 → 6).
  취소·반품 = 주문상태[D] 코드 앞 3자리 204·303(결제취소)/208·309(환불)/507·511(반품)/205·206(환불대기).
  6월 샘플 검증: 낱개 합 52,429 vs 담당자 정답 52,419 (+0.02%).
  ※ 선물하기는 기존 기준(매핑 입수·'취소' 문자열) 유지 — 본 규칙은 톡스토어 행에만 적용.
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
_CNT_PROD = re.compile(r"(\d+)\s*(?:개입|구|개|봉|병|입|매|장|팩|캔|종)")
_SET = re.compile(r"(\d+)\s*(?:세트|셋트|박스|box|set)", re.I)
_TOTAL = re.compile(r"총\s*(\d+)\s*(?:개입|구|개|봉|입|매|장|캔|병)")

# 취소·반품·환불 상태코드 (앞 3자리)
_CANCEL_CODES = {"204", "303", "208", "309", "507", "511", "205", "206"}


def _part_val(part: str) -> float:
    """옵션 구성 파트 하나: N개 × M세트/박스."""
    cm = _CNT.search(part)
    sm = _SET.search(part)
    n = int(cm.group(1)) if cm and 1 <= int(cm.group(1)) <= 200 else 0
    m = int(sm.group(1)) if sm and 1 <= int(sm.group(1)) <= 20 else 1
    return float(n * m)


def _talk_ups(opt: Optional[str], prod: Optional[str]) -> float:
    t = _WEIGHT.sub(" ", opt or "")
    if t.strip():
        m = _TOTAL.search(t)
        if m:
            return float(m.group(1))
        t2 = re.sub(r"\([^)]*\)", " ", t)
        parts = re.split(r"[,/]|선택\s*\d+\s*:|옵션\s*\d*\s*:", t2)
        total = sum(_part_val(p) for p in parts if p.strip())
        if total >= 1:
            return total
    tp = re.sub(r"\([^)]*\)", " ", _WEIGHT.sub(" ", prod or ""))
    m = _TOTAL.search(tp)
    if m:
        return float(m.group(1))
    cnts = [int(c) for c in _CNT_PROD.findall(tp) if 1 <= int(c) <= 200]
    if cnts:
        sm = _SET.search(tp)
        n_set = int(sm.group(1)) if sm and 1 <= int(sm.group(1)) <= 20 else 1
        return float(cnts[0] * n_set)
    return 1.0


def _talk_is_cancel(status: str) -> bool:
    m = re.match(r"\s*(\d{3})", status or "")
    if m:
        return m.group(1) in _CANCEL_CODES
    return "취소" in (status or "")


def _parse_channel(path: str, channel_filter: str) -> Iterable[ParsedLine]:
    df = read_excel_safe(path, header=0)
    is_talk = channel_filter == "톡스토어"
    for _, row in df.iterrows():
        # 채널 컬럼이 있으면 해당 채널만 처리, 없으면 전체 처리
        ch_col = to_str(row.get("채널"))
        if ch_col is not None and ch_col != channel_filter:
            continue

        # 취소 주문 — 버리지 않고 is_cancelled로 표시
        status = to_str(row.get("주문상태") or "") or ""
        if is_talk:
            is_cancel = _talk_is_cancel(status)
        else:
            is_cancel = "취소" in status

        sale_dt = to_datetime(row.get("주문일") or row.get("발송요청일") or row.get("결제일") or row.get("주문일시"))
        if not sale_dt:
            continue
        prod = to_str(row.get("상품명"))
        if not prod:
            continue

        opt = to_str(row.get("옵션"))
        # 매출 = 정산기준금액(있으면, 카카오선물하기 양식 O열) > 상품금액(통합 양식, 수량 반영 총액)
        gross = to_float(row.get("정산기준금액")) or to_float(row.get("상품금액"))
        yield ParsedLine(
            sale_date=sale_dt.date(),
            sale_datetime=sale_dt,
            order_no=to_str(row.get("주문번호")),
            line_no=to_str(row.get("결제번호")),
            raw_product_name=prod,
            raw_option_name=opt,
            raw_qty=to_float(row.get("수량") or 1),
            gross_amount=0 if is_cancel else gross,
            net_amount=0 if is_cancel else gross,
            refund_amount=gross if is_cancel else 0,
            is_cancelled=is_cancel,
            unit_per_set=_talk_ups(opt, prod) if is_talk else None,
        )


@register("카카오선물하기")
def parse_gift(path: str) -> Iterable[ParsedLine]:
    return _parse_channel(path, "선물하기")


@register("카카오톡스토어")
def parse_talk(path: str) -> Iterable[ParsedLine]:
    return _parse_channel(path, "톡스토어")
