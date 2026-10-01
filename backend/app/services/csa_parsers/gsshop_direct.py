"""GS 샵(직택배) 파서 — 신규 채널(기준변경요청서 #64 2026-09-23, 임현정 / 대표 결정 2026-10-01).

원본: GS SHOP 협력사 포털 '직택배집하택배상세' xlsx(41열, 헤더 1행). 홈쇼핑 직매입(직택배)
  물량으로, 기존 'GS 샵'(주문배송관리·업체직송, gsshop.py) 파일에는 나오지 않는다(주문 겹침 0).
  기존 GS 샵은 협력사지급금액 기준이라 매출 기준이 달라 **별도 채널**로 분리했다.

열은 **헤더명**으로 읽는다:
  출하지시일(B) / 주문번호(F) / 주문출하지시번호(H) / 주문상태(I) / 송장상품명(Q) /
  노출상품명(R) / 주문옵션(S) / 수량(V) / 주문유형(AL) / 판매가(AM) / 업체지급액(AO)
  · 고객명·수취인명·고객번호·우편번호·주소·운송장 열은 읽지 않는다(개인정보 미적재).

- 양식 판별: 헤더에 {출하지시일, 주문번호, 주문출하지시번호, 수량, 판매가, 업체지급액}과
  노출상품명/송장상품명 중 하나가 모두 있어야 파싱. 아니면 0행 → 배치 'failed'
  (기존 GS 샵 주문배송관리 파일을 잘못 올리면 눈에 보이게 실패).
- 매출 = 판매가(AM, VAT 포함). 파서는 원천 금액 그대로 gross/net에 넣고, 적재 시 ÷1.1
  (VAT_INCLUDED_CHANNELS 'GS 샵(직택배)'). 업체지급액(AO)은 settlement_amount에 참고 보존.
  ⚠️ 샘플 713행이 전부 수량 1이라 판매가가 단가인지 라인 총액인지 미확인 — 원천 값 그대로 사용.
- 매출 기준일 = 출하지시일(B). 날짜가 없는 행은 skip.
- 주문건수 = 주문번호 고유값(분할출하로 한 주문이 여러 행 — 샘플 713행/662건).
- line_no = 주문출하지시번호(행마다 고유, 파일 내 위치와 무관 → 기간이 겹치는 재업로드에 멱등).
  주문아이템번호는 분할출하 행끼리 같아 dedup 해시가 충돌하므로 쓰지 않는다.
- 제외(is_cancelled=True, 매출·낱개 0):
    · 주문유형 '교환…'(교환주문 = 재출고, 신규 매출 아님) → refund 0 (환불이 아님).
      샘플 1행(2026-08-26, 59,900원): 주문유형='교환주문', 입금확인일 공란.
    · 주문유형 '반품…'/'취소…' 또는 주문상태에 '취소'·'반품' → refund = 판매가.
      (샘플은 배송완료 711·출고완료 2뿐 — 이 리포트에 취소·반품이 실리는지 미확인)
- 낱개 = 입수 × 수량. 입수는 노출상품명 → 송장상품명 순으로 추출:
    ① '총 N개/구/봉/개입'                → N
    ② 'N개씩'이 아닌 'N개/구/봉/개입'     → 가장 큰 N  ('D널담_네모바게트5종_7개씩_35개' → 35)
    ③ 'N개씩' × 'M종'                    → N×M        ('5종 7개씩' → 35)
    ④ 못 찾으면 None → 채널 매핑 입수 사용.

검증(샘플 '직택배집하택배상세(2026-08-22~2026-09-21).xlsx', 출하지시일 2026-08-24~09-21):
  713행 · 판매가 합 42,708,700(÷1.1 = 38,826,091) · 교환주문 1행 제외 42,648,800(÷1.1 = 38,771,636)
  낱개 24,955(35×713, 교환 제외 24,920) · 고유주문 662 · dedup 해시 충돌 0
"""
from __future__ import annotations

import re
from typing import Iterable, Optional

import pandas as pd

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import read_excel_safe, to_date, to_float, to_str

# 양식 판별 필수 헤더 — 주문출하지시번호·업체지급액은 주문배송관리(업체직송) 양식에 없다
_REQUIRED_COLS = {"출하지시일", "주문번호", "주문출하지시번호", "수량", "판매가", "업체지급액"}
_NAME_COLS = ("노출상품명", "송장상품명")

_UNIT = r"(?:개입|구|개|봉)"
_TOTAL = re.compile(rf"총\s*(\d+)\s*{_UNIT}")
_CNT = re.compile(rf"(\d+)\s*{_UNIT}(?!\s*씩)")
_EACH = re.compile(rf"(\d+)\s*{_UNIT}\s*씩")
_KINDS = re.compile(r"(\d+)\s*종")
_WEIGHT = re.compile(r"\d+(?:\.\d+)?\s*(?:kg|g|ml|l)(?![a-zA-Z가-힣0-9])", re.I)


def _norm(v) -> str:
    return re.sub(r"\s+", "", str(v))


def _id(v) -> Optional[str]:
    """주문번호·출하지시번호 — 숫자 셀이 float로 읽혀도 '123.0' 꼬리 제거."""
    s = to_str(v)
    if s and re.fullmatch(r"\d+\.0", s):
        s = s[:-2]
    return s


def _units_one(name: Optional[str]) -> Optional[float]:
    if not name:
        return None
    s = _WEIGHT.sub(" ", name)
    m = _TOTAL.search(s)
    if m and 1 <= int(m.group(1)) <= 500:
        return float(m.group(1))
    nums = [int(x) for x in _CNT.findall(s) if 1 <= int(x) <= 500]
    if nums:
        return float(max(nums))
    e, k = _EACH.search(s), _KINDS.search(s)
    if e and k:
        n = int(e.group(1)) * int(k.group(1))
        if 1 <= n <= 500:
            return float(n)
    return None


def unit_per_set(*names: Optional[str]) -> Optional[float]:
    """세트 입수 — 앞에서부터 처음 추출되는 상품명 사용. 못 찾으면 None(매핑 입수)."""
    for n in names:
        u = _units_one(n)
        if u:
            return u
    return None


def _is_report(cols: set) -> bool:
    return _REQUIRED_COLS <= cols and any(c in cols for c in _NAME_COLS)


def _read(path: str) -> Optional[pd.DataFrame]:
    """헤더명 기준 읽기. 상단 제목행이 있으면 헤더 행을 찾아 재지정. 양식이 아니면 None."""
    try:
        df = read_excel_safe(path, header=0, dtype=str)
    except Exception:
        return None
    if df is None or df.empty:
        return None
    if not _is_report({_norm(c) for c in df.columns}):
        for i in range(min(len(df), 15)):
            if _is_report({_norm(v) for v in df.iloc[i].tolist()}):
                df.columns = df.iloc[i].tolist()
                df = df.iloc[i + 1:].reset_index(drop=True)
                break
        else:
            return None
    df.columns = [_norm(c) for c in df.columns]
    return df


@register("GS 샵(직택배)")
@register("GS샵(직택배)")
def parse(path: str) -> Iterable[ParsedLine]:
    df = _read(path)
    if df is None:
        return  # 직택배집하택배상세 양식 아님 → 0행(배치 failed)
    seen_fallback: dict[str, int] = {}
    for _, row in df.iterrows():
        sale_d = to_date(row.get("출하지시일"))
        if not sale_d:
            continue
        disp = to_str(row.get("노출상품명"))
        inv = to_str(row.get("송장상품명"))
        prod = disp or inv
        if not prod:
            continue
        order_no = _id(row.get("주문번호"))
        qty = to_float(row.get("수량")) or 1.0
        gross = to_float(row.get("판매가"))
        settle = to_float(row.get("업체지급액"))

        # line_no = 주문출하지시번호(행 고유). 없으면 주문·아이템번호 + 동일 키 등장 순번(결정적)
        line_no = _id(row.get("주문출하지시번호"))
        if not line_no:
            key = f"{order_no or ''}:{_id(row.get('주문아이템번호')) or ''}:{sale_d}:{gross:.0f}"
            seen_fallback[key] = seen_fallback.get(key, 0) + 1
            line_no = f"{key}#{seen_fallback[key]}"

        otype = _norm(to_str(row.get("주문유형")) or "")
        status = _norm(to_str(row.get("주문상태")) or "")
        is_exchange = otype.startswith("교환")
        is_refund = (otype.startswith(("반품", "취소"))
                     or "취소" in status or "반품" in status)
        ups = unit_per_set(disp, inv)
        opt = to_str(row.get("주문옵션"))

        if is_exchange or is_refund:
            yield ParsedLine(
                sale_date=sale_d,
                order_no=order_no,
                line_no=line_no,
                raw_product_name=prod,
                raw_option_name=opt,
                raw_qty=qty,
                gross_amount=0,
                net_amount=0,
                # 교환(재출고)은 환불이 아니므로 0 — 취소금액 부풀림 방지
                refund_amount=gross if is_refund else 0,
                is_cancelled=True,
                unit_per_set=ups,
            )
            continue

        if qty == 0 and gross == 0:
            continue

        yield ParsedLine(
            sale_date=sale_d,
            order_no=order_no,
            line_no=line_no,
            raw_product_name=prod,
            raw_option_name=opt,
            raw_qty=qty,
            gross_amount=gross,
            net_amount=gross,
            settlement_amount=settle,
            refund_amount=0,
            is_cancelled=False,
            unit_per_set=ups,
        )
