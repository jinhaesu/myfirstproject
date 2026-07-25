"""구매 관리 서비스 — 생산실적 → BOM 원부재료 소요 → 거래처별 발주·분석.

BOM 폭발(_explode_item)을 재활용해 생산량으로부터 원재료(kg)·부자재(ea) 소요량과
예상 원가를 산출하고, 자재의 supplier(거래처)로 묶어 발주·구매 대시보드를 제공.
"""
from __future__ import annotations

import re
from datetime import date, datetime
from typing import Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db_models import (
    InventoryProduction, ScmProduct, ScmRawMaterial, ScmSubMaterial,
    PurchaseVendor, PurchaseOrder, PurchaseOrderLine,
)


def _norm(s) -> str:
    s = str(s or "")
    s = re.sub(r"\[[^\]]*\]", "", s)   # [50g] 제거
    s = re.sub(r"\([^\)]*\)", "", s)   # (..) 제거
    for p in ("널담", "뚱", "GS", "CU", "삼성", "세븐일레븐", "노브랜드", "올리브영", "상온", "고단백", "저당"):
        s = s.replace(p, "")
    return re.sub(r"\s+", "", s).lower()


# ──────────────────────────────────────────────
# 거래처
# ──────────────────────────────────────────────

def seed_vendors(db: Session) -> dict:
    """자재 supplier명으로 거래처 마스터 자동 생성(없는 것만)."""
    suppliers: dict[str, str] = {}
    for m in db.query(ScmRawMaterial).all():
        if m.supplier and m.supplier.strip():
            suppliers.setdefault(m.supplier.strip(), "원재료")
    for m in db.query(ScmSubMaterial).all():
        if m.supplier and m.supplier.strip():
            suppliers.setdefault(m.supplier.strip(), "부자재")
    existing = {v.name for v in db.query(PurchaseVendor).all()}
    added = 0
    for name, cat in suppliers.items():
        if name in existing:
            continue
        db.add(PurchaseVendor(name=name, category=cat, is_active=True))
        added += 1
    db.commit()
    return {"added": added, "total_suppliers": len(suppliers)}


def vendor_list(db: Session) -> list[dict]:
    # 거래처별 취급 자재 수·소재
    raw_cnt: dict[str, int] = {}
    sub_cnt: dict[str, int] = {}
    for m in db.query(ScmRawMaterial).all():
        if m.supplier:
            raw_cnt[m.supplier.strip()] = raw_cnt.get(m.supplier.strip(), 0) + 1
    for m in db.query(ScmSubMaterial).all():
        if m.supplier:
            sub_cnt[m.supplier.strip()] = sub_cnt.get(m.supplier.strip(), 0) + 1
    out = []
    for v in db.query(PurchaseVendor).order_by(PurchaseVendor.name).all():
        out.append({
            "id": v.id, "name": v.name, "biz_no": v.biz_no, "contact": v.contact,
            "phone": v.phone, "email": v.email, "category": v.category,
            "lead_time_days": v.lead_time_days, "is_active": v.is_active, "notes": v.notes,
            "raw_materials": raw_cnt.get(v.name, 0), "sub_materials": sub_cnt.get(v.name, 0),
        })
    return out


# ──────────────────────────────────────────────
# 생산 → 원부재료 소요 (BOM 폭발)
# ──────────────────────────────────────────────

def material_requirement(db: Session, start: date, end: date) -> dict:
    """기간 생산실적 → 원부재료 소요량·예상원가·거래처. 생산 품목명↔scm 완제품 매칭 후 폭발."""
    from app.api.routes.scm import _explode_item

    # scm 완제품 이름 인덱스
    finished = db.query(ScmProduct).filter(ScmProduct.item_type.in_(["완제품", "세트", "혼합세트"])).all()
    norm_index = {}
    for p in finished:
        norm_index.setdefault(_norm(p.product_name), p.id)

    # 기간 생산 집계 (품목명별)
    prod = db.query(InventoryProduction.product_name,
                    func.coalesce(func.sum(InventoryProduction.qty), 0.0)).filter(
        InventoryProduction.prod_date >= start,
        InventoryProduction.prod_date <= end,
        InventoryProduction.product_name.isnot(None),
    ).group_by(InventoryProduction.product_name).all()

    acc: dict = {}
    matched_qty = unmatched_qty = 0.0
    unmatched: dict[str, float] = {}
    for name, q in prod:
        q = float(q or 0)
        if q <= 0:
            continue
        nm = _norm(name)
        item_id = norm_index.get(nm)
        if not item_id:
            # 부분일치
            for k, v in norm_index.items():
                if k and (k in nm or nm in k):
                    item_id = v
                    break
        if not item_id:
            unmatched_qty += q
            unmatched[name] = unmatched.get(name, 0.0) + q
            continue
        matched_qty += q
        _explode_item(item_id, q, db, acc, {item_id})

    # 단가·거래처 결합
    raw_price = {m.id: (m.kg_price or 0, m.supplier, m.name, m.erp_code) for m in db.query(ScmRawMaterial).all()}
    sub_price = {m.id: (m.unit_price or 0, m.supplier, m.name, m.erp_code) for m in db.query(ScmSubMaterial).all()}
    materials = []
    by_vendor: dict[str, dict] = {}
    total_cost = 0.0
    for key, e in acc.items():
        if e["type"] == "raw":
            price, supplier, nm, erp = raw_price.get(e.get("ref_id"), (0, None, e["name"], e.get("erp_code")))
            qty = round(e["qty"], 3); cost = round(qty * price)
            unit = "kg"
        elif e["type"] == "sub":
            price, supplier, nm, erp = sub_price.get(e.get("ref_id"), (0, None, e["name"], e.get("erp_code")))
            qty = round(e["qty"], 1); cost = round(qty * price)
            unit = "ea"
        else:
            continue
        total_cost += cost
        supplier = supplier or "미지정"
        materials.append({"type": e["type"], "name": nm or e["name"], "erp_code": erp,
                          "qty": qty, "unit": unit, "unit_price": round(price, 2), "cost": cost,
                          "vendor": supplier, "material_id": e.get("ref_id")})
        bv = by_vendor.setdefault(supplier, {"vendor": supplier, "cost": 0, "items": 0})
        bv["cost"] += cost; bv["items"] += 1
    materials.sort(key=lambda x: -x["cost"])
    for bv in by_vendor.values():
        bv["cost"] = round(bv["cost"])
    return {
        "start": start.isoformat(), "end": end.isoformat(),
        "materials": materials, "total_cost": round(total_cost),
        "raw_count": sum(1 for m in materials if m["type"] == "raw"),
        "sub_count": sum(1 for m in materials if m["type"] == "sub"),
        "by_vendor": sorted(by_vendor.values(), key=lambda x: -x["cost"]),
        "matched_qty": round(matched_qty), "unmatched_qty": round(unmatched_qty),
        "unmatched": sorted(({"name": k, "qty": round(v)} for k, v in unmatched.items()), key=lambda x: -x["qty"])[:20],
    }


# ──────────────────────────────────────────────
# 발주
# ──────────────────────────────────────────────

def create_po(db: Session, data: dict, user: Optional[str] = None) -> dict:
    po = PurchaseOrder(
        po_no=data.get("po_no") or None,
        vendor_id=data.get("vendor_id"), vendor_name=data.get("vendor_name"),
        order_date=date.fromisoformat(data["order_date"]),
        expected_date=date.fromisoformat(data["expected_date"]) if data.get("expected_date") else None,
        status=data.get("status") or "발주", notes=data.get("notes"), created_by=user,
    )
    db.add(po)
    db.flush()
    total = 0.0
    for ln in data.get("lines", []):
        qty = float(ln.get("qty") or 0); up = float(ln.get("unit_price") or 0)
        amt = round(qty * up)
        total += amt
        db.add(PurchaseOrderLine(
            po_id=po.id, material_type=ln.get("material_type"), material_id=ln.get("material_id"),
            material_name=ln.get("material_name"), erp_code=ln.get("erp_code"),
            qty=qty, unit=ln.get("unit"), unit_price=up, amount=amt,
        ))
    po.total_amount = total
    db.commit()
    db.refresh(po)
    return {"id": po.id, "total_amount": total}


def list_po(db: Session, start: Optional[date] = None, end: Optional[date] = None,
            status: Optional[str] = None, vendor_id: Optional[int] = None) -> list[dict]:
    q = db.query(PurchaseOrder)
    if start:
        q = q.filter(PurchaseOrder.order_date >= start)
    if end:
        q = q.filter(PurchaseOrder.order_date <= end)
    if status:
        q = q.filter(PurchaseOrder.status == status)
    if vendor_id:
        q = q.filter(PurchaseOrder.vendor_id == vendor_id)
    q = q.order_by(PurchaseOrder.order_date.desc(), PurchaseOrder.id.desc())
    out = []
    for po in q.all():
        lines = db.query(PurchaseOrderLine).filter(PurchaseOrderLine.po_id == po.id).all()
        out.append({
            "id": po.id, "po_no": po.po_no, "vendor_id": po.vendor_id, "vendor_name": po.vendor_name,
            "order_date": po.order_date.isoformat() if po.order_date else None,
            "expected_date": po.expected_date.isoformat() if po.expected_date else None,
            "status": po.status, "total_amount": round(po.total_amount or 0), "notes": po.notes,
            "line_count": len(lines),
            "lines": [{"id": l.id, "material_type": l.material_type, "material_name": l.material_name,
                       "qty": l.qty, "unit": l.unit, "unit_price": l.unit_price, "amount": round(l.amount or 0),
                       "received_qty": l.received_qty} for l in lines],
        })
    return out


def purchase_dashboard(db: Session, start: date, end: date) -> dict:
    pos = db.query(PurchaseOrder).filter(
        PurchaseOrder.order_date >= start, PurchaseOrder.order_date <= end).all()
    tot = sum(p.total_amount or 0 for p in pos)
    by_vendor: dict[str, float] = {}
    by_status: dict[str, int] = {}
    by_month: dict[str, float] = {}
    for p in pos:
        by_vendor[p.vendor_name or "미지정"] = by_vendor.get(p.vendor_name or "미지정", 0) + (p.total_amount or 0)
        by_status[p.status or "발주"] = by_status.get(p.status or "발주", 0) + 1
        mk = f"{p.order_date.year}-{p.order_date.month:02d}" if p.order_date else "?"
        by_month[mk] = by_month.get(mk, 0) + (p.total_amount or 0)
    return {
        "start": start.isoformat(), "end": end.isoformat(),
        "po_count": len(pos), "total_amount": round(tot),
        "by_vendor": sorted(({"vendor": k, "amount": round(v)} for k, v in by_vendor.items()), key=lambda x: -x["amount"]),
        "by_status": [{"status": k, "count": v} for k, v in by_status.items()],
        "by_month": [{"month": k, "amount": round(v)} for k, v in sorted(by_month.items())],
    }
