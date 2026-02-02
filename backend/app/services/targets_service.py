import os
import re
from datetime import datetime
from typing import Optional
import uuid

from sqlalchemy.orm import Session

from app.database import SessionLocal, engine
from app.db_models import Target, Sale


def parse_number(value) -> float:
    """문자열이나 숫자를 float로 변환 (쉼표, 원 등 제거)"""
    if value is None or value == '':
        return 0.0
    if isinstance(value, (int, float)):
        return float(value)
    # 문자열에서 숫자만 추출
    cleaned = re.sub(r'[^\d.-]', '', str(value))
    try:
        return float(cleaned) if cleaned else 0.0
    except ValueError:
        return 0.0


def is_db_available() -> bool:
    """데이터베이스가 사용 가능한지 확인"""
    return engine is not None and SessionLocal is not None


class TargetsService:
    def __init__(self, db: Optional[Session] = None):
        self._db = db

    def _get_db(self) -> Session:
        """데이터베이스 세션 가져오기"""
        if self._db:
            return self._db
        if not is_db_available():
            raise Exception("Database not configured")
        return SessionLocal()

    def _close_db(self, db: Session):
        """자체 생성한 세션만 닫기"""
        if not self._db:
            db.close()

    # === 목표 데이터 CRUD ===
    def get_all_targets(self) -> list[dict]:
        db = self._get_db()
        try:
            targets = db.query(Target).order_by(Target.created_at.desc()).all()
            return [self._target_to_dict(t) for t in targets]
        finally:
            self._close_db(db)

    def get_targets_by_year_month(self, year: int, month: Optional[int] = None) -> list[dict]:
        db = self._get_db()
        try:
            targets = db.query(Target).filter(Target.year == year).order_by(Target.created_at.desc()).all()
            return [self._target_to_dict(t) for t in targets]
        finally:
            self._close_db(db)

    def get_target_by_id(self, target_id: str) -> Optional[dict]:
        db = self._get_db()
        try:
            target = db.query(Target).filter(Target.id == target_id).first()
            return self._target_to_dict(target) if target else None
        finally:
            self._close_db(db)

    def create_target(self, data: dict) -> dict:
        db = self._get_db()
        try:
            new_target = Target(
                id=str(uuid.uuid4()),
                department=data.get("department", ""),
                year=data.get("year"),
                title=data.get("title", ""),
                manager=data.get("manager", ""),
                kpi_type=data.get("kpi_type", ""),
                grid_data=data.get("grid_data", []),
            )
            db.add(new_target)
            db.commit()
            db.refresh(new_target)
            return self._target_to_dict(new_target)
        finally:
            self._close_db(db)

    def update_target(self, target_id: str, data: dict) -> Optional[dict]:
        db = self._get_db()
        try:
            target = db.query(Target).filter(Target.id == target_id).first()
            if not target:
                return None

            if "department" in data:
                target.department = data["department"]
            if "year" in data:
                target.year = data["year"]
            if "title" in data:
                target.title = data["title"]
            if "manager" in data:
                target.manager = data["manager"]
            if "kpi_type" in data:
                target.kpi_type = data["kpi_type"]
            if "grid_data" in data:
                target.grid_data = data["grid_data"]

            db.commit()
            db.refresh(target)
            return self._target_to_dict(target)
        finally:
            self._close_db(db)

    def delete_target(self, target_id: str) -> bool:
        db = self._get_db()
        try:
            target = db.query(Target).filter(Target.id == target_id).first()
            if not target:
                return False
            db.delete(target)
            db.commit()
            return True
        finally:
            self._close_db(db)

    def get_target_summary(self, year: int, month: Optional[int] = None) -> dict:
        """특정 년도/월의 목표 합계 계산"""
        targets = self.get_targets_by_year_month(year)
        summary = {
            "total_sales": 0.0,
            "total_quantity": 0.0,
            "total_contribution": 0.0,
            "total_advertising": 0.0,
        }

        kpi_mapping = {
            "매출": "total_sales",
            "판매량": "total_quantity",
            "공헌이익": "total_contribution",
            "광고선전비": "total_advertising",
        }

        for target in targets:
            kpi_type = target.get("kpi_type", "")
            summary_key = kpi_mapping.get(kpi_type)
            if not summary_key:
                continue

            grid_data = target.get("grid_data", [])
            for row in grid_data:
                if not row or len(row) < 2:
                    continue
                # row[0]은 기준(행 이름), row[1:]은 1월~12월 데이터
                values = row[1:13]  # 최대 12개월
                if month is not None and 1 <= month <= 12:
                    # 특정 월의 값만
                    if len(values) >= month:
                        summary[summary_key] += parse_number(values[month - 1])
                else:
                    # 연간 합계
                    for val in values:
                        summary[summary_key] += parse_number(val)

        return summary

    def _target_to_dict(self, target: Target) -> dict:
        """Target 모델을 dict로 변환"""
        return {
            "id": target.id,
            "department": target.department,
            "year": target.year,
            "title": target.title,
            "manager": target.manager,
            "kpi_type": target.kpi_type,
            "grid_data": target.grid_data,
            "created_at": target.created_at.isoformat() if target.created_at else None,
            "updated_at": target.updated_at.isoformat() if target.updated_at else None,
        }

    # === 매출 현황 데이터 CRUD ===
    def get_all_sales(self) -> list[dict]:
        db = self._get_db()
        try:
            sales = db.query(Sale).order_by(Sale.created_at.desc()).all()
            return [self._sale_to_dict(s) for s in sales]
        finally:
            self._close_db(db)

    def get_sales_by_year_month(self, year: int, month: Optional[int] = None) -> list[dict]:
        db = self._get_db()
        try:
            query = db.query(Sale).filter(Sale.year == year)
            if month:
                query = query.filter(Sale.month == month)
            sales = query.order_by(Sale.created_at.desc()).all()
            return [self._sale_to_dict(s) for s in sales]
        finally:
            self._close_db(db)

    def get_sale_by_id(self, sale_id: str) -> Optional[dict]:
        db = self._get_db()
        try:
            sale = db.query(Sale).filter(Sale.id == sale_id).first()
            return self._sale_to_dict(sale) if sale else None
        finally:
            self._close_db(db)

    def create_sale(self, data: dict) -> dict:
        db = self._get_db()
        try:
            new_sale = Sale(
                id=str(uuid.uuid4()),
                year=data.get("year"),
                month=data.get("month"),
                title=data.get("title", ""),
                manager=data.get("manager", ""),
                kpi_type=data.get("kpi_type", ""),
                grid_data=data.get("grid_data", []),
            )
            db.add(new_sale)
            db.commit()
            db.refresh(new_sale)
            return self._sale_to_dict(new_sale)
        finally:
            self._close_db(db)

    def update_sale(self, sale_id: str, data: dict) -> Optional[dict]:
        db = self._get_db()
        try:
            sale = db.query(Sale).filter(Sale.id == sale_id).first()
            if not sale:
                return None

            if "year" in data:
                sale.year = data["year"]
            if "month" in data:
                sale.month = data["month"]
            if "title" in data:
                sale.title = data["title"]
            if "manager" in data:
                sale.manager = data["manager"]
            if "kpi_type" in data:
                sale.kpi_type = data["kpi_type"]
            if "grid_data" in data:
                sale.grid_data = data["grid_data"]

            db.commit()
            db.refresh(sale)
            return self._sale_to_dict(sale)
        finally:
            self._close_db(db)

    def delete_sale(self, sale_id: str) -> bool:
        db = self._get_db()
        try:
            sale = db.query(Sale).filter(Sale.id == sale_id).first()
            if not sale:
                return False
            db.delete(sale)
            db.commit()
            return True
        finally:
            self._close_db(db)

    def get_sales_summary(self, year: int, month: int) -> dict:
        """특정 년도/월의 매출 현황 합계 계산"""
        sales = self.get_sales_by_year_month(year, month)
        summary = {
            "total_sales": 0.0,
            "total_quantity": 0.0,
            "total_marketing": 0.0,
            "total_contribution": 0.0,
            "has_data": False,
        }

        kpi_mapping = {
            "매출": "total_sales",
            "판매량": "total_quantity",
            "광고선전비": "total_marketing",
            "공헌이익": "total_contribution",
        }

        for sale in sales:
            summary["has_data"] = True
            kpi_type = sale.get("kpi_type", "")
            summary_key = kpi_mapping.get(kpi_type)
            if not summary_key:
                continue

            grid_data = sale.get("grid_data", [])
            for row in grid_data:
                if not row or len(row) < 2:
                    continue
                # row[0]은 기준(행 이름), row[1:]은 일별 데이터
                values = row[1:]
                for val in values:
                    summary[summary_key] += parse_number(val)

        return summary

    def get_comparison_data(self, year: int, month: int) -> dict:
        """목표 대비 실적, 전월 대비 계산"""
        target_summary = self.get_target_summary(year, month)
        current_summary = self.get_sales_summary(year, month)

        # 전월 데이터
        prev_month = month - 1 if month > 1 else 12
        prev_year = year if month > 1 else year - 1
        prev_summary = self.get_sales_summary(prev_year, prev_month)

        def calc_rate(current: float, target: float) -> Optional[float]:
            if target == 0:
                return None
            return round((current / target) * 100, 1)

        def calc_change(current: float, prev: float, has_prev_data: bool) -> Optional[float]:
            if not has_prev_data:
                return None  # 전월 데이터 없음
            if prev == 0:
                return None
            return round(((current - prev) / prev) * 100, 1)

        return {
            "target": target_summary,
            "current": {
                "total_sales": current_summary["total_sales"],
                "total_quantity": current_summary["total_quantity"],
                "total_marketing": current_summary["total_marketing"],
                "total_contribution": current_summary["total_contribution"],
            },
            "previous": {
                "total_sales": prev_summary["total_sales"],
                "total_quantity": prev_summary["total_quantity"],
                "total_marketing": prev_summary["total_marketing"],
                "total_contribution": prev_summary["total_contribution"],
                "has_data": prev_summary["has_data"],
            },
            "vs_target": {
                "sales_rate": calc_rate(current_summary["total_sales"], target_summary["total_sales"]),
                "quantity_rate": calc_rate(current_summary["total_quantity"], target_summary["total_quantity"]),
                "contribution_rate": calc_rate(current_summary["total_contribution"], target_summary["total_contribution"]),
                "marketing_rate": calc_rate(current_summary["total_marketing"], target_summary["total_advertising"]),
            },
            "vs_previous": {
                "sales_change": calc_change(current_summary["total_sales"], prev_summary["total_sales"], prev_summary["has_data"]),
                "quantity_change": calc_change(current_summary["total_quantity"], prev_summary["total_quantity"], prev_summary["has_data"]),
                "contribution_change": calc_change(current_summary["total_contribution"], prev_summary["total_contribution"], prev_summary["has_data"]),
                "marketing_change": calc_change(current_summary["total_marketing"], prev_summary["total_marketing"], prev_summary["has_data"]),
                "has_data": prev_summary["has_data"],
            },
        }

    def _sale_to_dict(self, sale: Sale) -> dict:
        """Sale 모델을 dict로 변환"""
        return {
            "id": sale.id,
            "year": sale.year,
            "month": sale.month,
            "title": sale.title,
            "manager": sale.manager,
            "kpi_type": sale.kpi_type,
            "grid_data": sale.grid_data,
            "created_at": sale.created_at.isoformat() if sale.created_at else None,
            "updated_at": sale.updated_at.isoformat() if sale.updated_at else None,
        }
