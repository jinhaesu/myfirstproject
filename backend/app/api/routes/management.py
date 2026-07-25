"""경영관리 API — 부서 교차 검증 대시보드."""
from __future__ import annotations

from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.services import management_service as mgmt

router = APIRouter(prefix="/management", tags=["management"])


def _pd(s: Optional[str]) -> Optional[date]:
    if not s:
        return None
    try:
        return date.fromisoformat(s.strip()[:10])
    except Exception:
        return None


@router.get("/overview")
def overview(start: str, end: str, db: Session = Depends(get_db)):
    s, e = _pd(start), _pd(end)
    if not s or not e:
        raise HTTPException(400, "start/end 형식 오류")
    return mgmt.overview(db, s, e)


@router.get("/trend")
def trend(start: str, end: str, granularity: str = "month", db: Session = Depends(get_db)):
    s, e = _pd(start), _pd(end)
    if not s or not e:
        raise HTTPException(400, "start/end 형식 오류")
    return mgmt.trend(db, s, e, granularity=granularity)


@router.get("/labor-trend")
def labor_trend(start: str, end: str, granularity: str = "month", db: Session = Depends(get_db)):
    s, e = _pd(start), _pd(end)
    if not s or not e:
        raise HTTPException(400, "start/end 형식 오류")
    return mgmt.labor_trend(db, s, e, granularity=granularity)
