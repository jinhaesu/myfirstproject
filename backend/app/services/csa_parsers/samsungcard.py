"""삼성카드 파서 (쇼핑 SP…·복지 WP… 두 파일 공용).

집계 기준: [판매가](개당, VAT 포함) × 수량 — 폼 #76 + MD 회신 2026-10-05(수량 미곱 → 곱으로 정정).
  순매출 = Σ(판매가 × 수량) ÷ 1.1 (÷1.1은 채널 VAT 설정에서 처리, 파서는 VAT 포함가를 넣는다).
  정답: 7월 1,566,818 / 8월 1,790,000 / 9월 2,141,373 (MD 회신 2026-10-05).
  (종전: 수량 × 공급가, 세전)
낱개 = (상품코드별 기준 낱개) × (단품명 내 박스 수) × 수량.
  (폼 2026-07-26 김재경/MD: 세트/박스 미환산 684→1,376 · 주문번호 dedup 131→123)
취소 = 주문상태 '주문취소' + 반품 상태('배송완료(반품)' 등). 교환·교환취소·반품취소는 정상 판매.
  (폼 #26·#67 → 폼 #76에서 반품을 취소로 변경, 전 채널 통일)
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
    # 쇼핑 — 폼 #26 매핑표 밖 코드(2026-09-28 추가). 상품명·단품명의 개입수로 확인, 박스곱셈 없음.
    # (미매핑이면 낱개 1로 잡혀 8월 −13 등 과소 집계)
    "SP250302247604": 10,  # [비건] 단백질 파운드케이크 5종 10개입 ('쑥 5EA / 다크초코 5EA')
    "SP250302247500": 5,   # [크림가득] 고단백 크림빵 5개입
    "SP250302248309": 16,  # 4.5cm 마카롱 16개입 [4종 택2] ('8구 (1BOX)+ 8구 (1BOX)' = 16, ×박스 금지)
    "SP250302248345": 16,  # 4cm 휘낭시에 16개입(8ea x 2box) — 복지 WP250302251704와 동일 16
    # 쇼핑 — 폼 #76 입수 확정(2026-10-01). 미매핑으로 9월 낱개 1,080(실제 1,629)이던 원인.
    "SP250302251829": 16,  # 뚱카롱 '사랑 1박스x감동 1박스 총16개' — 단품명 박스 수와 무관하게 16 고정
    # 복지
    "WP250302251676": 8, "WP250302251686": 16, "WP250302254400": 8, "WP250502339934": 9,
    "WP250502339936": 9, "WP260202633503": 8, "WP250302251592": 12, "WP250302251602": 8,
    "WP250302251571": 10, "WP250802440503": 1, "WP250302251704": 16, "WP250302251803": 16,
    "WP250302254182": 8, "WP250302251756": 8, "WP250602363563": 8, "WP250602386067": 8,
    "WP260202633353": 8, "WP260302698853": 6,
    # 복지 — 폼 #26 매핑표 밖 코드(2026-09-28 추가, 위와 같은 기준)
    "WP250302251311": 5,   # [크림가득] 고단백 크림빵 5개입
    "WP250302251329": 24,  # [0칼로리 0당류] 제로 티스파클링 2종 24개입 ('블랙티레몬 (24개입)')
    "WP250302251578": 6,   # [수제 초콜릿] 단백질 브라우니 6개입
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
    # 완전히 같은 행(주문·단품·회차·일자·상품·수량·금액)의 등장 순번 — line_no 구분용
    _dup_seen: dict[tuple, int] = {}
    for _, row in df.iterrows():
        sale_d = to_date(row.get("주문일자"))
        if not sale_d:
            continue
        prod = to_str(row.get("상품명"))
        if not prod:
            continue
        qty = to_float(row.get("수량") or row.get("주문수량") or 1)

        # 취소 = '주문취소' + 반품 상태('배송완료(반품)' 등) — 폼 #76 김재경/MD, 2026-10-01 대표 승인
        # (반품도 취소, 전 채널 통일. 8월 복지 반품 1건 → 취소 4건).
        # '"취소" in 상태'로 넓히면 안 됨: '배송완료(교환취소)'·'배송완료(반품취소)'는 교환/반품이
        # 철회된 정상 판매 (2026-01 교환취소 1건 누락 이력, 폼 #26·#67). 교환도 정상 판매.
        status = (to_str(row.get("주문상태") or "") or "").strip()
        is_cancel = status == "주문취소" or ("반품" in status and "취소" not in status)

        # 집계 기준: [판매가] 열 값 그대로(VAT 포함, 수량 미곱) — 폼 #76. 상단 docstring 참고.
        # 판매가는 개당 가격 → 판매가 × 수량 (MD 회신 2026-10-05: 11,900×2=23,800=결제금액)
        unit_price = to_float(row.get("판매가"))
        gross = unit_price * qty if unit_price else to_float(row.get("결제금액"))

        # line_no에 단품명(옵션)·회차를 포함 — 같은 상품코드라도 단품(맛/옵션)이
        # 다르면 별개 건이므로 중복(dedup)으로 합쳐지지 않게 함.
        # (예: 같은 상품코드의 '에브리띵' vs '올리브'는 서로 다른 판매)
        opt = to_str(row.get("단품명"))
        round_no = to_str(row.get("진행회차") or row.get("신청회차"))
        code = to_str(row.get("상품코드"))
        _parts = [x for x in (code, opt, round_no) if x]
        # 적재 시 line_no 100자 절단 — 순번 접미사가 잘리지 않게 본문을 먼저 90자로 제한
        base_no = ("|".join(_parts) if _parts else code or "")[:90]
        order_no = to_str(row.get("주문번호"))
        # 같은 주문·단품·금액 행 중복 시 dedup 탈락(76→74행) 방지 — 동일 행에만 '#순번' 부여.
        # (2026-09-28) 파일 내 절대 행번호(-{_idx})는 주간/월간 파일마다 값이 달라 같은 행이
        # 두 번 적재될 수 있어, 파일 위치와 무관한 '동일 행 등장 순번'으로 교체.
        _k = (order_no, base_no, sale_d, prod, qty, gross)
        _n = _dup_seen.get(_k, 0) + 1
        _dup_seen[_k] = _n
        line_no = base_no if _n == 1 else f"{base_no}#{_n}"

        ups = _samsung_units(code, opt)  # 상품코드 기준 낱개(세트/박스 환산). None=미매핑
        yield ParsedLine(
            sale_date=sale_d,
            order_no=order_no,
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
