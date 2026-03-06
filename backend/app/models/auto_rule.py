from sqlalchemy import Column, String, Integer, Float, Boolean, DateTime, JSON, Text
from sqlalchemy.sql import func
from app.database import Base


class AutoRule(Base):
    """자동 관리 룰 모델"""
    __tablename__ = "auto_rules"

    id = Column(String, primary_key=True, index=True)
    user_id = Column(String, nullable=False, index=True)
    name = Column(String, nullable=False)

    # 주 조건
    metric = Column(String, nullable=False)  # cpc, ctr, roas, cvr, cpm, spend, frequency
    operator = Column(String, nullable=False)  # gt, lt, gte, lte
    threshold = Column(Float, nullable=False)

    # 기간 조건
    duration_type = Column(String, nullable=False, default="any")  # consecutive_days, total_days, any
    duration_value = Column(Integer, nullable=True)

    # 보조 조건 (AND, nullable)
    secondary_metric = Column(String, nullable=True)
    secondary_operator = Column(String, nullable=True)
    secondary_threshold = Column(Float, nullable=True)

    # 액션
    action = Column(String, nullable=False)  # pause, decrease_budget, increase_budget
    action_value = Column(Float, nullable=True)  # 예산 변경 시 비율(%)

    # 대상
    target_type = Column(String, nullable=False, default="campaign")  # campaign, adset, ad
    target_id = Column(String, nullable=True)  # 특정 대상 ID (null이면 전체)
    target_name = Column(String, nullable=True)

    enabled = Column(Boolean, default=True)
    last_checked_at = Column(DateTime(timezone=True), nullable=True)
    times_triggered = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


class AutoRuleLog(Base):
    """자동 관리 룰 실행 기록"""
    __tablename__ = "auto_rule_logs"

    id = Column(String, primary_key=True, index=True)
    rule_id = Column(String, nullable=False, index=True)
    user_id = Column(String, nullable=False, index=True)

    action_taken = Column(String, nullable=False)  # paused, budget_decreased, budget_increased
    target_type = Column(String, nullable=False)
    target_id = Column(String, nullable=False)
    target_name = Column(String, nullable=True)

    metric_name = Column(String, nullable=False)
    metric_value = Column(Float, nullable=False)
    threshold_value = Column(Float, nullable=False)
    details = Column(JSON, nullable=True)  # 추가 정보

    triggered_at = Column(DateTime(timezone=True), server_default=func.now())
