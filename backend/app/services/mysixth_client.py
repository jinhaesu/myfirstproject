"""mysixthproject(근태·급여) 연동 — 생산 노무시간·노무비를 가져와 생산실적과 대조.

self-발행 JWT로 관리자 API 호출. 야간(22~06) 할증은 양쪽 동일(×1.5 / night_multiplier).
생산 사업장(workplace): 조인앤조인 공장 / F2(2층) / F3(3층) / 물류. 카페(널담은공간 XX점)·본사 제외.
"""
from __future__ import annotations

import os
import json
import time
import urllib.request
import urllib.parse
from datetime import date, datetime, timezone, timedelta

BASE = os.getenv("MYSIXTH_BASE_URL", "https://mysixthproject-production.up.railway.app")
SECRET = os.getenv("MYSIXTH_JWT_SECRET", "attendance-management-secret-key")
ADMIN_EMAIL = os.getenv("MYSIXTH_ADMIN_EMAIL", "lion9080@joinandjoin.com")

# 카페·본사 제외 → 생산 노무로 집계할 사업장 판별
_NON_PRODUCTION = ("은공간", "본사", "카페")

_CACHE: dict = {}
_TTL = 300


def _token() -> str:
    import jwt
    payload = {"email": ADMIN_EMAIL, "type": "auth",
               "exp": datetime.now(timezone.utc) + timedelta(hours=1)}
    return jwt.encode(payload, SECRET, algorithm="HS256")


def _get(path: str, timeout: int = 30):
    req = urllib.request.Request(BASE + path, headers={"Authorization": "Bearer " + _token()})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def _is_production_wp(wp: str) -> bool:
    wp = (wp or "").strip()
    if not wp:
        return False
    return not any(x in wp for x in _NON_PRODUCTION)


def _month_bounds(ym: str):
    y, m = int(ym[:4]), int(ym[5:7])
    start = date(y, m, 1)
    end = date(y + 1, 1, 1) - timedelta(days=1) if m == 12 else date(y, m + 1, 1) - timedelta(days=1)
    return start.isoformat(), end.isoformat()


def _is_production_dept(dept: str) -> bool:
    dept = (dept or "")
    return ("생산" in dept) or ("물류" in dept)


def labor_by_month(months: list[str]) -> dict:
    """월별 생산 노무시간·노무비 — 파견/알바(사업소득) + 정규직 합산.
    파견/알바: attendance_records(사업장 F2/F3/공장/물류, 카페·본사 제외).
    정규직: regular payroll-calc(부서 생산*·물류), 시간=근무일×8+연장+휴일, 노무비=총급여(실지급)."""
    key = ("labor2", tuple(months))
    now = time.time()
    c = _CACHE.get(key)
    if c and c["exp"] > now:
        return c["data"]

    out: dict = {}
    for ym in months:
        s, e = _month_bounds(ym)
        rec = {"att_hours": 0.0, "dispatch_hours": 0.0, "regular_hours": 0.0,
               "regular_pay": 0.0, "att_cost": 0.0, "by_workplace": {}, "by_dept": {}, "ok": False}
        # 1) 파견/알바 (사업소득) — attendance stats byWorkplace
        try:
            stats = _get(f"/api/attendance/stats?startDate={s}&endDate={e}")
            for w in stats.get("byWorkplace", []):
                wp = w.get("workplace", "")
                if _is_production_wp(wp):
                    h = float(w.get("total_hours") or 0)
                    rec["dispatch_hours"] += h
                    rec["by_workplace"][wp] = round(h, 1)
            rec["ok"] = True
        except Exception as e2:
            rec["error"] = str(e2)[:150]
        # 2) 정규직 노무시간 — 실제 근태(clock in/out) 기반, 생산·물류 부서
        try:
            y2, m2 = ym[:4], str(int(ym[5:7]))
            summ = _get(f"/api/regular/attendance-summary?year={y2}&month={m2}")
            for emp in summ.get("employees", []):
                dept = emp.get("department") or ""
                if not _is_production_dept(dept):
                    continue
                for a in emp.get("actuals", []):
                    ci, co = a.get("clock_in_time"), a.get("clock_out_time")
                    if not (ci and co):
                        continue
                    try:
                        t1 = datetime.fromisoformat(ci.replace("Z", "+00:00"))
                        t2 = datetime.fromisoformat(co.replace("Z", "+00:00"))
                        h = (t2 - t1).total_seconds() / 3600
                    except Exception:
                        continue
                    if 0 < h < 20:  # 이상치 제거
                        rec["regular_hours"] += h
                        rec["by_dept"][dept] = round(rec["by_dept"].get(dept, 0) + h, 1)
        except Exception:
            pass
        # 정규직 노무비 — 급여대장 실지급 총급여, 생산·물류 부서
        try:
            reg = _get(f"/api/regular/payroll-calc?year_month={ym}")
            for p in reg.get("results", []):
                if _is_production_dept(p.get("department") or ""):
                    rec["regular_pay"] += float(p.get("gross_pay") or 0)
        except Exception:
            pass
        rec["att_hours"] = round(rec["dispatch_hours"] + rec["regular_hours"], 1)
        # 노무비 = 정규직 실지급(총급여) + 파견/알바 환산(시간×15,000)
        rec["att_cost"] = round(rec["regular_pay"] + rec["dispatch_hours"] * 15000)
        rec["att_cost_est"] = round(rec["att_hours"] * 15000)
        rec["dispatch_hours"] = round(rec["dispatch_hours"], 1)
        rec["regular_hours"] = round(rec["regular_hours"], 1)
        rec["regular_pay"] = round(rec["regular_pay"])
        out[ym] = rec

    _CACHE[key] = {"data": out, "exp": now + _TTL}
    return out


def health() -> dict:
    try:
        return {"ok": True, "data": _get("/api/health", timeout=15)}
    except Exception as e:
        return {"ok": False, "error": str(e)[:150]}
