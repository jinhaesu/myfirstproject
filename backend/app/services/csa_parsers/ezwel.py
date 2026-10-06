"""이지웰 파서.

집계 기준: 매입가(L열, 공급가, 수량이 이미 반영된 총액).
매입가가 없을 경우에만 판매가 fallback 사용.

낱개 입수 (기준변경요청서 #25·#39·#53·#66 김재경, 2026-09-28 반영):
  낱개 = I열[주문수량] × F열[상품코드]별 입수. 판정 순서:
    1) 옵션 분기 코드(아메리칸/르뱅 쿠키 3종) — H열[옵션] 문구로 6/12
    2) 상품코드 매핑표 _EZWEL_UPS_BY_CODE (#25/#39 28종 + MD 회신 2026-09-30 확정 6종)
    3) 표에 없는 코드 — H열 옵션을 '^'로 나눠 세그먼트별 N(개·봉·구·ea) 합산
       (골라담기·자유구성·맛보기 세트. '선택안함' 세그먼트 제외)
    4) 그래도 못 찾으면 #66 규칙 — G열[상품명]/H열에서
       '총 N개/봉/구' → N, 'N종 M개씩' → N×M, 'N개입/구/봉/개' → N, 'M박스'가 붙으면 곱
    5) 모두 실패 → unit_per_set=None(매핑값 사용) + raw_row에 '미매핑' 표시
"""
from __future__ import annotations
import numbers
import re
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Any, Iterable, Optional

import pandas as pd

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import read_excel_safe, to_date, to_datetime, to_float, to_str


# 상품코드(F열) → 낱개 입수 — 폼 #25(2026-07-14)·#39(07-26) 매핑표 28종
# + 4차 반영 MD 회신(김재경, 2026-09-30 대표 승인) 확정분 6종 = 34종.
# 1001036436212(네모 바게트)는 9(#25/#39) → 12로 변경: MD 회신 '옵션 기준 12봉(상품명 9봉 아님)'.
# (#53에서도 12로 적었던 건. 9 기준 과거 정답 6월 4,750·5월 4,863은 이 코드 수량×3만큼 늘어남)
_EZWEL_UPS_BY_CODE: dict[str, int] = {
    "1001035237435": 16,  # 배꼽 베이글 7종 16개입
    "1001035237471": 12,  # 배꼽 베이글 7종 12개입
    "1001035442001": 8,   # 배꼽 베이글 7종 8개입
    "1001036034069": 8,   # 배꼽 베이글 7종 4+4 8개입
    "1002004098118": 8,   # 비건 베이글 7종 8개입
    "1001036436212": 12,  # 네모 바게트 90g — 12봉 (MD 회신 2026-09-30: 상품명 '총9봉' 아님. 기존 9)
    "1001037450024": 9,   # 네모 바게트 90g 총9봉
    "1001039088400": 8,   # 포카치아 2종 8봉
    "1001035239360": 12,  # 통밀식빵 3종 4개입 3set (총12개입)
    "1001036436213": 9,   # 라이트번 모닝빵 3봉 3세트 (총9봉)
    "1001035239307": 8,   # 통밀스콘 3종 8개입
    "1001035229380": 5,   # 크림빵 5개입
    "1001035239979": 5,   # 비건 파운드케이크 (옵션 5EA)
    "1002003899925": 7,   # 쫀득빵 7개
    "1001035229355": 16,  # 크림 휘낭시에 총16개
    "1001036034017": 8,   # 마카롱 8구 1BOX
    "1001035229295": 16,  # 왕 마카롱 16구
    "1002001580424": 16,  # 왕 마카롱 16구
    "1001036621421": 8,   # 마카롱 4구+4구 총8구
    "1001036929378": 16,  # 대왕 마카롱 8구 2박스 (총16구)
    "1001036968167": 16,  # 답례품 뚱카롱 8구 2박스
    "1001035239165": 8,   # 벚꽃 뚱카롱 2종 8구
    "1001038900296": 8,   # 두바이쫀득 뚱카롱 8구 1박스
    "1001036034083": 16,  # 마카롱 8구 + 휘낭시에 8개 세트
    "1001036034365": 12,  # 아메리칸 쿠키 6개입 + 르뱅 쿠키 6개입
    "1001035237745": 12,  # 아메리칸쿠키 12개입 (6ea x 2box)
    "1002000193876": 4,   # 두바이 쫀득 쿠키 4개
    "1001036034060": 12,  # 에너지 드링크 12개입
    # ── 8월 신규 코드 중 MD 확정분 (4차 반영 회신, 2026-09-30) ──
    "1002004449875": 16,  # [오맛특] 크림 휘낭시에 총16개 (8가지맛, 2box)
    "1001036034014": 16,  # 마카롱 사랑+감동 Set 16개입
    "1002004926533": 6,   # [골라담기] 저당 빵 6봉 자유구성
    "1002004534402": 24,  # 통밀스콘 24개입 (3종)
    "1002004926459": 16,  # [골라담기] 디저트 2BOX 세트 (옵션 '아메리칸쿠키 1BOX'는 수량 표기가 없어 규칙 불가)
    "1002004534250": 24,  # 르뱅 쿠키 3BOX — 옵션 '8개입 3BOX' 기준 24 (상품명 '총18개' 아님)
}

# 옵션(H열)에 따라 입수가 갈리는 코드 3종 (#25/#39)
_EZWEL_2BOX_CODES = {"1001035433319", "1001038785566"}  # 아메리칸 쿠키: '2박스' → 12, 아니면 6
_EZWEL_12EA_CODES = {"1001035237731"}                   # 르뱅 쿠키: '12개입' → 12, 아니면 6
_TWO_BOX_RE = re.compile(r"(?<!\d)2\s*(?:박스|box)", re.I)
_TWELVE_EA_RE = re.compile(r"(?<!\d)12\s*개입")

# 낱개 단위 — '구성'·'개월'·'개당'처럼 단위가 아닌 단어는 제외
# 수량은 최대 4자리(\d{1,4})만 인식 — 초장문 숫자가 int()에서 ValueError(4300자리 제한)로
# 터져 배치 전체가 실패하는 것 방지(리뷰 2026-09-28). 어차피 _UPS_MAX 초과라 버려지는 값.
_UNIT = r"(?:개입|개(?!월|당)|봉|구(?!성|매)|ea)"
_TOTAL_RE = re.compile(r"총\s*(\d{1,4})\s*(?:개|봉|구)", re.I)                                   # 총 N개/봉/구
_KIND_EACH_RE = re.compile(r"(?<!\d)(\d{1,4})\s*종\s*(?:각\s*)?(\d{1,4})\s*" + _UNIT + r"\s*씩", re.I)  # N종 (각) M개씩
_EACH_RE = re.compile(r"각\s*(\d{1,4})\s*" + _UNIT + r"\s*씩", re.I)                            # (A+B) 각 N구씩
_COUNT_RE = re.compile(r"(?<!\d)(\d{1,4})\s*" + _UNIT, re.I)                                   # N개입/구/봉/개/ea
# 'N+M구'(예: '블루베리스타 8+8구') — 앞 수에 단위가 없는 합 표기 → 합계로 치환.
# ('4+4 8개입'·'1개+1개'·'[1+1]'·'(2+1)'은 뒤에 단위가 바로 붙지 않아 해당 없음)
_PLUS_SUM_RE = re.compile(r"(?<!\d)(\d{1,4})\s*\+\s*(\d{1,4})\s*(?=" + _UNIT + r")", re.I)
# 수량 토큰 바로 뒤의 'M박스/BOX/세트/set'(괄호 밖) → 곱함. '8구 (1BOX)'·'16구 (2BOX)'처럼
# 괄호 안 박스 표기는 구성 설명이라 곱하지 않음. '6ea x 2box' 형태는 곱함.
_MULT_AFTER_RE = re.compile(r"\s*[x×*]?\s*(\d{1,4})\s*(?:박스|box|세트|set)", re.I)
_UPS_MAX = 200  # 비현실적 값(광고 문구 등) 차단


def _norm_code(v: Any) -> Optional[str]:
    """F열 상품코드 → 13자리 정수 문자열.

    NaN이 섞이면 float(1001035237435.0)로, 텍스트 셀이면 '1.001035237435E+12'로
    올 수 있어 매핑표 조회 전에 정수 문자열로 통일한다(float64는 13자리 정수를 정확히 표현).
    """
    if v is None or isinstance(v, bool):
        return None
    try:
        if pd.isna(v):
            return None
    except (TypeError, ValueError):
        pass
    if isinstance(v, numbers.Integral):  # int·numpy int64
        return str(int(v))
    if isinstance(v, numbers.Real):  # float·numpy float64
        fv = float(v)
        return str(int(fv)) if fv.is_integer() else None
    s = str(v).strip().lstrip("'").replace(",", "")
    if not s or s.lower() in ("nan", "none"):
        return None
    if re.fullmatch(r"\d+(?:\.0*)?", s):
        return s.split(".")[0]
    if re.fullmatch(r"\d+(?:\.\d+)?[eE]\+?\d+", s):  # 지수 표기
        try:
            d = Decimal(s)
            # 20자리 초과(예: '1E+5000')는 상품코드가 아님 — 거대 정수 변환 ValueError로
            # 배치 전체가 실패하지 않게 변환 생략(리뷰 2026-09-28)
            if d == d.to_integral_value() and d.adjusted() < 20:
                return str(int(d))
        except (InvalidOperation, ValueError, OverflowError):
            pass
    return s


def _mult_after(text: str, pos: int) -> int:
    """pos(수량 토큰 끝) 바로 뒤에 'M박스/세트'가 붙어 있으면 M, 아니면 1."""
    m = _MULT_AFTER_RE.match(text, pos)
    if m:
        k = int(m.group(1))
        if k >= 1:
            return k
    return 1


def _expand_plus_sum(text: str) -> str:
    """'8+8구' → '16구' (앞 수에 단위가 없는 합 표기만). 그 외 문자열은 그대로."""
    return _PLUS_SUM_RE.sub(lambda m: str(int(m.group(1)) + int(m.group(2))), text)


def _count_chunk(text: str) -> Optional[int]:
    """옵션 값 한 조각의 낱개 수 — 'N종 (각) M개씩' > 첫 'N개/봉/구/ea'(×뒤따르는 박스·세트)."""
    m = _KIND_EACH_RE.search(text)
    if m:
        return int(m.group(1)) * int(m.group(2)) * _mult_after(text, m.end())
    m = _COUNT_RE.search(text)
    if m:
        return int(m.group(1)) * _mult_after(text, m.end())
    return None


def _ups_from_option(opt: Optional[str]) -> Optional[int]:
    """(a) H열 옵션 '^' 세그먼트별 낱개 합산 — 골라담기·자유구성·맛보기 세트용.

    세그먼트 = '옵션명;값' 또는 '옵션명:값' → 값 부분만 본다('베이글 선택 1' 같은 라벨 숫자 무시).
    '선택안함' 세그먼트는 제외. 값 안의 '+'(예: '블랙티레몬 12개입+캐모마일피치 12개입',
    '넌 사랑이야 8구 (1BOX) + 넌 감동이야 8구 (1BOX)', '1개+1개')는 조각별로 합산.
    '8+8구'는 16, '솔티드+블루베리스타 각 8구씩'은 맛 2종×8=16 (리뷰 2026-09-28 — 매핑표 코드
    1001036929378·1001036968167의 실제 옵션이 이 형태로, 조각 합산만 하면 8로 절반 과소).
    수량을 못 읽는 세그먼트가 하나라도 있으면(예: '아메리칸쿠키 1BOX') None → 다음 규칙.
    """
    if not opt:
        return None
    total = 0
    for seg in str(opt).split("^"):
        seg = seg.strip()
        if not seg:
            continue
        val = re.split(r"[;:]", seg, maxsplit=1)[-1].strip()
        if not val or "선택안함" in val.replace(" ", ""):
            continue
        val = _expand_plus_sum(val)
        m_total = _TOTAL_RE.search(val)
        m_each = None if _KIND_EACH_RE.search(val) else _EACH_RE.search(val)
        if m_total:  # '6개입 3박스(총18개입)' → 총N 우선
            seg_n = int(m_total.group(1))
        elif m_each:  # 'A+B 각 N구씩' → '+'로 나열된 품목 수 × N
            items = [p for p in val[:m_each.start()].split("+") if p.strip()]
            seg_n = max(len(items), 1) * int(m_each.group(1)) * _mult_after(val, m_each.end())
        else:
            seg_n = 0
            for part in val.split("+"):
                n = _count_chunk(part)
                if n:
                    seg_n += n
        if seg_n <= 0:
            return None
        total += seg_n
    return total if 1 <= total <= _UPS_MAX else None


def _ups_from_name(name: Optional[str], opt: Optional[str]) -> Optional[int]:
    """(b) #66 규칙 — G열 상품명 → H열 옵션 순으로
    '총 N개/봉/구' → N, 'N종 M개씩' → N×M, 'N개입/구/봉/개' → N ('M박스'가 붙으면 곱)."""
    texts = [_expand_plus_sum(t) for t in (name, opt) if t]  # '8+8구' → '16구'
    for t in texts:
        m = _TOTAL_RE.search(t)
        if m and 1 <= int(m.group(1)) <= _UPS_MAX:
            return int(m.group(1))
    for t in texts:
        m = _KIND_EACH_RE.search(t)
        if m:
            v = int(m.group(1)) * int(m.group(2)) * _mult_after(t, m.end())
            if 1 <= v <= _UPS_MAX:
                return v
    for t in texts:
        m = _COUNT_RE.search(t)
        if m:
            v = int(m.group(1)) * _mult_after(t, m.end())
            if 1 <= v <= _UPS_MAX:
                return v
    return None


# 네모바게트 1001036436212: 1~3월 옵션 '6봉^6봉'=12, 2026-04 이후 '3봉^3봉^3봉'=9 (MD 회신 2026-10-05)
_NEMO_CODE = "1001036436212"
_NEMO_9_FROM = date(2026, 4, 1)
# 디저트 2BOX 1002004926459: 조합별 — 마카롱 8구×2=16, 아메리칸쿠키 6개×2=12 (MD 회신 2026-10-05)
_DESSERT_2BOX_CODE = "1002004926459"


def _resolve_ups(code: Optional[str], name: Optional[str], opt: Optional[str],
                 sale_d: Optional[date] = None) -> tuple[Optional[int], Optional[dict]]:
    """상품코드·상품명·옵션 → (입수, raw_row 표시). 매핑표 적용 건은 raw_row 없음."""
    opt_s = opt or ""
    if code == _NEMO_CODE:
        return (9 if sale_d and sale_d >= _NEMO_9_FROM else 12), None
    if code == _DESSERT_2BOX_CODE:
        return (12 if "아메리칸" in opt_s else 16), None
    if code in _EZWEL_2BOX_CODES:
        return (12 if _TWO_BOX_RE.search(opt_s) else 6), None
    if code in _EZWEL_12EA_CODES:
        return (12 if _TWELVE_EA_RE.search(opt_s) else 6), None
    if code and code in _EZWEL_UPS_BY_CODE:
        return _EZWEL_UPS_BY_CODE[code], None
    # 표에 없는 신규 코드 — 규칙으로 추정하되 출처를 남겨 MD가 확인할 수 있게 함
    ups = _ups_from_option(opt)
    if ups is not None:
        return ups, {"ups_source": "rule_option", "code": code}
    ups = _ups_from_name(name, opt)
    if ups is not None:
        return ups, {"ups_source": "rule_name", "code": code}
    # 집계에서 빼지 않고 '미매핑' 표시(#25) — 입수는 매핑값(없으면 1)
    return None, {"ups_source": "unmapped", "code": code}


@register("이지웰")
def parse(path: str) -> Iterable[ParsedLine]:
    df = read_excel_safe(path, header=0)
    for _idx, (_, row) in enumerate(df.iterrows()):
        # 주문일시가 숫자형 YYYYMMDDHHMMSS(예: 20260517230737)로 오는 양식 지원
        dt_raw = row.get("주문일자")
        if dt_raw is None or (isinstance(dt_raw, float) and dt_raw != dt_raw):
            dt_raw = row.get("주문일시")
        if isinstance(dt_raw, (int, float)) and dt_raw == dt_raw and dt_raw > 10**13:
            dt_raw = str(int(dt_raw))
        sale_dt = to_datetime(dt_raw)
        if not sale_dt:
            continue
        prod = to_str(row.get("상품명"))
        if not prod:
            continue
        qty = to_float(row.get("주문수량") or row.get("배송(발송)수량") or 1) - to_float(row.get("취소수량") or 0)

        # 주문취소/배송취소 — is_cancelled로 표시(매출/수량 제외, 건수·금액 보존)
        status = (to_str(row.get("주문상태")) or "") + " " + (to_str(row.get("배송(발송)상태")) or "")
        is_cancel = "취소" in status

        # 집계 기준: 매입가(L열, 이미 수량 반영 총액). fallback: 판매가
        # (사내문서의 'M열' 표기는 오기 — #39. 헤더명으로 읽으므로 계산 영향 없음)
        buy_price = to_float(row.get("매입가"))
        gross = buy_price if buy_price else to_float(row.get("판매가"))

        # 낱개 입수: F열 상품코드 매핑표 → 옵션/상품명 규칙 (#25·#39·#53·#66, 2026-09-28).
        # 기존 row.get("Unnamed: 8")(2026-06-12)은 실제 파일에 없는 열이라 입수가 한 번도
        # 적용되지 않았음(I열 헤더 = '주문수량') → 삭제.
        opt = to_str(row.get("옵션"))
        unit_per_set, raw_row = _resolve_ups(_norm_code(row.get("상품코드")), prod, opt, sale_dt.date())

        yield ParsedLine(
            sale_date=sale_dt.date(),
            sale_datetime=sale_dt,
            order_no=to_str(row.get("주문번호")),
            # 같은 주문에 동일 상품 복수 행 dedup 탈락(266→260행) 방지 — 행 시퀀스 부여
            line_no=f"{to_str(row.get('상품코드')) or ''}-{_idx}",
            raw_product_name=prod,
            raw_option_name=opt,
            raw_qty=qty,
            gross_amount=0 if is_cancel else gross,
            net_amount=0 if is_cancel else gross,
            refund_amount=gross if is_cancel else 0,
            unit_per_set=unit_per_set,
            is_cancelled=is_cancel,
            raw_row=raw_row,
        )
