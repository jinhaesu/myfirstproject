"""구매 관리 서비스 — 생산실적 → BOM 원부재료 소요 → 거래처별 발주·분석.

BOM 폭발(_explode_item)을 재활용해 생산량으로부터 원재료(kg)·부자재(ea) 소요량과
예상 원가를 산출하고, 자재의 supplier(거래처)로 묶어 발주·구매 대시보드를 제공.
"""
from __future__ import annotations

import re
import hashlib
import calendar
from datetime import date, datetime, timedelta
from typing import Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db_models import (
    InventoryProduction, ScmProduct, ScmRawMaterial, ScmSubMaterial, ScmBomLine,
    PurchaseVendor, PurchaseOrder, PurchaseOrderLine, PurchaseRecord,
    ChannelSalesDailyProduct, PurchaseVendorTerm, PurchasePayment,
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


_SPEC_RE = re.compile(r"\[([^\]]+)\]")
_WEIGHT_RE = re.compile(r"(\d+(?:\.\d+)?)\s*(kg|g)\b", re.IGNORECASE)
# N kg * M ea  (박스당 M개 × 개당 Nkg) — 멀티팩
_MULTI_RE = re.compile(r"(\d+(?:\.\d+)?)\s*(kg|g)\s*\*\s*(\d+)\s*ea", re.IGNORECASE)


def parse_spec(item_name: str) -> tuple[Optional[str], Optional[float]]:
    """품목명의 마지막 [ ] 규격 텍스트와 ea(=구매단위)당 kg를 추출.

    예) '아몬드분말 [20kg]' → ('20kg', 20.0), '이스트 [500g]' → ('500g', 0.5),
        '리플잼 [(1kg*6ea/box)]' → 6.0(=1kg×6), '위생가운 [XL*50ea/box]' → (spec, None),
        규격 없음/무게 아님 → (spec 또는 None, None).
    """
    if not item_name:
        return None, None
    specs = _SPEC_RE.findall(item_name)
    if not specs:
        return None, None
    spec = specs[-1].strip()   # 마지막 대괄호를 규격으로
    mm = _MULTI_RE.search(spec)
    if mm:
        w = float(mm.group(1)); w = w / 1000.0 if mm.group(2).lower() == "g" else w
        kg = w * int(mm.group(3))
        return spec, (kg if kg > 0 else None)
    m = _WEIGHT_RE.search(spec)
    if not m:
        return spec, None
    val = float(m.group(1))
    kg = val / 1000.0 if m.group(2).lower() == "g" else val
    return spec, (kg if kg > 0 else None)


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
        _spec, _kgpu = parse_spec(r.get("item_name") or "")
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
            spec=_spec, kg_per_unit=_kgpu, team=(r.get("team") or "구매팀")[:20],
        ))
        added += 1
        if len(buf) >= 500:
            db.bulk_save_objects(buf); db.commit(); buf = []
    if buf:
        db.bulk_save_objects(buf); db.commit()
    return {"added": added, "skipped": skipped, "total_in_db": db.query(func.count(PurchaseRecord.id)).scalar()}


def add_manual_record(db: Session, r: dict, user: Optional[str] = None) -> dict:
    """화면에서 구매 실적 1건 직접 입력. 공급가/합계는 비어 있으면 자동계산."""
    try:
        pd = date.fromisoformat(str(r.get("pdate"))[:10])
    except Exception:
        return {"ok": False, "msg": "일자(pdate) 형식 오류"}
    if not (r.get("item_name") or r.get("item_code")):
        return {"ok": False, "msg": "품목명 또는 품목코드는 필수입니다"}
    qty = float(r.get("qty") or 0)
    unit_price = float(r.get("unit_price") or 0)
    supply = float(r.get("supply") or 0) or round(qty * unit_price)
    # vat: 명시적으로 넘어오면(0 포함) 존중, 없으면 공급가의 10%
    vat = r.get("vat")
    vat = float(vat) if vat not in (None, "") else round(supply * 0.1)
    total = float(r.get("total") or 0) or round(supply + vat)
    _spec, _kgpu = parse_spec(r.get("item_name") or "")
    # kg_per_unit 수동 지정값이 오면 우선
    if r.get("kg_per_unit") not in (None, ""):
        try:
            _kgpu = float(r["kg_per_unit"]) or None
        except Exception:
            pass
    if r.get("spec"):
        _spec = str(r["spec"])[:60]
    rec = PurchaseRecord(
        row_hash=_rec_hash({"pdate": pd.isoformat(), "seq": r.get("seq") or 0,
                            "item_code": r.get("item_code"), "item_name": r.get("item_name"),
                            "supply": supply, "total": total, "qty": qty}),
        pdate=pd, seq=int(r.get("seq") or 0),
        warehouse=(r.get("warehouse") or "")[:100],
        vendor_name=(r.get("vendor") or "")[:200],
        mclass=_mclass_norm(r.get("mclass")),
        staff=(r.get("staff") or "")[:50],
        item_code=(str(r.get("item_code") or ""))[:50],
        item_name=(r.get("item_name") or "")[:400],
        unit=(r.get("unit") or "")[:30],
        qty=qty, unit_price=unit_price, supply_amount=supply, vat=vat,
        total_amount=total, note=(r.get("note") or "")[:300],
        spec=_spec, kg_per_unit=_kgpu, team=(r.get("team") or "구매팀")[:20],
        source="manual", created_by=user,
    )
    # 동일 전표 중복 방지
    if db.query(PurchaseRecord.id).filter(PurchaseRecord.row_hash == rec.row_hash).first():
        return {"ok": False, "msg": "동일 내용의 구매 실적이 이미 있습니다(일자·품목·금액 중복)"}
    db.add(rec); db.commit(); db.refresh(rec)
    return {"ok": True, "id": rec.id, "supply": supply, "vat": vat, "total": total}


def _rec_dict(x) -> dict:
    """실적 행 공통 직렬화 — 규격/kg/정산 포함."""
    kgpu = x.kg_per_unit
    spec = x.spec
    if spec is None and x.item_name:
        spec, kgpu2 = parse_spec(x.item_name)
        kgpu = kgpu if kgpu is not None else kgpu2
    name_wo = _SPEC_RE.sub("", x.item_name or "").strip() if spec else (x.item_name or "")
    return {
        "id": x.id, "pdate": x.pdate.isoformat() if x.pdate else None, "seq": x.seq,
        "warehouse": x.warehouse, "vendor": x.vendor_name, "mclass": x.mclass,
        "staff": x.staff, "item_code": x.item_code, "item_name": x.item_name,
        "item_name_short": name_wo, "spec": spec, "kg_per_unit": kgpu,
        "unit": x.unit, "qty": x.qty,
        "kg": round((x.qty or 0) * kgpu, 2) if kgpu else None,
        "unit_price": x.unit_price,
        "price_per_kg": round(x.unit_price / kgpu) if (kgpu and x.unit_price) else None,
        "supply": round(x.supply_amount or 0), "vat": round(x.vat or 0), "total": round(x.total_amount or 0),
        "note": x.note, "created_by": x.created_by, "team": x.team or "구매팀",
        "paid": bool(x.paid), "paid_date": x.paid_date.isoformat() if x.paid_date else None,
    }


def manual_recent(db: Session, limit: int = 30) -> dict:
    """최근 화면 직접입력분(수동) 목록."""
    q = (db.query(PurchaseRecord).filter(PurchaseRecord.source == "manual")
         .order_by(PurchaseRecord.id.desc()).limit(limit).all())
    return {"rows": [_rec_dict(x) for x in q]}


def settle_records(db: Session, ids: list[int], paid: bool) -> dict:
    """전표(행) 단위 정산완료 토글. paid=True면 paid_date=today."""
    if not ids:
        return {"ok": True, "updated": 0}
    vals = {"paid": paid, "paid_date": (date.today() if paid else None)}
    n = db.query(PurchaseRecord).filter(PurchaseRecord.id.in_(ids)).update(vals, synchronize_session=False)
    db.commit()
    return {"ok": True, "updated": n}


def delete_record(db: Session, rec_id: int) -> dict:
    n = db.query(PurchaseRecord).filter(PurchaseRecord.id == rec_id).delete()
    db.commit()
    return {"ok": True, "deleted": n}


_EDITABLE = {"qty", "unit_price", "supply", "vat", "total", "unit", "vendor",
             "mclass", "staff", "item_code", "item_name", "warehouse", "note", "pdate", "seq",
             "spec", "kg_per_unit", "paid", "team"}
_FIELD_MAP = {"vendor": "vendor_name", "supply": "supply_amount", "total": "total_amount"}


def update_record(db: Session, rec_id: int, fields: dict, recompute: bool = True) -> dict:
    """구매 실적 1건 수정. recompute=True면 supply/vat/total을 수량×단가로 재계산.

    금액(supply/vat/total)이 명시적으로 넘어오면 그 값을 우선한다. row_hash도 재산출.
    """
    rec = db.get(PurchaseRecord, rec_id)
    if not rec:
        return {"ok": False, "msg": "해당 실적이 없습니다"}
    for k, v in fields.items():
        if k not in _EDITABLE or v is None:
            continue
        if k == "pdate":
            try:
                rec.pdate = date.fromisoformat(str(v)[:10])
            except Exception:
                return {"ok": False, "msg": "일자 형식 오류"}
            continue
        if k == "mclass":
            rec.mclass = _mclass_norm(v); continue
        if k == "paid":
            rec.paid = bool(v)
            rec.paid_date = date.today() if v else None
            continue
        if k == "kg_per_unit":
            try:
                rec.kg_per_unit = float(v) or None
            except Exception:
                pass
            continue
        setattr(rec, _FIELD_MAP.get(k, k), v)
    # 품목명이 바뀌었는데 규격/kg 미지정이면 재파싱
    if "item_name" in fields and "spec" not in fields:
        rec.spec, _kgpu = parse_spec(rec.item_name or "")
        if "kg_per_unit" not in fields:
            rec.kg_per_unit = _kgpu
    # 금액 재계산: supply/total이 명시 안 됐고 recompute면 수량×단가로.
    if recompute and "supply" not in fields:
        rec.supply_amount = round((rec.qty or 0) * (rec.unit_price or 0))
    if recompute and "vat" not in fields and "total" not in fields:
        rec.total_amount = round((rec.supply_amount or 0) + (rec.vat or 0))
    elif "total" not in fields:
        rec.total_amount = round((rec.supply_amount or 0) + (rec.vat or 0))
    rec.row_hash = _rec_hash({
        "pdate": rec.pdate.isoformat() if rec.pdate else None, "seq": rec.seq,
        "item_code": rec.item_code, "item_name": rec.item_name,
        "supply": rec.supply_amount, "total": rec.total_amount, "qty": rec.qty,
    })
    db.commit()
    return {"ok": True, "id": rec.id, "qty": rec.qty, "unit_price": rec.unit_price,
            "supply": rec.supply_amount, "vat": rec.vat, "total": rec.total_amount}


def normalize_unit_basis(db: Session, item_code: str, box_kg: float,
                         threshold: float = 15000, dry_run: bool = True) -> dict:
    """품목의 kg당 단가(초기 입력분)를 박스당 단가로 정규화.

    unit_price < threshold 인 행 = kg당 입력으로 보고 unit_price×box_kg, qty÷box_kg 로 환산.
    공급가/합계는 불변(수량×단가 항등). dry_run이면 변경건수만 반환.
    """
    q = db.query(PurchaseRecord).filter(
        PurchaseRecord.item_code == item_code,
        PurchaseRecord.unit_price > 0,
        PurchaseRecord.unit_price < threshold,
    ).all()
    changed = []
    for r in q:
        old_up, old_qty = r.unit_price, r.qty
        new_up = round(old_up * box_kg, 2)
        new_qty = round((old_qty or 0) / box_kg, 4)
        changed.append({"id": r.id, "pdate": r.pdate.isoformat() if r.pdate else None,
                        "old_unit_price": old_up, "new_unit_price": new_up,
                        "old_qty": old_qty, "new_qty": new_qty})
        if not dry_run:
            r.unit_price = new_up
            r.qty = new_qty
            r.row_hash = _rec_hash({
                "pdate": r.pdate.isoformat() if r.pdate else None, "seq": r.seq,
                "item_code": r.item_code, "item_name": r.item_name,
                "supply": r.supply_amount, "total": r.total_amount, "qty": r.qty})
    if not dry_run:
        db.commit()
    return {"ok": True, "item_code": item_code, "box_kg": box_kg,
            "count": len(changed), "dry_run": dry_run, "changes": changed[:50]}


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
                      q: Optional[str] = None, team: Optional[str] = None) -> dict:
    """구매 실적 종합 대시보드 — 원/부재료·거래처·품목·일별·매출대비 누적비율. 거래처·구분·팀·검색 필터."""
    base = db.query(PurchaseRecord).filter(
        PurchaseRecord.pdate >= start, PurchaseRecord.pdate <= end)
    if vendor:
        base = base.filter(PurchaseRecord.vendor_name == vendor)
    if mclass:
        base = base.filter(PurchaseRecord.mclass == _mclass_norm(mclass))
    if team:
        base = base.filter(PurchaseRecord.team == team)
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


def records_monthly_matrix(db: Session, year: int, by: str = "vendor",
                           team: Optional[str] = None, mclass: Optional[str] = None,
                           top: int = 0) -> dict:
    """지정 연도 1~12월 × (거래처|원부재료) 구매 공급가 매트릭스.

    설정 기간과 무관하게 해당 연도 전체(1~12월)를 대상으로 한다.
    by='vendor'(거래처별) 또는 'material'(품목별). 행별 합계·월별 합계·총계 포함.
    """
    start = date(year, 1, 1)
    end = date(year, 12, 31)
    qry = db.query(PurchaseRecord).filter(
        PurchaseRecord.pdate >= start, PurchaseRecord.pdate <= end)
    if team:
        qry = qry.filter(PurchaseRecord.team == team)
    if mclass:
        qry = qry.filter(PurchaseRecord.mclass == _mclass_norm(mclass))

    # key -> {label, code, months[12], total}
    grid: dict = {}
    month_totals = [0.0] * 12
    grand = 0.0
    for r in qry.all():
        if not r.pdate:
            continue
        mi = r.pdate.month - 1
        amt = r.supply_amount or 0
        if by == "material":
            code = (r.item_code or "").strip()
            label = _SPEC_RE.sub("", r.item_name or "").strip() or r.item_name or "(품목미상)"
            key = code or label
        else:
            code = None
            label = (r.vendor_name or "").strip() or "(거래처미상)"
            key = label
        g = grid.setdefault(key, {"label": label, "code": code, "months": [0.0] * 12, "total": 0.0})
        g["months"][mi] += amt
        g["total"] += amt
        month_totals[mi] += amt
        grand += amt

    rows = sorted(grid.values(), key=lambda x: -x["total"])
    if top and top > 0:
        rows = rows[:top]
    out_rows = [{
        "label": g["label"], "code": g["code"],
        "months": [round(v) for v in g["months"]],
        "total": round(g["total"]),
    } for g in rows]
    return {
        "year": year, "by": by,
        "month_totals": [round(v) for v in month_totals],
        "grand_total": round(grand),
        "row_count": len(grid),
        "rows": out_rows,
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
                 item_code=None, q=None, team=None, limit: int = 500, offset: int = 0) -> dict:
    qry = db.query(PurchaseRecord)
    if start:
        qry = qry.filter(PurchaseRecord.pdate >= start)
    if end:
        qry = qry.filter(PurchaseRecord.pdate <= end)
    if vendor:
        qry = qry.filter(PurchaseRecord.vendor_name == vendor)
    if mclass:
        qry = qry.filter(PurchaseRecord.mclass == _mclass_norm(mclass))
    if team:
        qry = qry.filter(PurchaseRecord.team == team)
    if item_code:
        qry = qry.filter(PurchaseRecord.item_code == item_code)
    if q:
        like = f"%{q}%"
        qry = qry.filter((PurchaseRecord.item_name.ilike(like)) | (PurchaseRecord.vendor_name.ilike(like)))
    total = qry.count()
    sums = qry.with_entities(
        func.coalesce(func.sum(PurchaseRecord.supply_amount), 0.0),
        func.coalesce(func.sum(PurchaseRecord.vat), 0.0),
        func.coalesce(func.sum(PurchaseRecord.total_amount), 0.0),
        func.coalesce(func.sum(PurchaseRecord.qty), 0.0),
        func.coalesce(func.sum(PurchaseRecord.qty * PurchaseRecord.kg_per_unit), 0.0),
        func.coalesce(func.sum(PurchaseRecord.total_amount).filter(PurchaseRecord.paid.is_(True)), 0.0),
    ).one()
    supply_total, vat_total, total_total, qty_total, kg_total, paid_total = sums
    recs = qry.order_by(PurchaseRecord.pdate.desc(), PurchaseRecord.seq.desc()).offset(offset).limit(limit).all()

    def _row(r):
        kg = round((r.qty or 0) * r.kg_per_unit, 2) if r.kg_per_unit else None
        # 이름에서 규격 대괄호를 떼어 별도 표시(spec 없으면 파싱)
        nm = r.item_name or ""
        spec = r.spec
        kgpu = r.kg_per_unit
        if spec is None and nm:
            spec, kgpu2 = parse_spec(nm)
            kgpu = kgpu if kgpu is not None else kgpu2
        name_wo = _SPEC_RE.sub("", nm).strip() if spec else nm
        return {
            "id": r.id, "pdate": r.pdate.isoformat() if r.pdate else None, "seq": r.seq,
            "warehouse": r.warehouse, "vendor": r.vendor_name, "mclass": r.mclass, "staff": r.staff,
            "item_code": r.item_code, "item_name": r.item_name, "item_name_short": name_wo,
            "spec": spec, "kg_per_unit": kgpu, "unit": r.unit,
            "qty": r.qty, "kg": kg, "unit_price": r.unit_price,
            "price_per_kg": round(r.unit_price / kgpu) if (kgpu and r.unit_price) else None,
            "supply": round(r.supply_amount or 0),
            "vat": round(r.vat or 0), "total": round(r.total_amount or 0), "note": r.note,
            "paid": bool(r.paid), "paid_date": r.paid_date.isoformat() if r.paid_date else None,
            "created_by": r.created_by, "source": r.source, "team": r.team or "구매팀",
        }
    return {
        "total": total, "supply_total": round(supply_total or 0),
        "vat_total": round(vat_total or 0), "total_total": round(total_total or 0),
        "qty_total": round(qty_total or 0), "kg_total": round(kg_total or 0),
        "paid_total": round(paid_total or 0), "unpaid_total": round((total_total or 0) - (paid_total or 0)),
        "offset": offset, "limit": limit,
        "rows": [_row(r) for r in recs],
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


# 일회성 제작·설비성 비용(목형비/동판비/금형/제판 등) — 반복 단가 개념이 없어
# 단가추이에서 제외한다. 매입액/구매현황에는 그대로 남는다.
_TOOLING_PAT = re.compile(r"(목형비|동판비|동판대|제판비|제판대|금형비|금형대|사양변경|판대금|필름비|필름대)")


def _is_tooling_cost(name: Optional[str]) -> bool:
    return bool(name and _TOOLING_PAT.search(name))


def price_tracker(db: Session, start: date, end: date,
                  mclass: Optional[str] = None, vendor: Optional[str] = None,
                  q: Optional[str] = None, min_lines: int = 1,
                  sort: str = "abs_change", team: Optional[str] = None) -> dict:
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
    if team:
        qry = qry.filter(PurchaseRecord.team == team)
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
        if _is_tooling_cost(r.item_name):  # 목형비/동판비 등 일회성 제작비는 단가추이 대상 아님
            continue
        unit = (r.unit or "").strip() or "-"
        key = (base, unit)
        it = items.setdefault(key, {
            "item_code": r.item_code, "item_name": r.item_name,
            "mclass": r.mclass, "unit": unit, "points": [], "vendors": set(),
            "total_qty": 0.0, "total_supply": 0.0, "kg_per_unit": None,
        })
        if it["kg_per_unit"] is None:
            it["kg_per_unit"] = r.kg_per_unit if r.kg_per_unit else parse_spec(r.item_name or "")[1]
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
        # 단가효과(총액) = 단가변동분 × 기간 발주량. +면 인상 부담, −면 인하 절감.
        cost_impact = change * it["total_qty"]
        kgpu = it["kg_per_unit"]
        _kg = (lambda p: round(p / kgpu, 2)) if kgpu else (lambda p: None)
        spec, _ = parse_spec(it["item_name"] or "")
        out.append({
            "item_code": it["item_code"], "item_name": it["item_name"],
            "item_name_short": _SPEC_RE.sub("", it["item_name"] or "").strip() if spec else it["item_name"],
            "spec": spec, "kg_per_unit": kgpu,
            "mclass": it["mclass"], "unit": it["unit"], "vendor_count": len(it["vendors"]),
            "vendors": sorted(it["vendors"])[:5],
            "buy_count": len(pts),
            "first_date": first_d.isoformat(), "first_price": round(first_p, 2),
            "last_date": last_d.isoformat(), "last_price": round(last_p, 2),
            "min_price": round(lo, 2), "max_price": round(hi, 2),
            "avg_price": round(wavg, 2) if wavg is not None else None,
            # per-kg 환산 (kg_per_unit 있을 때만)
            "first_price_kg": _kg(first_p), "last_price_kg": _kg(last_p),
            "min_price_kg": _kg(lo), "max_price_kg": _kg(hi),
            "avg_price_kg": _kg(wavg) if wavg is not None else None,
            "change": round(change, 2),
            "change_pct": round(change_pct, 1) if change_pct is not None else None,
            "spread_pct": round(spread_pct, 1) if spread_pct is not None else None,
            "total_qty": round(it["total_qty"], 1),
            "total_kg": round(it["total_qty"] * kgpu, 1) if kgpu else None,
            "total_supply": round(it["total_supply"]),
            "cost_impact": round(cost_impact),
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
    # 기간 총 단가효과(총액) = Σ인하절감액 − Σ인상부담액.
    #   인하절감액 = Σ(각 인하품목 발주량 × 인하분),  인상부담액 = Σ(각 인상품목 발주량 × 인상분)
    #   net_savings ≥ 0 이면 인하가 인상보다 커서 총액상 원가절감(유리).
    # ⚠️ 단가효과 = 단가변동 × 발주량. 전표 오기입(수량·단가 기준 불일치: 동판비처럼 qty가
    #    실제 매입수량이 아닌 인쇄량 등)이 있으면 수억~수백억으로 폭증한다. 두 가드로 제외:
    #    (1) |변동률| > OUTLIER_PCT — 단위기준 혼재(kg↔box)로 인한 비현실적 % 변동
    #    (2) |단가효과| > 매입액 × SUPPLY_MULT — 단가효과는 그 품목 실제 총매입액을 넘을 수
    #        없다. 넘으면 qty·unit_price 기준 불일치(동판비: 매입액 1,438만인데 효과 220억).
    #    (품목 표에는 이상치도 그대로 노출 — 사용자가 오기입 발견·수정하도록.)
    OUTLIER_PCT = 200.0
    SUPPLY_MULT = 2.0
    def _sane(x):
        cp = x["change_pct"]
        if cp is None or abs(cp) > OUTLIER_PCT:
            return False
        if abs(x["cost_impact"]) > max(x["total_supply"], 1) * SUPPLY_MULT:
            return False
        return True
    savings_amount = sum(-x["cost_impact"] for x in falling if _sane(x))   # 인하분(양수)
    increase_amount = sum(x["cost_impact"] for x in rising if _sane(x))    # 인상분(양수)
    net_savings = savings_amount - increase_amount
    excluded_outliers = sum(1 for x in out if not _sane(x))
    return {
        "start": start.isoformat(), "end": end.isoformat(),
        "item_count": len(out),
        "rising_count": len(rising), "falling_count": len(falling),
        "flat_count": len(out) - len(rising) - len(falling),
        "savings_amount": round(savings_amount),      # 인하 총 절감액 (이상치 제외)
        "increase_amount": round(increase_amount),    # 인상 총 부담액 (이상치 제외)
        "net_savings": round(net_savings),            # 순효과(인하−인상). ≥0=절감 우세
        "outlier_pct": OUTLIER_PCT,                   # 순효과 집계 제외 기준(|변동률|%)
        "excluded_outliers": excluded_outliers,       # 제외된 이상치 품목수
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


# ══════════════════════════════════════════════════════════════
# 매입채무(AP) — 거래처 정산조건 + 지급기록 + aging
# ══════════════════════════════════════════════════════════════

_TERM_LABELS = {
    "DAYS_AFTER": "발주 후 N일",
    "DAY_OF_MONTH": "지정월 N일",
    "MONTH_END": "지정월 말일",
}
_OFFSET_LABELS = {0: "당월", 1: "익월", 2: "익익월", 3: "3개월후"}


def _last_day(y: int, m: int) -> int:
    return calendar.monthrange(y, m)[1]


def _shift_month(y: int, m: int, offset: int) -> tuple[int, int]:
    idx = (m - 1) + offset
    return y + idx // 12, idx % 12 + 1


def compute_due_date(pdate: date, term) -> Optional[date]:
    """발주일 + 계약 정산조건 → 만기(정산예정)일. term 없으면 None."""
    if not pdate or term is None:
        return None
    tt = term.term_type or "MONTH_END"
    try:
        if tt == "DAYS_AFTER":
            return pdate + timedelta(days=int(term.term_days or 0))
        y, m = _shift_month(pdate.year, pdate.month, int(term.term_month_offset or 0))
        if tt == "MONTH_END":
            return date(y, m, _last_day(y, m))
        day = min(int(term.term_day or 1), _last_day(y, m))
        return date(y, m, day)
    except Exception:
        return None


def term_label(term) -> str:
    tt = term.term_type or "MONTH_END"
    if tt == "DAYS_AFTER":
        return f"발주 후 {int(term.term_days or 0)}일"
    off = _OFFSET_LABELS.get(int(term.term_month_offset or 0), f"{term.term_month_offset}개월후")
    if tt == "MONTH_END":
        return f"{off} 말일"
    return f"{off} {int(term.term_day or 1)}일"


def vendor_terms_list(db: Session) -> list[dict]:
    rows = db.query(PurchaseVendorTerm).order_by(PurchaseVendorTerm.vendor_name).all()
    return [{
        "id": t.id, "vendor": t.vendor_name, "term_type": t.term_type,
        "term_days": t.term_days, "term_month_offset": t.term_month_offset,
        "term_day": t.term_day, "memo": t.memo, "label": term_label(t),
    } for t in rows]


def upsert_vendor_term(db: Session, data: dict) -> dict:
    vendor = (data.get("vendor") or "").strip()
    if not vendor:
        raise ValueError("거래처명이 필요합니다")
    t = db.query(PurchaseVendorTerm).filter(PurchaseVendorTerm.vendor_name == vendor).first()
    if not t:
        t = PurchaseVendorTerm(vendor_name=vendor)
        db.add(t)
    t.term_type = data.get("term_type") or "MONTH_END"
    if data.get("term_days") is not None:
        t.term_days = int(data["term_days"])
    if data.get("term_month_offset") is not None:
        t.term_month_offset = int(data["term_month_offset"])
    if data.get("term_day") is not None:
        t.term_day = int(data["term_day"])
    t.memo = data.get("memo")
    db.commit(); db.refresh(t)
    return {"id": t.id, "vendor": t.vendor_name, "label": term_label(t)}


def delete_vendor_term(db: Session, tid: int) -> dict:
    t = db.query(PurchaseVendorTerm).get(tid)
    if t:
        db.delete(t); db.commit()
    return {"ok": True}


def payments_list(db: Session, vendor: Optional[str] = None, limit: int = 200) -> list[dict]:
    q = db.query(PurchasePayment)
    if vendor:
        q = q.filter(PurchasePayment.vendor_name == vendor)
    rows = q.order_by(PurchasePayment.pay_date.desc(), PurchasePayment.id.desc()).limit(limit).all()
    return [{
        "id": p.id, "vendor": p.vendor_name,
        "pay_date": p.pay_date.isoformat() if p.pay_date else None,
        "amount": float(p.amount or 0), "method": p.method, "memo": p.memo,
        "created_by": p.created_by,
    } for p in rows]


def add_payment(db: Session, data: dict, user: Optional[str] = None) -> dict:
    vendor = (data.get("vendor") or "").strip()
    if not vendor:
        raise ValueError("거래처명이 필요합니다")
    pd = data.get("pay_date")
    pdt = date.fromisoformat(pd[:10]) if isinstance(pd, str) else (pd or date.today())
    p = PurchasePayment(
        vendor_name=vendor, pay_date=pdt, amount=float(data.get("amount") or 0),
        method=data.get("method"), memo=data.get("memo"), created_by=user,
    )
    db.add(p); db.commit(); db.refresh(p)
    return {"id": p.id}


def delete_payment(db: Session, pid: int) -> dict:
    p = db.query(PurchasePayment).get(pid)
    if p:
        db.delete(p); db.commit()
    return {"ok": True}


def vendor_settle(db: Session, vendor: str, done: bool, amount: float = 0.0,
                  user: Optional[str] = None) -> dict:
    """거래처 '정산완료' 체크 처리. done=True면 잔액만큼 정산완료 지급기록 생성,
    done=False면 이 거래처의 '정산완료' 자동 지급기록만 삭제(수동 지급은 보존)."""
    vendor = (vendor or "").strip()
    if not vendor:
        raise ValueError("거래처명이 필요합니다")
    if done:
        amt = float(amount or 0)
        if amt > 0.5:
            db.add(PurchasePayment(vendor_name=vendor, pay_date=date.today(), amount=amt,
                                   method="정산완료", memo="체크 일괄정산", created_by=user))
    else:
        db.query(PurchasePayment).filter(
            PurchasePayment.vendor_name == vendor,
            PurchasePayment.method == "정산완료",
        ).delete(synchronize_session=False)
    db.commit()
    return {"ok": True}


def _aging_bucket(days_overdue: int) -> str:
    if days_overdue < 0:
        return "미도래"
    if days_overdue == 0:
        return "당일"
    if days_overdue <= 30:
        return "1~30일"
    if days_overdue <= 60:
        return "31~60일"
    if days_overdue <= 90:
        return "61~90일"
    return "90일+"


_BUCKET_ORDER = ["미도래", "당일", "1~30일", "31~60일", "61~90일", "90일+"]


def ap_aging(db: Session, asof: Optional[date] = None, start: Optional[date] = None) -> dict:
    """거래처별 매입채무 잔액 + 계약 정산일 기준 aging + 정산 우선순위.

    매입채무 = purchase_record.total_amount(VAT포함) 합계.
    잔액 = 매입 − 지급(FIFO 오래된 발주부터 상계).
    잔액에 해당하는 (최근) 미지급 발주들의 만기일로 aging 버킷 분류.
    """
    today = asof or date.today()
    terms = {t.vendor_name: t for t in db.query(PurchaseVendorTerm).all()}

    q = db.query(
        PurchaseRecord.vendor_name,
        PurchaseRecord.pdate,
        func.sum(PurchaseRecord.total_amount),
        func.sum(PurchaseRecord.supply_amount),
    ).filter(PurchaseRecord.vendor_name.isnot(None))
    if start:
        q = q.filter(PurchaseRecord.pdate >= start)
    q = q.group_by(PurchaseRecord.vendor_name, PurchaseRecord.pdate)
    rows = q.all()

    by_vendor: dict = {}
    for vname, pd, tot, sup in rows:
        by_vendor.setdefault(vname, []).append({
            "pdate": pd, "total": float(tot or 0), "supply": float(sup or 0),
        })

    pay_rows = db.query(PurchasePayment.vendor_name, func.sum(PurchasePayment.amount)).group_by(
        PurchasePayment.vendor_name).all()
    paid_by_vendor = {v: float(a or 0) for v, a in pay_rows}

    # 평균 지급소요일(발주→지급) 계산용 개별 지급기록.
    # 체크박스 자동정산(method='정산완료')은 지급일=오늘의 합성기록이라 소요일을 왜곡 → 제외.
    pay_detail: dict = {}
    for vn, pdt, amt, mth in db.query(
            PurchasePayment.vendor_name, PurchasePayment.pay_date,
            PurchasePayment.amount, PurchasePayment.method).all():
        if not pdt or (mth == "정산완료"):
            continue
        pay_detail.setdefault(vn, []).append((pdt, float(amt or 0)))

    vendors_out = []
    totals = {"payable": 0.0, "paid": 0.0, "balance": 0.0, "overdue": 0.0}
    _lead_wsum = 0.0   # 전체 가중 평균 지급소요일 누적(일수×금액)
    _lead_wamt = 0.0
    _od_wsum_all = 0.0  # 전체 연체 가중 평균 경과일 누적
    _od_wamt_all = 0.0
    _max_od_all = 0
    bucket_totals = {b: 0.0 for b in _BUCKET_ORDER}

    for vname, buys in by_vendor.items():
        buys.sort(key=lambda x: x["pdate"])
        payable = sum(b["total"] for b in buys)
        paid = paid_by_vendor.get(vname, 0.0)
        balance = max(0.0, payable - paid)
        totals["payable"] += payable
        totals["paid"] += paid
        totals["balance"] += balance

        term = terms.get(vname)
        remaining = balance
        open_items = []
        overdue_amt = 0.0
        earliest_due = None
        max_days_overdue = None      # 잔액 중 가장 오래 연체된 발주의 경과일수
        od_wsum = od_wamt = 0.0      # 연체 금액가중 평균 경과일 계산용
        vbuckets = {b: 0.0 for b in _BUCKET_ORDER}
        for b in reversed(buys):
            if remaining <= 0.5:
                break
            take = min(b["total"], remaining)
            remaining -= take
            due = compute_due_date(b["pdate"], term)
            days_over = (today - due).days if due else None
            bucket = _aging_bucket(days_over) if due is not None else "미설정"
            vbuckets.setdefault(bucket, 0.0)
            vbuckets[bucket] += take
            if bucket in bucket_totals:
                bucket_totals[bucket] += take
            if due is not None and days_over is not None and days_over > 0:
                overdue_amt += take
                od_wsum += days_over * take
                od_wamt += take
                if max_days_overdue is None or days_over > max_days_overdue:
                    max_days_overdue = days_over
            if due is not None and (earliest_due is None or due < earliest_due):
                earliest_due = due
            open_items.append({
                "pdate": b["pdate"].isoformat(),
                "amount": round(take),
                "due": due.isoformat() if due else None,
                "days_overdue": days_over,
                "bucket": bucket,
            })
        totals["overdue"] += overdue_amt
        avg_days_overdue = round(od_wsum / od_wamt) if od_wamt > 0.5 else None
        _od_wsum_all += od_wsum
        _od_wamt_all += od_wamt
        if max_days_overdue and max_days_overdue > _max_od_all:
            _max_od_all = max_days_overdue

        # 평균 지급소요일: 실제 지급기록을 오래된 발주부터 FIFO로 상계, (지급일−발주일) 금액가중 평균.
        avg_pay_days = None
        vpays = sorted(pay_detail.get(vname, []), key=lambda x: x[0])
        if vpays:
            buy_q = [[bb["pdate"], bb["total"]] for bb in buys]  # 오래된 발주부터
            i = 0
            wsum = wamt = 0.0
            for pdt, pamt in vpays:
                rem_pay = pamt
                while rem_pay > 0.5 and i < len(buy_q):
                    bd, brem = buy_q[i]
                    if brem <= 0.5:
                        i += 1; continue
                    chunk = min(brem, rem_pay)
                    days = max(0, (pdt - bd).days)
                    wsum += days * chunk
                    wamt += chunk
                    buy_q[i][1] -= chunk
                    rem_pay -= chunk
                    if buy_q[i][1] <= 0.5:
                        i += 1
            if wamt > 0.5:
                avg_pay_days = round(wsum / wamt)
                _lead_wsum += wsum
                _lead_wamt += wamt
        vendors_out.append({
            "vendor": vname,
            "payable": round(payable),
            "paid": round(paid),
            "balance": round(balance),
            "overdue": round(overdue_amt),
            "term_label": term_label(term) if term else None,
            "has_term": term is not None,
            "earliest_due": earliest_due.isoformat() if earliest_due else None,
            "max_days_overdue": max_days_overdue,
            "avg_days_overdue": avg_days_overdue,
            "avg_pay_days": avg_pay_days,
            "buckets": {k: round(v) for k, v in vbuckets.items() if v > 0.5},
            "open_items": open_items[:12],
        })

    def _prio_key(v):
        due_rank = v["earliest_due"] or "9999-99-99"
        return (-v["overdue"], due_rank, -v["balance"])
    vendors_out.sort(key=_prio_key)
    for i, v in enumerate(vendors_out, 1):
        v["priority"] = i

    totals_out = {k: round(val) for k, val in totals.items()}
    totals_out["avg_pay_days"] = round(_lead_wsum / _lead_wamt) if _lead_wamt > 0.5 else None
    totals_out["avg_days_overdue"] = round(_od_wsum_all / _od_wamt_all) if _od_wamt_all > 0.5 else None
    totals_out["max_days_overdue"] = _max_od_all or None
    totals_out["vendor_count"] = len(vendors_out)
    totals_out["balance_vendor_count"] = sum(1 for v in vendors_out if v["balance"] > 0.5)
    return {
        "asof": today.isoformat(),
        "totals": totals_out,
        "bucket_totals": {k: round(bucket_totals[k]) for k in _BUCKET_ORDER},
        "bucket_order": _BUCKET_ORDER,
        "vendors": vendors_out,
        "unset_vendors": [v["vendor"] for v in vendors_out if not v["has_term"] and v["balance"] > 0.5],
    }


def vendor_orders(db: Session, vendor: str, asof: Optional[date] = None) -> dict:
    """거래처의 발주(일자 그룹) 전체 목록 + 지급상태.

    지급총액을 오래된 발주부터 FIFO로 상계 → 각 발주의 지급/미지급액과
    상태(완료/부분/미지급), 만기·연체경과일을 계산. 표시는 최신 발주 우선.
    """
    today = asof or date.today()
    term = db.query(PurchaseVendorTerm).filter(PurchaseVendorTerm.vendor_name == vendor).first()
    rows = db.query(
        PurchaseRecord.pdate, func.sum(PurchaseRecord.total_amount), func.count(PurchaseRecord.id)
    ).filter(PurchaseRecord.vendor_name == vendor).group_by(PurchaseRecord.pdate).all()
    buys = sorted([{"pdate": pd, "total": float(t or 0), "lines": int(c or 0)}
                   for pd, t, c in rows if pd], key=lambda x: x["pdate"])
    paid_total = float(db.query(func.coalesce(func.sum(PurchasePayment.amount), 0.0)).filter(
        PurchasePayment.vendor_name == vendor).scalar() or 0.0)

    remaining_paid = paid_total
    out = []
    payable = paid_alloc = 0.0
    paid_cnt = partial_cnt = unpaid_cnt = 0
    for b in buys:  # 오래된 발주부터 지급 상계
        pay = min(b["total"], remaining_paid)
        remaining_paid -= pay
        unpaid = b["total"] - pay
        due = compute_due_date(b["pdate"], term)
        days_over = (today - due).days if due else None
        bucket = _aging_bucket(days_over) if due is not None else "미설정"
        if unpaid <= 0.5:
            status = "완료"; paid_cnt += 1
        elif pay <= 0.5:
            status = "미지급"; unpaid_cnt += 1
        else:
            status = "부분"; partial_cnt += 1
        payable += b["total"]; paid_alloc += pay
        out.append({
            "pdate": b["pdate"].isoformat(), "lines": b["lines"],
            "total": round(b["total"]), "paid": round(pay), "unpaid": round(unpaid),
            "due": due.isoformat() if due else None,
            "days_overdue": days_over, "bucket": bucket, "status": status,
        })
    out.reverse()  # 최신 발주 우선 표시
    return {
        "vendor": vendor,
        "term_label": term_label(term) if term else None,
        "order_count": len(out), "paid_count": paid_cnt,
        "partial_count": partial_cnt, "unpaid_count": unpaid_cnt,
        "payable": round(payable), "paid": round(paid_alloc),
        "balance": round(max(0.0, payable - paid_alloc)),
        "orders": out,
    }


# ──────────────────────────────────────────────
# 실적 입력 자동완성(거래처/품목 제안)
# ──────────────────────────────────────────────

def suggest_vendors(db: Session, q: Optional[str] = None, limit: int = 30) -> list[str]:
    """구매일보에 실제 등장한 거래처명 + 거래처 마스터를 합쳐 키워드 제안."""
    names: dict[str, int] = {}
    rows = db.query(PurchaseRecord.vendor_name, func.count(PurchaseRecord.id)).filter(
        PurchaseRecord.vendor_name.isnot(None)).group_by(PurchaseRecord.vendor_name).all()
    for n, c in rows:
        if n and n.strip():
            names[n.strip()] = names.get(n.strip(), 0) + int(c or 0)
    for v in db.query(PurchaseVendor.name).all():
        if v[0] and v[0].strip():
            names.setdefault(v[0].strip(), 0)
    kw = (q or "").strip().lower()
    items = [(n, c) for n, c in names.items() if (not kw or kw in n.lower())]
    items.sort(key=lambda x: (-x[1], x[0]))
    return [n for n, _ in items[:limit]]


def suggest_items(db: Session, q: Optional[str] = None, limit: int = 30) -> list[dict]:
    """구매일보 품목명/코드/단위/최근단가를 키워드로 제안(빈도순)."""
    rows = db.query(
        PurchaseRecord.item_code, PurchaseRecord.item_name, PurchaseRecord.unit,
        PurchaseRecord.mclass, func.count(PurchaseRecord.id),
        func.max(PurchaseRecord.pdate),
    ).filter(PurchaseRecord.item_name.isnot(None)).group_by(
        PurchaseRecord.item_code, PurchaseRecord.item_name, PurchaseRecord.unit, PurchaseRecord.mclass
    ).all()
    kw = (q or "").strip().lower()
    agg: dict = {}
    for code, name, unit, mclass, cnt, last_pd in rows:
        if not name:
            continue
        if kw and kw not in name.lower() and kw not in str(code or "").lower():
            continue
        key = (code, name)
        cur = agg.get(key)
        if not cur:
            agg[key] = {"item_code": code, "item_name": name, "unit": unit,
                        "mclass": mclass, "count": int(cnt or 0), "last": last_pd}
        else:
            cur["count"] += int(cnt or 0)
            if last_pd and (not cur["last"] or last_pd > cur["last"]):
                cur["last"] = last_pd; cur["unit"] = unit
    out = list(agg.values())
    out.sort(key=lambda x: (-x["count"], x["item_name"]))
    result = []
    for it in out[:limit]:
        # 최근 단가 조회
        last_up = db.query(PurchaseRecord.unit_price).filter(
            PurchaseRecord.item_name == it["item_name"]).order_by(
            PurchaseRecord.pdate.desc()).limit(1).scalar()
        spec, kgpu = parse_spec(it["item_name"])
        result.append({
            "item_code": it["item_code"], "item_name": it["item_name"],
            "item_name_short": _SPEC_RE.sub("", it["item_name"]).strip() if spec else it["item_name"],
            "spec": spec, "kg_per_unit": kgpu,
            "unit": it["unit"], "mclass": it["mclass"],
            "last_price": float(last_up or 0), "count": it["count"],
        })
    return result


def add_records_batch(db: Session, common: dict, lines: list[dict], user: Optional[str] = None) -> dict:
    """한 거래처 여러 품목 동시 입력. 공통(거래처·일자·창고·담당·전표No)을 각 라인에 병합."""
    ok, fail, ids, msgs = 0, 0, [], []
    for i, ln in enumerate(lines):
        rec = {**common, **ln}
        res = add_manual_record(db, rec, user=user)
        if res.get("ok"):
            ok += 1; ids.append(res["id"])
        else:
            fail += 1; msgs.append(f"{i + 1}행: {res.get('msg')}")
    return {"ok": fail == 0, "saved": ok, "failed": fail, "ids": ids, "errors": msgs}


# ══════════════════════════════════════════════════════════════
# BOM ↔ 구매관리 매핑/점검 + 마스터 단가 최신구매가 반영
# ══════════════════════════════════════════════════════════════

def _latest_purchase_by_code(db: Session) -> dict:
    """품목코드별 최근(마지막 pdate) 구매 단가·kg환산·거래처·횟수."""
    from sqlalchemy import distinct
    rows = db.query(
        PurchaseRecord.item_code, PurchaseRecord.item_name, PurchaseRecord.unit,
        PurchaseRecord.unit_price, PurchaseRecord.kg_per_unit, PurchaseRecord.vendor_name,
        PurchaseRecord.pdate,
    ).filter(PurchaseRecord.item_code.isnot(None), PurchaseRecord.item_code != "").order_by(
        PurchaseRecord.item_code, PurchaseRecord.pdate.desc(), PurchaseRecord.id.desc()
    ).all()
    cnt: dict = {}
    for r in rows:
        cnt[r.item_code] = cnt.get(r.item_code, 0) + 1
    latest: dict = {}
    for r in rows:
        code = str(r.item_code).strip()
        if code in latest:
            continue
        latest[code] = {
            "item_name": r.item_name, "unit": r.unit, "unit_price": float(r.unit_price or 0),
            "kg_per_unit": r.kg_per_unit, "vendor": r.vendor_name,
            "last_date": r.pdate.isoformat() if r.pdate else None, "buy_count": cnt.get(r.item_code, 0),
        }
    return latest


def bom_purchase_mapping(db: Session) -> dict:
    """BOM 원부재료 ↔ 구매관리(구매일보) 매핑 점검.

    - 매칭키: scm_*.erp_code == purchase_record.item_code
    - 원재료 master=kg_price(kg당), 부자재 master=unit_price(개당)
    - 최신 구매가: 원재료는 kg당(=unit_price/kg_per_unit), 부자재는 개당(unit_price)
    - flags: no_purchase(BOM엔 있으나 구매기록 없음), stale(마스터↔구매 괴리>10%),
      unit_check(원재료 kg환산 정보 없음), unused(BOM 미사용)
    """
    latest = _latest_purchase_by_code(db)
    # BOM 라인 사용 건수(자재별)
    use_cnt: dict = {}
    for (erp, n) in db.query(ScmBomLine.material_erp_code, func.count(ScmBomLine.id)).group_by(
            ScmBomLine.material_erp_code).all():
        if erp:
            use_cnt[str(erp).strip()] = int(n or 0)

    out = []
    for m in db.query(ScmRawMaterial).filter(ScmRawMaterial.is_active.is_(True)).all():
        code = (m.erp_code or "").strip()
        p = latest.get(code)
        master = float(m.kg_price or 0)
        buy_kg = None
        if p and p["unit_price"]:
            buy_kg = (p["unit_price"] / p["kg_per_unit"]) if p["kg_per_unit"] else None
        gap = ((buy_kg - master) / master * 100) if (buy_kg and master) else None
        flags = []
        if not p:
            flags.append("no_purchase")
        elif buy_kg is None:
            flags.append("unit_check")
        elif gap is not None and abs(gap) >= 10:
            flags.append("stale")
        if not use_cnt.get(code):
            flags.append("unused")
        out.append({
            "type": "raw", "material_id": m.id, "erp_code": code, "name": m.name,
            "supplier": m.supplier, "basis": "kg", "master_price": round(master),
            "buy_price": round(buy_kg) if buy_kg else None,
            "buy_unit_price": round(p["unit_price"]) if p else None,
            "buy_unit": p["unit"] if p else None, "kg_per_unit": p["kg_per_unit"] if p else None,
            "gap_pct": round(gap, 1) if gap is not None else None,
            "vendor": p["vendor"] if p else None, "last_date": p["last_date"] if p else None,
            "buy_count": p["buy_count"] if p else 0, "bom_uses": use_cnt.get(code, 0),
            "matched": p is not None, "flags": flags,
        })
    for m in db.query(ScmSubMaterial).filter(ScmSubMaterial.is_active.is_(True)).all():
        code = (m.erp_code or "").strip()
        p = latest.get(code)
        # 롤지형(생산가능수량/롤단가 보유)은 롤당 기준으로 비교(구매도 롤당), 그 외는 개당.
        is_roll = bool((m.producible_qty or 0) > 0 or (m.roll_price or 0) > 0)
        basis = "roll" if is_roll else "ea"
        master = float(m.roll_price or 0) if is_roll else float(m.unit_price or 0)
        buy = p["unit_price"] if p else None   # 구매 단가(롤지=롤당, 그외=개당)
        gap = ((buy - master) / master * 100) if (buy and master) else None
        flags = []
        if not p:
            flags.append("no_purchase")
        elif gap is not None and abs(gap) >= 10:
            flags.append("stale")
        if not use_cnt.get(code):
            flags.append("unused")
        out.append({
            "type": "sub", "material_id": m.id, "erp_code": code, "name": m.name,
            "supplier": m.supplier, "basis": basis, "master_price": round(master),
            "buy_price": round(buy) if buy else None,
            "buy_unit_price": round(buy) if buy else None,
            "buy_unit": p["unit"] if p else None, "kg_per_unit": None,
            "gap_pct": round(gap, 1) if gap is not None else None,
            "vendor": p["vendor"] if p else None, "last_date": p["last_date"] if p else None,
            "buy_count": p["buy_count"] if p else 0, "bom_uses": use_cnt.get(code, 0),
            "matched": p is not None, "flags": flags,
        })

    summ = {
        "total": len(out),
        "matched": sum(1 for x in out if x["matched"]),
        "no_purchase": sum(1 for x in out if "no_purchase" in x["flags"]),
        "stale": sum(1 for x in out if "stale" in x["flags"]),
        "unit_check": sum(1 for x in out if "unit_check" in x["flags"]),
        "unused_used_gap": sum(1 for x in out if "no_purchase" in x["flags"] and x["bom_uses"] > 0),
    }
    # 정렬: BOM에 쓰이는데 구매기록 없음 → 괴리 큰 순 → 나머지
    def _k(x):
        pri = 0 if ("no_purchase" in x["flags"] and x["bom_uses"] > 0) else (1 if "stale" in x["flags"] else 2)
        return (pri, -(abs(x["gap_pct"]) if x["gap_pct"] is not None else 0))
    out.sort(key=_k)
    return {"summary": summ, "items": out}


def bom_sync_prices(db: Session, erp_codes: Optional[list[str]] = None, dry_run: bool = True) -> dict:
    """매칭된 자재의 마스터 단가를 최신 구매가로 반영.
    원재료 kg_price ← 최신 구매 kg당(=unit_price/kg_per_unit), 부자재 unit_price ← 최신 구매 개당.
    erp_codes 지정 시 그 코드만, 없으면 괴리(stale)·kg환산가능한 전체.
    """
    latest = _latest_purchase_by_code(db)
    want = set(str(c).strip() for c in erp_codes) if erp_codes else None
    changed = []
    for m in db.query(ScmRawMaterial).filter(ScmRawMaterial.is_active.is_(True)).all():
        code = (m.erp_code or "").strip()
        if want is not None and code not in want:
            continue
        p = latest.get(code)
        if not p or not p["unit_price"] or not p["kg_per_unit"]:
            continue
        new_kg = round(p["unit_price"] / p["kg_per_unit"])
        old = float(m.kg_price or 0)
        if new_kg and abs(new_kg - old) >= 1:
            changed.append({"type": "raw", "erp_code": code, "name": m.name, "old": round(old), "new": new_kg})
            if not dry_run:
                m.kg_price = new_kg
    for m in db.query(ScmSubMaterial).filter(ScmSubMaterial.is_active.is_(True)).all():
        code = (m.erp_code or "").strip()
        if want is not None and code not in want:
            continue
        p = latest.get(code)
        if not p or not p["unit_price"]:
            continue
        buy = round(p["unit_price"])   # 롤지=롤당, 그외=개당
        is_roll = bool((m.producible_qty or 0) > 0 or (m.roll_price or 0) > 0)
        old = float(m.roll_price or 0) if is_roll else float(m.unit_price or 0)
        if buy and abs(buy - old) >= 1:
            changed.append({"type": "sub", "erp_code": code, "name": m.name, "old": round(old), "new": buy,
                            "basis": "roll" if is_roll else "ea"})
            if not dry_run:
                if is_roll:
                    m.roll_price = buy
                    if (m.producible_qty or 0) > 0:
                        m.unit_price = round(buy / m.producible_qty, 2)   # 개당(cm/m) 재산출
                else:
                    m.unit_price = buy
    if not dry_run:
        db.commit()
    return {"ok": True, "dry_run": dry_run, "changed_count": len(changed), "changed": changed[:200]}
