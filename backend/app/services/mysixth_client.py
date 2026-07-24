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


def labor_by_month(months: list[str]) -> dict:
    """{month: {att_hours, att_night, att_cost, by_workplace:{wp:hours}}} — 생산 사업장만."""
    key = ("labor", tuple(months))
    now = time.time()
    c = _CACHE.get(key)
    if c and c["exp"] > now:
        return c["data"]

    out: dict = {}
    for ym in months:
        s, e = _month_bounds(ym)
        rec = {"att_hours": 0.0, "att_night": 0.0, "att_cost": 0.0, "by_workplace": {}, "ok": False}
        try:
            stats = _get(f"/api/attendance/stats?startDate={s}&endDate={e}")
            for w in stats.get("byWorkplace", []):
                wp = w.get("workplace", "")
                if _is_production_wp(wp):
                    h = float(w.get("total_hours") or 0)
                    rec["att_hours"] += h
                    rec["by_workplace"][wp] = round(h, 1)
            rec["ok"] = True
        except Exception as e2:
            rec["error"] = str(e2)[:150]
        # 노무비(파견/알바) — grandTotal은 dict {..., total_pay}
        try:
            y, m = ym[:4], str(int(ym[5:7]))
            pay = _get(f"/api/payroll/calculate?year={y}&month={m}")
            gt = pay.get("grandTotal") or {}
            rec["att_cost"] = float(gt.get("total_pay") or 0) if isinstance(gt, dict) else 0.0
            for r in pay.get("results", []):
                rec["att_night"] += float(r.get("night_hours") or 0)
        except Exception:
            pass
        # 근태 시급 미설정(0)일 때 비교용 환산 노무비 = 근태시간 × 15,000 (야간분 ×1.5)
        rec["att_cost_est"] = round((rec["att_hours"] - rec["att_night"]) * 15000
                                    + rec["att_night"] * 15000 * 1.5)
        out[ym] = rec

    _CACHE[key] = {"data": out, "exp": now + _TTL}
    return out


def health() -> dict:
    try:
        return {"ok": True, "data": _get("/api/health", timeout=15)}
    except Exception as e:
        return {"ok": False, "error": str(e)[:150]}
