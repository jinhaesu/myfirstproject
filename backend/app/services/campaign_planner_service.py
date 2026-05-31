"""AI 캠페인 기획 서비스 — Claude AI 기반 캠페인 기획서 및 소재 브리프 생성"""
import json
import logging
from typing import Optional

import anthropic
import httpx

from app.config import get_settings
from app.services.meta_ads_service import MetaAdsService

logger = logging.getLogger(__name__)

META_GRAPH_URL = "https://graph.facebook.com/v21.0"

GOAL_TO_OBJECTIVE = {
    "awareness": "OUTCOME_AWARENESS",
    "traffic": "OUTCOME_TRAFFIC",
    "conversions": "OUTCOME_SALES",
    "app_installs": "OUTCOME_SALES",
    "leads": "OUTCOME_LEADS",
}

OBJECTIVE_TO_OPTIMIZATION = {
    "OUTCOME_AWARENESS": "REACH",
    "OUTCOME_TRAFFIC": "LINK_CLICKS",
    "OUTCOME_SALES": "OFFSITE_CONVERSIONS",
    "OUTCOME_LEADS": "LEAD_GENERATION",
    "OUTCOME_ENGAGEMENT": "POST_ENGAGEMENT",
}


class CampaignPlannerService:
    def __init__(self):
        settings = get_settings()
        self.anthropic_client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)
        self.meta_service = MetaAdsService()

    def _parse_json_response(self, text: str) -> dict:
        """Claude 응답에서 JSON을 파싱 (마크다운 코드블록 처리)"""
        text = text.strip()
        if text.startswith("```"):
            # 첫 번째 코드블록 추출
            lines = text.split("\n")
            start = 1  # ``` 다음 줄
            if lines[0].startswith("```json"):
                start = 1
            end = len(lines) - 1
            for i in range(start, len(lines)):
                if lines[i].strip() == "```":
                    end = i
                    break
            text = "\n".join(lines[start:end])
        return json.loads(text)

    async def generate_plan(
        self,
        product_name: str,
        product_url: Optional[str],
        product_description: Optional[str],
        campaign_goal: str,
        reference_urls: Optional[list],
        additional_notes: Optional[str],
    ) -> dict:
        """Claude AI로 캠페인 기획서 생성"""

        meta_objective = GOAL_TO_OBJECTIVE.get(campaign_goal, "OUTCOME_TRAFFIC")

        goal_korean = {
            "awareness": "브랜드 인지도 향상",
            "traffic": "웹사이트 트래픽 유도",
            "conversions": "전환/구매 증대",
            "app_installs": "앱 설치 유도",
            "leads": "리드(잠재고객) 수집",
        }.get(campaign_goal, campaign_goal)

        reference_section = ""
        if reference_urls:
            reference_section = f"""
## 참고 콘텐츠 URL
{chr(10).join(f'- {url}' for url in reference_urls)}
위 참고 콘텐츠의 톤앤매너, 구성, 크리에이티브 방향을 분석하여 기획에 반영하세요.
"""

        notes_section = ""
        if additional_notes:
            notes_section = f"""
## 광고주 추가 요청사항
{additional_notes}
"""

        prompt = f"""당신은 한국의 Top-tier 퍼포먼스 마케팅 에이전시 소속 시니어 미디어 바이어입니다.
10년 이상의 Meta(Facebook/Instagram) 광고 운영 경험과 수백 개의 성공 캠페인 포트폴리오를 보유하고 있습니다.

아래 제품/서비스 정보를 바탕으로 Meta 광고 캠페인 기획서를 작성하세요.
기획서는 즉시 실행 가능한 수준의 구체적이고 전문적인 내용이어야 합니다.

═══════════════════════════════════════
제품/서비스 정보
═══════════════════════════════════════

- 제품/서비스명: {product_name}
- 제품 URL: {product_url or '미제공'}
- 제품 설명: {product_description or '미제공'}
- 캠페인 목표: {goal_korean}
- Meta 목적(Objective): {meta_objective}
{reference_section}
{notes_section}

═══════════════════════════════════════
출력 요구사항
═══════════════════════════════════════

아래 JSON 구조로 정확하게 응답하세요. 모든 텍스트 값은 한국어로 작성하세요.
strategy_summary, creative_format의 format_reason, ad_copies 등 모두 한국어입니다.

```json
{{
  "campaign_name": "캠페인명 (브랜드명 + 목표 반영, 20자 이내)",
  "objective": "{meta_objective}",
  "strategy_summary": "전체 캠페인 전략 요약 (한국어 3-4문장, 왜 이 전략이 효과적인지, 핵심 차별점, 예상 성과 포인트)",

  "target_audience": {{
    "age_min": 18,
    "age_max": 65,
    "genders": ["male", "female"],
    "interests": ["관심사1", "관심사2", "관심사3", "관심사4", "관심사5"],
    "locations": ["KR"],
    "custom_audiences": "리타겟팅/LAL 등 커스텀 오디언스 활용 전략 설명 (한국어)"
  }},

  "budget": {{
    "daily_budget": 50000,
    "total_budget": 1500000,
    "duration_days": 30,
    "budget_rationale": "예산 배분 근거 (한국어, 업종 평균 CPC/CPM 기준 설명)"
  }},

  "scheduling": {{
    "start_suggestion": "캠페인 시작 추천 시점 설명 (한국어)",
    "best_times": ["09:00-12:00", "18:00-22:00"],
    "scheduling_rationale": "시간대 선정 근거 (한국어, 타겟 행동 패턴 기반)"
  }},

  "creative_format": {{
    "format": "short_form_video 또는 image 중 택 1",
    "format_reason": "해당 형식을 추천하는 이유 (한국어 2-3문장, 업종/목표/트렌드 기반 근거)"
  }},

  "ad_copies": [
    {{
      "variant": "A (메인)",
      "headline": "헤드라인 (25자 이내, 핵심 가치 제안)",
      "primary_text": "본문 텍스트 (125자 내외, 후킹 → 핵심가치 → CTA 구조)",
      "description": "설명문 (30자 이내)",
      "cta": "LEARN_MORE 또는 SHOP_NOW 또는 SIGN_UP 또는 DOWNLOAD 등"
    }},
    {{
      "variant": "B (감성형)",
      "headline": "...",
      "primary_text": "...",
      "description": "...",
      "cta": "..."
    }},
    {{
      "variant": "C (프로모션형)",
      "headline": "...",
      "primary_text": "...",
      "description": "...",
      "cta": "..."
    }}
  ],

  "video_script": [
    {{
      "scene_number": 1,
      "duration_seconds": 3,
      "visual_description": "화면에 보여질 영상/이미지 묘사 (한국어, 구체적)",
      "text_overlay": "화면에 표시되는 텍스트",
      "narration": "내레이션 또는 자막 텍스트",
      "music_mood": "배경 음악 분위기 (예: 경쾌한 일렉트로닉, 감성적인 어쿠스틱 등)"
    }}
  ],

  "image_concept": {{
    "composition": "이미지 구도 설명 (한국어)",
    "color_scheme": ["#HEX1", "#HEX2", "#HEX3"],
    "key_elements": ["핵심 요소1", "핵심 요소2", "핵심 요소3"],
    "mood": "전체 무드/톤 설명 (한국어)"
  }}
}}
```

중요 지침:
1. creative_format.format이 "short_form_video"면 video_script를 5-8개 씬으로 상세히, image_concept은 간략하게
2. creative_format.format이 "image"면 image_concept을 상세히, video_script는 빈 배열 []
3. 숏폼 영상의 총 길이는 15-30초가 적합
4. ad_copies는 반드시 3개 변형을 생성하되, 각각 다른 소구점(기능/감성/가격)을 공략
5. target_audience의 interests는 Meta Ads Manager에서 실제로 타겟팅 가능한 관심사를 사용
6. daily_budget은 KRW(원) 단위, 캠페인 목표와 업종에 맞는 현실적인 금액 제안
7. JSON만 출력하세요. 추가 설명 없이 순수 JSON만 반환하세요."""

        try:
            message = self.anthropic_client.messages.create(
                model="claude-opus-4-8",
                max_tokens=4096,
                messages=[{"role": "user", "content": prompt}],
            )
            text = message.content[0].text
            plan = self._parse_json_response(text)
            return plan
        except json.JSONDecodeError as e:
            logger.error(f"AI 응답 JSON 파싱 실패: {e}")
            raise ValueError(f"AI 응답을 파싱할 수 없습니다: {str(e)}")
        except Exception as e:
            logger.error(f"AI 기획 생성 실패: {e}")
            raise

    async def generate_creative_brief(self, plan_id: str, db) -> dict:
        """기존 plan의 ai_plan을 기반으로 소재 제작 브리프 생성"""
        from app.models.campaign_plan import CampaignPlan

        plan = db.query(CampaignPlan).filter(CampaignPlan.id == plan_id).first()
        if not plan:
            raise ValueError("기획서를 찾을 수 없습니다")
        if not plan.ai_plan:
            raise ValueError("AI 기획이 생성되지 않은 기획서입니다")

        ai_plan = plan.ai_plan
        creative_format = ai_plan.get("creative_format", {}).get("format", "image")

        if creative_format == "short_form_video":
            prompt = self._build_video_brief_prompt(ai_plan, plan.product_name)
        else:
            prompt = self._build_image_brief_prompt(ai_plan, plan.product_name)

        try:
            message = self.anthropic_client.messages.create(
                model="claude-opus-4-8",
                max_tokens=4096,
                messages=[{"role": "user", "content": prompt}],
            )
            text = message.content[0].text
            creative_brief = self._parse_json_response(text)

            # DB 업데이트
            plan.creative_brief = creative_brief
            db.commit()
            db.refresh(plan)

            return creative_brief
        except json.JSONDecodeError as e:
            logger.error(f"크리에이티브 브리프 JSON 파싱 실패: {e}")
            raise ValueError(f"AI 응답을 파싱할 수 없습니다: {str(e)}")
        except Exception as e:
            logger.error(f"크리에이티브 브리프 생성 실패: {e}")
            raise

    def _build_video_brief_prompt(self, ai_plan: dict, product_name: str) -> str:
        """숏폼 영상 소재 제작 브리프 프롬프트"""
        video_script = json.dumps(ai_plan.get("video_script", []), ensure_ascii=False, indent=2)
        ad_copies = json.dumps(ai_plan.get("ad_copies", []), ensure_ascii=False, indent=2)
        strategy = ai_plan.get("strategy_summary", "")

        return f"""당신은 한국 최고의 퍼포먼스 마케팅 영상 크리에이티브 디렉터입니다.
숏폼 광고 영상(릴스, 숏츠, 틱톡) 제작으로 수많은 ROAS 신기록을 세운 전문가입니다.

아래 캠페인 기획 정보를 바탕으로 영상 제작팀에게 전달할 상세 소재 제작 브리프를 작성하세요.

═══════════════════════════════════════
캠페인 정보
═══════════════════════════════════════
- 제품: {product_name}
- 전략: {strategy}
- 기존 영상 스크립트: {video_script}
- 광고 카피: {ad_copies}

═══════════════════════════════════════
출력 형식 (JSON)
═══════════════════════════════════════

```json
{{
  "brief_type": "short_form_video",
  "overall_direction": "전체 크리에이티브 방향성 (한국어 3-4문장)",
  "total_duration_seconds": 15,
  "aspect_ratio": "9:16",
  "platform_specs": {{
    "instagram_reels": "1080x1920px, 최대 90초",
    "youtube_shorts": "1080x1920px, 최대 60초",
    "tiktok": "1080x1920px, 최대 60초"
  }},
  "scenes": [
    {{
      "scene_number": 1,
      "scene_name": "씬 이름 (예: 후킹/문제제기)",
      "duration_seconds": 3,
      "camera_angle": "카메라 앵글/움직임 (예: 클로즈업, 탑다운, 핸드헬드 등)",
      "visual_description": "화면 구성 상세 묘사 (한국어, 촬영/편집 팀이 바로 작업 가능한 수준)",
      "text_overlay": {{
        "text": "화면 텍스트",
        "position": "상단/중앙/하단",
        "animation": "페이드인/슬라이드/타이핑 등",
        "font_style": "폰트 스타일 추천"
      }},
      "narration": "내레이션 또는 자막 (한국어)",
      "transition": "다음 씬으로의 전환 효과 (컷/디졸브/스와이프 등)",
      "music_mood": "이 구간 배경 음악 분위기",
      "sound_effects": "효과음 설명 (있다면)"
    }}
  ],
  "music_direction": {{
    "genre": "음악 장르",
    "bpm_range": "BPM 범위",
    "mood_progression": "음악 분위기 전개 설명 (한국어)",
    "reference_tracks": "참고 트랙 스타일 (한국어)"
  }},
  "thumbnail_concept": {{
    "description": "썸네일 콘셉트 설명 (한국어)",
    "key_text": "썸네일 텍스트",
    "color_scheme": ["#HEX1", "#HEX2"],
    "composition": "구도 설명"
  }},
  "production_notes": [
    "제작 시 주의사항 1 (한국어)",
    "제작 시 주의사항 2 (한국어)",
    "제작 시 주의사항 3 (한국어)"
  ]
}}
```

중요:
- 씬은 5-8개로 구성, 총 길이 15-30초
- 첫 3초 내에 강력한 후킹 필수
- 각 씬의 visual_description은 촬영팀이 별도 질문 없이 바로 촬영할 수 있을 정도로 구체적으로
- CTA는 마지막 씬에 명확하게
- JSON만 출력하세요."""

    def _build_image_brief_prompt(self, ai_plan: dict, product_name: str) -> str:
        """이미지 소재 제작 브리프 프롬프트"""
        image_concept = json.dumps(ai_plan.get("image_concept", {}), ensure_ascii=False, indent=2)
        ad_copies = json.dumps(ai_plan.get("ad_copies", []), ensure_ascii=False, indent=2)
        strategy = ai_plan.get("strategy_summary", "")

        return f"""당신은 한국 최고의 퍼포먼스 마케팅 비주얼 크리에이티브 디렉터입니다.
Meta(Facebook/Instagram) 이미지 광고 소재로 수많은 전환 성과를 달성한 전문가입니다.

아래 캠페인 기획 정보를 바탕으로 디자이너에게 전달할 상세 이미지 소재 제작 브리프를 작성하세요.

═══════════════════════════════════════
캠페인 정보
═══════════════════════════════════════
- 제품: {product_name}
- 전략: {strategy}
- 이미지 콘셉트: {image_concept}
- 광고 카피: {ad_copies}

═══════════════════════════════════════
출력 형식 (JSON)
═══════════════════════════════════════

```json
{{
  "brief_type": "image",
  "overall_direction": "전체 크리에이티브 방향성 (한국어 3-4문장)",
  "platform_specs": {{
    "feed": "1080x1080px (1:1) 또는 1080x1350px (4:5)",
    "stories": "1080x1920px (9:16)",
    "sizes_needed": ["1080x1080", "1080x1350", "1080x1920"]
  }},
  "variants": [
    {{
      "variant_name": "변형 A — 메인 비주얼",
      "concept": "콘셉트 설명 (한국어 2-3문장)",
      "image_prompt": "AI 이미지 생성 프롬프트 (Midjourney/DALL-E 스타일, 영어+한국어 혼합 가능, 매우 상세하게)",
      "layout": {{
        "composition": "구도 상세 설명 (한국어)",
        "focal_point": "시선이 먼저 가는 포인트",
        "text_placement": "텍스트 배치 위치와 방법"
      }},
      "color_palette": [
        {{"hex": "#HEX1", "name": "색상명", "usage": "사용 용도"}},
        {{"hex": "#HEX2", "name": "색상명", "usage": "사용 용도"}},
        {{"hex": "#HEX3", "name": "색상명", "usage": "사용 용도"}}
      ],
      "typography": {{
        "headline_font": "헤드라인 폰트 추천 (한글 폰트 포함)",
        "body_font": "본문 폰트 추천",
        "font_sizes": "사이즈 가이드"
      }},
      "key_elements": ["핵심 시각 요소 1", "핵심 시각 요소 2", "핵심 시각 요소 3"],
      "mood": "분위기/톤 설명 (한국어)"
    }},
    {{
      "variant_name": "변형 B — 라이프스타일",
      "concept": "...",
      "image_prompt": "...",
      "layout": {{}},
      "color_palette": [],
      "typography": {{}},
      "key_elements": [],
      "mood": "..."
    }},
    {{
      "variant_name": "변형 C — 프로모션/임팩트",
      "concept": "...",
      "image_prompt": "...",
      "layout": {{}},
      "color_palette": [],
      "typography": {{}},
      "key_elements": [],
      "mood": "..."
    }}
  ],
  "design_guidelines": {{
    "do": ["디자인 가이드 - 해야 할 것 1", "해야 할 것 2", "해야 할 것 3"],
    "dont": ["하지 말아야 할 것 1", "하지 말아야 할 것 2", "하지 말아야 할 것 3"],
    "brand_consistency": "브랜드 일관성 유지 방안 (한국어)"
  }},
  "production_notes": [
    "제작 시 주의사항 1 (한국어)",
    "제작 시 주의사항 2 (한국어)",
    "제작 시 주의사항 3 (한국어)"
  ]
}}
```

중요:
- 변형(variants)은 반드시 3개, 각각 다른 소구점과 비주얼 접근
- image_prompt는 AI 이미지 생성 도구(Midjourney, DALL-E 등)에 바로 입력 가능한 수준으로 상세하게
- color_palette의 hex 코드는 실제 사용 가능한 유효한 색상 코드
- 한글 폰트 추천 시 Pretendard, Spoqa Han Sans Neo, Noto Sans KR 등 웹폰트 사용 가능한 것으로
- JSON만 출력하세요."""

    async def create_meta_draft(self, plan_id: str, db) -> dict:
        """AI 기획서 → Meta 광고 DRAFT 캠페인 생성"""
        from app.models.campaign_plan import CampaignPlan

        plan = db.query(CampaignPlan).filter(CampaignPlan.id == plan_id).first()
        if not plan:
            raise ValueError("기획서를 찾을 수 없습니다")
        if not plan.ai_plan:
            raise ValueError("AI 기획이 생성되지 않은 기획서입니다. 먼저 기획을 생성해주세요.")

        ai_plan = plan.ai_plan
        settings = get_settings()
        account_id = settings.META_AD_ACCOUNT_ID
        if account_id and not account_id.startswith("act_"):
            account_id = f"act_{account_id}"

        access_token = settings.META_ACCESS_TOKEN
        objective = ai_plan.get("objective", "OUTCOME_TRAFFIC")
        campaign_name = ai_plan.get("campaign_name", plan.product_name)

        try:
            # 1. 캠페인 생성
            async with httpx.AsyncClient(timeout=30) as client:
                campaign_resp = await client.post(
                    f"{META_GRAPH_URL}/{account_id}/campaigns",
                    data={
                        "name": campaign_name,
                        "objective": objective,
                        "status": "PAUSED",
                        "special_ad_categories": "[]",
                        "access_token": access_token,
                    },
                )
                campaign_resp.raise_for_status()
                campaign_data = campaign_resp.json()
                campaign_id = campaign_data.get("id")

            if not campaign_id:
                raise ValueError("캠페인 ID를 받아오지 못했습니다. Meta API 응답을 확인하세요.")

            # 2. 광고 세트 생성
            target_audience = ai_plan.get("target_audience", {})
            budget_info = ai_plan.get("budget", {})
            daily_budget_krw = budget_info.get("daily_budget", 50000)
            # Meta API는 센트 단위이지만 KRW는 소수점이 없으므로 그대로 사용
            daily_budget_cents = int(daily_budget_krw)

            optimization_goal = OBJECTIVE_TO_OPTIMIZATION.get(objective, "LINK_CLICKS")

            # 타겟팅 구성
            targeting = {
                "age_min": target_audience.get("age_min", 18),
                "age_max": target_audience.get("age_max", 65),
                "geo_locations": {
                    "countries": target_audience.get("locations", ["KR"]),
                },
            }

            genders_raw = target_audience.get("genders", ["male", "female"])
            if isinstance(genders_raw, list):
                if genders_raw == ["male"]:
                    targeting["genders"] = [1]
                elif genders_raw == ["female"]:
                    targeting["genders"] = [2]
                # both genders = omit genders field (all)

            adset_name = f"{campaign_name} - 광고세트"

            async with httpx.AsyncClient(timeout=30) as client:
                adset_resp = await client.post(
                    f"{META_GRAPH_URL}/{account_id}/adsets",
                    data={
                        "campaign_id": campaign_id,
                        "name": adset_name,
                        "daily_budget": daily_budget_cents,
                        "billing_event": "IMPRESSIONS",
                        "optimization_goal": optimization_goal,
                        "targeting": json.dumps(targeting),
                        "status": "PAUSED",
                        "access_token": access_token,
                    },
                )
                adset_resp.raise_for_status()
                adset_data = adset_resp.json()
                adset_id = adset_data.get("id")

            # 3. DB 업데이트
            plan.meta_campaign_id = campaign_id
            plan.meta_adset_id = adset_id
            plan.status = "submitted"
            db.commit()
            db.refresh(plan)

            return {
                "campaign_id": campaign_id,
                "adset_id": adset_id,
                "campaign_url": f"https://business.facebook.com/adsmanager/manage/campaigns?act={account_id.replace('act_', '')}&selected_campaign_ids={campaign_id}",
                "message": "캠페인이 PAUSED 상태로 성공적으로 생성되었습니다. Meta 광고 관리자에서 소재를 업로드한 후 활성화하세요.",
            }

        except httpx.HTTPStatusError as e:
            error_body = e.response.text
            logger.error(f"Meta API 오류: {error_body}")
            try:
                error_json = json.loads(error_body)
                error_message = error_json.get("error", {}).get("message", str(e))
            except Exception:
                error_message = str(e)
            raise ValueError(f"Meta 광고 생성 실패: {error_message}")
        except Exception as e:
            logger.error(f"Meta 드래프트 캠페인 생성 실패: {e}")
            raise ValueError(f"캠페인 생성 중 오류가 발생했습니다: {str(e)}")
