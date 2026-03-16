"""월별 결산 매출 서비스"""
import uuid
from datetime import datetime, timezone
from typing import Optional
from calendar import monthrange

from sqlalchemy.orm import Session
from sqlalchemy import func, and_, case

from app.database import SessionLocal, engine
from app.db_models import (
    MonthlySettlement, SettlementRpaConfig, SettlementReport,
    SettlementCollectionLog, Channel
)


def is_db_available() -> bool:
    return engine is not None and SessionLocal is not None


class SettlementService:
    def __init__(self, db: Optional[Session] = None):
        self._db = db

    def _get_db(self) -> Session:
        if self._db:
            return self._db
        if not is_db_available():
            raise Exception("Database not configured")
        return SessionLocal()

    def _close_db(self, db: Session):
        if not self._db:
            db.close()

    # === 결산 데이터 CRUD ===
    def get_monthly_settlements(self, year: int, month: int) -> list[dict]:
        """특정 월의 전체 채널 결산 데이터 조회"""
        db = self._get_db()
        try:
            settlements = db.query(MonthlySettlement).filter(
                MonthlySettlement.year == year,
                MonthlySettlement.month == month,
            ).order_by(MonthlySettlement.category, MonthlySettlement.channel_name).all()
            return [self._settlement_to_dict(s) for s in settlements]
        finally:
            self._close_db(db)

    def get_settlement_by_channel(self, channel_id: str, year: int, month: int) -> Optional[dict]:
        """특정 채널의 특정 월 결산 데이터"""
        db = self._get_db()
        try:
            s = db.query(MonthlySettlement).filter(
                MonthlySettlement.channel_id == channel_id,
                MonthlySettlement.year == year,
                MonthlySettlement.month == month,
            ).first()
            return self._settlement_to_dict(s) if s else None
        finally:
            self._close_db(db)

    def get_yearly_settlements(self, year: int, channel_id: Optional[str] = None) -> list[dict]:
        """연간 월별 결산 데이터 (그래프용)"""
        db = self._get_db()
        try:
            query = db.query(MonthlySettlement).filter(MonthlySettlement.year == year)
            if channel_id:
                query = query.filter(MonthlySettlement.channel_id == channel_id)
            settlements = query.order_by(MonthlySettlement.month, MonthlySettlement.category).all()
            return [self._settlement_to_dict(s) for s in settlements]
        finally:
            self._close_db(db)

    def get_yearly_summary(self, year: int) -> dict:
        """연간 월별 요약 (카테고리별 합산)"""
        db = self._get_db()
        try:
            query = db.query(
                MonthlySettlement.month,
                MonthlySettlement.category,
                func.sum(MonthlySettlement.gross_sales).label("gross_sales"),
                func.sum(MonthlySettlement.net_sales).label("net_sales"),
                func.sum(MonthlySettlement.settlement_amount).label("settlement_amount"),
                func.sum(MonthlySettlement.commission).label("commission"),
                func.sum(MonthlySettlement.order_count).label("order_count"),
                func.count(MonthlySettlement.id).label("channel_count"),
            ).filter(
                MonthlySettlement.year == year
            ).group_by(
                MonthlySettlement.month,
                MonthlySettlement.category,
            ).all()

            # 월별로 그룹핑
            monthly = {}
            for r in query:
                if r.month not in monthly:
                    monthly[r.month] = {"month": r.month, "categories": {}, "total_gross": 0, "total_net": 0, "total_settlement": 0, "total_commission": 0, "total_orders": 0}
                monthly[r.month]["categories"][r.category] = {
                    "gross_sales": float(r.gross_sales or 0),
                    "net_sales": float(r.net_sales or 0),
                    "settlement_amount": float(r.settlement_amount or 0),
                    "commission": float(r.commission or 0),
                    "order_count": int(r.order_count or 0),
                    "channel_count": r.channel_count,
                }
                monthly[r.month]["total_gross"] += float(r.gross_sales or 0)
                monthly[r.month]["total_net"] += float(r.net_sales or 0)
                monthly[r.month]["total_settlement"] += float(r.settlement_amount or 0)
                monthly[r.month]["total_commission"] += float(r.commission or 0)
                monthly[r.month]["total_orders"] += int(r.order_count or 0)

            return {
                "year": year,
                "monthly": [monthly.get(m, {"month": m, "categories": {}, "total_gross": 0, "total_net": 0, "total_settlement": 0, "total_commission": 0, "total_orders": 0}) for m in range(1, 13)],
            }
        finally:
            self._close_db(db)

    def upsert_settlement(self, data: dict) -> dict:
        """결산 데이터 생성 또는 업데이트"""
        db = self._get_db()
        try:
            existing = db.query(MonthlySettlement).filter(
                MonthlySettlement.channel_id == data["channel_id"],
                MonthlySettlement.year == data["year"],
                MonthlySettlement.month == data["month"],
            ).first()

            if existing:
                for key in ["gross_sales", "net_sales", "settlement_amount", "commission",
                            "shipping_cost", "refund_amount", "order_count", "quantity",
                            "status", "source", "confirmed_by", "confirmed_at", "notes", "raw_data"]:
                    if key in data:
                        setattr(existing, key, data[key])
                db.commit()
                db.refresh(existing)
                return self._settlement_to_dict(existing)
            else:
                settlement = MonthlySettlement(
                    id=str(uuid.uuid4()),
                    channel_id=data["channel_id"],
                    channel_name=data["channel_name"],
                    category=data.get("category", "기타"),
                    year=data["year"],
                    month=data["month"],
                    gross_sales=data.get("gross_sales", 0),
                    net_sales=data.get("net_sales", 0),
                    settlement_amount=data.get("settlement_amount", 0),
                    commission=data.get("commission", 0),
                    shipping_cost=data.get("shipping_cost", 0),
                    refund_amount=data.get("refund_amount", 0),
                    order_count=data.get("order_count", 0),
                    quantity=data.get("quantity", 0),
                    status=data.get("status", "pending"),
                    source=data.get("source", "manual"),
                    notes=data.get("notes"),
                    raw_data=data.get("raw_data"),
                )
                db.add(settlement)
                db.commit()
                db.refresh(settlement)
                return self._settlement_to_dict(settlement)
        finally:
            self._close_db(db)

    def confirm_settlement(self, settlement_id: str, confirmed_by: str) -> Optional[dict]:
        """결산 데이터 확정"""
        db = self._get_db()
        try:
            s = db.query(MonthlySettlement).filter(MonthlySettlement.id == settlement_id).first()
            if not s:
                return None
            s.status = "confirmed"
            s.confirmed_by = confirmed_by
            s.confirmed_at = datetime.now(timezone.utc)
            db.commit()
            db.refresh(s)
            return self._settlement_to_dict(s)
        finally:
            self._close_db(db)

    def finalize_month(self, year: int, month: int, confirmed_by: str) -> dict:
        """해당 월 전체 결산 확정"""
        db = self._get_db()
        try:
            settlements = db.query(MonthlySettlement).filter(
                MonthlySettlement.year == year,
                MonthlySettlement.month == month,
            ).all()
            count = 0
            for s in settlements:
                s.status = "finalized"
                s.confirmed_by = confirmed_by
                s.confirmed_at = datetime.now(timezone.utc)
                count += 1
            db.commit()
            return {"finalized_count": count, "year": year, "month": month}
        finally:
            self._close_db(db)

    def delete_settlement(self, settlement_id: str) -> bool:
        """결산 데이터 삭제"""
        db = self._get_db()
        try:
            s = db.query(MonthlySettlement).filter(MonthlySettlement.id == settlement_id).first()
            if not s:
                return False
            db.delete(s)
            db.commit()
            return True
        finally:
            self._close_db(db)

    # === 비교 분석 ===
    def get_month_comparison(self, year: int, month: int) -> dict:
        """전월 대비 분석"""
        current = self.get_monthly_settlements(year, month)

        prev_year, prev_month = (year, month - 1) if month > 1 else (year - 1, 12)
        previous = self.get_monthly_settlements(prev_year, prev_month)

        prev_map = {s["channel_id"]: s for s in previous}

        comparison = []
        for curr in current:
            prev = prev_map.get(curr["channel_id"], {})
            prev_gross = prev.get("gross_sales", 0)
            curr_gross = curr["gross_sales"]
            change_rate = ((curr_gross - prev_gross) / prev_gross * 100) if prev_gross else 0

            comparison.append({
                **curr,
                "prev_gross_sales": prev_gross,
                "prev_net_sales": prev.get("net_sales", 0),
                "prev_settlement_amount": prev.get("settlement_amount", 0),
                "change_rate": round(change_rate, 1),
            })

        return {
            "year": year,
            "month": month,
            "prev_year": prev_year,
            "prev_month": prev_month,
            "channels": comparison,
        }

    # === RPA 설정 관리 ===
    def get_all_rpa_configs(self) -> list[dict]:
        """전체 RPA 설정 조회"""
        db = self._get_db()
        try:
            configs = db.query(SettlementRpaConfig).order_by(SettlementRpaConfig.channel_name).all()
            return [self._rpa_config_to_dict(c) for c in configs]
        finally:
            self._close_db(db)

    def get_rpa_config(self, channel_id: str) -> Optional[dict]:
        """채널별 RPA 설정 조회 (channel_id 또는 channel_name으로 검색)"""
        db = self._get_db()
        try:
            config = db.query(SettlementRpaConfig).filter(
                SettlementRpaConfig.channel_id == channel_id
            ).first()
            # channel_id로 못 찾으면 channel_name으로도 검색
            if not config:
                config = db.query(SettlementRpaConfig).filter(
                    SettlementRpaConfig.channel_name == channel_id
                ).first()
            return self._rpa_config_to_dict(config) if config else None
        finally:
            self._close_db(db)

    def upsert_rpa_config(self, data: dict) -> dict:
        """RPA 설정 생성/수정"""
        db = self._get_db()
        try:
            existing = db.query(SettlementRpaConfig).filter(
                SettlementRpaConfig.channel_id == data["channel_id"]
            ).first()

            if existing:
                for key in ["login_url", "login_id", "login_password", "selectors",
                            "settlement_url", "date_format", "download_type",
                            "excel_column_mapping", "excel_skip_rows", "excel_sheet_name",
                            "auto_collect_day", "is_enabled", "extra_config"]:
                    if key in data:
                        # 비밀번호는 빈 값이면 기존 값 유지 (초기화 방지)
                        if key == "login_password" and not data[key]:
                            continue
                        setattr(existing, key, data[key])
                db.commit()
                db.refresh(existing)
                return self._rpa_config_to_dict(existing)
            else:
                config = SettlementRpaConfig(
                    id=str(uuid.uuid4()),
                    channel_id=data["channel_id"],
                    channel_name=data["channel_name"],
                    login_url=data.get("login_url"),
                    login_id=data.get("login_id"),
                    login_password=data.get("login_password"),
                    selectors=data.get("selectors"),
                    settlement_url=data.get("settlement_url"),
                    date_format=data.get("date_format", "%Y-%m-%d"),
                    download_type=data.get("download_type", "scrape"),
                    excel_column_mapping=data.get("excel_column_mapping"),
                    excel_skip_rows=data.get("excel_skip_rows", 0),
                    excel_sheet_name=data.get("excel_sheet_name"),
                    auto_collect_day=data.get("auto_collect_day", 5),
                    is_enabled=data.get("is_enabled", True),
                    extra_config=data.get("extra_config"),
                )
                db.add(config)
                db.commit()
                db.refresh(config)
                return self._rpa_config_to_dict(config)
        finally:
            self._close_db(db)

    def delete_rpa_config(self, channel_id: str) -> bool:
        db = self._get_db()
        try:
            config = db.query(SettlementRpaConfig).filter(
                SettlementRpaConfig.channel_id == channel_id
            ).first()
            if not config:
                return False
            db.delete(config)
            db.commit()
            return True
        finally:
            self._close_db(db)

    # === 리포트 관리 ===
    def get_reports(self, year: Optional[int] = None) -> list[dict]:
        db = self._get_db()
        try:
            query = db.query(SettlementReport)
            if year:
                query = query.filter(SettlementReport.year == year)
            reports = query.order_by(SettlementReport.created_at.desc()).all()
            return [self._report_to_dict(r) for r in reports]
        finally:
            self._close_db(db)

    def create_report(self, data: dict) -> dict:
        db = self._get_db()
        try:
            report = SettlementReport(
                id=str(uuid.uuid4()),
                report_name=data["report_name"],
                year=data["year"],
                month=data["month"],
                recipients=data["recipients"],
                schedule_day=data.get("schedule_day", 10),
                schedule_time=data.get("schedule_time", "09:00"),
                is_auto_send=data.get("is_auto_send", False),
                include_channels=data.get("include_channels"),
                include_chart=data.get("include_chart", True),
                include_comparison=data.get("include_comparison", True),
                status="draft",
            )
            db.add(report)
            db.commit()
            db.refresh(report)
            return self._report_to_dict(report)
        finally:
            self._close_db(db)

    def update_report(self, report_id: str, data: dict) -> Optional[dict]:
        db = self._get_db()
        try:
            report = db.query(SettlementReport).filter(SettlementReport.id == report_id).first()
            if not report:
                return None
            for key in ["report_name", "recipients", "schedule_day", "schedule_time",
                        "is_auto_send", "include_channels", "include_chart",
                        "include_comparison", "status", "sent_at", "error_message"]:
                if key in data:
                    setattr(report, key, data[key])
            db.commit()
            db.refresh(report)
            return self._report_to_dict(report)
        finally:
            self._close_db(db)

    def delete_report(self, report_id: str) -> bool:
        db = self._get_db()
        try:
            report = db.query(SettlementReport).filter(SettlementReport.id == report_id).first()
            if not report:
                return False
            db.delete(report)
            db.commit()
            return True
        finally:
            self._close_db(db)

    # === 수집 로그 ===
    def create_collection_log(self, data: dict) -> dict:
        db = self._get_db()
        try:
            log = SettlementCollectionLog(
                id=str(uuid.uuid4()),
                channel_id=data["channel_id"],
                channel_name=data["channel_name"],
                year=data["year"],
                month=data["month"],
                collection_type=data["collection_type"],
                status="pending",
            )
            db.add(log)
            db.commit()
            db.refresh(log)
            return self._collection_log_to_dict(log)
        finally:
            self._close_db(db)

    def update_collection_log(self, log_id: str, data: dict) -> Optional[dict]:
        db = self._get_db()
        try:
            log = db.query(SettlementCollectionLog).filter(SettlementCollectionLog.id == log_id).first()
            if not log:
                return None
            for key in ["status", "completed_at", "settlement_amount", "error_message", "screenshot_path", "details"]:
                if key in data:
                    setattr(log, key, data[key])
            db.commit()
            db.refresh(log)
            return self._collection_log_to_dict(log)
        finally:
            self._close_db(db)

    def get_collection_logs(self, channel_id: Optional[str] = None, year: Optional[int] = None, month: Optional[int] = None, limit: int = 50) -> list[dict]:
        db = self._get_db()
        try:
            query = db.query(SettlementCollectionLog)
            if channel_id:
                query = query.filter(SettlementCollectionLog.channel_id == channel_id)
            if year:
                query = query.filter(SettlementCollectionLog.year == year)
            if month:
                query = query.filter(SettlementCollectionLog.month == month)
            logs = query.order_by(SettlementCollectionLog.started_at.desc()).limit(limit).all()
            return [self._collection_log_to_dict(l) for l in logs]
        finally:
            self._close_db(db)

    # === Helper Methods ===
    def _settlement_to_dict(self, s: MonthlySettlement) -> dict:
        if not s:
            return None
        return {
            "id": s.id,
            "channel_id": s.channel_id,
            "channel_name": s.channel_name,
            "category": s.category,
            "year": s.year,
            "month": s.month,
            "gross_sales": float(s.gross_sales or 0),
            "net_sales": float(s.net_sales or 0),
            "settlement_amount": float(s.settlement_amount or 0),
            "commission": float(s.commission or 0),
            "shipping_cost": float(s.shipping_cost or 0),
            "refund_amount": float(s.refund_amount or 0),
            "order_count": int(s.order_count or 0),
            "quantity": int(s.quantity or 0),
            "status": s.status,
            "source": s.source,
            "confirmed_by": s.confirmed_by,
            "confirmed_at": s.confirmed_at.isoformat() if s.confirmed_at else None,
            "notes": s.notes,
            "created_at": s.created_at.isoformat() if s.created_at else None,
            "updated_at": s.updated_at.isoformat() if s.updated_at else None,
        }

    def _rpa_config_to_dict(self, c: SettlementRpaConfig) -> dict:
        if not c:
            return None
        return {
            "id": c.id,
            "channel_id": c.channel_id,
            "channel_name": c.channel_name,
            "login_url": c.login_url,
            "login_id": c.login_id,
            "has_password": bool(c.login_password),  # 비밀번호는 마스킹
            "selectors": c.selectors,
            "settlement_url": c.settlement_url,
            "date_format": c.date_format,
            "download_type": c.download_type,
            "excel_column_mapping": c.excel_column_mapping,
            "excel_skip_rows": c.excel_skip_rows,
            "excel_sheet_name": c.excel_sheet_name,
            "auto_collect_day": c.auto_collect_day,
            "is_enabled": c.is_enabled,
            "last_collected_at": c.last_collected_at.isoformat() if c.last_collected_at else None,
            "extra_config": c.extra_config,
        }

    def _report_to_dict(self, r: SettlementReport) -> dict:
        if not r:
            return None
        return {
            "id": r.id,
            "report_name": r.report_name,
            "year": r.year,
            "month": r.month,
            "recipients": r.recipients,
            "schedule_day": r.schedule_day,
            "schedule_time": r.schedule_time,
            "is_auto_send": r.is_auto_send,
            "include_channels": r.include_channels,
            "include_chart": r.include_chart,
            "include_comparison": r.include_comparison,
            "status": r.status,
            "sent_at": r.sent_at.isoformat() if r.sent_at else None,
            "error_message": r.error_message,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }

    def _collection_log_to_dict(self, l: SettlementCollectionLog) -> dict:
        if not l:
            return None
        return {
            "id": l.id,
            "channel_id": l.channel_id,
            "channel_name": l.channel_name,
            "year": l.year,
            "month": l.month,
            "collection_type": l.collection_type,
            "status": l.status,
            "started_at": l.started_at.isoformat() if l.started_at else None,
            "completed_at": l.completed_at.isoformat() if l.completed_at else None,
            "settlement_amount": float(l.settlement_amount) if l.settlement_amount else None,
            "error_message": l.error_message,
            "screenshot_path": l.screenshot_path,
            "details": l.details,
        }
