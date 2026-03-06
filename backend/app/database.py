import os
from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

DATABASE_URL = os.getenv("DATABASE_URL", "")

# Railway에서는 postgres:// 대신 postgresql://을 사용해야 함
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

# 데이터베이스 연결이 설정되어 있는 경우에만 엔진 생성
if DATABASE_URL:
    engine = create_engine(DATABASE_URL)
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
else:
    engine = None
    SessionLocal = None

Base = declarative_base()


def get_db():
    """데이터베이스 세션을 가져오는 의존성"""
    if SessionLocal is None:
        raise Exception("Database not configured. Please set DATABASE_URL environment variable.")
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    """데이터베이스 테이블 초기화"""
    if engine is not None:
        # 모델을 먼저 import해서 Base.metadata에 등록
        from app.db_models import Target, Sale  # noqa: F401
        from app.models.auto_rule import AutoRule, AutoRuleLog  # noqa: F401
        from app.models.scheduled_report import ScheduledReport  # noqa: F401
        from app.models.keyword_monitor import MonitoredKeyword, KeywordMetrics, KeywordSentiment  # noqa: F401
        from app.models.campaign_plan import CampaignPlan  # noqa: F401
        Base.metadata.create_all(bind=engine)
