"""자산형 재고 서비스 (구매관리) — 공장 층별 품목 등록 + 입출고/조정 재고관리.

매출연동 재고(inventory_service)와 완전 분리된 단순 원장형 재고:
  현재고(품목i, 위치l) = Σ purchase_asset_ledger.qty_delta (item_id=i, location_id=l)
자산가치 = 현재고 × 품목 평가단가(unit_cost).
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db_models import (
    PurchaseAssetLocation,
    PurchaseAssetItem,
    PurchaseAssetLedger,
)

_DEFAULT_LOCATIONS = ["공장 1층", "공장 2층", "공장 3층"]


# ──────────────────────────────────────────────
# 위치(층)
# ──────────────────────────────────────────────

def seed_locations(db: Session) -> dict:
    """공장 1/2/3층 기본 위치 생성(이미 있으면 건너뜀)."""
    created = 0
    existing = {l.name for l in db.query(PurchaseAssetLocation).all()}
    for i, name in enumerate(_DEFAULT_LOCATIONS):
        if name in existing:
            continue
        db.add(PurchaseAssetLocation(name=name, sort_order=i, is_active=True))
        created += 1
    db.commit()
    return {"ok": True, "created": created}


def location_list(db: Session, only_active: bool = False) -> list[dict]:
    q = db.query(PurchaseAssetLocation)
    if only_active:
        q = q.filter(PurchaseAssetLocation.is_active.is_(True))
    rows = q.order_by(PurchaseAssetLocation.sort_order, PurchaseAssetLocation.id).all()
    return [{
        "id": l.id, "name": l.name, "sort_order": l.sort_order,
        "is_active": l.is_active, "notes": l.notes,
    } for l in rows]


def upsert_location(db: Session, body: dict) -> dict:
    lid = body.get("id")
    if lid:
        l = db.get(PurchaseAssetLocation, lid)
        if not l:
            raise ValueError("위치 없음")
    else:
        l = PurchaseAssetLocation()
        db.add(l)
    l.name = (body.get("name") or "").strip()
    if not l.name:
        raise ValueError("위치명이 필요합니다")
    l.sort_order = int(body.get("sort_order") or 0)
    l.is_active = bool(body.get("is_active", True))
    l.notes = body.get("notes")
    try:
        db.commit()
    except Exception as e:
        db.rollback()
        raise ValueError(f"저장 실패(중복명?): {e}")
    db.refresh(l)
    return {"id": l.id, "name": l.name}


def delete_location(db: Session, lid: int) -> dict:
    l = db.get(PurchaseAssetLocation, lid)
    if not l:
        raise ValueError("위치 없음")
    has_ledger = db.query(PurchaseAssetLedger.id).filter(
        PurchaseAssetLedger.location_id == lid).first()
    if has_ledger:
        l.is_active = False
        db.commit()
        return {"deactivated": True, "reason": "재고 이동 이력 존재 → 비활성화 처리"}
    db.delete(l)
    db.commit()
    return {"deleted": True}


# ──────────────────────────────────────────────
# 재고 집계 헬퍼
# ──────────────────────────────────────────────

# 총 보유수량에 영향을 주는 이동유형(입고/출고/조정/이동). 고장 관련은 제외.
_DEFECT_MOVE_TYPES = ("defect", "repair")


def _stock_map(db: Session, item_id: Optional[int] = None) -> dict[tuple[int, int], float]:
    """(item_id, location_id) → 총 보유수량. 고장/수리 이동은 총량에 영향 없음(현장 존치)."""
    q = db.query(
        PurchaseAssetLedger.item_id,
        PurchaseAssetLedger.location_id,
        func.coalesce(func.sum(PurchaseAssetLedger.qty_delta), 0.0),
    ).filter(~PurchaseAssetLedger.movement_type.in_(_DEFECT_MOVE_TYPES))
    if item_id is not None:
        q = q.filter(PurchaseAssetLedger.item_id == item_id)
    q = q.group_by(PurchaseAssetLedger.item_id, PurchaseAssetLedger.location_id)
    return {(iid, lid): float(qty or 0) for iid, lid, qty in q.all()}


def _defect_map(db: Session, item_id: Optional[int] = None) -> dict[tuple[int, int], float]:
    """(item_id, location_id) → 현재 고장수량. defect(+)/repair(−) 누계."""
    q = db.query(
        PurchaseAssetLedger.item_id,
        PurchaseAssetLedger.location_id,
        func.coalesce(func.sum(PurchaseAssetLedger.qty_delta), 0.0),
    ).filter(PurchaseAssetLedger.movement_type.in_(_DEFECT_MOVE_TYPES))
    if item_id is not None:
        q = q.filter(PurchaseAssetLedger.item_id == item_id)
    q = q.group_by(PurchaseAssetLedger.item_id, PurchaseAssetLedger.location_id)
    return {(iid, lid): float(qty or 0) for iid, lid, qty in q.all()}


# ──────────────────────────────────────────────
# 품목
# ──────────────────────────────────────────────

def item_list(db: Session, q: Optional[str] = None, category: Optional[str] = None,
              location_id: Optional[int] = None, only_active: bool = True,
              low_only: bool = False) -> dict:
    """품목 목록 + 위치별 현재고 + 총재고 + 자산가치."""
    query = db.query(PurchaseAssetItem)
    if only_active:
        query = query.filter(PurchaseAssetItem.is_active.is_(True))
    if category:
        query = query.filter(PurchaseAssetItem.category == category)
    if q:
        like = f"%{q.strip()}%"
        query = query.filter(
            (PurchaseAssetItem.name.ilike(like)) |
            (PurchaseAssetItem.code.ilike(like)) |
            (PurchaseAssetItem.spec.ilike(like))
        )
    items = query.order_by(PurchaseAssetItem.category, PurchaseAssetItem.name).all()
    locs = location_list(db)
    loc_name = {l["id"]: l["name"] for l in locs}
    smap = _stock_map(db)
    dmap = _defect_map(db)

    rows = []
    for it in items:
        by_loc = {}
        defect_by_loc = {}
        total = 0.0
        defect_total = 0.0
        for (iid, lid), qty in smap.items():
            if iid != it.id:
                continue
            by_loc[lid] = qty
            total += qty
        for (iid, lid), dq in dmap.items():
            if iid != it.id or abs(dq) < 1e-9:
                continue
            defect_by_loc[lid] = dq
            defect_total += dq
        if location_id is not None:
            # 특정 위치 재고만 관심 — 그 위치 재고 0이라도 표기(품목 자체는 유지)
            shown_qty = by_loc.get(location_id, 0.0)
        else:
            shown_qty = total
        below = it.min_qty and total < float(it.min_qty)
        if low_only and not below:
            continue
        rows.append({
            "id": it.id, "code": it.code, "name": it.name, "category": it.category,
            "spec": it.spec, "unit": it.unit, "unit_cost": it.unit_cost,
            "min_qty": it.min_qty, "vendor": it.vendor,
            "default_location_id": it.default_location_id,
            "default_location_name": loc_name.get(it.default_location_id),
            "is_active": it.is_active, "notes": it.notes,
            "stock_by_location": [
                {"location_id": lid, "location_name": loc_name.get(lid, f"#{lid}"),
                 "qty": round(by_loc[lid], 2),
                 "defect_qty": round(defect_by_loc.get(lid, 0.0), 2)}
                for lid in sorted(by_loc.keys(), key=lambda x: (loc_name.get(x) or ""))
                if abs(by_loc[lid]) > 1e-9 or abs(defect_by_loc.get(lid, 0.0)) > 1e-9
            ],
            "total_qty": round(total, 2),
            "shown_qty": round(shown_qty, 2),
            "defect_qty": round(defect_total, 2),
            "good_qty": round(total - defect_total, 2),
            "asset_value": round(total * float(it.unit_cost or 0)),
            "below_min": bool(below),
        })
    return {"rows": rows, "count": len(rows), "locations": locs}


def upsert_item(db: Session, body: dict, user: Optional[str] = None) -> dict:
    iid = body.get("id")
    if iid:
        it = db.get(PurchaseAssetItem, iid)
        if not it:
            raise ValueError("품목 없음")
    else:
        it = PurchaseAssetItem(created_by=user)
        db.add(it)
    it.name = (body.get("name") or "").strip()
    if not it.name:
        raise ValueError("품목명이 필요합니다")
    it.code = (body.get("code") or "").strip() or None
    it.category = (body.get("category") or "").strip() or None
    it.spec = body.get("spec")
    it.unit = (body.get("unit") or "ea").strip() or "ea"
    it.unit_cost = float(body.get("unit_cost") or 0)
    it.min_qty = float(body.get("min_qty") or 0)
    it.default_location_id = body.get("default_location_id")
    it.vendor = body.get("vendor")
    it.is_active = bool(body.get("is_active", True))
    it.notes = body.get("notes")
    try:
        db.commit()
    except Exception as e:
        db.rollback()
        raise ValueError(f"저장 실패(코드 중복?): {e}")
    db.refresh(it)
    return {"id": it.id, "name": it.name}


def delete_item(db: Session, iid: int) -> dict:
    it = db.get(PurchaseAssetItem, iid)
    if not it:
        raise ValueError("품목 없음")
    has_ledger = db.query(PurchaseAssetLedger.id).filter(
        PurchaseAssetLedger.item_id == iid).first()
    if has_ledger:
        it.is_active = False
        db.commit()
        return {"deactivated": True, "reason": "재고 이동 이력 존재 → 비활성화 처리"}
    db.delete(it)
    db.commit()
    return {"deleted": True}


# ──────────────────────────────────────────────
# 재고 이동(입고/출고/조정/이동)
# ──────────────────────────────────────────────

_MOVE_TYPES = {"in", "out", "adjust", "transfer", "defect", "repair", "defect_discard"}


def add_movement(db: Session, body: dict, user: Optional[str] = None) -> dict:
    """입고/출고/조정/이동/고장/수리 기록.
    body: item_id, location_id, movement_date,
          movement_type(in/out/adjust/transfer/defect/repair),
          qty(양수), unit_cost?, reason?, ref?, to_location_id?(transfer 시)
    - in: +qty / out: −qty / adjust: qty를 부호그대로(±) / transfer: 출발 −qty, 도착 +qty
    - defect(고장등록): 총 보유량 불변, 고장수량 +qty (현장 존치)
    - repair(수리완료): 총 보유량 불변, 고장수량 −qty
    - defect_discard(고장폐기): 총 보유량 −qty(반출) + 고장수량 −qty 동시
    """
    item_id = body.get("item_id")
    location_id = body.get("location_id")
    mtype = (body.get("movement_type") or "").strip()
    if not item_id or not db.get(PurchaseAssetItem, item_id):
        raise ValueError("유효한 품목이 필요합니다")
    if not location_id or not db.get(PurchaseAssetLocation, location_id):
        raise ValueError("유효한 위치가 필요합니다")
    if mtype not in _MOVE_TYPES:
        raise ValueError("movement_type은 in/out/adjust/transfer 중 하나여야 합니다")

    try:
        qty = float(body.get("qty") or 0)
    except (TypeError, ValueError):
        raise ValueError("수량이 올바르지 않습니다")
    if qty == 0:
        raise ValueError("수량은 0이 아니어야 합니다")

    mdate = _to_date(body.get("movement_date")) or date.today()
    reason = body.get("reason")
    ref = body.get("ref")
    unit_cost = body.get("unit_cost")
    unit_cost = float(unit_cost) if unit_cost not in (None, "") else None

    ledgers = []
    if mtype == "in":
        ledgers.append(("in", abs(qty), location_id))
    elif mtype == "out":
        ledgers.append(("out", -abs(qty), location_id))
    elif mtype == "adjust":
        # 조정: 입력 부호 그대로(±). 사유 권장.
        ledgers.append(("adjust", qty, location_id))
    elif mtype == "transfer":
        to_loc = body.get("to_location_id")
        if not to_loc or not db.get(PurchaseAssetLocation, to_loc):
            raise ValueError("이동 도착 위치(to_location_id)가 필요합니다")
        if to_loc == location_id:
            raise ValueError("출발/도착 위치가 같습니다")
        ledgers.append(("transfer_out", -abs(qty), location_id))
        ledgers.append(("transfer_in", abs(qty), to_loc))
    elif mtype == "defect":
        # 고장 등록: 총 보유량 불변, 고장수량 +qty
        ledgers.append(("defect", abs(qty), location_id))
    elif mtype == "repair":
        # 수리 완료: 고장수량 −qty (해당 위치 고장수량 초과 방지)
        cur_defect = _defect_map(db, item_id).get((item_id, location_id), 0.0)
        if abs(qty) > cur_defect + 1e-9:
            raise ValueError(f"수리 수량이 현재 고장수량({cur_defect:g})을 초과합니다")
        ledgers.append(("repair", -abs(qty), location_id))
    elif mtype == "defect_discard":
        # 고장폐기: 총 보유량 −qty(반출) + 고장수량 −qty 동시 차감
        cur_defect = _defect_map(db, item_id).get((item_id, location_id), 0.0)
        if abs(qty) > cur_defect + 1e-9:
            raise ValueError(f"폐기 수량이 현재 고장수량({cur_defect:g})을 초과합니다")
        reason = ("[고장폐기] " + (reason or "")).strip()
        ledgers.append(("out", -abs(qty), location_id))
        ledgers.append(("repair", -abs(qty), location_id))

    created_ids = []
    for mt, delta, lid in ledgers:
        row = PurchaseAssetLedger(
            item_id=item_id, location_id=lid, movement_date=mdate,
            movement_type=mt, qty_delta=delta, unit_cost=unit_cost,
            reason=reason, ref=ref, created_by=user,
        )
        db.add(row)
        db.flush()
        created_ids.append(row.id)
    db.commit()
    return {"ok": True, "ids": created_ids}


def ledger_list(db: Session, item_id: Optional[int] = None,
                location_id: Optional[int] = None,
                start: Optional[date] = None, end: Optional[date] = None,
                limit: int = 300) -> dict:
    q = db.query(PurchaseAssetLedger)
    if item_id is not None:
        q = q.filter(PurchaseAssetLedger.item_id == item_id)
    if location_id is not None:
        q = q.filter(PurchaseAssetLedger.location_id == location_id)
    if start:
        q = q.filter(PurchaseAssetLedger.movement_date >= start)
    if end:
        q = q.filter(PurchaseAssetLedger.movement_date <= end)
    total = q.count()
    q = q.order_by(PurchaseAssetLedger.movement_date.desc(),
                   PurchaseAssetLedger.id.desc()).limit(limit)
    items = {i.id: i for i in db.query(PurchaseAssetItem).all()}
    locs = {l.id: l.name for l in db.query(PurchaseAssetLocation).all()}
    rows = [{
        "id": r.id, "item_id": r.item_id,
        "item_name": items[r.item_id].name if r.item_id in items else None,
        "item_unit": items[r.item_id].unit if r.item_id in items else None,
        "location_id": r.location_id, "location_name": locs.get(r.location_id),
        "movement_date": r.movement_date.isoformat() if r.movement_date else None,
        "movement_type": r.movement_type, "qty_delta": r.qty_delta,
        "unit_cost": r.unit_cost, "reason": r.reason, "ref": r.ref,
        "created_by": r.created_by,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    } for r in q.all()]
    return {"rows": rows, "total": total, "shown": len(rows)}


def delete_movement(db: Session, rec_id: int) -> dict:
    n = db.query(PurchaseAssetLedger).filter(PurchaseAssetLedger.id == rec_id).delete()
    db.commit()
    return {"ok": True, "deleted": n}


# ──────────────────────────────────────────────
# 대시보드
# ──────────────────────────────────────────────

def dashboard(db: Session) -> dict:
    """품목수 · 총 자산가치 · 위치별 자산가치 · 안전재고 미달 품목."""
    items = {i.id: i for i in db.query(PurchaseAssetItem).filter(
        PurchaseAssetItem.is_active.is_(True)).all()}
    locs = location_list(db, only_active=False)
    loc_name = {l["id"]: l["name"] for l in locs}
    smap = _stock_map(db)
    dmap = _defect_map(db)

    total_by_item: dict[int, float] = {}
    value_by_loc: dict[int, float] = {}
    for (iid, lid), qty in smap.items():
        it = items.get(iid)
        if not it:
            continue
        total_by_item[iid] = total_by_item.get(iid, 0.0) + qty
        value_by_loc[lid] = value_by_loc.get(lid, 0.0) + qty * float(it.unit_cost or 0)

    defect_by_item: dict[int, float] = {}
    for (iid, lid), dq in dmap.items():
        if iid not in items:
            continue
        defect_by_item[iid] = defect_by_item.get(iid, 0.0) + dq
    defect_total = round(sum(v for v in defect_by_item.values()))
    defect_items = sorted(
        [{"id": iid, "name": items[iid].name, "unit": items[iid].unit,
          "defect_qty": round(dq, 2)}
         for iid, dq in defect_by_item.items() if dq > 1e-9],
        key=lambda x: -x["defect_qty"])

    total_value = sum(t * float(items[i].unit_cost or 0) for i, t in total_by_item.items())
    low = []
    for iid, it in items.items():
        total = total_by_item.get(iid, 0.0)
        if it.min_qty and total < float(it.min_qty):
            low.append({
                "id": iid, "name": it.name, "unit": it.unit,
                "total_qty": round(total, 2), "min_qty": it.min_qty,
                "shortage": round(float(it.min_qty) - total, 2),
            })
    low.sort(key=lambda x: -x["shortage"])

    return {
        "item_count": len(items),
        "total_value": round(total_value),
        "low_count": len(low),
        "low_items": low[:50],
        "defect_total": defect_total,
        "defect_items": defect_items[:50],
        "by_location": [
            {"location_id": l["id"], "location_name": l["name"],
             "value": round(value_by_loc.get(l["id"], 0.0))}
            for l in locs
        ],
        "as_of": date.today().isoformat(),
    }


# ──────────────────────────────────────────────
# 1회용 시딩: 에어커튼 현장 수량 조사표(2026-08-25, 조사자 이선영)
# ──────────────────────────────────────────────

_AIRCURTAIN_CODE = "AC-1200"
_AIRCURTAIN_SURVEY_DATE = "2026-08-25"
_AIRCURTAIN_UNIT_COST = 268000  # 실제 구매단가(2026-08 확인)
# 조사표상 고장(교체필요) 라인: (조사 No., 층, 세부위치, 고장수량)
_AIRCURTAIN_DEFECTS = [
    (4, "공장 1층", "물류 입구", 1),
]
# (조사 No., 층, 세부위치, 설치수량) — 설치완료분만. 추가설치 예정분은 현재고 아님 → 제외.
_AIRCURTAIN_LINES = [
    # 1층 (합 19)
    (1, "공장 1층", "사무실 입구", 2),
    (2, "공장 1층", "사무실 입구", 2),
    (3, "공장 1층", "물류 입구", 4),
    (4, "공장 1층", "물류 입구 (1대 고장·교체필요)", 2),
    (5, "공장 1층", "물류 입구", 4),
    (6, "공장 1층", "신축동 입구", 2),
    (7, "공장 1층", "승강기 입구", 3),
    # 2층 (합 15)
    (8, "공장 2층", "신축동 출입구", 1),
    (9, "공장 2층", "신축동 승강기 출입구", 3),
    (10, "공장 2층", "승강기", 2),
    (11, "공장 2층", "중앙계단", 2),
    (12, "공장 2층", "원재료실", 2),
    (13, "공장 2층", "제조실 입구", 2),
    (14, "공장 2층", "위생전실 퇴실구", 1),
    (15, "공장 2층", "외포장실 입구", 2),
    # 3층 (합 14)
    (16, "공장 3층", "승강기", 2),
    (17, "공장 3층", "중앙계단", 2),
    (18, "공장 3층", "위생전실 퇴실구", 1),
    (19, "공장 3층", "제조실 입구", 2),
    (20, "공장 3층", "원재료실 입구", 2),
    (21, "공장 3층", "방화문 입구", 1),
    (22, "공장 3층", "신축동 승강기 출입구", 3),
    (23, "공장 3층", "신축동 입구", 1),
]


def seed_aircurtain(db: Session, user: Optional[str] = None) -> dict:
    """에어커튼 현장 수량 조사표를 자산형 재고로 1회 등록(멱등).

    - 공장 1/2/3층 위치가 없으면 먼저 생성.
    - 품목 '에어커튼 1200'(code=AC-1200)이 없으면 생성.
    - 각 조사 라인을 입고(in) 원장으로 기록. ref='AC-2026-08-25-No.{n}'.
    - 이미 시딩된 라인(ref 중복)은 건너뜀 → 반복 호출해도 이중 등록 안 됨.
    """
    seed_locations(db)
    loc_by_name = {l.name: l for l in db.query(PurchaseAssetLocation).all()}
    notes = ("에어커튼 현장 수량 조사표(2026-08-25, 조사자 이선영) 기준. "
             "설치완료 48대(1층19·2층15·3층14). 1층 물류입구 1대 고장(교체필요). "
             "추가설치 예정분은 미반영(담당자가 발주 후 입고 처리). "
             "단가 268,000원(실제 구매단가).")

    item = db.query(PurchaseAssetItem).filter(
        PurchaseAssetItem.code == _AIRCURTAIN_CODE).first()
    if not item:
        item = PurchaseAssetItem(
            code=_AIRCURTAIN_CODE,
            name="에어커튼 1200",
            category="설비",
            spec="가로 1200mm",
            unit="대",
            unit_cost=_AIRCURTAIN_UNIT_COST,
            min_qty=2,  # 고장 대비 예비 안전재고(가정)
            default_location_id=(loc_by_name.get("공장 1층").id if loc_by_name.get("공장 1층") else None),
            vendor=None,
            is_active=True,
            notes=notes,
            created_by=user,
        )
        db.add(item)
        db.commit()
        db.refresh(item)
    else:
        # 재호출 시 단가/비고 최신화
        item.unit_cost = _AIRCURTAIN_UNIT_COST
        item.notes = notes
        db.commit()

    existing_refs = {
        r.ref for r in db.query(PurchaseAssetLedger.ref).filter(
            PurchaseAssetLedger.item_id == item.id).all()
        if r.ref
    }
    # 기존 입고 원장 단가도 실제 구매단가로 백필
    db.query(PurchaseAssetLedger).filter(
        PurchaseAssetLedger.item_id == item.id,
        PurchaseAssetLedger.movement_type == "in",
    ).update({PurchaseAssetLedger.unit_cost: _AIRCURTAIN_UNIT_COST},
             synchronize_session=False)
    db.commit()

    mdate = _to_date(_AIRCURTAIN_SURVEY_DATE)
    created = 0
    skipped = 0
    per_floor: dict[str, float] = {}
    for no, floor, sub, qty in _AIRCURTAIN_LINES:
        ref = f"AC-{_AIRCURTAIN_SURVEY_DATE}-No.{no}"
        loc = loc_by_name.get(floor)
        if not loc:
            continue
        per_floor[floor] = per_floor.get(floor, 0.0) + qty
        if ref in existing_refs:
            skipped += 1
            continue
        db.add(PurchaseAssetLedger(
            item_id=item.id, location_id=loc.id, movement_date=mdate,
            movement_type="in", qty_delta=float(qty),
            unit_cost=_AIRCURTAIN_UNIT_COST,
            reason=sub, ref=ref, created_by=user,
        ))
        created += 1
    db.commit()

    # 고장(교체필요) 라인 표기 — 멱등(ref 기준)
    defect_created = 0
    defect_total = 0.0
    for no, floor, sub, dqty in _AIRCURTAIN_DEFECTS:
        ref = f"AC-{_AIRCURTAIN_SURVEY_DATE}-DEFECT-No.{no}"
        loc = loc_by_name.get(floor)
        if not loc:
            continue
        defect_total += dqty
        if ref in existing_refs:
            continue
        db.add(PurchaseAssetLedger(
            item_id=item.id, location_id=loc.id, movement_date=mdate,
            movement_type="defect", qty_delta=float(dqty),
            unit_cost=_AIRCURTAIN_UNIT_COST,
            reason=f"{sub} 고장(교체필요)", ref=ref, created_by=user,
        ))
        defect_created += 1
    db.commit()

    return {
        "ok": True,
        "item_id": item.id,
        "item_name": item.name,
        "unit_cost": _AIRCURTAIN_UNIT_COST,
        "created": created,
        "skipped": skipped,
        "defect_created": defect_created,
        "defect_total": round(defect_total),
        "per_floor": {k: round(v) for k, v in per_floor.items()},
        "total_qty": round(sum(per_floor.values())),
        "already_seeded": created == 0 and skipped > 0,
    }


def _to_date(s) -> Optional[date]:
    if not s:
        return None
    if isinstance(s, date):
        return s
    try:
        return date.fromisoformat(str(s).strip()[:10])
    except Exception:
        return None
