import subprocess
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.api.routes import chat, tables, query, auth, targets, ai, channels, smartstore, cafe24, coupang_wing, coupang_rocket, analytics, market_analysis, campaign_planner, settlement
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
    init_db()
    # Ensure Playwright browsers are available
    _install_playwright_browsers()
    # 룰 catch-up (백그라운드)
    import asyncio
    asyncio.create_task(_startup_catchup_rules())
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
