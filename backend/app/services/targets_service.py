import json
import os
from datetime import datetime
from typing import Optional
from pathlib import Path
import uuid


DATA_DIR = Path(__file__).parent.parent.parent / "data"
TARGETS_FILE = DATA_DIR / "targets.json"
SALES_FILE = DATA_DIR / "sales.json"


def ensure_data_dir():
    """데이터 디렉토리 생성"""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not TARGETS_FILE.exists():
        TARGETS_FILE.write_text("[]", encoding="utf-8")
    if not SALES_FILE.exists():
        SALES_FILE.write_text("[]", encoding="utf-8")


class TargetsService:
    def __init__(self):
        ensure_data_dir()

    def _load_targets(self) -> list[dict]:
        try:
            return json.loads(TARGETS_FILE.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, FileNotFoundError):
            return []

    def _save_targets(self, targets: list[dict]):
        TARGETS_FILE.write_text(json.dumps(targets, ensure_ascii=False, indent=2), encoding="utf-8")

    def _load_sales(self) -> list[dict]:
        try:
            return json.loads(SALES_FILE.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, FileNotFoundError):
            return []

    def _save_sales(self, sales: list[dict]):
        SALES_FILE.write_text(json.dumps(sales, ensure_ascii=False, indent=2), encoding="utf-8")

    # === 목표 데이터 CRUD ===
    def get_all_targets(self) -> list[dict]:
        return self._load_targets()

    def get_targets_by_year_month(self, year: int, month: Optional[int] = None) -> list[dict]:
        targets = self._load_targets()
        filtered = [t for t in targets if t.get("year") == year]
        return filtered

    def get_target_by_id(self, target_id: str) -> Optional[dict]:
        targets = self._load_targets()
        for t in targets:
            if t.get("id") == target_id:
                return t
        return None

    def create_target(self, data: dict) -> dict:
        targets = self._load_targets()
        new_target = {
            "id": str(uuid.uuid4()),
            "department": data.get("department", ""),
            "year": data.get("year"),
            "title": data.get("title", ""),
            "manager": data.get("manager", ""),
            "kpi_type": data.get("kpi_type", ""),  # 매출, 광고선전비, 공헌이익, 판매량
            "grid_data": data.get("grid_data", []),  # 엑셀 그리드 데이터
            "created_at": datetime.utcnow().isoformat(),
            "updated_at": datetime.utcnow().isoformat(),
        }
        targets.append(new_target)
        self._save_targets(targets)
        return new_target

    def update_target(self, target_id: str, data: dict) -> Optional[dict]:
        targets = self._load_targets()
        for i, t in enumerate(targets):
            if t.get("id") == target_id:
                targets[i].update({
                    "department": data.get("department", t.get("department")),
                    "year": data.get("year", t.get("year")),
                    "title": data.get("title", t.get("title")),
                    "manager": data.get("manager", t.get("manager")),
                    "kpi_type": data.get("kpi_type", t.get("kpi_type")),
                    "grid_data": data.get("grid_data", t.get("grid_data")),
                    "updated_at": datetime.utcnow().isoformat(),
                })
                self._save_targets(targets)
                return targets[i]
        return None

    def delete_target(self, target_id: str) -> bool:
        targets = self._load_targets()
        new_targets = [t for t in targets if t.get("id") != target_id]
        if len(new_targets) < len(targets):
            self._save_targets(new_targets)
            return True
        return False

    def get_target_summary(self, year: int, month: Optional[int] = None) -> dict:
        """특정 년도/월의 목표 합계 계산"""
        targets = self._load_targets()
        summary = {
            "total_sales": 0,
            "total_quantity": 0,
            "total_contribution": 0,
            "total_advertising": 0,
        }

        kpi_mapping = {
            "매출": "total_sales",
            "판매량": "total_quantity",
            "공헌이익": "total_contribution",
            "광고선전비": "total_advertising",
        }

        for target in targets:
            if target.get("year") != year:
                continue

            kpi_type = target.get("kpi_type", "")
            summary_key = kpi_mapping.get(kpi_type)
            if not summary_key:
                continue

            grid_data = target.get("grid_data", [])
            for row in grid_data:
                if not row:
                    continue
                # row[0]은 기준(행 이름), row[1:]은 1월~12월 데이터
                values = row[1:] if len(row) > 1 else []
                if month is not None and 1 <= month <= 12:
                    # 특정 월의 값만
                    if len(values) >= month:
                        try:
                            summary[summary_key] += float(values[month - 1] or 0)
                        except (ValueError, TypeError):
                            pass
                else:
                    # 연간 합계
                    for val in values[:12]:
                        try:
                            summary[summary_key] += float(val or 0)
                        except (ValueError, TypeError):
                            pass

        return summary

    # === 매출 현황 데이터 CRUD ===
    def get_all_sales(self) -> list[dict]:
        return self._load_sales()

    def get_sales_by_year_month(self, year: int, month: Optional[int] = None) -> list[dict]:
        sales = self._load_sales()
        if month:
            return [s for s in sales if s.get("year") == year and s.get("month") == month]
        return [s for s in sales if s.get("year") == year]

    def get_sale_by_id(self, sale_id: str) -> Optional[dict]:
        sales = self._load_sales()
        for s in sales:
            if s.get("id") == sale_id:
                return s
        return None

    def create_sale(self, data: dict) -> dict:
        sales = self._load_sales()
        new_sale = {
            "id": str(uuid.uuid4()),
            "year": data.get("year"),
            "month": data.get("month"),
            "title": data.get("title", ""),
            "manager": data.get("manager", ""),
            "kpi_type": data.get("kpi_type", ""),
            "grid_data": data.get("grid_data", []),  # 일별 데이터
            "created_at": datetime.utcnow().isoformat(),
            "updated_at": datetime.utcnow().isoformat(),
        }
        sales.append(new_sale)
        self._save_sales(sales)
        return new_sale

    def update_sale(self, sale_id: str, data: dict) -> Optional[dict]:
        sales = self._load_sales()
        for i, s in enumerate(sales):
            if s.get("id") == sale_id:
                sales[i].update({
                    "year": data.get("year", s.get("year")),
                    "month": data.get("month", s.get("month")),
                    "title": data.get("title", s.get("title")),
                    "manager": data.get("manager", s.get("manager")),
                    "kpi_type": data.get("kpi_type", s.get("kpi_type")),
                    "grid_data": data.get("grid_data", s.get("grid_data")),
                    "updated_at": datetime.utcnow().isoformat(),
                })
                self._save_sales(sales)
                return sales[i]
        return None

    def delete_sale(self, sale_id: str) -> bool:
        sales = self._load_sales()
        new_sales = [s for s in sales if s.get("id") != sale_id]
        if len(new_sales) < len(sales):
            self._save_sales(new_sales)
            return True
        return False

    def get_sales_summary(self, year: int, month: int) -> dict:
        """특정 년도/월의 매출 현황 합계 계산"""
        sales = self._load_sales()
        summary = {
            "total_sales": 0,
            "total_quantity": 0,
            "total_marketing": 0,
            "total_contribution": 0,
        }

        kpi_mapping = {
            "매출": "total_sales",
            "판매량": "total_quantity",
            "광고선전비": "total_marketing",
            "공헌이익": "total_contribution",
        }

        for sale in sales:
            if sale.get("year") != year or sale.get("month") != month:
                continue

            kpi_type = sale.get("kpi_type", "")
            summary_key = kpi_mapping.get(kpi_type)
            if not summary_key:
                continue

            grid_data = sale.get("grid_data", [])
            for row in grid_data:
                if not row:
                    continue
                # row[0]은 기준(행 이름), row[1:]은 일별 데이터
                values = row[1:] if len(row) > 1 else []
                for val in values:
                    try:
                        summary[summary_key] += float(val or 0)
                    except (ValueError, TypeError):
                        pass

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

        def calc_change(current: float, prev: float) -> Optional[float]:
            if prev == 0:
                return None
            return round(((current - prev) / prev) * 100, 1)

        return {
            "target": target_summary,
            "current": current_summary,
            "previous": prev_summary,
            "vs_target": {
                "sales_rate": calc_rate(current_summary["total_sales"], target_summary["total_sales"]),
                "quantity_rate": calc_rate(current_summary["total_quantity"], target_summary["total_quantity"]),
                "contribution_rate": calc_rate(current_summary["total_contribution"], target_summary["total_contribution"]),
                "marketing_rate": calc_rate(current_summary["total_marketing"], target_summary["total_advertising"]),
            },
            "vs_previous": {
                "sales_change": calc_change(current_summary["total_sales"], prev_summary["total_sales"]),
                "quantity_change": calc_change(current_summary["total_quantity"], prev_summary["total_quantity"]),
                "contribution_change": calc_change(current_summary["total_contribution"], prev_summary["total_contribution"]),
                "marketing_change": calc_change(current_summary["total_marketing"], prev_summary["total_marketing"]),
            },
        }
