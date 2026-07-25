"""물류 작업 실적 서비스 — 생산 모듈의 물류 버전.

물류 RAW-DATA(날짜·책임자·소속조·작업종류·작업명·작업량·투여시간·단가·작업액·주야)를
파싱·적재하고 작업 대시보드·시계열을 제공. 재고 증감과는 무관(순수 작업/노무 실적).
"""
from __future__ import annotations

import hashlib
from datetime import date, datetime
from typing import Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db_models import InventoryLogisticsWork
from app.services.inventory_service import (
    HOURLY_WAGE, _labor_cost, _is_night, _norm, _trunc_label, _month_list, _date_bucket,
)


# ──────────────────────────────────────────────
# 파서
# ──────────────────────────────────────────────

def parse_logistics_excel(file_path: str) -> dict:
    """물류 작업 RAW-DATA 파싱. RAW 시트 우선, 유연 헤더."""
    import pandas as pd
    try:
        if str(file_path).lower().endswith(".csv"):
            sheets = None
            for enc in ("utf-8-sig", "utf-8", "cp949", "euc-kr"):
                try:
                    sheets = {"CSV": pd.read_csv(file_path, header=None, encoding=enc)}
                    break
                except UnicodeDecodeError:
                    continue
            if sheets is None:
                sheets = {"CSV": pd.read_csv(file_path, header=None, encoding="utf-8", errors="ignore")}
        else:
            sheets = pd.read_excel(file_path, sheet_name=None, header=None)
    except Exception as e:
        return {"rows": [], "errors": [f"엑셀 읽기 실패: {e}"]}
    if not sheets:
        return {"rows": [], "errors": ["빈 파일"]}

    target = None
    for name in sheets:
        if "raw" in _norm(name):
            target = name
            break
    if target is None:
        for name, df in sheets.items():
            if df.astype(str).apply(lambda col: col.str.contains("작업량", na=False)).any().any():
                target = name
                break
    if target is None:
        target = list(sheets.keys())[0]
    df = sheets[target]

    hdr = None
    for i in range(min(15, len(df))):
        joined = " ".join(str(x) for x in df.iloc[i].tolist())
        if "작업량" in joined or ("날짜" in joined and "작업" in joined):
            hdr = i
            break
    if hdr is None:
        return {"rows": [], "errors": [f"'{target}'에서 헤더행(작업량/작업)을 찾지 못했습니다"], "sheet": target}
    cols = [str(x).strip() for x in df.iloc[hdr].tolist()]
    data = df.iloc[hdr + 1:].copy()
    data.columns = cols

    def find(*cands, exclude=()):
        for c in cols:
            cn = _norm(c)
            if any(ex in cn for ex in exclude):
                continue
            if any(_norm(cand) in cn for cand in cands):
                return c
        return None

    c_date = find("날짜", "일자", "date")
    c_worker = find("책임자", "담당", "작업자")
    c_team = find("소속조", "소속", "조", exclude=("종류",))
    c_type = find("작업종류", "종류", exclude=("주간", "야간", "주야"))
    c_name = find("작업명", "작업 명", exclude=("종류", "단가", "시간"))
    c_qty = find("작업량", "수량", exclude=("액", "금액"))
    c_hours = find("시간", "투여")
    c_uprice = find("단가")
    c_amount = find("작업액", "총작업", "금액")
    c_shift = find("주간", "야간", "주야", "구분")

    import pandas as pd

    def num(v):
        if v is None or (isinstance(v, float) and pd.isna(v)):
            return 0.0
        try:
            return float(str(v).replace(",", "").strip() or 0)
        except Exception:
            return 0.0

    rows, errors = [], []
    if c_qty is None or c_date is None:
        return {"rows": [], "errors": ["필수 열(날짜·작업량)을 찾지 못했습니다"], "sheet": target, "headers": cols}

    for _, r in data.iterrows():
        try:
            dval = r[c_date]
            if pd.isna(dval):
                continue
            d = pd.to_datetime(dval, errors="coerce")
            if pd.isna(d):
                continue
            qty = num(r[c_qty])
            wname = str(r[c_name]).strip() if c_name is not None and not pd.isna(r[c_name]) else ""
            wtype = str(r[c_type]).strip() if c_type is not None and not pd.isna(r[c_type]) else ""
            if not wname and not wtype:
                continue
            up = num(r[c_uprice]) if c_uprice else 0.0
            rows.append({
                "work_date": d.date().isoformat(),
                "worker": str(r[c_worker]).strip() if c_worker is not None and not pd.isna(r[c_worker]) else "",
                "team": str(r[c_team]).strip() if c_team is not None and not pd.isna(r[c_team]) else "",
                "work_type": wtype, "work_name": wname, "qty": qty,
                "hours": num(r[c_hours]) if c_hours else 0.0,
                "unit_price": up,
                "amount": num(r[c_amount]) if c_amount else round(qty * up, 2),
                "shift": str(r[c_shift]).strip() if c_shift is not None and not pd.isna(r[c_shift]) else "",
            })
        except Exception as e:
            errors.append(str(e))
    return {"rows": rows, "errors": errors, "sheet": target}


def _work_hash(r: dict) -> str:
    key = "|".join(str(r.get(k, "")) for k in
                    ("work_date", "worker", "team", "work_type", "work_name", "qty", "hours", "unit_price"))
    return hashlib.sha256(key.encode("utf-8")).hexdigest()


def apply_logistics(db: Session, rows: list[dict], user: Optional[str] = None,
                    batch_id: Optional[str] = None) -> dict:
    existing = {h for (h,) in db.query(InventoryLogisticsWork.dedup_hash).all()}
    applied = dup = 0
    for r in rows:
        h = _work_hash(r)
        if h in existing:
            dup += 1
            continue
        hours = float(r.get("hours") or 0)
        db.add(InventoryLogisticsWork(
            batch_id=batch_id, work_date=date.fromisoformat(r["work_date"]),
            worker=r.get("worker") or None, team=r.get("team") or None,
            work_type=r.get("work_type") or None, work_name=r.get("work_name") or None,
            qty=float(r.get("qty") or 0), hours=hours,
            unit_price=float(r.get("unit_price") or 0), amount=float(r.get("amount") or 0),
            labor_cost=_labor_cost(hours, r.get("shift")), shift=r.get("shift") or None,
            dedup_hash=h, created_by=user,
        ))
        existing.add(h)
        applied += 1
    db.commit()
    return {"applied": applied, "duplicate": dup}


# ──────────────────────────────────────────────
# 조회 / 분석
# ──────────────────────────────────────────────

def logistics_categories(db: Session) -> list[str]:
    rows = db.query(InventoryLogisticsWork.work_type).filter(
        InventoryLogisticsWork.work_type.isnot(None)).distinct().all()
    return sorted({r[0] for r in rows if r[0]})


def logistics_catalog(db: Session) -> list[dict]:
    q = db.query(InventoryLogisticsWork.work_name, InventoryLogisticsWork.work_type,
                 func.avg(InventoryLogisticsWork.unit_price)).filter(
        InventoryLogisticsWork.work_name.isnot(None), InventoryLogisticsWork.work_name != ""
    ).group_by(InventoryLogisticsWork.work_name, InventoryLogisticsWork.work_type)
    out = [{"work_name": n, "work_type": t, "unit_price": round(float(up or 0), 1)}
           for n, t, up in q.all()]
    out.sort(key=lambda x: (x["work_type"] or "", x["work_name"]))
    return out


def logistics_dashboard(db: Session, start: Optional[date] = None, end: Optional[date] = None) -> dict:
    q = db.query(InventoryLogisticsWork)
    if start:
        q = q.filter(InventoryLogisticsWork.work_date >= start)
    if end:
        q = q.filter(InventoryLogisticsWork.work_date <= end)
    recs = q.all()
    tot_qty = tot_amt = tot_hours = tot_labor = 0.0
    by_type: dict[str, dict] = {}
    by_worker: dict[str, dict] = {}
    by_team: dict[str, dict] = {}
    by_shift: dict[str, float] = {}
    for r in recs:
        labor = float(r.labor_cost or 0)
        tot_qty += r.qty or 0; tot_amt += r.amount or 0; tot_hours += r.hours or 0; tot_labor += labor
        t = r.work_type or "기타"
        by_type.setdefault(t, {"qty": 0.0, "amount": 0.0, "hours": 0.0, "labor": 0.0})
        by_type[t]["qty"] += r.qty or 0; by_type[t]["amount"] += r.amount or 0
        by_type[t]["hours"] += r.hours or 0; by_type[t]["labor"] += labor
        w = r.worker or "미상"
        by_worker.setdefault(w, {"qty": 0.0, "amount": 0.0, "hours": 0.0, "labor": 0.0})
        by_worker[w]["qty"] += r.qty or 0; by_worker[w]["amount"] += r.amount or 0
        by_worker[w]["hours"] += r.hours or 0; by_worker[w]["labor"] += labor
        tm = r.team or "미상"
        by_team.setdefault(tm, {"qty": 0.0, "hours": 0.0, "labor": 0.0})
        by_team[tm]["qty"] += r.qty or 0; by_team[tm]["hours"] += r.hours or 0; by_team[tm]["labor"] += labor
        g = "야간" if _is_night(r.shift) else "주간"
        by_shift[g] = by_shift.get(g, 0.0) + (r.qty or 0)

    def _row(k, v, keyname):
        d = {keyname: k, "qty": round(v["qty"]), "hours": round(v.get("hours", 0), 1),
             "labor": round(v["labor"]),
             "hourly_qty": round(v["qty"] / v["hours"], 1) if v.get("hours") else 0}
        if "amount" in v:
            d["amount"] = round(v["amount"])
            d["profitability"] = round(v["amount"] / v["labor"], 2) if v["labor"] else 0
        return d

    return {
        "start": start.isoformat() if start else None, "end": end.isoformat() if end else None,
        "record_count": len(recs), "total_qty": round(tot_qty), "total_amount": round(tot_amt),
        "total_hours": round(tot_hours, 1), "total_labor": round(tot_labor), "hourly_wage": HOURLY_WAGE,
        "profitability": round(tot_amt / tot_labor, 2) if tot_labor else 0,
        "hourly_qty": round(tot_qty / tot_hours, 1) if tot_hours else 0,
        "labor_ratio": round(tot_labor / tot_amt * 100, 1) if tot_amt else 0,
        "by_type": [_row(k, v, "work_type") for k, v in sorted(by_type.items(), key=lambda x: -x[1]["qty"])],
        "by_worker": [_row(k, v, "worker") for k, v in sorted(by_worker.items(), key=lambda x: -x[1]["qty"])],
        "by_team": [_row(k, v, "team") for k, v in sorted(by_team.items(), key=lambda x: -x[1]["qty"])],
        "by_shift": [{"shift": k, "qty": round(v)} for k, v in sorted(by_shift.items(), key=lambda x: -x[1])],
    }


def logistics_timeseries(db: Session, granularity: str = "day", start: Optional[date] = None,
                         end: Optional[date] = None, work_type: Optional[str] = None) -> dict:
    q = db.query(InventoryLogisticsWork)
    if start:
        q = q.filter(InventoryLogisticsWork.work_date >= start)
    if end:
        q = q.filter(InventoryLogisticsWork.work_date <= end)
    if work_type:
        q = q.filter(InventoryLogisticsWork.work_type == work_type)
    buckets: dict[str, dict] = {}
    for r in q.all():
        d = r.work_date
        if granularity == "day":
            key = d.isoformat()
        elif granularity == "week":
            iso = d.isocalendar(); key = f"{iso[0]}-W{iso[1]:02d}"
        else:
            key = f"{d.year}-{d.month:02d}"
        b = buckets.setdefault(key, {"qty": 0.0, "hours": 0.0, "amount": 0.0, "labor": 0.0,
                                     "day_qty": 0.0, "night_qty": 0.0})
        b["qty"] += r.qty or 0; b["hours"] += r.hours or 0; b["amount"] += r.amount or 0
        b["labor"] += r.labor_cost or 0
        if _is_night(r.shift):
            b["night_qty"] += r.qty or 0
        else:
            b["day_qty"] += r.qty or 0
    series = []
    for k in sorted(buckets):
        v = buckets[k]
        series.append({"period": k, "qty": round(v["qty"]), "hours": round(v["hours"], 1),
                       "amount": round(v["amount"]), "labor": round(v["labor"]),
                       "hourly_qty": round(v["qty"] / v["hours"], 1) if v["hours"] else 0,
                       "profitability": round(v["amount"] / v["labor"], 2) if v["labor"] else 0,
                       "day_qty": round(v["day_qty"]), "night_qty": round(v["night_qty"])})
    return {"granularity": granularity, "work_type": work_type, "series": series}


def add_logistics_record(db: Session, data: dict, user: Optional[str] = None) -> dict:
    r = {k: data.get(k, "") for k in ("work_date", "worker", "team", "work_type", "work_name")}
    r["qty"] = float(data.get("qty") or 0)
    r["hours"] = float(data.get("hours") or 0)
    r["unit_price"] = float(data.get("unit_price") or 0)
    h = _work_hash(r)
    if db.query(InventoryLogisticsWork.id).filter(InventoryLogisticsWork.dedup_hash == h).first():
        return {"ok": False, "error": "duplicate", "msg": "동일 작업 기록이 이미 있습니다"}
    hours = r["hours"]; qty = r["qty"]; up = r["unit_price"]
    shift = data.get("shift") or "주간"
    rec = InventoryLogisticsWork(
        batch_id="manual", work_date=date.fromisoformat(r["work_date"]),
        worker=r["worker"] or None, team=r["team"] or None, work_type=r["work_type"] or None,
        work_name=r["work_name"] or None, qty=qty, hours=hours, unit_price=up,
        amount=round(qty * up, 2), labor_cost=_labor_cost(hours, shift), shift=shift,
        dedup_hash=h, created_by=user,
    )
    db.add(rec)
    db.commit()
    db.refresh(rec)
    return {"ok": True, "id": rec.id}


def logistics_compare(db: Session, start: date, end: date, granularity: str = "day") -> dict:
    """물류 작업일보 투여시간 vs mysixthproject 물류팀 근태 노무시간 (일/주/월)."""
    from app.services import mysixth_client
    gran = granularity if granularity in ("day", "week", "month") else "day"

    wcol = func.date_trunc(gran, InventoryLogisticsWork.work_date)
    wq = db.query(wcol,
                  func.coalesce(func.sum(InventoryLogisticsWork.hours), 0.0),
                  func.coalesce(func.sum(InventoryLogisticsWork.labor_cost), 0.0)).filter(
        InventoryLogisticsWork.work_date >= start, InventoryLogisticsWork.work_date <= end
    ).group_by(wcol)
    work_b = {_trunc_label(dt, gran): (float(h or 0), float(l or 0)) for dt, h, l in wq.all()}

    daily = mysixth_client.logistics_labor_daily(start.isoformat(), end.isoformat())
    att_b: dict[str, dict] = {}
    for dstr, v in daily.items():
        try:
            d = date.fromisoformat(dstr)
        except Exception:
            continue
        lbl = _date_bucket(d, gran)
        b = att_b.setdefault(lbl, {"regular": 0.0, "dispatch": 0.0})
        b["regular"] += v.get("regular", 0); b["dispatch"] += v.get("dispatch", 0)

    pay_m = mysixth_client.logistics_pay_by_month(_month_list(start, end))
    tot_reg_pay = sum(pay_m.values())

    labels = sorted(set(work_b) | set(att_b))
    series = []
    tot_wh = tot_ah = tot_wl = tot_reg = tot_disp = 0.0
    for lbl in labels:
        wh, wl = work_b.get(lbl, (0.0, 0.0))
        a = att_b.get(lbl, {"regular": 0.0, "dispatch": 0.0})
        reg, disp = a["regular"], a["dispatch"]
        ah = reg + disp
        tot_wh += wh; tot_ah += ah; tot_wl += wl; tot_reg += reg; tot_disp += disp
        series.append({"period": lbl, "prod_hours": round(wh, 1), "att_hours": round(ah, 1),
                       "regular_hours": round(reg, 1), "dispatch_hours": round(disp, 1),
                       "hours_ratio": round(wh / ah, 2) if ah else 0, "prod_labor": round(wl)})
    return {
        "start": start.isoformat(), "end": end.isoformat(), "granularity": gran, "series": series,
        "total_prod_hours": round(tot_wh, 1), "total_att_hours": round(tot_ah, 1),
        "total_regular_hours": round(tot_reg, 1), "total_dispatch_hours": round(tot_disp, 1),
        "total_hours_ratio": round(tot_wh / tot_ah, 2) if tot_ah else 0,
        "total_prod_labor": round(tot_wl), "total_att_cost": round(tot_reg_pay + tot_disp * 15000),
        "total_regular_pay": round(tot_reg_pay),
        "note": "근태 노무시간 = 물류팀만(정규직 물류부서 실근태 + 파견/알바 물류사업장). 노무비 = 정규직 실지급 + 파견 환산(시간×15,000).",
    }
