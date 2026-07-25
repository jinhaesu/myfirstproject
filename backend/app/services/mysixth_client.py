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

BASE = os.getenv("MYSIXTH_BASE_URL", "https://mysixthproject-production.up.railway.app")
SECRET = os.getenv("MYSIXTH_JWT_SECRET", "attendance-management-secret-key")
ADMIN_EMAIL = os.getenv("MYSIXTH_ADMIN_EMAIL", "lion9080@joinandjoin.com")

# 생산팀 아닌 사업장(파견/알바 workplace)·부서 판별용 제외어
_NON_PRODUCTION = ("은공간", "본사", "카페", "물류")

_CACHE: dict = {}
_TTL = 300


def _token() -> str:
    import jwt
    payload = {"email": ADMIN_EMAIL, "type": "auth",
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


def _clock_hours(ci, co):
    if not (ci and co):
        return 0.0
    try:
        t1 = datetime.fromisoformat(ci.replace("Z", "+00:00"))
        t2 = datetime.fromisoformat(co.replace("Z", "+00:00"))
        h = (t2 - t1).total_seconds() / 3600
        return h if 0 < h < 20 else 0.0
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
        except Exception:
            pass
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
                    daily[d]["dispatch"] += float(r.get("total_hours") or 0)
                pg = res.get("pagination", {}) or {}
                if page >= int(pg.get("totalPages") or 1):
                    break
                page += 1
        except Exception:
            pass

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
        except Exception:
            pass
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


def health() -> dict:
    try:
        return {"ok": True, "data": _get("/api/health", timeout=15)}
    except Exception as e:
        return {"ok": False, "error": str(e)[:150]}
