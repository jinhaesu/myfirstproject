"""삼성카드 파서 (쇼핑 SP…·복지 WP… 두 파일 공용).

집계 기준: 수량 × 공급가 (세전 공급가 합계). 공급가는 개당 단가.
낱개 = (상품코드별 기준 낱개) × (단품명 내 박스 수) × 수량.
  (폼 2026-07-26 김재경/MD: 세트/박스 미환산 684→1,376 · 주문번호 dedup 131→123)
복지 파일은 앞에 [고객사][사번] 2칸이 더 있으나 헤더명으로 매칭하므로 동일 파서로 처리.
"""
from __future__ import annotations
import re
from typing import Iterable

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import read_excel_safe, to_date, to_float, to_str


# 상품코드 → 기준 낱개(단일 박스 기준). SP…=쇼핑, WP…=복지.
_SAMSUNG_BASE = {
    # 쇼핑
    "SP250302249589": 8, "SP250302249615": 16, "SP250502339933": 12, "SP250502339935": 9,
    "SP260202633497": 8, "SP250302254149": 8, "SP250602363533": 8, "SP260202633232": 8,
    "SP250302247762": 6, "SP250302248260": 6,
    # 복지
    "WP250302251676": 8, "WP250302251686": 16, "WP250302254400": 8, "WP250502339934": 9,
    "WP250502339936": 9, "WP260202633503": 8, "WP250302251592": 12, "WP250302251602": 8,
    "WP250302251571": 10, "WP250802440503": 1, "WP250302251704": 16, "WP250302251803": 16,
    "WP250302254182": 8, "WP250302251756": 8, "WP250602363563": 8, "WP250602386067": 8,
    "WP260202633353": 8, "WP260302698853": 6,
}
# 단품명 내 '박스 수'를 곱해야 하는 상품코드(기준 낱개=단일박스 수량).
_SAMSUNG_BOXMULT = {
    "SP250302254149", "SP260202633232", "SP250302247762", "SP250302248260", "WP250302254182",
}
# 단품명의 'N개입' 숫자를 그대로 낱개로 쓰는 상품코드(옵션 의존).
_SAMSUNG_OPTDEP = {"WP250302251320", "WP250302251608", "WP250302251645"}


def _samsung_units(code: str, danpum: str):
    """상품코드 기준 낱개 입수. 미매핑이면 None(집계에선 1로 취급하되 별도 미매핑)."""
    code = (code or "").strip()
    dp = danpum or ""
    if code in _SAMSUNG_OPTDEP:
        m = re.search(r"(\d+)\s*개입", dp)
        return int(m.group(1)) if m else 1
    base = _SAMSUNG_BASE.get(code)
    if base is None:
        return None
    if code in _SAMSUNG_BOXMULT:
        boxes = sum(int(x) for x in re.findall(r"(\d+)\s*(?:박스|BOX)", dp.upper()))
        base *= max(boxes, 1)
    return base


@register("삼성카드쇼핑")
@register("삼성카드")
def parse(path: str) -> Iterable[ParsedLine]:
    df = read_excel_safe(path, header=0)
    for _idx, (_, row) in enumerate(df.iterrows()):
        sale_d = to_date(row.get("주문일자"))
        if not sale_d:
            continue
        prod = to_str(row.get("상품명"))
        if not prod:
            continue
        qty = to_float(row.get("수량") or row.get("주문수량") or 1)

        # 주문상태(H)에 '취소' 포함 시 취소건으로 표시
        status = to_str(row.get("주문상태") or "") or ""
        is_cancel = "취소" in status

        # 집계 기준: 수량(P) × 공급가(Q)
        supply_price = to_float(row.get("공급가"))
        gross = qty * supply_price if supply_price else to_float(row.get("판매가") or row.get("결제금액"))

        # line_no에 단품명(옵션)·회차를 포함 — 같은 상품코드라도 단품(맛/옵션)이
        # 다르면 별개 건이므로 중복(dedup)으로 합쳐지지 않게 함.
        # (예: 같은 상품코드의 '에브리띵' vs '올리브'는 서로 다른 판매)
        opt = to_str(row.get("단품명"))
        round_no = to_str(row.get("진행회차") or row.get("신청회차"))
        code = to_str(row.get("상품코드"))
        _parts = [x for x in (code, opt, round_no) if x]
        # 같은 주문·단품·금액 행 중복 시 dedup 탈락(76→74행) 방지 — 행 시퀀스 부여
        line_no = ("|".join(_parts) if _parts else code or "") + f"-{_idx}"

        ups = _samsung_units(code, opt)  # 상품코드 기준 낱개(세트/박스 환산). None=미매핑
        yield ParsedLine(
            sale_date=sale_d,
            order_no=to_str(row.get("주문번호")),
            line_no=line_no,
            raw_product_name=prod,
            raw_option_name=opt,
            raw_qty=qty,
            unit_per_set=ups if ups is not None else 1,
            gross_amount=0 if is_cancel else gross,
            net_amount=0 if is_cancel else gross,
            refund_amount=gross if is_cancel else 0,
            is_cancelled=is_cancel,
        )
