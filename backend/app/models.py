from sqlalchemy import Column, Integer, String, DateTime, JSON
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
