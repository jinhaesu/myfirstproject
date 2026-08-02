"""음성 CS 대응 API 라우트 (Voice CS)

Vapi 등 음성 AI 서비스와 연동하여 통화 내역을 관리하고,
응대 매뉴얼 및 설정을 제공하는 API.
"""
import logging
from datetime import datetime, date
from typing import Optional, List, Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import func, or_

from app.database import get_db
from app.db_models import VoiceCsCall, VoiceCsManual, VoiceCsConfig, VoiceCsPhoneNumber
from app.services.vapi_service import get_vapi_service

router = APIRouter(prefix="/sabangnet/voice-cs", tags=["sabangnet-voice-cs"])
logger = logging.getLogger(__name__)


# ──────────────────────────────────────────────
# Pydantic Request Models
# ──────────────────────────────────────────────

class PhoneNumberCreate(BaseModel):
    phone_number: str
    label: Optional[str] = None
    provider: str = "vapi"


class ManualCreate(BaseModel):
    title: str
    category: Optional[str] = None
    content: str
    scenario_type: Optional[str] = None
    sample_dialogue: Optional[str] = None
    priority_order: int = 0


class ManualUpdate(BaseModel):
    title: Optional[str] = None
    category: Optional[str] = None
    content: Optional[str] = None
    scenario_type: Optional[str] = None
    sample_dialogue: Optional[str] = None
    priority_order: Optional[int] = None
    is_active: Optional[bool] = None


class VoiceCsConfigUpdate(BaseModel):
    vapi_api_key: Optional[str] = None
    elevenlabs_api_key: Optional[str] = None
    voice_id: Optional[str] = None
    greeting_message: Optional[str] = None
    system_prompt: Optional[str] = None
    auto_order_lookup: Optional[bool] = None


# ──────────────────────────────────────────────
# Sample Data (DB 데이터 없을 때 사용)
# ──────────────────────────────────────────────

sample_calls = [
    {
        "id": 1, "call_id": "call_abc123", "phone_number": "010-1234-5678",
        "direction": "inbound", "started_at": "2026-03-22T10:30:00", "ended_at": "2026-03-22T10:33:45",
        "duration_seconds": 225, "status": "completed",
        "transcript": "고객: 여보세요? 주문한 마카롱이 아직 안 왔는데요.\nAI: 안녕하세요, 널담 고객센터입니다. 주문 확인을 위해 주문번호를 알려주시겠어요?\n고객: NSS-20260320-456이요.\nAI: 확인했습니다. 현재 배송 중이며 내일 오전 중 도착 예정입니다.\n고객: 네 감사합니다.",
        "ai_summary": "마카롱 배송 지연 문의. 주문번호 NSS-20260320-456 확인, 내일 오전 도착 예정 안내 완료.",
        "customer_name": "김영희", "order_number": "NSS-20260320-456",
        "order_info": {"product": "널담 마카롱 복숭아 요거트 [50g]", "quantity": 2, "status": "배송중"},
        "category": "배송문의", "sentiment": "neutral",
        "action_items": [{"title": "배송 상태 확인", "description": "내일 오전 도착 여부 팔로업", "priority": "low", "status": "pending"}],
        "resolved": True,
        "notes": None, "created_at": "2026-03-22T10:30:00", "updated_at": "2026-03-22T10:33:45",
    },
    {
        "id": 2, "call_id": "call_def456", "phone_number": "010-9876-5432",
        "direction": "inbound", "started_at": "2026-03-22T14:15:00", "ended_at": "2026-03-22T14:21:30",
        "duration_seconds": 390, "status": "completed",
        "transcript": "고객: 케이크를 받았는데 깨져있어요. 사진 찍어뒀는데.\nAI: 정말 죄송합니다. 파손 상태를 확인하고 즉시 교환 처리해 드리겠습니다. 주문번호를 알려주시겠어요?\n고객: CP-20260319-789요.\nAI: 확인했습니다. 새 상품을 바로 발송해 드리겠습니다. 파손된 상품은 폐기하셔도 됩니다.\n고객: 고마워요. 그런데 다음에는 포장 좀 신경 써주세요.\nAI: 네, 포장 개선에 대해 담당 부서에 전달하겠습니다. 불편을 드려 다시 한번 죄송합니다.",
        "ai_summary": "케이크 파손 교환 요청. 주문번호 CP-20260319-789, 즉시 재발송 처리. 포장 개선 요청 접수.",
        "customer_name": "박민호", "order_number": "CP-20260319-789",
        "order_info": {"product": "널담 케이크 바닐라치즈 [120g]", "quantity": 1, "status": "배송완료"},
        "category": "교환/반품", "sentiment": "negative",
        "action_items": [
            {"title": "교환 상품 발송", "description": "CP-20260319-789 건 바닐라치즈 케이크 1개 재발송", "priority": "high", "status": "pending"},
            {"title": "포장 개선 검토", "description": "케이크 파손 빈발 - 완충재 보강 필요", "priority": "medium", "status": "pending"},
        ],
        "resolved": False,
        "notes": None, "created_at": "2026-03-22T14:15:00", "updated_at": "2026-03-22T14:21:30",
    },
    {
        "id": 3, "call_id": "call_ghi789", "phone_number": "010-5555-1234",
        "direction": "inbound", "started_at": "2026-03-22T16:00:00", "ended_at": "2026-03-22T16:02:15",
        "duration_seconds": 135, "status": "completed",
        "transcript": "고객: 대량 주문 가능한가요? 100박스 정도요.\nAI: 안녕하세요, 대량 주문도 가능합니다. 100박스 이상 주문 시 별도 견적을 안내해 드리고 있습니다. 담당자 연결을 도와드릴까요?\n고객: 네, 연락처 남길게요. 010-5555-1234입니다.\nAI: 접수되었습니다. 영업일 기준 1일 내 담당자가 연락드리겠습니다.",
        "ai_summary": "대량 주문 문의 (100박스). 담당자 콜백 요청. 연락처: 010-5555-1234",
        "customer_name": None, "order_number": None,
        "order_info": None,
        "category": "기타", "sentiment": "positive",
        "action_items": [
            {"title": "대량 주문 견적 발송", "description": "010-5555-1234 고객에게 100박스 견적 안내 콜백", "priority": "high", "status": "pending"},
        ],
        "resolved": False,
        "notes": None, "created_at": "2026-03-22T16:00:00", "updated_at": "2026-03-22T16:02:15",
    },
]

sample_manuals = [
    {"id": 1, "title": "기본 인사말", "category": "인사말", "content": "안녕하세요, 널담 고객센터입니다. 무엇을 도와드릴까요?", "scenario_type": "일반안내", "sample_dialogue": None, "priority_order": 1, "is_active": True, "created_at": "2026-03-22T00:00:00"},
    {"id": 2, "title": "배송 문의 대응", "category": "배송", "content": "주문번호를 확인하고 현재 배송 상태를 안내합니다. 배송 지연 시 예상 도착일을 알려드립니다.", "scenario_type": "자주묻는질문", "sample_dialogue": "고객: 주문한 상품이 안 왔어요.\nAI: 주문번호를 알려주시면 배송 상태를 확인해 드리겠습니다.", "priority_order": 2, "is_active": True, "created_at": "2026-03-22T00:00:00"},
    {"id": 3, "title": "교환/반품 절차 안내", "category": "교환/반품", "content": "수령 후 7일 이내 교환/반품 가능. 상품 하자 시 무료 교환, 고객 변심 시 왕복 택배비 5,000원.", "scenario_type": "자주묻는질문", "sample_dialogue": "고객: 교환하고 싶어요.\nAI: 수령 후 7일 이내라면 교환 가능합니다. 사유를 알려주시겠어요?", "priority_order": 3, "is_active": True, "created_at": "2026-03-22T00:00:00"},
    {"id": 4, "title": "에스컬레이션 기준", "category": "에스컬레이션", "content": "다음 경우 담당자 연결: 1) 고객이 직접 사람과 통화 요청 2) 3회 이상 같은 문의 반복 3) 환불 금액 50,000원 이상 4) 법적 언급", "scenario_type": "클레임", "sample_dialogue": None, "priority_order": 10, "is_active": True, "created_at": "2026-03-22T00:00:00"},
    {"id": 5, "title": "대량/B2B 주문 안내", "category": "기타", "content": "100개 이상 대량 주문 시 별도 견적 안내. 담당자 콜백 접수 후 영업일 1일 내 연락.", "scenario_type": "일반안내", "sample_dialogue": None, "priority_order": 5, "is_active": True, "created_at": "2026-03-22T00:00:00"},
]

sample_phone_numbers = [
    {"id": 1, "phone_number": "02-1234-5678", "label": "고객센터 대표번호", "provider": "vapi", "provider_id": None, "is_active": True, "total_calls": 156, "created_at": "2026-03-22T00:00:00"},
    {"id": 2, "phone_number": "070-9876-5432", "label": "온라인몰 CS", "provider": "vapi", "provider_id": None, "is_active": False, "total_calls": 42, "created_at": "2026-03-22T00:00:00"},
]


# ──────────────────────────────────────────────
# Helper Functions
# ──────────────────────────────────────────────

def _call_to_dict(c) -> dict:
    return {
        "id": c.id, "call_id": c.call_id, "phone_number": c.phone_number,
        "direction": c.direction,
        "started_at": c.started_at.isoformat() if c.started_at else None,
        "ended_at": c.ended_at.isoformat() if c.ended_at else None,
        "duration_seconds": c.duration_seconds, "status": c.status,
        "transcript": c.transcript, "ai_summary": c.ai_summary,
        "customer_name": c.customer_name, "order_number": c.order_number,
        "order_info": c.order_info, "category": c.category,
        "sentiment": c.sentiment, "action_items": c.action_items,
        "resolved": c.resolved, "notes": c.notes,
        "created_at": c.created_at.isoformat() if c.created_at else None,
        "updated_at": c.updated_at.isoformat() if c.updated_at else None,
    }


def _manual_to_dict(m) -> dict:
    return {
        "id": m.id, "title": m.title, "category": m.category,
        "content": m.content, "scenario_type": m.scenario_type,
        "sample_dialogue": m.sample_dialogue,
        "priority_order": m.priority_order, "is_active": m.is_active,
        "created_at": m.created_at.isoformat() if m.created_at else None,
    }


def _phone_to_dict(p) -> dict:
    return {
        "id": p.id, "phone_number": p.phone_number, "label": p.label,
        "provider": p.provider, "provider_id": p.provider_id,
        "is_active": p.is_active, "total_calls": p.total_calls,
        "created_at": p.created_at.isoformat() if p.created_at else None,
    }


# ──────────────────────────────────────────────
# 대시보드
# ──────────────────────────────────────────────

@router.get("/dashboard")
async def get_dashboard(db: Session = Depends(get_db)):
    """통화 통계 (총 통화수, 오늘 통화수, 평균 통화시간, 미해결 건수, 감정 분석 요약, 카테고리별 분포)"""
    try:
        total_calls = db.query(func.count(VoiceCsCall.id)).scalar() or 0

        if total_calls == 0:
            # 샘플 데이터 기반 통계 반환
            today_str = "2026-03-22"
            today_calls = len([c for c in sample_calls if (c.get("started_at") or "").startswith(today_str)])
            total_duration = sum(c["duration_seconds"] for c in sample_calls)
            avg_duration = total_duration // len(sample_calls) if sample_calls else 0
            unresolved = len([c for c in sample_calls if not c["resolved"]])

            sentiment_counts = {}
            category_counts = {}
            for c in sample_calls:
                s = c.get("sentiment") or "unknown"
                sentiment_counts[s] = sentiment_counts.get(s, 0) + 1
                cat = c.get("category") or "기타"
                category_counts[cat] = category_counts.get(cat, 0) + 1

            return {
                "total_calls": len(sample_calls),
                "today_calls": today_calls,
                "avg_duration_seconds": avg_duration,
                "unresolved_count": unresolved,
                "sentiment_summary": sentiment_counts,
                "category_distribution": category_counts,
                "is_sample": True,
            }

        today = datetime.utcnow().date()
        today_calls = db.query(func.count(VoiceCsCall.id)).filter(
            func.date(VoiceCsCall.started_at) == today
        ).scalar() or 0

        avg_duration = db.query(func.avg(VoiceCsCall.duration_seconds)).scalar() or 0
        unresolved = db.query(func.count(VoiceCsCall.id)).filter(
            VoiceCsCall.resolved == False
        ).scalar() or 0

        # 감정 분석 요약
        sentiment_rows = db.query(
            VoiceCsCall.sentiment, func.count(VoiceCsCall.id)
        ).group_by(VoiceCsCall.sentiment).all()
        sentiment_summary = {row[0] or "unknown": row[1] for row in sentiment_rows}

        # 카테고리별 분포
        category_rows = db.query(
            VoiceCsCall.category, func.count(VoiceCsCall.id)
        ).group_by(VoiceCsCall.category).all()
        category_distribution = {row[0] or "기타": row[1] for row in category_rows}

        return {
            "total_calls": total_calls,
            "today_calls": today_calls,
            "avg_duration_seconds": int(avg_duration),
            "unresolved_count": unresolved,
            "sentiment_summary": sentiment_summary,
            "category_distribution": category_distribution,
            "is_sample": False,
        }
    except Exception as e:
        logger.error(f"Dashboard error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ──────────────────────────────────────────────
# 통화 내역
# ──────────────────────────────────────────────

@router.get("/calls")
async def list_calls(
    status: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    sentiment: Optional[str] = Query(None),
    phone_number: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """통화 목록 조회 (필터 및 페이지네이션 지원)"""
    try:
        total_count = db.query(func.count(VoiceCsCall.id)).scalar() or 0

        # DB가 비어 있으면 Vapi에서 통화 내역 동기화 시도
        if total_count == 0:
            vapi = get_vapi_service()
            if vapi.is_available:
                vapi_calls = await vapi.list_calls()
                if vapi_calls:
                    for vc in vapi_calls:
                        existing = db.query(VoiceCsCall).filter(
                            VoiceCsCall.call_id == vc.get("id")
                        ).first()
                        if existing:
                            continue
                        try:
                            started_raw = vc.get("startedAt")
                            ended_raw = vc.get("endedAt")
                            started_dt = (
                                datetime.fromisoformat(started_raw.replace("Z", "+00:00"))
                                if started_raw else None
                            )
                            ended_dt = (
                                datetime.fromisoformat(ended_raw.replace("Z", "+00:00"))
                                if ended_raw else None
                            )
                            call = VoiceCsCall(
                                call_id=vc.get("id"),
                                phone_number=vc.get("customer", {}).get("number", ""),
                                direction="inbound" if vc.get("type") == "inboundPhoneCall" else "outbound",
                                started_at=started_dt,
                                ended_at=ended_dt,
                                duration_seconds=int(vc.get("duration") or 0),
                                status="completed" if vc.get("status") == "ended" else (vc.get("status") or "completed"),
                                transcript=vc.get("transcript", ""),
                            )
                            db.add(call)
                        except Exception as sync_err:
                            logger.warning(f"Vapi 통화 동기화 실패 (call_id={vc.get('id')}): {sync_err}")
                    try:
                        db.commit()
                        total_count = db.query(func.count(VoiceCsCall.id)).scalar() or 0
                        logger.info(f"Vapi 통화 {len(vapi_calls)}건 동기화 완료 (DB 저장: {total_count}건)")
                    except Exception as commit_err:
                        db.rollback()
                        logger.error(f"Vapi 통화 동기화 커밋 실패: {commit_err}")

        if total_count == 0:
            # Vapi도 비어 있거나 미설정 — 샘플 데이터 필터링
            filtered = list(sample_calls)
            if status:
                filtered = [c for c in filtered if c.get("status") == status]
            if category:
                filtered = [c for c in filtered if c.get("category") == category]
            if sentiment:
                filtered = [c for c in filtered if c.get("sentiment") == sentiment]
            if phone_number:
                filtered = [c for c in filtered if phone_number in (c.get("phone_number") or "")]
            if search:
                s = search.lower()
                filtered = [c for c in filtered if
                    s in (c.get("phone_number") or "").lower()
                    or s in (c.get("customer_name") or "").lower()
                    or s in (c.get("order_number") or "").lower()
                    or s in (c.get("ai_summary") or "").lower()
                ]
            offset = (page - 1) * limit
            return {
                "total": len(filtered),
                "page": page,
                "limit": limit,
                "items": filtered[offset: offset + limit],
                "is_sample": True,
            }

        q = db.query(VoiceCsCall)
        if status:
            q = q.filter(VoiceCsCall.status == status)
        if category:
            q = q.filter(VoiceCsCall.category == category)
        if sentiment:
            q = q.filter(VoiceCsCall.sentiment == sentiment)
        if phone_number:
            q = q.filter(VoiceCsCall.phone_number.contains(phone_number))
        if date_from:
            q = q.filter(VoiceCsCall.started_at >= datetime.fromisoformat(date_from))
        if date_to:
            q = q.filter(VoiceCsCall.started_at <= datetime.fromisoformat(date_to))
        if search:
            q = q.filter(or_(
                VoiceCsCall.phone_number.contains(search),
                VoiceCsCall.customer_name.contains(search),
                VoiceCsCall.order_number.contains(search),
                VoiceCsCall.ai_summary.contains(search),
            ))

        total = q.count()
        items = q.order_by(VoiceCsCall.created_at.desc()).offset((page - 1) * limit).limit(limit).all()

        return {
            "total": total,
            "page": page,
            "limit": limit,
            "items": [_call_to_dict(c) for c in items],
            "is_sample": False,
        }
    except Exception as e:
        logger.error(f"List calls error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/calls/{call_id}")
async def get_call(call_id: str, db: Session = Depends(get_db)):
    """통화 상세 조회"""
    try:
        # call_id가 숫자면 id로 조회, 아니면 call_id 컬럼으로 조회
        if call_id.isdigit():
            record = db.query(VoiceCsCall).filter(VoiceCsCall.id == int(call_id)).first()
        else:
            record = db.query(VoiceCsCall).filter(VoiceCsCall.call_id == call_id).first()

        if record:
            return _call_to_dict(record)

        # 샘플 데이터에서 조회
        for c in sample_calls:
            if str(c["id"]) == call_id or c["call_id"] == call_id:
                return c

        raise HTTPException(status_code=404, detail="통화 내역을 찾을 수 없습니다.")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Get call error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/calls/{call_id}/summarize")
async def summarize_call(call_id: str, db: Session = Depends(get_db)):
    """AI 요약 재생성 (Claude API 사용, transcript 기반)"""
    try:
        if call_id.isdigit():
            record = db.query(VoiceCsCall).filter(VoiceCsCall.id == int(call_id)).first()
        else:
            record = db.query(VoiceCsCall).filter(VoiceCsCall.call_id == call_id).first()

        if not record and not any(str(c["id"]) == call_id or c["call_id"] == call_id for c in sample_calls):
            raise HTTPException(status_code=404, detail="통화 내역을 찾을 수 없습니다.")

        transcript = record.transcript if record else next(
            (c["transcript"] for c in sample_calls if str(c["id"]) == call_id or c["call_id"] == call_id), ""
        )

        if not transcript:
            raise HTTPException(status_code=400, detail="요약할 통화 텍스트가 없습니다.")

        # Claude API 호출
        try:
            import anthropic
            from app.config import get_settings
            settings = get_settings()

            client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)
            message = client.messages.create(
                model="claude-fable-5",
                max_tokens=500,
                messages=[
                    {
                        "role": "user",
                        "content": (
                            "다음 통화 내용을 2-3문장으로 간결하게 요약해 주세요. "
                            "고객 문의 내용, 처리 결과, 후속 조치 사항을 포함해야 합니다.\n\n"
                            f"통화 내용:\n{transcript}"
                        ),
                    }
                ],
            )
            summary = message.content[0].text
        except Exception as ai_err:
            logger.warning(f"Claude API call failed: {ai_err}")
            summary = f"[AI 요약 생성 실패] {str(ai_err)}"

        if record:
            record.ai_summary = summary
            record.updated_at = datetime.utcnow()
            db.commit()
            db.refresh(record)
            return _call_to_dict(record)

        return {"ai_summary": summary, "is_sample": True}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Summarize call error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/calls/{call_id}/action-items")
async def update_action_items(
    call_id: str,
    body: dict,
    db: Session = Depends(get_db),
):
    """액션 아이템 업데이트"""
    try:
        if call_id.isdigit():
            record = db.query(VoiceCsCall).filter(VoiceCsCall.id == int(call_id)).first()
        else:
            record = db.query(VoiceCsCall).filter(VoiceCsCall.call_id == call_id).first()

        if not record:
            raise HTTPException(status_code=404, detail="통화 내역을 찾을 수 없습니다.")

        record.action_items = body.get("action_items", record.action_items)
        record.updated_at = datetime.utcnow()
        db.commit()
        db.refresh(record)
        return _call_to_dict(record)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Update action items error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/calls/{call_id}")
async def update_call(
    call_id: str,
    body: dict,
    db: Session = Depends(get_db),
):
    """통화 정보 수정 (notes, resolved 등)"""
    try:
        if call_id.isdigit():
            record = db.query(VoiceCsCall).filter(VoiceCsCall.id == int(call_id)).first()
        else:
            record = db.query(VoiceCsCall).filter(VoiceCsCall.call_id == call_id).first()

        if not record:
            raise HTTPException(status_code=404, detail="통화 내역을 찾을 수 없습니다.")

        allowed_fields = {"notes", "resolved", "category", "sentiment", "customer_name", "order_number", "action_items"}
        for field in allowed_fields:
            if field in body:
                setattr(record, field, body[field])
        record.updated_at = datetime.utcnow()
        db.commit()
        db.refresh(record)
        return _call_to_dict(record)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Update call error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ──────────────────────────────────────────────
# 전화번호 관리
# ──────────────────────────────────────────────

@router.get("/phone-numbers")
async def list_phone_numbers(db: Session = Depends(get_db)):
    """등록된 번호 목록"""
    try:
        records = db.query(VoiceCsPhoneNumber).order_by(VoiceCsPhoneNumber.created_at.desc()).all()
        if records:
            return {"items": [_phone_to_dict(p) for p in records], "is_sample": False}
        return {"items": sample_phone_numbers, "is_sample": True}
    except Exception as e:
        logger.error(f"List phone numbers error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/phone-numbers", status_code=201)
async def create_phone_number(body: PhoneNumberCreate, db: Session = Depends(get_db)):
    """번호 등록 (provider=vapi 이고 VAPI_API_KEY 설정 시 Vapi에서 실제 번호 발급)"""
    try:
        existing = db.query(VoiceCsPhoneNumber).filter(
            VoiceCsPhoneNumber.phone_number == body.phone_number
        ).first()
        if existing:
            raise HTTPException(status_code=409, detail="이미 등록된 전화번호입니다.")

        # Vapi API에서 번호 생성 시도
        vapi = get_vapi_service()
        provider_id = None
        actual_number = body.phone_number

        if vapi.is_available and body.provider == "vapi":
            result = await vapi.create_phone_number()
            if not result.get("error"):
                provider_id = result.get("id")
                # Vapi에서 할당된 실제 번호가 있으면 사용
                actual_number = result.get("number") or body.phone_number
                logger.info(f"Vapi 전화번호 생성 완료: provider_id={provider_id}, number={actual_number}")
            else:
                logger.warning(f"Vapi 번호 생성 실패: {result.get('message')} — 로컬 번호로 등록")

        record = VoiceCsPhoneNumber(
            phone_number=actual_number,
            label=body.label,
            provider=body.provider,
            provider_id=provider_id,
        )
        db.add(record)
        db.commit()
        db.refresh(record)
        return _phone_to_dict(record)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Create phone number error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/phone-numbers/{id}", status_code=204)
async def delete_phone_number(id: int, db: Session = Depends(get_db)):
    """번호 삭제 (Vapi에 등록된 번호면 Vapi에서도 삭제)"""
    try:
        record = db.query(VoiceCsPhoneNumber).filter(VoiceCsPhoneNumber.id == id).first()
        if not record:
            raise HTTPException(status_code=404, detail="전화번호를 찾을 수 없습니다.")

        # Vapi에서도 삭제
        vapi = get_vapi_service()
        if record.provider_id and vapi.is_available:
            result = await vapi.delete_phone_number(record.provider_id)
            if result.get("error"):
                logger.warning(f"Vapi 번호 삭제 실패 (로컬 삭제는 계속): {result.get('message')}")
            else:
                logger.info(f"Vapi 전화번호 삭제 완료: provider_id={record.provider_id}")

        db.delete(record)
        db.commit()
        return None
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Delete phone number error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/phone-numbers/{id}/toggle")
async def toggle_phone_number(id: int, db: Session = Depends(get_db)):
    """활성/비활성 토글"""
    try:
        record = db.query(VoiceCsPhoneNumber).filter(VoiceCsPhoneNumber.id == id).first()
        if not record:
            raise HTTPException(status_code=404, detail="전화번호를 찾을 수 없습니다.")
        record.is_active = not record.is_active
        record.updated_at = datetime.utcnow()
        db.commit()
        db.refresh(record)
        return _phone_to_dict(record)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Toggle phone number error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ──────────────────────────────────────────────
# 응대 매뉴얼
# ──────────────────────────────────────────────

@router.get("/manuals")
async def list_manuals(
    category: Optional[str] = Query(None),
    is_active: Optional[bool] = Query(None),
    db: Session = Depends(get_db),
):
    """매뉴얼 목록 조회"""
    try:
        total_count = db.query(func.count(VoiceCsManual.id)).scalar() or 0

        if total_count == 0:
            filtered = list(sample_manuals)
            if category:
                filtered = [m for m in filtered if m.get("category") == category]
            if is_active is not None:
                filtered = [m for m in filtered if m.get("is_active") == is_active]
            return {"items": filtered, "is_sample": True}

        q = db.query(VoiceCsManual)
        if category:
            q = q.filter(VoiceCsManual.category == category)
        if is_active is not None:
            q = q.filter(VoiceCsManual.is_active == is_active)
        records = q.order_by(VoiceCsManual.priority_order.asc(), VoiceCsManual.id.asc()).all()
        return {"items": [_manual_to_dict(m) for m in records], "is_sample": False}
    except Exception as e:
        logger.error(f"List manuals error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/manuals", status_code=201)
async def create_manual(body: ManualCreate, db: Session = Depends(get_db)):
    """매뉴얼 등록"""
    try:
        record = VoiceCsManual(
            title=body.title,
            category=body.category,
            content=body.content,
            scenario_type=body.scenario_type,
            sample_dialogue=body.sample_dialogue,
            priority_order=body.priority_order,
        )
        db.add(record)
        db.commit()
        db.refresh(record)
        return _manual_to_dict(record)
    except Exception as e:
        logger.error(f"Create manual error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/manuals/{id}")
async def update_manual(id: int, body: ManualUpdate, db: Session = Depends(get_db)):
    """매뉴얼 수정"""
    try:
        record = db.query(VoiceCsManual).filter(VoiceCsManual.id == id).first()
        if not record:
            raise HTTPException(status_code=404, detail="매뉴얼을 찾을 수 없습니다.")

        update_data = body.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(record, field, value)
        record.updated_at = datetime.utcnow()
        db.commit()
        db.refresh(record)
        return _manual_to_dict(record)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Update manual error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/manuals/{id}", status_code=204)
async def delete_manual(id: int, db: Session = Depends(get_db)):
    """매뉴얼 삭제"""
    try:
        record = db.query(VoiceCsManual).filter(VoiceCsManual.id == id).first()
        if not record:
            raise HTTPException(status_code=404, detail="매뉴얼을 찾을 수 없습니다.")
        db.delete(record)
        db.commit()
        return None
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Delete manual error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ──────────────────────────────────────────────
# 설정
# ──────────────────────────────────────────────

_CONFIG_KEYS = [
    "vapi_api_key",
    "elevenlabs_api_key",
    "voice_id",
    "greeting_message",
    "system_prompt",
    "auto_order_lookup",
]


@router.get("/config")
async def get_config(db: Session = Depends(get_db)):
    """설정 조회"""
    try:
        records = db.query(VoiceCsConfig).filter(
            VoiceCsConfig.config_key.in_(_CONFIG_KEYS)
        ).all()
        config = {r.config_key: r.config_value for r in records}

        # 기본값 채우기
        defaults = {
            "vapi_api_key": "",
            "elevenlabs_api_key": "",
            "voice_id": "",
            "greeting_message": "안녕하세요, 널담 고객센터입니다. 무엇을 도와드릴까요?",
            "system_prompt": "",
            "auto_order_lookup": "true",
        }
        for key, default_val in defaults.items():
            if key not in config:
                config[key] = default_val

        # auto_order_lookup을 bool로 변환
        config["auto_order_lookup"] = config.get("auto_order_lookup", "true").lower() == "true"

        # Vapi API 키 연결 상태 (환경변수 기준)
        vapi = get_vapi_service()
        config["vapi_connected"] = vapi.is_available

        return config
    except Exception as e:
        logger.error(f"Get config error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/config")
async def update_config(body: VoiceCsConfigUpdate, db: Session = Depends(get_db)):
    """설정 저장"""
    try:
        update_data = body.model_dump(exclude_unset=True)

        for key, value in update_data.items():
            if key not in _CONFIG_KEYS:
                continue
            # bool -> str 변환
            str_value = str(value).lower() if isinstance(value, bool) else (str(value) if value is not None else None)

            record = db.query(VoiceCsConfig).filter(VoiceCsConfig.config_key == key).first()
            if record:
                record.config_value = str_value
                record.updated_at = datetime.utcnow()
            else:
                record = VoiceCsConfig(config_key=key, config_value=str_value)
                db.add(record)

        db.commit()
        return {"message": "설정이 저장되었습니다.", "updated_keys": list(update_data.keys())}
    except Exception as e:
        logger.error(f"Update config error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ──────────────────────────────────────────────
# Webhook (Vapi 등에서 호출)
# ──────────────────────────────────────────────

@router.post("/webhook/call-completed")
async def webhook_call_completed(body: dict, db: Session = Depends(get_db)):
    """통화 완료 시 웹훅 — 통화 데이터 저장 + AI 요약 자동 생성 + 주문 매핑"""
    try:
        call_id = body.get("call_id") or body.get("id")
        if not call_id:
            raise HTTPException(status_code=400, detail="call_id가 필요합니다.")

        # 기존 레코드 조회 또는 신규 생성
        record = db.query(VoiceCsCall).filter(VoiceCsCall.call_id == call_id).first()
        if not record:
            record = VoiceCsCall(call_id=call_id)
            db.add(record)

        # 필드 매핑
        record.phone_number = body.get("phone_number") or record.phone_number or "unknown"
        record.direction = body.get("direction", "inbound")
        record.status = body.get("status", "completed")
        record.duration_seconds = body.get("duration_seconds") or body.get("duration", 0)
        record.transcript = body.get("transcript") or record.transcript

        if body.get("started_at"):
            try:
                record.started_at = datetime.fromisoformat(body["started_at"].replace("Z", "+00:00"))
            except Exception:
                pass
        if body.get("ended_at"):
            try:
                record.ended_at = datetime.fromisoformat(body["ended_at"].replace("Z", "+00:00"))
            except Exception:
                pass

        record.customer_name = body.get("customer_name") or record.customer_name
        record.order_number = body.get("order_number") or record.order_number
        record.order_info = body.get("order_info") or record.order_info
        record.category = body.get("category") or record.category
        record.sentiment = body.get("sentiment") or record.sentiment
        record.action_items = body.get("action_items") or record.action_items
        record.updated_at = datetime.utcnow()

        db.flush()

        # AI 요약 자동 생성
        if record.transcript and not record.ai_summary:
            try:
                import anthropic
                from app.config import get_settings
                settings = get_settings()
                client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)
                message = client.messages.create(
                    model="claude-fable-5",
                    max_tokens=500,
                    messages=[
                        {
                            "role": "user",
                            "content": (
                                "다음 통화 내용을 2-3문장으로 간결하게 요약해 주세요. "
                                "고객 문의 내용, 처리 결과, 후속 조치 사항을 포함해야 합니다.\n\n"
                                f"통화 내용:\n{record.transcript}"
                            ),
                        }
                    ],
                )
                record.ai_summary = message.content[0].text
            except Exception as ai_err:
                logger.warning(f"Auto summary generation failed: {ai_err}")

        db.commit()
        db.refresh(record)
        logger.info(f"Webhook call-completed processed: call_id={call_id}")
        return {"status": "ok", "call": _call_to_dict(record)}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Webhook call-completed error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/webhook/call-started")
async def webhook_call_started(body: dict, db: Session = Depends(get_db)):
    """통화 시작 시 웹훅 — 고객 번호로 사방넷 주문 조회"""
    try:
        call_id = body.get("call_id") or body.get("id")
        phone_number = body.get("phone_number") or body.get("from")

        if not call_id:
            raise HTTPException(status_code=400, detail="call_id가 필요합니다.")

        record = db.query(VoiceCsCall).filter(VoiceCsCall.call_id == call_id).first()
        if not record:
            record = VoiceCsCall(
                call_id=call_id,
                phone_number=phone_number or "unknown",
                direction=body.get("direction", "inbound"),
                status="in_progress",
            )
            if body.get("started_at"):
                try:
                    record.started_at = datetime.fromisoformat(body["started_at"].replace("Z", "+00:00"))
                except Exception:
                    record.started_at = datetime.utcnow()
            else:
                record.started_at = datetime.utcnow()
            db.add(record)

        order_info = None
        # 사방넷 주문 조회 (전화번호 기반)
        if phone_number:
            try:
                from app.services.sabangnet_api import get_sabangnet_api
                api = get_sabangnet_api()

                if api.is_available:
                    order_result = await api.get_order_by_phone(phone_number)
                    if not order_result.get("error"):
                        orders = order_result.get("data", order_result.get("items", []))
                        if orders:
                            latest = orders[0]
                            order_info = {
                                "customer_name": latest.get("buyer_name"),
                                "order_number": latest.get("order_no"),
                                "order_info": latest,
                                "source": "sabangnet_api",
                            }
                            record.order_number = latest.get("order_no")
                            record.customer_name = latest.get("buyer_name")
                            record.order_info = order_info
                    else:
                        logger.warning(f"사방넷 주문 조회 오류: {order_result.get('message')}")
            except Exception as sab_err:
                logger.warning(f"Sabangnet order lookup failed: {sab_err}")

        db.commit()
        db.refresh(record)
        logger.info(f"Webhook call-started processed: call_id={call_id}, phone={phone_number}")
        return {
            "status": "ok",
            "call_id": call_id,
            "phone_number": phone_number,
            "order_info": order_info,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Webhook call-started error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
