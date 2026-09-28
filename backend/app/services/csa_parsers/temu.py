"""테무 파서. '구매 날짜'는 '2026년 5월 12일 09:15 KST(UTC+9)' 형식.

낱개수량(2026-07 기준변경요청서, 김재경/MD):
  낱개 = J열[선택 사항] 파싱값 × N열[구매 수량].
  선택 사항은 '+' 로 구분된 각 항목을 전부 합산. 각 항목에서
  "N구/N개/N봉/N캔" 을 찾고 "M박스"가 있으면 N×M (없으면 M=1).
  예외: 개수 없이 박스만 있는 쿠키 2종(르뱅/아메리칸, I열[제품 이름]으로 판별)은
  6개(고정) × 박스수. 패턴 미매칭 시 unit_per_set=None(미파싱, 매핑값으로 폴백).
  6월 샘플 검증: 낱개 9,113 = 담당자 정답 9,113 (정확 일치).

폼 #65(2026-09-26, 김재경/MD) 검증 중 발견된 파서 버그 2건 수정(2026-09-28):
  1) 헤더 자동 탐지 — 월간 xlsx('Order report' 시트)는 상단 5행이 안내문이고
     헤더가 6행이라 header=0 고정 시 0행 파싱 → 업로드 실패. 첫 셀 '주문 ID' 또는
     '구매 날짜' 셀이 있는 행을 헤더로 승격(_read). 안내문 없는 파일도 그대로 동작.
  2) line_no = E열[상품 주문 ID] 우선(없으면 SKU ID → 제공 sku). 같은 주문 안에서
     SKU·수량·금액이 같은 두 행이 dedup_hash 충돌로 1행 유실되던 문제
     (8월 9행, 6월 취소 1행). ※ dedup_hash가 전부 바뀌므로 이미 적재된 기간을
     다시 올릴 때는 해당 기간 삭제 후 재업로드해야 이중 적재가 안 된다.
  주문번호(A열 주문 ID)·매출(AO)·낱개·취소 판별 규칙은 변경 없음.
  8월 월간 샘플 검증: 1,587행, 판매 1,439행(주문 ID 고유 1,271), 취소 148행(고유 127),
  매출 ÷1.1 13,927,034.5, 낱개 15,247, 파일 내 해시 충돌 0.
"""
from __future__ import annotations
import re
from datetime import datetime
from typing import Iterable, Optional

import pandas as pd

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import read_excel_safe, to_datetime, to_float, to_str


def _parse_korean_date(v) -> Optional[datetime]:
    if v is None:
        return None
    s = str(v)
    m = re.search(r"(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일(?:\s+(\d{1,2}):(\d{1,2}))?", s)
    if not m:
        return None
    y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
    hh = int(m.group(4)) if m.group(4) else 0
    mm = int(m.group(5)) if m.group(5) else 0
    try:
        return datetime(y, mo, d, hh, mm)
    except Exception:
        return None


# 선택 사항[J열] 낱개 파싱 — "N구/N개/N봉/N캔" (+ "M박스"가 있으면 ×M)
_UNIT_CNT = re.compile(r"(\d+)\s*(?:구|개|봉|캔)")
_BOX_CNT = re.compile(r"(\d+)\s*박스")
# 예외: 선택 사항에 개수 없이 박스만 있는 쿠키 2종 → 6개(고정) × 박스수
_COOKIE_EXCEPTION_UNIT = 6.0


def _is_cookie_exception(product_name: Optional[str]) -> bool:
    if not product_name:
        return False
    return ("르뱅 쿠키" in product_name) or ("아메리칸 쿠키" in product_name)


def _parse_option_units(option_text: Optional[str], product_name: Optional[str]) -> Optional[float]:
    """선택 사항[J열] → 낱개수량(입수). '+' 구분 항목 전부 합산. 실패 시 None(미파싱)."""
    if not option_text:
        return None
    total = 0.0
    matched_any = False
    for seg in option_text.split("+"):
        seg = seg.strip()
        if not seg:
            continue
        cnt_m = _UNIT_CNT.search(seg)
        if cnt_m:
            n = int(cnt_m.group(1))
            box_m = _BOX_CNT.search(seg)
            m = int(box_m.group(1)) if box_m else 1
            total += n * m
            matched_any = True
            continue
        # 개수 토큰이 없고 박스만 있는 경우: 쿠키 2종 예외만 허용
        box_m = _BOX_CNT.search(seg)
        if box_m and _is_cookie_exception(product_name):
            total += _COOKIE_EXCEPTION_UNIT * int(box_m.group(1))
            matched_any = True
            continue
        # 패턴 미매칭 항목이 하나라도 있으면 라인 전체 미파싱 처리
        return None
    return total if matched_any else None


# 헤더 행 탐지 (폼 #65, 2026-09-26) — 첫 셀 '주문 ID' 또는 '구매 날짜' 셀이 있는 행
_HEADER_FIRST_CELL = "주문 ID"
_HEADER_ANY_CELL = "구매 날짜"
_HEADER_SCAN_ROWS = 20  # 월간 xlsx 안내문은 5행 — 여유 있게 20행까지만 탐색


def _is_header(vals: list) -> bool:
    cells = [str(v).strip() for v in vals]
    return bool(cells) and (cells[0] == _HEADER_FIRST_CELL or _HEADER_ANY_CELL in cells)


def _header_names(vals: list) -> list[str]:
    """헤더 셀 → 컬럼명. pandas header=0과 같게 빈 셀은 'Unnamed: N',
    중복은 '.1'·'.2' 접미(월간 xlsx에 '수령인 이름'이 2개)."""
    names: list[str] = []
    seen: dict[str, int] = {}
    for j, v in enumerate(vals):
        name = to_str(v) or f"Unnamed: {j}"
        if name in seen:
            seen[name] += 1
            name = f"{name}.{seen[name]}"
        else:
            seen[name] = 0
        names.append(name)
    return names


def _read(path: str) -> pd.DataFrame:
    """헤더 자동 탐지 후 DataFrame 반환 (폼 #65, 2026-09-28 수정).

    xlsx/xls: header=None으로 읽어 헤더 행을 찾아 승격(상단 안내문 5행인 월간 xlsx 대응).
    CSV: 기존대로 header=0. 첫 행이 헤더가 아닐 때만 같은 탐지로 폴백.
    헤더를 못 찾으면 구 header=0 결과를 그대로 반환(구양식 파일 동작·해시 불변).
    """
    df: Optional[pd.DataFrame] = None
    if path.lower().endswith(".csv"):
        df = read_excel_safe(path, header=0)
        if _is_header(list(df.columns)):
            df.columns = [str(c).strip() for c in df.columns]
            return df
        try:
            raw = read_excel_safe(path, header=None)
        except Exception:
            return df  # 탐지용 재읽기 실패 시 구 동작 유지
    else:
        raw = read_excel_safe(path, header=None)
    if raw is None or raw.empty:
        return df if df is not None else pd.DataFrame()
    # HTML 위장 .xls는 read_html이 이미 헤더를 컬럼으로 잡아 옴 → 그대로 사용
    if _is_header(list(raw.columns)):
        raw.columns = [str(c).strip() for c in raw.columns]
        return raw
    hdr: Optional[int] = None
    for i in range(min(_HEADER_SCAN_ROWS, len(raw))):
        if _is_header(raw.iloc[i].tolist()):
            hdr = i
            break
    if hdr is None:
        # 헤더 미탐지(구양식 등) — header=None 재읽기는 dtype 추론이 달라
        # (빈칸 섞인 SKU ID 'X.0'→'X') line_no·해시가 바뀌므로 구 header=0 결과 사용.
        return df if df is not None else read_excel_safe(path, header=0)
    df = raw.iloc[hdr + 1:].reset_index(drop=True)
    df.columns = _header_names(raw.iloc[hdr].tolist())
    return df


def _first_str(*vals) -> Optional[str]:
    """앞에서부터 비어 있지 않은 첫 값(str). NaN은 truthy라 `a or b`로는 폴백이 안 됨."""
    for v in vals:
        s = to_str(v)
        if s:
            return s
    return None


@register("테무")
@register("Temu")
def parse(path: str) -> Iterable[ParsedLine]:
    df = _read(path)
    for _, row in df.iterrows():
        sale_dt = (
            _parse_korean_date(row.get("구매 날짜"))
            or to_datetime(row.get("구매 날짜"))
            or to_datetime(row.get("결제 시간"))
            or to_datetime(row.get("주문 시간"))
            or to_datetime(row.get("주문일시"))
        )
        if not sale_dt:
            continue
        prod = to_str(row.get("제품 이름") or row.get("고객 주문별 제품 이름") or row.get("상품명"))
        if not prod:
            continue

        # 주문 상태 '취소됨' — 매출/수량에서 제외(is_cancelled로 표시)
        status = to_str(row.get("주문 상태") or row.get("주문 상품 상태") or "") or ""
        is_cancel = "취소" in status

        # 매출(net) = 할인 후 기본 가격 총액 (AO). to_float가 '원'·콤마 제거.
        # is_vat_included(csa_service)가 VAT_INCLUDED_CHANNELS 소속 채널에 대해 ÷1.1 적용.
        net = to_float(
            row.get("할인 후 기본 가격 총액") or row.get("기본 가격 총액")
            or row.get("주문 금액")
        )
        gross = to_float(
            row.get("기본 가격 총액") or row.get("할인 후 기본 가격 총액")
            or row.get("주문 금액") or row.get("상품 기본 가격")
        )
        opt = to_str(row.get("선택 사항"))
        # 낱개(입수) = 선택 사항 파싱값. 구버전 원본(컬럼 없음)이나 패턴 미매칭 시
        # None → csa_service에서 ChannelProductMapping.unit_per_set으로 자동 폴백.
        unit_per_set = _parse_option_units(opt, prod)
        yield ParsedLine(
            sale_date=sale_dt.date(),
            sale_datetime=sale_dt,
            order_no=to_str(row.get("주문 ID") or row.get("주문 상품 ID")),
            # line_no = E열[상품 주문 ID] 우선 (폼 #65, 2026-09-28) — SKU ID만 쓰면 같은
            # 주문의 동일 SKU·수량·금액 행이 dedup 충돌로 유실. 구버전 원본은 SKU로 폴백.
            line_no=_first_str(row.get("상품 주문 ID"), row.get("SKU ID"), row.get("제공 sku")),
            raw_product_name=prod,
            raw_option_name=opt,
            raw_qty=to_float(row.get("구매 수량") or row.get("수량") or 1),
            gross_amount=0 if is_cancel else gross,
            net_amount=0 if is_cancel else net,
            refund_amount=net if is_cancel else 0,
            is_cancelled=is_cancel,
            unit_per_set=unit_per_set,
        )
