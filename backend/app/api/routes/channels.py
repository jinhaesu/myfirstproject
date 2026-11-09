"""채널별 매출 취합 API"""
import io
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Form
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel

from app.services.channel_service import ChannelService
from app.services.auth_service import AuthService

router = APIRouter(prefix="/channels", tags=["channels"])
security = HTTPBearer()


def get_auth_service() -> AuthService:
    return AuthService()


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    auth_service: AuthService = Depends(get_auth_service)
) -> dict:
    token = credentials.credentials
    payload = auth_service.verify_token(token)
    if payload is None:
        raise HTTPException(status_code=401, detail="유효하지 않은 토큰입니다")
    return {"email": payload.get("sub")}


def get_channel_service() -> ChannelService:
    return ChannelService()


# === Pydantic Models ===
class ChannelCreate(BaseModel):
    name: str
    category: str = "기타"
    integration_type: str = "manual"
    api_endpoint: Optional[str] = None
    is_active: bool = True
    sync_schedule: Optional[str] = None
    config: Optional[dict] = None


class ChannelUpdate(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    integration_type: Optional[str] = None
    api_endpoint: Optional[str] = None
    is_active: Optional[bool] = None
    sync_schedule: Optional[str] = None
    config: Optional[dict] = None


class ChannelSalesCreate(BaseModel):
    channel_id: str
    channel_name: str
    year: int
    month: int
    day: int
    gross_sales: float = 0
    net_sales: float = 0
    order_count: int = 0
    quantity: int = 0
    refund_amount: float = 0
    commission: float = 0
    shipping_cost: float = 0
    source: str = "manual"


class BulkSalesUpload(BaseModel):
    channel_id: str
    channel_name: str
    year: int
    month: int
    sales_data: list[dict]  # [{day, gross_sales, net_sales, ...}, ...]


# === 채널 관리 API ===
@router.get("")
async def list_channels(
    _: dict = Depends(get_current_user),
    service: ChannelService = Depends(get_channel_service)
):
    """모든 채널 목록 조회"""
    return service.get_all_channels()


@router.post("")
async def create_channel(
    data: ChannelCreate,
    _: dict = Depends(get_current_user),
    service: ChannelService = Depends(get_channel_service)
):
    """채널 생성"""
    existing = service.get_channel_by_name(data.name)
    if existing:
        raise HTTPException(status_code=400, detail="이미 존재하는 채널명입니다")
    return service.create_channel(data.model_dump())


@router.get("/initialize")
async def initialize_channels(
    _: dict = Depends(get_current_user),
    service: ChannelService = Depends(get_channel_service)
):
    """기본 채널 초기화"""
    created = service.initialize_default_channels()
    return {"message": f"{len(created)}개 채널 생성됨", "created": created}


@router.get("/{channel_id}")
async def get_channel(
    channel_id: str,
    _: dict = Depends(get_current_user),
    service: ChannelService = Depends(get_channel_service)
):
    """채널 상세 조회"""
    channel = service.get_channel_by_id(channel_id)
    if not channel:
        raise HTTPException(status_code=404, detail="채널을 찾을 수 없습니다")
    return channel


@router.put("/{channel_id}")
async def update_channel(
    channel_id: str,
    data: ChannelUpdate,
    _: dict = Depends(get_current_user),
    service: ChannelService = Depends(get_channel_service)
):
    """채널 수정"""
    result = service.update_channel(channel_id, data.model_dump(exclude_unset=True))
    if not result:
        raise HTTPException(status_code=404, detail="채널을 찾을 수 없습니다")
    return result


@router.delete("/{channel_id}")
async def delete_channel(
    channel_id: str,
    _: dict = Depends(get_current_user),
    service: ChannelService = Depends(get_channel_service)
):
    """채널 삭제"""
    if not service.delete_channel(channel_id):
        raise HTTPException(status_code=404, detail="채널을 찾을 수 없습니다")
    return {"message": "삭제되었습니다"}


# === 채널 매출 API (조회) ===
# 2026-11-09: 예전 ChannelSales 표(0행)를 읽어 팀 API·AI 연동에서 "매출이 비어 있다"는 문제가 났다.
# 실제 매출은 CSA 집계표(csa_sales_daily_product)에 있으므로 조회 3종은 그쪽을 읽는다.
# 매출 = 공급가(VAT 별도) 기준, 매출차감형 월정액(revenue_deduction)을 뺀 값 — CSA 대시보드와 같은 기준.
# year·month는 선택: 없으면 이번 달. start/end(YYYY-MM-DD)를 주면 그 기간이 우선.
from datetime import date as _date, timedelta as _td
from sqlalchemy import func as _sf
from sqlalchemy.orm import Session
from app.database import get_db
from app.db_models import ChannelSalesDailyProduct as _D

_BASIS = "공급가(VAT 별도), 매출차감형 월정액 차감, 취소·반품 반영 — CSA 대시보드 기준"


def _period(year: Optional[int], month: Optional[int], start: Optional[str], end: Optional[str]):
    try:
        if start or end:
            s = _date.fromisoformat(start) if start else None
            e = _date.fromisoformat(end) if end else None
            if s and not e:
                e = _date.today()
            if e and not s:
                s = e.replace(day=1)
        else:
            t = _date.today()
            if year is not None and month is None:
                s, e = _date(year, 1, 1), _date(year, 12, 31)  # 연도만 주면 그 해 전체
            else:
                y, m = (year or t.year), (month or t.month)
                s = _date(y, m, 1)
                e = _date(y + (m == 12), m % 12 + 1, 1) - _td(days=1)
    except ValueError:
        raise HTTPException(status_code=400, detail="날짜 형식은 YYYY-MM-DD, month는 1~12 입니다")
    if s > e:
        raise HTTPException(status_code=400, detail="start가 end보다 늦습니다")
    if (e - s).days > 400:
        raise HTTPException(status_code=400, detail="한 번에 조회할 수 있는 기간은 400일까지입니다")
    return s, e


def _rev():
    return _sf.coalesce(_sf.sum(_D.net_sales - _sf.coalesce(_D.revenue_deduction, 0.0)), 0.0)


def _meta(db: Session, s, e, **extra):
    last = db.query(_sf.max(_D.sale_date)).scalar()
    return {"period_start": s.isoformat(), "period_end": e.isoformat(),
            "data_as_of": last.isoformat() if last else None, "basis": _BASIS, **extra}


def _channel_filter(q, channel_id, channel_name):
    if channel_id:
        q = q.filter(_D.channel_id == channel_id)
    if channel_name:
        q = q.filter(_sf.replace(_D.channel_name, " ", "").ilike(f"%{channel_name.replace(' ', '')}%"))
    return q


@router.get("/sales/summary")
async def get_sales_summary(
    year: Optional[int] = None,
    month: Optional[int] = None,
    start: Optional[str] = None,
    end: Optional[str] = None,
    channel_id: Optional[str] = None,
    channel_name: Optional[str] = None,
    _: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """일별 전체 매출 요약 (매출·판매량(낱개)·주문수)"""
    s, e = _period(year, month, start, end)
    q = db.query(_D.sale_date, _rev(), _sf.coalesce(_sf.sum(_D.pcs_qty), 0.0),
                 _sf.coalesce(_sf.sum(_D.raw_qty), 0.0), _sf.coalesce(_sf.sum(_D.order_count), 0))
    q = _channel_filter(q.filter(_D.sale_date >= s, _D.sale_date <= e), channel_id, channel_name)
    rows = q.group_by(_D.sale_date).order_by(_D.sale_date).all()
    days = [{"date": d.isoformat(), "net_sales": round(r), "pcs_qty": round(p), "raw_qty": round(rq), "order_count": int(o)}
            for d, r, p, rq, o in rows]
    total = {"net_sales": sum(x["net_sales"] for x in days), "pcs_qty": sum(x["pcs_qty"] for x in days),
             "raw_qty": sum(x["raw_qty"] for x in days), "order_count": sum(x["order_count"] for x in days)}
    return {**_meta(db, s, e), "total": total, "days": days}


@router.get("/sales/by-channel")
async def get_sales_by_channel(
    year: Optional[int] = None,
    month: Optional[int] = None,
    start: Optional[str] = None,
    end: Optional[str] = None,
    _: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """채널별 기간 매출 요약"""
    s, e = _period(year, month, start, end)
    rows = (
        db.query(_D.channel_id, _D.channel_name, _D.channel_category, _rev(),
                 _sf.coalesce(_sf.sum(_D.pcs_qty), 0.0), _sf.coalesce(_sf.sum(_D.raw_qty), 0.0),
                 _sf.coalesce(_sf.sum(_D.order_count), 0), _sf.max(_D.sale_date))
        .filter(_D.sale_date >= s, _D.sale_date <= e)
        .group_by(_D.channel_id, _D.channel_name, _D.channel_category)
        .all()
    )
    chans = sorted(
        [{"channel_id": cid, "channel_name": nm, "category": cat, "net_sales": round(r), "pcs_qty": round(p),
          "raw_qty": round(rq), "order_count": int(o), "last_sale_date": last.isoformat() if last else None}
         for cid, nm, cat, r, p, rq, o, last in rows],
        key=lambda x: -x["net_sales"],
    )
    total = {"net_sales": sum(x["net_sales"] for x in chans), "pcs_qty": sum(x["pcs_qty"] for x in chans),
             "order_count": sum(x["order_count"] for x in chans)}
    return {**_meta(db, s, e), "total": total, "channels": chans}


@router.get("/sales/detail")
async def get_sales_detail(
    year: Optional[int] = None,
    month: Optional[int] = None,
    start: Optional[str] = None,
    end: Optional[str] = None,
    channel_id: Optional[str] = None,
    channel_name: Optional[str] = None,
    group_by: str = "day",
    _: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """채널별 매출 상세. group_by=day(일×채널, 기본) | product(품목별 합계) | day_product(일×품목)"""
    s, e = _period(year, month, start, end)
    if group_by not in ("day", "product", "day_product"):
        raise HTTPException(status_code=400, detail="group_by는 day, product, day_product 중 하나")
    keys = [_D.channel_id, _D.channel_name]
    if group_by in ("day", "day_product"):
        keys.insert(0, _D.sale_date)
    if group_by in ("product", "day_product"):
        keys.append(_D.product_name)
    q = db.query(*keys, _rev(), _sf.coalesce(_sf.sum(_D.pcs_qty), 0.0), _sf.coalesce(_sf.sum(_D.raw_qty), 0.0),
                 _sf.coalesce(_sf.sum(_D.order_count), 0))
    q = _channel_filter(q.filter(_D.sale_date >= s, _D.sale_date <= e), channel_id, channel_name)
    rows = q.group_by(*keys).order_by(*keys).limit(20000).all()
    names = [k.key for k in keys]
    items = []
    for r in rows:
        d = dict(zip(names, r[: len(names)]))
        if "sale_date" in d:
            d["date"] = d.pop("sale_date").isoformat()
        rv, p, rq, o = r[len(names):]
        d.update(net_sales=round(rv), pcs_qty=round(p), raw_qty=round(rq), order_count=int(o))
        items.append(d)
    total = {"net_sales": sum(x["net_sales"] for x in items), "pcs_qty": sum(x["pcs_qty"] for x in items),
             "order_count": sum(x["order_count"] for x in items)}
    return {**_meta(db, s, e, group_by=group_by, truncated=len(items) >= 20000), "total": total, "items": items}


@router.post("/sales")
async def create_sales(
    data: ChannelSalesCreate,
    _: dict = Depends(get_current_user),
    service: ChannelService = Depends(get_channel_service)
):
    """매출 데이터 생성/업데이트"""
    return service.upsert_channel_sales(data.model_dump())


@router.post("/sales/bulk")
async def bulk_create_sales(
    data: BulkSalesUpload,
    _: dict = Depends(get_current_user),
    service: ChannelService = Depends(get_channel_service)
):
    """대량 매출 데이터 업로드"""
    # 동기화 로그 생성
    log = service.create_sync_log(data.channel_id, data.channel_name, "manual")

    # 데이터 변환
    sales_list = []
    for item in data.sales_data:
        sales_list.append({
            "channel_id": data.channel_id,
            "channel_name": data.channel_name,
            "year": data.year,
            "month": data.month,
            "day": item.get("day"),
            "gross_sales": item.get("gross_sales", 0),
            "net_sales": item.get("net_sales", 0),
            "order_count": item.get("order_count", 0),
            "quantity": item.get("quantity", 0),
            "refund_amount": item.get("refund_amount", 0),
            "commission": item.get("commission", 0),
            "shipping_cost": item.get("shipping_cost", 0),
            "source": "manual",
        })

    result = service.bulk_upsert_sales(sales_list, log["id"])

    # 로그 업데이트
    service.update_sync_log(log["id"], {
        "status": "success" if not result["errors"] else "partial",
        "completed_at": datetime.utcnow(),
        "records_processed": len(sales_list),
        "records_created": result["created"],
        "error_message": str(result["errors"]) if result["errors"] else None,
    })

    return result


@router.delete("/sales/{channel_id}")
async def delete_sales(
    channel_id: str,
    year: int,
    month: int,
    day: Optional[int] = None,
    _: dict = Depends(get_current_user),
    service: ChannelService = Depends(get_channel_service)
):
    """매출 데이터 삭제"""
    count = service.delete_channel_sales(channel_id, year, month, day)
    return {"message": f"{count}개 데이터 삭제됨", "deleted_count": count}


# === Excel 업로드 API ===
@router.post("/sales/upload")
async def upload_excel(
    file: UploadFile = File(...),
    channel_id: str = Form(...),
    channel_name: str = Form(...),
    year: int = Form(...),
    month: int = Form(...),
    _: dict = Depends(get_current_user),
    service: ChannelService = Depends(get_channel_service)
):
    """Excel 파일 업로드로 매출 데이터 입력"""
    try:
        import pandas as pd
    except ImportError:
        raise HTTPException(
            status_code=500,
            detail="pandas 라이브러리가 설치되지 않았습니다"
        )

    if not file.filename.endswith(('.xlsx', '.xls', '.csv')):
        raise HTTPException(status_code=400, detail="지원하지 않는 파일 형식입니다")

    # 동기화 로그 생성
    log = service.create_sync_log(channel_id, channel_name, "upload")

    try:
        contents = await file.read()

        # 파일 형식에 따라 읽기
        if file.filename.endswith('.csv'):
            df = pd.read_csv(io.BytesIO(contents))
        else:
            df = pd.read_excel(io.BytesIO(contents))

        # 컬럼 매핑 (유연하게 처리)
        column_mapping = {
            # 날짜
            '날짜': 'date', '일자': 'date', 'date': 'date', '일': 'day', 'day': 'day',
            # 매출
            '매출': 'gross_sales', '총매출': 'gross_sales', 'gross_sales': 'gross_sales',
            '순매출': 'net_sales', 'net_sales': 'net_sales',
            # 주문
            '주문수': 'order_count', '주문건수': 'order_count', 'order_count': 'order_count',
            '수량': 'quantity', '판매수량': 'quantity', 'quantity': 'quantity',
            # 기타
            '환불': 'refund_amount', '환불금액': 'refund_amount',
            '수수료': 'commission', 'commission': 'commission',
            '배송비': 'shipping_cost', 'shipping_cost': 'shipping_cost',
        }

        # 컬럼 정규화
        df.columns = df.columns.str.strip().str.lower()
        renamed_cols = {}
        for col in df.columns:
            for orig, mapped in column_mapping.items():
                if col == orig.lower():
                    renamed_cols[col] = mapped
                    break
        df = df.rename(columns=renamed_cols)

        # 데이터 변환
        sales_list = []
        for _, row in df.iterrows():
            # 날짜 추출
            if 'day' in row:
                day = int(row['day'])
            elif 'date' in row:
                date_val = row['date']
                if isinstance(date_val, str):
                    day = int(date_val.split('-')[-1].split('/')[-1])
                else:
                    day = date_val.day if hasattr(date_val, 'day') else int(date_val)
            else:
                continue

            sales_list.append({
                "channel_id": channel_id,
                "channel_name": channel_name,
                "year": year,
                "month": month,
                "day": day,
                "gross_sales": float(row.get('gross_sales', 0) or 0),
                "net_sales": float(row.get('net_sales', 0) or 0),
                "order_count": int(row.get('order_count', 0) or 0),
                "quantity": int(row.get('quantity', 0) or 0),
                "refund_amount": float(row.get('refund_amount', 0) or 0),
                "commission": float(row.get('commission', 0) or 0),
                "shipping_cost": float(row.get('shipping_cost', 0) or 0),
                "source": "upload",
            })

        result = service.bulk_upsert_sales(sales_list, log["id"])

        # 로그 업데이트
        service.update_sync_log(log["id"], {
            "status": "success" if not result["errors"] else "partial",
            "completed_at": datetime.utcnow(),
            "records_processed": len(df),
            "records_created": result["created"],
            "error_message": str(result["errors"][:5]) if result["errors"] else None,
            "details": {"filename": file.filename, "rows": len(df)},
        })

        return {
            "message": f"{result['created']}개 데이터 처리됨",
            "processed": len(df),
            "created": result["created"],
            "errors": len(result["errors"]),
        }

    except Exception as e:
        service.update_sync_log(log["id"], {
            "status": "failed",
            "completed_at": datetime.utcnow(),
            "error_message": str(e),
        })
        raise HTTPException(status_code=400, detail=f"파일 처리 중 오류: {str(e)}")


# === 동기화 로그 API ===
@router.get("/sync/logs")
async def get_sync_logs(
    channel_id: Optional[str] = None,
    limit: int = 20,
    _: dict = Depends(get_current_user),
    service: ChannelService = Depends(get_channel_service)
):
    """동기화 로그 조회"""
    return service.get_recent_sync_logs(channel_id, limit)
