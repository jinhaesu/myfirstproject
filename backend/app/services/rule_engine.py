"""자동 관리 룰 평가 엔진"""
import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.orm import Session

from app.models.auto_rule import AutoRule, AutoRuleLog
from app.services.meta_ads_service import MetaAdsService

logger = logging.getLogger(__name__)


def _extract_metric(insight: dict, metric: str) -> Optional[float]:
    """인사이트 데이터에서 지표 추출"""
    direct = {"cpc": "cpc", "ctr": "ctr", "cpm": "cpm", "spend": "spend", "frequency": "frequency"}
    if metric in direct:
        val = insight.get(direct[metric])
        return float(val) if val else None

    spend = float(insight.get("spend", 0) or 0)
    clicks = float(insight.get("clicks", 0) or 0)
    actions = insight.get("actions", []) or []
    action_values = insight.get("action_values", []) or []

    conversions = 0
    purchase_value = 0
    for a in actions:
        if a.get("action_type") in ("purchase", "offsite_conversion.fb_pixel_purchase"):
            conversions += float(a.get("value", 0))
    for av in action_values:
        if av.get("action_type") in ("purchase", "offsite_conversion.fb_pixel_purchase"):
            purchase_value += float(av.get("value", 0))

    if metric == "roas":
        return (purchase_value / spend) if spend > 0 else None
    if metric == "cvr":
        return (conversions / clicks * 100) if clicks > 0 else None
    return None


def _compare(value: float, operator: str, threshold: float) -> bool:
    ops = {"gt": value > threshold, "lt": value < threshold,
           "gte": value >= threshold, "lte": value <= threshold}
    return ops.get(operator, False)


async def evaluate_rule(rule: AutoRule, meta_service: MetaAdsService) -> list[dict]:
    """단일 룰 평가 → 트리거된 대상 목록 반환"""
    triggered = []

    # 대상 목록 가져오기
    targets = []
    if rule.target_id:
        targets = [{"id": rule.target_id, "name": rule.target_name or rule.target_id}]
    else:
        try:
            if rule.target_type == "campaign":
                items = await meta_service.get_campaigns()
                targets = [{"id": c["id"], "name": c.get("name", c["id"]),
                            "insights": c.get("insights", {}).get("data", [{}])[0] if c.get("insights") else {}}
                           for c in items if c.get("effective_status") == "ACTIVE"]
            elif rule.target_type == "adset":
                items = await meta_service.get_adsets()
                targets = [{"id": a["id"], "name": a.get("name", a["id"]),
                            "insights": a.get("insights", {}).get("data", [{}])[0] if a.get("insights") else {}}
                           for a in items if a.get("effective_status") == "ACTIVE"]
            elif rule.target_type == "ad":
                items = await meta_service.get_ads()
                targets = [{"id": a["id"], "name": a.get("name", a["id"]),
                            "insights": a.get("insights", {}).get("data", [{}])[0] if a.get("insights") else {}}
                           for a in items if a.get("effective_status") == "ACTIVE"]
        except Exception as e:
            logger.error(f"Failed to fetch targets for rule {rule.id}: {e}")
            return []

    for target in targets:
        try:
            if rule.duration_type == "any":
                insight = target.get("insights", {})
                if not insight:
                    continue
                val = _extract_metric(insight, rule.metric)
                if val is None:
                    continue
                if not _compare(val, rule.operator, rule.threshold):
                    continue
                # 보조 조건 체크
                if rule.secondary_metric:
                    sec_val = _extract_metric(insight, rule.secondary_metric)
                    if sec_val is None or not _compare(sec_val, rule.secondary_operator, rule.secondary_threshold):
                        continue
                triggered.append({"target": target, "metric_value": val})

            elif rule.duration_type in ("consecutive_days", "total_days"):
                daily = await meta_service.get_daily_insights_for_target(
                    rule.target_type, target["id"], days=30
                )
                if not daily:
                    continue
                matching_days = 0
                consecutive = 0
                max_consecutive = 0
                for day_insight in sorted(daily, key=lambda x: x.get("date_start", "")):
                    val = _extract_metric(day_insight, rule.metric)
                    if val is not None and _compare(val, rule.operator, rule.threshold):
                        matching_days += 1
                        consecutive += 1
                        max_consecutive = max(max_consecutive, consecutive)
                    else:
                        consecutive = 0

                should_trigger = False
                last_val = None
                if daily:
                    last_val = _extract_metric(daily[-1], rule.metric)

                if rule.duration_type == "consecutive_days" and max_consecutive >= (rule.duration_value or 1):
                    should_trigger = True
                elif rule.duration_type == "total_days" and matching_days >= (rule.duration_value or 1):
                    should_trigger = True

                if should_trigger and last_val is not None:
                    triggered.append({"target": target, "metric_value": last_val})

        except Exception as e:
            logger.error(f"Error evaluating target {target.get('id')} for rule {rule.id}: {e}")

    return triggered


async def execute_action(rule: AutoRule, target: dict, meta_service: MetaAdsService) -> Optional[str]:
    """룰 액션 실행"""
    target_id = target["id"]
    try:
        if rule.action == "pause":
            await meta_service.update_status(target_id, "PAUSED")
            return "paused"
        elif rule.action == "decrease_budget":
            pct = rule.action_value or 20
            # 현재 예산 조회 후 감소 (간단히 처리)
            items = []
            if rule.target_type == "campaign":
                items = await meta_service.get_campaigns()
            elif rule.target_type == "adset":
                items = await meta_service.get_adsets()
            for item in items:
                if item["id"] == target_id:
                    budget = int(item.get("daily_budget", 0) or 0)
                    if budget > 0:
                        new_budget = int(budget * (1 - pct / 100))
                        await meta_service.update_budget(target_id, daily_budget=new_budget)
                    break
            return "budget_decreased"
        elif rule.action == "increase_budget":
            pct = rule.action_value or 20
            items = []
            if rule.target_type == "campaign":
                items = await meta_service.get_campaigns()
            elif rule.target_type == "adset":
                items = await meta_service.get_adsets()
            for item in items:
                if item["id"] == target_id:
                    budget = int(item.get("daily_budget", 0) or 0)
                    if budget > 0:
                        new_budget = int(budget * (1 + pct / 100))
                        await meta_service.update_budget(target_id, daily_budget=new_budget)
                    break
            return "budget_increased"
    except Exception as e:
        logger.error(f"Action failed for rule {rule.id}, target {target_id}: {e}")
        return None


async def run_rules(db: Session, user_id: str, meta_service: MetaAdsService,
                    rule_ids: Optional[list[str]] = None) -> list[dict]:
    """활성 룰 실행 → 로그 목록 반환"""
    query = db.query(AutoRule).filter(AutoRule.user_id == user_id, AutoRule.enabled == True)
    if rule_ids:
        query = query.filter(AutoRule.id.in_(rule_ids))
    rules = query.all()

    logs = []
    for rule in rules:
        triggered = await evaluate_rule(rule, meta_service)
        for item in triggered:
            target = item["target"]
            metric_value = item["metric_value"]

            action_taken = await execute_action(rule, target, meta_service)
            if action_taken:
                log = AutoRuleLog(
                    id=str(uuid.uuid4()),
                    rule_id=rule.id,
                    user_id=user_id,
                    action_taken=action_taken,
                    target_type=rule.target_type,
                    target_id=target["id"],
                    target_name=target.get("name"),
                    metric_name=rule.metric,
                    metric_value=metric_value,
                    threshold_value=rule.threshold,
                    details={"rule_name": rule.name, "action_value": rule.action_value},
                    triggered_at=datetime.now(timezone.utc),
                )
                db.add(log)
                rule.times_triggered = (rule.times_triggered or 0) + 1
                logs.append({
                    "rule_id": rule.id,
                    "rule_name": rule.name,
                    "action": action_taken,
                    "target_id": target["id"],
                    "target_name": target.get("name"),
                    "metric": rule.metric,
                    "metric_value": metric_value,
                    "threshold": rule.threshold,
                })

        rule.last_checked_at = datetime.now(timezone.utc)

    db.commit()
    return logs
