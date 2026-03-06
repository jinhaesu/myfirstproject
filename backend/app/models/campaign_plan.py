from sqlalchemy import Column, String, Text, DateTime, JSON
from sqlalchemy.sql import func
from app.database import Base


class CampaignPlan(Base):
    """AI 캠페인 기획서 모델"""
    __tablename__ = "campaign_plans"

    id = Column(String, primary_key=True, index=True)
    user_id = Column(String, nullable=False, index=True)

    # 제품/서비스 정보
    product_name = Column(String, nullable=False)
    product_url = Column(String, nullable=True)
    product_description = Column(Text, nullable=True)

    # 캠페인 설정
    campaign_goal = Column(String, nullable=False)  # awareness, traffic, conversions, app_installs, leads

    # 참고 자료
    reference_urls = Column(JSON, nullable=True)  # list of reference image/video URLs
    product_image_urls = Column(JSON, nullable=True)

    # 추가 정보
    additional_notes = Column(Text, nullable=True)

    # AI 생성 결과
    ai_plan = Column(JSON, nullable=True)  # full AI-generated plan dict
    creative_brief = Column(JSON, nullable=True)  # AI creative output dict

    # Meta 연동
    meta_campaign_id = Column(String, nullable=True)  # created Meta campaign ID
    meta_adset_id = Column(String, nullable=True)

    # 상태
    status = Column(String, nullable=False, default="draft")  # draft, planned, submitted, active

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
