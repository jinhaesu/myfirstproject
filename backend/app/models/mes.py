"""MES(생산현장관리) 모듈 SQLAlchemy 모델.

SMHACCP MES를 myfirstproject 안의 자체 모듈로 재구현.
기준정보(품목/원부재료/BOM)는 scm_products/scm_raw_materials/scm_sub_materials/scm_bom_lines를
그대로 사용하고, MES 고유 기준(공정·설비·작업자·공통코드·CCP 한계기준·점검 템플릿)만 여기 신설한다.

설계 계약서: docs/MES_DESIGN.md §2
"""
from __future__ import annotations

from sqlalchemy import (
    Column, Integer, String, DateTime, Float, Boolean, Text, Date,
    ForeignKey, UniqueConstraint, Index,
)
from sqlalchemy.sql import func

from app.database import Base


# ──────────────────────────────────────────────
# 기준정보
# ──────────────────────────────────────────────

class MesProcess(Base):
    """공정 마스터."""
    __tablename__ = "mes_process"

    id = Column(Integer, primary_key=True, autoincrement=True)
    code = Column(String(50), unique=True, nullable=False, index=True)
    name = Column(String(100), nullable=False)
    process_class = Column(String(50))  # 배합/가열/급속동결/금속검출/포장가공/성형/냉각/기타
    floor = Column(String(10))  # 1F/2F/3F
    is_ccp = Column(Boolean, default=False)
    ccp_code = Column(String(30))  # 예 CCP-2B
    pop_kind = Column(String(20))  # mixing/heating/freezing/metal/packing
    sub_kind = Column(String(20))  # 가열 하위: 굽기/끓임/멜팅/터널
    sort_order = Column(Integer, default=0)
    is_active = Column(Boolean, default=True)
    notes = Column(Text)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())


class MesEquipment(Base):
    """설비 마스터."""
    __tablename__ = "mes_equipment"

    id = Column(Integer, primary_key=True, autoincrement=True)
    code = Column(String(50), unique=True, nullable=False, index=True)
    name = Column(String(150), nullable=False)
    process_id = Column(Integer, ForeignKey("mes_process.id"), nullable=True, index=True)
    floor = Column(String(10), index=True)
    unit_label = Column(String(50))  # 예 2F1호기
    eq_type = Column(String(50), index=True)  # 로터리오븐/터널오븐/데크오븐/배합기/금속검출기/급속동결기/냉각실/창고/기타
    maker = Column(String(100))
    model = Column(String(100))
    spec = Column(String(200))
    purchase_date = Column(Date)
    purchase_amount = Column(Float)
    plc_yn = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True)
    sort_order = Column(Integer, default=0)
    notes = Column(Text)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())


class MesWorker(Base):
    """작업자 마스터."""
    __tablename__ = "mes_worker"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(100), nullable=False, index=True)
    department = Column(String(100))
    default_floor = Column(String(10))
    phone = Column(String(30))
    is_active = Column(Boolean, default=True)
    sort_order = Column(Integer, default=0)
    health_cert_date = Column(Date)
    health_cert_next = Column(Date, index=True)
    notes = Column(Text)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())


class MesCode(Base):
    """공통코드(DOWNTIME/DEFECT/DEVIATION/FAMILY/EQ_EVENT)."""
    __tablename__ = "mes_code"
    __table_args__ = (
        UniqueConstraint("group_code", "code", name="uq_mes_code_group_code"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    group_code = Column(String(30), nullable=False, index=True)
    code = Column(String(50), nullable=False)
    name = Column(String(200), nullable=False)
    sort_order = Column(Integer, default=0)
    is_active = Column(Boolean, default=True)
    extra = Column(Text)  # JSON
    notes = Column(Text)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())


class MesCcpLimit(Base):
    """CCP 한계기준."""
    __tablename__ = "mes_ccp_limit"

    id = Column(Integer, primary_key=True, autoincrement=True)
    process_id = Column(Integer, ForeignKey("mes_process.id"), nullable=False, index=True)
    family_code = Column(String(50), nullable=True, index=True)
    name = Column(String(200))
    param = Column(String(30))  # temp/time/alcohol_ratio/metal/other
    min_value = Column(Float)
    max_value = Column(Float)
    unit = Column(String(20))
    check_cycle = Column(String(50))
    check_method = Column(String(200))
    corrective_action = Column(Text)
    alarm_yn = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True)
    notes = Column(Text)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())


class MesProductionPlan(Base):
    """생산계획."""
    __tablename__ = "mes_production_plan"
    __table_args__ = (
        UniqueConstraint("plan_date", "item_name", name="uq_mes_plan_date_item"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    plan_date = Column(Date, nullable=False, index=True)
    item_id = Column(Integer, ForeignKey("scm_products.id"), nullable=True, index=True)
    item_name = Column(String(200), nullable=False)
    family_code = Column(String(50))
    plan_qty = Column(Float, default=0)
    unit = Column(String(20), default="ea")
    notes = Column(Text)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())


# ──────────────────────────────────────────────
# 작업지시
# ──────────────────────────────────────────────

class MesWorkOrder(Base):
    """작업지시."""
    __tablename__ = "mes_work_order"

    id = Column(Integer, primary_key=True, autoincrement=True)
    wo_no = Column(String(30), unique=True, nullable=False, index=True)
    order_date = Column(Date, nullable=False, index=True)
    seq = Column(Integer, default=1)
    item_id = Column(Integer, ForeignKey("scm_products.id"), nullable=True, index=True)
    item_name = Column(String(200))
    family_code = Column(String(50))
    process_id = Column(Integer, ForeignKey("mes_process.id"), nullable=False, index=True)
    equipment_id = Column(Integer, ForeignKey("mes_equipment.id"), nullable=True, index=True)
    plan_qty = Column(Float, default=0)
    unit = Column(String(20), default="ea")
    batch_count = Column(Integer)  # 판수량
    status = Column(String(20), default="planned", index=True)
    priority = Column(Integer, default=3)
    start_at = Column(DateTime)
    end_at = Column(DateTime)
    lot_no = Column(String(50))
    expiry_date = Column(Date)
    notes = Column(Text)
    created_by = Column(String(200))
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())


class MesWorkOrderWorker(Base):
    """작업지시-작업자 배정."""
    __tablename__ = "mes_work_order_worker"

    id = Column(Integer, primary_key=True, autoincrement=True)
    work_order_id = Column(Integer, ForeignKey("mes_work_order.id"), nullable=False, index=True)
    worker_id = Column(Integer, ForeignKey("mes_worker.id"), nullable=False, index=True)
    role = Column(String(50))
    joined_at = Column(DateTime, default=func.now())


class MesWorkResult(Base):
    """작업 실적."""
    __tablename__ = "mes_work_result"

    id = Column(Integer, primary_key=True, autoincrement=True)
    work_order_id = Column(Integer, ForeignKey("mes_work_order.id"), nullable=False, index=True)
    result_no = Column(String(50))
    start_at = Column(DateTime)
    end_at = Column(DateTime)
    prod_qty = Column(Float, default=0)
    good_qty = Column(Float, default=0)
    defect_qty = Column(Float, default=0)
    worker_id = Column(Integer, ForeignKey("mes_worker.id"), nullable=True)
    notes = Column(Text)
    created_at = Column(DateTime, default=func.now())


class MesDefect(Base):
    """불량 등록."""
    __tablename__ = "mes_defect"

    id = Column(Integer, primary_key=True, autoincrement=True)
    work_order_id = Column(Integer, ForeignKey("mes_work_order.id"), nullable=False, index=True)
    result_id = Column(Integer, ForeignKey("mes_work_result.id"), nullable=True)
    defect_code = Column(String(50))
    qty = Column(Float, default=0)
    notes = Column(Text)
    created_at = Column(DateTime, default=func.now())


class MesDowntime(Base):
    """비가동."""
    __tablename__ = "mes_downtime"

    id = Column(Integer, primary_key=True, autoincrement=True)
    work_order_id = Column(Integer, ForeignKey("mes_work_order.id"), nullable=True, index=True)
    equipment_id = Column(Integer, ForeignKey("mes_equipment.id"), nullable=True, index=True)
    downtime_code = Column(String(50))
    start_at = Column(DateTime)
    end_at = Column(DateTime)
    minutes = Column(Float)
    reason = Column(Text)
    created_at = Column(DateTime, default=func.now())


class MesMaterialIssue(Base):
    """자재 투입."""
    __tablename__ = "mes_material_issue"

    id = Column(Integer, primary_key=True, autoincrement=True)
    work_order_id = Column(Integer, ForeignKey("mes_work_order.id"), nullable=False, index=True)
    material_type = Column(String(20))  # raw/sub/semi
    material_id = Column(Integer, nullable=True)
    material_name = Column(String(300))
    qty = Column(Float, default=0)
    unit = Column(String(20))
    lot_no = Column(String(50))
    source = Column(String(20), default="manual")  # manual/bom(자동산출, from-bom 멱등 처리용)
    created_at = Column(DateTime, default=func.now())


# ──────────────────────────────────────────────
# POP 공정실행 / HACCP
# ──────────────────────────────────────────────

class MesProcessRun(Base):
    """POP 공정실행."""
    __tablename__ = "mes_process_run"

    id = Column(Integer, primary_key=True, autoincrement=True)
    run_date = Column(Date, nullable=False, index=True)
    process_id = Column(Integer, ForeignKey("mes_process.id"), nullable=False, index=True)
    equipment_id = Column(Integer, ForeignKey("mes_equipment.id"), nullable=True, index=True)
    work_order_id = Column(Integer, ForeignKey("mes_work_order.id"), nullable=True, index=True)
    family_code = Column(String(50))
    item_name = Column(String(200))
    input_kg = Column(Float)
    alcohol_g = Column(Float)
    limit_value = Column(Float)
    measured_value = Column(Float)
    start_at = Column(DateTime)
    end_at = Column(DateTime)
    minutes = Column(Float)
    judgment = Column(String(10))  # 적/부
    worker_id = Column(Integer, ForeignKey("mes_worker.id"), nullable=True)
    test_result = Column(String(20))  # pass/detect/test (금속검출)
    status = Column(String(20), default="running", index=True)  # running/done/deleted
    notes = Column(Text)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())


class MesDeviation(Base):
    """이탈·개선조치."""
    __tablename__ = "mes_deviation"

    id = Column(Integer, primary_key=True, autoincrement=True)
    run_id = Column(Integer, ForeignKey("mes_process_run.id"), nullable=True, index=True)
    work_order_id = Column(Integer, ForeignKey("mes_work_order.id"), nullable=True, index=True)
    process_id = Column(Integer, ForeignKey("mes_process.id"), nullable=True, index=True)
    equipment_id = Column(Integer, ForeignKey("mes_equipment.id"), nullable=True)
    occurred_at = Column(DateTime, default=func.now())
    deviation_code = Column(String(50))
    description = Column(Text)
    limit_value = Column(Float)
    measured_value = Column(Float)
    corrective_action = Column(Text)
    action_by = Column(String(200))
    action_at = Column(DateTime)
    status = Column(String(20), default="open", index=True)  # open/in_progress/closed
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())


class MesCcpLog(Base):
    """CCP 점검일지."""
    __tablename__ = "mes_ccp_log"
    __table_args__ = (
        UniqueConstraint("log_date", "process_id", "equipment_id", name="uq_mes_ccp_log_date_proc_eq"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    log_date = Column(Date, nullable=False, index=True)
    process_id = Column(Integer, ForeignKey("mes_process.id"), nullable=False, index=True)
    equipment_id = Column(Integer, ForeignKey("mes_equipment.id"), nullable=True, index=True)
    status = Column(String(20), default="draft", index=True)  # draft/submitted/approved/rejected
    author = Column(String(200))
    approver = Column(String(200))
    submitted_at = Column(DateTime)
    approved_at = Column(DateTime)
    reject_reason = Column(Text)
    summary_json = Column(Text)
    notes = Column(Text)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())


class MesChecklistTemplate(Base):
    """선행점검 템플릿."""
    __tablename__ = "mes_checklist_template"

    id = Column(Integer, primary_key=True, autoincrement=True)
    code = Column(String(50), unique=True, nullable=False, index=True)
    name = Column(String(200), nullable=False)
    category = Column(String(30))  # 선행요건/검수/위생/설비/기타
    cycle = Column(String(20), default="daily", index=True)  # daily/weekly/monthly/asneeded
    items_json = Column(Text)
    approval_json = Column(Text)
    is_active = Column(Boolean, default=True)
    sort_order = Column(Integer, default=0)
    notes = Column(Text)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())


class MesChecklistEntry(Base):
    """선행점검 일지."""
    __tablename__ = "mes_checklist_entry"
    __table_args__ = (
        UniqueConstraint("template_id", "check_date", "shift", name="uq_mes_checklist_entry"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    template_id = Column(Integer, ForeignKey("mes_checklist_template.id"), nullable=False, index=True)
    check_date = Column(Date, nullable=False, index=True)
    shift = Column(String(10), default="-")
    author = Column(String(200))
    status = Column(String(20), default="draft", index=True)  # draft/submitted/reviewed/approved/rejected
    reviewer = Column(String(200))
    approver = Column(String(200))
    results_json = Column(Text)
    remarks = Column(Text)
    deviation_count = Column(Integer, default=0)
    submitted_at = Column(DateTime)
    approved_at = Column(DateTime)
    reject_reason = Column(Text)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())


class MesEquipmentEvent(Base):
    """설비 이력(고장/수리/부품교체/점검/청소소독)."""
    __tablename__ = "mes_equipment_event"

    id = Column(Integer, primary_key=True, autoincrement=True)
    equipment_id = Column(Integer, ForeignKey("mes_equipment.id"), nullable=False, index=True)
    event_type = Column(String(20))
    event_date = Column(Date, nullable=False, index=True)
    description = Column(Text)
    part_name = Column(String(200))
    cost = Column(Float)
    done_by = Column(String(200))
    downtime_minutes = Column(Float)
    status = Column(String(20), default="open", index=True)  # open/closed
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())


class MesSensorReading(Base):
    """센서 값(IoT/PLC/POP 기록)."""
    __tablename__ = "mes_sensor_reading"

    id = Column(Integer, primary_key=True, autoincrement=True)
    equipment_id = Column(Integer, ForeignKey("mes_equipment.id"), nullable=False, index=True)
    ts = Column(DateTime, nullable=False, index=True)
    kind = Column(String(20), index=True)  # temp/metal_pass/metal_detect/metal_test/humidity
    value = Column(Float)
    source = Column(String(20), default="manual")  # pop/iot/manual
    created_at = Column(DateTime, default=func.now())


Index("ix_mes_sensor_reading_eq_ts", MesSensorReading.equipment_id, MesSensorReading.ts)
Index("ix_mes_process_run_date_status", MesProcessRun.run_date, MesProcessRun.status)
Index("ix_mes_work_order_date_status", MesWorkOrder.order_date, MesWorkOrder.status)
