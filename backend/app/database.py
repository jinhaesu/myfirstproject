import os
from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

DATABASE_URL = os.getenv("DATABASE_URL", "")

# Railway에서는 postgres:// 대신 postgresql://을 사용해야 함
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

# 데이터베이스 연결이 설정되어 있는 경우에만 엔진 생성
# Supabase pooler 연결의 stale 소켓이 풀에 남아 모든 CSA endpoint가 8초 후 500으로
# 떨어지는 사고를 막기 위해 pre_ping + recycle + 짧은 connect_timeout 적용.
if DATABASE_URL:
    # cross-region(백엔드 US ↔ Supabase 서울, RTT ~309ms) 환경 최적화:
    # - Supabase 풀러가 idle 소켓을 끊으면 매 요청 TLS 재핸드셰이크(태평양 2~3왕복 ~1.5s)가 발생.
    # - TCP keepalive로 소켓을 살려두고, LIFO로 hot 커넥션을 집중 재사용해 재연결을 막는다.
    # - pool_recycle을 풀러 idle timeout보다 짧게(4분) 둬 죽기 전에 재활용.
    _pg_connect_args = {
        "connect_timeout": 5,
        "keepalives": 1,
        "keepalives_idle": 30,     # 30초마다 keepalive 전송
        "keepalives_interval": 10,
        "keepalives_count": 5,
        "options": "-c statement_timeout=30000",  # 30s 쿼리 타임아웃 (행오프 방지)
    }
    engine = create_engine(
        DATABASE_URL,
        pool_pre_ping=True,
        pool_recycle=240,          # 4분 — Supabase 풀러 idle 종료 전에 재활용
        pool_size=5,               # 소수 커넥션을 집중 재사용 (cross-region 핸드셰이크 최소화)
        max_overflow=10,
        pool_use_lifo=True,        # 가장 최근 쓴(=hot) 커넥션 우선 재사용
        connect_args=_pg_connect_args if "postgresql" in DATABASE_URL else {},
    )
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
            ProductMaster, ChannelProductMapping, ChannelProductMappingComponent,
            ChannelSalesUploadBatch,
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

        # 사업계획 그룹 요약에 공헌이익 컬럼 추가
        try:
            from sqlalchemy import text
            with engine.connect() as conn:
                conn.execute(text(
                    "ALTER TABLE csa_plan_group_summary ADD COLUMN IF NOT EXISTS target_cm DOUBLE PRECISION DEFAULT 0"
                ))
                conn.execute(text(
                    "ALTER TABLE csa_plan_group_summary ADD COLUMN IF NOT EXISTS cm_share DOUBLE PRECISION"
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
