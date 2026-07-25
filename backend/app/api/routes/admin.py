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
from app.db_models import AppSetting, UserDirectory, UserMenuPermission
from app.services.auth_service import AuthService

router = APIRouter(prefix="/admin", tags=["admin"])

OWNER_EMAIL = os.getenv("OWNER_EMAIL", "lion9080@joinandjoin.com")

# 관리 가능한 보안 게이트 목록 (key → 라벨)
GATES = {
    "bom_access": "BOM·원부재료 접근 암호",
}

# 조회 권한을 부여할 수 있는 메뉴(그룹) 목록. 프론트 navGroups.key와 1:1.
MENUS = [
    {"key": "sales", "label": "영업부 매출 관리·분석"},
    {"key": "scm", "label": "SCM 관리"},
    {"key": "logistics", "label": "물류·생산 관리"},
    {"key": "mapping", "label": "매핑 관리"},
    {"key": "purchase", "label": "구매 관리"},
    {"key": "management", "label": "경영관리"},
    {"key": "cs", "label": "CS 관리"},
]
MENU_KEYS = {m["key"] for m in MENUS}
DEFAULT_MENUS = ["sales"]   # 기본: 영업부 매출관리만


def _menus_for(db: Session, email: str) -> list[str]:
    """이메일의 조회 가능 메뉴 키. 오너=전체, 미등록=기본(sales)."""
    if (email or "").lower() == OWNER_EMAIL.lower():
        return [m["key"] for m in MENUS]
    p = db.get(UserMenuPermission, email)
    if p and (p.menu_keys or "").strip():
        return [k for k in p.menu_keys.split(",") if k in MENU_KEYS]
    return list(DEFAULT_MENUS)


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


# ──────────────────────────────────────────────
# 이메일별 메뉴 조회 권한
# ──────────────────────────────────────────────

@router.get("/my-menus")
def my_menus(db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    """현재 사용자가 볼 수 있는 메뉴 키 목록(프론트 나브 게이팅용)."""
    email = user.get("email") or ""
    return {
        "email": email,
        "is_owner": email.lower() == OWNER_EMAIL.lower(),
        "menus": _menus_for(db, email),
        "all_menus": MENUS,
    }


@router.get("/users")
def list_users(db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    """로그인 이메일 목록 + 각 이메일의 메뉴 권한 (관리자 전용)."""
    _require_owner(user)
    # 디렉토리(로그인 기록) + USERS_JSON 등록자 합집합
    dir_rows = {u.email: u for u in db.query(UserDirectory).all()}
    perms = {p.email: p for p in db.query(UserMenuPermission).all()}
    emails = set(dir_rows.keys())
    try:
        for u in AuthService().users:
            if u.get("email"):
                emails.add(u["email"])
    except Exception:
        pass
    out = []
    for em in sorted(emails):
        d = dir_rows.get(em)
        is_owner = em.lower() == OWNER_EMAIL.lower()
        p = perms.get(em)
        menus = ([m["key"] for m in MENUS] if is_owner else
                 ([k for k in (p.menu_keys or "").split(",") if k in MENU_KEYS] if p and (p.menu_keys or "").strip() else list(DEFAULT_MENUS)))
        out.append({
            "email": em, "name": d.name if d else (em.split("@")[0]),
            "department": getattr(d, "department", None) if d else None,
            "is_owner": is_owner,
            "in_directory": bool(d),
            "last_login": d.last_login.isoformat() if d and d.last_login else None,
            "login_count": d.login_count if d else 0,
            "menus": menus,
            "custom": bool(p and (p.menu_keys or "").strip()),
        })
    # 로그인 이력 있는 계정(디렉토리) 우선 정렬
    out.sort(key=lambda x: (not x["in_directory"], x["email"]))
    return {"owner_email": OWNER_EMAIL, "all_menus": MENUS, "users": out}


class UserProfile(BaseModel):
    email: str
    name: Optional[str] = None
    department: Optional[str] = None


@router.post("/users/profile")
def set_user_profile(body: UserProfile, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    """이메일별 이름·부서 지정 (관리자 전용). 디렉토리에 없으면 생성."""
    _require_owner(user)
    email = (body.email or "").strip()
    if not email:
        raise HTTPException(400, "이메일 필요")
    d = db.get(UserDirectory, email)
    if not d:
        d = UserDirectory(email=email, login_count=0)
        db.add(d)
    if body.name is not None:
        d.name = body.name.strip() or None
    if body.department is not None:
        d.department = body.department.strip() or None
    db.commit()
    return {"ok": True, "email": email, "name": d.name, "department": d.department}


class SetPerm(BaseModel):
    email: str
    menu_keys: list[str]


@router.post("/users/permissions")
def set_permissions(body: SetPerm, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    """이메일별 메뉴 조회 권한 설정 (관리자 전용)."""
    _require_owner(user)
    email = (body.email or "").strip()
    if not email:
        raise HTTPException(400, "이메일 필요")
    keys = [k for k in body.menu_keys if k in MENU_KEYS]
    p = db.get(UserMenuPermission, email)
    if not p:
        p = UserMenuPermission(email=email)
        db.add(p)
    p.menu_keys = ",".join(keys)
    p.updated_by = user.get("email")
    db.commit()
    return {"ok": True, "email": email, "menus": keys}
