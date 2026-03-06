'use client';

import { useState, useEffect, useCallback } from 'react';
import { analyticsApi } from '@/lib/api';

// ═══ 타입 ═══
interface Campaign {
  id: string;
  name: string;
  status: string;
  effective_status: string;
  daily_budget?: string;
  insights?: { data?: Record<string, unknown>[] };
}
interface Rule {
  id: string; name: string; metric: string; operator: string; threshold: number;
  duration_type: string; duration_value?: number;
  secondary_metric?: string; secondary_operator?: string; secondary_threshold?: number;
  action: string; action_value?: number;
  target_type: string; target_id?: string; target_name?: string;
  enabled: boolean; times_triggered: number;
  last_checked_at?: string; created_at?: string;
}
interface RuleLog {
  id: string; rule_id: string; action_taken: string; target_type: string;
  target_id: string; target_name?: string; metric_name: string;
  metric_value: number; threshold_value: number; details?: Record<string, unknown>;
  triggered_at?: string;
}
interface Schedule {
  id: string; name: string; schedule_type: string;
  day_of_week?: number; day_of_month?: number;
  meta_campaign_id?: string; lookback_days: number; email_to?: string;
  enabled: boolean; last_run_at?: string; next_run_at?: string;
}
interface AIRecommendation {
  name: string; metric: string; operator: string; threshold: number;
  duration_type: string; duration_value?: number;
  action: string; action_value?: number; target_type: string; reason: string;
}

// ═══ 포맷 헬퍼 ═══
const fmtKRW = (v: unknown) => {
  const n = Number(v);
  if (isNaN(n)) return '-';
  return `₩${Math.round(n).toLocaleString('ko-KR')}`;
};
const fmtNum = (v: unknown, decimals = 0) => {
  const n = Number(v);
  if (isNaN(n)) return '-';
  return decimals > 0 ? n.toFixed(decimals) : Math.round(n).toLocaleString('ko-KR');
};
const fmtPct = (v: unknown) => {
  const n = Number(v);
  if (isNaN(n)) return '-';
  return `${n.toFixed(2)}%`;
};

const METRIC_LABELS: Record<string, string> = {
  cpc: 'CPC (클릭당 비용)', ctr: 'CTR (클릭률)', roas: 'ROAS',
  cvr: 'CVR (전환율)', cpm: 'CPM', spend: '지출', frequency: '빈도',
};
const OP_LABELS: Record<string, string> = {
  gt: '초과', lt: '미만', gte: '이상', lte: '이하',
};
const ACTION_LABELS: Record<string, string> = {
  pause: '광고 중단', decrease_budget: '예산 감소', increase_budget: '예산 증가',
};
const DAYS = ['월', '화', '수', '목', '금', '토', '일'];

// ═══ 메인 컴포넌트 ═══
export default function PerformanceDashboard() {
  // state
  const [overview, setOverview] = useState<Record<string, unknown>>({});
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [hidePaused, setHidePaused] = useState(false);
  const [datePreset, setDatePreset] = useState('last_7d');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // 룰
  const [rules, setRules] = useState<Rule[]>([]);
  const [ruleLogs, setRuleLogs] = useState<RuleLog[]>([]);
  const [showRuleForm, setShowRuleForm] = useState(false);
  const [ruleForm, setRuleForm] = useState<Record<string, unknown>>({
    metric: 'cpc', operator: 'gt', threshold: 0, duration_type: 'any',
    action: 'pause', target_type: 'campaign', name: '',
  });
  const [recommendations, setRecommendations] = useState<AIRecommendation[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [executing, setExecuting] = useState(false);

  // 스케줄
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [showSchedForm, setShowSchedForm] = useState(false);
  const [schedForm, setSchedForm] = useState<Record<string, unknown>>({
    name: '', schedule_type: 'weekly', day_of_week: 0, lookback_days: 7,
  });

  // ─── 데이터 로드 ───
  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [data, rulesData, logsData, schedsData] = await Promise.all([
        analyticsApi.getAccountOverview(datePreset),
        analyticsApi.getRules().catch(() => []),
        analyticsApi.getRuleLogs().catch(() => []),
        analyticsApi.getSchedules().catch(() => []),
      ]);
      setOverview(data.overview);
      setCampaigns(data.campaigns as Campaign[]);
      setRules(rulesData as Rule[]);
      setRuleLogs(logsData as RuleLog[]);
      setSchedules(schedsData as Schedule[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : '데이터 로드 실패');
    } finally {
      setLoading(false);
    }
  }, [datePreset]);

  useEffect(() => { loadData(); }, [loadData]);

  // ─── 캠페인 필터 ───
  const pausedCount = campaigns.filter(c => c.effective_status === 'PAUSED').length;
  const filteredCampaigns = hidePaused
    ? campaigns.filter(c => c.effective_status !== 'PAUSED')
    : campaigns;

  // ─── 인사이트 추출 헬퍼 ───
  const getInsight = (c: Campaign, key: string) => {
    const d = c.insights?.data?.[0];
    return d ? d[key] : null;
  };

  // ─── 전환 액션 요약 ───
  const actions = (overview.actions as Array<{ action_type: string; value: string }>) || [];
  const ACTION_TYPE_KR: Record<string, string> = {
    'link_click': '링크 클릭', 'post_engagement': '게시물 참여', 'page_engagement': '페이지 참여',
    'video_view': '동영상 조회', 'purchase': '구매', 'add_to_cart': '장바구니 추가',
    'lead': '리드', 'complete_registration': '가입 완료', 'landing_page_view': '랜딩페이지 조회',
    'offsite_conversion.fb_pixel_purchase': '구매(픽셀)',
    'offsite_conversion.fb_pixel_add_to_cart': '장바구니(픽셀)',
  };

  // ═══ 룰 CRUD ═══
  const handleCreateRule = async () => {
    try {
      await analyticsApi.createRule(ruleForm);
      setShowRuleForm(false);
      setRuleForm({ metric: 'cpc', operator: 'gt', threshold: 0, duration_type: 'any', action: 'pause', target_type: 'campaign', name: '' });
      const r = await analyticsApi.getRules();
      setRules(r as Rule[]);
    } catch (e) { setError(e instanceof Error ? e.message : '룰 생성 실패'); }
  };

  const toggleRule = async (rule: Rule) => {
    await analyticsApi.updateRule(rule.id, { enabled: !rule.enabled });
    setRules(prev => prev.map(r => r.id === rule.id ? { ...r, enabled: !r.enabled } : r));
  };

  const deleteRule = async (id: string) => {
    await analyticsApi.deleteRule(id);
    setRules(prev => prev.filter(r => r.id !== id));
  };

  const executeNow = async () => {
    setExecuting(true);
    try {
      const result = await analyticsApi.executeRules();
      const logs = await analyticsApi.getRuleLogs();
      setRuleLogs(logs as RuleLog[]);
      alert(`${result.executed}건의 액션이 실행되었습니다.`);
    } catch (e) { setError(e instanceof Error ? e.message : '실행 실패'); }
    finally { setExecuting(false); }
  };

  const getAIRecommendations = async () => {
    setAiLoading(true);
    try {
      const result = await analyticsApi.aiRecommendRules(overview, campaigns);
      setRecommendations(result.recommendations as AIRecommendation[]);
    } catch (e) { setError(e instanceof Error ? e.message : 'AI 추천 실패'); }
    finally { setAiLoading(false); }
  };

  const applyRecommendation = async (rec: AIRecommendation) => {
    await analyticsApi.createRule({
      name: rec.name, metric: rec.metric, operator: rec.operator,
      threshold: rec.threshold, duration_type: rec.duration_type,
      duration_value: rec.duration_value, action: rec.action,
      action_value: rec.action_value, target_type: rec.target_type,
    });
    const r = await analyticsApi.getRules();
    setRules(r as Rule[]);
    setRecommendations(prev => prev.filter(x => x.name !== rec.name));
  };

  // ═══ 스케줄 CRUD ═══
  const handleCreateSchedule = async () => {
    try {
      await analyticsApi.createSchedule(schedForm);
      setShowSchedForm(false);
      setSchedForm({ name: '', schedule_type: 'weekly', day_of_week: 0, lookback_days: 7 });
      const s = await analyticsApi.getSchedules();
      setSchedules(s as Schedule[]);
    } catch (e) { setError(e instanceof Error ? e.message : '스케줄 생성 실패'); }
  };

  const toggleSchedule = async (sched: Schedule) => {
    await analyticsApi.updateSchedule(sched.id, { enabled: !sched.enabled });
    setSchedules(prev => prev.map(s => s.id === sched.id ? { ...s, enabled: !s.enabled } : s));
  };

  const deleteSchedule = async (id: string) => {
    await analyticsApi.deleteSchedule(id);
    setSchedules(prev => prev.filter(s => s.id !== id));
  };

  // ═══ 렌더 ═══
  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-8">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800">성과 대시보드</h1>
        <div className="flex items-center gap-3">
          <select
            value={datePreset}
            onChange={e => setDatePreset(e.target.value)}
            className="px-3 py-2 border border-slate-300 rounded-lg text-sm"
          >
            <option value="today">오늘</option>
            <option value="yesterday">어제</option>
            <option value="last_3d">최근 3일</option>
            <option value="last_7d">최근 7일</option>
            <option value="last_14d">최근 14일</option>
            <option value="last_30d">최근 30일</option>
            <option value="this_month">이번 달</option>
            <option value="last_month">지난 달</option>
          </select>
          <button onClick={loadData} disabled={loading}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">
            {loading ? '로딩...' : '새로고침'}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">{error}</div>
      )}

      {/* 1. KPI 카드 */}
      <section className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        {[
          { label: '지출', value: fmtKRW(overview.spend), color: 'blue' },
          { label: '노출', value: fmtNum(overview.impressions), color: 'indigo' },
          { label: '클릭', value: fmtNum(overview.clicks), color: 'purple' },
          { label: 'CPC', value: fmtKRW(overview.cpc), color: 'emerald' },
          { label: 'CTR', value: fmtPct(overview.ctr), color: 'amber' },
          { label: 'CPM', value: fmtKRW(overview.cpm), color: 'rose' },
        ].map(({ label, value, color }) => (
          <div key={label} className={`bg-white rounded-xl shadow-sm border border-slate-200 p-4`}>
            <p className="text-xs text-slate-500 mb-1">{label}</p>
            <p className={`text-lg font-bold text-${color}-600`}>{value}</p>
          </div>
        ))}
      </section>

      {/* 2. 전환 액션 요약 */}
      {actions.length > 0 && (
        <section className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <h2 className="text-lg font-semibold mb-4">전환 액션 요약</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {actions.map((a, i) => (
              <div key={i} className="bg-slate-50 rounded-lg p-3">
                <p className="text-xs text-slate-500">{ACTION_TYPE_KR[a.action_type] || a.action_type}</p>
                <p className="text-lg font-bold text-slate-800">{fmtNum(a.value)}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 4. 캠페인 목록 */}
      <section className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">캠페인 목록</h2>
          <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
            <input type="checkbox" checked={hidePaused} onChange={() => setHidePaused(!hidePaused)}
              className="rounded border-slate-300" />
            중지 캠페인 숨기기
            {hidePaused && pausedCount > 0 && (
              <span className="text-xs text-slate-400">(중지 {pausedCount}개 숨김)</span>
            )}
          </label>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-500">
                <th className="pb-2 pr-4">캠페인</th>
                <th className="pb-2 pr-4">상태</th>
                <th className="pb-2 pr-4 text-right">지출</th>
                <th className="pb-2 pr-4 text-right">노출</th>
                <th className="pb-2 pr-4 text-right">클릭</th>
                <th className="pb-2 pr-4 text-right">CPC</th>
                <th className="pb-2 pr-4 text-right">CTR</th>
              </tr>
            </thead>
            <tbody>
              {filteredCampaigns.map(c => (
                <tr key={c.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="py-2 pr-4 font-medium text-slate-800 max-w-[200px] truncate">{c.name}</td>
                  <td className="py-2 pr-4">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      c.effective_status === 'ACTIVE' ? 'bg-green-100 text-green-700' :
                      c.effective_status === 'PAUSED' ? 'bg-yellow-100 text-yellow-700' :
                      'bg-slate-100 text-slate-600'
                    }`}>{c.effective_status}</span>
                  </td>
                  <td className="py-2 pr-4 text-right">{fmtKRW(getInsight(c, 'spend'))}</td>
                  <td className="py-2 pr-4 text-right">{fmtNum(getInsight(c, 'impressions'))}</td>
                  <td className="py-2 pr-4 text-right">{fmtNum(getInsight(c, 'clicks'))}</td>
                  <td className="py-2 pr-4 text-right">{fmtKRW(getInsight(c, 'cpc'))}</td>
                  <td className="py-2 pr-4 text-right">{fmtPct(getInsight(c, 'ctr'))}</td>
                </tr>
              ))}
              {filteredCampaigns.length === 0 && (
                <tr><td colSpan={7} className="py-8 text-center text-slate-400">캠페인 데이터가 없습니다</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* 5. 자동 관리 */}
      <section className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">자동 관리</h2>
          <div className="flex items-center gap-2">
            <button onClick={getAIRecommendations} disabled={aiLoading}
              className="px-3 py-1.5 bg-purple-600 text-white rounded-lg text-sm hover:bg-purple-700 disabled:opacity-50">
              {aiLoading ? 'AI 분석중...' : 'AI 추천'}
            </button>
            <button onClick={executeNow} disabled={executing}
              className="px-3 py-1.5 bg-orange-600 text-white rounded-lg text-sm hover:bg-orange-700 disabled:opacity-50">
              {executing ? '실행중...' : '지금 실행'}
            </button>
            <button onClick={() => setShowRuleForm(!showRuleForm)}
              className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">
              {showRuleForm ? '접기' : '+ 룰 추가'}
            </button>
          </div>
        </div>

        {/* AI 추천 카드 */}
        {recommendations.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-purple-700">AI 추천 룰</h3>
            {recommendations.map((rec, i) => (
              <div key={i} className="flex items-center justify-between bg-purple-50 border border-purple-200 rounded-lg p-4">
                <div>
                  <p className="font-medium text-slate-800">{rec.name}</p>
                  <p className="text-sm text-slate-600">
                    {METRIC_LABELS[rec.metric] || rec.metric} {rec.threshold}{' '}
                    {OP_LABELS[rec.operator]} → {ACTION_LABELS[rec.action] || rec.action}
                  </p>
                  <p className="text-xs text-purple-600 mt-1">{rec.reason}</p>
                </div>
                <button onClick={() => applyRecommendation(rec)}
                  className="px-3 py-1.5 bg-purple-600 text-white rounded-lg text-sm hover:bg-purple-700 whitespace-nowrap">
                  적용
                </button>
              </div>
            ))}
          </div>
        )}

        {/* 룰 추가 폼 */}
        {showRuleForm && (
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-4">
            <h3 className="text-sm font-semibold">새 룰 추가</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <input placeholder="룰 이름" value={String(ruleForm.name || '')}
                onChange={e => setRuleForm({ ...ruleForm, name: e.target.value })}
                className="px-3 py-2 border border-slate-300 rounded-lg text-sm" />
              <select value={String(ruleForm.metric)}
                onChange={e => setRuleForm({ ...ruleForm, metric: e.target.value })}
                className="px-3 py-2 border border-slate-300 rounded-lg text-sm">
                {Object.entries(METRIC_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <div className="flex gap-2">
                <select value={String(ruleForm.operator)}
                  onChange={e => setRuleForm({ ...ruleForm, operator: e.target.value })}
                  className="px-3 py-2 border border-slate-300 rounded-lg text-sm flex-1">
                  {Object.entries(OP_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <input type="number" placeholder="기준값" value={String(ruleForm.threshold || '')}
                  onChange={e => setRuleForm({ ...ruleForm, threshold: Number(e.target.value) })}
                  className="px-3 py-2 border border-slate-300 rounded-lg text-sm w-28" />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <select value={String(ruleForm.duration_type)}
                onChange={e => setRuleForm({ ...ruleForm, duration_type: e.target.value })}
                className="px-3 py-2 border border-slate-300 rounded-lg text-sm">
                <option value="any">즉시 (현재값)</option>
                <option value="consecutive_days">연속 N일</option>
                <option value="total_days">최근 30일 중 N일</option>
              </select>
              {ruleForm.duration_type !== 'any' && (
                <input type="number" placeholder="일수" value={String(ruleForm.duration_value || '')}
                  onChange={e => setRuleForm({ ...ruleForm, duration_value: Number(e.target.value) })}
                  className="px-3 py-2 border border-slate-300 rounded-lg text-sm" />
              )}
              <select value={String(ruleForm.action)}
                onChange={e => setRuleForm({ ...ruleForm, action: e.target.value })}
                className="px-3 py-2 border border-slate-300 rounded-lg text-sm">
                {Object.entries(ACTION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {ruleForm.action !== 'pause' && (
                <input type="number" placeholder="변경 비율(%)" value={String(ruleForm.action_value || '')}
                  onChange={e => setRuleForm({ ...ruleForm, action_value: Number(e.target.value) })}
                  className="px-3 py-2 border border-slate-300 rounded-lg text-sm" />
              )}
              <select value={String(ruleForm.target_type)}
                onChange={e => setRuleForm({ ...ruleForm, target_type: e.target.value })}
                className="px-3 py-2 border border-slate-300 rounded-lg text-sm">
                <option value="campaign">캠페인</option>
                <option value="adset">광고 세트</option>
                <option value="ad">광고</option>
              </select>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowRuleForm(false)}
                className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg text-sm">취소</button>
              <button onClick={handleCreateRule}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">생성</button>
            </div>
          </div>
        )}

        {/* 활성 룰 목록 */}
        {rules.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-slate-600">활성 룰 ({rules.length})</h3>
            {rules.map(rule => (
              <div key={rule.id} className="flex items-center justify-between bg-slate-50 rounded-lg p-3">
                <div className="flex items-center gap-3">
                  <button onClick={() => toggleRule(rule)}
                    className={`w-10 h-5 rounded-full transition-colors relative ${rule.enabled ? 'bg-green-500' : 'bg-slate-300'}`}>
                    <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                      rule.enabled ? 'left-5' : 'left-0.5'}`} />
                  </button>
                  <div>
                    <p className="font-medium text-sm text-slate-800">{rule.name}</p>
                    <p className="text-xs text-slate-500">
                      {METRIC_LABELS[rule.metric] || rule.metric} {rule.threshold}{' '}
                      {OP_LABELS[rule.operator]} → {ACTION_LABELS[rule.action] || rule.action}
                      {rule.times_triggered > 0 && (
                        <span className="ml-2 text-orange-600">({rule.times_triggered}회 실행됨)</span>
                      )}
                    </p>
                  </div>
                </div>
                <button onClick={() => deleteRule(rule.id)}
                  className="text-red-400 hover:text-red-600 text-sm px-2">삭제</button>
              </div>
            ))}
          </div>
        )}

        {/* 실행 기록 타임라인 */}
        {ruleLogs.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-slate-600">실행 기록</h3>
            <div className="max-h-64 overflow-y-auto space-y-2">
              {ruleLogs.map(log => (
                <div key={log.id} className="flex items-start gap-3 bg-slate-50 rounded-lg p-3">
                  <div className={`w-2 h-2 rounded-full mt-1.5 ${
                    log.action_taken === 'paused' ? 'bg-red-500' :
                    log.action_taken === 'budget_decreased' ? 'bg-orange-500' : 'bg-green-500'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-800">
                      <span className="font-medium">{log.target_name || log.target_id}</span>
                      {' — '}
                      {log.action_taken === 'paused' ? '중단됨' :
                       log.action_taken === 'budget_decreased' ? '예산 감소' : '예산 증가'}
                    </p>
                    <p className="text-xs text-slate-500">
                      {log.metric_name}: {log.metric_name === 'spend' || log.metric_name === 'cpc' || log.metric_name === 'cpm'
                        ? fmtKRW(log.metric_value)
                        : fmtNum(log.metric_value, 2)}
                      {' (기준: '}
                      {log.metric_name === 'spend' || log.metric_name === 'cpc' || log.metric_name === 'cpm'
                        ? fmtKRW(log.threshold_value)
                        : fmtNum(log.threshold_value, 2)}
                      {')'}
                    </p>
                    <p className="text-xs text-slate-400">
                      {log.triggered_at ? new Date(log.triggered_at).toLocaleString('ko-KR') : ''}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* 7. 스케줄 리포트 */}
      <section className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">스케줄 리포트</h2>
          <button onClick={() => setShowSchedForm(!showSchedForm)}
            className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">
            {showSchedForm ? '접기' : '+ 스케줄 추가'}
          </button>
        </div>

        {showSchedForm && (
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <input placeholder="스케줄 이름" value={String(schedForm.name || '')}
                onChange={e => setSchedForm({ ...schedForm, name: e.target.value })}
                className="px-3 py-2 border border-slate-300 rounded-lg text-sm" />
              <select value={String(schedForm.schedule_type)}
                onChange={e => setSchedForm({ ...schedForm, schedule_type: e.target.value })}
                className="px-3 py-2 border border-slate-300 rounded-lg text-sm">
                <option value="weekly">주간</option>
                <option value="monthly">월간</option>
              </select>
              {schedForm.schedule_type === 'weekly' ? (
                <select value={String(schedForm.day_of_week ?? 0)}
                  onChange={e => setSchedForm({ ...schedForm, day_of_week: Number(e.target.value) })}
                  className="px-3 py-2 border border-slate-300 rounded-lg text-sm">
                  {DAYS.map((d, i) => <option key={i} value={i}>{d}요일</option>)}
                </select>
              ) : (
                <input type="number" min={1} max={28} placeholder="일 (1-28)"
                  value={String(schedForm.day_of_month || '')}
                  onChange={e => setSchedForm({ ...schedForm, day_of_month: Number(e.target.value) })}
                  className="px-3 py-2 border border-slate-300 rounded-lg text-sm" />
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <input type="number" placeholder="조회 기간 (일)" value={String(schedForm.lookback_days || 7)}
                onChange={e => setSchedForm({ ...schedForm, lookback_days: Number(e.target.value) })}
                className="px-3 py-2 border border-slate-300 rounded-lg text-sm" />
              <input placeholder="수신 이메일 (선택)" value={String(schedForm.email_to || '')}
                onChange={e => setSchedForm({ ...schedForm, email_to: e.target.value })}
                className="px-3 py-2 border border-slate-300 rounded-lg text-sm" />
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowSchedForm(false)}
                className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg text-sm">취소</button>
              <button onClick={handleCreateSchedule}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">생성</button>
            </div>
          </div>
        )}

        {schedules.length > 0 ? (
          <div className="space-y-2">
            {schedules.map(sched => (
              <div key={sched.id} className="flex items-center justify-between bg-slate-50 rounded-lg p-3">
                <div className="flex items-center gap-3">
                  <button onClick={() => toggleSchedule(sched)}
                    className={`w-10 h-5 rounded-full transition-colors relative ${sched.enabled ? 'bg-green-500' : 'bg-slate-300'}`}>
                    <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                      sched.enabled ? 'left-5' : 'left-0.5'}`} />
                  </button>
                  <div>
                    <p className="font-medium text-sm text-slate-800">{sched.name}</p>
                    <p className="text-xs text-slate-500">
                      {sched.schedule_type === 'weekly'
                        ? `매주 ${DAYS[sched.day_of_week ?? 0]}요일`
                        : `매월 ${sched.day_of_month}일`}
                      {' · 조회 {0}일'.replace('{0}', String(sched.lookback_days))}
                      {sched.next_run_at && ` · 다음 실행: ${new Date(sched.next_run_at).toLocaleDateString('ko-KR')}`}
                    </p>
                  </div>
                </div>
                <button onClick={() => deleteSchedule(sched.id)}
                  className="text-red-400 hover:text-red-600 text-sm px-2">삭제</button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-400 text-center py-4">등록된 스케줄이 없습니다</p>
        )}
      </section>
    </div>
  );
}
