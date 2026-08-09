"""구매 관리 서비스 — 생산실적 → BOM 원부재료 소요 → 거래처별 발주·분석.

BOM 폭발(_explode_item)을 재활용해 생산량으로부터 원재료(kg)·부자재(ea) 소요량과
예상 원가를 산출하고, 자재의 supplier(거래처)로 묶어 발주·구매 대시보드를 제공.
"""
from __future__ import annotations

import re
import hashlib
from datetime import date, datetime, timedelta
from typing import Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db_models import (
    InventoryProduction, ScmProduct, ScmRawMaterial, ScmSubMaterial,
    PurchaseVendor, PurchaseOrder, PurchaseOrderLine, PurchaseRecord,
    ChannelSalesDailyProduct,
)


def _mclass_norm(s) -> str:
    """원재료/부재료 표기 정규화."""
    s = str(s or "").strip()
    if "부" in s:
        return "부재료"
    if "원" in s:
        return "원재료"
    return s or "기타"


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


# ──────────────────────────────────────────────
# 구매 실적(구매일보) 적재 · 분석
# ──────────────────────────────────────────────

def _rec_hash(r: dict) -> str:
    key = f"{r.get('pdate')}|{r.get('seq')}|{r.get('item_code')}|{r.get('item_name')}|{r.get('supply')}|{r.get('total')}|{r.get('qty')}"
    return hashlib.sha256(key.encode("utf-8")).hexdigest()


def ingest_records(db: Session, rows: list[dict]) -> dict:
    """구매일보 행 bulk 적재(row_hash 중복 스킵)."""
    existing = {h for (h,) in db.query(PurchaseRecord.row_hash).all()}
    added = skipped = 0
    seen = set()
    buf = []
    for r in rows:
        h = _rec_hash(r)
        if h in existing or h in seen:
            skipped += 1
            continue
        seen.add(h)
        try:
            pd = date.fromisoformat(str(r["pdate"])[:10])
        except Exception:
            skipped += 1
            continue
        buf.append(PurchaseRecord(
            row_hash=h, pdate=pd, seq=int(r.get("seq") or 0),
            warehouse=(r.get("warehouse") or "")[:100],
            vendor_name=(r.get("vendor") or "")[:200],
            mclass=_mclass_norm(r.get("mclass")),
            staff=(r.get("staff") or "")[:50],
            item_code=(str(r.get("item_code") or ""))[:50],
            item_name=(r.get("item_name") or "")[:400],
            unit=(r.get("unit") or "")[:30],
            qty=float(r.get("qty") or 0), unit_price=float(r.get("unit_price") or 0),
            supply_amount=float(r.get("supply") or 0), vat=float(r.get("vat") or 0),
            total_amount=float(r.get("total") or 0), note=(r.get("note") or "")[:300],
        ))
        added += 1
        if len(buf) >= 500:
            db.bulk_save_objects(buf); db.commit(); buf = []
    if buf:
        db.bulk_save_objects(buf); db.commit()
    return {"added": added, "skipped": skipped, "total_in_db": db.query(func.count(PurchaseRecord.id)).scalar()}


def purge_records(db: Session) -> dict:
    n = db.query(PurchaseRecord).delete()
    db.commit()
    return {"deleted": n}


def _sales_sum(db: Session, start: date, end: date) -> float:
    v = db.query(func.coalesce(func.sum(ChannelSalesDailyProduct.net_sales), 0.0)).filter(
        ChannelSalesDailyProduct.sale_date >= start,
        ChannelSalesDailyProduct.sale_date <= end,
    ).scalar()
    return float(v or 0)


def records_dashboard(db: Session, start: date, end: date,
                      vendor: Optional[str] = None, mclass: Optional[str] = None,
                      q: Optional[str] = None) -> dict:
    """구매 실적 종합 대시보드 — 원/부재료·거래처·품목·일별·매출대비 누적비율. 거래처·구분·검색 필터."""
    base = db.query(PurchaseRecord).filter(
        PurchaseRecord.pdate >= start, PurchaseRecord.pdate <= end)
    if vendor:
        base = base.filter(PurchaseRecord.vendor_name == vendor)
    if mclass:
        base = base.filter(PurchaseRecord.mclass == _mclass_norm(mclass))
    if q:
        like = f"%{q}%"
        base = base.filter((PurchaseRecord.item_name.ilike(like)) | (PurchaseRecord.vendor_name.ilike(like)))
    rows = base.all()
    total_supply = sum(r.supply_amount or 0 for r in rows)
    total_amount = sum(r.total_amount or 0 for r in rows)

    by_class: dict = {}
    by_vendor: dict = {}
    by_item: dict = {}
    by_day: dict = {}
    by_month: dict = {}
    by_staff: dict = {}
    for r in rows:
        amt = r.supply_amount or 0
        c = r.mclass or "기타"
        bc = by_class.setdefault(c, {"mclass": c, "supply": 0, "lines": 0})
        bc["supply"] += amt; bc["lines"] += 1
        by_vendor[r.vendor_name or "미지정"] = by_vendor.get(r.vendor_name or "미지정", 0) + amt
        ik = r.item_code or r.item_name or "?"
        bi = by_item.setdefault(ik, {"item_code": r.item_code, "item_name": r.item_name, "supply": 0, "qty": 0, "mclass": c})
        bi["supply"] += amt; bi["qty"] += (r.qty or 0)
        ds = r.pdate.isoformat() if r.pdate else "?"
        by_day[ds] = by_day.get(ds, 0) + amt
        mk = f"{r.pdate.year}-{r.pdate.month:02d}" if r.pdate else "?"
        by_month[mk] = by_month.get(mk, 0) + amt
        by_staff[r.staff or "미지정"] = by_staff.get(r.staff or "미지정", 0) + amt

    sales = _sales_sum(db, start, end)
    ratio = round(total_supply / sales * 100, 1) if sales > 0 else None

    return {
        "start": start.isoformat(), "end": end.isoformat(),
        "line_count": len(rows), "total_supply": round(total_supply), "total_amount": round(total_amount),
        "vendor_count": len(by_vendor), "item_count": len(by_item),
        "sales": round(sales), "purchase_to_sales_ratio": ratio,
        "by_class": sorted(by_class.values(), key=lambda x: -x["supply"]),
        "by_vendor": sorted(({"vendor": k, "supply": round(v)} for k, v in by_vendor.items()), key=lambda x: -x["supply"])[:20],
        "by_item": sorted(({**v, "supply": round(v["supply"]), "qty": round(v["qty"], 1)} for v in by_item.values()), key=lambda x: -x["supply"])[:20],
        "by_day": [{"date": k, "supply": round(v)} for k, v in sorted(by_day.items())],
        "by_month": [{"month": k, "supply": round(v)} for k, v in sorted(by_month.items())],
        "by_staff": sorted(({"staff": k, "supply": round(v)} for k, v in by_staff.items()), key=lambda x: -x["supply"]),
    }


def sales_vs_purchase(db: Session, start: date, end: date, granularity: str = "day") -> dict:
    """기간 내 매출 대비 구매 누적비율 시계열(일/주/월)."""
    def bucket(d: date) -> str:
        if granularity == "month":
            return f"{d.year}-{d.month:02d}"
        if granularity == "week":
            monday = d - timedelta(days=d.weekday())
            return monday.isoformat()
        return d.isoformat()

    pur: dict = {}
    for r in db.query(PurchaseRecord.pdate, PurchaseRecord.supply_amount).filter(
            PurchaseRecord.pdate >= start, PurchaseRecord.pdate <= end).all():
        if r[0]:
            pur[bucket(r[0])] = pur.get(bucket(r[0]), 0) + (r[1] or 0)
    sal: dict = {}
    for r in db.query(ChannelSalesDailyProduct.sale_date, ChannelSalesDailyProduct.net_sales).filter(
            ChannelSalesDailyProduct.sale_date >= start, ChannelSalesDailyProduct.sale_date <= end).all():
        if r[0]:
            sal[bucket(r[0])] = sal.get(bucket(r[0]), 0) + (r[1] or 0)

    keys = sorted(set(pur) | set(sal))
    cum_p = cum_s = 0.0
    series = []
    for k in keys:
        p = pur.get(k, 0); s = sal.get(k, 0)
        cum_p += p; cum_s += s
        series.append({
            "bucket": k, "purchase": round(p), "sales": round(s),
            "cum_purchase": round(cum_p), "cum_sales": round(cum_s),
            "ratio": round(p / s * 100, 1) if s > 0 else None,
            "cum_ratio": round(cum_p / cum_s * 100, 1) if cum_s > 0 else None,
        })
    return {"granularity": granularity, "series": series,
            "cum_purchase": round(cum_p), "cum_sales": round(cum_s),
            "cum_ratio": round(cum_p / cum_s * 100, 1) if cum_s > 0 else None}


def records_list(db: Session, start=None, end=None, vendor=None, mclass=None,
                 item_code=None, q=None, limit: int = 500, offset: int = 0) -> dict:
    qry = db.query(PurchaseRecord)
    if start:
        qry = qry.filter(PurchaseRecord.pdate >= start)
    if end:
        qry = qry.filter(PurchaseRecord.pdate <= end)
    if vendor:
        qry = qry.filter(PurchaseRecord.vendor_name == vendor)
    if mclass:
        qry = qry.filter(PurchaseRecord.mclass == _mclass_norm(mclass))
    if item_code:
        qry = qry.filter(PurchaseRecord.item_code == item_code)
    if q:
        like = f"%{q}%"
        qry = qry.filter((PurchaseRecord.item_name.ilike(like)) | (PurchaseRecord.vendor_name.ilike(like)))
    total = qry.count()
    supply_total = qry.with_entities(func.coalesce(func.sum(PurchaseRecord.supply_amount), 0.0)).scalar()
    recs = qry.order_by(PurchaseRecord.pdate.desc(), PurchaseRecord.seq.desc()).offset(offset).limit(limit).all()
    return {
        "total": total, "supply_total": round(supply_total or 0), "offset": offset, "limit": limit,
        "rows": [{
            "id": r.id, "pdate": r.pdate.isoformat() if r.pdate else None, "seq": r.seq,
            "warehouse": r.warehouse, "vendor": r.vendor_name, "mclass": r.mclass, "staff": r.staff,
            "item_code": r.item_code, "item_name": r.item_name, "unit": r.unit,
            "qty": r.qty, "unit_price": r.unit_price, "supply": round(r.supply_amount or 0),
            "vat": round(r.vat or 0), "total": round(r.total_amount or 0), "note": r.note,
        } for r in recs],
    }


def vendor_history(db: Session, vendor: str, start=None, end=None) -> dict:
    qry = db.query(PurchaseRecord).filter(PurchaseRecord.vendor_name == vendor)
    if start:
        qry = qry.filter(PurchaseRecord.pdate >= start)
    if end:
        qry = qry.filter(PurchaseRecord.pdate <= end)
    rows = qry.all()
    by_month: dict = {}
    by_item: dict = {}
    for r in rows:
        mk = f"{r.pdate.year}-{r.pdate.month:02d}" if r.pdate else "?"
        by_month[mk] = by_month.get(mk, 0) + (r.supply_amount or 0)
        ik = r.item_code or r.item_name
        bi = by_item.setdefault(ik, {"item_code": r.item_code, "item_name": r.item_name, "supply": 0, "qty": 0})
        bi["supply"] += (r.supply_amount or 0); bi["qty"] += (r.qty or 0)
    return {
        "vendor": vendor, "line_count": len(rows),
        "total_supply": round(sum(r.supply_amount or 0 for r in rows)),
        "first": min((r.pdate.isoformat() for r in rows if r.pdate), default=None),
        "last": max((r.pdate.isoformat() for r in rows if r.pdate), default=None),
        "by_month": [{"month": k, "supply": round(v)} for k, v in sorted(by_month.items())],
        "by_item": sorted(({**v, "supply": round(v["supply"]), "qty": round(v["qty"], 1)} for v in by_item.values()), key=lambda x: -x["supply"]),
    }


def item_history(db: Session, item_code=None, item_name=None, start=None, end=None) -> dict:
    qry = db.query(PurchaseRecord)
    if item_code:
        qry = qry.filter(PurchaseRecord.item_code == item_code)
    elif item_name:
        qry = qry.filter(PurchaseRecord.item_name.ilike(f"%{item_name}%"))
    if start:
        qry = qry.filter(PurchaseRecord.pdate >= start)
    if end:
        qry = qry.filter(PurchaseRecord.pdate <= end)
    rows = qry.order_by(PurchaseRecord.pdate).all()
    by_month: dict = {}
    by_vendor: dict = {}
    prices = []
    for r in rows:
        mk = f"{r.pdate.year}-{r.pdate.month:02d}" if r.pdate else "?"
        bm = by_month.setdefault(mk, {"month": mk, "supply": 0, "qty": 0})
        bm["supply"] += (r.supply_amount or 0); bm["qty"] += (r.qty or 0)
        by_vendor[r.vendor_name or "미지정"] = by_vendor.get(r.vendor_name or "미지정", 0) + (r.supply_amount or 0)
        if r.unit_price:
            prices.append((r.pdate.isoformat() if r.pdate else None, r.unit_price, r.vendor_name))
    return {
        "item_code": item_code, "item_name": item_name or (rows[0].item_name if rows else None),
        "line_count": len(rows), "total_supply": round(sum(r.supply_amount or 0 for r in rows)),
        "total_qty": round(sum(r.qty or 0 for r in rows), 1),
        "by_month": [{**v, "supply": round(v["supply"]), "qty": round(v["qty"], 1)} for v in by_month.values()],
        "by_vendor": sorted(({"vendor": k, "supply": round(v)} for k, v in by_vendor.items()), key=lambda x: -x["supply"]),
        "price_trend": [{"date": d, "unit_price": round(p, 2), "vendor": v} for d, p, v in prices],
    }


def price_tracker(db: Session, start: date, end: date,
                  mclass: Optional[str] = None, vendor: Optional[str] = None,
                  q: Optional[str] = None, min_lines: int = 1,
                  sort: str = "abs_change") -> dict:
    """기간 내 품목별 매입 단가 변동 개요.

    품목(item_code 우선, 없으면 item_name)별로 기간 내 최초/최근 단가, 최저/최고,
    가중평균(공급가÷수량), 변동률(최근÷최초)을 집계. 단가 상승/하락 품목을 한눈에.
    · 단가는 행별 unit_price(공급가/수량 아님)를 사용하되, 0/음수는 제외.
    · 매입 시점이 여럿이면 최초=기간 첫 매입일 단가, 최근=마지막 매입일 단가.
    """
    qry = db.query(PurchaseRecord).filter(
        PurchaseRecord.pdate >= start, PurchaseRecord.pdate <= end,
    )
    if mclass:
        qry = qry.filter(PurchaseRecord.mclass == _mclass_norm(mclass))
    if vendor:
        qry = qry.filter(PurchaseRecord.vendor_name == vendor)
    if q:
        like = f"%{q}%"
        qry = qry.filter(
            (PurchaseRecord.item_name.ilike(like)) | (PurchaseRecord.item_code.ilike(like))
        )
    rows = qry.order_by(PurchaseRecord.pdate, PurchaseRecord.seq).all()

    # 품목 × 단위(구매단위)로 묶는다 — 같은 품목이라도 낱개/box/20kg 등 단위가 섞이면
    # 단가 기준(basis)이 달라 변동률이 왜곡되므로, 단위별로 별도 시계열을 만든다.
    items: dict = {}
    for r in rows:
        base = (r.item_code or "").strip() or (r.item_name or "").strip()
        if not base:
            continue
        unit = (r.unit or "").strip() or "-"
        key = (base, unit)
        it = items.setdefault(key, {
            "item_code": r.item_code, "item_name": r.item_name,
            "mclass": r.mclass, "unit": unit, "points": [], "vendors": set(),
            "total_qty": 0.0, "total_supply": 0.0,
        })
        it["total_qty"] += (r.qty or 0)
        it["total_supply"] += (r.supply_amount or 0)
        if r.vendor_name:
            it["vendors"].add(r.vendor_name)
        up = r.unit_price or 0
        if up > 0 and r.pdate:
            it["points"].append((r.pdate, up, r.vendor_name))

    out = []
    for key, it in items.items():
        pts = it["points"]
        if len(pts) < min_lines:
            continue
        if not pts:
            continue
        prices = [p for _, p, _ in pts]
        first_d, first_p, _ = pts[0]
        last_d, last_p, _ = pts[-1]
        lo, hi = min(prices), max(prices)
        wavg = (it["total_supply"] / it["total_qty"]) if it["total_qty"] else None
        change = (last_p - first_p)
        change_pct = (change / first_p * 100) if first_p else None
        spread_pct = ((hi - lo) / lo * 100) if lo else None
        out.append({
            "item_code": it["item_code"], "item_name": it["item_name"],
            "mclass": it["mclass"], "unit": it["unit"], "vendor_count": len(it["vendors"]),
            "vendors": sorted(it["vendors"])[:5],
            "buy_count": len(pts),
            "first_date": first_d.isoformat(), "first_price": round(first_p, 2),
            "last_date": last_d.isoformat(), "last_price": round(last_p, 2),
            "min_price": round(lo, 2), "max_price": round(hi, 2),
            "avg_price": round(wavg, 2) if wavg is not None else None,
            "change": round(change, 2),
            "change_pct": round(change_pct, 1) if change_pct is not None else None,
            "spread_pct": round(spread_pct, 1) if spread_pct is not None else None,
            "total_qty": round(it["total_qty"], 1),
            "total_supply": round(it["total_supply"]),
        })

    keyfn = {
        "abs_change": lambda x: -abs(x["change_pct"] or 0),
        "change_desc": lambda x: -(x["change_pct"] or 0),
        "change_asc": lambda x: (x["change_pct"] or 0),
        "spread": lambda x: -(x["spread_pct"] or 0),
        "supply": lambda x: -(x["total_supply"] or 0),
        "name": lambda x: (x["item_name"] or ""),
    }.get(sort, lambda x: -abs(x["change_pct"] or 0))
    out.sort(key=keyfn)

    rising = [x for x in out if (x["change_pct"] or 0) > 0]
    falling = [x for x in out if (x["change_pct"] or 0) < 0]
    return {
        "start": start.isoformat(), "end": end.isoformat(),
        "item_count": len(out),
        "rising_count": len(rising), "falling_count": len(falling),
        "flat_count": len(out) - len(rising) - len(falling),
        "items": out,
    }


def req_vs_actual(db: Session, start: date, end: date, top: int = 40) -> dict:
    """생산 BOM 이론소요 vs 실제 구매를 품목(erp_code)별로 대조 — 히트맵/비교용.

    매칭키: BOM 자재 erp_code ↔ 구매 item_code. 금액=원가/공급가, 수량=소요량/구매량.
    """
    try:
        mr = material_requirement(db, start, end)
    except Exception:
        mr = {"materials": []}
    req: dict = {}
    for m in mr.get("materials", []):
        code = (m.get("erp_code") or "").strip()
        key = code or m.get("name")
        r = req.setdefault(key, {"code": code, "name": m.get("name"), "type": m.get("type"),
                                 "req_qty": 0.0, "req_cost": 0.0})
        r["req_qty"] += m.get("qty", 0) or 0
        r["req_cost"] += m.get("cost", 0) or 0

    act: dict = {}
    rows = db.query(
        PurchaseRecord.item_code, PurchaseRecord.item_name,
        func.coalesce(func.sum(PurchaseRecord.qty), 0.0),
        func.coalesce(func.sum(PurchaseRecord.supply_amount), 0.0),
    ).filter(PurchaseRecord.pdate >= start, PurchaseRecord.pdate <= end).group_by(
        PurchaseRecord.item_code, PurchaseRecord.item_name).all()
    for code, name, q, amt in rows:
        code = (str(code) or "").strip()
        key = code or name
        a = act.setdefault(key, {"code": code, "name": name, "act_qty": 0.0, "act_cost": 0.0})
        a["act_qty"] += float(q or 0)
        a["act_cost"] += float(amt or 0)

    keys = set(req) | set(act)
    items = []
    for k in keys:
        r = req.get(k, {})
        a = act.get(k, {})
        rc = round(r.get("req_cost", 0))
        ac = round(a.get("act_cost", 0))
        items.append({
            "code": r.get("code") or a.get("code") or "",
            "name": r.get("name") or a.get("name") or k,
            "type": r.get("type"),
            "req_qty": round(r.get("req_qty", 0), 1), "req_cost": rc,
            "act_qty": round(a.get("act_qty", 0), 1), "act_cost": ac,
            "gap": ac - rc,
            "coverage": round(ac / rc * 100, 1) if rc > 0 else (None if ac == 0 else 9999),
            "matched": bool(r) and bool(a),
        })
    # 소요 또는 구매가 큰 순
    items.sort(key=lambda x: -max(x["req_cost"], x["act_cost"]))
    return {
        "start": start.isoformat(), "end": end.isoformat(),
        "items": items[:top],
        "total_req": round(sum(i["req_cost"] for i in items)),
        "total_act": round(sum(i["act_cost"] for i in items)),
        "matched_count": sum(1 for i in items if i["matched"]),
    }
