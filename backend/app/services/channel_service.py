"""채널별 매출 취합 서비스"""
import uuid
from datetime import datetime, date
from typing import Optional
from calendar import monthrange

from sqlalchemy.orm import Session
from sqlalchemy import func, and_

from app.database import SessionLocal, engine
from app.db_models import Channel, ChannelSales, ChannelSyncLog, ChannelUploadTemplate


# 기본 채널 목록 (초기 설정용)
DEFAULT_CHANNELS = [
    # 오픈마켓
    {"name": "카페24", "category": "오픈마켓", "integration_type": "api"},
    {"name": "스마트스토어", "category": "오픈마켓", "integration_type": "api"},
    {"name": "쿠팡 WING", "category": "오픈마켓", "integration_type": "api"},
    {"name": "쿠팡 로켓", "category": "오픈마켓", "integration_type": "api"},
    {"name": "11번가", "category": "오픈마켓", "integration_type": "api"},
    {"name": "지마켓", "category": "오픈마켓", "integration_type": "api"},
    {"name": "옥션", "category": "오픈마켓", "integration_type": "api"},
    {"name": "에이블리", "category": "오픈마켓", "integration_type": "api"},
    {"name": "알리익스프레스", "category": "오픈마켓", "integration_type": "api"},

    # 소셜커머스/버티컬
    {"name": "카카오선물하기", "category": "소셜커머스", "integration_type": "api"},
    {"name": "카카오톡스토어", "category": "소셜커머스", "integration_type": "api"},
    {"name": "카카오스타일", "category": "소셜커머스", "integration_type": "rpa"},
    {"name": "토스", "category": "소셜커머스", "integration_type": "rpa"},
    {"name": "올리브영", "category": "버티컬", "integration_type": "rpa"},
    {"name": "올웨이즈", "category": "버티컬", "integration_type": "rpa"},
    {"name": "마켓컬리", "category": "버티컬", "integration_type": "rpa"},
    {"name": "비마트", "category": "버티컬", "integration_type": "rpa"},

    # 홈쇼핑/TV
    {"name": "롯데 홈쇼핑", "category": "홈쇼핑", "integration_type": "rpa"},
    {"name": "GS 샵", "category": "홈쇼핑", "integration_type": "rpa"},
    {"name": "NS MALL", "category": "홈쇼핑", "integration_type": "rpa"},
    {"name": "신세계 TV 쇼핑", "category": "홈쇼핑", "integration_type": "rpa"},
    {"name": "CJ온스타일", "category": "홈쇼핑", "integration_type": "rpa"},

    # 백화점/오프라인
    {"name": "롯데온", "category": "백화점", "integration_type": "rpa"},
    {"name": "롯데 백화점", "category": "백화점", "integration_type": "manual"},

    # 복지몰
    {"name": "팔도감", "category": "복지몰", "integration_type": "manual"},
    {"name": "이지웰", "category": "복지몰", "integration_type": "manual"},
    {"name": "라이프케어", "category": "복지몰", "integration_type": "manual"},
    {"name": "삼성카드쇼핑", "category": "복지몰", "integration_type": "manual"},
    {"name": "농협몰", "category": "복지몰", "integration_type": "manual"},
    {"name": "베네피아", "category": "복지몰", "integration_type": "manual"},

    # 대형마트/편의점
    {"name": "홈플러스", "category": "대형마트", "integration_type": "manual"},
    {"name": "메가마트", "category": "대형마트", "integration_type": "manual"},
    {"name": "이마트", "category": "대형마트", "integration_type": "manual"},
    {"name": "GS25", "category": "편의점", "integration_type": "manual"},
    {"name": "CU", "category": "편의점", "integration_type": "manual"},

    # B2B/급식
    {"name": "삼성웰스토리", "category": "B2B", "integration_type": "manual"},
    {"name": "CJ프레시웨이", "category": "B2B", "integration_type": "manual"},
    {"name": "아워홈", "category": "B2B", "integration_type": "manual"},
]


def is_db_available() -> bool:
    """데이터베이스가 사용 가능한지 확인"""
    return engine is not None and SessionLocal is not None


class ChannelService:
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

    # === 채널 관리 ===
    def get_all_channels(self) -> list[dict]:
        """모든 채널 목록 조회"""
        db = self._get_db()
        try:
            channels = db.query(Channel).order_by(Channel.category, Channel.name).all()
            return [self._channel_to_dict(c) for c in channels]
        finally:
            self._close_db(db)

    def get_channel_by_id(self, channel_id: str) -> Optional[dict]:
        """ID로 채널 조회"""
        db = self._get_db()
        try:
            channel = db.query(Channel).filter(Channel.id == channel_id).first()
            return self._channel_to_dict(channel) if channel else None
        finally:
            self._close_db(db)

    def get_channel_by_name(self, name: str) -> Optional[dict]:
        """이름으로 채널 조회"""
        db = self._get_db()
        try:
            channel = db.query(Channel).filter(Channel.name == name).first()
            return self._channel_to_dict(channel) if channel else None
        finally:
            self._close_db(db)

    def create_channel(self, data: dict) -> dict:
        """채널 생성"""
        db = self._get_db()
        try:
            channel = Channel(
                id=str(uuid.uuid4()),
                name=data["name"],
                category=data.get("category", "기타"),
                integration_type=data.get("integration_type", "manual"),
                api_endpoint=data.get("api_endpoint"),
                credentials=data.get("credentials"),
                is_active=data.get("is_active", True),
                sync_schedule=data.get("sync_schedule"),
                config=data.get("config"),
            )
            db.add(channel)
            db.commit()
            db.refresh(channel)
            return self._channel_to_dict(channel)
        finally:
            self._close_db(db)

    def update_channel(self, channel_id: str, data: dict) -> Optional[dict]:
        """채널 수정"""
        db = self._get_db()
        try:
            channel = db.query(Channel).filter(Channel.id == channel_id).first()
            if not channel:
                return None

            for key in ["name", "category", "integration_type", "api_endpoint",
                        "credentials", "is_active", "sync_schedule", "config"]:
                if key in data:
                    setattr(channel, key, data[key])

            db.commit()
            db.refresh(channel)
            return self._channel_to_dict(channel)
        finally:
            self._close_db(db)

    def delete_channel(self, channel_id: str) -> bool:
        """채널 삭제"""
        db = self._get_db()
        try:
            channel = db.query(Channel).filter(Channel.id == channel_id).first()
            if not channel:
                return False
            db.delete(channel)
            db.commit()
            return True
        finally:
            self._close_db(db)

    def initialize_default_channels(self) -> list[dict]:
        """기본 채널 초기화"""
        db = self._get_db()
        try:
            created = []
            for ch_data in DEFAULT_CHANNELS:
                existing = db.query(Channel).filter(Channel.name == ch_data["name"]).first()
                if not existing:
                    channel = Channel(
                        id=str(uuid.uuid4()),
                        name=ch_data["name"],
                        category=ch_data["category"],
                        integration_type=ch_data["integration_type"],
                        is_active=True,
                    )
                    db.add(channel)
                    created.append(ch_data["name"])
            db.commit()
            return created
        finally:
            self._close_db(db)

    # === 채널 매출 데이터 ===
    def get_channel_sales(
        self,
        year: int,
        month: int,
        channel_id: Optional[str] = None,
        channel_name: Optional[str] = None,
    ) -> list[dict]:
        """채널별 매출 데이터 조회"""
        db = self._get_db()
        try:
            query = db.query(ChannelSales).filter(
                ChannelSales.year == year,
                ChannelSales.month == month,
            )
            if channel_id:
                query = query.filter(ChannelSales.channel_id == channel_id)
            if channel_name:
                query = query.filter(ChannelSales.channel_name == channel_name)

            sales = query.order_by(ChannelSales.sale_date).all()
            return [self._sales_to_dict(s) for s in sales]
        finally:
            self._close_db(db)

    def get_daily_summary(self, year: int, month: int) -> dict:
        """일별 전체 채널 매출 요약"""
        db = self._get_db()
        try:
            days_in_month = monthrange(year, month)[1]

            # 일별 합계 쿼리
            daily_query = db.query(
                ChannelSales.day,
                func.sum(ChannelSales.gross_sales).label("gross_sales"),
                func.sum(ChannelSales.net_sales).label("net_sales"),
                func.sum(ChannelSales.order_count).label("order_count"),
                func.sum(ChannelSales.quantity).label("quantity"),
            ).filter(
                ChannelSales.year == year,
                ChannelSales.month == month,
            ).group_by(ChannelSales.day).all()

            daily_data = {r.day: {
                "gross_sales": float(r.gross_sales or 0),
                "net_sales": float(r.net_sales or 0),
                "order_count": int(r.order_count or 0),
                "quantity": int(r.quantity or 0),
            } for r in daily_query}

            # 일별 배열 생성
            daily = []
            cumulative_gross = 0
            cumulative_net = 0
            cumulative_orders = 0
            cumulative_qty = 0

            for day in range(1, days_in_month + 1):
                day_data = daily_data.get(day, {
                    "gross_sales": 0, "net_sales": 0, "order_count": 0, "quantity": 0
                })
                cumulative_gross += day_data["gross_sales"]
                cumulative_net += day_data["net_sales"]
                cumulative_orders += day_data["order_count"]
                cumulative_qty += day_data["quantity"]

                daily.append({
                    "day": day,
                    "gross_sales": day_data["gross_sales"],
                    "net_sales": day_data["net_sales"],
                    "order_count": day_data["order_count"],
                    "quantity": day_data["quantity"],
                    "cumulative_gross": cumulative_gross,
                    "cumulative_net": cumulative_net,
                    "cumulative_orders": cumulative_orders,
                    "cumulative_qty": cumulative_qty,
                })

            return {
                "year": year,
                "month": month,
                "days_in_month": days_in_month,
                "daily": daily,
                "total": {
                    "gross_sales": cumulative_gross,
                    "net_sales": cumulative_net,
                    "order_count": cumulative_orders,
                    "quantity": cumulative_qty,
                }
            }
        finally:
            self._close_db(db)

    def get_channel_summary(self, year: int, month: int) -> list[dict]:
        """채널별 월간 매출 요약"""
        db = self._get_db()
        try:
            query = db.query(
                ChannelSales.channel_id,
                ChannelSales.channel_name,
                func.sum(ChannelSales.gross_sales).label("gross_sales"),
                func.sum(ChannelSales.net_sales).label("net_sales"),
                func.sum(ChannelSales.order_count).label("order_count"),
                func.sum(ChannelSales.quantity).label("quantity"),
                func.sum(ChannelSales.commission).label("commission"),
                func.count(ChannelSales.id).label("data_count"),
            ).filter(
                ChannelSales.year == year,
                ChannelSales.month == month,
            ).group_by(
                ChannelSales.channel_id,
                ChannelSales.channel_name,
            ).all()

            return [{
                "channel_id": r.channel_id,
                "channel_name": r.channel_name,
                "gross_sales": float(r.gross_sales or 0),
                "net_sales": float(r.net_sales or 0),
                "order_count": int(r.order_count or 0),
                "quantity": int(r.quantity or 0),
                "commission": float(r.commission or 0),
                "data_count": r.data_count,
            } for r in query]
        finally:
            self._close_db(db)

    def upsert_channel_sales(self, data: dict) -> dict:
        """채널 매출 데이터 생성 또는 업데이트"""
        db = self._get_db()
        try:
            # 기존 데이터 확인
            existing = db.query(ChannelSales).filter(
                ChannelSales.channel_id == data["channel_id"],
                ChannelSales.year == data["year"],
                ChannelSales.month == data["month"],
                ChannelSales.day == data["day"],
            ).first()

            if existing:
                # 업데이트
                for key in ["gross_sales", "net_sales", "order_count", "quantity",
                            "refund_amount", "commission", "shipping_cost",
                            "raw_data", "source", "sync_log_id"]:
                    if key in data:
                        setattr(existing, key, data[key])
                db.commit()
                db.refresh(existing)
                return self._sales_to_dict(existing)
            else:
                # 생성
                sale_date = datetime(data["year"], data["month"], data["day"])
                sales = ChannelSales(
                    id=str(uuid.uuid4()),
                    channel_id=data["channel_id"],
                    channel_name=data["channel_name"],
                    sale_date=sale_date,
                    year=data["year"],
                    month=data["month"],
                    day=data["day"],
                    gross_sales=data.get("gross_sales", 0),
                    net_sales=data.get("net_sales", 0),
                    order_count=data.get("order_count", 0),
                    quantity=data.get("quantity", 0),
                    refund_amount=data.get("refund_amount", 0),
                    commission=data.get("commission", 0),
                    shipping_cost=data.get("shipping_cost", 0),
                    raw_data=data.get("raw_data"),
                    source=data.get("source", "manual"),
                    sync_log_id=data.get("sync_log_id"),
                )
                db.add(sales)
                db.commit()
                db.refresh(sales)
                return self._sales_to_dict(sales)
        finally:
            self._close_db(db)

    def bulk_upsert_sales(self, sales_list: list[dict], sync_log_id: Optional[str] = None) -> dict:
        """대량 매출 데이터 생성/업데이트"""
        created = 0
        updated = 0
        errors = []

        for data in sales_list:
            try:
                if sync_log_id:
                    data["sync_log_id"] = sync_log_id
                result = self.upsert_channel_sales(data)
                if result:
                    # 간단히 created로 카운트 (실제로는 upsert 구분 필요)
                    created += 1
            except Exception as e:
                errors.append({"data": data, "error": str(e)})

        return {
            "created": created,
            "updated": updated,
            "errors": errors,
        }

    def delete_channel_sales(self, channel_id: str, year: int, month: int, day: Optional[int] = None) -> int:
        """채널 매출 데이터 삭제"""
        db = self._get_db()
        try:
            query = db.query(ChannelSales).filter(
                ChannelSales.channel_id == channel_id,
                ChannelSales.year == year,
                ChannelSales.month == month,
            )
            if day:
                query = query.filter(ChannelSales.day == day)

            count = query.delete()
            db.commit()
            return count
        finally:
            self._close_db(db)

    # === 동기화 로그 ===
    def create_sync_log(self, channel_id: str, channel_name: str, sync_type: str) -> dict:
        """동기화 로그 생성"""
        db = self._get_db()
        try:
            log = ChannelSyncLog(
                id=str(uuid.uuid4()),
                channel_id=channel_id,
                channel_name=channel_name,
                sync_type=sync_type,
                status="pending",
            )
            db.add(log)
            db.commit()
            db.refresh(log)
            return self._sync_log_to_dict(log)
        finally:
            self._close_db(db)

    def update_sync_log(self, log_id: str, data: dict) -> Optional[dict]:
        """동기화 로그 업데이트"""
        db = self._get_db()
        try:
            log = db.query(ChannelSyncLog).filter(ChannelSyncLog.id == log_id).first()
            if not log:
                return None

            for key in ["status", "completed_at", "records_processed",
                        "records_created", "records_updated", "error_message", "details"]:
                if key in data:
                    setattr(log, key, data[key])

            db.commit()
            db.refresh(log)
            return self._sync_log_to_dict(log)
        finally:
            self._close_db(db)

    def get_sync_log(self, log_id: str) -> Optional[dict]:
        """동기화 로그 단건 조회"""
        db = self._get_db()
        try:
            log = db.query(ChannelSyncLog).filter(ChannelSyncLog.id == log_id).first()
            return self._sync_log_to_dict(log)
        finally:
            self._close_db(db)

    def get_recent_sync_logs(self, channel_id: Optional[str] = None, limit: int = 20) -> list[dict]:
        """최근 동기화 로그 조회"""
        db = self._get_db()
        try:
            query = db.query(ChannelSyncLog)
            if channel_id:
                query = query.filter(ChannelSyncLog.channel_id == channel_id)
            logs = query.order_by(ChannelSyncLog.started_at.desc()).limit(limit).all()
            return [self._sync_log_to_dict(log) for log in logs]
        finally:
            self._close_db(db)

    # === 업로드 템플릿 ===
    def get_upload_templates(self, channel_id: Optional[str] = None) -> list[dict]:
        """업로드 템플릿 조회"""
        db = self._get_db()
        try:
            query = db.query(ChannelUploadTemplate)
            if channel_id:
                query = query.filter(ChannelUploadTemplate.channel_id == channel_id)
            templates = query.all()
            return [self._template_to_dict(t) for t in templates]
        finally:
            self._close_db(db)

    def create_upload_template(self, data: dict) -> dict:
        """업로드 템플릿 생성"""
        db = self._get_db()
        try:
            template = ChannelUploadTemplate(
                id=str(uuid.uuid4()),
                channel_id=data["channel_id"],
                channel_name=data["channel_name"],
                template_name=data["template_name"],
                column_mapping=data["column_mapping"],
                date_format=data.get("date_format", "%Y-%m-%d"),
                skip_rows=data.get("skip_rows", 0),
                sheet_name=data.get("sheet_name"),
                is_default=data.get("is_default", False),
            )
            db.add(template)
            db.commit()
            db.refresh(template)
            return self._template_to_dict(template)
        finally:
            self._close_db(db)

    # === Helper Methods ===
    def _channel_to_dict(self, channel: Channel) -> dict:
        if not channel:
            return None
        return {
            "id": channel.id,
            "name": channel.name,
            "category": channel.category,
            "integration_type": channel.integration_type,
            "api_endpoint": channel.api_endpoint,
            "is_active": channel.is_active,
            "sync_schedule": channel.sync_schedule,
            "last_synced_at": channel.last_synced_at.isoformat() if channel.last_synced_at else None,
            "config": channel.config,
            "created_at": channel.created_at.isoformat() if channel.created_at else None,
        }

    def _sales_to_dict(self, sales: ChannelSales) -> dict:
        if not sales:
            return None
        return {
            "id": sales.id,
            "channel_id": sales.channel_id,
            "channel_name": sales.channel_name,
            "sale_date": sales.sale_date.isoformat() if sales.sale_date else None,
            "year": sales.year,
            "month": sales.month,
            "day": sales.day,
            "gross_sales": float(sales.gross_sales or 0),
            "net_sales": float(sales.net_sales or 0),
            "order_count": int(sales.order_count or 0),
            "quantity": int(sales.quantity or 0),
            "refund_amount": float(sales.refund_amount or 0),
            "commission": float(sales.commission or 0),
            "shipping_cost": float(sales.shipping_cost or 0),
            "source": sales.source,
            "created_at": sales.created_at.isoformat() if sales.created_at else None,
        }

    def _sync_log_to_dict(self, log: ChannelSyncLog) -> dict:
        if not log:
            return None
        return {
            "id": log.id,
            "channel_id": log.channel_id,
            "channel_name": log.channel_name,
            "sync_type": log.sync_type,
            "status": log.status,
            "started_at": log.started_at.isoformat() if log.started_at else None,
            "completed_at": log.completed_at.isoformat() if log.completed_at else None,
            "records_processed": log.records_processed,
            "records_created": log.records_created,
            "records_updated": log.records_updated,
            "error_message": log.error_message,
            "details": log.details,
        }

    def _template_to_dict(self, template: ChannelUploadTemplate) -> dict:
        if not template:
            return None
        return {
            "id": template.id,
            "channel_id": template.channel_id,
            "channel_name": template.channel_name,
            "template_name": template.template_name,
            "column_mapping": template.column_mapping,
            "date_format": template.date_format,
            "skip_rows": template.skip_rows,
            "sheet_name": template.sheet_name,
            "is_default": template.is_default,
        }
