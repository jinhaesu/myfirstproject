"""관리자 전용 라우트 — 보안 게이트 암호 등 전역 설정 관리.

접근 제한: OWNER_EMAIL(기본 lion9080@joinandjoin.com)만 변경 가능.
게이트 검증(verify)은 로그인 사용자면 누구나 호출(암호 입력값 대조).
"""
from __future__ import annotations

import os
import hashlib
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.routes.auth import get_current_user
from app.database import get_db
from app.db_models import AppSetting

router = APIRouter(prefix="/admin", tags=["admin"])

OWNER_EMAIL = os.getenv("OWNER_EMAIL", "lion9080@joinandjoin.com")

# 관리 가능한 보안 게이트 목록 (key → 라벨)
GATES = {
    "bom_access": "BOM·원부재료 접근 암호",
}


def _require_owner(user: dict):
    if (user.get("email") or "").lower() != OWNER_EMAIL.lower():
        raise HTTPException(403, f"관리자({OWNER_EMAIL})만 접근할 수 있습니다")


def _hash(pw: str) -> str:
    return hashlib.sha256(("nuldam$" + (pw or "")).encode("utf-8")).hexdigest()


def _get(db: Session, key: str) -> Optional[str]:
    s = db.get(AppSetting, key)
    return s.value if s else None


def _set(db: Session, key: str, value: str, user: str):
    s = db.get(AppSetting, key)
    if not s:
        s = AppSetting(key=key)
        db.add(s)
    s.value = value
    s.updated_by = user
    db.commit()


@router.get("/whoami")
def whoami(user: dict = Depends(get_current_user)):
    """현재 사용자가 관리자인지."""
    return {"email": user.get("email"), "is_owner": (user.get("email") or "").lower() == OWNER_EMAIL.lower()}


@router.get("/security")
def security_status(db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    """게이트별 암호 설정 여부 (관리자 전용)."""
    _require_owner(user)
    out = []
    for key, label in GATES.items():
        h = _get(db, f"gate_{key}_pwhash")
        s = db.get(AppSetting, f"gate_{key}_pwhash")
        out.append({"key": key, "label": label, "is_set": bool(h),
                    "updated_by": s.updated_by if s else None,
                    "updated_at": s.updated_at.isoformat() if s and s.updated_at else None})
    return {"owner_email": OWNER_EMAIL, "gates": out}


class SetGatePw(BaseModel):
    key: str
    password: str


@router.post("/security/gate-password")
def set_gate_password(body: SetGatePw, db: Session = Depends(get_db),
                      user: dict = Depends(get_current_user)):
    _require_owner(user)
    if body.key not in GATES:
        raise HTTPException(400, "알 수 없는 게이트")
    if not (body.password or "").strip():
        raise HTTPException(400, "암호를 입력하세요")
    _set(db, f"gate_{body.key}_pwhash", _hash(body.password), user.get("email"))
    return {"ok": True, "key": body.key}


class VerifyGate(BaseModel):
    key: str
    password: str


@router.post("/verify-gate")
def verify_gate(body: VerifyGate, db: Session = Depends(get_db),
                user: dict = Depends(get_current_user)):
    """게이트 암호 검증 — 로그인 사용자면 호출 가능. 미설정 게이트는 관리자만 통과."""
    h = _get(db, f"gate_{body.key}_pwhash")
    if not h:
        # 암호 미설정 → 관리자만 자동 통과, 그 외 거부
        return {"ok": (user.get("email") or "").lower() == OWNER_EMAIL.lower(), "not_set": True}
    return {"ok": _hash(body.password) == h}
