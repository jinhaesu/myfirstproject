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

톡스토어 골라담기 품목 분해(기준변경요청서 #60 2026-07-28, 장현진 / 2026-09-28 반영):
  상품명 '베이글/바게트/포카치아 … 골라담기' 행이 룰베이스 '가장 긴 일치'로 옵션과 무관하게
  전량 포카치아(4자 > 베이글 3자)에 귀속되던 문제. 옵션 파트의 [베이글]/[바게트]/[포카치아]
  태그대로 낱개를 나눠 품목별 라인으로 분해하고 product_hint로 품목을 확정한다.
  · 전 파트가 태그 1개씩일 때만 분해(같은 태그 합산). 태그 없는 파트가 섞이면 기존대로 1라인.
  · 9월 신형식 '선택2: 베이글7+바게트5+포카치아8'(올인원 패키지) 조합표기도 분해.
  · 태그별 낱개 합이 기존 낱개(_talk_ups)와 같을 때만 분해 — 다르면 폴백(총 낱개 보존).
  · 매출은 낱개 비율 안분(원 단위 반올림, 잔여는 마지막 라인). 취소 행은 분해 안 함
    (품목 미귀속·취소건수=행수 보존).
  · 주문건수(일자×품목 DISTINCT order_no 합) 보존: 첫 분해 라인만 order_no 유지.
  · line_no = '결제번호#주문번호#t태그' (결정적·행 고유 → 재업로드 시 중복 스킵).
  6~9월 원본 검증: 총 낱개·매출·주문·취소건수 불변, 6월 베이글 24,451 / 네모바게트 9,176 / 포카치아 6,890.
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

# 옵션 구성 파트 구분자 — 골라담기 '선택1: …, 선택2: …'
_PART_SPLIT = re.compile(r"[,/]|선택\s*\d+\s*:|옵션\s*\d*\s*:")

# 취소·반품·환불 상태코드 (앞 3자리)
_CANCEL_CODES = {"204", "303", "208", "309", "507", "511", "205", "206"}

# 골라담기 품목 태그 → 표준 품목명(ProductMaster.name) — 폼 #60(2026-07-28)
_BREAD_TAG = re.compile(r"\[\s*(베이글|바게트|포카치아)\s*\]")
# 태그 없는 조합표기 '베이글7+바게트5+포카치아8' — 파트 전체가 조합일 때만(9월 올인원 패키지).
# ('고단백 베이글 7종 1개씩' 같은 설명문은 파트 전체가 아니라 제외)
# 항목 사이 구분자(공백/'+')를 한 가지 방식으로만 매칭 — 인접한 \s* 중첩 반복은 불일치 문자열에서
# 지수 백트래킹(항목 16개에 수 초, 20개면 수 분)으로 배치가 멈춤(2026-09-28 리뷰).
_BREAD_COMBO_PART = re.compile(
    r"(?:베이글|바게트|포카치아)\s*\d+(?:\s*개)?"
    r"(?:(?:\s*\+\s*|\s*)(?:베이글|바게트|포카치아)\s*\d+(?:\s*개)?)*"
    r"(?:\s*\+)?"
)
_BREAD_COMBO = re.compile(r"(베이글|바게트|포카치아)\s*(\d+)")
_BREAD_HINT = {"베이글": "베이글", "바게트": "네모바게트", "포카치아": "포카치아"}


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
        parts = _PART_SPLIT.split(t2)
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


def _bread_split(opt: Optional[str], ups: float) -> Optional[list[tuple[str, float]]]:
    """골라담기 옵션 → [(태그, 세트당 낱개)] (같은 태그 합산, 첫 등장 순). 분해 불가면 None(폴백).

    파트 규칙은 _talk_ups와 동일(중량 제거 → 괄호 무시 → 선택N:/,/ 분리 → _part_val).
    """
    if not opt:
        return None
    t2 = re.sub(r"\([^)]*\)", " ", _WEIGHT.sub(" ", opt))
    parts = [p for p in _PART_SPLIT.split(t2) if p.strip()]
    if not parts:
        return None
    acc: dict[str, float] = {}
    if _BREAD_TAG.search(t2):
        # [베이글]플레인 5개 — 전 파트가 태그 1개씩이어야 함(태그 없는 파트 섞이면 폴백)
        for p in parts:
            tags = _BREAD_TAG.findall(p)
            v = _part_val(p)
            if len(tags) != 1 or v <= 0:
                return None
            acc[tags[0]] = acc.get(tags[0], 0.0) + v
    else:
        # 선택1: [올인원 패키지], 선택2: 베이글7+바게트5+포카치아8 — 조합 파트 1개,
        # 나머지 파트는 개수 없는 이름표만 허용
        combo = [p for p in parts if _BREAD_COMBO_PART.fullmatch(p.strip())]
        if len(combo) != 1:
            return None
        if any(_part_val(p) > 0 for p in parts if p is not combo[0]):
            return None
        for name, n in _BREAD_COMBO.findall(combo[0]):
            acc[name] = acc.get(name, 0.0) + float(n)
    if not acc or any(v <= 0 for v in acc.values()):
        return None
    # 태그별 낱개 합 = 기존 행 낱개일 때만(총 낱개 보존) — 불일치면 폴백
    if abs(sum(acc.values()) - ups) > 1e-9:
        return None
    return list(acc.items())


def _alloc(amount: float, weights: list[float]) -> list[float]:
    """금액을 낱개 비율로 안분 — 원 단위 반올림, 잔여는 마지막 라인(합계 보존)."""
    tot = sum(weights)
    out: list[float] = []
    acc = 0.0
    for i, w in enumerate(weights):
        if i == len(weights) - 1:
            out.append(amount - acc)
        else:
            a = float(round(amount * w / tot))
            out.append(a)
            acc += a
    return out


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
        order_no = to_str(row.get("주문번호"))
        line_no = to_str(row.get("결제번호"))
        raw_qty = to_float(row.get("수량") or 1)
        ups = _talk_ups(opt, prod) if is_talk else None

        # 골라담기 품목 분해(폼 #60) — 톡스토어 유효 행만. 선물하기·취소 행은 기존대로 1라인.
        split = (
            _bread_split(opt, ups)
            if is_talk and not is_cancel and gross is not None else None
        )
        if split:
            amts = _alloc(gross, [v for _, v in split])
            for i, ((tag, v), amt) in enumerate(zip(split, amts)):
                yield ParsedLine(
                    sale_date=sale_dt.date(),
                    sale_datetime=sale_dt,
                    # 첫 라인만 주문번호 유지 — 품목별 DISTINCT 합산 시 주문건수 부풀림 방지
                    order_no=order_no if i == 0 else None,
                    # 결제번호는 한 결제의 여러 행이 공유 → 행 고유키인 주문번호를 함께 넣어야
                    # order_no=None 라인끼리 dedup_hash가 겹치지 않음(6~9월 원본 실측 23건 충돌)
                    line_no=f"{line_no or ''}#{order_no or ''}#t{tag}",
                    raw_product_name=prod,
                    raw_option_name=opt,
                    raw_qty=raw_qty,
                    gross_amount=amt,
                    net_amount=amt,
                    refund_amount=0,
                    is_cancelled=False,
                    unit_per_set=v,
                    product_hint=_BREAD_HINT[tag],
                )
            continue

        yield ParsedLine(
            sale_date=sale_dt.date(),
            sale_datetime=sale_dt,
            order_no=order_no,
            line_no=line_no,
            raw_product_name=prod,
            raw_option_name=opt,
            raw_qty=raw_qty,
            gross_amount=0 if is_cancel else gross,
            net_amount=0 if is_cancel else gross,
            refund_amount=gross if is_cancel else 0,
            is_cancelled=is_cancel,
            unit_per_set=ups,
        )


@register("카카오선물하기")
def parse_gift(path: str) -> Iterable[ParsedLine]:
    return _parse_channel(path, "선물하기")


@register("카카오톡스토어")
def parse_talk(path: str) -> Iterable[ParsedLine]:
    return _parse_channel(path, "톡스토어")
