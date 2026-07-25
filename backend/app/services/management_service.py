"""경영관리 서비스 — 교차 검증 대시보드.

부서 데이터를 서로 대조해 경영 관점의 이상치·gap을 요약:
 1) 매출기반 원가추정(판매수량×BOM원가=Σcost_cogs) vs 실제 원부재료 구매액
 2) 생산 BOM 소요 금액 vs 실제 구매 금액 gap
 3) mysixth 근무시간 vs 생산/물류 기입시간 gap
 4) 재고 현황 요약(마이너스 재고 등)
 5) 실사 재고조정(수동조정·실사보정) 사유
"""
from __future__ import annotations

from datetime import date

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db_models import (
    ChannelSalesDailyProduct, PurchaseRecord, InventoryStockLedger,
    ProductMaster,
)
from app.services import purchase_service as pur
from app.services import inventory_service as inv
from app.services import logistics_service as logi


def _sales_costs(db: Session, start: date, end: date) -> dict:
    r = db.query(
        func.coalesce(func.sum(ChannelSalesDailyProduct.net_sales), 0.0),
        func.coalesce(func.sum(ChannelSalesDailyProduct.cost_cogs), 0.0),
        func.coalesce(func.sum(ChannelSalesDailyProduct.cost_labor), 0.0),
        func.coalesce(func.sum(ChannelSalesDailyProduct.pcs_qty), 0.0),
    ).filter(
        ChannelSalesDailyProduct.sale_date >= start,
        ChannelSalesDailyProduct.sale_date <= end,
    ).one()
    return {"net_sales": float(r[0] or 0), "cogs_est": float(r[1] or 0),
            "labor_est": float(r[2] or 0), "pcs_qty": float(r[3] or 0)}


def _purchase_actual(db: Session, start: date, end: date) -> dict:
    rows = db.query(PurchaseRecord.mclass, func.coalesce(func.sum(PurchaseRecord.supply_amount), 0.0)).filter(
        PurchaseRecord.pdate >= start, PurchaseRecord.pdate <= end).group_by(PurchaseRecord.mclass).all()
    raw = sub = 0.0
    for c, v in rows:
        if c == "부재료":
            sub += float(v or 0)
        else:
            raw += float(v or 0)
    return {"raw": raw, "sub": sub, "total": raw + sub}


def overview(db: Session, start: date, end: date) -> dict:
    sc = _sales_costs(db, start, end)
    pa = _purchase_actual(db, start, end)

    # 1) 매출기반 원가추정 vs 실제 구매액
    cogs_est = sc["cogs_est"]
    purchase_total = pa["total"]
    cost_vs_purchase = {
        "net_sales": round(sc["net_sales"]),
        "cogs_est": round(cogs_est),                 # 판매수량×BOM원가 (Σcost_cogs)
        "cogs_ratio": round(cogs_est / sc["net_sales"] * 100, 1) if sc["net_sales"] else None,
        "purchase_actual": round(purchase_total),    # 실제 원부재료 구매(공급가)
        "purchase_raw": round(pa["raw"]), "purchase_sub": round(pa["sub"]),
        "purchase_ratio": round(purchase_total / sc["net_sales"] * 100, 1) if sc["net_sales"] else None,
        "gap": round(purchase_total - cogs_est),     # +면 구매>소비(재고빌드/과다구매), −면 구매<소비(재고소진)
    }

    # 2) BOM 이론소요 vs 실제 구매
    try:
        mr = pur.material_requirement(db, start, end)
        bom_cost = mr.get("total_cost", 0)
    except Exception:
        bom_cost = 0
    bom_vs_purchase = {
        "bom_req_cost": round(bom_cost),             # 생산 BOM 소요 이론금액
        "purchase_actual": round(purchase_total),
        "gap": round(purchase_total - bom_cost),
        "gap_pct": round((purchase_total - bom_cost) / bom_cost * 100, 1) if bom_cost else None,
    }

    # 3) 근무시간 vs 기입시간
    try:
        pl = inv.labor_compare(db, start, end, granularity="day")
    except Exception:
        pl = {}
    try:
        ll = logi.logistics_compare(db, start, end, granularity="day")
    except Exception:
        ll = {}
    labor = {
        "production": {
            "logged_hours": pl.get("total_prod_hours", 0),
            "attendance_hours": pl.get("total_att_hours", 0),
            "ratio": pl.get("total_hours_ratio", 0),
            "gap_hours": round((pl.get("total_prod_hours", 0) or 0) - (pl.get("total_att_hours", 0) or 0), 1),
        },
        "logistics": {
            "logged_hours": ll.get("total_prod_hours", 0),
            "attendance_hours": ll.get("total_att_hours", 0),
            "ratio": ll.get("total_hours_ratio", 0),
            "gap_hours": round((ll.get("total_prod_hours", 0) or 0) - (ll.get("total_att_hours", 0) or 0), 1),
        },
    }

    # 4) 재고 현황 (end 시점)
    stock = inv.current_stock_map(db, as_of=end)
    prod_names = {p.id: p.name for p in db.query(ProductMaster.id, ProductMaster.name).all()}
    agg: dict[int, float] = {}
    for (w, p), q in stock.items():
        agg[p] = agg.get(p, 0.0) + q
    neg = [(pid, q) for pid, q in agg.items() if q < -0.5]
    neg.sort(key=lambda x: x[1])
    inventory = {
        "product_count": len(agg),
        "negative_count": len(neg),
        "total_qty": round(sum(agg.values())),
        "top_negative": [{"product": prod_names.get(pid, str(pid)), "qty": round(q)} for pid, q in neg[:10]],
    }

    # 5) 실사·조정 사유
    adj_rows = db.query(InventoryStockLedger).filter(
        InventoryStockLedger.movement_type.in_(["adjustment", "count_correction"]),
        InventoryStockLedger.movement_date >= start,
        InventoryStockLedger.movement_date <= end,
    ).order_by(InventoryStockLedger.movement_date.desc()).all()
    adj_total = sum(a.qty_delta or 0 for a in adj_rows)
    adjustments = {
        "count": len(adj_rows),
        "net_qty": round(adj_total),
        "items": [{
            "date": a.movement_date.isoformat() if a.movement_date else None,
            "type": "실사보정" if a.movement_type == "count_correction" else "수동조정",
            "product": prod_names.get(a.product_id, str(a.product_id)),
            "qty_delta": round(a.qty_delta or 0),
            "reason": a.reason or "(사유 미기재)",
            "by": a.created_by,
        } for a in adj_rows[:30]],
    }

    # 핵심 요약(경보)
    alerts = []
    if cost_vs_purchase["gap"] > sc["net_sales"] * 0.05 and sc["net_sales"]:
        alerts.append({"level": "info", "text": f"구매액이 매출원가추정보다 {pur_won(cost_vs_purchase['gap'])} 많음 — 재고 빌드업 또는 과다구매 점검"})
    if cost_vs_purchase["gap"] < -sc["net_sales"] * 0.05 and sc["net_sales"]:
        alerts.append({"level": "warn", "text": f"구매액이 매출원가추정보다 {pur_won(-cost_vs_purchase['gap'])} 적음 — 재고 소진 진행"})
    if bom_vs_purchase["gap_pct"] is not None and abs(bom_vs_purchase["gap_pct"]) > 30:
        alerts.append({"level": "warn", "text": f"BOM 이론소요 대비 실제구매 gap {bom_vs_purchase['gap_pct']}% — BOM 원가/구매단가 정합 점검"})
    for dept, lab in (("생산", labor["production"]), ("물류", labor["logistics"])):
        r = lab["ratio"]
        if r and (r < 0.7 or r > 1.3):
            alerts.append({"level": "warn", "text": f"{dept} 기입시간/근무시간 비율 {r} — 기입 시간과 실제 근무시간 괴리"})
    if inventory["negative_count"] > 0:
        alerts.append({"level": "warn", "text": f"마이너스 재고 {inventory['negative_count']}개 품목 — 기초재고 미입력 또는 매핑 누락 가능"})
    unreasoned = sum(1 for a in adj_rows if not (a.reason or "").strip())
    if unreasoned:
        alerts.append({"level": "info", "text": f"사유 미기재 재고조정 {unreasoned}건"})

    return {
        "start": start.isoformat(), "end": end.isoformat(),
        "cost_vs_purchase": cost_vs_purchase,
        "bom_vs_purchase": bom_vs_purchase,
        "labor": labor,
        "inventory": inventory,
        "adjustments": adjustments,
        "alerts": alerts,
    }


def pur_won(n) -> str:
    n = abs(n or 0)
    if n >= 1e8:
        return f"{n/1e8:.1f}억"
    if n >= 1e4:
        return f"{round(n/1e4):,}만"
    return f"{round(n):,}원"
