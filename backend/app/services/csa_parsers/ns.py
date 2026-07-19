"""NS 홈쇼핑(NS MALL) 파서.

2026-07 기준변경요청서(임현정) 반영 — 신규 양식('구분'/'금액' 컬럼 보유):
  매출 = B열[구분]='매출' 행만 P열[금액] 그대로 합산.
    (※ P열[금액]은 이미 부가세가 제외된 순매출 원가 — ÷1.1 이중 환산 금지.
       csa_service.VAT_INCLUDED_CHANNELS에서도 NS MALL/NS 제외 처리됨.)
  반품 = B열[구분]='반품' → is_cancelled 처리(매출 미반영, 건수·환불액만 집계).
  낱개수량 = E열[상품명] + G열[단품명] 결합 텍스트에 정규식 우선순위 적용(옥션 auction.py와
    동일 규칙) × O열[수량]:
      1순위 '총 N구/개/봉/병/개입'          → N
      2순위 'N+N'(4+4구·4구+4구 등)          → N+N 합산
      3순위 'N종 2세트' / 'N종 2BOX'         → N × 2
      4순위 'N구/개/봉/병/개입'(여러 개면 최댓값) → N
      5순위 'N종'                           → N
      6순위 위 미해당(단품)                  → 1
  6월 샘플(86행) 검증: 순매출 1,066,182 = 정답 1,066,182(정확 일치),
                      낱개수량 821 = 정답 821(정확 일치).

구버전 호환: '구분' 또는 '금액' 컬럼이 없는 원본(일자 컬럼 없는 구 집계 양식)은
기존 로직(매출수량/매출금액 등 폴백, unit_per_set 미지정 → 매핑값 사용)으로 처리.
"""
from __future__ import annotations
import os
import re
from collections import defaultdict
from datetime import date
from typing import Iterable, Optional

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import read_excel_safe, to_date, to_float, to_int, to_str


def _date_from_filename(path: str) -> Optional[date]:
    """파일명에서 기준일 추출. 일자 컬럼 없는 NS 집계 파일용.
    예) 'ns260501_31.xlsx' → 2026-05-01 (YYMMDD), 'NS_20260501.xlsx' → 2026-05-01.
    """
    name = os.path.basename(path)
    m = re.search(r"(20\d{2})[-_.]?(\d{2})[-_.]?(\d{2})", name)  # YYYYMMDD
    if m:
        try:
            return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        except Exception:
            pass
    m = re.search(r"(\d{2})(\d{2})(\d{2})", name)  # YYMMDD
    if m:
        yy, mm, dd = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if 1 <= mm <= 12 and 1 <= dd <= 31:
            try:
                return date(2000 + yy, mm, dd)
            except Exception:
                pass
    return None


# ── 낱개수량(입수) 정규식 — 옥션(auction.py) 6순위 규칙과 동일 (임현정 요청서 공통 규격) ──
_UNIT_SUFFIX = r"(?:개입|구|봉|병|개)"
_RE_TOTAL = re.compile(rf"총\s*(\d+){_UNIT_SUFFIX}")
_RE_PLUS = re.compile(rf"(\d+){_UNIT_SUFFIX}?\s*\+\s*(\d+){_UNIT_SUFFIX}")
_RE_KIND_2SET = re.compile(r"(\d+)\s*종\s*2\s*(?:세트|셋트|box|박스)", re.I)
_RE_UNIT = re.compile(rf"(\d+){_UNIT_SUFFIX}")
_RE_KIND = re.compile(r"(\d+)\s*종")


def _extract_set_count(prod: Optional[str], opt: Optional[str]) -> float:
    """E열[상품명] + G열[단품명] 결합 텍스트에서 세트 입수(N) 추출(6순위, 임현정 요청서)."""
    t = f"{prod or ''} {opt or ''}".strip()
    if not t:
        return 1.0
    m = _RE_TOTAL.search(t)
    if m:
        return float(m.group(1))
    m = _RE_PLUS.search(t)
    if m:
        return float(int(m.group(1)) + int(m.group(2)))
    m = _RE_KIND_2SET.search(t)
    if m:
        return float(int(m.group(1)) * 2)
    nums = [int(n) for n in _RE_UNIT.findall(t)]
    if nums:
        return float(max(nums))
    m = _RE_KIND.search(t)
    if m:
        return float(m.group(1))
    return 1.0


@register("NS MALL")
@register("NS")
def parse(path: str) -> Iterable[ParsedLine]:
    df = read_excel_safe(path, header=0)
    # 일자 컬럼이 없으면 파일명의 기준월(예: ns260501_31 → 2026-05-01)로, 그것도 없으면 today.
    today = _date_from_filename(path) or date.today()
    cols = set(df.columns)
    # 신규 양식 판별: '구분'(B열)·'금액'(P열) 컬럼 존재 여부.
    is_new_format = "구분" in cols and "금액" in cols

    # 같은 (상품코드·단품코드)가 여러 행에 반복 → line_no를 상품코드만으로 잡으면
    # dedup_hash 충돌로 중복 제외됨. 시퀀스로 물리행 고유화(같은 파일 재처리 시 안정).
    _seq: dict[str, int] = defaultdict(int)

    for _, row in df.iterrows():
        if is_new_format:
            gubun = to_str(row.get("구분")) or ""
            prod = to_str(row.get("상품명"))
            opt = to_str(row.get("단품명"))
            if not prod and not opt:
                continue
            if gubun not in ("매출", "반품"):
                # 정의되지 않은 구분값(교환 등)은 매출·취소 어느 쪽도 아님 — skip
                continue
            is_cancel = gubun == "반품"

            sale_d = (
                to_date(row.get("매출/반품일"))
                or to_date(row.get("주문일"))
                or today
            )
            qty = to_float(row.get("수량") or 1)
            amt = to_float(row.get("금액"))

            prod_code = to_str(row.get("상품코드")) or ""
            unit_code = to_str(row.get("단품코드")) or ""
            seq_val = to_str(row.get("주문/반품일련번호"))
            if seq_val:
                seq_suffix = seq_val
            else:
                seq_key = f"{prod_code}|{unit_code}"
                _seq[seq_key] += 1
                seq_suffix = str(_seq[seq_key])
            line_no = f"{prod_code}|{unit_code}|{seq_suffix}"

            order_raw = row.get("주문/반품번호")
            order_no = to_str(to_int(order_raw)) if order_raw is not None else None

            yield ParsedLine(
                sale_date=sale_d,
                order_no=order_no,
                line_no=line_no,
                raw_product_name=prod,
                raw_option_name=opt,
                raw_qty=qty,
                gross_amount=0 if is_cancel else amt,
                net_amount=0 if is_cancel else amt,
                refund_amount=abs(amt) if is_cancel else 0,
                is_cancelled=is_cancel,
                unit_per_set=_extract_set_count(prod, opt),
            )
            continue

        # ── 구버전 폴백('구분'/'금액' 컬럼 없는 일자 컬럼 없는 구 집계 양식) — 기존 로직 유지 ──
        sale_d = (
            to_date(row.get("주문일자"))
            or to_date(row.get("입고일자"))
            or to_date(row.get("정산일"))
            or to_date(row.get("매출일자"))
            or today  # 일자 컬럼이 없는 집계 파일 — 업로드 일자로
        )
        prod = to_str(row.get("상품명") or row.get("단품명"))
        if not prod:
            continue
        qty = to_float(row.get("매출수량") or row.get("수량") or row.get("주문수량") or 1)
        # 반품수량은 음수 보정
        qty -= to_float(row.get("반품수량") or 0)
        if qty == 0:
            continue
        # 매출(net) = 매출금액 등 폴백  ← 사용자 지정(2026-06-05). NS는 온라인(위탁) → VAT 환산 안 함.
        gross = to_float(
            row.get("매출금액") or row.get("정산금액") or row.get("공급금액")
            or row.get("공급가") or row.get("판매가") or row.get("원가(VAT)별도")
        )
        # 반품금액 차감
        gross -= to_float(row.get("반품금액") or 0)

        prod_code = to_str(row.get("상품코드")) or ""
        unit_code = to_str(row.get("단품코드")) or ""
        opt = to_str(row.get("단품명")) or ""
        seq_key = f"{prod_code}|{unit_code}|{opt}"
        _seq[seq_key] += 1
        line_no = f"{prod_code}|{unit_code}|{_seq[seq_key]}"

        yield ParsedLine(
            sale_date=sale_d,
            order_no=to_str(row.get("주문번호") or row.get("발주번호")),
            line_no=line_no,
            raw_product_name=prod,
            raw_option_name=opt or None,
            raw_qty=qty,
            gross_amount=gross,
            net_amount=gross,
        )
