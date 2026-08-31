"""MES 모듈 SQLite 스모크 테스트 — plain script(pytest 미사용).

실행: backend/.venv/Scripts/python backend/scripts/mes_smoke.py
"""
from __future__ import annotations

import os
import sys

# ── env 셋업(파일 최상단 — app import 전에 반드시 설정) ──
os.environ["DATABASE_URL"] = "sqlite:///./mes_smoke.db"
os.environ["JARVIS_API_KEY"] = "test-key"
os.environ.setdefault("SKIP_PLAYWRIGHT_INSTALL", "1")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret")
os.environ.setdefault("BIGQUERY_PROJECT_ID", "dummy-project")
os.environ.setdefault("GOOGLE_APPLICATION_CREDENTIALS", "")
os.environ.setdefault("ANTHROPIC_API_KEY", "dummy-key")

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

FAILS = []
PASSES = []


def check(name: str, cond: bool, detail: str = ""):
    if cond:
        PASSES.append(name)
        print(f"[PASS] {name}")
    else:
        FAILS.append(f"{name} :: {detail}")
        print(f"[FAIL] {name} :: {detail}")


def main():
    from app.main import app
    from app.database import init_db

    init_db()

    from fastapi.testclient import TestClient
    client = TestClient(app)
    headers = {"Authorization": "Bearer test-key"}

    def g(path, **kw):
        return client.get(f"/api/mes{path}", headers=headers, **kw)

    def p(path, json=None, **kw):
        return client.post(f"/api/mes{path}", headers=headers, json=json or {}, **kw)

    # 1) seed
    r = p("/seed")
    check("seed 200", r.status_code == 200, r.text)
    seed_created = r.json().get("created", {})
    print("seed created:", seed_created)

    # 2) 기준정보 개수 확인
    r = g("/processes")
    check("processes >= 10", r.status_code == 200 and len(r.json()["items"]) >= 10, r.text)
    r = g("/equipment")
    check("equipment > 20", r.status_code == 200 and len(r.json()["items"]) > 20, r.text)
    r = g("/workers")
    check("workers == 17", r.status_code == 200 and len(r.json()["items"]) == 17, r.text)
    r = g("/codes", params={"group": "DOWNTIME"})
    check("codes DOWNTIME == 7", r.status_code == 200 and len(r.json()["items"]) == 7, r.text)
    r = g("/limits")
    check("limits > 0", r.status_code == 200 and len(r.json()["items"]) > 0, r.text)
    r = g("/templates")
    templates = r.json()["items"] if r.status_code == 200 else []
    check("templates == 16", r.status_code == 200 and len(templates) == 16, r.text)

    # 3) items (빈 결과여도 200)
    r = g("/items")
    check("items 200", r.status_code == 200, r.text)

    # 공정/설비 id 확보
    procs = {pr["code"]: pr for pr in g("/processes").json()["items"]}
    eqs = {e["code"]: e for e in g("/equipment").json()["items"]}
    workers = g("/workers").json()["items"]
    worker_id = workers[0]["id"]

    # 4) 작업지시 생성 → wo_no 형식 확인
    r = p("/work-orders", json={
        "order_date": "2026-08-31", "item_name": "테스트 마카롱", "process_id": procs["P_PACK"]["id"],
        "plan_qty": 100, "worker_ids": [worker_id],
    })
    check("work-order 생성 200", r.status_code == 200, r.text)
    order = r.json()
    import re
    check("wo_no 형식(WOyymmddNNN)", bool(re.match(r"^WO\d{9}$", order.get("wo_no", ""))), order.get("wo_no"))
    oid = order["id"]

    # 5) start
    r = p(f"/work-orders/{oid}/start")
    check("start 200", r.status_code == 200 and r.json()["status"] == "in_progress", r.text)

    # 6) results/defects/downtimes 추가
    r = p(f"/work-orders/{oid}/results", json={"prod_qty": 80, "defect_qty": 5})
    check("results 추가 200", r.status_code == 200, r.text)
    r = p(f"/work-orders/{oid}/defects", json={"defect_code": "SHAPE", "qty": 5})
    check("defects 추가 200", r.status_code == 200, r.text)
    r = p(f"/work-orders/{oid}/downtimes", json={"downtime_code": "BREAK", "minutes": 10})
    check("downtimes 추가 200", r.status_code == 200, r.text)

    # 7) finish
    r = p(f"/work-orders/{oid}/finish")
    check("finish 200", r.status_code == 200 and r.json()["status"] == "done", r.text)

    # 8) production/daily → OEE 존재
    r = g("/production/daily", params={"start": "2026-08-31", "end": "2026-08-31"})
    check("production/daily 200", r.status_code == 200, r.text)
    rows = r.json().get("rows", [])
    check("production/daily oee 존재", len(rows) > 0 and "oee" in rows[0], r.text)

    # 9) POP runs — 배합(mixing) input_kg 50.55 → alcohol_g 505.5
    r = p("/runs", json={"process_id": procs["P_MIX"]["id"], "equipment_id": eqs["MX-2F-1"]["id"],
                         "input_kg": 50.55, "worker_id": worker_id})
    check("run(mixing) 생성 200", r.status_code == 200, r.text)
    run = r.json()
    check("alcohol_g == 505.5", run.get("alcohol_g") == 505.5, run)
    rid = run["id"]

    r = p(f"/runs/{rid}/end", json={})
    check("run(mixing) end 200", r.status_code == 200, r.text)
    ended = r.json()
    check("run(mixing) minutes 존재", ended.get("minutes") is not None, ended)
    check("run(mixing) judgment == 적", ended.get("judgment") == "적", ended)

    # 10) 가열(heating) run — measured 100 vs limit(min) 150 → 부 + deviation 생성
    r = p("/runs", json={"process_id": procs["P_BAKE"]["id"], "equipment_id": eqs["RO-2F-1"]["id"],
                         "family_code": "TTUNGCARONG_COQUE", "worker_id": worker_id})
    heat_run = r.json()
    check("run(heating) limit_value == 150(뚱카롱꼬끄)", heat_run.get("limit_value") == 150, heat_run)
    hrid = heat_run["id"]
    r = p(f"/runs/{hrid}/end", json={"measured_value": 100})
    heat_end = r.json()
    check("run(heating) judgment == 부", heat_end.get("judgment") == "부", heat_end)

    r = g("/deviations")
    devs = r.json()["items"] if r.status_code == 200 else []
    check("이탈 자동생성(run_id 매칭)", any(d.get("run_id") == hrid for d in devs), devs)

    # 11) ccp-logs/generate
    r = p("/ccp-logs/generate", json={"date": "2026-08-31"})
    check("ccp-logs/generate 200", r.status_code == 200, r.text)
    r = g("/ccp-logs", params={"start": "2026-08-31", "end": "2026-08-31"})
    logs = r.json()["items"] if r.status_code == 200 else []
    check("ccp-logs 목록 존재", len(logs) > 0, logs)
    if logs:
        lid = logs[0]["id"]
        r = p(f"/ccp-logs/{lid}/submit")
        check("ccp-log submit 200", r.status_code == 200, r.text)
        r = p(f"/ccp-logs/{lid}/approve")
        check("ccp-log approve 200", r.status_code == 200, r.text)

    # 12) 체크리스트 — ng 2개 → deviation_count 2
    tpl = templates[0]
    items = tpl["items_json"]
    results_json = {}
    ok_seen = 0
    for it in items:
        no = str(it["no"])
        if it["type"] == "ok":
            ok_seen += 1
            results_json[no] = {"value": "ng" if ok_seen <= 2 else "ok"}
        elif it["type"] == "num":
            results_json[no] = {"value": 100}
        else:
            results_json[no] = {"value": "테스트"}
    r = p("/checklists", json={"template_id": tpl["id"], "check_date": "2026-08-31",
                               "results_json": results_json})
    check("checklist 생성 200", r.status_code == 200, r.text)
    entry = r.json()
    check("deviation_count == 2", entry.get("deviation_count") == 2, entry)
    eid = entry["id"]
    r = p(f"/checklists/{eid}/submit")
    check("checklist submit 200", r.status_code == 200, r.text)
    r = p(f"/checklists/{eid}/approve")
    check("checklist approve 200", r.status_code == 200, r.text)

    # 13) calendar/today
    r = g("/checklists/calendar", params={"month": "2026-08"})
    check("checklists/calendar 200", r.status_code == 200, r.text)
    r = g("/checklists/today")
    check("checklists/today 200", r.status_code == 200, r.text)

    # 14) dashboard/monitoring/equipment status/timeline
    r = g("/dashboard", params={"date": "2026-08-31"})
    check("dashboard 200", r.status_code == 200, r.text)
    r = g("/monitoring", params={"floor": "2F"})
    check("monitoring 200", r.status_code == 200, r.text)
    r = g("/equipment/status", params={"date": "2026-08-31"})
    check("equipment/status 200", r.status_code == 200, r.text)
    r = g("/work-orders/timeline", params={"date": "2026-08-31"})
    check("work-orders/timeline 200", r.status_code == 200, r.text)

    print(f"\n=== 결과: {len(PASSES)} PASS / {len(FAILS)} FAIL ===")
    if FAILS:
        print("FAILED:")
        for f in FAILS:
            print(" -", f)
        sys.exit(1)


if __name__ == "__main__":
    main()
