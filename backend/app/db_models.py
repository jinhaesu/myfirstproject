from sqlalchemy import Column, Integer, String, DateTime, JSON, Float, Boolean, Text, Date, ForeignKey
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


class MonthlySettlement(Base):
    """월별 결산 매출 데이터"""
    __tablename__ = "monthly_settlements"

    id = Column(String, primary_key=True, index=True)
    channel_id = Column(String, nullable=False, index=True)
    channel_name = Column(String, nullable=False)
    category = Column(String, nullable=False)  # 오픈마켓, 홈쇼핑 등
    year = Column(Integer, nullable=False, index=True)
    month = Column(Integer, nullable=False, index=True)

    # 결산 매출 데이터
    gross_sales = Column(Float, default=0)          # 총 매출액
    net_sales = Column(Float, default=0)             # 순매출액
    settlement_amount = Column(Float, default=0)     # 정산금액 (실제 입금액)
    commission = Column(Float, default=0)            # 수수료
    shipping_cost = Column(Float, default=0)         # 배송비
    refund_amount = Column(Float, default=0)         # 환불금액
    order_count = Column(Integer, default=0)         # 주문건수
    quantity = Column(Integer, default=0)            # 판매수량

    # 상태 관리
    status = Column(String, default="pending")       # pending, confirmed, finalized
    source = Column(String, default="manual")        # rpa, api, manual, upload
    confirmed_by = Column(String, nullable=True)     # 확인자
    confirmed_at = Column(DateTime(timezone=True), nullable=True)
    notes = Column(Text, nullable=True)              # 메모
    raw_data = Column(JSON, nullable=True)           # 원본 데이터

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


class SettlementRpaConfig(Base):
    """채널별 RPA 설정"""
    __tablename__ = "settlement_rpa_configs"

    id = Column(String, primary_key=True, index=True)
    channel_id = Column(String, nullable=False, unique=True, index=True)
    channel_name = Column(String, nullable=False)

    # 로그인 정보
    login_url = Column(String, nullable=True)
    login_id = Column(String, nullable=True)
    login_password = Column(String, nullable=True)  # 실제 운영시 암호화 필요

    # RPA 셀렉터 설정
    selectors = Column(JSON, nullable=True)  # {login_id_sel, login_pw_sel, submit_sel, settlement_menu_sel, ...}

    # 정산 페이지 설정
    settlement_url = Column(String, nullable=True)   # 정산 페이지 직접 URL
    date_format = Column(String, default="%Y-%m-%d") # 날짜 입력 형식
    download_type = Column(String, default="scrape")  # scrape, excel_download

    # 엑셀 다운로드 설정
    excel_column_mapping = Column(JSON, nullable=True)  # 엑셀 컬럼 -> DB 컬럼 매핑
    excel_skip_rows = Column(Integer, default=0)
    excel_sheet_name = Column(String, nullable=True)

    # 스케줄 설정
    auto_collect_day = Column(Integer, default=5)   # 매월 n일에 자동 수집
    is_enabled = Column(Boolean, default=True)
    last_collected_at = Column(DateTime(timezone=True), nullable=True)

    # 추가 설정
    extra_config = Column(JSON, nullable=True)  # 채널별 특수 설정

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


class SettlementReport(Base):
    """결산 리포트 발송 설정 및 이력"""
    __tablename__ = "settlement_reports"

    id = Column(String, primary_key=True, index=True)
    report_name = Column(String, nullable=False)
    year = Column(Integer, nullable=False)
    month = Column(Integer, nullable=False)

    # 발송 설정
    recipients = Column(JSON, nullable=False)     # ["email1@...", "email2@..."]
    schedule_day = Column(Integer, default=10)    # 매월 n일에 발송
    schedule_time = Column(String, default="09:00")  # HH:MM
    is_auto_send = Column(Boolean, default=False)

    # 리포트 내용 설정
    include_channels = Column(JSON, nullable=True)   # null이면 전체 채널
    include_chart = Column(Boolean, default=True)
    include_comparison = Column(Boolean, default=True)  # 전월 대비

    # 발송 이력
    status = Column(String, default="draft")         # draft, scheduled, sent, failed
    sent_at = Column(DateTime(timezone=True), nullable=True)
    error_message = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


class SettlementCollectionLog(Base):
    """결산 데이터 수집 로그"""
    __tablename__ = "settlement_collection_logs"

    id = Column(String, primary_key=True, index=True)
    channel_id = Column(String, nullable=False, index=True)
    channel_name = Column(String, nullable=False)
    year = Column(Integer, nullable=False)
    month = Column(Integer, nullable=False)

    collection_type = Column(String, nullable=False)  # rpa, api, manual, upload
    status = Column(String, nullable=False)            # pending, running, success, failed
    started_at = Column(DateTime(timezone=True), server_default=func.now())
    completed_at = Column(DateTime(timezone=True), nullable=True)

    # 결과
    settlement_amount = Column(Float, nullable=True)
    error_message = Column(Text, nullable=True)
    screenshot_path = Column(String, nullable=True)   # RPA 스크린샷 경로
    details = Column(JSON, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())


# ──────────────────────────────────────────────
# SCM Models
# ──────────────────────────────────────────────

class ScmOrder(Base):
    """SCM 주문 현황"""
    __tablename__ = "scm_orders"

    id = Column(Integer, primary_key=True, autoincrement=True)
    order_number = Column(String, unique=True, index=True)
    order_date = Column(DateTime, default=func.now())
    channel = Column(String)  # 스마트스토어, 쿠팡, etc.
    customer_name = Column(String)
    product_name = Column(String)
    quantity = Column(Integer, default=1)
    amount = Column(Float, default=0)
    status = Column(String, default="신규접수")  # 신규접수/확인완료/배송준비/배송중/배송완료/취소/반품
    memo = Column(Text, nullable=True)
    user_id = Column(String)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())


class ScmStaffMember(Base):
    """SCM 인력 배치"""
    __tablename__ = "scm_staff_members"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String)
    department = Column(String)  # 물류/생산/CS/관리
    position = Column(String)  # 팀장/대리/사원/파트
    status = Column(String, default="근무중")  # 근무중/휴무/연차/출장
    task_area = Column(String, nullable=True)
    contact = Column(String, nullable=True)
    user_id = Column(String)
    created_at = Column(DateTime, default=func.now())


class ScmSchedule(Base):
    """SCM 근무 스케줄"""
    __tablename__ = "scm_schedules"

    id = Column(Integer, primary_key=True, autoincrement=True)
    member_id = Column(Integer, ForeignKey("scm_staff_members.id"))
    work_date = Column(Date)
    shift_type = Column(String, default="주간")  # 주간/야간/휴무/연차
    user_id = Column(String)


class ScmTask(Base):
    """SCM 업무 (공수 관리)"""
    __tablename__ = "scm_tasks"

    id = Column(Integer, primary_key=True, autoincrement=True)
    task_name = Column(String)
    assignee_id = Column(Integer, ForeignKey("scm_staff_members.id"), nullable=True)
    assignee_name = Column(String)
    hours_spent = Column(Float, default=0)
    hours_estimated = Column(Float, default=0)
    progress = Column(Integer, default=0)  # 0-100
    status = Column(String, default="대기")  # 진행중/완료/대기
    user_id = Column(String)
    created_at = Column(DateTime, default=func.now())


class ScmProductionPlan(Base):
    """SCM 생산 계획"""
    __tablename__ = "scm_production_plans"

    id = Column(Integer, primary_key=True, autoincrement=True)
    product_name = Column(String)
    category = Column(String)  # 스킨케어/메이크업/헤어케어/바디케어/기타
    planned_qty = Column(Integer, default=0)
    produced_qty = Column(Integer, default=0)
    start_date = Column(Date)
    end_date = Column(Date)
    status = Column(String, default="계획")  # 계획/원자재준비/생산중/품질검사/완료/지연
    manager = Column(String, nullable=True)
    memo = Column(Text, nullable=True)
    year = Column(Integer)
    month = Column(Integer)
    user_id = Column(String)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())


class ScmInventoryItem(Base):
    """SCM 재고 항목"""
    __tablename__ = "scm_inventory_items"

    id = Column(Integer, primary_key=True, autoincrement=True)
    sku = Column(String, unique=True, index=True)
    product_name = Column(String)
    category = Column(String)
    current_stock = Column(Integer, default=0)
    safety_stock = Column(Integer, default=0)
    reorder_point = Column(Integer, default=0)
    status = Column(String, default="정상")  # 정상/주의/부족/품절
    last_inbound_date = Column(Date, nullable=True)
    user_id = Column(String)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())


class ScmShipment(Base):
    """SCM 출고"""
    __tablename__ = "scm_shipments"

    id = Column(Integer, primary_key=True, autoincrement=True)
    shipment_number = Column(String, unique=True, index=True)
    shipment_date = Column(DateTime, default=func.now())
    product_name = Column(String)
    sku = Column(String)
    quantity = Column(Integer, default=0)
    destination = Column(String)
    courier = Column(String, nullable=True)  # 택배사
    tracking_number = Column(String, nullable=True)
    status = Column(String, default="준비중")  # 준비중/출고완료/배송중/배송완료
    user_id = Column(String)
    created_at = Column(DateTime, default=func.now())


# 목표 영업 지표 리포트 스케줄
class TargetReportSchedule(Base):
    __tablename__ = "target_report_schedules"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String, default="영업 지표 리포트")
    recipients = Column(Text)  # comma-separated emails
    schedule_days = Column(String)  # comma-separated: 월,화,수 etc.
    schedule_time = Column(String, default="09:00")
    year = Column(Integer)
    month = Column(Integer, nullable=True)
    auto_send = Column(Boolean, default=True)
    user_id = Column(String)
    last_sent_at = Column(DateTime, nullable=True)  # 마지막 발송 시각
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())
