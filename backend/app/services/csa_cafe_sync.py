"""카페사업부(mycafeproject) 한국 3지점 매출 → CSA 자동 연동.

원천: mycafeproject Supabase `sales` 테이블(영수증 단위, POS 'paid' 주문만 존재).
  - locations: 1=널담 경복궁점, 2=널담 화홍문점(행궁동), 3=널담 해방촌점
  - gross_amount = VAT 포함 결제액 → CSA 정책(공급가 환산)은 ingest 단계의
    VAT_INCLUDED_CHANNELS(÷1.1)가 적용한다. 파서 없음(API 전용 채널).
멱등성: 대상 구간의 기존 raw_lines를 삭제 후 재적재(카페 DB 상태를 그대로 미러링).
  order_no=external_id(전 건 고유)라 dedup_hash도 안정적.
접속: CAFE_DATABASE_URL env (Railway mycafeproject의 DATABASE_URL과 동일 값).
"""
from __future__ import annotations

import os
from datetime import date

import psycopg2
from sqlalchemy.orm import Session

from app.db_models import Channel, ChannelSalesRawLine
from app.services.csa_service import ParsedLine, ingest_lines, rebuild_daily_aggregate

# location_id → CSA 채널명(=품목명). 채널·품목·매핑은 마스터에 사전 등록되어 있어야 함.
CAFE_LOCATION_CHANNELS: dict[int, str] = {
    1: "경복궁 카페",   # 널담 경복궁점
    2: "행궁동 카페",   # 널담 화홍문점(수원 행궁동)
    3: "해방촌 카페",   # 널담 해방촌점
}


def _cafe_conn():
    url = os.getenv("CAFE_DATABASE_URL", "").strip()
    if not url:
        raise RuntimeError("CAFE_DATABASE_URL env가 설정되지 않음")
    url = url.replace("postgresql+psycopg://", "postgresql://").replace(
        "postgresql+psycopg2://", "postgresql://"
    )
    return psycopg2.connect(url, connect_timeout=30)


def sync_cafe_sales(db: Session, *, date_from: date, date_to: date) -> list[dict]:
    """카페 3지점 영수증을 [date_from, date_to] 구간으로 동기화(구간 교체)."""
    conn = _cafe_conn()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT location_id, external_id, business_date, gross_amount
               FROM sales
               WHERE location_id = ANY(%s) AND business_date BETWEEN %s AND %s
               ORDER BY location_id, business_date, id""",
            (list(CAFE_LOCATION_CHANNELS), date_from, date_to),
        )
        rows = cur.fetchall()
    finally:
        conn.close()

    by_loc: dict[int, list] = {}
    for loc, ext_id, bdate, gross in rows:
        by_loc.setdefault(int(loc), []).append((ext_id, bdate, float(gross or 0)))

    results: list[dict] = []
    for loc, ch_name in CAFE_LOCATION_CHANNELS.items():
        ch = db.query(Channel).filter(Channel.name == ch_name).first()
        if ch is None:
            results.append({"channel": ch_name, "error": "channel not found — 마스터 미등록"})
            continue
        deleted = (
            db.query(ChannelSalesRawLine)
            .filter(
                ChannelSalesRawLine.channel_id == ch.id,
                ChannelSalesRawLine.sale_date >= date_from,
                ChannelSalesRawLine.sale_date <= date_to,
            )
            .delete(synchronize_session=False)
        )
        db.commit()

        lines = [
            ParsedLine(
                sale_date=bdate,
                order_no=ext_id,
                line_no="1",
                raw_product_name=ch_name,
                raw_qty=1.0,
                gross_amount=gross,
                net_amount=gross,
                unit_per_set=1.0,
            )
            for (ext_id, bdate, gross) in by_loc.get(loc, [])
        ]
        if lines:
            batch = ingest_lines(
                db,
                channel_id=ch.id,
                channel_name=ch_name,
                file_name=f"cafe_sync_{date_from}_{date_to}.api",
                file_hash=None,
                file_size=0,
                parser_version="cafe-db-1",
                lines=lines,
                uploaded_by="cafe-sync",
            )
            results.append(
                {
                    "channel": ch_name,
                    "deleted": deleted,
                    "rows": len(lines),
                    "inserted": batch.row_inserted,
                    "duplicate": batch.row_duplicate,
                    "batch_id": batch.id,
                    "status": batch.status,
                }
            )
        else:
            # 신규 라인이 없어도(휴무 등) 삭제분 반영 위해 집계 재구성
            rebuild_daily_aggregate(db, channel_id=ch.id, since=date_from, until=date_to)
            results.append({"channel": ch_name, "deleted": deleted, "rows": 0, "inserted": 0})
    return results
