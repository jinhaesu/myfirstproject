"""파서 공통 유틸."""
from __future__ import annotations

import hashlib
import logging
import re
from datetime import date, datetime
from typing import Any, Optional

import pandas as pd

log = logging.getLogger(__name__)


def file_sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def to_date(v: Any) -> Optional[date]:
    if v is None:
        return None
    if isinstance(v, date) and not isinstance(v, datetime):
        return v
    if isinstance(v, datetime):
        return v.date()
    if pd.isna(v):
        return None
    s = str(v).strip()
    if not s:
        return None
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M",
                "%Y/%m/%d %H:%M:%S", "%Y/%m/%d %H:%M",
                "%Y.%m.%d %H:%M:%S", "%Y.%m.%d %H:%M",
                "%Y-%m-%d", "%Y/%m/%d", "%Y.%m.%d",
                "%Y%m%d", "%m/%d/%Y", "%d/%m/%Y"):
        try:
            return datetime.strptime(s[:len(fmt)+0], fmt).date()
        except Exception:
            continue
    try:
        return pd.to_datetime(s).date()
    except Exception:
        return None


def to_datetime(v: Any) -> Optional[datetime]:
    if v is None:
        return None
    if isinstance(v, datetime):
        return v
    if isinstance(v, date):
        return datetime.combine(v, datetime.min.time())
    if pd.isna(v):
        return None
    s = str(v).strip()
    if not s:
        return None
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M",
                "%Y/%m/%d %H:%M:%S", "%Y/%m/%d %H:%M",
                "%Y.%m.%d %H:%M:%S", "%Y.%m.%d %H:%M",
                "%Y-%m-%d", "%Y/%m/%d", "%Y.%m.%d"):
        try:
            return datetime.strptime(s[:len(fmt)+0], fmt)
        except Exception:
            continue
    try:
        return pd.to_datetime(s).to_pydatetime()
    except Exception:
        return None


def to_float(v: Any) -> float:
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return 0.0
    if isinstance(v, (int, float)):
        return float(v)
    s = re.sub(r"[^\d.\-]", "", str(v))
    if not s or s in ("-", "."):
        return 0.0
    try:
        return float(s)
    except Exception:
        return 0.0


def to_int(v: Any) -> int:
    return int(to_float(v))


def to_str(v: Any) -> Optional[str]:
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return None
    s = str(v).strip()
    return s or None


def read_excel_safe(path: str, **kwargs) -> pd.DataFrame:
    """xls/xlsx/csv 안전하게 읽기. 일부 .xls는 사실 HTML."""
    import warnings
    warnings.filterwarnings("ignore")

    if path.lower().endswith(".csv"):
        for enc in ("utf-8-sig", "utf-8", "cp949", "euc-kr"):
            try:
                return pd.read_csv(path, encoding=enc, **kwargs)
            except UnicodeDecodeError:
                continue
        return pd.read_csv(path, encoding="utf-8", errors="ignore", **kwargs)

    # xlsx
    if path.lower().endswith(".xlsx"):
        try:
            return pd.read_excel(path, engine="openpyxl", **kwargs)
        except Exception as e:
            log.warning("openpyxl failed for %s: %s", path, e)
            try:
                return pd.read_excel(path, **kwargs)
            except Exception:
                raise

    # xls — 정규 / HTML 위장 / Excel2003 모두 처리
    try:
        return pd.read_excel(path, engine="xlrd", **kwargs)
    except Exception:
        pass
    try:
        # HTML 위장 .xls
        tables = pd.read_html(path, encoding="utf-8")
        if tables:
            return tables[0]
    except Exception:
        pass
    return pd.read_excel(path, **kwargs)
