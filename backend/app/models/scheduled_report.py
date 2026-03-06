from sqlalchemy import Column, String, Integer, Boolean, DateTime, Text
from sqlalchemy.sql import func
from app.database import Base


class ScheduledReport(Base):
    """스케줄 리포트 모델"""
    __tablename__ = "scheduled_reports"

    id = Column(String, primary_key=True, index=True)
    user_id = Column(String, nullable=False, index=True)
    name = Column(String, nullable=False)

    schedule_type = Column(String, nullable=False)  # weekly, monthly
    day_of_week = Column(Integer, nullable=True)  # 0-6 (월-일), weekly용
    day_of_month = Column(Integer, nullable=True)  # 1-28, monthly용

    meta_campaign_id = Column(String, nullable=True)  # 특정 캠페인 (null이면 전체)
    lookback_days = Column(Integer, default=7)
    email_to = Column(Text, nullable=True)  # 수신 이메일 (comma separated)

    enabled = Column(Boolean, default=True)
    last_run_at = Column(DateTime(timezone=True), nullable=True)
    next_run_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
