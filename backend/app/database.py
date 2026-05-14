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
        from app.db_models import (  # noqa: F401
            Target, Sale,
            MonthlySettlement, SettlementRpaConfig,
            SettlementReport, SettlementCollectionLog,
            LocalAgentStatus,
            ScmOrder, ScmStaffMember, ScmSchedule, ScmTask,
            ScmProductionPlan, ScmInventoryItem, ScmShipment,
            TargetReportSchedule,
            ScmOrderPlan, ScmProductionResult, ScmProductionPlanV2,
            ScmProduct,
            CsInquiry, CsReferenceData, CsConfig,
            DeliveryTracking, CsFollowUpAction,
            ProductMaster, ChannelProductMapping, ChannelSalesUploadBatch,
            ChannelSalesRawLine, ChannelSalesDailyProduct, ProductVariableCost,
            ChannelUnmatchedProduct, ChannelBusinessPlan,
            Employee, ChannelGroup, ChannelGroupMembership,
            EmployeeChannelAssignment,
            BusinessPlanChannelRevenue, BusinessPlanProductQty,
            BusinessPlanCategoryQty, BusinessPlanGroupSummary,
            BusinessPlanUploadBatch,
            CsaCostItem, CsaCostRule, CsaChannelMonthlyCost,
            CsaPnlRow, CsaPnlValue, CsaPnlConfig,
            CsaChannelProduct,
        )
        from app.models.auto_rule import AutoRule, AutoRuleLog  # noqa: F401
        from app.models.scheduled_report import ScheduledReport  # noqa: F401
        from app.models.keyword_monitor import MonitoredKeyword, KeywordMetrics, KeywordSentiment  # noqa: F401
        from app.models.campaign_plan import CampaignPlan  # noqa: F401
        try:
            Base.metadata.create_all(bind=engine)
        except Exception as e:
            import logging
            logging.getLogger(__name__).error(f"create_all failed: {e}")

        # 새 컬럼 마이그레이션 (create_all은 기존 테이블에 컬럼 추가 안 함)
        try:
            from sqlalchemy import text
            with engine.connect() as conn:
                conn.execute(text(
                    "ALTER TABLE target_report_schedules ADD COLUMN IF NOT EXISTS last_sent_at TIMESTAMP"
                ))
                conn.commit()
        except Exception:
            pass  # 이미 있거나 DB가 ALTER를 지원하지 않으면 무시

        try:
            from sqlalchemy import text
            with engine.connect() as conn:
                conn.execute(text(
                    "ALTER TABLE cs_inquiries ADD COLUMN IF NOT EXISTS sabangnet_status VARCHAR(50)"
                ))
                conn.execute(text(
                    "ALTER TABLE cs_inquiries ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMP"
                ))
                conn.commit()
        except Exception:
            pass

        # CSA 변동비 규칙 unique constraint 변경 (기간 추가)
        try:
            from sqlalchemy import text
            with engine.connect() as conn:
                conn.execute(text(
                    "ALTER TABLE csa_cost_rule DROP CONSTRAINT IF EXISTS uq_csa_cost_rule_scope"
                ))
                conn.commit()
        except Exception:
            pass

        # CSA 변동비 분해 컬럼 (기존 daily_product 테이블에 추가)
        try:
            from sqlalchemy import text
            csa_daily_alters = [
                "ADD COLUMN IF NOT EXISTS cost_cogs DOUBLE PRECISION DEFAULT 0",
                "ADD COLUMN IF NOT EXISTS cost_labor DOUBLE PRECISION DEFAULT 0",
                "ADD COLUMN IF NOT EXISTS cost_overhead DOUBLE PRECISION DEFAULT 0",
                "ADD COLUMN IF NOT EXISTS cost_logistics_work DOUBLE PRECISION DEFAULT 0",
                "ADD COLUMN IF NOT EXISTS cost_logistics_oh DOUBLE PRECISION DEFAULT 0",
                "ADD COLUMN IF NOT EXISTS cost_advertising DOUBLE PRECISION DEFAULT 0",
                "ADD COLUMN IF NOT EXISTS cost_commission_rate DOUBLE PRECISION DEFAULT 0",
                "ADD COLUMN IF NOT EXISTS cost_commission_fixed DOUBLE PRECISION DEFAULT 0",
                "ADD COLUMN IF NOT EXISTS cost_shipping DOUBLE PRECISION DEFAULT 0",
                "ADD COLUMN IF NOT EXISTS cost_packaging DOUBLE PRECISION DEFAULT 0",
            ]
            with engine.connect() as conn:
                for col_sql in csa_daily_alters:
                    conn.execute(text(f"ALTER TABLE csa_sales_daily_product {col_sql}"))
                conn.commit()
        except Exception:
            pass
