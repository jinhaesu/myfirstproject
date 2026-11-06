"""올웨이즈 파서.

두 가지 양식 지원:
  A) 주문건별정산내역 (2026-06 신양식) — 컬럼:
       결제일자, 정산일자, 배송 완료 시점, 취소 완료 시점, 구매확정 시점,
       주문번호, 합배송 ID, 상품명, 옵션, 수량, 주문 상태, 결제 수단,
       상품 구매액, 배송비, 추가 지원 금액, 올웨이즈 부담 쿠폰, 판매자 부담 쿠폰,
       취소 금액, 기 정산액, 기 정산 수수료, 수수료율 %, 수수료, 특별 수수료, 정산금액
     - 행수(주문건수) = G열 [합배송 ID] 고유값  ← 사용자 지정(2026-06-12)
     - 순매출(스펙) = (M열[상품 구매액] + P열[올웨이즈 부담 쿠폰] + N열[배송비] − R열[취소 금액]) / 1.1
       ← 기준변경요청서 #87(2026-11, 임현정, 2025-01-01분부터 적용). 종전(2026-07-14)
       'M + P + O[추가 지원 금액]'에서 O를 빼고 N(배송비)을 더하며 R(취소 금액)을 차감.
       Q열[판매자 부담 쿠폰]은 이미 M에 반영돼 있어 차감하지 않는다.
       단, ÷1.1은 이 파서가 아니라 csa_service.ingest_lines가 is_vat_included("올웨이즈")=True
       (VAT_INCLUDED_CHANNELS 소속)일 때 net_amount에 자동 적용하므로, 파서는 VAT 포함
       합계만 net_amount로 넘긴다(이중 환산 방지).
     - 매출 기준일 = A열[결제일자]
     - 낱개수량 = H열[상품명]+I열[옵션] 결합 텍스트에서 정규식으로 세트 입수(N)를
       추출해 J열[수량]과 곱연산 (우선순위는 _extract_units_per_set 참조, 2026-07-14 임현정)
     - 취소/반품/환불: K열[주문 상태]='주문취소'(및 '취소'/'환불'/'반품' 포함) 시 매출 제외,
       취소액은 R열[취소 금액]으로 refund에 기록. 상태가 정상이어도 R로 전액 상계돼 순매출이
       0 이하가 되면 취소로 본다(적재 시 net 0 → gross 폴백으로 매출이 되살아나는 것 방지).
       11월 샘플(2026-11-01~04, 163행): 순매출 합 1,599,405(VAT 포함, ÷1.1 = 1,454,005)
       = 담당자 정답 1,599,405 일치. 주문취소 6행은 M−R=0.
  B) 정산 예정 매출 내역 (구양식) — 합배송 아이디 / 상품 구매금액 /
       판매자 부담 쿠폰할인금 / 주문 성사 시점 기반. (하위호환 — 로직 변경 없음)
"""
from __future__ import annotations
import re
from collections import defaultdict
from typing import Iterable, Optional

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import read_excel_safe, to_datetime, to_date, to_float, to_str

# ── 올웨이즈 낱개수량(입수) 파싱 정규식 우선순위 (2026-07-14 임현정 기준변경요청) ──
_UNIT_SUFFIX = r"(?:구|개|봉|병|개입)"
_RE_TOTAL = re.compile(r"총\s*(\d+)\s*" + _UNIT_SUFFIX)
_RE_PLUS = re.compile(r"(\d+)\s*\+\s*(\d+)\s*" + _UNIT_SUFFIX)
_RE_JONG_SET = re.compile(r"(\d+)\s*종\s*2\s*(?:세트|셋트|box|박스)", re.I)
_RE_UNIT_NUM = re.compile(r"(\d+)\s*" + _UNIT_SUFFIX)
_RE_JONG = re.compile(r"(\d+)\s*종")


def _extract_units_per_set(name: Optional[str], opt: Optional[str]) -> float:
    """상품명+옵션 결합 텍스트에서 세트 입수(N) 추출.

    우선순위: 1) '총 N구/개/봉/병/개입' 2) 'N+N구/개/봉/병/개입'(합산)
      3) 'N종 2세트/2BOX'(N×2) 4) 'N구/개/봉/병/개입'(숫자 여러 개면 최댓값)
      5) 'N종' 6) 매칭 없으면 기본값 1
    """
    text = f"{name or ''} {opt or ''}"
    m = _RE_TOTAL.search(text)
    if m:
        return float(m.group(1))
    m = _RE_PLUS.search(text)
    if m:
        return float(int(m.group(1)) + int(m.group(2)))
    m = _RE_JONG_SET.search(text)
    if m:
        return float(int(m.group(1)) * 2)
    nums = [int(n) for n in _RE_UNIT_NUM.findall(text)]
    if nums:
        return float(max(nums))
    m = _RE_JONG.search(text)
    if m:
        return float(m.group(1))
    return 1.0


@register("올웨이즈")
def parse(path: str) -> Iterable[ParsedLine]:
    df = read_excel_safe(path, header=0)
    cols = set(str(c) for c in df.columns)
    is_new = "합배송 ID" in cols or "상품 구매액" in cols

    # 행수(주문건수) = 합배송 ID 고유값 기준 → order_no를 합배송 ID로.
    # 같은 합배송에 복수 상품행이 있어도 낱개 SUM이 유지되도록 line_no에 시퀀스 부여.
    _seq: dict = defaultdict(int)

    for _, row in df.iterrows():
        if is_new:
            # ── 신양식: 주문건별정산내역 ──
            # 취소 = K열[주문 상태]='주문취소' (#87). 기존 '취소/환불/반품' 포함 판정 유지.
            status = to_str(row.get("주문 상태") or "") or ""
            is_cancel = "취소" in status or "환불" in status or "반품" in status

            # 매출 기준일 = A열[결제일자] (#87). 결제일자 공란 시에만 보조 시점 사용.
            sale_dt = (
                to_datetime(row.get("결제일자"))
                or to_datetime(row.get("배송 완료 시점"))
                or to_datetime(row.get("구매확정 시점"))
            )
            if not sale_dt:
                continue
            prod = to_str(row.get("상품명"))
            if not prod:
                continue
            opt = to_str(row.get("옵션"))
            # 순매출 = (상품 구매액 + 올웨이즈 부담 쿠폰 + 배송비 − 취소 금액) / 1.1
            # ← 기준변경요청서 #87(2026-11 임현정, 2025-01-01분부터). 판매자 부담 쿠폰(Q)은
            # 이미 상품 구매액(M)에 반영돼 있어 차감하지 않는다. 추가 지원 금액(O)은 제외.
            # ÷1.1은 이 파서가 아니라 ingest_lines가 is_vat_included("올웨이즈")=True일 때
            # net_amount에 자동 적용한다(VAT_INCLUDED_CHANNELS).
            # 여기서 또 나누면 이중 환산되므로 net_amount에는 VAT 포함 합계만 담는다.
            # 컬럼이 없는 구버전 보관 원본은 to_float(None)=0으로 폴백되어 예외 없이 동작.
            gross = to_float(row.get("상품 구매액"))
            allways_coupon = to_float(row.get("올웨이즈 부담 쿠폰"))
            ship = to_float(row.get("배송비"))
            refund = to_float(row.get("취소 금액"))
            net = gross + allways_coupon + ship - refund
            # 상태가 정상이어도 취소 금액으로 전액 상계(순매출 0 이하)되면 취소로 처리 —
            # net 0을 넘기면 적재 시 'net or gross' 폴백으로 상품 구매액이 매출로 잡힌다.
            if not is_cancel and refund > 0 and net <= 0:
                is_cancel = True
            order_no = to_str(row.get("합배송 ID") or row.get("주문번호"))
            commission = to_float(row.get("수수료")) + to_float(row.get("특별 수수료"))
            units_per_set = _extract_units_per_set(prod, opt)
        else:
            # ── 구양식: 정산 예정 매출 내역 ──
            status = to_str(row.get("주문 상태") or row.get("상태") or "") or ""
            cancel_yn = to_str(row.get("취소/반품 여부") or "") or ""
            is_cancel = (
                status in ("취소", "반품", "취소완료", "반품완료")
                or cancel_yn in ("Y", "취소", "반품")
            )

            sale_dt = (
                to_datetime(row.get("주문 성사 시점"))
                or to_datetime(row.get("배송 완료 시점"))
                or to_datetime(row.get("구매(취소) 확정 시점"))
            )
            if not sale_dt:
                continue
            prod = to_str(row.get("상품명"))
            if not prod:
                continue
            # 매출 = 상품 구매금액(H) − 판매자 부담 쿠폰할인금(L)  ← 사용자 지정(2026-06-05)
            gross = to_float(row.get("상품 구매금액"))
            seller_coupon = to_float(
                row.get("판매자 부담 쿠폰할인금")
                or row.get("판매자 부담 쿠폰 할인금")
                or row.get("판매자부담쿠폰할인금")
            )
            net = gross - seller_coupon
            refund = net
            order_no = to_str(row.get("합배송 아이디") or row.get("합배송아이디") or row.get("주문아이디"))
            opt = to_str(row.get("옵션"))
            commission = to_float(row.get("수수료") or row.get("특별 수수료(기타 매출)"))
            # 구양식은 낱개수량 산식 스펙 대상 외 — 하위호환을 위해 기존 그대로
            # (unit_per_set=None → 매핑 테이블의 입수값 사용).
            units_per_set = None

        _seq[order_no or ""] += 1
        line_no = f"{_seq[order_no or '']}"
        yield ParsedLine(
            sale_date=sale_dt.date(),
            sale_datetime=sale_dt,
            order_no=order_no,
            line_no=line_no,
            raw_product_name=prod,
            raw_option_name=opt,
            raw_qty=to_float(row.get("수량") or 1),
            gross_amount=0 if is_cancel else gross,
            net_amount=0 if is_cancel else net,
            refund_amount=refund if is_cancel else 0,
            commission=0 if is_cancel else commission,
            unit_per_set=None if is_cancel else units_per_set,
            is_cancelled=is_cancel,
        )
