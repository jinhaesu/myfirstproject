"""농협몰 파서. 결제금액이 없는 주문 리스트일 수 있어 수량만 신뢰."""
from __future__ import annotations
import logging
import re
from typing import Iterable, Optional

import pandas as pd

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import read_excel_safe, to_date, to_float, to_str

log = logging.getLogger(__name__)


# ── 낱개 입수 파싱 (폼 #23·#36·#50 김재경/MD 2026-07-14~28 요청, 2026-09-28 반영) ──
# 농협몰은 낱개 구성이 I열[옵션명]에 있음(예: '플레인 6봉‖치즈올리브 6봉' = 12).
# 네모 바게트는 상품명 '9봉' ↔ 옵션 12봉 불일치 → 옵션 우선, '기본단품'이면 H열[상품명].
_UNIT = r"(?:개입|구|봉|개|캔|병)"
# 무게·용량('90g', '개당 50g', '600g')은 입수가 아님 → 파싱 전에 제거
_WEIGHT_RE = re.compile(r"\d+(?:\.\d+)?\s*(?:kg|g|ml)(?![a-z])", re.I)
# 맛 선택 표기('(5종 택1)', '4종 택2', '7종')의 숫자도 입수가 아님 → 제거
_PICK_RE = re.compile(r"\(\s*\d+\s*종\s*택\s*\d+\s*\)|\d+\s*종(?:\s*택\s*\d+)?")
_TOTAL_RE = re.compile(r"총\s*(\d+)\s*" + _UNIT)
_ITEM_SPLIT_RE = re.compile(r"\|\||‖|\+|/")
_ITEM_RE = re.compile(r"(\d+)\s*" + _UNIT)
# 'M세트/SET'도 BOX와 같은 묶음 배수 — '통밀식빵 4봉*3SET'(=12, fix_units_manual_overrides 농협몰)이
# 기본단품이면 4로 떨어져 매핑 입수 12를 덮어쓰던 것 방지 (리뷰 보정 2026-09-28)
_BOX_RE = re.compile(r"(\d+)\s*(?:box|박스|세트|set)", re.I)


def _units_from_text(text: Optional[str]) -> Optional[float]:
    """옵션명/상품명 → 낱개 입수. 못 찾으면 None.

    - '총 N구/개/봉/개입'이 있으면 그 값(중복 합산 금지)
    - 없으면 '||'·'‖'·'+'·'/'로 나눈 항목마다 '첫 번째' N+단위 1개만 취하고
      뒤에 'M BOX/박스/세트'가 붙으면 곱한 뒤 항목 합산
      예) '플레인 6봉‖치즈올리브 6봉' → 12, '아메리칸쿠키 6개 1box' → 6,
          '톳 12봉(낱개입 24개)' → 12 (첫 토큰만 — 괄호 안 낱개입 중복 합산 방지)
    """
    if not text:
        return None
    t = _WEIGHT_RE.sub(" ", str(text))
    t = _PICK_RE.sub(" ", t)
    m = _TOTAL_RE.search(t)
    if m:
        n = int(m.group(1))
        return float(n) if n > 0 else None
    total = 0
    for part in _ITEM_SPLIT_RE.split(t):
        m = _ITEM_RE.search(part)
        if not m:
            continue
        n = int(m.group(1))
        b = _BOX_RE.search(part, m.end())
        if b:
            n *= int(b.group(1))
        total += n
    return float(total) if total > 0 else None


def _nh_units(opt: Optional[str], prod: Optional[str]) -> Optional[float]:
    """입수 판정: 옵션명('기본단품' 제외) → 상품명 순.
    둘 다 실패하면 None — 1로 덮으면 관리자가 등록한 매핑 입수를 무시하게 됨."""
    if opt and opt != "기본단품":
        v = _units_from_text(opt)
        if v is not None:
            return v
    return _units_from_text(prod)


# ── 반품·교환 차감 (폼 #23 ④, 2026-09-28 반영) ──
# 취소·반품은 주문 시트가 아니라 별도 시트 '반품교환내역상품별주문'에만 기재됨
# (주문 시트 정산상태는 전부 '완료'). 별도 취소행을 추가하면 원 매출이 줄지 않으므로
# (주문일자, 주문번호, 주문순번)으로 주문 시트의 원 행을 찾아 그 행을 취소/차감한다.
_RETURN_SHEET = "반품교환내역상품별주문"


def _norm_no(v) -> str:
    """주문번호·주문순번 대조용 — xlrd가 '003359'를 3359.0으로 읽으므로 숫자면 정수 문자열로.
    (대조 키 전용. 적재되는 order_no/line_no 형식은 기존 그대로 — dedup 해시 보존)"""
    s = to_str(v)
    if s is None:
        return ""
    if re.fullmatch(r"\d+(?:\.0+)?", s):
        # float 변환 없이 문자열로 처리 — 긴 상품코드 자릿수 손실 방지
        return s.split(".")[0].lstrip("0") or "0"
    return s


def _load_returns(path: str) -> dict[tuple, list[dict]]:
    """반품교환 시트 → {(주문일자, 주문번호, 주문순번): [{code, qty}]}.
    시트가 없거나(구양식·HTML 위장 xls·csv) 읽기 실패면 빈 dict — 차감 없이 기존 동작."""
    if path.lower().endswith(".csv"):
        return {}
    rdf = None
    for engine in (None, "calamine"):
        try:
            with pd.ExcelFile(path, engine=engine) as xls:
                names = [str(s) for s in xls.sheet_names]
                sheet = next((s for s in names if s.strip() == _RETURN_SHEET), None) or next(
                    (s for s in names if "반품" in s and "상품" in s), None
                )
                if sheet is None:
                    return {}
                rdf = xls.parse(sheet, header=0)
            break
        except Exception:
            continue
    if rdf is None:
        return {}
    out: dict[tuple, list[dict]] = {}
    skipped = 0
    for _, r in rdf.iterrows():
        prod = to_str(r.get("상품명"))
        if not prod or prod == "합계":  # 소계 헤더행·합계 푸터 제외
            continue
        d = to_date(r.get("주문일자"))
        ono = _norm_no(r.get("주문번호"))
        q = to_float(r.get("수량") or r.get("주문수량"))
        if d is None or not ono or q <= 0:
            skipped += 1  # 양식 변형(음수 수량·헤더 변경 등)으로 차감이 조용히 빠지지 않게 로그
            continue
        out.setdefault((d, ono, _norm_no(r.get("주문순번"))), []).append(
            {"code": _norm_no(r.get("상품코드")), "qty": q}
        )
    if skipped:
        log.warning("농협몰 반품교환 시트 %s행을 읽지 못해 차감에서 제외(주문일자·주문번호·수량 확인)", skipped)
    return out


def _take_return_qty(returns: dict, key: tuple, code: str, qty: float) -> float:
    """주문 행에 해당하는 반품 수량을 소진하며 반환(같은 반품이 두 행에 중복 적용되지 않게)."""
    taken = 0.0
    for k in (key, (key[0], key[1], "")):  # 반품 시트에 주문순번이 비어 있으면 (일자, 번호)로
        for r in returns.get(k, ()):
            if taken >= qty:
                return taken
            if r["qty"] <= 0 or (r["code"] and code and r["code"] != code):
                continue
            t = min(r["qty"], qty - taken)
            r["qty"] -= t
            taken += t
    return taken


@register("농협몰")
@register("농협")
def parse(path: str) -> Iterable[ParsedLine]:
    df = read_excel_safe(path, header=0)
    returns = _load_returns(path)
    for _idx, (_, row) in enumerate(df.iterrows()):
        sale_d = to_date(row.get("주문일자") or row.get("결제완료일시"))
        if sale_d is None or pd.isna(sale_d):
            continue
        prod = to_str(row.get("상품명"))
        if not prod or prod == "NaT":
            continue
        raw_q = to_float(row.get("수량") or row.get("주문수량") or 1)
        qty = raw_q - to_float(row.get("취소수량") or 0)

        status = to_str(row.get("정산상태") or row.get("주문상태") or "") or ""
        is_cancel = ("취소" in status) or ("반품" in status)
        # 전량 취소(잔여 수량 0)면 행을 버리지 않고 취소건으로 적재 (검수 반영 2026-06-12)
        if qty <= 0:
            is_cancel = True
            qty = raw_q if raw_q > 0 else 1

        # 매출 = 주문금액(합계) (N열). 정산/결제 컬럼이 없는 양식이라 주문금액 기준.
        amt = to_float(
            row.get("주문금액합계") or row.get("주문금액")
            or row.get("정산대상금액") or row.get("결제금액") or row.get("판매가")
        )

        # 반품교환 시트에 있는 행: 전량이면 원 행을 취소로(refund=주문금액),
        # 일부면 반품 수량만큼 수량·금액을 비례 차감한 정상행으로 (폼 #23 ④, 2026-09-28)
        if returns and qty > 0:
            key = (sale_d, _norm_no(row.get("주문번호")), _norm_no(row.get("주문순번")))
            ret_q = _take_return_qty(returns, key, _norm_no(row.get("상품코드")), qty)
            if is_cancel:
                pass  # 이미 취소 판정된 행 — 반품 수량만 소진(미대조 경고 방지)
            elif ret_q >= qty:
                is_cancel = True
            elif ret_q > 0:
                amt = round(amt * (qty - ret_q) / qty, 2)
                qty = qty - ret_q

        opt = to_str(row.get("옵션명"))
        yield ParsedLine(
            sale_date=sale_d,
            order_no=to_str(row.get("주문번호")),
            # 같은 (주문번호, 주문순번) 충돌로 행이 dedup 탈락(127→124건)하지 않게
            # 행 시퀀스를 붙여 라인 고유성 보장 (검수 반영 2026-06-12)
            line_no=f"{to_str(row.get('주문순번') or row.get('상품코드')) or ''}-{_idx}",
            raw_product_name=prod,
            # 매핑 키는 기존대로 규격 우선 유지 — 옵션명으로 바꾸면 기존 매핑 12건이 빠짐.
            # 옵션명은 아래 낱개 입수 파싱에만 사용 (폼 #50, 2026-09-28)
            raw_option_name=to_str(row.get("단품명") or row.get("규격") or row.get("옵션명")),
            raw_qty=qty,
            gross_amount=0 if is_cancel else amt,
            net_amount=0 if is_cancel else amt,
            refund_amount=amt if is_cancel else 0,
            is_cancelled=is_cancel,
            unit_per_set=_nh_units(opt, prod),
        )

    left = sum(r["qty"] for v in returns.values() for r in v if r["qty"] > 0)
    if left > 0:
        # 원 주문이 이 파일에 없는 반품(이전 달 파일에 적재된 주문 등) — 자동 차감 불가, 로그만
        log.warning("농협몰 반품교환 %s개가 주문 시트와 대조되지 않음: %s", left,
                    [k for k, v in returns.items() if any(r["qty"] > 0 for r in v)][:20])
