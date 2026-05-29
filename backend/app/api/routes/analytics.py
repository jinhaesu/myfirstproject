"""성과 분석 대시보드 API — 자동 관리 룰, 스케줄 리포트"""
import uuid
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends, BackgroundTasks
from pydantic import BaseModel
from sqlalchemy.orm import Session
import anthropic

from app.api.routes.auth import get_current_user
from app.database import get_db
from app.config import get_settings
from app.models.auto_rule import AutoRule, AutoRuleLog
from app.models.scheduled_report import ScheduledReport
from app.services.meta_ads_service import MetaAdsService
from app.services.rule_engine import run_rules

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/analytics", tags=["analytics"])

# ─── 마지막 자동 실행 시간 (메모리 throttle) ───
_last_auto_run: dict[str, datetime] = {}


def _meta_service() -> MetaAdsService:
    return MetaAdsService()


# ═══════════════════════════════════════════════
#  계정 개요 (overview)
# ═══════════════════════════════════════════════

@router.get("/account-overview")
async def account_overview(
    date_preset: str = "last_7d",
    background_tasks: BackgroundTasks = None,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Meta 광고 계정 개요 + 백그라운드 룰/스케줄 실행"""
    meta = _meta_service()
    overview = await meta.get_account_overview(date_preset)
    campaigns = await meta.get_campaigns(date_preset)

    # 백그라운드 자동 실행 (1시간 throttle)
    user_id = current_user["email"]
    now = datetime.now(timezone.utc)
    last = _last_auto_run.get(user_id)
    if background_tasks and (not last or (now - last).total_seconds() > 3600):
        _last_auto_run[user_id] = now
        background_tasks.add_task(_bg_run_rules, user_id)
        background_tasks.add_task(_bg_run_schedules, user_id)

    return {"overview": overview, "campaigns": campaigns}


async def _bg_run_rules(user_id: str):
    """백그라운드 룰 실행"""
    from app.database import SessionLocal
    if not SessionLocal:
        return
    db = SessionLocal()
    try:
        meta = _meta_service()
        await run_rules(db, user_id, meta)
    except Exception as e:
        logger.error(f"Background rule run failed: {e}")
    finally:
        db.close()


async def _bg_run_schedules(user_id: str):
    """due 스케줄 리포트 실행"""
    from app.database import SessionLocal
    if not SessionLocal:
        return
    db = SessionLocal()
    try:
        now = datetime.now(timezone.utc)
        schedules = db.query(ScheduledReport).filter(
            ScheduledReport.user_id == user_id,
            ScheduledReport.enabled == True,
            (ScheduledReport.next_run_at == None) | (ScheduledReport.next_run_at <= now),
        ).all()
        for sched in schedules:
            sched.last_run_at = now
            sched.next_run_at = _calc_next_run(sched)
            # 여기서 리포트 생성/이메일 발송 로직 추가 가능
        db.commit()
    except Exception as e:
        logger.error(f"Background schedule run failed: {e}")
    finally:
        db.close()


def _calc_next_run(sched: ScheduledReport) -> datetime:
    now = datetime.now(timezone.utc)
    if sched.schedule_type == "weekly":
        days_ahead = (sched.day_of_week or 0) - now.weekday()
        if days_ahead <= 0:
            days_ahead += 7
        return now.replace(hour=9, minute=0, second=0, microsecond=0) + timedelta(days=days_ahead)
    else:  # monthly
        dom = sched.day_of_month or 1
        next_month = now.month + 1 if now.day >= dom else now.month
        next_year = now.year + (1 if next_month > 12 else 0)
        next_month = next_month if next_month <= 12 else next_month - 12
        return datetime(next_year, next_month, dom, 9, 0, 0, tzinfo=timezone.utc)


# ═══════════════════════════════════════════════
#  자동 관리 룰 CRUD
# ═══════════════════════════════════════════════

class RuleCreate(BaseModel):
    name: str
    metric: str
    operator: str
    threshold: float
    duration_type: str = "any"
    duration_value: Optional[int] = None
    secondary_metric: Optional[str] = None
    secondary_operator: Optional[str] = None
    secondary_threshold: Optional[float] = None
    action: str
    action_value: Optional[float] = None
    target_type: str = "campaign"
    target_id: Optional[str] = None
    target_name: Optional[str] = None


class RuleUpdate(BaseModel):
    name: Optional[str] = None
    metric: Optional[str] = None
    operator: Optional[str] = None
    threshold: Optional[float] = None
    duration_type: Optional[str] = None
    duration_value: Optional[int] = None
    secondary_metric: Optional[str] = None
    secondary_operator: Optional[str] = None
    secondary_threshold: Optional[float] = None
    action: Optional[str] = None
    action_value: Optional[float] = None
    target_type: Optional[str] = None
    target_id: Optional[str] = None
    target_name: Optional[str] = None
    enabled: Optional[bool] = None


@router.get("/rules")
async def list_rules(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rules = db.query(AutoRule).filter(AutoRule.user_id == current_user["email"]).order_by(AutoRule.created_at.desc()).all()
    return [_rule_to_dict(r) for r in rules]


@router.post("/rules")
async def create_rule(
    data: RuleCreate,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rule = AutoRule(id=str(uuid.uuid4()), user_id=current_user["email"], **data.model_dump())
    db.add(rule)
    db.commit()
    db.refresh(rule)
    return _rule_to_dict(rule)


@router.put("/rules/{rule_id}")
async def update_rule(
    rule_id: str,
    data: RuleUpdate,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rule = db.query(AutoRule).filter(AutoRule.id == rule_id, AutoRule.user_id == current_user["email"]).first()
    if not rule:
        raise HTTPException(404, "룰을 찾을 수 없습니다")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(rule, k, v)
    db.commit()
    db.refresh(rule)
    return _rule_to_dict(rule)


@router.delete("/rules/{rule_id}")
async def delete_rule(
    rule_id: str,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rule = db.query(AutoRule).filter(AutoRule.id == rule_id, AutoRule.user_id == current_user["email"]).first()
    if not rule:
        raise HTTPException(404, "룰을 찾을 수 없습니다")
    db.delete(rule)
    db.commit()
    return {"message": "삭제되었습니다"}


# ─── 룰 실행 ───

@router.post("/rules/execute")
async def execute_rules(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """수동 룰 실행"""
    meta = _meta_service()
    results = await run_rules(db, current_user["email"], meta)
    return {"executed": len(results), "logs": results}


# ─── 실행 기록 ───

@router.get("/rules/logs")
async def get_rule_logs(
    limit: int = 50,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    logs = (
        db.query(AutoRuleLog)
        .filter(AutoRuleLog.user_id == current_user["email"])
        .order_by(AutoRuleLog.triggered_at.desc())
        .limit(limit)
        .all()
    )
    return [_log_to_dict(l) for l in logs]


# ─── AI 추천 ───

class AIRecommendRequest(BaseModel):
    overview: Optional[dict] = None
    campaigns: Optional[list] = None


@router.post("/rules/ai-recommend")
async def ai_recommend_rules(
    body: AIRecommendRequest,
    current_user: dict = Depends(get_current_user),
):
    """계정 데이터 기반 AI 룰 추천"""
    settings = get_settings()
    client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)

    overview_str = str(body.overview or {})
    campaigns_str = str(body.campaigns[:10] if body.campaigns else [])

    prompt = f"""당신은 Meta(Facebook) 광고 성과 최적화 전문가입니다.

아래 광고 계정 데이터를 분석하여 자동 관리 룰 3~5개를 JSON 배열로 추천해주세요.

## 계정 개요
{overview_str}

## 캠페인 목록 (상위 10개)
{campaigns_str}

## 룰 형식 (JSON 배열)
각 룰은 다음 필드를 포함합니다:
- name: 룰 이름 (한국어)
- metric: cpc | ctr | roas | cvr | cpm | spend | frequency
- operator: gt | lt | gte | lte
- threshold: 숫자
- duration_type: any | consecutive_days | total_days
- duration_value: 일수 (any일 경우 null)
- action: pause | decrease_budget | increase_budget
- action_value: 예산 변경 비율(%), pause일 경우 null
- target_type: campaign | adset | ad
- reason: 추천 이유 (한국어, 1문장)

JSON 배열만 반환하세요. 마크다운 코드블록 없이 순수 JSON만 출력하세요."""

    try:
        message = client.messages.create(
            model="claude-opus-4-8",
            max_tokens=1024,
            messages=[{"role": "user", "content": prompt}],
        )
        import json
        text = message.content[0].text.strip()
        # JSON 파싱 시도
        if text.startswith("```"):
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
        recommendations = json.loads(text)
        return {"recommendations": recommendations}
    except Exception as e:
        raise HTTPException(500, f"AI 추천 생성 실패: {str(e)}")


# ═══════════════════════════════════════════════
#  스케줄 리포트 CRUD
# ═══════════════════════════════════════════════

class ScheduleCreate(BaseModel):
    name: str
    schedule_type: str  # weekly, monthly
    day_of_week: Optional[int] = None
    day_of_month: Optional[int] = None
    meta_campaign_id: Optional[str] = None
    lookback_days: int = 7
    email_to: Optional[str] = None


class ScheduleUpdate(BaseModel):
    name: Optional[str] = None
    schedule_type: Optional[str] = None
    day_of_week: Optional[int] = None
    day_of_month: Optional[int] = None
    meta_campaign_id: Optional[str] = None
    lookback_days: Optional[int] = None
    email_to: Optional[str] = None
    enabled: Optional[bool] = None


@router.get("/schedules")
async def list_schedules(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    items = db.query(ScheduledReport).filter(
        ScheduledReport.user_id == current_user["email"]
    ).order_by(ScheduledReport.created_at.desc()).all()
    return [_sched_to_dict(s) for s in items]


@router.post("/schedules")
async def create_schedule(
    data: ScheduleCreate,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    sched = ScheduledReport(
        id=str(uuid.uuid4()),
        user_id=current_user["email"],
        **data.model_dump(),
    )
    sched.next_run_at = _calc_next_run(sched)
    db.add(sched)
    db.commit()
    db.refresh(sched)
    return _sched_to_dict(sched)


@router.put("/schedules/{schedule_id}")
async def update_schedule(
    schedule_id: str,
    data: ScheduleUpdate,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    sched = db.query(ScheduledReport).filter(
        ScheduledReport.id == schedule_id, ScheduledReport.user_id == current_user["email"]
    ).first()
    if not sched:
        raise HTTPException(404, "스케줄을 찾을 수 없습니다")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(sched, k, v)
    sched.next_run_at = _calc_next_run(sched)
    db.commit()
    db.refresh(sched)
    return _sched_to_dict(sched)


@router.delete("/schedules/{schedule_id}")
async def delete_schedule(
    schedule_id: str,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    sched = db.query(ScheduledReport).filter(
        ScheduledReport.id == schedule_id, ScheduledReport.user_id == current_user["email"]
    ).first()
    if not sched:
        raise HTTPException(404, "스케줄을 찾을 수 없습니다")
    db.delete(sched)
    db.commit()
    return {"message": "삭제되었습니다"}


# ═══════════════════════════════════════════════
#  직렬화 헬퍼
# ═══════════════════════════════════════════════

def _rule_to_dict(r: AutoRule) -> dict:
    return {
        "id": r.id, "name": r.name, "metric": r.metric,
        "operator": r.operator, "threshold": r.threshold,
        "duration_type": r.duration_type, "duration_value": r.duration_value,
        "secondary_metric": r.secondary_metric, "secondary_operator": r.secondary_operator,
        "secondary_threshold": r.secondary_threshold,
        "action": r.action, "action_value": r.action_value,
        "target_type": r.target_type, "target_id": r.target_id, "target_name": r.target_name,
        "enabled": r.enabled, "times_triggered": r.times_triggered,
        "last_checked_at": r.last_checked_at.isoformat() if r.last_checked_at else None,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    }


def _log_to_dict(l: AutoRuleLog) -> dict:
    return {
        "id": l.id, "rule_id": l.rule_id,
        "action_taken": l.action_taken, "target_type": l.target_type,
        "target_id": l.target_id, "target_name": l.target_name,
        "metric_name": l.metric_name, "metric_value": l.metric_value,
        "threshold_value": l.threshold_value, "details": l.details,
        "triggered_at": l.triggered_at.isoformat() if l.triggered_at else None,
    }


def _sched_to_dict(s: ScheduledReport) -> dict:
    return {
        "id": s.id, "name": s.name,
        "schedule_type": s.schedule_type,
        "day_of_week": s.day_of_week, "day_of_month": s.day_of_month,
        "meta_campaign_id": s.meta_campaign_id,
        "lookback_days": s.lookback_days, "email_to": s.email_to,
        "enabled": s.enabled,
        "last_run_at": s.last_run_at.isoformat() if s.last_run_at else None,
        "next_run_at": s.next_run_at.isoformat() if s.next_run_at else None,
        "created_at": s.created_at.isoformat() if s.created_at else None,
    }
