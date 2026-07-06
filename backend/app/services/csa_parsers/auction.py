"""옥션 (이베이) 파서."""
from __future__ import annotations

from typing import Iterable

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import (
    read_excel_safe, to_datetime, to_date, to_float, to_str,
    parse_esm_option_detail,
)


@register("옥션")
@register("이베이")
def parse(path: str) -> Iterable[ParsedLine]:
    df = read_excel_safe(path, header=0)
    # 과거 양식(AZ열 '세부옵션데이터') 존재 시 옵션 설명·낱개입수를 그 값에서 추출
    has_opt_detail = "세부옵션데이터" in {str(c).strip() for c in df.columns}
    for _, row in df.iterrows():
        # 일자: 입금확인일 기준(파일이 '입금확인' 기준 추출 → 전 행 해당월).
        # 매출기준일/구매결정일은 익월로 넘어가 당월 조회에서 누락됨.
        sale_d = (
            to_date(row.get("입금확인일"))
            or to_date(row.get("주문일"))
            or to_date(row.get("매출기준일"))
        )
        if not sale_d:
            continue
        prod = to_str(row.get("상품명"))
        if not prod:
            continue
        # 취소/환불: '환불일'이 있으면 환불 확정 건 → is_cancelled(매출 제외·건수 집계).
        is_cancel = to_date(row.get("환불일")) is not None
        qty = to_float(row.get("주문수량") or row.get("수량") or 1)
        # 매출(net) = W열 결제금액  ← 사용자 지정(2026-06-05)
        net = to_float(row.get("결제금액") or row.get("판매금액"))
        gross = to_float(row.get("판매금액") or row.get("결제금액"))
        # 세부옵션데이터 → 옵션 설명(매핑용) + 낱개입수 (2026-07-06 사용자 지정)
        opt_name, ups = (None, None)
        if has_opt_detail:
            opt_name, ups = parse_esm_option_detail(row.get("세부옵션데이터"))
        yield ParsedLine(
            sale_date=sale_d,
            sale_datetime=to_datetime(row.get("주문일")),
            order_no=to_str(row.get("주문번호")),
            line_no=to_str(row.get("상품번호")),
            raw_product_name=prod,
            raw_option_name=opt_name,
            unit_per_set=ups,
            raw_qty=qty,
            gross_amount=0 if is_cancel else gross,
            net_amount=0 if is_cancel else net,
            commission=0 if is_cancel else to_float(row.get("판매수수료")),
            refund_amount=abs(net or gross) if is_cancel else 0,
            is_cancelled=is_cancel,
        )
