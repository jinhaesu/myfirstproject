"""롯데온 파서.

낱개수량·순매출·취소판별(2026-07 기준변경요청서, 김재경):
  순매출 = AV열[결제금액] (라인 총액 = 판매가×수량−할인금액). 곱셈 재적용 금지
    — 결제금액은 이미 라인 총액이라 수량을 다시 곱하면 매출이 이중 계상된다(구버전 버그).
  낱개수량 = AJ열[전시상품명] 기준 매핑표(구성 개수) × AX열[수량].
    · 옵션이 전부 '단일상품'으로 나와 옵션 기반 입수 파싱이 불가해 상품명 매핑 사용.
    · 전시상품명에 프로모션 문구가 붙으므로 부분 매칭(포함)으로 매핑.
    · 매핑에 없는 신규 전시상품명은 제외하지 않고 unit_per_set=None(미매핑)으로 유지.
  취소·반품 = S열[유형]이 '취소(주문취소)' 또는 '반품'인 행(우선 판별).
    · 구버전(유형 컬럼 없음) 폴백: U열[진행단계]에 '취소' 포함 여부로 판별(기존 로직 유지).
  VAT: 롯데온은 VAT 포함가(결제금액)로 들어오는 채널 — csa_service.VAT_INCLUDED_CHANNELS에
    이미 등록되어 있어 ingest 시점에 시스템이 자동으로 ÷1.1(공급가) 환산한다.
    파서 단에서는 원본 그대로(net_amount=gross_amount=결제금액) 전달한다
    (다른 VAT포함 채널 파서들과 동일 컨벤션 — coupang.py/talkstore.py 등 참조,
    파서에서 또 ÷1.1 하면 시스템 환산과 중복 적용되어 매출이 반토막 남).
"""
from __future__ import annotations

from typing import Iterable, Optional

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import read_excel_safe, to_datetime, to_float, to_str

# 전시상품명 → 낱개 입수 매핑 (담당자 지정, 2026-07-15 기준변경요청서).
# 부분 매칭(포함)이므로 겹치는 짧은 키가 긴 키를 가리지 않도록 길이 내림차순으로 검사한다.
_DISPLAY_NAME_UNITS: list[tuple[str, float]] = [
    ("크림 휘낭시에 2box (16개입)", 16),
    ("아메리칸쿠키 2box (총 12개입)", 12),
    ("크림 휘낭시에 1box (8개입)", 8),
    ("뚱카롱 마카롱 8개입 1박스 (넌사랑/넌감동)", 8),
    ("두바이 컬렉션 쫀득 뚱카롱 8구 1박스", 8),
    ("피스타치오 두바이 뚱카롱 8구 1박스", 8),
    ("봄마카롱 벚꽃에디션", 8),
    ("뚱뚱한 마카롱 2box (16구)", 16),
    ("답례 마카롱 [솔티드/블루베리] 16구", 16),
    ("네모 바게트 90g 총 9봉", 9),
    ("네모 바게트 90g 5종 2개씩 총 10봉", 10),
    ("쫀득 베이글 7종 7개입", 7),
    ("쫀득빵 7개", 7),
    ("슬랩 브레드 600g 1개", 1),
    ("통밀식빵 2+1 (총 8봉)", 8),
    ("통밀식빵 4개입 1세트", 4),
    ("파운드 케이크 5종 (총 5봉)", 5),
    ("에너지 드링크 24개입", 24),
    ("크림빵 5개입 1set", 5),
    ("통밀스콘 3가지맛 (8개)", 8),
    ("포카치아 8개", 8),
    ("아메리칸쿠키 1box (총6개입)", 6),
    ("두바이 쫀득 쿠키 4개", 4),
    ("상온 쫀득 쿠키 6개", 6),
]
# 부분 문자열 충돌(예: '아메리칸쿠키 1box...'가 '아메리칸쿠키 2box...'의 부분이 아니게)
# 방지를 위해 긴 키부터 검사.
_DISPLAY_NAME_UNITS.sort(key=lambda kv: len(kv[0]), reverse=True)


def _lookup_unit_per_set(display_name: Optional[str]) -> Optional[float]:
    """전시상품명에서 낱개 입수를 부분 매칭(포함)으로 찾는다. 매핑 없으면 None(미매핑)."""
    if not display_name:
        return None
    for key, unit in _DISPLAY_NAME_UNITS:
        if key in display_name:
            return unit
    return None


@register("롯데온")
def parse(path: str) -> Iterable[ParsedLine]:
    df = read_excel_safe(path, header=0)
    has_type_col = "유형" in df.columns  # 구버전 호환: 유형 컬럼이 없으면 진행단계로 폴백
    for _, row in df.iterrows():
        sale_dt = to_datetime(row.get("주문접수일시") or row.get("결제일시") or row.get("주문완료일시"))
        if not sale_dt:
            continue
        prod = to_str(row.get("전시상품명") or row.get("판매자상품명") or row.get("상품명"))
        if not prod:
            continue
        qty = to_float(row.get("수량") or 1)

        # 취소·반품 판별: S열[유형]='취소(주문취소)' 또는 '반품' 우선.
        # 구버전(유형 컬럼 없는 보관 원본) 폴백: U열[진행단계]에 '취소' 포함 여부(기존 로직).
        if has_type_col:
            order_type = to_str(row.get("유형")) or ""
            is_cancel = ("취소" in order_type) or ("반품" in order_type)
        else:
            stage = to_str(row.get("진행단계") or row.get("진행상태 (약식)") or "") or ""
            is_cancel = "취소" in stage

        # 매출 = AV열[결제금액] 그 자체(라인 총액, 이미 판매가×수량−할인금액 반영).
        # 수량을 다시 곱하면 이중 계상되므로 곱셈 금지(구버전 버그 수정, 2026-07-15).
        gross = to_float(row.get("결제금액"))
        if not gross:
            # 구양식 fallback: 결제금액 컬럼이 없는 보관 원본
            gross = to_float(
                row.get("판매자정산금액") or row.get("정산금액") or row.get("공급금액")
                or row.get("판매가")
            )

        yield ParsedLine(
            sale_date=sale_dt.date(),
            sale_datetime=sale_dt,
            order_no=to_str(row.get("주문번호")),
            line_no=to_str(row.get("상품주문번호") or row.get("판매자상품번호")),
            raw_product_name=prod,
            raw_option_name=to_str(row.get("전시단품명") or row.get("판매자단품명") or row.get("추가옵션")),
            raw_qty=qty,
            gross_amount=0 if is_cancel else gross,
            net_amount=0 if is_cancel else gross,
            refund_amount=gross if is_cancel else 0,
            shipping_fee=to_float(row.get("배송비")),
            is_cancelled=is_cancel,
            unit_per_set=_lookup_unit_per_set(prod),
        )
