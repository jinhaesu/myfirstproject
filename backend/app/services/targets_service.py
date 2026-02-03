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

    def get_targets_by_year_month_manager(self, year: int, month: Optional[int] = None, manager: Optional[str] = None) -> list[dict]:
        """특정 년도/월/책임자의 목표 조회"""
        db = self._get_db()
        try:
            query = db.query(Target).filter(Target.year == year)
            if manager and manager != 'all':
                query = query.filter(Target.manager == manager)
            targets = query.order_by(Target.created_at.desc()).all()
            return [self._target_to_dict(t) for t in targets]
        finally:
            self._close_db(db)

    def get_target_summary(self, year: int, month: Optional[int] = None, manager: Optional[str] = None) -> dict:
        """특정 년도/월의 목표 합계 계산 (책임자 필터 옵션)"""
        targets = self.get_targets_by_year_month_manager(year, month, manager)
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

    def get_sales_by_year_month_manager(self, year: int, month: Optional[int] = None, manager: Optional[str] = None) -> list[dict]:
        """특정 년도/월/책임자의 매출 현황 조회"""
        db = self._get_db()
        try:
            query = db.query(Sale).filter(Sale.year == year)
            if month:
                query = query.filter(Sale.month == month)
            if manager and manager != 'all':
                query = query.filter(Sale.manager == manager)
            sales = query.order_by(Sale.created_at.desc()).all()
            return [self._sale_to_dict(s) for s in sales]
        finally:
            self._close_db(db)

    def get_sales_summary_until_day(self, year: int, month: int, max_day: int, manager: Optional[str] = None) -> dict:
        """특정 년도/월의 매출 현황 합계 계산 - 특정 일까지만 (당일 기준 실시간 지표용)"""
        sales = self.get_sales_by_year_month_manager(year, month, manager)
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
                # max_day까지만 합산
                values = row[1:max_day + 1]  # 1일부터 max_day일까지
                for val in values:
                    summary[summary_key] += parse_number(val)

        return summary

    def get_sales_summary(self, year: int, month: int, manager: Optional[str] = None) -> dict:
        """특정 년도/월의 매출 현황 합계 계산 (책임자 필터 옵션)"""
        sales = self.get_sales_by_year_month_manager(year, month, manager)
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

    def get_comparison_data(self, year: int, month: int, manager: Optional[str] = None) -> dict:
        """목표 대비 실적, 전월 대비 계산 (책임자 필터 옵션)"""
        # 책임자가 선택되면 목표도 같은 책임자로 필터링
        target_summary = self.get_target_summary(year, month, manager)
        current_summary = self.get_sales_summary(year, month, manager)

        # 전월 데이터
        prev_month = month - 1 if month > 1 else 12
        prev_year = year if month > 1 else year - 1
        prev_summary = self.get_sales_summary(prev_year, prev_month, manager)

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

    def get_realtime_indicator(self, year: int, month: int, manager: Optional[str] = None) -> dict:
        """실시간 지표 계산 (당일 기준 목표 대비 달성률)"""
        import calendar

        today = datetime.now()
        current_day = today.day

        # 해당 월의 총 일수
        days_in_month = calendar.monthrange(year, month)[1]

        # 목표 데이터 (책임자 필터 적용)
        target_summary = self.get_target_summary(year, month, manager)

        # 당일 기준 목표 계산 (월 목표 / 총 일수 * 현재 일)
        # 선택한 년월이 현재 년월이면 오늘 날짜, 아니면 마지막 날
        if year == today.year and month == today.month:
            target_day = current_day
        else:
            target_day = days_in_month

        # 실적 데이터 - 당일까지만 합산 (책임자 필터 적용)
        current_summary = self.get_sales_summary_until_day(year, month, target_day, manager)

        daily_target_sales = (target_summary["total_sales"] / days_in_month * target_day) if days_in_month > 0 else 0
        daily_target_quantity = (target_summary["total_quantity"] / days_in_month * target_day) if days_in_month > 0 else 0
        daily_target_contribution = (target_summary["total_contribution"] / days_in_month * target_day) if days_in_month > 0 else 0
        daily_target_advertising = (target_summary["total_advertising"] / days_in_month * target_day) if days_in_month > 0 else 0

        def calc_rate(current: float, target: float) -> Optional[float]:
            if target == 0:
                return None
            return round((current / target) * 100, 1)

        return {
            "target_day": target_day,
            "days_in_month": days_in_month,
            "daily_target": {
                "total_sales": round(daily_target_sales, 0),
                "total_quantity": round(daily_target_quantity, 0),
                "total_contribution": round(daily_target_contribution, 0),
                "total_advertising": round(daily_target_advertising, 0),
            },
            "current": {
                "total_sales": current_summary["total_sales"],
                "total_quantity": current_summary["total_quantity"],
                "total_marketing": current_summary["total_marketing"],
                "total_contribution": current_summary["total_contribution"],
            },
            "achievement_rate": {
                "sales_rate": calc_rate(current_summary["total_sales"], daily_target_sales),
                "quantity_rate": calc_rate(current_summary["total_quantity"], daily_target_quantity),
                "contribution_rate": calc_rate(current_summary["total_contribution"], daily_target_contribution),
                "marketing_rate": calc_rate(current_summary["total_marketing"], daily_target_advertising),
            }
        }

    def get_daily_sales_data(self, year: int, month: int, manager: Optional[str] = None) -> dict:
        """일별 매출 데이터 (그래프용)"""
        import calendar

        today = datetime.now()
        days_in_month = calendar.monthrange(year, month)[1]

        # 당일 기준 일자 계산
        if year == today.year and month == today.month:
            target_day = today.day
        else:
            target_day = days_in_month

        sales = self.get_sales_by_year_month_manager(year, month, manager)

        # 일별 데이터 초기화
        daily_data = {
            "sales": [0.0] * days_in_month,
            "quantity": [0.0] * days_in_month,
            "contribution": [0.0] * days_in_month,
            "marketing": [0.0] * days_in_month,
        }

        kpi_mapping = {
            "매출": "sales",
            "판매량": "quantity",
            "공헌이익": "contribution",
            "광고선전비": "marketing",
        }

        for sale in sales:
            kpi_type = sale.get("kpi_type", "")
            data_key = kpi_mapping.get(kpi_type)
            if not data_key:
                continue

            grid_data = sale.get("grid_data", [])
            for row in grid_data:
                if not row or len(row) < 2:
                    continue
                # row[0]은 기준(행 이름), row[1:]은 일별 데이터
                values = row[1:]
                for day_idx, val in enumerate(values):
                    if day_idx < days_in_month:
                        daily_data[data_key][day_idx] += parse_number(val)

        # 누계 계산
        cumulative_data = {
            "sales": [],
            "quantity": [],
            "contribution": [],
            "marketing": [],
        }

        for key in cumulative_data:
            cumsum = 0
            for val in daily_data[key]:
                cumsum += val
                cumulative_data[key].append(cumsum)

        return {
            "days_in_month": days_in_month,
            "target_day": target_day,
            "daily": daily_data,
            "cumulative": cumulative_data,
        }

    def get_targets_by_manager(self, year: int, month: Optional[int] = None) -> dict:
        """책임자별 목표 데이터 집계"""
        targets = self.get_targets_by_year_month(year)
        manager_data: dict = {}

        kpi_mapping = {
            "매출": "sales",
            "판매량": "quantity",
            "공헌이익": "contribution",
            "광고선전비": "advertising",
        }

        for target in targets:
            manager = target.get("manager", "미지정")
            kpi_type = target.get("kpi_type", "")
            data_key = kpi_mapping.get(kpi_type)
            if not data_key:
                continue

            if manager not in manager_data:
                manager_data[manager] = {"sales": 0, "quantity": 0, "contribution": 0, "advertising": 0}

            grid_data = target.get("grid_data", [])
            for row in grid_data:
                if not row or len(row) < 2:
                    continue
                values = row[1:13]
                if month is not None and 1 <= month <= 12:
                    if len(values) >= month:
                        manager_data[manager][data_key] += parse_number(values[month - 1])
                else:
                    for val in values:
                        manager_data[manager][data_key] += parse_number(val)

        return {"by_manager": manager_data}

    def get_targets_by_criteria(self, year: int, month: Optional[int] = None) -> dict:
        """기준별 목표 데이터 집계 (grid_data의 행 기준)"""
        targets = self.get_targets_by_year_month(year)
        criteria_data: dict = {}

        kpi_mapping = {
            "매출": "sales",
            "판매량": "quantity",
            "공헌이익": "contribution",
            "광고선전비": "advertising",
        }

        for target in targets:
            kpi_type = target.get("kpi_type", "")
            data_key = kpi_mapping.get(kpi_type)
            if not data_key:
                continue

            grid_data = target.get("grid_data", [])
            for row in grid_data:
                if not row or len(row) < 2:
                    continue
                criteria = row[0] or "미지정"
                if criteria not in criteria_data:
                    criteria_data[criteria] = {"sales": 0, "quantity": 0, "contribution": 0, "advertising": 0}

                values = row[1:13]
                if month is not None and 1 <= month <= 12:
                    if len(values) >= month:
                        criteria_data[criteria][data_key] += parse_number(values[month - 1])
                else:
                    for val in values:
                        criteria_data[criteria][data_key] += parse_number(val)

        return {"by_criteria": criteria_data}

    def get_sales_by_manager(self, year: int, month: int) -> dict:
        """책임자별 매출 데이터 집계"""
        sales = self.get_sales_by_year_month(year, month)
        manager_data: dict = {}

        kpi_mapping = {
            "매출": "sales",
            "판매량": "quantity",
            "공헌이익": "contribution",
            "광고선전비": "marketing",
        }

        for sale in sales:
            manager = sale.get("manager", "미지정")
            kpi_type = sale.get("kpi_type", "")
            data_key = kpi_mapping.get(kpi_type)
            if not data_key:
                continue

            if manager not in manager_data:
                manager_data[manager] = {"sales": 0, "quantity": 0, "contribution": 0, "marketing": 0}

            grid_data = sale.get("grid_data", [])
            for row in grid_data:
                if not row or len(row) < 2:
                    continue
                values = row[1:]
                for val in values:
                    manager_data[manager][data_key] += parse_number(val)

        return {"by_manager": manager_data}

    def get_sales_by_criteria(self, year: int, month: int) -> dict:
        """기준별 매출 데이터 집계 (grid_data의 행 기준)"""
        sales = self.get_sales_by_year_month(year, month)
        criteria_data: dict = {}

        kpi_mapping = {
            "매출": "sales",
            "판매량": "quantity",
            "공헌이익": "contribution",
            "광고선전비": "marketing",
        }

        for sale in sales:
            kpi_type = sale.get("kpi_type", "")
            data_key = kpi_mapping.get(kpi_type)
            if not data_key:
                continue

            grid_data = sale.get("grid_data", [])
            for row in grid_data:
                if not row or len(row) < 2:
                    continue
                criteria = row[0] or "미지정"
                if criteria not in criteria_data:
                    criteria_data[criteria] = {"sales": 0, "quantity": 0, "contribution": 0, "marketing": 0}

                values = row[1:]
                for val in values:
                    criteria_data[criteria][data_key] += parse_number(val)

        return {"by_criteria": criteria_data}

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
