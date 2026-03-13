import subprocess
import logging
from contextlib import asynccontextmanager
from datetime import datetime

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.api.routes import chat, tables, query, auth, targets, ai, channels, smartstore, cafe24, coupang_wing, coupang_rocket, analytics, market_analysis, campaign_planner, settlement, scm
from app.database import init_db

settings = get_settings()
logger = logging.getLogger(__name__)


def _install_playwright_browsers():
    """Ensure Playwright chromium browser is installed for RPA features"""
    try:
        result = subprocess.run(
            ["python", "-m", "playwright", "install", "chromium"],
            capture_output=True,
            text=True,
            timeout=120,
        )
        if result.returncode == 0:
            logger.info("Playwright chromium browser ready")
        else:
            logger.warning(f"Playwright install warning: {result.stderr}")
    except Exception as e:
        logger.warning(f"Playwright browser install skipped: {e}")


async def _startup_report_scheduler():
    """스케줄된 리포트 이메일을 주기적으로 체크하고 발송"""
    import asyncio
    from app.database import SessionLocal
    from app.db_models import TargetReportSchedule
    from app.services.targets_service import TargetsService

    DAY_MAP = {"월": 0, "화": 1, "수": 2, "목": 3, "금": 4, "토": 5, "일": 6}

    await asyncio.sleep(10)  # 서버 초기화 대기
    logger.info("Report scheduler started")

    while True:
        try:
            if not SessionLocal:
                await asyncio.sleep(60)
                continue

            db = SessionLocal()
            try:
                now = datetime.now()
                current_weekday = now.weekday()  # 0=월 ~ 6=일
                current_time = now.strftime("%H:%M")

                schedules = db.query(TargetReportSchedule).filter(
                    TargetReportSchedule.auto_send == True,
                ).all()

                for sched in schedules:
                    # 요일 체크
                    days_str = sched.schedule_days or ""
                    sched_days = [DAY_MAP.get(d.strip(), -1) for d in days_str.split(",") if d.strip()]
                    if current_weekday not in sched_days:
                        continue

                    # 시각 체크 (분 단위 매칭)
                    sched_time = sched.schedule_time or "09:00"
                    if current_time != sched_time:
                        continue

                    # 이미 오늘 발송했는지 체크 (updated_at 기준)
                    if sched.updated_at:
                        last_sent = sched.updated_at
                        if hasattr(last_sent, 'date') and last_sent.date() == now.date():
                            continue

                    # 발송 실행
                    recipients = [e.strip() for e in (sched.recipients or "").split(",") if e.strip()]
                    if not recipients:
                        continue

                    try:
                        from app.config import get_settings
                        import resend

                        settings = get_settings()
                        if not settings.RESEND_API_KEY:
                            logger.warning("RESEND_API_KEY not configured, skipping scheduled report")
                            continue

                        resend.api_key = settings.RESEND_API_KEY

                        service = TargetsService()
                        year = sched.year or now.year
                        month = sched.month or now.month

                        targets = service.get_targets_by_year_month(year, month)
                        sales = service.get_sales_by_year_month(year, month)
                        by_manager_target = service.get_targets_by_manager(year, month)
                        by_manager_sales = service.get_sales_by_manager(year, month, until_today=False)

                        from app.api.routes.targets import _build_report_html
                        html = _build_report_html(year, month, targets, sales, by_manager_target, by_manager_sales)

                        resend.Emails.send({
                            "from": settings.RESEND_FROM_EMAIL,
                            "to": recipients,
                            "subject": f"[Nuldam] {year}년 {month}월 영업 지표 리포트",
                            "html": html,
                        })

                        # 발송 성공 시 updated_at 갱신 (중복 방지)
                        sched.updated_at = now
                        db.commit()
                        logger.info(f"Scheduled report sent: {sched.name} -> {recipients}")

                    except Exception as e:
                        logger.error(f"Scheduled report send failed ({sched.name}): {e}")

            finally:
                db.close()

        except Exception as e:
            logger.error(f"Report scheduler error: {e}")

        await asyncio.sleep(60)  # 1분마다 체크


async def _startup_catchup_rules():
    """서버 시작 시 24시간 이상 미체크 사용자 룰 catch-up"""
    import asyncio
    from datetime import datetime, timezone, timedelta
    from app.database import SessionLocal
    from app.models.auto_rule import AutoRule
    from app.services.meta_ads_service import MetaAdsService
    from app.services.rule_engine import run_rules

    if not SessionLocal:
        return
    # 잠시 대기 후 실행
    await asyncio.sleep(5)
    db = SessionLocal()
    try:
        cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
        stale_rules = db.query(AutoRule).filter(
            AutoRule.enabled == True,
            (AutoRule.last_checked_at == None) | (AutoRule.last_checked_at < cutoff),
        ).all()
        user_ids = list(set(r.user_id for r in stale_rules))
        for uid in user_ids:
            try:
                meta = MetaAdsService()
                await run_rules(db, uid, meta)
            except Exception as e:
                logger.warning(f"Startup catch-up failed for {uid}: {e}")
    except Exception as e:
        logger.warning(f"Startup catch-up error: {e}")
    finally:
        db.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """앱 시작 시 데이터베이스 테이블 초기화"""
    try:
        init_db()
    except Exception as e:
        logger.error(f"Database init failed (server will still start): {e}")
    # Ensure Playwright browsers are available
    _install_playwright_browsers()
    # 룰 catch-up (백그라운드)
    import asyncio
    asyncio.create_task(_startup_catchup_rules())
    # 리포트 스케줄러 (백그라운드, 1분마다 체크)
    asyncio.create_task(_startup_report_scheduler())
    yield


app = FastAPI(
    title="BigQuery Chat Analytics",
    description="자연어로 BigQuery 데이터를 분석하는 채팅 API",
    version="1.0.0",
    lifespan=lifespan,
    redirect_slashes=False,  # HTTPS 리다이렉트 문제 방지
)

# CORS 설정 — 모든 오리진 허용 (JWT 인증으로 보안 유지)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 라우터 등록
app.include_router(auth.router, prefix="/api", tags=["auth"])
app.include_router(chat.router, prefix="/api", tags=["chat"])
app.include_router(tables.router, prefix="/api", tags=["tables"])
app.include_router(query.router, prefix="/api", tags=["query"])
app.include_router(targets.router, prefix="/api", tags=["targets"])
app.include_router(ai.router, prefix="/api", tags=["ai"])
app.include_router(channels.router, prefix="/api", tags=["channels"])
app.include_router(smartstore.router, prefix="/api", tags=["smartstore"])
app.include_router(cafe24.router, prefix="/api", tags=["cafe24"])
app.include_router(coupang_wing.router, prefix="/api", tags=["coupang-wing"])
app.include_router(coupang_rocket.router, prefix="/api", tags=["coupang-rocket"])
app.include_router(analytics.router, prefix="/api", tags=["analytics"])
app.include_router(market_analysis.router, prefix="/api", tags=["market-analysis"])
app.include_router(campaign_planner.router, prefix="/api", tags=["campaign-planner"])
app.include_router(settlement.router, prefix="/api", tags=["settlement"])
app.include_router(scm.router, prefix="/api", tags=["scm"])


@app.get("/")
async def root():
    return {"message": "BigQuery Chat Analytics API", "status": "running"}


@app.get("/health")
async def health_check():
    return {"status": "healthy"}


@app.get("/api/server-ip")
async def get_server_ip():
    """서버 외부 IP 확인 (API 허용 IP 설정용)"""
    import httpx
    try:
        async with httpx.AsyncClient() as client:
            res = await client.get("https://api.ipify.org?format=json", timeout=5)
            return res.json()
    except Exception as e:
        return {"error": str(e)}
