from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.api.routes import chat, tables, query, auth, targets, ai, channels, smartstore
from app.database import init_db

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """앱 시작 시 데이터베이스 테이블 초기화"""
    init_db()
    yield


app = FastAPI(
    title="BigQuery Chat Analytics",
    description="자연어로 BigQuery 데이터를 분석하는 채팅 API",
    version="1.0.0",
    lifespan=lifespan,
    redirect_slashes=False,  # HTTPS 리다이렉트 문제 방지
)

# CORS 설정
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins_list,
    allow_credentials=True,
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


@app.get("/")
async def root():
    return {"message": "BigQuery Chat Analytics API", "status": "running"}


@app.get("/health")
async def health_check():
    return {"status": "healthy"}
