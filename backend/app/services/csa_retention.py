"""채널 매출 취합(CSA) 저장 효율화 — 보존 정책 + 월 파티션.

정책 (사용자 확정 2026-05-14):
- raw_lines: 24개월 hot + 5년 cold(압축) → 만료 시 DELETE
- daily_product: 영구
- upload_batches: 영구
- unmatched_products(resolved): 6개월 후 DELETE
- raw_row JSONB: 30일 후 NULL (B 옵션 — 디스크 절약)
- 월 파티션 (PostgreSQL 네이티브) + pg_cron 자동 운영
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta
from typing import Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

log = logging.getLogger(__name__)


# ──────────────────────────────────────────────────────────────
# SQL 정의
# ──────────────────────────────────────────────────────────────

# 보존 함수 (PL/pgSQL) — 멱등, 안전, 어디서 호출되어도 동일하게 동작
RETENTION_FUNCTIONS_SQL = r"""
-- 30일 지난 raw_row JSONB 비우기 (B 옵션)
CREATE OR REPLACE FUNCTION csa_clear_old_raw_row()
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  UPDATE csa_sales_raw_lines
  SET raw_row = NULL
  WHERE raw_row IS NOT NULL
    AND created_at < NOW() - INTERVAL '30 days';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

-- 24개월 지난 라인을 아카이브 테이블로 이전 후 원본 삭제
-- 아카이브는 JSONB로 압축 보관 (배치 단위)
CREATE TABLE IF NOT EXISTS csa_sales_archive (
  archive_month DATE NOT NULL,
  channel_id VARCHAR(100) NOT NULL,
  payload JSONB NOT NULL,
  line_count INTEGER NOT NULL,
  archived_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (archive_month, channel_id)
);
CREATE INDEX IF NOT EXISTS idx_csa_archive_month ON csa_sales_archive(archive_month);

CREATE OR REPLACE FUNCTION csa_archive_old_raw_lines()
RETURNS TABLE(archived_months INTEGER, archived_lines BIGINT) LANGUAGE plpgsql AS $$
DECLARE
  cutoff DATE := (NOW() - INTERVAL '24 months')::date;
  m_count INTEGER := 0;
  l_count BIGINT := 0;
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT date_trunc('month', sale_date)::date AS m, channel_id
    FROM csa_sales_raw_lines
    WHERE sale_date < cutoff
    GROUP BY 1, 2
  LOOP
    INSERT INTO csa_sales_archive (archive_month, channel_id, payload, line_count)
    SELECT
      rec.m, rec.channel_id,
      jsonb_agg(to_jsonb(r.*) - 'raw_row'),
      COUNT(*)
    FROM csa_sales_raw_lines r
    WHERE r.sale_date >= rec.m AND r.sale_date < rec.m + INTERVAL '1 month'
      AND r.channel_id = rec.channel_id
    ON CONFLICT (archive_month, channel_id) DO UPDATE
      SET payload = EXCLUDED.payload,
          line_count = EXCLUDED.line_count,
          archived_at = NOW();

    DELETE FROM csa_sales_raw_lines
    WHERE sale_date >= rec.m AND sale_date < rec.m + INTERVAL '1 month'
      AND channel_id = rec.channel_id;

    m_count := m_count + 1;
    l_count := l_count + (SELECT line_count FROM csa_sales_archive
                          WHERE archive_month = rec.m AND channel_id = rec.channel_id);
  END LOOP;
  RETURN QUERY SELECT m_count, l_count;
END;
$$;

-- 5년 지난 아카이브 영구 삭제 (세무 보관 5년)
CREATE OR REPLACE FUNCTION csa_purge_archive_beyond_5y()
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  DELETE FROM csa_sales_archive
  WHERE archive_month < (NOW() - INTERVAL '5 years')::date;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

-- resolved 또는 ignored 된 매핑 큐 6개월 후 삭제
CREATE OR REPLACE FUNCTION csa_purge_resolved_unmatched()
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  DELETE FROM csa_unmatched_products
  WHERE status IN ('resolved', 'ignored', 'excluded')
    AND COALESCE(resolved_at, last_seen_at) < NOW() - INTERVAL '6 months';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

-- 통합 retention 실행기
CREATE OR REPLACE FUNCTION csa_run_retention()
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  cleared_raw bigint;
  archived RECORD;
  purged_archive bigint;
  purged_unmatched bigint;
BEGIN
  SELECT csa_clear_old_raw_row() INTO cleared_raw;
  SELECT * INTO archived FROM csa_archive_old_raw_lines();
  SELECT csa_purge_archive_beyond_5y() INTO purged_archive;
  SELECT csa_purge_resolved_unmatched() INTO purged_unmatched;
  RETURN jsonb_build_object(
    'cleared_raw_row', cleared_raw,
    'archived_months', archived.archived_months,
    'archived_lines', archived.archived_lines,
    'purged_archive_5y', purged_archive,
    'purged_unmatched_6m', purged_unmatched,
    'ran_at', NOW()
  );
END;
$$;

-- retention 실행 로그
CREATE TABLE IF NOT EXISTS csa_retention_log (
  id BIGSERIAL PRIMARY KEY,
  ran_at TIMESTAMP DEFAULT NOW(),
  result JSONB NOT NULL
);

-- 매일 02:00 KST 실행 (UTC 17:00)에 wrapping 함수
CREATE OR REPLACE FUNCTION csa_scheduled_retention()
RETURNS void LANGUAGE plpgsql AS $$
DECLARE r jsonb;
BEGIN
  SELECT csa_run_retention() INTO r;
  INSERT INTO csa_retention_log(result) VALUES(r);
END;
$$;
"""

# pg_cron 스케줄 등록 (멱등) - Supabase Pro에서 pg_cron 사용 가능
PG_CRON_SCHEDULE_SQL = r"""
-- pg_cron 확장 활성화
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 매일 02:00 KST = 17:00 UTC: 통합 retention 실행
SELECT cron.unschedule('csa_daily_retention') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'csa_daily_retention'
);
SELECT cron.schedule('csa_daily_retention', '0 17 * * *', $$SELECT csa_scheduled_retention();$$);
"""


# ──────────────────────────────────────────────────────────────
# 파티션 마이그레이션 SQL — 별도, 멱등 (운영자가 트리거)
# ──────────────────────────────────────────────────────────────

PARTITION_MIGRATION_SQL = r"""
DO $$
DECLARE
  is_partitioned BOOLEAN;
  row_count BIGINT;
  min_d DATE;
  max_d DATE;
  cur_d DATE;
  end_d DATE;
  part_name TEXT;
BEGIN
  -- 이미 파티션 테이블이면 skip
  SELECT EXISTS (
    SELECT 1 FROM pg_partitioned_table pt
    JOIN pg_class c ON pt.partrelid = c.oid
    WHERE c.relname = 'csa_sales_raw_lines'
  ) INTO is_partitioned;

  IF is_partitioned THEN
    RAISE NOTICE 'csa_sales_raw_lines already partitioned — only adding future partitions';
  ELSE
    SELECT COUNT(*) FROM csa_sales_raw_lines INTO row_count;
    RAISE NOTICE 'Migrating csa_sales_raw_lines to partitioned table (% rows)', row_count;

    -- 1) 기존 테이블 백업으로 rename
    ALTER TABLE csa_sales_raw_lines RENAME TO csa_sales_raw_lines_old;
    ALTER INDEX IF EXISTS csa_sales_raw_lines_pkey RENAME TO csa_sales_raw_lines_old_pkey;
    ALTER INDEX IF EXISTS ix_csa_sales_raw_lines_dedup_hash RENAME TO ix_csa_sales_raw_lines_old_dedup_hash;

    -- 2) 새 파티션 부모 테이블 생성 (sale_date 기반 RANGE)
    CREATE TABLE csa_sales_raw_lines (
      id BIGSERIAL,
      batch_id VARCHAR(64),
      channel_id VARCHAR(100),
      channel_name VARCHAR(200),
      order_no VARCHAR(200),
      line_no VARCHAR(100),
      dedup_hash VARCHAR(64) NOT NULL,
      sale_date DATE NOT NULL,
      sale_datetime TIMESTAMP,
      raw_product_name VARCHAR(500),
      raw_option_name VARCHAR(500),
      raw_qty DOUBLE PRECISION DEFAULT 0,
      gross_amount DOUBLE PRECISION DEFAULT 0,
      net_amount DOUBLE PRECISION DEFAULT 0,
      settlement_amount DOUBLE PRECISION DEFAULT 0,
      commission DOUBLE PRECISION DEFAULT 0,
      shipping_fee DOUBLE PRECISION DEFAULT 0,
      refund_amount DOUBLE PRECISION DEFAULT 0,
      product_id INTEGER,
      pcs_qty DOUBLE PRECISION DEFAULT 0,
      mapping_status VARCHAR(20) DEFAULT 'pending',
      raw_row JSONB,
      created_at TIMESTAMP DEFAULT NOW(),
      PRIMARY KEY (id, sale_date)
    ) PARTITION BY RANGE (sale_date);

    CREATE UNIQUE INDEX csa_raw_dedup_uq ON csa_sales_raw_lines (dedup_hash, sale_date);
    CREATE INDEX csa_raw_date_ch ON csa_sales_raw_lines (sale_date, channel_id);
    CREATE INDEX csa_raw_product ON csa_sales_raw_lines (product_id) WHERE product_id IS NOT NULL;
    CREATE INDEX csa_raw_mapping_status ON csa_sales_raw_lines (mapping_status) WHERE mapping_status <> 'matched';

    -- 3) DEFAULT 파티션 (예상외 범위)
    CREATE TABLE csa_sales_raw_lines_default PARTITION OF csa_sales_raw_lines DEFAULT;

    -- 4) 데이터 범위에 맞춰 월 파티션 생성
    IF row_count > 0 THEN
      SELECT MIN(sale_date), MAX(sale_date) INTO min_d, max_d FROM csa_sales_raw_lines_old;
      cur_d := date_trunc('month', min_d)::date;
      end_d := date_trunc('month', max_d)::date + INTERVAL '1 month';
    ELSE
      cur_d := date_trunc('month', CURRENT_DATE)::date;
      end_d := cur_d + INTERVAL '1 month';
    END IF;

    -- 미래 3개월 + 과거 데이터 전체 커버
    end_d := GREATEST(end_d, (date_trunc('month', CURRENT_DATE) + INTERVAL '3 months')::date);

    WHILE cur_d < end_d LOOP
      part_name := 'csa_sales_raw_lines_' || to_char(cur_d, 'YYYY_MM');
      EXECUTE format(
        'CREATE TABLE IF NOT EXISTS %I PARTITION OF csa_sales_raw_lines FOR VALUES FROM (%L) TO (%L)',
        part_name, cur_d, (cur_d + INTERVAL '1 month')::date
      );
      cur_d := (cur_d + INTERVAL '1 month')::date;
    END LOOP;

    -- 5) 데이터 복귀
    IF row_count > 0 THEN
      INSERT INTO csa_sales_raw_lines (
        id, batch_id, channel_id, channel_name, order_no, line_no,
        dedup_hash, sale_date, sale_datetime, raw_product_name, raw_option_name,
        raw_qty, gross_amount, net_amount, settlement_amount, commission,
        shipping_fee, refund_amount, product_id, pcs_qty, mapping_status,
        raw_row, created_at
      )
      SELECT
        id, batch_id, channel_id, channel_name, order_no, line_no,
        dedup_hash, sale_date, sale_datetime, raw_product_name, raw_option_name,
        raw_qty, gross_amount, net_amount, settlement_amount, commission,
        shipping_fee, refund_amount, product_id, pcs_qty, mapping_status,
        raw_row, created_at
      FROM csa_sales_raw_lines_old;

      -- 시퀀스 재정렬
      PERFORM setval(pg_get_serial_sequence('csa_sales_raw_lines','id'),
                     (SELECT COALESCE(MAX(id), 1) FROM csa_sales_raw_lines));
    END IF;

    DROP TABLE csa_sales_raw_lines_old;
  END IF;

  -- 6) 향후 3개월 파티션 미리 보장
  cur_d := date_trunc('month', CURRENT_DATE)::date;
  FOR i IN 0..5 LOOP
    part_name := 'csa_sales_raw_lines_' || to_char(cur_d + (i || ' months')::interval, 'YYYY_MM');
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I PARTITION OF csa_sales_raw_lines FOR VALUES FROM (%L) TO (%L)',
      part_name,
      (cur_d + (i || ' months')::interval)::date,
      (cur_d + ((i+1) || ' months')::interval)::date
    );
  END LOOP;
END$$;
"""


# 매월 25일 03:00 KST: 다음 3개월 파티션 보장 + 24개월 지난 파티션 DROP
ENSURE_FUTURE_PARTITIONS_SQL = r"""
CREATE OR REPLACE FUNCTION csa_ensure_future_partitions()
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  cur_d DATE := date_trunc('month', CURRENT_DATE)::date;
  part_name TEXT;
  created INTEGER := 0;
  dropped INTEGER := 0;
  drop_cutoff DATE := (date_trunc('month', NOW() - INTERVAL '24 months'))::date;
  rec RECORD;
BEGIN
  -- 미래 3개월
  FOR i IN 0..5 LOOP
    part_name := 'csa_sales_raw_lines_' || to_char(cur_d + (i || ' months')::interval, 'YYYY_MM');
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I PARTITION OF csa_sales_raw_lines FOR VALUES FROM (%L) TO (%L)',
      part_name,
      (cur_d + (i || ' months')::interval)::date,
      (cur_d + ((i+1) || ' months')::interval)::date
    );
    created := created + 1;
  END LOOP;

  -- 24개월 지난 빈 파티션 정리 (아카이브 후 비어있어야 함)
  FOR rec IN
    SELECT c.relname
    FROM pg_inherits i
    JOIN pg_class c ON i.inhrelid = c.oid
    JOIN pg_class p ON i.inhparent = p.oid
    WHERE p.relname = 'csa_sales_raw_lines'
      AND c.relname LIKE 'csa_sales_raw_lines_____\___'
      AND c.relname < ('csa_sales_raw_lines_' || to_char(drop_cutoff, 'YYYY_MM'))
  LOOP
    EXECUTE format('DROP TABLE IF EXISTS %I', rec.relname);
    dropped := dropped + 1;
  END LOOP;

  RETURN jsonb_build_object('created', created, 'dropped', dropped, 'ran_at', NOW());
END;
$$;

-- 매월 25일 03:00 KST = 24일 18:00 UTC
SELECT cron.unschedule('csa_monthly_partitions') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'csa_monthly_partitions'
);
SELECT cron.schedule('csa_monthly_partitions', '0 18 24 * *',
  $$SELECT csa_ensure_future_partitions();$$);
"""


# ──────────────────────────────────────────────────────────────
# 실행 인터페이스
# ──────────────────────────────────────────────────────────────

def setup_retention_functions(db: Session) -> dict:
    """retention 함수 및 archive 테이블 생성 (멱등). DB가 PostgreSQL일 때만."""
    try:
        db.execute(text(RETENTION_FUNCTIONS_SQL))
        db.commit()
        return {"ok": True}
    except Exception as e:
        db.rollback()
        return {"ok": False, "error": f"{type(e).__name__}: {e}"}


def setup_pg_cron_schedules(db: Session) -> dict:
    """pg_cron 스케줄 등록 (Supabase Pro 권한 필요)."""
    try:
        db.execute(text(PG_CRON_SCHEDULE_SQL))
        db.commit()
        return {"ok": True, "scheduled": "csa_daily_retention @ 17:00 UTC (02:00 KST)"}
    except Exception as e:
        db.rollback()
        return {"ok": False, "error": f"{type(e).__name__}: {e}"}


def migrate_to_partitions(db: Session) -> dict:
    """파티션 테이블로 1회 마이그레이션 + 미래 파티션 자동 생성."""
    try:
        db.execute(text(PARTITION_MIGRATION_SQL))
        db.execute(text(ENSURE_FUTURE_PARTITIONS_SQL))
        db.commit()
        return {"ok": True}
    except Exception as e:
        db.rollback()
        return {"ok": False, "error": f"{type(e).__name__}: {e}"}


def run_retention_now(db: Session) -> dict:
    """수동 retention 실행."""
    try:
        row = db.execute(text("SELECT csa_run_retention()::text AS r")).fetchone()
        # log에도 기록
        db.execute(text("INSERT INTO csa_retention_log(result) VALUES (csa_run_retention()::jsonb)"))
        db.commit()
        return {"ok": True, "result": row.r if row else None}
    except Exception as e:
        db.rollback()
        return {"ok": False, "error": f"{type(e).__name__}: {e}"}


def get_storage_status(db: Session) -> dict:
    """DB 크기·테이블 사용량·파티션 현황·최근 retention 결과."""
    out: dict = {}
    try:
        out["db_size"] = db.execute(text(
            "SELECT pg_size_pretty(pg_database_size(current_database())) AS s, "
            "pg_database_size(current_database()) AS bytes"
        )).mappings().first()
    except Exception as e:
        out["db_size_error"] = str(e)

    try:
        rows = db.execute(text("""
            SELECT relname AS table_name,
                   pg_size_pretty(pg_total_relation_size(c.oid)) AS pretty_size,
                   pg_total_relation_size(c.oid) AS bytes,
                   (SELECT reltuples::bigint FROM pg_class WHERE oid = c.oid) AS est_rows
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public'
              AND c.relname LIKE 'csa_%'
              AND c.relkind IN ('r','p')
            ORDER BY pg_total_relation_size(c.oid) DESC
            LIMIT 30
        """)).mappings().all()
        out["tables"] = [dict(r) for r in rows]
    except Exception as e:
        out["tables_error"] = str(e)

    try:
        # 파티션 현황
        parts = db.execute(text("""
            SELECT c.relname AS partition_name,
                   pg_size_pretty(pg_total_relation_size(c.oid)) AS pretty_size,
                   pg_total_relation_size(c.oid) AS bytes,
                   (SELECT reltuples::bigint FROM pg_class WHERE oid = c.oid) AS est_rows
            FROM pg_inherits i
            JOIN pg_class c ON i.inhrelid = c.oid
            JOIN pg_class p ON i.inhparent = p.oid
            WHERE p.relname = 'csa_sales_raw_lines'
            ORDER BY c.relname DESC
            LIMIT 60
        """)).mappings().all()
        out["partitions"] = [dict(r) for r in parts]
    except Exception as e:
        out["partitions"] = []

    try:
        is_part = db.execute(text("""
            SELECT EXISTS (
              SELECT 1 FROM pg_partitioned_table pt
              JOIN pg_class c ON pt.partrelid = c.oid
              WHERE c.relname = 'csa_sales_raw_lines'
            ) AS is_partitioned
        """)).first()
        out["is_partitioned"] = bool(is_part.is_partitioned) if is_part else False
    except Exception:
        out["is_partitioned"] = False

    try:
        cron_jobs = db.execute(text("""
            SELECT jobname, schedule, active
            FROM cron.job
            WHERE jobname LIKE 'csa_%'
        """)).mappings().all()
        out["cron_jobs"] = [dict(r) for r in cron_jobs]
    except Exception:
        out["cron_jobs"] = []

    try:
        recent = db.execute(text("""
            SELECT ran_at, result FROM csa_retention_log
            ORDER BY ran_at DESC LIMIT 10
        """)).mappings().all()
        out["recent_runs"] = [dict(r) for r in recent]
    except Exception:
        out["recent_runs"] = []

    return out
