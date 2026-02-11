from sqlalchemy import Column, Integer, String, DateTime, JSON, Float, Boolean, Text
from sqlalchemy.sql import func
from app.database import Base


class Target(Base):
    """목표 데이터 모델"""
    __tablename__ = "targets"

    id = Column(String, primary_key=True, index=True)
    department = Column(String, nullable=False)
    year = Column(Integer, nullable=False, index=True)
    title = Column(String, nullable=False)
    manager = Column(String, nullable=False)
    kpi_type = Column(String, nullable=False)  # 매출, 광고선전비, 공헌이익, 판매량
    grid_data = Column(JSON, nullable=False)  # 2D 배열 데이터
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


class Sale(Base):
    """매출 현황 데이터 모델"""
    __tablename__ = "sales"

    id = Column(String, primary_key=True, index=True)
    year = Column(Integer, nullable=False, index=True)
    month = Column(Integer, nullable=False, index=True)
    title = Column(String, nullable=False)
    manager = Column(String, nullable=False)
    kpi_type = Column(String, nullable=False)
    grid_data = Column(JSON, nullable=False)  # 2D 배열 데이터
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


class Channel(Base):
    """판매 채널 정보"""
    __tablename__ = "channels"

    id = Column(String, primary_key=True, index=True)
    name = Column(String, nullable=False, unique=True)  # 채널명 (카페24, 쿠팡 등)
    category = Column(String, nullable=False)  # 카테고리 (오픈마켓, 홈쇼핑, B2B 등)
    integration_type = Column(String, nullable=False)  # api, rpa, manual
    api_endpoint = Column(String, nullable=True)  # API URL (있는 경우)
    credentials = Column(JSON, nullable=True)  # 암호화된 인증 정보
    is_active = Column(Boolean, default=True)  # 활성화 여부
    sync_schedule = Column(String, nullable=True)  # 동기화 스케줄 (cron 표현식)
    last_synced_at = Column(DateTime(timezone=True), nullable=True)
    config = Column(JSON, nullable=True)  # 채널별 추가 설정
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


class ChannelSales(Base):
    """채널별 일별 매출 데이터"""
    __tablename__ = "channel_sales"

    id = Column(String, primary_key=True, index=True)
    channel_id = Column(String, nullable=False, index=True)  # Channel.id 참조
    channel_name = Column(String, nullable=False)  # 빠른 조회용 비정규화
    sale_date = Column(DateTime(timezone=True), nullable=False, index=True)  # 매출 날짜
    year = Column(Integer, nullable=False, index=True)
    month = Column(Integer, nullable=False, index=True)
    day = Column(Integer, nullable=False, index=True)

    # 매출 데이터
    gross_sales = Column(Float, default=0)  # 총 매출
    net_sales = Column(Float, default=0)  # 순매출 (취소/반품 제외)
    order_count = Column(Integer, default=0)  # 주문 건수
    quantity = Column(Integer, default=0)  # 판매 수량
    refund_amount = Column(Float, default=0)  # 환불 금액
    commission = Column(Float, default=0)  # 수수료
    shipping_cost = Column(Float, default=0)  # 배송비

    # 메타 정보
    raw_data = Column(JSON, nullable=True)  # 원본 데이터 (디버깅용)
    source = Column(String, nullable=True)  # 데이터 소스 (api, upload, rpa)
    sync_log_id = Column(String, nullable=True)  # 동기화 로그 ID

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


class ChannelSyncLog(Base):
    """채널 동기화 로그"""
    __tablename__ = "channel_sync_logs"

    id = Column(String, primary_key=True, index=True)
    channel_id = Column(String, nullable=False, index=True)
    channel_name = Column(String, nullable=False)
    sync_type = Column(String, nullable=False)  # auto, manual, upload
    status = Column(String, nullable=False)  # pending, running, success, failed
    started_at = Column(DateTime(timezone=True), server_default=func.now())
    completed_at = Column(DateTime(timezone=True), nullable=True)
    records_processed = Column(Integer, default=0)
    records_created = Column(Integer, default=0)
    records_updated = Column(Integer, default=0)
    error_message = Column(Text, nullable=True)
    details = Column(JSON, nullable=True)  # 상세 로그


class ChannelUploadTemplate(Base):
    """채널별 업로드 템플릿 (Excel 컬럼 매핑)"""
    __tablename__ = "channel_upload_templates"

    id = Column(String, primary_key=True, index=True)
    channel_id = Column(String, nullable=False, index=True)
    channel_name = Column(String, nullable=False)
    template_name = Column(String, nullable=False)
    column_mapping = Column(JSON, nullable=False)  # 엑셀 컬럼 -> DB 컬럼 매핑
    date_format = Column(String, default="%Y-%m-%d")  # 날짜 형식
    skip_rows = Column(Integer, default=0)  # 건너뛸 행 수
    sheet_name = Column(String, nullable=True)  # 시트명 (지정된 경우)
    is_default = Column(Boolean, default=False)  # 기본 템플릿 여부
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
