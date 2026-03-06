from datetime import datetime, timedelta, timezone
from uuid import uuid4
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.routes.auth import get_current_user
from app.database import get_db
from app.models.keyword_monitor import MonitoredKeyword, KeywordMetrics, KeywordSentiment
from app.services.keyword_monitor_service import KeywordMonitorService


router = APIRouter(prefix="/market-analysis", tags=["market-analysis"])


# === Pydantic 스키마 ===

class KeywordCreate(BaseModel):
    keyword: str
    category: Optional[str] = None


class KeywordUpdate(BaseModel):
    enabled: Optional[bool] = None
    category: Optional[str] = None


# === 의존성 ===

def get_keyword_monitor_service() -> KeywordMonitorService:
    return KeywordMonitorService()


# === 키워드 CRUD ===

@router.get("/keywords")
async def list_keywords(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """사용자의 모니터링 키워드 목록 조회"""
    keywords = db.query(MonitoredKeyword).filter(
        MonitoredKeyword.user_id == current_user["email"]
    ).order_by(MonitoredKeyword.created_at.desc()).all()

    return [
        {
            "id": kw.id,
            "keyword": kw.keyword,
            "category": kw.category,
            "enabled": kw.enabled,
            "created_at": kw.created_at.isoformat() if kw.created_at else None,
            "updated_at": kw.updated_at.isoformat() if kw.updated_at else None,
        }
        for kw in keywords
    ]


@router.post("/keywords")
async def create_keyword(
    data: KeywordCreate,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """새 모니터링 키워드 생성"""
    keyword = MonitoredKeyword(
        id=str(uuid4()),
        user_id=current_user["email"],
        keyword=data.keyword,
        category=data.category,
        enabled=True,
    )
    db.add(keyword)
    db.commit()
    db.refresh(keyword)

    return {
        "id": keyword.id,
        "keyword": keyword.keyword,
        "category": keyword.category,
        "enabled": keyword.enabled,
        "created_at": keyword.created_at.isoformat() if keyword.created_at else None,
    }


@router.put("/keywords/{keyword_id}")
async def update_keyword(
    keyword_id: str,
    data: KeywordUpdate,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """키워드 수정 (enabled, category)"""
    keyword = db.query(MonitoredKeyword).filter(
        MonitoredKeyword.id == keyword_id,
        MonitoredKeyword.user_id == current_user["email"],
    ).first()

    if not keyword:
        raise HTTPException(status_code=404, detail="키워드를 찾을 수 없습니다")

    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(keyword, key, value)

    db.commit()
    db.refresh(keyword)

    return {
        "id": keyword.id,
        "keyword": keyword.keyword,
        "category": keyword.category,
        "enabled": keyword.enabled,
        "updated_at": keyword.updated_at.isoformat() if keyword.updated_at else None,
    }


@router.delete("/keywords/{keyword_id}")
async def delete_keyword(
    keyword_id: str,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """키워드 삭제 (메트릭, 감성 분석 데이터 함께 삭제)"""
    keyword = db.query(MonitoredKeyword).filter(
        MonitoredKeyword.id == keyword_id,
        MonitoredKeyword.user_id == current_user["email"],
    ).first()

    if not keyword:
        raise HTTPException(status_code=404, detail="키워드를 찾을 수 없습니다")

    # 연관 데이터 삭제
    db.query(KeywordMetrics).filter(KeywordMetrics.keyword_id == keyword_id).delete()
    db.query(KeywordSentiment).filter(KeywordSentiment.keyword_id == keyword_id).delete()
    db.delete(keyword)
    db.commit()

    return {"message": "삭제되었습니다"}


# === 데이터 수집 ===

@router.post("/keywords/{keyword_id}/collect")
async def collect_keyword_data(
    keyword_id: str,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
    service: KeywordMonitorService = Depends(get_keyword_monitor_service),
):
    """수동 데이터 수집 트리거"""
    keyword = db.query(MonitoredKeyword).filter(
        MonitoredKeyword.id == keyword_id,
        MonitoredKeyword.user_id == current_user["email"],
    ).first()

    if not keyword:
        raise HTTPException(status_code=404, detail="키워드를 찾을 수 없습니다")

    try:
        results = await service.collect_all_metrics(keyword_id, db)
        return {"message": "데이터 수집이 완료되었습니다", "results": results}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"데이터 수집 중 오류 발생: {str(e)}")


# === 메트릭 조회 ===

@router.get("/keywords/{keyword_id}/metrics")
async def get_keyword_metrics(
    keyword_id: str,
    platform: Optional[str] = Query(None, description="플랫폼 필터 (instagram, youtube, naver_blog)"),
    days: int = Query(30, description="조회 기간 (일)"),
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """키워드 메트릭 시계열 데이터 조회"""
    # 키워드 소유권 확인
    keyword = db.query(MonitoredKeyword).filter(
        MonitoredKeyword.id == keyword_id,
        MonitoredKeyword.user_id == current_user["email"],
    ).first()

    if not keyword:
        raise HTTPException(status_code=404, detail="키워드를 찾을 수 없습니다")

    since = datetime.now(timezone.utc) - timedelta(days=days)

    query = db.query(KeywordMetrics).filter(
        KeywordMetrics.keyword_id == keyword_id,
        KeywordMetrics.date >= since,
    )

    if platform:
        query = query.filter(KeywordMetrics.platform == platform)

    metrics = query.order_by(KeywordMetrics.date.asc()).all()

    return [
        {
            "id": m.id,
            "platform": m.platform,
            "date": m.date.isoformat() if m.date else None,
            "content_count": m.content_count,
            "view_count": m.view_count,
            "hashtags": m.hashtags,
            "search_volume": m.search_volume,
        }
        for m in metrics
    ]


# === 감성 분석 조회 ===

@router.get("/keywords/{keyword_id}/sentiment")
async def get_keyword_sentiment(
    keyword_id: str,
    platform: Optional[str] = Query(None, description="플랫폼 필터"),
    days: int = Query(30, description="조회 기간 (일)"),
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """키워드 감성 분석 데이터 조회"""
    keyword = db.query(MonitoredKeyword).filter(
        MonitoredKeyword.id == keyword_id,
        MonitoredKeyword.user_id == current_user["email"],
    ).first()

    if not keyword:
        raise HTTPException(status_code=404, detail="키워드를 찾을 수 없습니다")

    since = datetime.now(timezone.utc) - timedelta(days=days)

    query = db.query(KeywordSentiment).filter(
        KeywordSentiment.keyword_id == keyword_id,
        KeywordSentiment.date >= since,
    )

    if platform:
        query = query.filter(KeywordSentiment.platform == platform)

    sentiments = query.order_by(KeywordSentiment.date.desc()).all()

    return [
        {
            "id": s.id,
            "platform": s.platform,
            "date": s.date.isoformat() if s.date else None,
            "positive_ratio": s.positive_ratio,
            "negative_ratio": s.negative_ratio,
            "neutral_ratio": s.neutral_ratio,
            "positive_keywords": s.positive_keywords,
            "negative_keywords": s.negative_keywords,
            "sample_size": s.sample_size,
        }
        for s in sentiments
    ]


# === 비교 분석 ===

@router.get("/compare")
async def compare_keywords(
    keyword_ids: str = Query(..., description="콤마로 구분된 키워드 ID 목록"),
    platform: Optional[str] = Query(None, description="플랫폼 필터"),
    days: int = Query(30, description="조회 기간 (일)"),
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """여러 키워드의 메트릭 비교"""
    ids = [kid.strip() for kid in keyword_ids.split(",") if kid.strip()]

    if not ids:
        raise HTTPException(status_code=400, detail="키워드 ID를 지정해주세요")

    # 소유권 확인
    keywords = db.query(MonitoredKeyword).filter(
        MonitoredKeyword.id.in_(ids),
        MonitoredKeyword.user_id == current_user["email"],
    ).all()

    if len(keywords) != len(ids):
        raise HTTPException(status_code=404, detail="일부 키워드를 찾을 수 없습니다")

    since = datetime.now(timezone.utc) - timedelta(days=days)
    result = {}

    for kw in keywords:
        query = db.query(KeywordMetrics).filter(
            KeywordMetrics.keyword_id == kw.id,
            KeywordMetrics.date >= since,
        )

        if platform:
            query = query.filter(KeywordMetrics.platform == platform)

        metrics = query.order_by(KeywordMetrics.date.asc()).all()

        result[kw.id] = {
            "keyword": kw.keyword,
            "category": kw.category,
            "metrics": [
                {
                    "platform": m.platform,
                    "date": m.date.isoformat() if m.date else None,
                    "content_count": m.content_count,
                    "view_count": m.view_count,
                    "search_volume": m.search_volume,
                }
                for m in metrics
            ],
        }

    return result
