"""Meta (Facebook) Ads API 서비스"""
import logging
from datetime import datetime, timedelta
from typing import Optional
import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)

META_GRAPH_URL = "https://graph.facebook.com/v21.0"


class MetaAdsService:
    def __init__(self, access_token: Optional[str] = None, ad_account_id: Optional[str] = None):
        settings = get_settings()
        self.access_token = access_token or settings.META_ACCESS_TOKEN
        self.ad_account_id = ad_account_id or settings.META_AD_ACCOUNT_ID
        if self.ad_account_id and not self.ad_account_id.startswith("act_"):
            self.ad_account_id = f"act_{self.ad_account_id}"

    def _headers(self):
        return {"Authorization": f"Bearer {self.access_token}"}

    async def _get(self, url: str, params: dict = None):
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(url, params=params or {}, headers=self._headers())
            resp.raise_for_status()
            return resp.json()

    async def _post(self, url: str, data: dict = None):
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(url, data=data or {}, headers=self._headers())
            resp.raise_for_status()
            return resp.json()

    async def get_account_overview(self, date_preset: str = "last_7d") -> dict:
        """계정 전체 인사이트"""
        url = f"{META_GRAPH_URL}/{self.ad_account_id}/insights"
        params = {
            "date_preset": date_preset,
            "fields": "spend,impressions,clicks,cpc,cpm,ctr,actions,action_values,frequency,reach",
            "level": "account",
        }
        data = await self._get(url, params)
        return data.get("data", [{}])[0] if data.get("data") else {}

    async def get_campaigns(self, date_preset: str = "last_7d", limit: int = 100) -> list:
        """캠페인 목록 + 인사이트"""
        url = f"{META_GRAPH_URL}/{self.ad_account_id}/campaigns"
        params = {
            "fields": "id,name,status,effective_status,daily_budget,lifetime_budget,"
                      "objective,insights.date_preset({dp}){{spend,impressions,clicks,"
                      "cpc,cpm,ctr,actions,action_values,frequency,reach}}".format(dp=date_preset),
            "limit": limit,
        }
        data = await self._get(url, params)
        return data.get("data", [])

    async def get_campaign_daily_insights(self, campaign_id: str, days: int = 30) -> list:
        """캠페인 일별 인사이트"""
        since = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")
        until = datetime.now().strftime("%Y-%m-%d")
        url = f"{META_GRAPH_URL}/{campaign_id}/insights"
        params = {
            "time_range": f'{{"since":"{since}","until":"{until}"}}',
            "time_increment": 1,
            "fields": "spend,impressions,clicks,cpc,cpm,ctr,actions,action_values,frequency,reach,date_start",
        }
        data = await self._get(url, params)
        return data.get("data", [])

    async def get_adsets(self, campaign_id: Optional[str] = None, date_preset: str = "last_7d") -> list:
        """광고 세트 목록"""
        if campaign_id:
            url = f"{META_GRAPH_URL}/{campaign_id}/adsets"
        else:
            url = f"{META_GRAPH_URL}/{self.ad_account_id}/adsets"
        params = {
            "fields": "id,name,status,effective_status,daily_budget,lifetime_budget,"
                      "insights.date_preset({dp}){{spend,impressions,clicks,cpc,cpm,ctr,"
                      "actions,action_values,frequency}}".format(dp=date_preset),
            "limit": 100,
        }
        data = await self._get(url, params)
        return data.get("data", [])

    async def get_ads(self, adset_id: Optional[str] = None, date_preset: str = "last_7d") -> list:
        """광고 목록"""
        if adset_id:
            url = f"{META_GRAPH_URL}/{adset_id}/ads"
        else:
            url = f"{META_GRAPH_URL}/{self.ad_account_id}/ads"
        params = {
            "fields": "id,name,status,effective_status,"
                      "insights.date_preset({dp}){{spend,impressions,clicks,cpc,cpm,ctr,"
                      "actions,action_values,frequency}}".format(dp=date_preset),
            "limit": 100,
        }
        data = await self._get(url, params)
        return data.get("data", [])

    async def update_status(self, object_id: str, status: str) -> dict:
        """광고/캠페인/세트 상태 변경"""
        url = f"{META_GRAPH_URL}/{object_id}"
        return await self._post(url, {"status": status})

    async def update_budget(self, object_id: str, daily_budget: Optional[int] = None,
                            lifetime_budget: Optional[int] = None) -> dict:
        """예산 변경 (센트 단위)"""
        url = f"{META_GRAPH_URL}/{object_id}"
        data = {}
        if daily_budget is not None:
            data["daily_budget"] = daily_budget
        if lifetime_budget is not None:
            data["lifetime_budget"] = lifetime_budget
        return await self._post(url, data)

    async def get_daily_insights_for_target(self, target_type: str, target_id: str, days: int = 30) -> list:
        """대상(캠페인/광고세트/광고)의 일별 인사이트"""
        since = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")
        until = datetime.now().strftime("%Y-%m-%d")
        url = f"{META_GRAPH_URL}/{target_id}/insights"
        params = {
            "time_range": f'{{"since":"{since}","until":"{until}"}}',
            "time_increment": 1,
            "fields": "spend,impressions,clicks,cpc,cpm,ctr,actions,action_values,frequency,reach,date_start",
        }
        data = await self._get(url, params)
        return data.get("data", [])
