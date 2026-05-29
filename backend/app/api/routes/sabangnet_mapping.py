"""사방넷 상품 매핑 자동화 API 라우트

쇼핑몰에 등록된 상품을 자사 상품 마스터와 매핑하는 시스템.
AI(Claude)를 사용해 자동으로 매칭 제안을 생성하고,
담당자가 승인/거부하는 semi-auto 워크플로우.
"""
import json
import logging
from datetime import datetime
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import func
import httpx

from app.database import get_db
from app.db_models import MappingProduct, MappingMallProduct, MappingSuggestion, MappingLog

router = APIRouter(prefix="/sabangnet/mapping", tags=["sabangnet-mapping"])
logger = logging.getLogger(__name__)


# ──────────────────────────────────────────────
# Pydantic Request Models
# ──────────────────────────────────────────────

class ProductCreate(BaseModel):
    sabangnet_product_code: str
    product_name: str
    options: Optional[dict] = None
    category: Optional[str] = None
    is_set: bool = False
    set_components: Optional[list] = None


class ProductUpdate(BaseModel):
    product_name: Optional[str] = None
    options: Optional[dict] = None
    category: Optional[str] = None
    is_set: Optional[bool] = None
    set_components: Optional[list] = None
    is_active: Optional[bool] = None


class ApproveRequest(BaseModel):
    suggestion_id: int


class BulkApproveRequest(BaseModel):
    suggestion_ids: List[int]


class BulkSuggestRequest(BaseModel):
    mall_product_ids: List[int]


class MappingConfigUpdate(BaseModel):
    auto_approve_threshold: Optional[float] = None
    operation_mode: Optional[str] = None
    sabangnet_api_key: Optional[str] = None


# ──────────────────────────────────────────────
# Helper 직렬화 함수
# ──────────────────────────────────────────────

def _product_to_dict(p: MappingProduct, mapped_count: int = 0) -> dict:
    return {
        "id": p.id,
        "sabangnet_product_code": p.sabangnet_product_code,
        "product_name": p.product_name,
        "options": p.options,
        "category": p.category,
        "is_set": p.is_set,
        "set_components": p.set_components,
        "is_active": p.is_active,
        "mapped_count": mapped_count,
        "created_at": p.created_at.isoformat() if p.created_at else None,
        "updated_at": p.updated_at.isoformat() if p.updated_at else None,
    }


def _mall_product_to_dict(mp: MappingMallProduct) -> dict:
    return {
        "id": mp.id,
        "mall_name": mp.mall_name,
        "mall_product_code": mp.mall_product_code,
        "mall_product_name": mp.mall_product_name,
        "mall_option_name": mp.mall_option_name,
        "mall_option_code": mp.mall_option_code,
        "is_mapped": mp.is_mapped,
        "mapped_product_id": mp.mapped_product_id,
        "mapped_at": mp.mapped_at.isoformat() if mp.mapped_at else None,
        "created_at": mp.created_at.isoformat() if mp.created_at else None,
    }


def _suggestion_to_dict(
    s: MappingSuggestion,
    mall_product: MappingMallProduct = None,
    product: MappingProduct = None,
) -> dict:
    result = {
        "id": s.id,
        "mall_product_id": s.mall_product_id,
        "suggested_product_id": s.suggested_product_id,
        "confidence": s.confidence,
        "match_reason": s.match_reason,
        "status": s.status,
        "reviewed_by": s.reviewed_by,
        "reviewed_at": s.reviewed_at.isoformat() if s.reviewed_at else None,
        "created_at": s.created_at.isoformat() if s.created_at else None,
    }
    if mall_product:
        result["mall_product"] = _mall_product_to_dict(mall_product)
    if product:
        result["suggested_product"] = _product_to_dict(product)
    return result


def _log_to_dict(log: MappingLog) -> dict:
    return {
        "id": log.id,
        "action": log.action,
        "mall_name": log.mall_name,
        "details": log.details,
        "items_processed": log.items_processed,
        "items_success": log.items_success,
        "items_failed": log.items_failed,
        "error_message": log.error_message,
        "created_at": log.created_at.isoformat() if log.created_at else None,
    }


# ──────────────────────────────────────────────
# AI 매칭 유틸
# ──────────────────────────────────────────────

def generate_simple_match(mall_product: MappingMallProduct, products: list) -> dict:
    """간단한 문자열 유사도 기반 매칭"""
    import difflib

    mall_name_clean = (
        mall_product.mall_product_name.lower()
        .replace("[", "")
        .replace("]", "")
        .replace("널담", "")
        .strip()
    )
    best_match = None
    best_ratio = 0.0

    for p in products:
        product_name_clean = (
            p.product_name.lower()
            .replace("[", "")
            .replace("]", "")
            .replace("널담", "")
            .strip()
        )
        ratio = difflib.SequenceMatcher(None, mall_name_clean, product_name_clean).ratio()
        if ratio > best_ratio:
            best_ratio = ratio
            best_match = p

    if best_match and best_ratio > 0.3:
        return {
            "matched_code": best_match.sabangnet_product_code,
            "confidence": round(best_ratio, 2),
            "reason": (
                f"상품명 유사도 {round(best_ratio * 100)}%: "
                f"'{mall_product.mall_product_name}' ≈ '{best_match.product_name}'"
            ),
        }
    return {"matched_code": None, "confidence": 0.0, "reason": "유사한 상품을 찾지 못했습니다"}


async def generate_mapping_suggestion(
    mall_product: MappingMallProduct, products: list, db: Session
) -> dict:
    """AI로 쇼핑몰 상품과 자사 상품 매칭 제안 생성"""
    import anthropic
    from app.config import get_settings

    settings = get_settings()
    api_key = settings.ANTHROPIC_API_KEY

    if not api_key:
        return generate_simple_match(mall_product, products)

    product_list = "\n".join([
        f"- 코드: {p.sabangnet_product_code}, 상품명: {p.product_name}, "
        f"카테고리: {p.category or '없음'}, 세트: {'Y' if p.is_set else 'N'}"
        for p in products
    ])

    try:
        client = anthropic.Anthropic(api_key=api_key)
        message = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=1000,
            messages=[{
                "role": "user",
                "content": f"""다음 쇼핑몰 상품을 자사 상품 목록에서 매칭해주세요.

쇼핑몰 상품:
- 쇼핑몰: {mall_product.mall_name}
- 상품명: {mall_product.mall_product_name}
- 옵션: {mall_product.mall_option_name or '없음'}
- 상품코드: {mall_product.mall_product_code or '없음'}

자사 상품 목록:
{product_list}

다음 JSON 형식으로 답변해주세요:
{{"matched_code": "매칭된 자사 상품코드 또는 null", "confidence": 0.0~1.0, "reason": "매칭 근거 설명"}}

매칭되는 상품이 없으면 matched_code를 null로 설정하세요.""",
            }],
        )

        response_text = message.content[0].text

        import re
        json_match = re.search(r'\{[^}]+\}', response_text, re.DOTALL)
        if json_match:
            result = json.loads(json_match.group())
            return result

        return {"matched_code": None, "confidence": 0.0, "reason": "AI 응답 파싱 실패"}

    except Exception as e:
        logger.error(f"Claude API 호출 실패: {e}")
        return generate_simple_match(mall_product, products)


# ──────────────────────────────────────────────
# 대시보드
# ──────────────────────────────────────────────

@router.get("/dashboard")
def get_dashboard(db: Session = Depends(get_db)):
    """매핑 현황 종합 통계"""
    try:
        total_products = db.query(func.count(MappingProduct.id)).scalar() or 0
        total_mall_products = db.query(func.count(MappingMallProduct.id)).scalar() or 0
        mapped_count = (
            db.query(func.count(MappingMallProduct.id))
            .filter(MappingMallProduct.is_mapped == True)
            .scalar() or 0
        )
        unmapped_count = total_mall_products - mapped_count
        mapping_rate = round(mapped_count / total_mall_products * 100, 1) if total_mall_products > 0 else 0.0

        pending_suggestions = (
            db.query(func.count(MappingSuggestion.id))
            .filter(MappingSuggestion.status == "pending")
            .scalar() or 0
        )

        today = datetime.now().date()
        today_processed = (
            db.query(func.count(MappingLog.id))
            .filter(func.date(MappingLog.created_at) == today)
            .scalar() or 0
        )

        # 쇼핑몰별 매핑 현황
        mall_rows = (
            db.query(
                MappingMallProduct.mall_name,
                func.count(MappingMallProduct.id).label("total"),
                func.sum(
                    func.cast(MappingMallProduct.is_mapped, db.bind.dialect.name == "postgresql" and "integer" or "integer")
                ).label("mapped"),
            )
            .group_by(MappingMallProduct.mall_name)
            .all()
        )

        # SQLAlchemy에서 Boolean sum을 안전하게 처리
        mall_stats_rows = (
            db.query(MappingMallProduct.mall_name, MappingMallProduct.is_mapped)
            .all()
        )
        mall_agg: dict = {}
        for row in mall_stats_rows:
            name = row.mall_name
            if name not in mall_agg:
                mall_agg[name] = {"total": 0, "mapped": 0}
            mall_agg[name]["total"] += 1
            if row.is_mapped:
                mall_agg[name]["mapped"] += 1

        by_mall = []
        for mall_name, agg in mall_agg.items():
            total = agg["total"]
            mapped = agg["mapped"]
            unmapped = total - mapped
            rate = round(mapped / total * 100, 1) if total > 0 else 0.0
            by_mall.append({
                "mall_name": mall_name,
                "total": total,
                "mapped": mapped,
                "unmapped": unmapped,
                "rate": rate,
            })

        return {
            "total_products": total_products,
            "total_mall_products": total_mall_products,
            "mapped_count": mapped_count,
            "unmapped_count": unmapped_count,
            "mapping_rate": mapping_rate,
            "pending_suggestions": pending_suggestions,
            "today_processed": today_processed,
            "by_mall": by_mall,
        }
    except Exception as e:
        logger.error(f"대시보드 조회 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/logs")
def get_logs(
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    """작업 이력 조회"""
    try:
        total = db.query(func.count(MappingLog.id)).scalar() or 0
        offset = (page - 1) * limit
        logs = (
            db.query(MappingLog)
            .order_by(MappingLog.created_at.desc())
            .offset(offset)
            .limit(limit)
            .all()
        )
        return {
            "total": total,
            "page": page,
            "limit": limit,
            "items": [_log_to_dict(log) for log in logs],
        }
    except Exception as e:
        logger.error(f"로그 조회 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ──────────────────────────────────────────────
# 미매핑 상품 조회
# ──────────────────────────────────────────────

@router.post("/collect")
async def collect_unmapped(db: Session = Depends(get_db)):
    """사방넷 API로 미매핑 상품 수집.
    API가 설정되어 있으면 실제 사방넷 API를 호출하고,
    미설정 시 샘플 데이터로 fallback.
    """
    try:
        from app.services.sabangnet_api import get_sabangnet_api
        api = get_sabangnet_api()

        if api.is_available:
            result = await api.get_unmapped_products()
            if not result.get("error"):
                items = result.get("data", result.get("items", []))
                created = 0
                skipped = 0
                for item in items:
                    existing = (
                        db.query(MappingMallProduct)
                        .filter(
                            MappingMallProduct.mall_product_code == item.get("product_code", "")
                        )
                        .first()
                    )
                    if existing:
                        skipped += 1
                        continue
                    mp = MappingMallProduct(
                        mall_name=item.get("mall_name", item.get("shopping_mall", "")),
                        mall_product_code=item.get("product_code", ""),
                        mall_product_name=item.get("product_name", ""),
                        mall_option_name=item.get("option_name", None),
                        mall_option_code=item.get("option_code", None),
                        is_mapped=False,
                    )
                    db.add(mp)
                    created += 1

                db.commit()

                log = MappingLog(
                    action="collect",
                    details={"source": "sabangnet_api", "created": created, "skipped": skipped},
                    items_processed=len(items),
                    items_success=created,
                    items_failed=0,
                )
                db.add(log)
                db.commit()

                return {
                    "message": f"수집 완료: {created}개 신규 등록, {skipped}개 스킵",
                    "created": created,
                    "skipped": skipped,
                    "source": "sabangnet_api",
                }
            else:
                logger.warning(f"사방넷 API 오류, 샘플 데이터 사용: {result.get('message')}")

        # API 미설정 또는 API 오류 시 샘플 데이터 fallback
        samples = [
            {
                "mall_name": "쿠팡",
                "mall_product_code": "CP-001234",
                "mall_product_name": "널담 마카롱 복숭아 요거트 50g",
                "mall_option_name": "1박스 (10개입)",
            },
            {
                "mall_name": "스마트스토어",
                "mall_product_code": "NSS-005678",
                "mall_product_name": "[널담] 수제 마카롱 복숭아요거트맛 50g",
                "mall_option_name": None,
            },
            {
                "mall_name": "11번가",
                "mall_product_code": "11ST-009012",
                "mall_product_name": "널담 바닐라치즈케이크 120g 선물세트",
                "mall_option_name": "2개 묶음",
            },
            {
                "mall_name": "쿠팡",
                "mall_product_code": "CP-003456",
                "mall_product_name": "널담 아로마캔들 우드향 200g",
                "mall_option_name": "단품",
            },
            {
                "mall_name": "카카오선물하기",
                "mall_product_code": "KK-007890",
                "mall_product_name": "널담 수제비누 라벤더 100g 3개 세트",
                "mall_option_name": "3개입 세트",
            },
            {
                "mall_name": "지마켓",
                "mall_product_code": "GM-002345",
                "mall_product_name": "널담 버터쿠키 어쏘트 150g",
                "mall_option_name": None,
            },
        ]

        created = 0
        skipped = 0
        for sample in samples:
            existing = (
                db.query(MappingMallProduct)
                .filter(MappingMallProduct.mall_product_code == sample["mall_product_code"])
                .first()
            )
            if existing:
                skipped += 1
                continue

            mp = MappingMallProduct(
                mall_name=sample["mall_name"],
                mall_product_code=sample["mall_product_code"],
                mall_product_name=sample["mall_product_name"],
                mall_option_name=sample["mall_option_name"],
                is_mapped=False,
            )
            db.add(mp)
            created += 1

        db.commit()

        log = MappingLog(
            action="collect",
            details={"source": "sample", "created": created, "skipped": skipped},
            items_processed=len(samples),
            items_success=created,
            items_failed=0,
        )
        db.add(log)
        db.commit()

        return {
            "message": f"수집 완료: {created}개 신규 등록, {skipped}개 스킵",
            "created": created,
            "skipped": skipped,
            "source": "sample",
        }
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"미매핑 상품 수집 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/unmapped")
def list_unmapped(
    mall_name: Optional[str] = None,
    search: Optional[str] = None,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """미매핑 상품 목록 조회"""
    try:
        query = db.query(MappingMallProduct).filter(MappingMallProduct.is_mapped == False)

        if mall_name:
            query = query.filter(MappingMallProduct.mall_name == mall_name)
        if search:
            like_term = f"%{search}%"
            query = query.filter(
                MappingMallProduct.mall_product_name.ilike(like_term)
                | MappingMallProduct.mall_option_name.ilike(like_term)
            )

        total = query.count()
        offset = (page - 1) * limit
        items = query.order_by(MappingMallProduct.created_at.desc()).offset(offset).limit(limit).all()

        return {
            "total": total,
            "page": page,
            "limit": limit,
            "items": [_mall_product_to_dict(mp) for mp in items],
        }
    except Exception as e:
        logger.error(f"미매핑 목록 조회 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/unmapped/stats")
def get_unmapped_stats(db: Session = Depends(get_db)):
    """쇼핑몰별 미매핑 건수 통계"""
    try:
        rows = (
            db.query(MappingMallProduct.mall_name, func.count(MappingMallProduct.id))
            .filter(MappingMallProduct.is_mapped == False)
            .group_by(MappingMallProduct.mall_name)
            .all()
        )
        return [{"mall_name": row[0], "count": row[1]} for row in rows]
    except Exception as e:
        logger.error(f"미매핑 통계 조회 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ──────────────────────────────────────────────
# AI 매칭
# ──────────────────────────────────────────────

@router.post("/ai-suggest/{mall_product_id}")
async def ai_suggest(mall_product_id: int, db: Session = Depends(get_db)):
    """개별 AI 매칭 제안 생성"""
    try:
        mall_product = db.query(MappingMallProduct).filter(MappingMallProduct.id == mall_product_id).first()
        if not mall_product:
            raise HTTPException(status_code=404, detail="쇼핑몰 상품을 찾을 수 없습니다")

        products = db.query(MappingProduct).filter(MappingProduct.is_active == True).all()
        if not products:
            raise HTTPException(status_code=400, detail="자사 상품이 등록되어 있지 않습니다")

        result = await generate_mapping_suggestion(mall_product, products, db)

        matched_product = None
        if result.get("matched_code"):
            matched_product = (
                db.query(MappingProduct)
                .filter(MappingProduct.sabangnet_product_code == result["matched_code"])
                .first()
            )

        suggestion = MappingSuggestion(
            mall_product_id=mall_product_id,
            suggested_product_id=matched_product.id if matched_product else None,
            confidence=result.get("confidence", 0.0),
            match_reason=result.get("reason", ""),
            status="pending",
        )
        db.add(suggestion)
        db.commit()
        db.refresh(suggestion)

        log = MappingLog(
            action="ai_suggest",
            mall_name=mall_product.mall_name,
            details={
                "mall_product_id": mall_product_id,
                "matched_code": result.get("matched_code"),
                "confidence": result.get("confidence"),
            },
            items_processed=1,
            items_success=1 if matched_product else 0,
            items_failed=0 if matched_product else 1,
        )
        db.add(log)
        db.commit()

        return _suggestion_to_dict(suggestion, mall_product, matched_product)

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"AI 제안 생성 실패 (mall_product_id={mall_product_id}): {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/ai-suggest-bulk")
async def ai_suggest_bulk(body: BulkSuggestRequest, db: Session = Depends(get_db)):
    """일괄 AI 매칭 제안 생성"""
    total = len(body.mall_product_ids)
    success = 0
    failed = 0

    products = db.query(MappingProduct).filter(MappingProduct.is_active == True).all()

    for mid in body.mall_product_ids:
        try:
            mall_product = db.query(MappingMallProduct).filter(MappingMallProduct.id == mid).first()
            if not mall_product:
                failed += 1
                continue

            result = await generate_mapping_suggestion(mall_product, products, db)

            matched_product = None
            if result.get("matched_code"):
                matched_product = (
                    db.query(MappingProduct)
                    .filter(MappingProduct.sabangnet_product_code == result["matched_code"])
                    .first()
                )

            suggestion = MappingSuggestion(
                mall_product_id=mid,
                suggested_product_id=matched_product.id if matched_product else None,
                confidence=result.get("confidence", 0.0),
                match_reason=result.get("reason", ""),
                status="pending",
            )
            db.add(suggestion)
            db.commit()
            success += 1

        except Exception as e:
            db.rollback()
            logger.error(f"일괄 AI 제안 실패 (mall_product_id={mid}): {e}")
            failed += 1

    log = MappingLog(
        action="ai_suggest",
        details={"bulk": True, "mall_product_ids": body.mall_product_ids},
        items_processed=total,
        items_success=success,
        items_failed=failed,
    )
    db.add(log)
    db.commit()

    return {"total": total, "success": success, "failed": failed}


@router.get("/suggestions")
def list_suggestions(
    status: Optional[str] = None,
    mall_name: Optional[str] = None,
    confidence_min: Optional[float] = None,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """AI 매칭 제안 목록 조회"""
    try:
        query = db.query(MappingSuggestion)

        if status:
            query = query.filter(MappingSuggestion.status == status)
        if confidence_min is not None:
            query = query.filter(MappingSuggestion.confidence >= confidence_min)

        # mall_name 필터: JOIN 없이 서브쿼리로 처리
        if mall_name:
            mall_ids = (
                db.query(MappingMallProduct.id)
                .filter(MappingMallProduct.mall_name == mall_name)
                .subquery()
            )
            query = query.filter(MappingSuggestion.mall_product_id.in_(mall_ids))

        total = query.count()
        offset = (page - 1) * limit
        suggestions = (
            query.order_by(MappingSuggestion.created_at.desc())
            .offset(offset)
            .limit(limit)
            .all()
        )

        items = []
        for s in suggestions:
            mall_product = db.query(MappingMallProduct).filter(MappingMallProduct.id == s.mall_product_id).first()
            product = (
                db.query(MappingProduct).filter(MappingProduct.id == s.suggested_product_id).first()
                if s.suggested_product_id
                else None
            )
            items.append(_suggestion_to_dict(s, mall_product, product))

        return {"total": total, "page": page, "limit": limit, "items": items}
    except Exception as e:
        logger.error(f"제안 목록 조회 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ──────────────────────────────────────────────
# 매핑 승인
# ──────────────────────────────────────────────

@router.post("/approve/{suggestion_id}")
def approve_suggestion(suggestion_id: int, db: Session = Depends(get_db)):
    """개별 매핑 제안 승인"""
    try:
        suggestion = db.query(MappingSuggestion).filter(MappingSuggestion.id == suggestion_id).first()
        if not suggestion:
            raise HTTPException(status_code=404, detail="제안을 찾을 수 없습니다")

        suggestion.status = "approved"
        suggestion.reviewed_at = datetime.now()

        mall_product = db.query(MappingMallProduct).filter(MappingMallProduct.id == suggestion.mall_product_id).first()
        if mall_product and suggestion.suggested_product_id:
            mall_product.is_mapped = True
            mall_product.mapped_product_id = suggestion.suggested_product_id
            mall_product.mapped_at = datetime.now()

        db.commit()

        log = MappingLog(
            action="approve",
            mall_name=mall_product.mall_name if mall_product else None,
            details={"suggestion_id": suggestion_id},
            items_processed=1,
            items_success=1,
            items_failed=0,
        )
        db.add(log)
        db.commit()

        return {"message": "승인 완료", "suggestion_id": suggestion_id}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"승인 처리 실패 (suggestion_id={suggestion_id}): {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/approve-bulk")
def approve_bulk(body: BulkApproveRequest, db: Session = Depends(get_db)):
    """일괄 매핑 제안 승인"""
    total = len(body.suggestion_ids)
    success = 0
    failed = 0

    for sid in body.suggestion_ids:
        try:
            suggestion = db.query(MappingSuggestion).filter(MappingSuggestion.id == sid).first()
            if not suggestion:
                failed += 1
                continue

            suggestion.status = "approved"
            suggestion.reviewed_at = datetime.now()

            mall_product = (
                db.query(MappingMallProduct)
                .filter(MappingMallProduct.id == suggestion.mall_product_id)
                .first()
            )
            if mall_product and suggestion.suggested_product_id:
                mall_product.is_mapped = True
                mall_product.mapped_product_id = suggestion.suggested_product_id
                mall_product.mapped_at = datetime.now()

            db.commit()
            success += 1

        except Exception as e:
            db.rollback()
            logger.error(f"일괄 승인 실패 (suggestion_id={sid}): {e}")
            failed += 1

    log = MappingLog(
        action="approve",
        details={"bulk": True, "suggestion_ids": body.suggestion_ids},
        items_processed=total,
        items_success=success,
        items_failed=failed,
    )
    db.add(log)
    db.commit()

    return {"total": total, "success": success, "failed": failed}


@router.post("/reject/{suggestion_id}")
def reject_suggestion(suggestion_id: int, db: Session = Depends(get_db)):
    """매핑 제안 거부"""
    try:
        suggestion = db.query(MappingSuggestion).filter(MappingSuggestion.id == suggestion_id).first()
        if not suggestion:
            raise HTTPException(status_code=404, detail="제안을 찾을 수 없습니다")

        suggestion.status = "rejected"
        suggestion.reviewed_at = datetime.now()
        db.commit()

        mall_product = (
            db.query(MappingMallProduct)
            .filter(MappingMallProduct.id == suggestion.mall_product_id)
            .first()
        )

        log = MappingLog(
            action="reject",
            mall_name=mall_product.mall_name if mall_product else None,
            details={"suggestion_id": suggestion_id},
            items_processed=1,
            items_success=1,
            items_failed=0,
        )
        db.add(log)
        db.commit()

        return {"message": "거부 완료", "suggestion_id": suggestion_id}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"거부 처리 실패 (suggestion_id={suggestion_id}): {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ──────────────────────────────────────────────
# 상품 관리
# ──────────────────────────────────────────────

@router.get("/products")
def list_products(
    search: Optional[str] = None,
    category: Optional[str] = None,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """자사 상품 목록 조회"""
    try:
        query = db.query(MappingProduct)

        if search:
            like_term = f"%{search}%"
            query = query.filter(
                MappingProduct.product_name.ilike(like_term)
                | MappingProduct.sabangnet_product_code.ilike(like_term)
            )
        if category:
            query = query.filter(MappingProduct.category == category)

        total = query.count()
        offset = (page - 1) * limit
        products = query.order_by(MappingProduct.created_at.desc()).offset(offset).limit(limit).all()

        items = []
        for p in products:
            mapped_count = (
                db.query(func.count(MappingMallProduct.id))
                .filter(MappingMallProduct.mapped_product_id == p.id)
                .scalar() or 0
            )
            items.append(_product_to_dict(p, mapped_count))

        return {"total": total, "page": page, "limit": limit, "items": items}
    except Exception as e:
        logger.error(f"자사 상품 목록 조회 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/products")
def create_product(body: ProductCreate, db: Session = Depends(get_db)):
    """신규 자사 상품 등록"""
    try:
        existing = (
            db.query(MappingProduct)
            .filter(MappingProduct.sabangnet_product_code == body.sabangnet_product_code)
            .first()
        )
        if existing:
            raise HTTPException(status_code=400, detail="이미 등록된 상품 코드입니다")

        product = MappingProduct(
            sabangnet_product_code=body.sabangnet_product_code,
            product_name=body.product_name,
            options=body.options,
            category=body.category,
            is_set=body.is_set,
            set_components=body.set_components,
            is_active=True,
        )
        db.add(product)
        db.commit()
        db.refresh(product)

        log = MappingLog(
            action="register",
            details={
                "product_code": body.sabangnet_product_code,
                "product_name": body.product_name,
            },
            items_processed=1,
            items_success=1,
            items_failed=0,
        )
        db.add(log)
        db.commit()

        return _product_to_dict(product)
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"상품 등록 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/products/{product_id}")
def update_product(product_id: int, body: ProductUpdate, db: Session = Depends(get_db)):
    """자사 상품 수정"""
    try:
        product = db.query(MappingProduct).filter(MappingProduct.id == product_id).first()
        if not product:
            raise HTTPException(status_code=404, detail="상품을 찾을 수 없습니다")

        if body.product_name is not None:
            product.product_name = body.product_name
        if body.options is not None:
            product.options = body.options
        if body.category is not None:
            product.category = body.category
        if body.is_set is not None:
            product.is_set = body.is_set
        if body.set_components is not None:
            product.set_components = body.set_components
        if body.is_active is not None:
            product.is_active = body.is_active

        product.updated_at = datetime.now()
        db.commit()
        db.refresh(product)

        return _product_to_dict(product)
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"상품 수정 실패 (product_id={product_id}): {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/products/{product_id}/set-components")
def set_product_components(product_id: int, body: dict, db: Session = Depends(get_db)):
    """세트 구성 설정"""
    try:
        product = db.query(MappingProduct).filter(MappingProduct.id == product_id).first()
        if not product:
            raise HTTPException(status_code=404, detail="상품을 찾을 수 없습니다")

        components = body.get("components", [])
        product.is_set = True
        product.set_components = components
        product.updated_at = datetime.now()
        db.commit()
        db.refresh(product)

        return _product_to_dict(product)
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"세트 구성 설정 실패 (product_id={product_id}): {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ──────────────────────────────────────────────
# 신규 등록 + 즉시 매핑
# ──────────────────────────────────────────────

class RegisterAndMapRequest(BaseModel):
    """미매핑 쇼핑몰 상품에 대해 새 자사 상품을 등록하고 바로 매핑"""
    mall_product_id: int
    sabangnet_product_code: str
    product_name: str
    category: Optional[str] = None
    is_set: bool = False
    set_components: Optional[list] = None


@router.post("/register-and-map")
def register_and_map(body: RegisterAndMapRequest, db: Session = Depends(get_db)):
    """신규 자사 상품 등록 + 쇼핑몰 상품 즉시 매핑 (매칭 불가 시 사용)"""
    try:
        # 1. 쇼핑몰 상품 확인
        mall_product = db.query(MappingMallProduct).filter(MappingMallProduct.id == body.mall_product_id).first()
        if not mall_product:
            raise HTTPException(status_code=404, detail="쇼핑몰 상품을 찾을 수 없습니다")
        if mall_product.is_mapped:
            raise HTTPException(status_code=400, detail="이미 매핑된 상품입니다")

        # 2. 자사 상품 등록 (기존이면 재사용)
        existing = (
            db.query(MappingProduct)
            .filter(MappingProduct.sabangnet_product_code == body.sabangnet_product_code)
            .first()
        )
        if existing:
            product = existing
        else:
            product = MappingProduct(
                sabangnet_product_code=body.sabangnet_product_code,
                product_name=body.product_name,
                category=body.category,
                is_set=body.is_set,
                set_components=body.set_components,
                is_active=True,
            )
            db.add(product)
            db.flush()

        # 3. 매핑 연결
        mall_product.is_mapped = True
        mall_product.mapped_product_id = product.id
        mall_product.mapped_at = datetime.now()

        # 4. 로그 기록
        log = MappingLog(
            action="register_and_map",
            mall_name=mall_product.mall_name,
            details={
                "mall_product_id": body.mall_product_id,
                "mall_product_name": mall_product.mall_product_name,
                "product_code": body.sabangnet_product_code,
                "product_name": body.product_name,
                "is_new_product": existing is None,
            },
            items_processed=1,
            items_success=1,
            items_failed=0,
        )
        db.add(log)
        db.commit()
        db.refresh(product)

        return {
            "message": "상품 등록 및 매핑 완료",
            "product": _product_to_dict(product),
            "mall_product": _mall_product_to_dict(mall_product),
            "is_new_product": existing is None,
        }
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"신규 등록+매핑 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/manual-map")
def manual_map(body: dict, db: Session = Depends(get_db)):
    """기존 자사 상품에 수동 매핑 (AI 제안 없이 직접 선택)"""
    try:
        mall_product_id = body.get("mall_product_id")
        product_id = body.get("product_id")

        if not mall_product_id or not product_id:
            raise HTTPException(status_code=400, detail="mall_product_id와 product_id가 필요합니다")

        mall_product = db.query(MappingMallProduct).filter(MappingMallProduct.id == mall_product_id).first()
        if not mall_product:
            raise HTTPException(status_code=404, detail="쇼핑몰 상품을 찾을 수 없습니다")

        product = db.query(MappingProduct).filter(MappingProduct.id == product_id).first()
        if not product:
            raise HTTPException(status_code=404, detail="자사 상품을 찾을 수 없습니다")

        mall_product.is_mapped = True
        mall_product.mapped_product_id = product.id
        mall_product.mapped_at = datetime.now()

        log = MappingLog(
            action="manual_map",
            mall_name=mall_product.mall_name,
            details={
                "mall_product_id": mall_product_id,
                "product_id": product_id,
                "product_code": product.sabangnet_product_code,
            },
            items_processed=1,
            items_success=1,
            items_failed=0,
        )
        db.add(log)
        db.commit()

        return {
            "message": "수동 매핑 완료",
            "product": _product_to_dict(product),
            "mall_product": _mall_product_to_dict(mall_product),
        }
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"수동 매핑 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ──────────────────────────────────────────────
# 설정
# ──────────────────────────────────────────────

@router.get("/config")
def get_config(db: Session = Depends(get_db)):
    """자동 매핑 설정 조회"""
    try:
        from app.db_models import CsConfig

        keys = ["mapping_auto_threshold", "mapping_operation_mode", "mapping_sabangnet_api_key"]
        config_rows = (
            db.query(CsConfig)
            .filter(CsConfig.config_key.in_(keys))
            .all()
        )
        config_map = {row.config_key: row.config_value for row in config_rows}

        return {
            "auto_approve_threshold": float(config_map.get("mapping_auto_threshold", 0.95)),
            "operation_mode": config_map.get("mapping_operation_mode", "semi_auto"),
            "sabangnet_api_key": config_map.get("mapping_sabangnet_api_key", ""),
        }
    except Exception as e:
        logger.error(f"매핑 설정 조회 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/config")
def update_config(body: MappingConfigUpdate, db: Session = Depends(get_db)):
    """자동 매핑 설정 저장"""
    try:
        from app.db_models import CsConfig

        updates = {}
        if body.auto_approve_threshold is not None:
            updates["mapping_auto_threshold"] = str(body.auto_approve_threshold)
        if body.operation_mode is not None:
            updates["mapping_operation_mode"] = body.operation_mode
        if body.sabangnet_api_key is not None:
            updates["mapping_sabangnet_api_key"] = body.sabangnet_api_key

        for key, value in updates.items():
            existing = db.query(CsConfig).filter(CsConfig.config_key == key).first()
            if existing:
                existing.config_value = value
                existing.updated_at = datetime.now()
            else:
                db.add(CsConfig(config_key=key, config_value=value))

        db.commit()
        return {"message": "설정이 저장되었습니다", "updated_keys": list(updates.keys())}
    except Exception as e:
        db.rollback()
        logger.error(f"매핑 설정 저장 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ──────────────────────────────────────────────
# 샘플 데이터 초기화
# ──────────────────────────────────────────────

@router.post("/init-sample-products")
def init_sample_products(db: Session = Depends(get_db)):
    """테스트용 자사 상품 샘플 등록"""
    try:
        samples = [
            {
                "sabangnet_product_code": "ND-MAC-001",
                "product_name": "널담 마카롱 복숭아 요거트 [50g]",
                "category": "마카롱",
                "is_set": False,
            },
            {
                "sabangnet_product_code": "ND-CAK-001",
                "product_name": "널담 케이크 바닐라치즈 [120g]",
                "category": "케이크",
                "is_set": False,
            },
            {
                "sabangnet_product_code": "ND-CAN-001",
                "product_name": "널담 아로마 캔들 우드 [200g]",
                "category": "캔들",
                "is_set": False,
            },
            {
                "sabangnet_product_code": "ND-SOP-001",
                "product_name": "널담 수제 비누 라벤더 [100g]",
                "category": "비누",
                "is_set": False,
            },
            {
                "sabangnet_product_code": "ND-COK-001",
                "product_name": "널담 버터 쿠키 어쏘트 [150g]",
                "category": "쿠키",
                "is_set": False,
            },
            {
                "sabangnet_product_code": "ND-SET-001",
                "product_name": "널담 마카롱 3종 선물세트",
                "category": "세트",
                "is_set": True,
                "set_components": [{"product_code": "ND-MAC-001", "qty": 3}],
            },
            {
                "sabangnet_product_code": "ND-SET-002",
                "product_name": "널담 비누 라벤더 3개 세트",
                "category": "세트",
                "is_set": True,
                "set_components": [{"product_code": "ND-SOP-001", "qty": 3}],
            },
        ]

        created = 0
        skipped = 0
        for sample in samples:
            existing = (
                db.query(MappingProduct)
                .filter(MappingProduct.sabangnet_product_code == sample["sabangnet_product_code"])
                .first()
            )
            if existing:
                skipped += 1
                continue

            product = MappingProduct(
                sabangnet_product_code=sample["sabangnet_product_code"],
                product_name=sample["product_name"],
                category=sample.get("category"),
                is_set=sample.get("is_set", False),
                set_components=sample.get("set_components"),
                is_active=True,
            )
            db.add(product)
            created += 1

        db.commit()

        return {
            "message": f"샘플 상품 초기화 완료: {created}개 등록, {skipped}개 스킵",
            "created": created,
            "skipped": skipped,
        }
    except Exception as e:
        db.rollback()
        logger.error(f"샘플 상품 초기화 실패: {e}")
        raise HTTPException(status_code=500, detail=str(e))
