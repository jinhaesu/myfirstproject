from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel

from app.api.routes.auth import get_current_user
from app.config import get_settings
import anthropic


router = APIRouter(prefix="/ai", tags=["ai"])


class AIRequest(BaseModel):
    prompt: str
    data_title: str
    data_type: str
    data: list[list]


class AIResponse(BaseModel):
    content: str


def get_ai_client():
    settings = get_settings()
    return anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)


@router.post("/summary", response_model=AIResponse)
async def get_ai_summary(
    request: AIRequest,
    current_user: dict = Depends(get_current_user)
):
    """데이터 AI 요약"""
    client = get_ai_client()

    data_str = "\n".join([", ".join(str(cell) for cell in row) for row in request.data])

    prompt = f"""다음 영업 데이터를 분석하여 핵심 요약을 제공해주세요.

제목: {request.data_title}
데이터 유형: {request.data_type}

데이터:
{data_str}

다음 형식으로 요약해주세요:
1. **전체 추세**: 데이터의 전반적인 흐름
2. **주요 수치**: 핵심 지표 및 수치
3. **특이점**: 눈에 띄는 패턴이나 이상치

한글로 간결하게 작성해주세요."""

    try:
        message = client.messages.create(
            model="claude-opus-4-8",
            max_tokens=1024,
            messages=[{"role": "user", "content": prompt}]
        )
        return AIResponse(content=message.content[0].text)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI 요약 생성 실패: {str(e)}")


@router.post("/advice", response_model=AIResponse)
async def get_ai_advice(
    request: AIRequest,
    current_user: dict = Depends(get_current_user)
):
    """데이터 기반 AI 조언"""
    client = get_ai_client()

    data_str = "\n".join([", ".join(str(cell) for cell in row) for row in request.data])

    prompt = f"""다음 영업 데이터를 분석하여 개선 조언을 제공해주세요.

제목: {request.data_title}
데이터 유형: {request.data_type}

데이터:
{data_str}

다음 형식으로 조언해주세요:
1. **현재 상태 분석**: 데이터가 보여주는 현재 상황
2. **문제점 파악**: 개선이 필요한 부분
3. **개선 방안**: 구체적인 개선 전략
4. **실행 가능한 액션**: 바로 실행할 수 있는 단계별 행동

한글로 실용적이고 구체적으로 작성해주세요."""

    try:
        message = client.messages.create(
            model="claude-opus-4-8",
            max_tokens=1024,
            messages=[{"role": "user", "content": prompt}]
        )
        return AIResponse(content=message.content[0].text)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI 조언 생성 실패: {str(e)}")
