"""AI 캠페인 기획 API — 기획서 생성, 소재 브리프, Meta 드래프트 캠페인"""
import uuid
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.routes.auth import get_current_user
from app.database import get_db
from app.models.campaign_plan import CampaignPlan
from app.services.campaign_planner_service import CampaignPlannerService

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/campaign-planner", tags=["campaign-planner"])


def _planner_service() -> CampaignPlannerService:
    return CampaignPlannerService()


# ═══════════════════════════════════════════════
#  Pydantic 스키마
# ═══════════════════════════════════════════════

class GeneratePlanRequest(BaseModel):
    product_name: str
    product_url: Optional[str] = None
    product_description: Optional[str] = None
    campaign_goal: str  # awareness, traffic, conversions, app_installs, leads
    reference_urls: Optional[list[str]] = None
    product_image_urls: Optional[list[str]] = None
    additional_notes: Optional[str] = None


# ═══════════════════════════════════════════════
#  직렬화 헬퍼
# ═══════════════════════════════════════════════

def _plan_to_dict(p: CampaignPlan) -> dict:
    return {
        "id": p.id,
        "user_id": p.user_id,
        "product_name": p.product_name,
        "product_url": p.product_url,
        "product_description": p.product_description,
        "campaign_goal": p.campaign_goal,
        "reference_urls": p.reference_urls,
        "product_image_urls": p.product_image_urls,
        "additional_notes": p.additional_notes,
        "ai_plan": p.ai_plan,
        "creative_brief": p.creative_brief,
        "meta_campaign_id": p.meta_campaign_id,
        "meta_adset_id": p.meta_adset_id,
        "status": p.status,
        "created_at": p.created_at.isoformat() if p.created_at else None,
        "updated_at": p.updated_at.isoformat() if p.updated_at else None,
    }


# ═══════════════════════════════════════════════
#  기획서 생성
# ═══════════════════════════════════════════════

@router.post("/generate-plan")
async def generate_plan(
    data: GeneratePlanRequest,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """AI 캠페인 기획서 생성"""
    service = _planner_service()

    try:
        ai_plan = await service.generate_plan(
            product_name=data.product_name,
            product_url=data.product_url,
            product_description=data.product_description,
            campaign_goal=data.campaign_goal,
            reference_urls=data.reference_urls,
            additional_notes=data.additional_notes,
        )
    except Exception as e:
        logger.error(f"AI 기획 생성 실패: {e}")
        raise HTTPException(500, f"AI 기획 생성에 실패했습니다: {str(e)}")

    # DB 저장
    plan = CampaignPlan(
        id=str(uuid.uuid4()),
        user_id=current_user["email"],
        product_name=data.product_name,
        product_url=data.product_url,
        product_description=data.product_description,
        campaign_goal=data.campaign_goal,
        reference_urls=data.reference_urls,
        product_image_urls=data.product_image_urls,
        additional_notes=data.additional_notes,
        ai_plan=ai_plan,
        status="planned",
    )
    db.add(plan)
    db.commit()
    db.refresh(plan)

    return _plan_to_dict(plan)


# ═══════════════════════════════════════════════
#  소재 제작 브리프 생성
# ═══════════════════════════════════════════════

@router.post("/plans/{plan_id}/generate-creative")
async def generate_creative_brief(
    plan_id: str,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """기존 기획서 기반 소재 제작 브리프 생성"""
    plan = db.query(CampaignPlan).filter(
        CampaignPlan.id == plan_id,
        CampaignPlan.user_id == current_user["email"],
    ).first()
    if not plan:
        raise HTTPException(404, "기획서를 찾을 수 없습니다")

    service = _planner_service()
    try:
        creative_brief = await service.generate_creative_brief(plan_id, db)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        logger.error(f"크리에이티브 브리프 생성 실패: {e}")
        raise HTTPException(500, f"소재 브리프 생성에 실패했습니다: {str(e)}")

    return _plan_to_dict(plan)


# ═══════════════════════════════════════════════
#  Meta 드래프트 캠페인 생성
# ═══════════════════════════════════════════════

@router.post("/plans/{plan_id}/create-draft")
async def create_meta_draft(
    plan_id: str,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """AI 기획서 기반 Meta DRAFT 캠페인 생성"""
    plan = db.query(CampaignPlan).filter(
        CampaignPlan.id == plan_id,
        CampaignPlan.user_id == current_user["email"],
    ).first()
    if not plan:
        raise HTTPException(404, "기획서를 찾을 수 없습니다")

    service = _planner_service()
    try:
        result = await service.create_meta_draft(plan_id, db)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        logger.error(f"Meta 드래프트 생성 실패: {e}")
        raise HTTPException(500, f"Meta 캠페인 생성에 실패했습니다: {str(e)}")

    return result


# ═══════════════════════════════════════════════
#  기획서 목록 / 상세 / 삭제
# ═══════════════════════════════════════════════

@router.get("/plans")
async def list_plans(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """사용자의 기획서 목록 (최신순)"""
    plans = (
        db.query(CampaignPlan)
        .filter(CampaignPlan.user_id == current_user["email"])
        .order_by(CampaignPlan.created_at.desc())
        .all()
    )
    return [_plan_to_dict(p) for p in plans]


@router.get("/plans/{plan_id}")
async def get_plan(
    plan_id: str,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """기획서 상세 조회"""
    plan = db.query(CampaignPlan).filter(
        CampaignPlan.id == plan_id,
        CampaignPlan.user_id == current_user["email"],
    ).first()
    if not plan:
        raise HTTPException(404, "기획서를 찾을 수 없습니다")
    return _plan_to_dict(plan)


@router.delete("/plans/{plan_id}")
async def delete_plan(
    plan_id: str,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """기획서 삭제"""
    plan = db.query(CampaignPlan).filter(
        CampaignPlan.id == plan_id,
        CampaignPlan.user_id == current_user["email"],
    ).first()
    if not plan:
        raise HTTPException(404, "기획서를 찾을 수 없습니다")
    db.delete(plan)
    db.commit()
    return {"message": "기획서가 삭제되었습니다"}
