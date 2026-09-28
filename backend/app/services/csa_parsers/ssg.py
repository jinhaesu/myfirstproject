"""SSG 파서. 세 가지 리포트 포맷 지원.

1) 발주/출고형 (약 65컬럼, HTML 위장 xls):
   출고기준일·지시수량·취소수량·판매가·공급가 …
2) 업체주문관리 조회형 (20컬럼, HTML 위장 xls):
   순번·주문번호·주문일시·주문구분·주문상품상태·상품명·옵션·주문수량·
   주문금액·할인금액…·실주문금액 …
   → 주문일시=매출일, 주문금액=소비자가(VAT포함, ingest에서 ÷1.1),
     취소/반품/환불 상태 행은 제외.
3) 납품현황형(2026-08 기준변경요청서 #62, 염재영, 2026-05-01~) — SSG(사입):
   이마트 SCM '엑셀저장' 시트(24컬럼, 이마트 노브랜드 B포맷과 동일 양식)
   점포코드·…·상품코드·상품명(H)·납품일자(YYYYMMDD)·발주일자·문서번호·납품구분·
   발주량·납품량(N)·발주금액·납품금액(P)·원가·…·매입구분명·원상품코드
   → 납품일자=매출일, 납품량=수량(발주량 아님), 납품금액=매출(공급가·VAT 별도 —
     SSG(사입)은 VAT_INCLUDED_CHANNELS에서 제외돼 ÷1.1 안 함), 상품명 입수로 낱개 환산.
   헤더에 납품량·납품금액이 모두 있으면 이 포맷으로 분기(_parse_supply).
   ※ 'SSG'·'SSG닷컴'은 VAT 포함 채널이라 납품현황은 반드시 SSG(사입)에 업로드.

읽기는 read_excel_safe(HTML 위장 xls·인코딩 자동) 사용 후 '상품명' 포함 행을
헤더로 승격 — read_html(header=0)의 인덱스 컬럼명 오인 현상 회피.
"""
from __future__ import annotations

import re
from decimal import Decimal, InvalidOperation
from typing import Any, Iterable, Optional

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import read_excel_safe, to_date, to_float, to_str

# 주문구분/주문상품상태에 포함되면 매출에서 제외할 토큰
_CANCEL_TOKENS = ("취소", "반품", "환불")

# 납품현황형 상품명의 입수 토큰 — '(100g*6개입)'·'(50g x 8개입)'·'90g*4봉' 등
_SUPPLY_UPS_RE = re.compile(r"(\d+)\s*(개입|봉|구)")
# 폼 #62 ② 명시 토큰 — 앞에 숫자가 붙은 '18개입'·'16개입'·'24봉'을 8·6·4로 오인하지 않도록
# 숫자 경계(?<!\d)로 매칭 (단순 부분문자열 검사는 '18개입' ⊃ '8개입')
_SUPPLY_FIXED_UPS = (
    (re.compile(r"(?<!\d)8\s*개입"), 8.0),
    (re.compile(r"(?<!\d)6\s*개입"), 6.0),
    (re.compile(r"(?<!\d)4\s*봉"), 4.0),
)
# 지수표기 숫자 문자열('8.809795334879E+12') — 엑셀이 긴 코드를 과학표기로 저장한 경우
_SCI_RE = re.compile(r"\d+(?:\.\d+)?[eE]\+?\d+")


def _ssg_supply_ups(name: Optional[str]) -> Optional[float]:
    """납품현황 상품명(H) → 낱개 입수 (폼 #62 ② 산식).

    '8개입'→8, '6개입'→6, '4봉'→4, '슬랩'→1, 그 외 'N개입/N봉/N구' 중 최대값.
    토큰이 없으면 None — ingest가 채널 매핑 입수(매핑 없으면 1)를 쓰도록 둔다.
    (1을 박으면 관리자가 매핑 화면에서 등록한 입수가 무시됨 — 2026-09 리뷰)
    """
    t = name or ""
    for rx, ups in _SUPPLY_FIXED_UPS:
        if rx.search(t):
            return ups
    if "슬랩" in t:
        return 1.0
    vals = [int(m.group(1)) for m in _SUPPLY_UPS_RE.finditer(t)]
    vals = [v for v in vals if 1 <= v <= 200]
    return float(max(vals)) if vals else None


def _code_str(v: Any) -> Optional[str]:
    """상품코드·문서번호 문자열화 — 숫자 셀이 float로 읽혀 '…0.0'이 붙거나
    지수표기('8.8E+12')로 오는 것을 정수 문자열로 통일(같은 행이면 같은 line_no)."""
    s = to_str(v)
    if s and s.endswith(".0") and s[:-2].isdigit():
        s = s[:-2]
    elif s and _SCI_RE.fullmatch(s):
        try:
            d = Decimal(s)
            if d == d.to_integral_value():
                s = str(int(d))
        except (InvalidOperation, ValueError):
            pass
    return s


def _parse_supply(df) -> Iterable[ParsedLine]:
    """3) 납품현황형(폼 #62) — 헤더 승격된 df를 받아 행별 ParsedLine 생성."""
    # (문서번호, 상품코드, 점포명, 매출일) 내 등장순번 — line_no를 결정적으로 만들기 위함
    # (파일 내 절대 행번호를 쓰면 재업로드·기간 겹침 파일에서 dedup이 깨짐.
    #  매출일까지 키에 넣어야 다른 날 온 반품행이 기간 겹침 파일에서 순번이 밀리지 않음 — 2026-09 리뷰)
    seq: dict[tuple, int] = {}
    for _, row in df.iterrows():
        prod = to_str(row.get("상품명"))
        if not prod or prod == "상품명":
            continue
        # 매출일 = 납품일자(YYYYMMDD, to_date가 8자리 처리), 없으면 발주일자
        sale_d = to_date(row.get("납품일자")) or to_date(row.get("발주일자"))
        if not sale_d:
            continue
        qty = to_float(row.get("납품량"))        # N열 — 발주량(M)과 다를 수 있음
        gross = to_float(row.get("납품금액"))    # P열 — 납품량×원가(공급가)
        if qty == 0 and gross == 0:
            continue  # 미납(결품) 행 — 매출·주문건수에 넣지 않음
        # 매입구분명 '반품'/'취소' → 수량·금액 음수 (이마트 노브랜드 B포맷과 동일)
        ctype = to_str(row.get("매입구분명")) or ""
        if "반품" in ctype or "취소" in ctype:
            qty = -abs(qty)
            gross = -abs(gross)
        order_no = _code_str(row.get("문서번호"))
        sku = _code_str(row.get("상품코드")) or _code_str(row.get("원상품코드")) or ""
        store = to_str(row.get("점포명")) or to_str(row.get("센터명")) or ""
        k = (order_no, sku, store, sale_d)
        seq[k] = seq.get(k, 0) + 1
        yield ParsedLine(
            sale_date=sale_d,
            order_no=order_no,
            line_no=f"{sku}@{store}#{seq[k]}",
            raw_product_name=prod,
            raw_option_name=None,  # 점포명은 옵션으로 넣지 않음 — 상품명 단일 매핑
            raw_qty=qty,
            gross_amount=gross,
            net_amount=gross,
            settlement_amount=gross,
            unit_per_set=_ssg_supply_ups(prod),
        )


@register("SSG")
@register("SSG닷컴")
@register("SSG(사입)")  # 채널 표시명 변경(2026-07-19, 온라인 사입 명시) — 파서는 동일
def parse(path: str) -> Iterable[ParsedLine]:
    df = read_excel_safe(path, header=None)
    if df is None or df.empty:
        return

    # '상품명'이 들어 있는 행을 헤더로 승격 (보통 0행)
    hdr = None
    for i in range(min(5, len(df))):
        if any("상품명" in str(c) for c in df.iloc[i].tolist()):
            hdr = i
            break
    if hdr is None:
        return
    new_header = [str(c).strip() for c in df.iloc[hdr].tolist()]
    df = df[hdr + 1:].reset_index(drop=True)
    df.columns = new_header

    # 3) 납품현황형(폼 #62, 2026-09 반영) — 기존 2포맷은 날짜·수량·금액 컬럼이 없어 0행이 됨
    if {"납품량", "납품금액"} <= set(new_header):
        yield from _parse_supply(df)
        return

    for _, row in df.iterrows():
        # 출고기준일(발주형) → 주문일시(주문관리형) 순으로 매출일 결정
        sale_d = (
            to_date(row.get("출고기준일"))
            or to_date(row.get("출고예정일"))
            or to_date(row.get("주문일자"))
            or to_date(row.get("주문일시"))
        )
        if not sale_d:
            continue
        prod = to_str(row.get("상품명"))
        if not prod or prod == "상품명":
            continue
        # 주문관리형: 취소/반품/환불 상태 행 제외
        state = (to_str(row.get("주문상품상태")) or "") + (to_str(row.get("주문구분")) or "")
        if any(t in state for t in _CANCEL_TOKENS):
            continue
        qty = to_float(row.get("지시수량") or row.get("주문수량") or 1)
        cancel_qty = to_float(row.get("취소수량") or 0)
        net_qty = qty - cancel_qty
        if net_qty <= 0:
            continue
        gross = to_float(
            row.get("판매가") or row.get("결제금액") or row.get("상품금액")
            or row.get("주문금액")
        )
        net = to_float(
            row.get("공급가") or row.get("정산금액") or row.get("실주문금액")
        ) or gross
        yield ParsedLine(
            sale_date=sale_d,
            order_no=to_str(row.get("주문번호")),
            line_no=to_str(row.get("상품번호") or row.get("배송번호")),
            raw_product_name=prod,
            raw_option_name=to_str(row.get("옵션명") or row.get("옵션")),
            raw_qty=net_qty,
            gross_amount=gross,
            net_amount=net,
        )
