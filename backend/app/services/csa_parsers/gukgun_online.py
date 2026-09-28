"""국군복지단 온라인몰 파서 (신규 채널 — 기준변경요청서 #46, 김재경/MD 2026-07-27).

※ 오프라인 'PX'(국군복지단 PX 월누적 스냅샷, px.py — 파서 별칭 '국군복지단'/'국군 복지단',
   MONTHLY_SNAPSHOT_CHANNELS 등재)와는 별개 채널. 채널명을 '국군복지단'으로 만들면 PX
   파서로 연결되므로 반드시 '국군복지단 온라인'으로 등록한다.

원본: 국군복지단 온라인몰 관리자 '주문내역관리' 엑셀(주문 단위, 첫 주문 2026-07-08).
컬럼: No / 부대코드 / 주문번호(C) / 상품명(D) / 규격 / 수량(F) / 금액(G) / 결제수단 /
  주문고객명 / 주문고객연락처 / 받는고객명 / 받는고객연락처 / 받는고객주소 / 옵션(N) / 배송요청사항
  ⚠️ 고객명·연락처·주소·배송요청사항 = 개인정보 → 읽지 않고 raw_row에도 저장하지 않음.

- 양식 판별: 헤더 {부대코드, 주문번호, 상품명, 수량, 금액, 옵션}이 모두 있어야 파싱(없으면 0행).
- 주문일: 별도 날짜 컬럼 없음 → 주문번호(C, 12자리 숫자) 앞 8자리 YYYYMMDD.
  (예: 202607080871 → 2026-07-08) 형식이 아니면 그 행은 skip. 시각 정보 없음.
- 순매출 = 금액(G) 합. 이미 라인 총액(수량 2 → 26,000 = 13,000×2)이라 수량을 곱하지 않음.
  VAT 포함 소비자가 → VAT_INCLUDED_CHANNELS 등재(적재 시 ÷1.1). 파서는 원천 금액 그대로.
- 낱개 = 입수 × 수량(F). 입수는 옵션(N) 1순위, 옵션에서 파싱 실패 시 상품명(D).
  '총 N구/개/봉/개입/캔' 우선 → 없으면 'N개입/구/봉/개/캔'(파트별 첫 토큰) × 'M박스/BOX',
  '/'로 나뉜 파트는 합산. (benepia._part_val 규칙 + 폼의 'N캔' 단위 추가)
    예) '플레인 7봉' → 7 / '사랑 세트 8구 1박스 총8구' → 8 / '황치즈매니아 4구 2박스 총 8구' → 8
- 주문건수 = 주문번호 고유값. 한 주문이 상품·맛별 여러 행으로 분리됨(샘플 다행 주문 41건).
- 취소·반품 데이터 없음(폼 ④) → is_cancelled=False. 금액<=0 행은 방어적으로 skip.
- line_no = '{상품명}|{옵션}#{같은 주문 내 등장순번}' (순번 기준은 아래 셋째 항목).
    · dedup 해시에 옵션이 들어가지 않아 line_no가 비면 같은 주문의 맛만 다른 행(상품명·
      수량·금액 동일)이 충돌해 탈락한다(샘플 231행 중 35행·458,800원).
    · A열 No(파일 내 순번)는 기간이 겹치는 파일을 재업로드하면 해시가 달라져 이중 적재
      되므로 쓰지 않는다 — 주문 내부 순번만 써서 재업로드해도 같은 해시가 나오게 한다.
    · 순번은 (주문번호, 상품명, 옵션, 수량, 금액)이 완전히 같은 행끼리만 센다(리뷰 2026-09-28).
      수량·금액이 다른 행은 해시에서 이미 구분되므로, 재다운로드 파일의 행 순서가 바뀌어도
      (정렬 역순 등) 순번이 뒤바뀌어 해시가 달라지는 일이 없다.

검증(샘플 '국군 7월 임의.xlsx' 231행, 주문일 2026-07-08~07-27, 로컬 실행 2026-09-28):
  첫 5행      금액 76,920(VAT포함) · 낱개 47 · 주문 4  = 폼 #46 정답 일치
  전체 231행  금액 3,078,660 · 낱개 1,848 · 고유주문 180 · dedup 해시 충돌 0
  07-08~07-11 8행  금액 114,430 · 낱개 71 · 고유주문 4
"""
from __future__ import annotations

import hashlib
import logging
import numbers
import re
from collections import defaultdict
from decimal import Decimal
from typing import Any, Iterable, Optional

import pandas as pd

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import read_excel_safe, to_date, to_float, to_str

log = logging.getLogger(__name__)

# 양식 판별 필수 헤더 (주문내역관리 export)
_REQUIRED_COLS = {"부대코드", "주문번호", "상품명", "수량", "금액", "옵션"}

# ChannelSalesRawLine.line_no = String(100) — 적재 시 100자에서 잘리므로 순번 접미가
# 잘려 나가 충돌하지 않도록 파서에서 먼저 길이를 맞춘다.
# 다중매핑 분할(ingest_lines·/mapping/multi)이 line_no 뒤에 '#m{품목id}'를 붙인 뒤 100자로
# 자르므로 그 몫(12자)을 남겨 둔다 — 안 남기면 분할 라인 해시가 겹쳐 컴포넌트가 탈락(리뷰 2026-09-28).
_LINE_NO_MAX = 100 - 12


# ──────────────────────────────────────────────────────────────
# 낱개수량(입수) 파싱 — benepia._part_val 규칙 + '캔' 단위(폼 #46)
# ──────────────────────────────────────────────────────────────

_UNIT = r"(?:개입|구|봉|개|캔)"
# '총 N구/개입/봉/개/캔' — 파트 내 최우선 값 (예: '1박스 총8구', '2박스 총 8구')
_TOTAL_RE = re.compile(r"총\s*(\d+)\s*" + _UNIT)
# 'N개입' / 'N구' / 'N봉' / 'N개' / 'N캔' — 기본 낱개 카운트(파트 내 첫 토큰)
_CNT_RE = re.compile(r"(\d+)\s*" + _UNIT)
# 'M BOX' / 'M박스' — 배수
_BOX_RE = re.compile(r"(\d+)\s*(?:BOX|박스)", re.I)


def _part_val(part: str) -> float:
    """옵션/상품명 '/'분리 파트 하나의 낱개수량. 못 찾으면 0."""
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


def _text_ups(text: Optional[str]) -> Optional[float]:
    """텍스트 하나의 입수 — '/' 파트별 파싱값 합. 아무 파트도 파싱 안 되면 None."""
    if not text or not text.strip():
        return None
    total = 0.0
    matched = False
    for p in text.split("/"):
        v = _part_val(p)
        if v > 0:
            matched = True
            total += v
    return total if matched else None


def _gukgun_ups(opt: Optional[str], prod: Optional[str]) -> Optional[float]:
    """옵션(N) 1순위, 옵션에서 파싱 실패 시 상품명(D) 2순위(폼 #46 ②).

    benepia._benepia_ups는 옵션이 있으면 상품명을 보지 않지만, 이 채널은 폼 규칙대로
    옵션이 있어도 파싱 실패면 상품명으로 넘어간다. 둘 다 실패면 None(매핑 입수 사용).
    """
    return _text_ups(opt) or _text_ups(prod)


# ──────────────────────────────────────────────────────────────
# 주문번호 / 주문일
# ──────────────────────────────────────────────────────────────

_SCI_RE = re.compile(r"\d+(?:\.\d+)?[eE]\+?\d+")


def _order_no(v: Any) -> Optional[str]:
    """주문번호(12자리 숫자) → 문자열. 숫자 셀이 float로 읽혀도
    '202607080871.0'·'2.02607080871E+11'이 되지 않게 정수 문자열로 정규화."""
    if v is None or isinstance(v, bool):
        return None
    if isinstance(v, numbers.Integral):
        return str(int(v))
    if isinstance(v, float):
        if pd.isna(v):
            return None
        if v.is_integer():
            return str(int(v))
    s = to_str(v)
    if not s:
        return None
    if s.endswith(".0") and s[:-2].isdigit():
        s = s[:-2]
    elif _SCI_RE.fullmatch(s):
        try:
            s = str(int(Decimal(s)))
        except Exception:
            pass
    return s


def _order_date(order_no: str):
    """주문번호 앞 8자리 YYYYMMDD → date. 형식이 아니면 None(행 skip)."""
    d8 = order_no[:8]
    if len(d8) != 8 or not d8.isdigit():
        return None
    d = to_date(d8)
    # to_date의 pd.to_datetime 폴백이 엉뚱한 날짜로 추론하지 않도록 역변환 대조
    if d is None or d.strftime("%Y%m%d") != d8:
        return None
    return d


def _line_no(prod: str, opt: Optional[str], seq: int) -> str:
    """'{상품명}|{옵션}#{순번}'. _LINE_NO_MAX(88자) 초과 시 앞부분을 자르고 원문 digest를 붙여
    순번 접미와 상품·옵션 구분이 잘리지 않게 한다(결정적)."""
    base = f"{prod}|{opt or ''}"
    suffix = f"#{seq}"
    if len(base) + len(suffix) > _LINE_NO_MAX:
        digest = hashlib.sha1(base.encode("utf-8")).hexdigest()[:10]
        base = base[: _LINE_NO_MAX - len(suffix) - len(digest) - 1] + "~" + digest
    return base + suffix


@register("국군복지단 온라인")
def parse(path: str) -> Iterable[ParsedLine]:
    df = read_excel_safe(path, header=0)
    df.columns = [str(c).strip() for c in df.columns]
    missing = _REQUIRED_COLS - set(df.columns)
    if missing:
        # 주문내역관리 양식이 아님 → 0행 (업로드 경로에서 '파싱 결과 0행' 실패로 표시됨)
        log.warning("국군복지단 온라인: 주문내역관리 양식 아님 — 누락 헤더 %s", sorted(missing))
        return

    # 같은 (주문번호, 상품명, 옵션, 수량, 금액) 안의 등장 순번 — line_no 결정성 보장용.
    # 수량·금액까지 키에 넣어 완전 동일 행만 순번으로 구분(행 순서가 바뀐 재다운로드에도 불변)
    seq: dict[tuple[str, str, str, float, float], int] = defaultdict(int)

    for _, row in df.iterrows():
        ono = _order_no(row.get("주문번호"))
        if not ono:
            continue
        sale_d = _order_date(ono)
        if not sale_d:
            continue
        prod = to_str(row.get("상품명"))
        if not prod:
            continue
        opt = to_str(row.get("옵션"))
        qty = to_float(row.get("수량"))
        # 금액(G) = 라인 총액(VAT 포함). 취소 데이터가 없는 채널 — 0/음수는 방어적 skip
        amt = to_float(row.get("금액"))
        if amt <= 0:
            continue

        key = (ono, prod, opt or "", qty, amt)
        seq[key] += 1

        yield ParsedLine(
            sale_date=sale_d,
            sale_datetime=None,
            order_no=ono,
            line_no=_line_no(prod, opt, seq[key]),
            raw_product_name=prod,
            raw_option_name=opt,
            raw_qty=qty,
            gross_amount=amt,
            net_amount=amt,
            is_cancelled=False,
            unit_per_set=_gukgun_ups(opt, prod),
            # 개인정보(고객명·연락처·주소) 보관 금지 → raw_row 미저장
            raw_row=None,
        )
