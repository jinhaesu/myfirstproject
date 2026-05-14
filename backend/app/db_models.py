from sqlalchemy import Column, Integer, String, DateTime, JSON, Float, Boolean, Text, Date, ForeignKey, UniqueConstraint
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


class LocalAgentStatus(Base):
    """로컬 RPA 에이전트 상태"""
    __tablename__ = "local_agent_status"

    id = Column(String, primary_key=True, default="default")
    last_heartbeat = Column(DateTime(timezone=True))
    agent_version = Column(String, nullable=True)
    hostname = Column(String, nullable=True)
    ip = Column(String, nullable=True)
    status = Column(String, default="idle")  # idle, collecting, error
    current_channel = Column(String, nullable=True)
    channels_completed = Column(Integer, default=0)
    channels_total = Column(Integer, default=0)
    last_collection_at = Column(DateTime(timezone=True), nullable=True)


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


# ──────────────────────────────────────────────
# SCM v2 Models (주문계획, 생산결과, 생산계획v2)
# ──────────────────────────────────────────────

class ScmOrderPlan(Base):
    """주문 계획 (Order Planning)"""
    __tablename__ = "scm_order_plans"

    id = Column(Integer, primary_key=True, autoincrement=True)
    product_name = Column(String(200), nullable=False)  # 품명
    product_code = Column(String(100), nullable=True)  # 품주명/코드
    channel_type = Column(String(50), nullable=False)  # 'online' or 'offline'
    channel_name = Column(String(200), nullable=True)  # specific channel name
    assignee = Column(String(100), nullable=False)  # 담당자
    plan_date = Column(Date, nullable=False)  # 계획일자
    planned_qty = Column(Integer, default=0)  # 계획 수량
    actual_qty = Column(Integer, default=0, nullable=True)  # 실제 수량
    unit_price = Column(Float, default=0, nullable=True)  # 단가
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())


class ScmProductionResult(Base):
    """생산 결과 (생산일보 RAW-DATA format)"""
    __tablename__ = "scm_production_results"

    id = Column(Integer, primary_key=True, autoincrement=True)
    production_date = Column(Date, nullable=False)  # 날짜
    manager = Column(String(100), nullable=False)  # 담당자
    location = Column(String(100), nullable=True)  # 생산 위치 (1층, 2층 등)
    product_category = Column(String(100), nullable=True)  # 품목류 (마카롱, 케이크 등)
    product_name = Column(String(200), nullable=False)  # 품목명
    quantity = Column(Float, default=0)  # 생산량
    total_hours = Column(Float, default=0)  # 생산 투여 총 시간
    unit_price = Column(Float, default=0)  # 생산 단가
    total_value = Column(Float, default=0)  # 총 생산액 (생산량 × 생산 단가)
    deduction = Column(Float, default=0)  # 공제액
    cost = Column(Float, default=0)  # 원가
    total_cost = Column(Float, default=0)  # 원가 총액
    shift_type = Column(String(50), nullable=True)  # 주간/야간 생산 구분
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())


class ScmProduct(Base):
    """품목 마스터 (Product Master)"""
    __tablename__ = "scm_products"

    id = Column(Integer, primary_key=True, autoincrement=True)
    product_name = Column(String(200), nullable=False, unique=True)  # 품목명
    product_code = Column(String(100), nullable=True)  # 품목코드
    product_category = Column(String(100), nullable=True)  # 품목류 (마카롱, 케이크 등)
    default_location = Column(String(100), nullable=True)  # 기본 생산 위치
    default_unit_price = Column(Float, default=0)  # 기본 생산 단가
    default_cost = Column(Float, default=0)  # 기본 원가
    avg_hourly_rate = Column(Float, default=0)  # 평균 시간당 생산량 (누적)
    total_produced = Column(Float, default=0)  # 총 누적 생산량
    total_hours = Column(Float, default=0)  # 총 누적 투여 시간
    safety_stock = Column(Float, default=0)  # 안전재고
    is_active = Column(Boolean, default=True)  # 활성 여부
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())


class ScmProductionPlanV2(Base):
    """생산 계획 v2 - 생산일보 RAW-DATA 형식 + AI 추천"""
    __tablename__ = "scm_production_plans_v2"

    id = Column(Integer, primary_key=True, autoincrement=True)
    plan_date = Column(Date, nullable=False)  # 날짜
    manager = Column(String(100), nullable=True)  # 담당자
    location = Column(String(100), nullable=True)  # 생산 위치
    product_category = Column(String(100), nullable=True)  # 품목류
    product_name = Column(String(200), nullable=False)  # 품목명
    quantity = Column(Float, default=0)  # 생산량
    total_hours = Column(Float, default=0)  # 생산 투여 총 시간
    unit_price = Column(Float, default=0)  # 생산 단가
    total_value = Column(Float, default=0)  # 총 생산액
    deduction = Column(Float, default=0)  # 공제액
    cost = Column(Float, default=0)  # 원가
    total_cost = Column(Float, default=0)  # 원가 총액
    shift_type = Column(String(50), nullable=True)  # 주간/야간 생산 구분
    ai_recommended_qty = Column(Float, default=0, nullable=True)  # AI 추천 생산량
    status = Column(String(50), default="draft")  # draft/confirmed/in_progress/completed
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())


# ──────────────────────────────────────────────
# CS 게시판 대응 Models (사방넷 연동)
# ──────────────────────────────────────────────

class CsInquiry(Base):
    """CS 문의사항"""
    __tablename__ = "cs_inquiries"

    id = Column(Integer, primary_key=True, autoincrement=True)
    external_id = Column(String(200), nullable=True)  # 사방넷 문의 ID
    mall_name = Column(String(100), nullable=False)  # 쇼핑몰명 (스마트스토어, 쿠팡 등)
    board_type = Column(String(100), nullable=True)  # 게시판 유형 (상품문의, 교환/반품, 배송문의 등)
    customer_name = Column(String(100), nullable=True)  # 고객명
    customer_id = Column(String(200), nullable=True)  # 고객 ID
    product_name = Column(String(300), nullable=True)  # 관련 상품명
    order_number = Column(String(200), nullable=True)  # 주문번호
    title = Column(String(500), nullable=True)  # 문의 제목
    content = Column(Text, nullable=False)  # 문의 내용
    inquiry_date = Column(DateTime, nullable=True)  # 문의 등록일
    status = Column(String(50), default="new")  # new, ai_drafted, approved, sent, failed
    ai_response = Column(Text, nullable=True)  # AI 생성 답변 초안
    final_response = Column(Text, nullable=True)  # 최종 확정 답변
    sent_at = Column(DateTime, nullable=True)  # 답변 발송일
    auto_mode = Column(Boolean, default=False)  # 자동 답변 여부
    category = Column(String(100), nullable=True)  # AI 분류 카테고리
    priority = Column(String(50), default="normal")  # low, normal, high, urgent
    sabangnet_status = Column(String(50), nullable=True)  # 사방넷 원본 상태: 001, 002, 003, 004
    last_synced_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())


class CsReferenceData(Base):
    """CS 답변 참고 데이터"""
    __tablename__ = "cs_reference_data"

    id = Column(Integer, primary_key=True, autoincrement=True)
    title = Column(String(300), nullable=False)  # 참고자료 제목
    category = Column(String(100), nullable=True)  # 카테고리 (배송정책, 교환/반품, FAQ, 상품정보 등)
    content = Column(Text, nullable=False)  # 참고 내용
    file_name = Column(String(500), nullable=True)  # 첨부파일 원본 이름
    file_type = Column(String(50), nullable=True)  # pdf, xlsx, docx 등
    file_size = Column(Integer, nullable=True)  # 파일 크기 (bytes)
    extracted_text = Column(Text, nullable=True)  # 파일에서 추출된 텍스트
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())


class CsConfig(Base):
    """CS 설정"""
    __tablename__ = "cs_config"

    id = Column(Integer, primary_key=True, autoincrement=True)
    config_key = Column(String(100), nullable=False, unique=True)
    config_value = Column(Text, nullable=True)
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())


class DeliveryTracking(Base):
    """배송 추적 정보"""
    __tablename__ = "delivery_tracking"

    id = Column(Integer, primary_key=True, autoincrement=True)
    inquiry_id = Column(Integer, nullable=True, index=True)
    order_number = Column(String(200), nullable=True, index=True)
    tracking_number = Column(String(100), nullable=True, index=True)
    courier_code = Column(String(50), nullable=True)
    courier_name = Column(String(100), nullable=True)
    current_status = Column(String(50), default="unknown")  # pickup, in_transit, out_for_delivery, delivered
    last_event = Column(Text, nullable=True)
    last_event_time = Column(DateTime, nullable=True)
    estimated_delivery = Column(DateTime, nullable=True)
    tracking_history = Column(JSON, nullable=True)
    order_detail = Column(JSON, nullable=True)  # 사방넷 주문 상세 정보 캐시
    last_checked_at = Column(DateTime, default=func.now())
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())


class CsFollowUpAction(Base):
    """CS 후속 조치"""
    __tablename__ = "cs_followup_actions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    inquiry_id = Column(Integer, nullable=False, index=True)
    action_type = Column(String(50), nullable=False)  # exchange, refund, reship, damage_claim, restock_notify, delivery_check
    action_label = Column(String(200), nullable=False)
    priority = Column(String(20), default="medium")  # low, medium, high, urgent
    status = Column(String(50), default="pending")  # pending, in_progress, completed, cancelled
    assigned_to = Column(String(100), nullable=True)
    notes = Column(Text, nullable=True)
    ai_suggested = Column(Boolean, default=False)
    completed_at = Column(DateTime, nullable=True)
    due_date = Column(DateTime, nullable=True)
    extra_data = Column(JSON, nullable=True)  # 추가 데이터 (환불금액, 교환상품 등)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())


# ──────────────────────────────────────────────
# 상품 매핑 자동화 Models (사방넷 연동)
# ──────────────────────────────────────────────

class MappingProduct(Base):
    """자사 상품 마스터"""
    __tablename__ = "mapping_products"

    id = Column(Integer, primary_key=True, autoincrement=True)
    sabangnet_product_code = Column(String(100), unique=True, index=True)  # 사방넷 상품코드
    product_name = Column(String(300), nullable=False)  # 자사 상품명
    options = Column(JSON, nullable=True)  # 옵션 목록 (색상, 사이즈 등)
    category = Column(String(100), nullable=True)  # 상품 카테고리
    is_set = Column(Boolean, default=False)  # 세트 상품 여부
    set_components = Column(JSON, nullable=True)  # 세트 구성 [{"product_code": "...", "qty": 1}]
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())


class MappingMallProduct(Base):
    """쇼핑몰 상품 (미매핑 대상)"""
    __tablename__ = "mapping_mall_products"

    id = Column(Integer, primary_key=True, autoincrement=True)
    mall_name = Column(String(100), nullable=False, index=True)  # 쇼핑몰명
    mall_product_code = Column(String(200), nullable=True)  # 쇼핑몰 상품코드
    mall_product_name = Column(String(500), nullable=False)  # 쇼핑몰 등록 상품명
    mall_option_name = Column(String(300), nullable=True)  # 쇼핑몰 옵션명
    mall_option_code = Column(String(200), nullable=True)
    is_mapped = Column(Boolean, default=False, index=True)
    mapped_product_id = Column(Integer, ForeignKey("mapping_products.id"), nullable=True)
    mapped_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())


class MappingSuggestion(Base):
    """AI 매칭 제안"""
    __tablename__ = "mapping_suggestions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    mall_product_id = Column(Integer, ForeignKey("mapping_mall_products.id"), index=True)
    suggested_product_id = Column(Integer, ForeignKey("mapping_products.id"))
    confidence = Column(Float, default=0.0)  # 0.0~1.0 신뢰도
    match_reason = Column(Text, nullable=True)  # AI 매칭 근거
    status = Column(String(50), default="pending")  # pending/approved/rejected/auto_approved
    reviewed_by = Column(String(100), nullable=True)
    reviewed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=func.now())


class MappingLog(Base):
    """매핑 작업 이력"""
    __tablename__ = "mapping_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    action = Column(String(50), nullable=False)  # collect/ai_suggest/approve/reject/register/auto_approve
    mall_name = Column(String(100), nullable=True)
    details = Column(JSON, nullable=True)  # 상세 내용
    items_processed = Column(Integer, default=0)
    items_success = Column(Integer, default=0)
    items_failed = Column(Integer, default=0)
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime, default=func.now())


# ──────────────────────────────────────────────
# 음성 CS 대응 Models (Voice CS)
# ──────────────────────────────────────────────

class VoiceCsCall(Base):
    """통화 내역"""
    __tablename__ = "voice_cs_calls"

    id = Column(Integer, primary_key=True, autoincrement=True)
    call_id = Column(String(200), unique=True, index=True)  # 외부 통화 ID (Vapi 등)
    phone_number = Column(String(50), nullable=False)  # 고객 전화번호
    direction = Column(String(20), default="inbound")  # inbound/outbound
    started_at = Column(DateTime, nullable=True)
    ended_at = Column(DateTime, nullable=True)
    duration_seconds = Column(Integer, default=0)
    status = Column(String(50), default="completed")  # ringing/in_progress/completed/failed/missed
    transcript = Column(Text, nullable=True)  # 전체 통화 텍스트
    ai_summary = Column(Text, nullable=True)  # AI 요약
    customer_name = Column(String(200), nullable=True)  # 매핑된 고객명
    order_number = Column(String(200), nullable=True)  # 매핑된 주문번호
    order_info = Column(JSON, nullable=True)  # 사방넷에서 가져온 주문 상세
    category = Column(String(100), nullable=True)  # AI 분류 (배송/교환/상품문의 등)
    sentiment = Column(String(50), nullable=True)  # positive/neutral/negative
    action_items = Column(JSON, nullable=True)  # [{title, description, priority, status}]
    resolved = Column(Boolean, default=False)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())


class VoiceCsManual(Base):
    """음성 응대 매뉴얼"""
    __tablename__ = "voice_cs_manuals"

    id = Column(Integer, primary_key=True, autoincrement=True)
    title = Column(String(300), nullable=False)
    category = Column(String(100), nullable=True)  # 배송, 교환/반품, 상품문의, 인사말, 에스컬레이션 등
    content = Column(Text, nullable=False)  # 매뉴얼 내용
    scenario_type = Column(String(100), nullable=True)  # 시나리오 유형 (자주묻는질문, 클레임, 일반안내 등)
    sample_dialogue = Column(Text, nullable=True)  # 예시 대화
    priority_order = Column(Integer, default=0)  # 표시 순서
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())


class VoiceCsConfig(Base):
    """음성 CS 설정"""
    __tablename__ = "voice_cs_config"

    id = Column(Integer, primary_key=True, autoincrement=True)
    config_key = Column(String(100), nullable=False, unique=True)
    config_value = Column(Text, nullable=True)
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())


class VoiceCsPhoneNumber(Base):
    """등록된 전화번호"""
    __tablename__ = "voice_cs_phone_numbers"

    id = Column(Integer, primary_key=True, autoincrement=True)
    phone_number = Column(String(50), nullable=False, unique=True)
    label = Column(String(200), nullable=True)  # 번호 설명 (예: 고객센터 대표번호)
    provider = Column(String(50), default="vapi")  # vapi/twilio
    provider_id = Column(String(200), nullable=True)  # 외부 서비스 ID
    is_active = Column(Boolean, default=True)
    total_calls = Column(Integer, default=0)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())


# ──────────────────────────────────────────────
# 채널별 매출 취합 (Channel Sales Aggregation)
# ──────────────────────────────────────────────

class ProductMaster(Base):
    """표준 품목 마스터 (자사 표준 제품명 기준)"""
    __tablename__ = "csa_product_master"

    id = Column(Integer, primary_key=True, autoincrement=True)
    code = Column(String(100), unique=True, index=True)  # 자체 코드 (마카롱→MACA 등)
    name = Column(String(200), nullable=False, unique=True, index=True)  # 표준명 (마카롱, 뚱낭시에 등)
    aliases = Column(JSON, nullable=True)  # 별칭 리스트
    category = Column(String(100), nullable=True)
    default_unit_size = Column(Integer, default=1)  # 기본 입수 (낱개=1)
    notes = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True)
    sort_order = Column(Integer, default=0)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())


class ChannelProductMapping(Base):
    """채널 원본 상품명 → 표준 품목 매핑 (입수 환산 포함)"""
    __tablename__ = "csa_channel_product_mapping"

    id = Column(Integer, primary_key=True, autoincrement=True)
    channel_id = Column(String(100), nullable=False, index=True)
    channel_name = Column(String(200), nullable=False)
    raw_product_name = Column(String(500), nullable=False, index=True)
    raw_option_name = Column(String(500), nullable=True)
    product_id = Column(Integer, ForeignKey("csa_product_master.id"), nullable=True, index=True)
    unit_per_set = Column(Integer, default=1)  # 1세트당 낱개 수 (사랑세트=8 등)
    confidence = Column(String(20), default="manual")  # auto/llm/manual
    is_excluded = Column(Boolean, default=False)  # 카운트 대상 외 (배송비, 사은품 등)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())


class ChannelSalesUploadBatch(Base):
    """채널 엑셀 업로드 배치 (각 업로드 1건)"""
    __tablename__ = "csa_upload_batches"

    id = Column(String(64), primary_key=True)  # uuid
    channel_id = Column(String(100), nullable=False, index=True)
    channel_name = Column(String(200), nullable=False)
    file_name = Column(String(500), nullable=False)
    file_size = Column(Integer, default=0)
    file_hash = Column(String(64), nullable=True, index=True)  # 동일 파일 재업로드 감지
    parser_version = Column(String(50), nullable=True)

    period_start = Column(Date, nullable=True)
    period_end = Column(Date, nullable=True)

    status = Column(String(20), default="pending")  # pending/parsing/done/failed
    row_total = Column(Integer, default=0)
    row_inserted = Column(Integer, default=0)
    row_duplicate = Column(Integer, default=0)
    row_unmatched = Column(Integer, default=0)
    row_excluded = Column(Integer, default=0)
    error_message = Column(Text, nullable=True)

    uploaded_by = Column(String(100), nullable=True)
    created_at = Column(DateTime, default=func.now())
    completed_at = Column(DateTime, nullable=True)


class ChannelSalesRawLine(Base):
    """채널 원본 매출 라인 (1주문 1상품 = 1행)"""
    __tablename__ = "csa_sales_raw_lines"

    id = Column(Integer, primary_key=True, autoincrement=True)
    batch_id = Column(String(64), ForeignKey("csa_upload_batches.id"), nullable=False, index=True)
    channel_id = Column(String(100), nullable=False, index=True)
    channel_name = Column(String(200), nullable=False)

    # 식별
    order_no = Column(String(200), nullable=True, index=True)
    line_no = Column(String(100), nullable=True)
    dedup_hash = Column(String(64), nullable=False, unique=True, index=True)  # sha256(channel,order,line,date,product,qty)

    # 일자
    sale_date = Column(Date, nullable=False, index=True)
    sale_datetime = Column(DateTime, nullable=True)

    # 원본
    raw_product_name = Column(String(500), nullable=True)
    raw_option_name = Column(String(500), nullable=True)
    raw_qty = Column(Float, default=0)  # 채널 표기 수량

    # 금액
    gross_amount = Column(Float, default=0)  # 총 판매가
    net_amount = Column(Float, default=0)    # 순매출 (할인반영)
    settlement_amount = Column(Float, default=0)  # 정산금액
    commission = Column(Float, default=0)
    shipping_fee = Column(Float, default=0)
    refund_amount = Column(Float, default=0)

    # 매핑 결과 (resolve 후 채워짐)
    product_id = Column(Integer, ForeignKey("csa_product_master.id"), nullable=True, index=True)
    pcs_qty = Column(Float, default=0)  # 낱개 환산 = raw_qty × unit_per_set
    mapping_status = Column(String(20), default="pending")  # pending/matched/unmatched/excluded

    raw_row = Column(JSON, nullable=True)  # 디버깅용 (보존 정책에 따라 비울 수 있음)
    created_at = Column(DateTime, default=func.now())


class ChannelSalesDailyProduct(Base):
    """일×채널×품목 집계 (대시보드용 핫 테이블)"""
    __tablename__ = "csa_sales_daily_product"

    id = Column(Integer, primary_key=True, autoincrement=True)
    sale_date = Column(Date, nullable=False, index=True)
    year = Column(Integer, nullable=False, index=True)
    month = Column(Integer, nullable=False, index=True)
    quarter = Column(Integer, nullable=False, index=True)
    channel_id = Column(String(100), nullable=False, index=True)
    channel_name = Column(String(200), nullable=False)
    channel_category = Column(String(100), nullable=True)
    product_id = Column(Integer, ForeignKey("csa_product_master.id"), nullable=True, index=True)
    product_name = Column(String(200), nullable=True)

    raw_qty = Column(Float, default=0)
    pcs_qty = Column(Float, default=0)
    gross_sales = Column(Float, default=0)
    net_sales = Column(Float, default=0)
    settlement_amount = Column(Float, default=0)
    commission = Column(Float, default=0)  # raw 단계 채널 수수료
    refund_amount = Column(Float, default=0)
    order_count = Column(Integer, default=0)
    variable_cost = Column(Float, default=0)
    contribution_margin = Column(Float, default=0)

    # 변동비 카테고리별 분해 (공헌이익 계산용)
    cost_cogs = Column(Float, default=0)              # 원가
    cost_labor = Column(Float, default=0)             # 노무비
    cost_overhead = Column(Float, default=0)          # 제조간접비
    cost_logistics_work = Column(Float, default=0)    # 물류작업비
    cost_logistics_oh = Column(Float, default=0)      # 물류간접비
    cost_advertising = Column(Float, default=0)       # 광고비
    cost_commission_rate = Column(Float, default=0)   # 정률 수수료
    cost_commission_fixed = Column(Float, default=0)  # 정액 수수료
    cost_shipping = Column(Float, default=0)          # 운반비
    cost_packaging = Column(Float, default=0)         # 포장비

    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint('sale_date', 'channel_id', 'product_id', name='uq_csa_daily_product'),
    )


class ProductVariableCost(Base):
    """품목별 변동비 (글로벌 또는 채널별)"""
    __tablename__ = "csa_product_variable_cost"

    id = Column(Integer, primary_key=True, autoincrement=True)
    product_id = Column(Integer, ForeignKey("csa_product_master.id"), nullable=False, index=True)
    channel_id = Column(String(100), nullable=True, index=True)  # NULL=글로벌 기본
    cost_per_pcs = Column(Float, default=0)  # 낱개당 변동비
    notes = Column(Text, nullable=True)
    valid_from = Column(Date, nullable=True)
    valid_to = Column(Date, nullable=True)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())


class ChannelUnmatchedProduct(Base):
    """매핑 실패 큐 (CEO 검토 대기)"""
    __tablename__ = "csa_unmatched_products"

    id = Column(Integer, primary_key=True, autoincrement=True)
    channel_id = Column(String(100), nullable=False, index=True)
    channel_name = Column(String(200), nullable=False)
    raw_product_name = Column(String(500), nullable=False)
    raw_option_name = Column(String(500), nullable=True)

    occurrence_count = Column(Integer, default=1)
    total_qty = Column(Float, default=0)
    first_seen_at = Column(DateTime, default=func.now())
    last_seen_at = Column(DateTime, default=func.now())

    # LLM 추론 결과 (대안 제시)
    llm_suggested_product_id = Column(Integer, ForeignKey("csa_product_master.id"), nullable=True)
    llm_suggested_unit_per_set = Column(Integer, nullable=True)
    llm_confidence = Column(Float, nullable=True)
    llm_reason = Column(Text, nullable=True)

    status = Column(String(20), default="pending")  # pending/resolved/excluded/ignored
    resolved_product_id = Column(Integer, ForeignKey("csa_product_master.id"), nullable=True)
    resolved_unit_per_set = Column(Integer, nullable=True)
    resolved_by = Column(String(100), nullable=True)
    resolved_at = Column(DateTime, nullable=True)


class ChannelBusinessPlan(Base):
    """사업계획 (월별 채널×품목 목표) — legacy"""
    __tablename__ = "csa_business_plan"

    id = Column(Integer, primary_key=True, autoincrement=True)
    year = Column(Integer, nullable=False, index=True)
    month = Column(Integer, nullable=False, index=True)
    channel_id = Column(String(100), nullable=True, index=True)  # NULL=전체
    channel_name = Column(String(200), nullable=True)
    product_id = Column(Integer, ForeignKey("csa_product_master.id"), nullable=True, index=True)
    product_name = Column(String(200), nullable=True)

    target_pcs_qty = Column(Float, default=0)        # 목표 낱개 수량
    target_revenue = Column(Float, default=0)        # 목표 매출
    target_contribution = Column(Float, default=0)   # 목표 공헌이익
    target_contribution_rate = Column(Float, nullable=True)  # 목표 공헌이익률

    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())


# ──────────────────────────────────────────────
# 직원·담당채널 + 사업계획 (Business Plan)
# ──────────────────────────────────────────────

class Employee(Base):
    """직원 마스터. 로그인 이메일과 연결."""
    __tablename__ = "csa_employee"

    id = Column(Integer, primary_key=True, autoincrement=True)
    email = Column(String(200), nullable=False, unique=True, index=True)
    name = Column(String(100), nullable=False)
    role = Column(String(20), default="staff")  # admin / manager / staff
    is_active = Column(Boolean, default=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())


class ChannelGroup(Base):
    """채널 구분: 온라인(위탁), 온라인(사입), 오프라인(마트/CVS/창고형/급식/기타)."""
    __tablename__ = "csa_channel_group"

    id = Column(Integer, primary_key=True, autoincrement=True)
    code = Column(String(50), unique=True, index=True)  # online_consign / online_purchase / offline_mart / ...
    name = Column(String(100), nullable=False, unique=True)
    big_group = Column(String(30), nullable=False)  # 온라인 / 오프라인
    sort_order = Column(Integer, default=0)
    created_at = Column(DateTime, default=func.now())


class ChannelGroupMembership(Base):
    """채널 → 그룹 매핑 (1 channel 은 1 그룹에 속함)."""
    __tablename__ = "csa_channel_group_membership"

    id = Column(Integer, primary_key=True, autoincrement=True)
    channel_id = Column(String(100), nullable=False, index=True)
    channel_name = Column(String(200), nullable=False)
    group_id = Column(Integer, ForeignKey("csa_channel_group.id"), nullable=False, index=True)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    __table_args__ = (UniqueConstraint('channel_id', name='uq_csa_channel_group_membership_channel'),)


class EmployeeChannelAssignment(Base):
    """직원 → 채널 담당 매핑."""
    __tablename__ = "csa_employee_channel"

    id = Column(Integer, primary_key=True, autoincrement=True)
    employee_id = Column(Integer, ForeignKey("csa_employee.id"), nullable=False, index=True)
    channel_id = Column(String(100), nullable=False, index=True)
    channel_name = Column(String(200), nullable=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    __table_args__ = (UniqueConstraint('employee_id', 'channel_id', name='uq_csa_emp_channel'),)


class BusinessPlanChannelRevenue(Base):
    """월×담당자×구분×채널 매출 목표 (사업계획 시트 '채널별 매출 대시보드')."""
    __tablename__ = "csa_plan_channel_revenue"

    id = Column(Integer, primary_key=True, autoincrement=True)
    year = Column(Integer, nullable=False, index=True)
    month = Column(Integer, nullable=False, index=True)
    employee_id = Column(Integer, ForeignKey("csa_employee.id"), nullable=True)
    employee_name = Column(String(100), nullable=True)
    group_id = Column(Integer, ForeignKey("csa_channel_group.id"), nullable=True)
    group_name = Column(String(100), nullable=True)
    channel_id = Column(String(100), nullable=False, index=True)
    channel_name = Column(String(200), nullable=False)
    target_revenue = Column(Float, default=0)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    __table_args__ = (UniqueConstraint('year', 'month', 'channel_id', name='uq_csa_plan_ch_rev'),)


class BusinessPlanProductQty(Base):
    """월×채널×품목 낱개 판매수량 목표 (시트 '채널별 판매수량')."""
    __tablename__ = "csa_plan_product_qty"

    id = Column(Integer, primary_key=True, autoincrement=True)
    year = Column(Integer, nullable=False, index=True)
    month = Column(Integer, nullable=False, index=True)
    channel_id = Column(String(100), nullable=False, index=True)
    channel_name = Column(String(200), nullable=False)
    product_id = Column(Integer, ForeignKey("csa_product_master.id"), nullable=True, index=True)
    product_name = Column(String(200), nullable=False)
    target_pcs = Column(Float, default=0)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    __table_args__ = (UniqueConstraint('year', 'month', 'channel_id', 'product_name', name='uq_csa_plan_prod_qty'),)


class BusinessPlanCategoryQty(Base):
    """월×품목류 낱개 수량 목표 (시트 '판매수량 대시보드')."""
    __tablename__ = "csa_plan_category_qty"

    id = Column(Integer, primary_key=True, autoincrement=True)
    year = Column(Integer, nullable=False, index=True)
    month = Column(Integer, nullable=False, index=True)
    product_category = Column(String(200), nullable=False)
    target_pcs = Column(Float, default=0)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    __table_args__ = (UniqueConstraint('year', 'month', 'product_category', name='uq_csa_plan_cat_qty'),)


class BusinessPlanGroupSummary(Base):
    """월×그룹 매출/마케팅 비용 목표 (시트 '대시보드' - 연간 매출 계획)."""
    __tablename__ = "csa_plan_group_summary"

    id = Column(Integer, primary_key=True, autoincrement=True)
    year = Column(Integer, nullable=False, index=True)
    month = Column(Integer, nullable=False, index=True)
    group_name = Column(String(100), nullable=False)  # 온라인(위탁) / 온라인(사입) / 오프라인
    target_revenue = Column(Float, default=0)
    revenue_share = Column(Float, nullable=True)  # 매출 비중 (0~1)
    target_marketing = Column(Float, default=0)
    marketing_share = Column(Float, nullable=True)  # 매출 대비
    target_cm = Column(Float, default=0)  # 공헌이익 목표
    cm_share = Column(Float, nullable=True)  # 매출 대비
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    __table_args__ = (UniqueConstraint('year', 'month', 'group_name', name='uq_csa_plan_group_summary'),)


class BusinessPlanUploadBatch(Base):
    """사업계획 엑셀 업로드 배치 이력."""
    __tablename__ = "csa_plan_upload_batches"

    id = Column(String(64), primary_key=True)
    year = Column(Integer, nullable=False)
    file_name = Column(String(500), nullable=False)
    uploaded_by = Column(String(100), nullable=True)
    status = Column(String(20), default="done")  # done/failed
    revenue_rows = Column(Integer, default=0)
    qty_rows = Column(Integer, default=0)
    category_rows = Column(Integer, default=0)
    summary_rows = Column(Integer, default=0)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=func.now())


# ──────────────────────────────────────────────
# 세분화된 변동비 (Cost Items / Rules / Monthly fixed)
# ──────────────────────────────────────────────

class CsaCostItem(Base):
    """변동비 항목 마스터.

    category:
      - cogs              원가 (제품 낱개 단위)
      - labor             노무비 (제품 낱개 단위)
      - overhead          제조간접비 (채널 매출 정률)
      - logistics_work    물류작업비 (채널 매출 정률)
      - logistics_oh      물류간접비 (채널 매출 정률)
      - advertising       광고비 (채널 월정액 → 일별 분배)
      - commission_rate   판매수수료 정률 (채널 매출 ×)
      - commission_fixed  판매수수료 정액 (주문건 ×)
      - shipping          운반비/택배비 (주문건 정액 or 매출 정률)
      - packaging         포장비 (주문건 정액)

    basis:
      - product_pcs       낱개당 정액
      - channel_revenue_rate  채널 매출 × rate
      - channel_monthly_fixed 채널 월정액 (일별 균등 분배)
      - order_fixed       주문건당 정액
      - order_revenue_rate  매출 × rate (운반비 옵션)
    """
    __tablename__ = "csa_cost_item"

    id = Column(Integer, primary_key=True, autoincrement=True)
    code = Column(String(60), unique=True, index=True)
    name = Column(String(120), nullable=False)
    category = Column(String(40), nullable=False, index=True)
    basis = Column(String(40), nullable=False)  # 계산 기준
    description = Column(Text, nullable=True)
    sort_order = Column(Integer, default=0)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())


class CsaCostRule(Base):
    """변동비 규칙. 채널/제품/글로벌 범위로 단가·율 설정.

    우선순위: (channel_id IS NOT NULL AND product_id IS NOT NULL)
            > channel_id > product_id > global
    """
    __tablename__ = "csa_cost_rule"

    id = Column(Integer, primary_key=True, autoincrement=True)
    cost_item_id = Column(Integer, ForeignKey("csa_cost_item.id"), nullable=False, index=True)
    channel_id = Column(String(100), nullable=True, index=True)
    product_id = Column(Integer, ForeignKey("csa_product_master.id"), nullable=True, index=True)

    # 기준에 따라 사용하는 필드가 달라짐 (basis로 매칭)
    rate = Column(Float, nullable=True)            # 정률 (0.05 = 5%)
    amount_per_pcs = Column(Float, nullable=True)  # 낱개당 원
    amount_per_order = Column(Float, nullable=True)  # 주문당 원

    notes = Column(Text, nullable=True)
    valid_from = Column(Date, nullable=True)
    valid_to = Column(Date, nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint(
            'cost_item_id', 'channel_id', 'product_id', 'valid_from', 'valid_to',
            name='uq_csa_cost_rule_scope_period'
        ),
    )


# ──────────────────────────────────────────────
# P&L 월별 엑셀 뷰 (매출/원가/판관비/이익)
# ──────────────────────────────────────────────

class CsaPnlRow(Base):
    """P&L 행 마스터.

    section:
      revenue / cogs_var / cogs_fixed / gross_profit
      sga_var / sga_fixed / op_profit / cm
    """
    __tablename__ = "csa_pnl_row"

    id = Column(Integer, primary_key=True, autoincrement=True)
    code = Column(String(60), unique=True, index=True)
    label = Column(String(120), nullable=False)
    section = Column(String(30), nullable=False, index=True)
    parent_id = Column(Integer, ForeignKey("csa_pnl_row.id"), nullable=True, index=True)
    sign = Column(Integer, default=1)              # 1=가산, -1=차감
    is_subtotal = Column(Boolean, default=False)   # 소계/합계 행
    is_computed = Column(Boolean, default=False)   # True면 자동, False면 수동입력
    formula_code = Column(String(60), nullable=True)  # 자동 계산 방식 키
    sort_order = Column(Integer, default=0)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())


class CsaPnlValue(Base):
    """P&L 셀 값 (year × month × row × scope)."""
    __tablename__ = "csa_pnl_value"

    id = Column(Integer, primary_key=True, autoincrement=True)
    year = Column(Integer, nullable=False, index=True)
    month = Column(Integer, nullable=False, index=True)
    row_id = Column(Integer, ForeignKey("csa_pnl_row.id"), nullable=False, index=True)
    scope = Column(String(20), nullable=False, default="actual")  # 'actual' | 'plan'
    value = Column(Float, default=0)
    is_manual = Column(Boolean, default=True)   # 수동 입력 여부 (자동 계산값이면 False)
    notes = Column(Text, nullable=True)
    updated_by = Column(String(200), nullable=True)
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint('year', 'month', 'row_id', 'scope', name='uq_csa_pnl_value'),
    )


class CsaPnlConfig(Base):
    """P&L 수정 비밀번호 (단일 행)."""
    __tablename__ = "csa_pnl_config"

    id = Column(Integer, primary_key=True, default=1)
    owner_email = Column(String(200), nullable=False, default="lion9080@joinandjoin.com")
    password_hash = Column(String(200), nullable=True)
    updated_by = Column(String(200), nullable=True)
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())


class CsaChannelProduct(Base):
    """채널 × 품목 등록 매핑 (해당 채널에서 판매하는 품목 리스트).

    기본 시드: 모든 채널 × 모든 표준 품목 = 활성. 직원이 추가/제거 가능.
    """
    __tablename__ = "csa_channel_product"

    id = Column(Integer, primary_key=True, autoincrement=True)
    channel_id = Column(String(100), nullable=False, index=True)
    channel_name = Column(String(200), nullable=False)
    product_id = Column(Integer, ForeignKey("csa_product_master.id"), nullable=False, index=True)
    product_name = Column(String(200), nullable=False)
    is_active = Column(Boolean, default=True)
    added_by = Column(String(200), nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint('channel_id', 'product_id', name='uq_csa_channel_product'),
    )


class CsaChannelMonthlyCost(Base):
    """채널×월 고정비 입력 (광고비 등 channel_monthly_fixed basis 용)."""
    __tablename__ = "csa_channel_monthly_cost"

    id = Column(Integer, primary_key=True, autoincrement=True)
    year = Column(Integer, nullable=False, index=True)
    month = Column(Integer, nullable=False, index=True)
    channel_id = Column(String(100), nullable=False, index=True)
    channel_name = Column(String(200), nullable=False)
    cost_item_id = Column(Integer, ForeignKey("csa_cost_item.id"), nullable=False, index=True)
    amount = Column(Float, default=0)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint('year', 'month', 'channel_id', 'cost_item_id', name='uq_csa_ch_monthly_cost'),
    )
