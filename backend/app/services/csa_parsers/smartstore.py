"""스마트스토어 파서. 원본 파일은 비밀번호 보호이므로 사전에 해제된 파일 전제.

업로드 시점에 비밀번호(기본 0000)를 받아서 미리 풀어주는 처리는 라우터에서.

집계 기준: 최종 상품별 총 주문금액 (할인 후 실결제 총액).
구매확정 파일 기준. 상품가격(정가)은 사용하지 않음.
날짜 기준: 결제일 (구매확정 파일에는 결제일시 없으므로 결제일 사용).
"""
from __future__ import annotations

from typing import Iterable

from app.services.csa_service import ParsedLine
from app.services.csa_parsers import register
from app.services.csa_parsers._common import (
    read_excel_safe, to_datetime, to_float, to_str,
)


@register("스마트스토어")
def parse(path: str) -> Iterable[ParsedLine]:
    df = read_excel_safe(path, header=0)
    for _, row in df.iterrows():
        sale_dt = (
            to_datetime(row.get("결제일"))
            or to_datetime(row.get("결제일시"))
            or to_datetime(row.get("주문일시"))
            or to_datetime(row.get("구매확정일"))
        )
        if not sale_dt:
            continue
        prod = to_str(row.get("상품명")) or to_str(row.get("상품 종류"))
        if not prod:
            continue

        # 집계 기준: 최종 상품별 총 주문금액 (할인 반영 실결제액)
        # fallback: 정산예정금액, 최초 상품별 총 주문금액, 상품가격
        gross = (
            to_float(row.get("최종 상품별 총 주문금액"))
            or to_float(row.get("정산예정금액"))
            or to_float(row.get("최초 상품별 총 주문금액"))
            or to_float(row.get("상품가격"))
        )
        net = to_float(row.get("정산예정금액")) or gross

        yield ParsedLine(
            sale_date=sale_dt.date(),
            sale_datetime=sale_dt,
            order_no=to_str(row.get("주문번호")),
            line_no=to_str(row.get("상품주문번호")),
            raw_product_name=prod,
            raw_option_name=to_str(row.get("옵션정보") or row.get("옵션")),
            raw_qty=to_float(row.get("수량") or 1),
            gross_amount=gross,
            net_amount=net,
            commission=to_float(row.get("네이버페이 주문관리 수수료") or row.get("매출연동 수수료") or row.get("수수료")),
        )
