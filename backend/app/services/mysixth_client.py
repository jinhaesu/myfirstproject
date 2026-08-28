"""mysixthproject(근태·급여) 연동 — 생산팀 노무시간·노무비를 일별로 가져와 생산실적과 대조.

self-발행 JWT로 관리자 API 호출.
생산팀만 집계: 부서 '생산*'(생산2층/생산3층/생산 야간), 파견/알바 사업장 F2/F3/공장.
**물류·카페·본사 제외.**
"""
from __future__ import annotations

import os
import json
import time
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone, timedelta, date

# 2026-08-23 mysixthproject Railway→Cloud Run 이관. 구 Railway URL은 재배포 차단(404).
BASE = os.getenv("MYSIXTH_BASE_URL", "https://mysixthproject-557811875995.asia-northeast3.run.app")
# 실 시크릿은 Cloud Run env(MYSIXTH_JWT_SECRET)로 주입. 코드 기본값은 로컬 개발용 더미.
SECRET = os.getenv("MYSIXTH_JWT_SECRET", "attendance-management-secret-key")
ADMIN_EMAIL = os.getenv("MYSIXTH_ADMIN_EMAIL", "ceo@joinandjoin.com")

# 최근 연동 오류 기록(진단용) — except:pass로 조용히 죽지 않도록 표면화.
_ERRORS: list[str] = []


def _log_err(where: str, e: Exception) -> None:
    msg = f"{where}: {type(e).__name__} {str(e)[:120]}"
    _ERRORS.append(msg)
    del _ERRORS[:-20]

# 생산팀 아닌 사업장(파견/알바 workplace)·부서 판별용 제외어
_NON_PRODUCTION = ("은공간", "본사", "카페", "물류")

_CACHE: dict = {}
_TTL = 300


def _token() -> str:
    import jwt
    # requireAuth는 type=='auth' 요구. 관리자 라우트 대비 id/role/name 포함.
    payload = {"type": "auth", "id": 1, "email": ADMIN_EMAIL, "role": "admin", "name": "CEO",
               "exp": datetime.now(timezone.utc) + timedelta(hours=1)}
    return jwt.encode(payload, SECRET, algorithm="HS256")


def _get(path: str, timeout: int = 40):
    req = urllib.request.Request(BASE + path, headers={"Authorization": "Bearer " + _token()})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def _is_production_wp(wp: str) -> bool:
    wp = (wp or "").strip()
    return bool(wp) and not any(x in wp for x in _NON_PRODUCTION)


def _is_production_dept(dept: str) -> bool:
    """생산팀만 — '생산' 부서만(물류·카페 제외)."""
    return "생산" in (dept or "")


def _months_between(start: str, end: str) -> list[str]:
    y, m = int(start[:4]), int(start[5:7])
    ey, em = int(end[:4]), int(end[5:7])
    out = []
    while (y, m) <= (ey, em):
        out.append(f"{y}-{m:02d}")
        m += 1
        if m > 12:
            m = 1; y += 1
    return out


def _month_bounds(ym: str):
    y, m = int(ym[:4]), int(ym[5:7])
    s = date(y, m, 1)
    e = date(y + 1, 1, 1) - timedelta(days=1) if m == 12 else date(y, m + 1, 1) - timedelta(days=1)
    return s.isoformat(), e.isoformat()


# 휴게시간 차감 사용 여부(기본 on). 근태 clock span에는 휴게가 포함돼 있어
# 실근무시간 비교 시 부풀려지므로 근로기준법 최소휴게를 차감한다.
_DEDUCT_BREAK = os.getenv("MYSIXTH_DEDUCT_BREAK", "1") not in ("0", "false", "False", "")


def _break_hours(span: float) -> float:
    """근로기준법 최소 휴게시간(시간). 4h이상 30분, 8h이상 1h, 12h이상 1.5h, 16h이상 2h."""
    if span >= 16:
        return 2.0
    if span >= 12:
        return 1.5
    if span >= 8:
        return 1.0
    if span >= 4:
        return 0.5
    return 0.0


def _clock_hours(ci, co):
    """출근~퇴근 실근무시간(휴게 차감). 근태 API는 clock span만 주므로 여기서 휴게를 뺀다."""
    if not (ci and co):
        return 0.0
    try:
        t1 = datetime.fromisoformat(ci.replace("Z", "+00:00"))
        t2 = datetime.fromisoformat(co.replace("Z", "+00:00"))
        h = (t2 - t1).total_seconds() / 3600
        if not (0 < h < 20):
            return 0.0
        if _DEDUCT_BREAK:
            h = max(0.0, h - _break_hours(h))
        return h
    except Exception:
        return 0.0


def _is_logistics_dept(dept: str) -> bool:
    return "물류" in (dept or "")


def _is_logistics_wp(wp: str) -> bool:
    return "물류" in (wp or "")


def _labor_daily(start_iso: str, end_iso: str, tag: str, dept_fn, wp_fn) -> dict:
    """팀별 일별 노무시간 {date: {regular, dispatch}} — 정규직 실근태 clock + 파견/알바 사업장."""
    key = ("daily", tag, start_iso, end_iso)
    now = time.time()
    c = _CACHE.get(key)
    if c and c["exp"] > now:
        return c["data"]

    daily = defaultdict(lambda: {"regular": 0.0, "dispatch": 0.0})
    for ym in _months_between(start_iso, end_iso):
        y2, m2 = ym[:4], str(int(ym[5:7]))
        try:
            summ = _get(f"/api/regular/attendance-summary?year={y2}&month={m2}")
            for emp in summ.get("employees", []):
                if not dept_fn(emp.get("department") or ""):
                    continue
                for a in emp.get("actuals", []):
                    d = (a.get("date") or "")[:10]
                    if not (start_iso <= d <= end_iso):
                        continue
                    h = _clock_hours(a.get("clock_in_time"), a.get("clock_out_time"))
                    if h:
                        daily[d]["regular"] += h
        except Exception as e:
            _log_err(f"attendance-summary {ym}", e)
        try:
            s, e = _month_bounds(ym)
            page = 1
            while page <= 10:
                res = _get(f"/api/attendance?startDate={s}&endDate={e}&limit=1000&page={page}")
                for r in res.get("records", []):
                    if not wp_fn(r.get("workplace", "")):
                        continue
                    d = (str(r.get("date") or ""))[:10]
                    if not (start_iso <= d <= end_iso):
                        continue
                    # 파견/알바 total_hours는 gross(regular+overtime+break)라 휴게 차감(break_time 제외).
                    th = float(r.get("total_hours") or 0)
                    if _DEDUCT_BREAK:
                        th = max(0.0, th - float(r.get("break_time") or 0))
                    daily[d]["dispatch"] += th
                pg = res.get("pagination", {}) or {}
                if page >= int(pg.get("totalPages") or 1):
                    break
                page += 1
        except Exception as ex:
            _log_err(f"attendance(dispatch) {ym}", ex)

    out = {d: {"regular": round(v["regular"], 1), "dispatch": round(v["dispatch"], 1)}
           for d, v in daily.items()}
    _CACHE[key] = {"data": out, "exp": now + _TTL}
    return out


def _pay_by_month(months: list[str], tag: str, dept_fn) -> dict:
    key = ("pay", tag, tuple(months))
    now = time.time()
    c = _CACHE.get(key)
    if c and c["exp"] > now:
        return c["data"]
    out = {}
    for ym in months:
        pay = 0.0
        try:
            reg = _get(f"/api/regular/payroll-calc?year_month={ym}")
            for p in reg.get("results", []):
                if dept_fn(p.get("department") or ""):
                    pay += float(p.get("gross_pay") or 0)
        except Exception as ex:
            _log_err(f"payroll-calc {ym}", ex)
        out[ym] = round(pay)
    _CACHE[key] = {"data": out, "exp": now + _TTL}
    return out


def production_labor_daily(start_iso: str, end_iso: str) -> dict:
    return _labor_daily(start_iso, end_iso, "prod", _is_production_dept, _is_production_wp)


def production_pay_by_month(months: list[str]) -> dict:
    return _pay_by_month(months, "prod", _is_production_dept)


def logistics_labor_daily(start_iso: str, end_iso: str) -> dict:
    return _labor_daily(start_iso, end_iso, "logi", _is_logistics_dept, _is_logistics_wp)


def logistics_pay_by_month(months: list[str]) -> dict:
    return _pay_by_month(months, "logi", _is_logistics_dept)


def health(year: int | None = None, month: int | None = None) -> dict:
    """근태 API 실제 연결 확인 — attendance-summary로 생산팀 인원수까지 검증.
    (구 /api/health는 신규 Cloud Run에 없어 404였음)."""
    now = datetime.now(timezone.utc)
    y = year or now.year
    m = month or now.month
    try:
        summ = _get(f"/api/regular/attendance-summary?year={y}&month={m}", timeout=20)
        emps = summ.get("employees", []) if isinstance(summ, dict) else []
        prod = [e for e in emps if _is_production_dept(e.get("department") or "")]
        return {"ok": True, "base": BASE, "year": y, "month": m,
                "employees": len(emps), "production_employees": len(prod),
                "recent_errors": _ERRORS[-5:]}
    except Exception as e:
        return {"ok": False, "base": BASE, "error": str(e)[:150],
                "recent_errors": _ERRORS[-5:]}
