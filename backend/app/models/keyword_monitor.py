from sqlalchemy import Column, String, Integer, Float, Boolean, DateTime, JSON
from sqlalchemy.sql import func
from app.database import Base


class MonitoredKeyword(Base):
    """모니터링 키워드 모델"""
    __tablename__ = "monitored_keywords"

    id = Column(String, primary_key=True, index=True)
    user_id = Column(String, nullable=False, index=True)
    keyword = Column(String, nullable=False)
    category = Column(String, nullable=True)
    enabled = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


class KeywordMetrics(Base):
    """키워드 메트릭 모델"""
    __tablename__ = "keyword_metrics"

    id = Column(String, primary_key=True, index=True)
    keyword_id = Column(String, nullable=False, index=True)
    platform = Column(String, nullable=False)  # "instagram", "youtube", "naver_blog"
    date = Column(DateTime(timezone=True), nullable=False, index=True)
    content_count = Column(Integer, default=0)
    view_count = Column(Integer, default=0)
    hashtags = Column(JSON, nullable=True)
    search_volume = Column(Integer, nullable=True)  # Naver 전용
    raw_data = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class KeywordSentiment(Base):
    """키워드 감성 분석 모델"""
    __tablename__ = "keyword_sentiments"

    id = Column(String, primary_key=True, index=True)
    keyword_id = Column(String, nullable=False, index=True)
    platform = Column(String, nullable=False)
    date = Column(DateTime(timezone=True), nullable=False, index=True)
    positive_ratio = Column(Float, nullable=False)
    negative_ratio = Column(Float, nullable=False)
    neutral_ratio = Column(Float, nullable=False)
    positive_keywords = Column(JSON, nullable=True)
    negative_keywords = Column(JSON, nullable=True)
    sample_size = Column(Integer, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
