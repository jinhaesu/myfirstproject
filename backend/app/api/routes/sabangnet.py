"""사방넷 CS 게시판 대응 API 라우트

쇼핑몰 문의사항을 사방넷 API를 통해 수집하고,
Claude API로 AI 답변 초안을 생성한 뒤,
확인/수정 후 사방넷 API로 답변을 발송하는 시스템.
"""
import os
import json
import logging
from datetime import datetime
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import func, distinct
import httpx

from app.database import get_db
from app.db_models import CsInquiry, CsReferenceData, CsConfig

router = APIRouter(prefix="/sabangnet", tags=["sabangnet"])
logger = logging.getLogger(__name__)


# ──────────────────────────────────────────────
# Pydantic Request / Response Models
# ──────────────────────────────────────────────

class InquiryCreate(BaseModel):
    external_id: Optional[str] = None
    mall_name: str
    board_type: Optional[str] = None
    customer_name: Optional[str] = None
    customer_id: Optional[str] = None
    product_name: Optional[str] = None
    order_number: Optional[str] = None
    title: Optional[str] = None
    content: str
    inquiry_date: Optional[str] = None
    category: Optional[str] = None
    priority: str = "normal"


class InquiryUpdate(BaseModel):
    status: Optional[str] = None
    ai_response: Optional[str] = None
    final_response: Optional[str] = None
    category: Optional[str] = None
    priority: Optional[str] = None


class ReferenceDataCreate(BaseModel):
    title: str
    category: Optional[str] = None
    content: str


class ReferenceDataUpdate(BaseModel):
    title: Optional[str] = None
    category: Optional[str] = None
    content: Optional[str] = None
    is_active: Optional[bool] = None


class AiGenerateRequest(BaseModel):
    inquiry_id: int


class BulkAiGenerateRequest(BaseModel):
    inquiry_ids: List[int]


class SendResponseRequest(BaseModel):
    inquiry_id: int
    response: Optional[str] = None  # None이면 final_response 사용


class ConfigUpdate(BaseModel):
    auto_mode: Optional[bool] = None
    auto_categories: Optional[List[str]] = None  # 자동 답변 카테고리 목록
    sabangnet_api_key: Optional[str] = None
    claude_api_key: Optional[str] = None
    response_tone: Optional[str] = None  # 친근한, 정중한, 비즈니스


# ──────────────────────────────────────────────
# AI 답변 생성 유틸
# ──────────────────────────────────────────────

def generate_template_response(inquiry: CsInquiry) -> str:
    """API 없을 때 템플릿 기반 답변"""
    templates = {
        "배송문의": (
            f"안녕하세요, 고객님. {inquiry.mall_name} 고객센터입니다.\n\n"
            f"배송 관련 문의 주셔서 감사합니다.\n"
            f"주문하신 상품은 현재 정상적으로 배송 진행 중이며, "
            f"1-3 영업일 내 수령하실 수 있습니다.\n\n"
            f"추가 문의사항이 있으시면 언제든 연락 주세요.\n감사합니다."
        ),
        "교환/반품": (
            f"안녕하세요, 고객님. {inquiry.mall_name} 고객센터입니다.\n\n"
            f"교환/반품 문의 주셔서 감사합니다.\n"
            f"수령 후 7일 이내 교환/반품 신청이 가능합니다.\n\n"
            f"[교환/반품 절차]\n"
            f"1. 해당 쇼핑몰에서 교환/반품 신청\n"
            f"2. 택배 수거 (반품비는 고객 사유 시 부담)\n"
            f"3. 상품 확인 후 교환 발송 또는 환불 처리\n\n"
            f"추가 문의사항이 있으시면 언제든 연락 주세요.\n감사합니다."
        ),
        "상품문의": (
            f"안녕하세요, 고객님. {inquiry.mall_name} 고객센터입니다.\n\n"
            f"상품에 대해 관심 가져주셔서 감사합니다.\n"
            f"문의하신 내용에 대해 안내드립니다.\n\n"
            f"{inquiry.product_name or '해당 상품'}에 대한 자세한 정보는 "
            f"상품 상세 페이지를 참고해 주시기 바랍니다.\n\n"
            f"추가 문의사항이 있으시면 언제든 연락 주세요.\n감사합니다."
        ),
    }
    board = inquiry.board_type or "일반문의"
    return templates.get(
        board,
        (
            f"안녕하세요, 고객님. {inquiry.mall_name} 고객센터입니다.\n\n"
            f"문의 주셔서 감사합니다.\n"
            f"확인 후 빠른 시일 내 답변 드리겠습니다.\n\n감사합니다."
        ),
    )


async def generate_ai_response(inquiry: CsInquiry, reference_data_list: list) -> str:
    """Claude API를 사용해 CS 답변 초안 생성"""
    api_key = os.getenv("ANTHROPIC_API_KEY", "")

    if not api_key:
        # Fallback: 템플릿 기반 답변
        return generate_template_response(inquiry)

    # 참고 자료 컨텍스트 구성
    ref_context = "\n\n".join([
        f"[{ref.category}] {ref.title}:\n{ref.content}"
        for ref in reference_data_list
    ])

    prompt = f"""당신은 쇼핑몰 고객 문의에 답변하는 CS 담당자입니다.
아래 고객 문의에 대해 정중하고 친절한 답변을 작성해주세요.

## 참고 자료
{ref_context}

## 고객 문의 정보
- 쇼핑몰: {inquiry.mall_name}
- 문의 유형: {inquiry.board_type or '일반문의'}
- 상품명: {inquiry.product_name or '미지정'}
- 주문번호: {inquiry.order_number or '미지정'}
- 제목: {inquiry.title or ''}
- 내용: {inquiry.content}

## 답변 작성 지침
1. 고객의 문의 내용을 정확히 이해하고 답변
2. 참고 자료에 해당하는 정보가 있으면 활용
3. 정중하고 친절한 톤 유지
4. 구체적인 해결 방안 제시
5. 필요시 추가 안내 사항 포함

답변:"""

    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": api_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json={
                    "model": "claude-sonnet-4-20250514",
                    "max_tokens": 1024,
                    "messages": [{"role": "user", "content": prompt}],
                },
                timeout=30.0,
            )
            if resp.status_code == 200:
                data = resp.json()
                return data["content"][0]["text"]
            else:
                logger.error(f"Claude API 응답 오류: {resp.status_code} - {resp.text}")
    except Exception as e:
        logger.error(f"Claude API 호출 실패: {e}")

    return generate_template_response(inquiry)


# ──────────────────────────────────────────────
# 문의사항 (Inquiries) 엔드포인트
# ──────────────────────────────────────────────

@router.get("/inquiries/stats")
def get_inquiry_stats(db: Session = Depends(get_db)):
    """대시보드 통계: 전체 수, 상태별, 쇼핑몰별, 카테고리별"""
    try:
        total = db.query(func.count(CsInquiry.id)).scalar() or 0

        # 상태별 통계
        status_rows = (
            db.query(CsInquiry.status, func.count(CsInquiry.id))
            .group_by(CsInquiry.status)
            .all()
        )
        by_status = {row[0]: row[1] for row in status_rows}

        # 쇼핑몰별 통계
        mall_rows = (
            db.query(CsInquiry.mall_name, func.count(CsInquiry.id))
            .group_by(CsInquiry.mall_name)
            .all()
        )
        by_mall = {row[0]: row[1] for row in mall_rows}

        # 카테고리별 통계
        cat_rows = (
            db.query(CsInquiry.category, func.count(CsInquiry.id))
            .filter(CsInquiry.category.isnot(None))
            .group_by(CsInquiry.category)
            .all()
        )
        by_category = {row[0]: row[1] for row in cat_rows}

        # 우선순위별 통계
        priority_rows = (
            db.query(CsInquiry.priority, func.count(CsInquiry.id))
            .group_by(CsInquiry.priority)
            .all()
        )
        by_priority = {row[0]: row[1] for row in priority_rows}

        return {
            "total": total,
            "by_status": by_status,
            "by_mall": by_mall,
            "by_category": by_category,
            "by_priority": by_priority,
        }
    except Exception as e:
        logger.error(f"문의 통계 조회 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/inquiries")
def list_inquiries(
    status: Optional[str] = None,
    mall_name: Optional[str] = None,
    board_type: Optional[str] = None,
    category: Optional[str] = None,
    priority: Optional[str] = None,
    search: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """문의사항 목록 조회 (필터, 페이지네이션)"""
    try:
        query = db.query(CsInquiry)

        if status:
            query = query.filter(CsInquiry.status == status)
        if mall_name:
            query = query.filter(CsInquiry.mall_name == mall_name)
        if board_type:
            query = query.filter(CsInquiry.board_type == board_type)
        if category:
            query = query.filter(CsInquiry.category == category)
        if priority:
            query = query.filter(CsInquiry.priority == priority)
        if search:
            like_term = f"%{search}%"
            query = query.filter(
                (CsInquiry.title.ilike(like_term))
                | (CsInquiry.content.ilike(like_term))
                | (CsInquiry.customer_name.ilike(like_term))
                | (CsInquiry.product_name.ilike(like_term))
                | (CsInquiry.order_number.ilike(like_term))
            )
        if date_from:
            try:
                dt_from = datetime.fromisoformat(date_from)
                query = query.filter(CsInquiry.inquiry_date >= dt_from)
            except ValueError:
                pass
        if date_to:
            try:
                dt_to = datetime.fromisoformat(date_to)
                query = query.filter(CsInquiry.inquiry_date <= dt_to)
            except ValueError:
                pass

        total = query.count()
        items = (
            query.order_by(CsInquiry.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
            .all()
        )

        return {
            "total": total,
            "page": page,
            "page_size": page_size,
            "items": [_inquiry_to_dict(item) for item in items],
        }
    except Exception as e:
        logger.error(f"문의 목록 조회 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/inquiries/{inquiry_id}")
def get_inquiry(inquiry_id: int, db: Session = Depends(get_db)):
    """문의사항 상세 조회"""
    inquiry = db.query(CsInquiry).filter(CsInquiry.id == inquiry_id).first()
    if not inquiry:
        raise HTTPException(status_code=404, detail="문의사항을 찾을 수 없습니다")
    return _inquiry_to_dict(inquiry)


@router.post("/inquiries")
def create_inquiry(data: InquiryCreate, db: Session = Depends(get_db)):
    """문의사항 생성 (수동 입력 또는 웹훅)"""
    try:
        inquiry = CsInquiry(
            external_id=data.external_id,
            mall_name=data.mall_name,
            board_type=data.board_type,
            customer_name=data.customer_name,
            customer_id=data.customer_id,
            product_name=data.product_name,
            order_number=data.order_number,
            title=data.title,
            content=data.content,
            inquiry_date=datetime.fromisoformat(data.inquiry_date) if data.inquiry_date else None,
            category=data.category,
            priority=data.priority,
            status="new",
        )
        db.add(inquiry)
        db.commit()
        db.refresh(inquiry)
        logger.info(f"문의 생성: id={inquiry.id}, mall={inquiry.mall_name}")
        return _inquiry_to_dict(inquiry)
    except Exception as e:
        db.rollback()
        logger.error(f"문의 생성 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/inquiries/{inquiry_id}")
def update_inquiry(inquiry_id: int, data: InquiryUpdate, db: Session = Depends(get_db)):
    """문의사항 업데이트"""
    inquiry = db.query(CsInquiry).filter(CsInquiry.id == inquiry_id).first()
    if not inquiry:
        raise HTTPException(status_code=404, detail="문의사항을 찾을 수 없습니다")
    try:
        if data.status is not None:
            inquiry.status = data.status
        if data.ai_response is not None:
            inquiry.ai_response = data.ai_response
        if data.final_response is not None:
            inquiry.final_response = data.final_response
        if data.category is not None:
            inquiry.category = data.category
        if data.priority is not None:
            inquiry.priority = data.priority
        db.commit()
        db.refresh(inquiry)
        return _inquiry_to_dict(inquiry)
    except Exception as e:
        db.rollback()
        logger.error(f"문의 업데이트 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/inquiries/{inquiry_id}")
def delete_inquiry(inquiry_id: int, db: Session = Depends(get_db)):
    """문의사항 삭제"""
    inquiry = db.query(CsInquiry).filter(CsInquiry.id == inquiry_id).first()
    if not inquiry:
        raise HTTPException(status_code=404, detail="문의사항을 찾을 수 없습니다")
    try:
        db.delete(inquiry)
        db.commit()
        return {"message": "삭제 완료", "id": inquiry_id}
    except Exception as e:
        db.rollback()
        logger.error(f"문의 삭제 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/inquiries/collect")
def collect_inquiries(db: Session = Depends(get_db)):
    """사방넷 API로 문의 수집 (placeholder - 목 데이터 반환)"""
    logger.info("사방넷 문의 수집 요청 (placeholder)")

    # 실제 구현 시 사방넷 API 호출하여 문의 수집
    # 현재는 목 데이터 반환
    mock_inquiries = [
        {
            "external_id": "SBN-2026-001",
            "mall_name": "스마트스토어",
            "board_type": "상품문의",
            "customer_name": "김고객",
            "product_name": "샘플 상품 A",
            "title": "상품 사이즈 문의드립니다",
            "content": "이 상품 S사이즈 재입고 언제 될까요?",
            "inquiry_date": "2026-03-15T10:30:00",
            "status": "new",
        },
        {
            "external_id": "SBN-2026-002",
            "mall_name": "쿠팡",
            "board_type": "배송문의",
            "customer_name": "이고객",
            "order_number": "2026031500123",
            "product_name": "샘플 상품 B",
            "title": "배송이 너무 늦어요",
            "content": "주문한지 5일인데 아직 배송 시작이 안되었습니다. 확인 부탁드립니다.",
            "inquiry_date": "2026-03-15T11:00:00",
            "status": "new",
        },
    ]

    created = []
    for item in mock_inquiries:
        # 중복 체크
        existing = (
            db.query(CsInquiry)
            .filter(CsInquiry.external_id == item["external_id"])
            .first()
        )
        if existing:
            continue
        inquiry = CsInquiry(
            external_id=item["external_id"],
            mall_name=item["mall_name"],
            board_type=item.get("board_type"),
            customer_name=item.get("customer_name"),
            product_name=item.get("product_name"),
            order_number=item.get("order_number"),
            title=item.get("title"),
            content=item["content"],
            inquiry_date=datetime.fromisoformat(item["inquiry_date"]) if item.get("inquiry_date") else None,
            status="new",
        )
        db.add(inquiry)
        created.append(item["external_id"])

    if created:
        db.commit()

    return {
        "message": "사방넷 문의 수집 완료 (placeholder)",
        "collected_count": len(created),
        "external_ids": created,
    }


# ──────────────────────────────────────────────
# AI 답변 생성 엔드포인트
# ──────────────────────────────────────────────

@router.post("/inquiries/{inquiry_id}/generate-ai")
async def generate_ai_for_inquiry(inquiry_id: int, db: Session = Depends(get_db)):
    """단건 AI 답변 생성"""
    inquiry = db.query(CsInquiry).filter(CsInquiry.id == inquiry_id).first()
    if not inquiry:
        raise HTTPException(status_code=404, detail="문의사항을 찾을 수 없습니다")

    try:
        # 활성 참고 데이터 조회
        ref_data = (
            db.query(CsReferenceData)
            .filter(CsReferenceData.is_active == True)
            .all()
        )

        # AI 답변 생성
        ai_text = await generate_ai_response(inquiry, ref_data)

        # 저장 및 상태 업데이트
        inquiry.ai_response = ai_text
        inquiry.status = "ai_drafted"
        db.commit()
        db.refresh(inquiry)

        logger.info(f"AI 답변 생성 완료: inquiry_id={inquiry_id}")
        return {
            "inquiry_id": inquiry_id,
            "ai_response": ai_text,
            "status": "ai_drafted",
        }
    except Exception as e:
        db.rollback()
        logger.error(f"AI 답변 생성 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/inquiries/bulk-generate-ai")
async def bulk_generate_ai(data: BulkAiGenerateRequest, db: Session = Depends(get_db)):
    """다건 AI 답변 일괄 생성"""
    # 활성 참고 데이터 한 번만 조회
    ref_data = (
        db.query(CsReferenceData)
        .filter(CsReferenceData.is_active == True)
        .all()
    )

    generated_count = 0
    errors = []

    for inq_id in data.inquiry_ids:
        inquiry = db.query(CsInquiry).filter(CsInquiry.id == inq_id).first()
        if not inquiry:
            errors.append({"id": inq_id, "error": "문의사항을 찾을 수 없습니다"})
            continue
        try:
            ai_text = await generate_ai_response(inquiry, ref_data)
            inquiry.ai_response = ai_text
            inquiry.status = "ai_drafted"
            generated_count += 1
        except Exception as e:
            errors.append({"id": inq_id, "error": str(e)})

    db.commit()
    logger.info(f"AI 답변 일괄 생성: {generated_count}/{len(data.inquiry_ids)} 건")

    return {
        "total_requested": len(data.inquiry_ids),
        "generated_count": generated_count,
        "errors": errors,
    }


# ──────────────────────────────────────────────
# 답변 승인 및 발송 엔드포인트
# ──────────────────────────────────────────────

@router.post("/inquiries/{inquiry_id}/approve")
def approve_inquiry(
    inquiry_id: int,
    final_text: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """AI 답변 승인 (수정 가능)"""
    inquiry = db.query(CsInquiry).filter(CsInquiry.id == inquiry_id).first()
    if not inquiry:
        raise HTTPException(status_code=404, detail="문의사항을 찾을 수 없습니다")

    try:
        # final_text가 있으면 사용, 없으면 ai_response를 복사
        if final_text:
            inquiry.final_response = final_text
        elif inquiry.ai_response:
            inquiry.final_response = inquiry.ai_response
        else:
            raise HTTPException(status_code=400, detail="승인할 답변이 없습니다 (AI 답변 먼저 생성 필요)")

        inquiry.status = "approved"
        db.commit()
        db.refresh(inquiry)

        logger.info(f"답변 승인: inquiry_id={inquiry_id}")
        return {
            "inquiry_id": inquiry_id,
            "status": "approved",
            "final_response": inquiry.final_response,
        }
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"답변 승인 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/inquiries/{inquiry_id}/send")
def send_response(inquiry_id: int, db: Session = Depends(get_db)):
    """사방넷 API로 답변 발송 (placeholder)"""
    inquiry = db.query(CsInquiry).filter(CsInquiry.id == inquiry_id).first()
    if not inquiry:
        raise HTTPException(status_code=404, detail="문의사항을 찾을 수 없습니다")

    # 발송할 답변 결정
    response_text = inquiry.final_response or inquiry.ai_response
    if not response_text:
        raise HTTPException(status_code=400, detail="발송할 답변이 없습니다")

    try:
        # 실제 구현 시 사방넷 API 호출
        logger.info(
            f"사방넷 답변 발송 (placeholder): inquiry_id={inquiry_id}, "
            f"external_id={inquiry.external_id}, mall={inquiry.mall_name}"
        )

        inquiry.status = "sent"
        inquiry.sent_at = datetime.utcnow()
        db.commit()
        db.refresh(inquiry)

        return {
            "inquiry_id": inquiry_id,
            "status": "sent",
            "sent_at": inquiry.sent_at.isoformat() if inquiry.sent_at else None,
            "message": "답변 발송 완료 (placeholder)",
        }
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"답변 발송 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/inquiries/bulk-send")
def bulk_send_responses(db: Session = Depends(get_db)):
    """승인된 답변 일괄 발송"""
    approved = (
        db.query(CsInquiry)
        .filter(CsInquiry.status == "approved")
        .all()
    )

    if not approved:
        return {"message": "발송할 승인 건이 없습니다", "sent_count": 0}

    sent_count = 0
    errors = []
    now = datetime.utcnow()

    for inquiry in approved:
        response_text = inquiry.final_response or inquiry.ai_response
        if not response_text:
            errors.append({"id": inquiry.id, "error": "답변 내용 없음"})
            continue
        try:
            logger.info(
                f"사방넷 일괄 발송 (placeholder): inquiry_id={inquiry.id}, "
                f"external_id={inquiry.external_id}"
            )
            inquiry.status = "sent"
            inquiry.sent_at = now
            sent_count += 1
        except Exception as e:
            errors.append({"id": inquiry.id, "error": str(e)})

    db.commit()
    logger.info(f"일괄 발송 완료: {sent_count}/{len(approved)} 건")

    return {
        "total_approved": len(approved),
        "sent_count": sent_count,
        "errors": errors,
    }


# ──────────────────────────────────────────────
# 참고 데이터 (Reference Data) 엔드포인트
# ──────────────────────────────────────────────

@router.get("/reference-data/categories")
def get_reference_categories(db: Session = Depends(get_db)):
    """참고 데이터 카테고리 목록"""
    try:
        rows = (
            db.query(distinct(CsReferenceData.category))
            .filter(CsReferenceData.category.isnot(None))
            .all()
        )
        categories = [row[0] for row in rows]
        return {"categories": categories}
    except Exception as e:
        logger.error(f"카테고리 조회 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/reference-data")
def list_reference_data(
    category: Optional[str] = None,
    is_active: Optional[bool] = None,
    db: Session = Depends(get_db),
):
    """참고 데이터 목록"""
    try:
        query = db.query(CsReferenceData)
        if category:
            query = query.filter(CsReferenceData.category == category)
        if is_active is not None:
            query = query.filter(CsReferenceData.is_active == is_active)
        items = query.order_by(CsReferenceData.created_at.desc()).all()
        return {
            "items": [_ref_to_dict(item) for item in items],
        }
    except Exception as e:
        logger.error(f"참고 데이터 조회 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/reference-data")
def create_reference_data(data: ReferenceDataCreate, db: Session = Depends(get_db)):
    """참고 데이터 생성"""
    try:
        ref = CsReferenceData(
            title=data.title,
            category=data.category,
            content=data.content,
            is_active=True,
        )
        db.add(ref)
        db.commit()
        db.refresh(ref)
        logger.info(f"참고 데이터 생성: id={ref.id}, title={ref.title}")
        return _ref_to_dict(ref)
    except Exception as e:
        db.rollback()
        logger.error(f"참고 데이터 생성 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/reference-data/{ref_id}")
def update_reference_data(ref_id: int, data: ReferenceDataUpdate, db: Session = Depends(get_db)):
    """참고 데이터 업데이트"""
    ref = db.query(CsReferenceData).filter(CsReferenceData.id == ref_id).first()
    if not ref:
        raise HTTPException(status_code=404, detail="참고 데이터를 찾을 수 없습니다")
    try:
        if data.title is not None:
            ref.title = data.title
        if data.category is not None:
            ref.category = data.category
        if data.content is not None:
            ref.content = data.content
        if data.is_active is not None:
            ref.is_active = data.is_active
        db.commit()
        db.refresh(ref)
        return _ref_to_dict(ref)
    except Exception as e:
        db.rollback()
        logger.error(f"참고 데이터 업데이트 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/reference-data/{ref_id}")
def delete_reference_data(ref_id: int, db: Session = Depends(get_db)):
    """참고 데이터 삭제 (hard delete)"""
    ref = db.query(CsReferenceData).filter(CsReferenceData.id == ref_id).first()
    if not ref:
        raise HTTPException(status_code=404, detail="참고 데이터를 찾을 수 없습니다")
    try:
        db.delete(ref)
        db.commit()
        return {"message": "삭제 완료", "id": ref_id}
    except Exception as e:
        db.rollback()
        logger.error(f"참고 데이터 삭제 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ──────────────────────────────────────────────
# 설정 (Config) 엔드포인트
# ──────────────────────────────────────────────

@router.get("/config")
def get_config(db: Session = Depends(get_db)):
    """CS 설정 전체 조회"""
    try:
        configs = db.query(CsConfig).all()
        result = {}
        for cfg in configs:
            # JSON으로 파싱 가능하면 파싱
            try:
                result[cfg.config_key] = json.loads(cfg.config_value)
            except (json.JSONDecodeError, TypeError):
                result[cfg.config_key] = cfg.config_value
        return result
    except Exception as e:
        logger.error(f"설정 조회 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/config")
def update_config(data: ConfigUpdate, db: Session = Depends(get_db)):
    """CS 설정 업데이트"""
    try:
        updates = {}
        if data.auto_mode is not None:
            updates["auto_mode"] = json.dumps(data.auto_mode)
        if data.auto_categories is not None:
            updates["auto_categories"] = json.dumps(data.auto_categories, ensure_ascii=False)
        if data.sabangnet_api_key is not None:
            updates["sabangnet_api_key"] = data.sabangnet_api_key
        if data.claude_api_key is not None:
            updates["claude_api_key"] = data.claude_api_key
        if data.response_tone is not None:
            updates["response_tone"] = data.response_tone

        for key, value in updates.items():
            existing = db.query(CsConfig).filter(CsConfig.config_key == key).first()
            if existing:
                existing.config_value = value
            else:
                new_cfg = CsConfig(config_key=key, config_value=value)
                db.add(new_cfg)

        db.commit()
        logger.info(f"설정 업데이트: {list(updates.keys())}")

        # 업데이트 후 전체 설정 반환
        return get_config(db=db)
    except Exception as e:
        db.rollback()
        logger.error(f"설정 업데이트 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ──────────────────────────────────────────────
# 헬퍼 함수
# ──────────────────────────────────────────────

def _inquiry_to_dict(inquiry: CsInquiry) -> dict:
    """CsInquiry ORM 객체를 dict로 변환"""
    return {
        "id": inquiry.id,
        "external_id": inquiry.external_id,
        "mall_name": inquiry.mall_name,
        "board_type": inquiry.board_type,
        "customer_name": inquiry.customer_name,
        "customer_id": inquiry.customer_id,
        "product_name": inquiry.product_name,
        "order_number": inquiry.order_number,
        "title": inquiry.title,
        "content": inquiry.content,
        "inquiry_date": inquiry.inquiry_date.isoformat() if inquiry.inquiry_date else None,
        "status": inquiry.status,
        "ai_response": inquiry.ai_response,
        "final_response": inquiry.final_response,
        "sent_at": inquiry.sent_at.isoformat() if inquiry.sent_at else None,
        "auto_mode": inquiry.auto_mode,
        "category": inquiry.category,
        "priority": inquiry.priority,
        "created_at": inquiry.created_at.isoformat() if inquiry.created_at else None,
        "updated_at": inquiry.updated_at.isoformat() if inquiry.updated_at else None,
    }


def _ref_to_dict(ref: CsReferenceData) -> dict:
    """CsReferenceData ORM 객체를 dict로 변환"""
    return {
        "id": ref.id,
        "title": ref.title,
        "category": ref.category,
        "content": ref.content,
        "is_active": ref.is_active,
        "created_at": ref.created_at.isoformat() if ref.created_at else None,
        "updated_at": ref.updated_at.isoformat() if ref.updated_at else None,
    }
