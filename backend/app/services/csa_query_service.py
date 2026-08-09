"""AI 채팅용 CSA(Postgres) 쿼리 실행기.

BigQuery 대신 앱 DB(app.database.SessionLocal)에 대해 LLM이 생성한 SELECT/WITH
쿼리를 안전하게 실행한다. import 시점에 DB 접속을 하지 않는다 (모듈 로드는 순수).
"""

import decimal
import logging
import re
from datetime import date, datetime, time
from typing import Any

from sqlalchemy import text

from app.services.sql_generator import validate_readonly_sql

logger = logging.getLogger(__name__)

DEFAULT_LIMIT = 500
STATEMENT_TIMEOUT = "30s"

_LIMIT_AT_END_RE = re.compile(r'\bLIMIT\s+\d+\s*$', re.IGNORECASE)

# ⛔ BOM 배합비 보안: 통합 AI 비서가 배합 구성(레시피) 테이블을 절대 조회하지 못하도록 차단.
#    (CEO 정책 — 정확한 배합비/자재 소요량 비노출)
BOM_BLOCKED_TABLES = (
    "scm_bom_lines",
    "scm_raw_materials",
    "scm_sub_materials",
    "scm_production_plans",
    "scm_production_plans_v2",
)


def enforce_blocked_tables(sql: str, blocked: tuple[str, ...]) -> None:
    """SQL이 차단 테이블을 참조하면 거부한다 (단어 경계 기준, 대소문자 무시)."""
    lowered = sql.lower()
    for tbl in blocked:
        if re.search(r'\b' + re.escape(tbl.lower()) + r'\b', lowered):
            raise ValueError(
                "배합비(레시피) 정보는 보안상 제공되지 않습니다. "
                "품목 목록·생산량·원가·매입 등 다른 지표로 질문해 주세요."
            )


def _ensure_limit(sql: str, limit: int = DEFAULT_LIMIT) -> str:
    """쿼리 끝에 LIMIT이 없으면 자동으로 붙인다."""
    stripped = sql.strip()
    if stripped.endswith(';'):
        stripped = stripped[:-1].rstrip()

    if _LIMIT_AT_END_RE.search(stripped):
        return stripped + ';'

    return f"{stripped} LIMIT {limit};"


def _convert_value(value: Any) -> Any:
    """DB 값을 JSON 직렬화 가능한 형태로 변환.

    date/datetime → isoformat 문자열, Decimal → float.
    """
    if value is None:
        return None
    if isinstance(value, (datetime, date, time)):
        return value.isoformat()
    if isinstance(value, decimal.Decimal):
        return float(value)
    if isinstance(value, (bytes, bytearray)):
        return value.decode('utf-8', errors='replace')
    if isinstance(value, (list, tuple)):
        return [_convert_value(v) for v in value]
    if isinstance(value, dict):
        return {k: _convert_value(v) for k, v in value.items()}
    return value


def execute_readonly_query(
    sql: str,
    limit: int = DEFAULT_LIMIT,
    blocked_tables: tuple[str, ...] = (),
) -> tuple[list[str], list[dict[str, Any]]]:
    """SELECT/WITH 쿼리를 앱 DB(Postgres)에 안전하게 실행하고 결과를 반환한다.

    - SELECT/WITH 단일 문만 허용 (INSERT/UPDATE/DELETE/DROP 등 차단)
    - blocked_tables 참조 시 거부 (통합 AI 비서의 BOM 배합비 차단용)
    - statement_timeout 30s 적용 (SET LOCAL, 트랜잭션 종료 시 자동 해제)
    - LIMIT이 없으면 자동으로 LIMIT {limit} 부가
    - 반환되는 컬럼/행은 JSON 직렬화 안전한 형태로 변환됨
    """
    # 순환 import 방지를 위해 함수 내부에서 import (모듈 로드시 DB 접속 방지)
    from app.database import SessionLocal

    validate_readonly_sql(sql)
    if blocked_tables:
        enforce_blocked_tables(sql, blocked_tables)
    sql_to_run = _ensure_limit(sql, limit)

    if SessionLocal is None:
        raise ValueError("데이터베이스가 설정되지 않았습니다. DATABASE_URL 환경변수를 확인하세요.")

    db = SessionLocal()
    try:
        db.execute(text(f"SET LOCAL statement_timeout = '{STATEMENT_TIMEOUT}'"))
        result = db.execute(text(sql_to_run))

        columns = list(result.keys())
        rows: list[dict[str, Any]] = []
        for row in result:
            row_dict = {col: _convert_value(value) for col, value in zip(columns, row)}
            rows.append(row_dict)

        db.rollback()  # 읽기 전용이므로 커밋 불필요, 트랜잭션/락만 정리
        return columns, rows
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
