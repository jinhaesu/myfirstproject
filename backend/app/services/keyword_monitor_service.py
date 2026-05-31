import logging
from datetime import datetime, timezone
from uuid import uuid4

import httpx
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models.keyword_monitor import MonitoredKeyword, KeywordMetrics, KeywordSentiment

logger = logging.getLogger(__name__)


class KeywordMonitorService:
    """키워드 모니터링 서비스"""

    def __init__(self):
        self.settings = get_settings()

    async def fetch_instagram_metrics(self, keyword: str) -> dict:
        """Instagram Graph API를 통해 해시태그 메트릭 수집"""
        access_token = self.settings.META_ACCESS_TOKEN
        if not access_token:
            logger.warning("INSTAGRAM_ACCESS_TOKEN이 설정되지 않았습니다. 빈 데이터를 반환합니다.")
            return {"content_count": 0, "view_count": 0, "hashtags": []}

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                # 해시태그 ID 검색
                search_url = "https://graph.facebook.com/v18.0/ig_hashtag_search"
                search_resp = await client.get(search_url, params={
                    "q": keyword,
                    "user_id": "me",
                    "access_token": access_token,
                })
                search_data = search_resp.json()

                if "data" not in search_data or not search_data["data"]:
                    logger.warning(f"Instagram 해시태그 '{keyword}' 검색 결과 없음")
                    return {"content_count": 0, "view_count": 0, "hashtags": []}

                hashtag_id = search_data["data"][0]["id"]

                # 최근 미디어 조회
                media_url = f"https://graph.facebook.com/v18.0/{hashtag_id}/recent_media"
                media_resp = await client.get(media_url, params={
                    "user_id": "me",
                    "fields": "id,caption,like_count,comments_count",
                    "access_token": access_token,
                })
                media_data = media_resp.json()

                posts = media_data.get("data", [])
                content_count = len(posts)
                view_count = sum(
                    p.get("like_count", 0) + p.get("comments_count", 0)
                    for p in posts
                )

                # 캡션에서 해시태그 추출
                hashtags = set()
                for post in posts:
                    caption = post.get("caption", "")
                    if caption:
                        tags = [
                            word.strip("#")
                            for word in caption.split()
                            if word.startswith("#")
                        ]
                        hashtags.update(tags)

                return {
                    "content_count": content_count,
                    "view_count": view_count,
                    "hashtags": list(hashtags)[:50],
                }
        except Exception as e:
            logger.error(f"Instagram 메트릭 수집 오류: {e}")
            return {"content_count": 0, "view_count": 0, "hashtags": []}

    async def fetch_youtube_metrics(self, keyword: str) -> dict:
        """YouTube Data API v3를 통해 메트릭 수집"""
        api_key = getattr(self.settings, "YOUTUBE_API_KEY", "")
        if not api_key:
            logger.warning("YOUTUBE_API_KEY가 설정되지 않았습니다. 빈 데이터를 반환합니다.")
            return {"content_count": 0, "view_count": 0, "hashtags": []}

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                # 검색 API 호출
                search_url = "https://www.googleapis.com/youtube/v3/search"
                search_resp = await client.get(search_url, params={
                    "part": "snippet",
                    "q": keyword,
                    "type": "video",
                    "maxResults": 50,
                    "order": "date",
                    "key": api_key,
                })
                search_data = search_resp.json()

                items = search_data.get("items", [])
                content_count = search_data.get("pageInfo", {}).get("totalResults", len(items))

                # 비디오 ID 추출하여 통계 조회
                video_ids = [
                    item["id"]["videoId"]
                    for item in items
                    if "videoId" in item.get("id", {})
                ]

                view_count = 0
                hashtags = set()

                if video_ids:
                    videos_url = "https://www.googleapis.com/youtube/v3/videos"
                    videos_resp = await client.get(videos_url, params={
                        "part": "statistics,snippet",
                        "id": ",".join(video_ids),
                        "key": api_key,
                    })
                    videos_data = videos_resp.json()

                    for video in videos_data.get("items", []):
                        stats = video.get("statistics", {})
                        view_count += int(stats.get("viewCount", 0))

                        # 태그 추출
                        tags = video.get("snippet", {}).get("tags", [])
                        hashtags.update(tags[:10])

                return {
                    "content_count": content_count,
                    "view_count": view_count,
                    "hashtags": list(hashtags)[:50],
                }
        except Exception as e:
            logger.error(f"YouTube 메트릭 수집 오류: {e}")
            return {"content_count": 0, "view_count": 0, "hashtags": []}

    async def fetch_naver_metrics(self, keyword: str) -> dict:
        """Naver Search API + DataLab을 통해 메트릭 수집"""
        client_id = getattr(self.settings, "NAVER_CLIENT_ID", "")
        client_secret = getattr(self.settings, "NAVER_CLIENT_SECRET", "")

        if not client_id or not client_secret:
            logger.warning("NAVER_CLIENT_ID/SECRET이 설정되지 않았습니다. 빈 데이터를 반환합니다.")
            return {"content_count": 0, "search_volume": 0}

        try:
            headers = {
                "X-Naver-Client-Id": client_id,
                "X-Naver-Client-Secret": client_secret,
            }

            async with httpx.AsyncClient(timeout=30.0) as client:
                # 블로그 검색 API
                blog_url = "https://openapi.naver.com/v1/search/blog.json"
                blog_resp = await client.get(blog_url, params={
                    "query": keyword,
                    "display": 1,
                    "sort": "date",
                }, headers=headers)
                blog_data = blog_resp.json()
                content_count = blog_data.get("total", 0)

                # DataLab 검색량 조회
                datalab_url = "https://openapi.naver.com/v1/datalab/search"
                today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
                datalab_resp = await client.post(datalab_url, json={
                    "startDate": "2024-01-01",
                    "endDate": today,
                    "timeUnit": "month",
                    "keywordGroups": [
                        {"groupName": keyword, "keywords": [keyword]}
                    ],
                }, headers=headers)
                datalab_data = datalab_resp.json()

                search_volume = 0
                results = datalab_data.get("results", [])
                if results and results[0].get("data"):
                    # 최근 월 검색량 비율
                    latest = results[0]["data"][-1]
                    search_volume = int(latest.get("ratio", 0))

                return {
                    "content_count": content_count,
                    "search_volume": search_volume,
                }
        except Exception as e:
            logger.error(f"Naver 메트릭 수집 오류: {e}")
            return {"content_count": 0, "search_volume": 0}

    async def analyze_sentiment(self, keyword: str, platform: str, db: Session) -> dict:
        """Claude AI를 사용한 감성 분석"""
        api_key = self.settings.ANTHROPIC_API_KEY
        if not api_key:
            logger.warning("ANTHROPIC_API_KEY가 설정되지 않았습니다.")
            return {
                "positive_ratio": 0.0,
                "negative_ratio": 0.0,
                "neutral_ratio": 1.0,
                "positive_keywords": [],
                "negative_keywords": [],
                "sample_size": 0,
            }

        platform_name_map = {
            "instagram": "인스타그램",
            "youtube": "유튜브",
            "naver_blog": "네이버 블로그",
        }
        platform_kr = platform_name_map.get(platform, platform)

        prompt = (
            f"'{keyword}' 키워드에 대한 {platform_kr} 플랫폼의 최근 소셜 미디어 감성 분석을 수행해주세요.\n\n"
            f"다음 JSON 형식으로만 응답해주세요:\n"
            f'{{\n'
            f'  "positive_ratio": 0.0~1.0 사이의 긍정 비율,\n'
            f'  "negative_ratio": 0.0~1.0 사이의 부정 비율,\n'
            f'  "neutral_ratio": 0.0~1.0 사이의 중립 비율,\n'
            f'  "positive_keywords": ["긍정 키워드1", "긍정 키워드2", ...],\n'
            f'  "negative_keywords": ["부정 키워드1", "부정 키워드2", ...],\n'
            f'  "sample_size": 분석한 콘텐츠 수 (추정치)\n'
            f'}}\n\n'
            f"비율의 합은 1.0이어야 합니다. 키워드는 한국어로 작성해주세요."
        )

        try:
            import anthropic

            client = anthropic.Anthropic(api_key=api_key)
            message = client.messages.create(
                model="claude-opus-4-8",
                max_tokens=1024,
                messages=[{"role": "user", "content": prompt}],
            )

            import json
            response_text = message.content[0].text
            # JSON 부분 추출
            start = response_text.find("{")
            end = response_text.rfind("}") + 1
            if start >= 0 and end > start:
                result = json.loads(response_text[start:end])
                return {
                    "positive_ratio": float(result.get("positive_ratio", 0)),
                    "negative_ratio": float(result.get("negative_ratio", 0)),
                    "neutral_ratio": float(result.get("neutral_ratio", 0)),
                    "positive_keywords": result.get("positive_keywords", []),
                    "negative_keywords": result.get("negative_keywords", []),
                    "sample_size": int(result.get("sample_size", 0)),
                }
        except Exception as e:
            logger.error(f"감성 분석 오류: {e}")

        return {
            "positive_ratio": 0.0,
            "negative_ratio": 0.0,
            "neutral_ratio": 1.0,
            "positive_keywords": [],
            "negative_keywords": [],
            "sample_size": 0,
        }

    async def collect_all_metrics(self, keyword_id: str, db: Session) -> dict:
        """모든 플랫폼의 메트릭을 수집하고 DB에 저장"""
        # 키워드 조회
        keyword_row = db.query(MonitoredKeyword).filter(
            MonitoredKeyword.id == keyword_id
        ).first()

        if not keyword_row:
            raise ValueError(f"키워드를 찾을 수 없습니다: {keyword_id}")

        keyword = keyword_row.keyword
        now = datetime.now(timezone.utc)
        results = {}

        # 1. 각 플랫폼 메트릭 수집
        instagram_data = await self.fetch_instagram_metrics(keyword)
        youtube_data = await self.fetch_youtube_metrics(keyword)
        naver_data = await self.fetch_naver_metrics(keyword)

        platform_data = {
            "instagram": instagram_data,
            "youtube": youtube_data,
            "naver_blog": naver_data,
        }

        # 2. KeywordMetrics 저장
        for platform, data in platform_data.items():
            metrics = KeywordMetrics(
                id=str(uuid4()),
                keyword_id=keyword_id,
                platform=platform,
                date=now,
                content_count=data.get("content_count", 0),
                view_count=data.get("view_count", 0),
                hashtags=data.get("hashtags"),
                search_volume=data.get("search_volume"),
                raw_data=data,
            )
            db.add(metrics)

        results["metrics"] = platform_data

        # 3. 감성 분석 수행 및 저장
        sentiments = {}
        for platform in ["instagram", "youtube", "naver_blog"]:
            sentiment_data = await self.analyze_sentiment(keyword, platform, db)
            sentiment = KeywordSentiment(
                id=str(uuid4()),
                keyword_id=keyword_id,
                platform=platform,
                date=now,
                positive_ratio=sentiment_data["positive_ratio"],
                negative_ratio=sentiment_data["negative_ratio"],
                neutral_ratio=sentiment_data["neutral_ratio"],
                positive_keywords=sentiment_data["positive_keywords"],
                negative_keywords=sentiment_data["negative_keywords"],
                sample_size=sentiment_data["sample_size"],
            )
            db.add(sentiment)
            sentiments[platform] = sentiment_data

        results["sentiments"] = sentiments

        db.commit()
        return results
