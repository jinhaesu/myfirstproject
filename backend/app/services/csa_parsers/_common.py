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
    # ⚠️ pd.NaT는 datetime의 인스턴스 — isinstance 분기보다 먼저 걸러야 함.
    # (datetime64 컬럼에 값이 1개라도 있으면 빈 셀이 NaT로 와서, 환불일 등이
    #  전 행 '날짜 있음'으로 오판 → 지마켓 전 행 취소 처리되던 버그)
    try:
        if pd.isna(v):
            return None
    except (TypeError, ValueError):
        pass
    if isinstance(v, date) and not isinstance(v, datetime):
        return v
    if isinstance(v, datetime):
        return v.date()
    s = str(v).strip()
    if not s:
        return None
    # 순수 8자리 YYYYMMDD (예: CU 입고일자 int 20251101, 엑셀 float '20251101.0') —
    # pd.to_datetime의 잘못된 추론(2025-01-01 등) 전에 명시적으로 처리.
    s_nofloat = s[:-2] if s.endswith(".0") else s
    digits = re.sub(r"\D", "", s_nofloat)
    if len(digits) == 8:
        try:
            return datetime.strptime(digits, "%Y%m%d").date()
        except Exception:
            pass
    # 시간 포함 문자열은 날짜 부분(공백 앞)만 사용
    head = s.split()[0]
    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%Y.%m.%d", "%m/%d/%Y", "%d/%m/%Y"):
        try:
            return datetime.strptime(head, fmt).date()
        except Exception:
            continue
    try:
        return pd.to_datetime(s).date()
    except Exception:
        return None


def to_datetime(v: Any) -> Optional[datetime]:
    if v is None:
        return None
    # pd.NaT는 datetime의 인스턴스 — isinstance 분기보다 먼저 걸러야 함 (to_date 참조)
    try:
        if pd.isna(v):
            return None
    except (TypeError, ValueError):
        pass
    if isinstance(v, datetime):
        return v
    if isinstance(v, date):
        return datetime.combine(v, datetime.min.time())
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


_ESM_UNIT_RE = re.compile(r"(\d+)\s*(?:개입|구|봉|병|개|입|매|장)")


def parse_esm_option_detail(text: Any) -> tuple[Optional[str], Optional[float]]:
    """옥션/지마켓 '세부옵션데이터'(AZ열, 과거 양식) 파싱 → (옵션설명, 낱개입수).

    형식: '발송일:NN. <설명>/<추가금>원/<구매수량>개'
      예) '발송일:03-7. 베이글 4개(올리브)/0원/1개'   → ('베이글 4개(올리브)', 4)
          '발송일:01-1. 마카롱 8구 1박스(사랑)/0원/5개' → ('마카롱 8구 1박스(사랑)', 8)
          '티스파클링12병(캐모마일피치 6+블랙티레몬 6)' → 12 (괄호 안 맛 구성 숫자 무시)
    입수 = 괄호 제거 후 첫 'N개/구/봉/병/개입' 토큰. 못 찾으면 None(매핑 입수 사용).
    """
    if text is None:
        return None, None
    t = str(text).strip()
    if not t:
        return None, None
    t = re.sub(r"^발송일\s*:\s*[0-9\-]+\.\s*", "", t)
    desc = t.split("/")[0].strip()
    if not desc:
        return None, None
    no_paren = re.sub(r"\([^)]*\)", "", desc)
    ups: Optional[float] = None
    m = _ESM_UNIT_RE.search(no_paren)
    if m:
        v = int(m.group(1))
        if 1 <= v <= 200:
            ups = float(v)
    return desc, ups


def ea_per_box(text: Any) -> Optional[float]:
    """규격 텍스트에서 박스당 낱개(EA) 입수 추출.
      'BOX(140g*10ea)' → 10, '(50G*15EA)/BOX' → 15, '750G(50G*15EA)/BOX' → 15.
      매칭 없으면 None.
    """
    if text is None:
        return None
    m = re.search(r"[*xX]\s*(\d+)\s*ea", str(text), re.I)
    if m:
        v = int(m.group(1))
        if 1 <= v <= 2000:
            return float(v)
    return None


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

    # xlsx — openpyxl이 일부 변형 xlsx(styles.xml 비표준)에서
    # "CellStyle.__init__() got an unexpected keyword argument 'count'" TypeError를
    # 내므로(CJ온스타일 배송통합조회 등) calamine 엔진으로 폴백.
    if path.lower().endswith(".xlsx"):
        try:
            return pd.read_excel(path, engine="openpyxl", **kwargs)
        except Exception as e:
            log.warning("openpyxl failed for %s: %s", path, e)
            try:
                return pd.read_excel(path, engine="calamine", **kwargs)
            except Exception as e2:
                log.warning("calamine failed for %s: %s", path, e2)
            try:
                return pd.read_excel(path, **kwargs)
            except Exception:
                raise

    # xls — 정규 / HTML 위장 / Excel2003 모두 처리
    try:
        return pd.read_excel(path, engine="xlrd", **kwargs)
    except Exception:
        pass
    # HTML 위장 .xls — 인코딩 자동(euc-kr/cp949 우선) + 데이터 그리드 선택.
    # read_html은 표를 여러 개로 쪼갤 수 있음(제목/메타 블록 + 실제 데이터 표).
    # tables[0]을 무조건 쓰면 제목 블록만 잡혀 0행이 됨 → 셀 수 최대인 표를 데이터로 채택.
    try:
        import io as _io
        with open(path, "rb") as _fh:
            _data = _fh.read()
        _text = None
        for enc in ("euc-kr", "cp949", "utf-8-sig", "utf-8"):
            try:
                _text = _data.decode(enc)
                break
            except Exception:
                continue
        if _text and ("<table" in _text.lower() or "<html" in _text.lower()):
            tables = pd.read_html(_io.StringIO(_text))
            if tables:
                return max(tables, key=lambda t: t.shape[0] * t.shape[1])
    except Exception:
        pass
    # 마지막 폴백: 경로 기반 read_html(utf-8) → read_excel
    try:
        tables = pd.read_html(path, encoding="utf-8")
        if tables:
            return max(tables, key=lambda t: t.shape[0] * t.shape[1])
    except Exception:
        pass
    return pd.read_excel(path, **kwargs)
