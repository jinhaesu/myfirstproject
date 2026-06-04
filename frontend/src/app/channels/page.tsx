'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Navigation } from '@/components/layout/Navigation';
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line, ComposedChart,
  PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

// Linear 다크 팔레트 (contribution-margin 페이지와 통일)
const PANEL = 'bg-[#0F1011] rounded-xl shadow-[0px_1px_3px_rgba(0,0,0,0.2)] border border-[#23252A]';
const SUBPANEL = 'bg-[#08090A] rounded-lg border border-[#23252A]';
const TEXT_PRIMARY = '#F7F8F8';
const TEXT_DIM = '#A3A9B3';     // 8A8F98보다 밝게 — 가시성 개선
const TEXT_MUTED = '#7A7F8A';   // 62666D보다 밝게
const ROW_HOVER = 'hover:bg-[#1A1C22]'; // 0A0B0D는 너무 어두워 hover 효과 약함 → 더 밝게

// recharts Tooltip 공통 스타일 (다크 배경 + 큰 글씨)
const TOOLTIP_STYLE: React.CSSProperties = {
  background: '#13141A',
  border: '1px solid #2E3138',
  borderRadius: 8,
  color: '#F7F8F8',
  fontSize: 12,
  padding: '8px 12px',
  boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
};
const TOOLTIP_LABEL_STYLE: React.CSSProperties = { color: '#A3A9B3', fontWeight: 500, marginBottom: 4 };
const TOOLTIP_ITEM_STYLE: React.CSSProperties = { color: '#F7F8F8' };

// 차트 공통 props
const CHART_GRID = { stroke: '#23252A', strokeDasharray: '3 3' };
const AXIS_TICK = { fill: '#A3A9B3', fontSize: 11 };
const LEGEND_STYLE = { fontSize: 11, color: '#D0D6E0' };

const PALETTE = [
  '#828FFF', '#27A644', '#F0BF00', '#EB5757', '#06B6D4',
  '#A855F7', '#FC7840', '#5E6AD2', '#68CC58', '#00B8CC',
  '#FF6B9D', '#7070FF', '#22C55E', '#FBBF24', '#F472B6',
  '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#3B82F6',
];

type Granularity = 'day' | 'month' | 'quarter' | 'year';

interface Channel {
  id: string;
  name: string;
  category: string;
  integration_type: string;
  is_active: boolean;
  has_parser: boolean;
}

interface Product {
  id: number;
  code: string;
  name: string;
  category: string;
  default_unit_size: number;
  is_active: boolean;
  sort_order: number;
}

interface Batch {
  id: string;
  channel_id: string;
  channel_name: string;
  file_name: string;
  file_hash?: string | null;
  status: string;
  period_start: string | null;
  period_end: string | null;
  row_total: number;
  row_inserted: number;
  row_duplicate: number;
  row_unmatched: number;
  row_excluded?: number;
  row_cancelled?: number;
  error_message?: string | null;
  created_at: string | null;
}

interface UnmatchedItem {
  id: number;
  channel_id: string;
  channel_name: string;
  raw_product_name: string;
  raw_option_name: string | null;
  occurrence_count: number;
  total_qty: number;
  llm_suggested_product_id: number | null;
  llm_suggested_unit_per_set: number | null;
  llm_confidence: number | null;
  llm_reason: string | null;
}

interface DashboardData {
  summary: {
    revenue: number; pcs: number; orders: number;
    variable_cost: number; commission: number;
    contribution_margin: number; cm_rate: number;
    cancelled_count?: number; cancelled_amount?: number;
  };
  series: Array<{
    period: string; revenue: number; pcs: number; orders: number;
    cost: number; commission: number; contribution_margin: number;
  }>;
  channels: Array<{
    channel_id: string; channel_name: string; channel_category: string | null;
    revenue: number; pcs: number; orders: number; contribution_margin: number; cm_rate: number;
  }>;
  products: Array<{
    product_id: number; product_name: string;
    revenue: number; pcs: number; orders: number; contribution_margin: number; cm_rate: number;
  }>;
  granularity: Granularity;
  period_start: string;
  period_end: string;
}

interface VariableCost {
  id: number;
  product_id: number;
  channel_id: string | null;
  cost_per_pcs: number;
  valid_from: string | null;
  valid_to: string | null;
}

const fmtKR = (n: number): string => {
  if (Math.abs(n) >= 1e8) return `${(n / 1e8).toFixed(2)}억`;
  if (Math.abs(n) >= 1e4) return `${(n / 1e4).toFixed(1)}만`;
  return n.toLocaleString();
};

const fmtNum = (n: number): string => n.toLocaleString();
const fmtPct = (n: number): string => `${n.toFixed(1)}%`;

const today = new Date();
const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
const isoDate = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

type Tab = 'dashboard' | 'pnl' | 'upload' | 'mapping' | 'cost' | 'plan' | 'products' | 'admin';

export default function ChannelsPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-[#08090A] flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-[#828FFF] border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <Content />
    </Suspense>
  );
}

function Content() {
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();

  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  const [channels, setChannels] = useState<Channel[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [unmatched, setUnmatched] = useState<UnmatchedItem[]>([]);
  const [variableCosts, setVariableCosts] = useState<VariableCost[]>([]);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [compareDashboard, setCompareDashboard] = useState<DashboardData | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);

  // Filters
  const [periodStart, setPeriodStart] = useState(isoDate(firstOfMonth));
  const [periodEnd, setPeriodEnd] = useState(isoDate(today));
  const [granularity, setGranularity] = useState<Granularity>('day');
  const [selChannels, setSelChannels] = useState<string[]>([]);
  const [selProducts, setSelProducts] = useState<number[]>([]);
  const [selEmployees, setSelEmployees] = useState<number[]>([]);

  // 기간 비교
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareStart, setCompareStart] = useState('');
  const [compareEnd, setCompareEnd] = useState('');
  const [compareManual, setCompareManual] = useState(false);  // 사용자가 직접 수정했는지

  // 토글 켜졌을 때 기준 기간 직전 동일 길이를 자동 계산 (수동 수정 안 한 경우만)
  useEffect(() => {
    if (!compareOpen || compareManual) return;
    if (!periodStart || !periodEnd) return;
    const s = new Date(periodStart), e = new Date(periodEnd);
    if (isNaN(s.getTime()) || isNaN(e.getTime())) return;
    const dur = e.getTime() - s.getTime();
    const ce = new Date(s.getTime() - 24 * 3600 * 1000);
    const cs = new Date(ce.getTime() - dur);
    setCompareStart(cs.toISOString().slice(0, 10));
    setCompareEnd(ce.toISOString().slice(0, 10));
  }, [compareOpen, compareManual, periodStart, periodEnd]);

  const [loading, setLoading] = useState(false);
  const [seedDone, setSeedDone] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) router.push('/login');
  }, [user, authLoading, router]);

  const authHeaders = useCallback((): HeadersInit => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, []);

  // 개별 master endpoint 병렬 호출 (bootstrap 없는 구버전 백엔드 폴백)
  const fetchAllIndividual = useCallback(async () => {
    const [cRes, pRes, bRes, uRes, vRes, eRes] = await Promise.all([
      fetch(`${API_BASE}/api/csa/channels`, { headers: authHeaders() }),
      fetch(`${API_BASE}/api/csa/products`, { headers: authHeaders() }),
      fetch(`${API_BASE}/api/csa/batches?limit=50`, { headers: authHeaders() }),
      fetch(`${API_BASE}/api/csa/unmatched`, { headers: authHeaders() }),
      fetch(`${API_BASE}/api/csa/variable-costs`, { headers: authHeaders() }),
      fetch(`${API_BASE}/api/csa/employees`, { headers: authHeaders() }),
    ]);
    if (cRes.ok) setChannels(await cRes.json());
    if (pRes.ok) setProducts(await pRes.json());
    if (bRes.ok) setBatches(await bRes.json());
    if (uRes.ok) setUnmatched(await uRes.json());
    if (vRes.ok) setVariableCosts(await vRes.json());
    if (eRes.ok) setEmployees(await eRes.json());
  }, [authHeaders]);

  const fetchAll = useCallback(async () => {
    try {
      // bootstrap 통합 endpoint 우선 (신버전 백엔드 — 1 라운드트립, 캐시)
      const r = await fetch(`${API_BASE}/api/csa/bootstrap`, { headers: authHeaders() });
      if (r.ok) {
        const d = await r.json();
        // bootstrap 응답이 정상 구조인지 검증
        if (d && Array.isArray(d.channels)) {
          setChannels(d.channels || []);
          setProducts(d.products || []);
          setBatches(d.batches || []);
          setUnmatched(d.unmatched || []);
          setVariableCosts(d.variable_costs || []);
          setEmployees(d.employees || []);
          return;
        }
      }
      // bootstrap 미지원(404)·이상 응답 → 개별 endpoint 폴백
      await fetchAllIndividual();
    } catch (e) {
      console.error('fetchAll bootstrap failed, falling back', e);
      try { await fetchAllIndividual(); } catch (e2) { console.error(e2); }
    }
  }, [authHeaders, fetchAllIndividual]);

  const fetchDashboard = useCallback(async () => {
    setLoading(true);
    try {
      const buildQs = (ps: string, pe: string) => {
        const qs = new URLSearchParams({ period_start: ps, period_end: pe, granularity });
        if (selChannels.length) qs.set('channel_ids', selChannels.join(','));
        if (selProducts.length) qs.set('product_ids', selProducts.join(','));
        if (selEmployees.length) qs.set('employee_ids', selEmployees.join(','));
        return qs.toString();
      };
      const calls: Promise<Response>[] = [
        fetch(`${API_BASE}/api/csa/dashboard?${buildQs(periodStart, periodEnd)}`, { headers: authHeaders() }),
      ];
      const wantCompare = compareOpen && compareStart && compareEnd;
      if (wantCompare) {
        calls.push(fetch(`${API_BASE}/api/csa/dashboard?${buildQs(compareStart, compareEnd)}`, { headers: authHeaders() }));
      }
      const results = await Promise.all(calls);
      if (results[0].ok) setDashboard(await results[0].json());
      if (wantCompare && results[1]?.ok) setCompareDashboard(await results[1].json());
      else if (!wantCompare) setCompareDashboard(null);
    } finally {
      setLoading(false);
    }
  }, [authHeaders, periodStart, periodEnd, granularity, selChannels, selProducts, selEmployees, compareOpen, compareStart, compareEnd]);

  const seedIfEmpty = useCallback(async () => {
    if (seedDone) return;
    try {
      const r = await fetch(`${API_BASE}/api/csa/seed`, { method: 'POST', headers: authHeaders() });
      if (r.ok) setSeedDone(true);
    } catch {}
  }, [authHeaders, seedDone]);

  useEffect(() => {
    if (!user) return;
    seedIfEmpty().then(fetchAll);
  }, [user, seedIfEmpty, fetchAll]);

  useEffect(() => {
    if (user) fetchDashboard();
  }, [user, fetchDashboard]);

  if (authLoading || !user) {
    return (
      <div className="min-h-screen bg-[#08090A] flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-[#828FFF] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#08090A] text-[#F7F8F8]">
      <Navigation />
      <div className="md:ml-64 p-6 md:p-8 max-w-[1600px]">
        <Header
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          channels={channels}
          unmatchedCount={unmatched.length}
        />

        {activeTab === 'dashboard' && (
          <DashboardTab
            data={dashboard}
            compareData={compareDashboard}
            loading={loading}
            channels={channels}
            products={products}
            employees={employees}
            periodStart={periodStart}
            periodEnd={periodEnd}
            setPeriodStart={setPeriodStart}
            setPeriodEnd={setPeriodEnd}
            granularity={granularity}
            setGranularity={setGranularity}
            selChannels={selChannels}
            setSelChannels={setSelChannels}
            selProducts={selProducts}
            setSelProducts={setSelProducts}
            selEmployees={selEmployees}
            setSelEmployees={setSelEmployees}
            compareOpen={compareOpen}
            setCompareOpen={setCompareOpen}
            compareStart={compareStart}
            setCompareStart={setCompareStart}
            compareEnd={compareEnd}
            setCompareEnd={setCompareEnd}
            compareManual={compareManual}
            setCompareManual={setCompareManual}
          />
        )}

        {activeTab === 'upload' && (
          <UploadTab
            channels={channels}
            batches={batches}
            authHeaders={authHeaders}
            onUploaded={() => { fetchAll(); fetchDashboard(); }}
          />
        )}

        {activeTab === 'mapping' && (
          <MappingTab
            unmatched={unmatched}
            products={products}
            authHeaders={authHeaders}
            onResolved={() => { fetchAll(); fetchDashboard(); }}
          />
        )}

        {activeTab === 'cost' && (
          <CostTab
            products={products}
            variableCosts={variableCosts}
            channels={channels}
            authHeaders={authHeaders}
            onUpdated={() => { fetchAll(); fetchDashboard(); }}
          />
        )}

        {activeTab === 'plan' && (
          <PlanTab authHeaders={authHeaders} channels={channels} products={products} />
        )}

        {activeTab === 'admin' && (
          <AdminTab authHeaders={authHeaders} channels={channels} userEmail={user?.email || ''} />
        )}

        {activeTab === 'pnl' && (
          <PnlTab authHeaders={authHeaders} userEmail={user?.email || ''} />
        )}

        {activeTab === 'products' && (
          <ProductsTab
            authHeaders={authHeaders}
            channels={channels}
            products={products}
            onRefresh={fetchAll}
          />
        )}
      </div>
    </div>
  );
}

function Header({
  activeTab, setActiveTab, channels, unmatchedCount,
}: {
  activeTab: Tab; setActiveTab: (t: Tab) => void;
  channels: Channel[]; unmatchedCount: number;
}) {
  const parsersReady = channels.filter(c => c.has_parser).length;
  const tabs: Array<{ key: Tab; label: string; badge?: number }> = [
    { key: 'dashboard', label: '대시보드' },
    { key: 'pnl', label: '월별 매출/공헌이익 차트' },
    { key: 'upload', label: '엑셀 업로드' },
    { key: 'mapping', label: '매핑 대기', badge: unmatchedCount },
    { key: 'cost', label: '변동비 설정' },
    { key: 'plan', label: '사업계획 비교' },
    { key: 'products', label: '품목 관리' },
    { key: 'admin', label: '직원·채널 관리' },
  ];

  return (
    <div className="mb-6">
      <div className="flex items-baseline justify-between mb-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">채널별 매출 취합·분석</h1>
          <p className="text-sm text-[#8A8F98] mt-1">
            채널 엑셀 업로드 → 자동 정규화 → 실시간 공헌이익 분석.
            {' '}<span className="text-[#62666D]">파서 준비 채널 {parsersReady}/{channels.length}</span>
          </p>
        </div>
      </div>
      <div className="flex gap-1 border-b border-[#23252A]">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px flex items-center gap-1.5 ${
              activeTab === t.key
                ? 'text-[#F7F8F8] border-[#828FFF]'
                : 'text-[#8A8F98] border-transparent hover:text-[#D0D6E0]'
            }`}
          >
            {t.label}
            {t.badge !== undefined && t.badge > 0 && (
              <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded-full bg-[#F0BF00] text-[#08090A]">
                {t.badge}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Dashboard Tab
// ──────────────────────────────────────────────────────────────

const COST_LABELS: Record<string, string> = {
  cogs: '원가', labor: '노무비', overhead: '제조간접비',
  logistics_work: '물류작업비', logistics_oh: '물류간접비',
  advertising: '광고비', commission_rate: '수수료(정률)', commission_fixed: '수수료(정액)',
  shipping: '운반비', packaging: '포장비',
};

function DashboardTab({
  data, compareData, loading, channels, products, employees,
  periodStart, periodEnd, setPeriodStart, setPeriodEnd,
  granularity, setGranularity,
  selChannels, setSelChannels, selProducts, setSelProducts,
  selEmployees, setSelEmployees,
  compareOpen, setCompareOpen, compareStart, setCompareStart, compareEnd, setCompareEnd,
  compareManual, setCompareManual,
}: any) {
  const hasCompare = !!(compareData && compareOpen);
  // 기준 기간 길이(일)
  const periodDays = (() => {
    if (!periodStart || !periodEnd) return 0;
    const s = new Date(periodStart), e = new Date(periodEnd);
    if (isNaN(s.getTime()) || isNaN(e.getTime())) return 0;
    return Math.round((e.getTime() - s.getTime()) / (24 * 3600 * 1000)) + 1;
  })();
  const sparkSeries = (data?.series || []).map((s: any) => ({ x: s.bucket, revenue: s.revenue, pcs: s.pcs, cm: s.contribution_margin }));
  const sparkKey = (k: string) => sparkSeries.map((p: any) => ({ x: p.x, v: p[k] || 0 }));

  // 비교 시리즈/채널/품목 매핑
  const seriesWithCompare = (() => {
    if (!data?.series) return [];
    if (!hasCompare || !compareData?.series) return data.series;
    const cmp = compareData.series;
    return data.series.map((s: any, i: number) => ({
      ...s,
      compare_revenue: cmp[i]?.revenue ?? null,
      compare_cm: cmp[i]?.contribution_margin ?? null,
      compare_pcs: cmp[i]?.pcs ?? null,
      compare_period: cmp[i]?.period,
    }));
  })();
  const channelsCmpMap: Record<string, any> = hasCompare
    ? Object.fromEntries((compareData?.channels || []).map((c: any) => [c.channel_id, c]))
    : {};
  const productsCmpMap: Record<string | number, any> = hasCompare
    ? Object.fromEntries((compareData?.products || []).map((p: any) => [p.product_id, p]))
    : {};
  const channelsWithCmp = (data?.channels || []).map((c: any) => ({
    ...c,
    compare_revenue: channelsCmpMap[c.channel_id]?.revenue ?? null,
    compare_cm: channelsCmpMap[c.channel_id]?.contribution_margin ?? null,
  }));
  const productsWithCmp = (data?.products || []).map((p: any) => ({
    ...p,
    compare_revenue: productsCmpMap[p.product_id]?.revenue ?? null,
    compare_cm: productsCmpMap[p.product_id]?.contribution_margin ?? null,
  }));
  const fmtDelta = (cur: number | null | undefined, cmp: number | null | undefined) => {
    if (cur === null || cur === undefined || cmp === null || cmp === undefined) return null;
    if (cmp === 0) return cur > 0 ? { pct: 100, sign: 'up' as const } : null;
    const pct = ((cur - cmp) / Math.abs(cmp)) * 100;
    return { pct, sign: pct > 0.05 ? 'up' as const : pct < -0.05 ? 'down' as const : 'flat' as const };
  };
  const costBreakdown = data?.cost_breakdown
    ? Object.entries(data.cost_breakdown)
        .filter(([_, v]) => (v as number) > 0)
        .map(([k, v]) => ({ key: k, name: COST_LABELS[k] || k, value: v as number }))
        .sort((a, b) => b.value - a.value)
    : [];
  const groupsData = data?.groups || [];
  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className={`${PANEL} p-3`}>
        <div className="flex flex-wrap gap-2 items-end">
          <DateInput label="시작" value={periodStart} onChange={setPeriodStart} />
          <DateInput label="종료" value={periodEnd} onChange={setPeriodEnd} />
          <Segment
            label="단위"
            options={[
              { v: 'day', l: '일' }, { v: 'month', l: '월' },
              { v: 'quarter', l: '분기' }, { v: 'year', l: '년' },
            ]}
            value={granularity}
            onChange={setGranularity}
          />
          <MultiSelect
            label="채널"
            options={channels.map((c: Channel) => ({ v: c.id, l: c.name, group: c.category }))}
            value={selChannels}
            onChange={setSelChannels}
          />
          <MultiSelect
            label="품목"
            options={products.map((p: Product) => ({ v: String(p.id), l: p.name }))}
            value={selProducts.map((n: number) => String(n))}
            onChange={(vs: string[]) => setSelProducts(vs.map(s => parseInt(s)))}
          />
          <MultiSelect
            label="담당자"
            options={(employees || [])
              .filter((e: Employee) => e.is_active)
              .map((e: Employee) => ({
                v: String(e.id),
                l: `${e.name} (${(e.channels?.length ?? 0)}채널)`,
                group: e.role === 'admin' ? '관리자' : e.role === 'manager' ? '매니저' : '담당자',
              }))
            }
            value={selEmployees.map((n: number) => String(n))}
            onChange={(vs: string[]) => setSelEmployees(vs.map(s => parseInt(s)))}
          />
          <div className="ml-auto">
            {(selChannels.length > 0 || selProducts.length > 0 || selEmployees.length > 0) && (
              <button
                onClick={() => { setSelChannels([]); setSelProducts([]); setSelEmployees([]); }}
                className="text-xs text-[#A3A9B3] hover:text-[#F7F8F8] px-3 py-2"
              >
                필터 초기화
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 기간 비교 토글 + 컨트롤 */}
      <div className={`${PANEL} p-3`}>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <button
            onClick={() => setCompareOpen((v: boolean) => !v)}
            className="text-xs font-medium text-[#828FFF] hover:text-[#A8B3FF] flex items-center gap-1.5"
          >
            <span className={`inline-block transition-transform ${compareOpen ? 'rotate-90' : ''}`}>▶</span>
            기간 비교 {compareOpen ? '닫기' : '열기'}
          </button>
          {compareOpen && (
            <div className="flex items-end gap-2 flex-wrap">
              <span className="text-[11px] text-[#A3A9B3] pb-1.5">
                기준 기간({periodDays}일)의 <span className="text-[#F7F8F8] font-medium">직전 동일 길이</span>와 자동 비교됩니다.
                {compareManual && <span className="ml-1 text-[#F0BF00]">(수동 조정됨)</span>}
              </span>
              <DateInput label="직전 시작" value={compareStart} onChange={(v: string) => { setCompareStart(v); setCompareManual(true); }} />
              <DateInput label="직전 종료" value={compareEnd} onChange={(v: string) => { setCompareEnd(v); setCompareManual(true); }} />
              {compareManual && (
                <button
                  onClick={() => setCompareManual(false)}
                  className="text-[10px] text-[#A3A9B3] hover:text-[#F7F8F8] px-2 py-1.5 border border-[#23252A] rounded"
                  title="기준 기간 직전 동일 길이로 재설정"
                >자동으로 복귀</button>
              )}
              {hasCompare && (
                <span className="text-[10px] text-[#7A7F8A] ml-2">
                  비교: 매출 ₩{fmtKR(compareData.summary.revenue)} · 공헌이익 ₩{fmtKR(compareData.summary.contribution_margin)}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* KPI 6개 (스파크라인 + 비교 델타) */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <CompactKpi label="순매출"
          value={data ? `₩${fmtKR(data.summary.revenue)}` : '—'}
          hint={data ? `${fmtNum(data.summary.orders)} 주문${data.summary.cancelled_count ? ` · 취소/환불 ${fmtNum(data.summary.cancelled_count)}건` : ''}` : ''}
          accent="#828FFF"
          spark={sparkKey('revenue')}
          compareValue={hasCompare ? compareData.summary.revenue : undefined}
          currentValue={data?.summary.revenue}
        />
        <CompactKpi label="낱개수량"
          value={data ? fmtNum(Math.round(data.summary.pcs)) : '—'}
          hint="입수 환산"
          accent="#7070FF"
          spark={sparkKey('pcs')}
          compareValue={hasCompare ? compareData.summary.pcs : undefined}
          currentValue={data?.summary.pcs}
        />
        <CompactKpi label="공헌이익"
          value={data ? `₩${fmtKR(data.summary.contribution_margin)}` : '—'}
          hint={data ? `변동비 ₩${fmtKR(data.summary.variable_cost)}` : ''}
          accent="#27A644"
          spark={sparkKey('cm')}
          compareValue={hasCompare ? compareData.summary.contribution_margin : undefined}
          currentValue={data?.summary.contribution_margin}
        />
        <CompactKpi label="공헌이익률"
          value={data ? fmtPct(data.summary.cm_rate) : '—'}
          hint=""
          accent={data?.summary.cm_rate >= 30 ? '#27A644' : '#F0BF00'}
          compareValue={hasCompare ? compareData.summary.cm_rate : undefined}
          currentValue={data?.summary.cm_rate}
          deltaFormat="pp"
        />
        <CompactKpi label="낱개당 객단가"
          value={data ? `₩${fmtKR(data.summary.avg_price_per_pcs || 0)}` : '—'}
          hint=""
          accent="#06B6D4"
          compareValue={hasCompare ? compareData.summary.avg_price_per_pcs : undefined}
          currentValue={data?.summary.avg_price_per_pcs}
        />
        <CompactKpi label="주문당 객단가"
          value={data ? `₩${fmtKR(data.summary.avg_price_per_order || 0)}` : '—'}
          hint=""
          accent="#A855F7"
          compareValue={hasCompare ? compareData.summary.avg_price_per_order : undefined}
          currentValue={data?.summary.avg_price_per_order}
        />
      </div>

      {/* 도넛 3종 (구분/채널/품목) — 가로 컴팩트 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <DonutCard
          title="구분별 매출 비중"
          subtitle="온라인(위탁)·온라인(사입)·오프라인"
          data={groupsData.map((g: any) => ({ name: g.group, value: g.revenue }))}
          colors={['#828FFF', '#27A644', '#F0BF00']}
        />
        <DonutCard
          title="채널별 매출 비중"
          subtitle={`Top 10 / ${data?.channels?.length || 0}`}
          data={(data?.channels || []).slice(0, 10).map((c: any) => ({ name: c.channel_name, value: c.revenue }))}
        />
        <DonutCard
          title="품목별 매출 비중"
          subtitle={`Top 12 / ${data?.products?.length || 0}`}
          data={(data?.products || []).slice(0, 12).map((p: any) => ({ name: p.product_name, value: p.revenue }))}
        />
      </div>

      {/* 메인 추이 + 변동비 분해 (2:1) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className={`${PANEL} p-4 lg:col-span-2`}>
          <div className="flex items-baseline justify-between mb-2">
            <h3 className="text-sm font-semibold text-[#F7F8F8]">매출 & 공헌이익 추이</h3>
            <span className="text-[10px] font-mono uppercase tracking-wider text-[#A3A9B3]">
              {granularity === 'day' ? '일간' : granularity === 'month' ? '월간' : granularity === 'quarter' ? '분기' : '연간'}
            </span>
          </div>
          {loading ? <Skeleton h={240} /> : data && data.series.length ? (
            <ResponsiveContainer width="100%" height={240}>
              <ComposedChart data={seriesWithCompare} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradRevenue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#A8B3FF" stopOpacity={0.95} />
                    <stop offset="100%" stopColor="#5560C8" stopOpacity={0.55} />
                  </linearGradient>
                  <linearGradient id="gradRevenueCmp" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#7A7F8A" stopOpacity={0.55} />
                    <stop offset="100%" stopColor="#3A3D45" stopOpacity={0.25} />
                  </linearGradient>
                  <linearGradient id="gradCmArea" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#27A644" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#27A644" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid {...CHART_GRID} />
                <XAxis dataKey="period" tick={AXIS_TICK} stroke="#62666D" />
                <YAxis tick={AXIS_TICK} stroke="#62666D" tickFormatter={fmtKR} />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} itemStyle={TOOLTIP_ITEM_STYLE}
                  formatter={(v: number, n: string) => [`₩${fmtKR(v)}`, n]}
                  labelFormatter={(label: any, payload: any) => {
                    if (!payload?.[0]) return label;
                    const cp = payload[0].payload?.compare_period;
                    return cp ? `${label}  (비교: ${cp})` : label;
                  }}
                />
                <Legend wrapperStyle={LEGEND_STYLE} />
                {hasCompare && (
                  <Bar dataKey="compare_revenue" name="비교 매출" fill="url(#gradRevenueCmp)" radius={[6, 6, 0, 0]} />
                )}
                <Bar dataKey="revenue" name="순매출" fill="url(#gradRevenue)" radius={[6, 6, 0, 0]} />
                {hasCompare && (
                  <Line type="monotone" dataKey="compare_cm" name="비교 공헌이익" stroke="#A3A9B3" strokeWidth={1.5} strokeDasharray="5 4" dot={false} />
                )}
                <Area type="monotone" dataKey="contribution_margin" name="공헌이익" stroke="#27A644" strokeWidth={2.5} fill="url(#gradCmArea)" dot={{ r: 3, stroke: '#27A644', strokeWidth: 2, fill: '#0F1011' }} activeDot={{ r: 5 }} />
              </ComposedChart>
            </ResponsiveContainer>
          ) : <Empty h={240} />}
        </div>
        <div className={`${PANEL} p-4`}>
          <h3 className="text-sm font-semibold text-[#F7F8F8] mb-2">변동비 분해</h3>
          {costBreakdown.length ? (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={costBreakdown} layout="vertical" margin={{ left: 70, right: 12, top: 5, bottom: 5 }}>
                <defs>
                  <linearGradient id="gradCost" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#C03030" stopOpacity={0.85} />
                    <stop offset="100%" stopColor="#FF7A7A" stopOpacity={1} />
                  </linearGradient>
                </defs>
                <CartesianGrid {...CHART_GRID} />
                <XAxis type="number" tick={AXIS_TICK} stroke="#62666D" tickFormatter={fmtKR} />
                <YAxis type="category" dataKey="name" tick={AXIS_TICK} stroke="#62666D" width={70} />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} itemStyle={TOOLTIP_ITEM_STYLE}
                  formatter={(v: number) => `₩${fmtKR(v)}`}
                />
                <Bar dataKey="value" fill="url(#gradCost)" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[240px] flex flex-col items-center justify-center text-xs text-[#A3A9B3] gap-1">
              <span>변동비 규칙이 설정되지 않았습니다</span>
              <span className="text-[10px] text-[#7A7F8A]">변동비 설정 탭에서 입력해 주세요</span>
            </div>
          )}
        </div>
      </div>

      {/* 기간별 판매수량 추이 (낱개) */}
      <div className={`${PANEL} p-4`}>
        <div className="flex items-baseline justify-between mb-2">
          <h3 className="text-sm font-semibold text-[#F7F8F8]">
            판매수량 추이
            {selProducts.length > 0 && (
              <span className="text-[10px] text-[#7A7F8A] ml-2 font-normal">
                ({selProducts.length}개 품목 선택)
              </span>
            )}
          </h3>
          <span className="text-[10px] font-mono uppercase tracking-wider text-[#A3A9B3]">
            {granularity === 'day' ? '일간' : granularity === 'month' ? '월간' : granularity === 'quarter' ? '분기' : '연간'}
          </span>
        </div>
        {loading ? <Skeleton h={220} /> : data && data.series.length ? (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={seriesWithCompare} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="gradPcsLine" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#A8B3FF" stopOpacity={1} />
                  <stop offset="100%" stopColor="#5560C8" stopOpacity={1} />
                </linearGradient>
              </defs>
              <CartesianGrid {...CHART_GRID} />
              <XAxis dataKey="period" tick={AXIS_TICK} stroke="#62666D" />
              <YAxis tick={AXIS_TICK} stroke="#62666D" tickFormatter={fmtNum} />
              <Tooltip
                contentStyle={TOOLTIP_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} itemStyle={TOOLTIP_ITEM_STYLE}
                formatter={(v: number, n: string) => [`${fmtNum(Math.round(v))}개`, n]}
                labelFormatter={(label: any, payload: any) => {
                  if (!payload?.[0]) return label;
                  const cp = payload[0].payload?.compare_period;
                  return cp ? `${label}  (비교: ${cp})` : label;
                }}
              />
              <Legend wrapperStyle={LEGEND_STYLE} />
              {hasCompare && (
                <Line type="monotone" dataKey="compare_pcs" name="비교 판매수량" stroke="#7A7F8A" strokeWidth={1.5} strokeDasharray="5 4" dot={false} />
              )}
              <Line type="monotone" dataKey="pcs" name="판매수량 (낱개)" stroke="url(#gradPcsLine)" strokeWidth={2.5} dot={{ r: 3, stroke: '#A8B3FF', strokeWidth: 2, fill: '#0F1011' }} activeDot={{ r: 5 }} />
            </LineChart>
          </ResponsiveContainer>
        ) : <Empty h={220} />}
      </div>

      {/* Top10 채널 + Top12 품목 가로 막대 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className={`${PANEL} p-4`}>
          <div className="flex items-baseline justify-between mb-2">
            <h3 className="text-sm font-semibold text-[#F7F8F8]">채널별 매출/공헌이익 Top 10</h3>
          </div>
          {data && data.channels.length ? (
            <ResponsiveContainer width="100%" height={Math.max(220, Math.min(data.channels.length, 10) * (hasCompare ? 38 : 26))}>
              <BarChart data={channelsWithCmp.slice(0, 10)} layout="vertical" margin={{ left: 70, right: 12, top: 5, bottom: 5 }}>
                <defs>
                  <linearGradient id="gradTopRev" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#5560C8" stopOpacity={0.8} />
                    <stop offset="100%" stopColor="#A8B3FF" stopOpacity={1} />
                  </linearGradient>
                  <linearGradient id="gradTopRevCmp" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#3A3D45" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="#7A7F8A" stopOpacity={0.7} />
                  </linearGradient>
                  <linearGradient id="gradTopCm" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#1F7A38" stopOpacity={0.8} />
                    <stop offset="100%" stopColor="#3DD971" stopOpacity={1} />
                  </linearGradient>
                  <linearGradient id="gradTopCmCmp" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#1A4023" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="#3F6E4D" stopOpacity={0.6} />
                  </linearGradient>
                </defs>
                <CartesianGrid {...CHART_GRID} />
                <XAxis type="number" tick={AXIS_TICK} stroke="#62666D" tickFormatter={fmtKR} />
                <YAxis type="category" dataKey="channel_name" tick={AXIS_TICK} stroke="#62666D" width={80} />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} itemStyle={TOOLTIP_ITEM_STYLE}
                  formatter={(v: number, n: string) => [`₩${fmtKR(v)}`, n]}
                />
                <Legend wrapperStyle={LEGEND_STYLE} />
                <Bar dataKey="revenue" name="매출" fill="url(#gradTopRev)" radius={[0, 6, 6, 0]} />
                {hasCompare && <Bar dataKey="compare_revenue" name="비교 매출" fill="url(#gradTopRevCmp)" radius={[0, 6, 6, 0]} />}
                <Bar dataKey="contribution_margin" name="공헌이익" fill="url(#gradTopCm)" radius={[0, 6, 6, 0]} />
                {hasCompare && <Bar dataKey="compare_cm" name="비교 공헌이익" fill="url(#gradTopCmCmp)" radius={[0, 6, 6, 0]} />}
              </BarChart>
            </ResponsiveContainer>
          ) : <Empty h={220} />}
        </div>
        <div className={`${PANEL} p-4`}>
          <h3 className="text-sm font-semibold text-[#F7F8F8] mb-2">품목별 매출/공헌이익 Top 12</h3>
          {data && data.products.length ? (
            <ResponsiveContainer width="100%" height={Math.max(220, Math.min(data.products.length, 12) * (hasCompare ? 38 : 26))}>
              <BarChart data={productsWithCmp.slice(0, 12)} layout="vertical" margin={{ left: 70, right: 12, top: 5, bottom: 5 }}>
                <defs>
                  <linearGradient id="gradTopRev2" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#5560C8" stopOpacity={0.8} />
                    <stop offset="100%" stopColor="#A8B3FF" stopOpacity={1} />
                  </linearGradient>
                  <linearGradient id="gradTopRev2Cmp" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#3A3D45" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="#7A7F8A" stopOpacity={0.7} />
                  </linearGradient>
                  <linearGradient id="gradTopCm2" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#1F7A38" stopOpacity={0.8} />
                    <stop offset="100%" stopColor="#3DD971" stopOpacity={1} />
                  </linearGradient>
                  <linearGradient id="gradTopCm2Cmp" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#1A4023" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="#3F6E4D" stopOpacity={0.6} />
                  </linearGradient>
                </defs>
                <CartesianGrid {...CHART_GRID} />
                <XAxis type="number" tick={AXIS_TICK} stroke="#62666D" tickFormatter={fmtKR} />
                <YAxis type="category" dataKey="product_name" tick={AXIS_TICK} stroke="#62666D" width={70} />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} itemStyle={TOOLTIP_ITEM_STYLE}
                  formatter={(v: number, n: string) => [`₩${fmtKR(v)}`, n]}
                />
                <Legend wrapperStyle={LEGEND_STYLE} />
                <Bar dataKey="revenue" name="매출" fill="url(#gradTopRev2)" radius={[0, 6, 6, 0]} />
                {hasCompare && <Bar dataKey="compare_revenue" name="비교 매출" fill="url(#gradTopRev2Cmp)" radius={[0, 6, 6, 0]} />}
                <Bar dataKey="contribution_margin" name="공헌이익" fill="url(#gradTopCm2)" radius={[0, 6, 6, 0]} />
                {hasCompare && <Bar dataKey="compare_cm" name="비교 공헌이익" fill="url(#gradTopCm2Cmp)" radius={[0, 6, 6, 0]} />}
              </BarChart>
            </ResponsiveContainer>
          ) : <Empty h={220} />}
        </div>
      </div>

      {/* 품목 테이블 */}
      <div className={`${PANEL} p-5 mb-5`}>
        <h2 className="text-sm font-semibold text-[#F7F8F8] mb-3">
          품목별 상세{hasCompare && <span className="text-[10px] text-[#7A7F8A] ml-2 font-normal">(▲▼ 비교 기간 대비)</span>}
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#23252A] text-[11px] uppercase tracking-wider text-[#62666D]">
                <th className="text-left py-2.5 px-2">품목</th>
                <th className="text-right py-2.5 px-2">낱개수량</th>
                <th className="text-right py-2.5 px-2">주문건수</th>
                <th className="text-right py-2.5 px-2">순매출</th>
                <th className="text-right py-2.5 px-2">공헌이익</th>
                <th className="text-right py-2.5 px-2">공헌이익률</th>
              </tr>
            </thead>
            <tbody>
              {data && data.products.length ? (
                productsWithCmp.map((p: any) => {
                  const revDelta = hasCompare ? fmtDelta(p.revenue, p.compare_revenue) : null;
                  const cmDelta = hasCompare ? fmtDelta(p.contribution_margin, p.compare_cm) : null;
                  return (
                    <tr key={p.product_id} className="border-b border-[#1A1B1F] hover:bg-[#1A1C22]">
                      <td className="py-2 px-2 text-[#F7F8F8]">{p.product_name}</td>
                      <td className="py-2 px-2 text-right font-mono text-[#D0D6E0]">{fmtNum(Math.round(p.pcs))}</td>
                      <td className="py-2 px-2 text-right font-mono text-[#D0D6E0]">{fmtNum(p.orders)}</td>
                      <td className="py-2 px-2 text-right font-mono text-[#F7F8F8]">
                        ₩{fmtKR(p.revenue)}
                        {revDelta && <DeltaBadge delta={revDelta} />}
                      </td>
                      <td className="py-2 px-2 text-right font-mono text-[#27A644]">
                        ₩{fmtKR(p.contribution_margin)}
                        {cmDelta && <DeltaBadge delta={cmDelta} />}
                      </td>
                      <td className="py-2 px-2 text-right font-mono text-[#828FFF]">{fmtPct(p.cm_rate)}</td>
                    </tr>
                  );
                })
              ) : (
                <tr><td colSpan={6} className="py-8 text-center text-[#62666D]">데이터가 없습니다. 엑셀을 업로드해보세요.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 채널 테이블 */}
      <div className={`${PANEL} p-5`}>
        <h2 className="text-sm font-semibold text-[#F7F8F8] mb-3">
          채널별 상세{hasCompare && <span className="text-[10px] text-[#7A7F8A] ml-2 font-normal">(▲▼ 비교 기간 대비)</span>}
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#23252A] text-[11px] uppercase tracking-wider text-[#62666D]">
                <th className="text-left py-2.5 px-2">채널</th>
                <th className="text-left py-2.5 px-2">카테고리</th>
                <th className="text-right py-2.5 px-2">낱개수량</th>
                <th className="text-right py-2.5 px-2">주문건수</th>
                <th className="text-right py-2.5 px-2">순매출</th>
                <th className="text-right py-2.5 px-2">공헌이익</th>
                <th className="text-right py-2.5 px-2">공헌이익률</th>
              </tr>
            </thead>
            <tbody>
              {data && data.channels.length ? (
                channelsWithCmp.map((c: any) => {
                  const revDelta = hasCompare ? fmtDelta(c.revenue, c.compare_revenue) : null;
                  const cmDelta = hasCompare ? fmtDelta(c.contribution_margin, c.compare_cm) : null;
                  return (
                    <tr key={c.channel_id} className="border-b border-[#1A1B1F] hover:bg-[#1A1C22]">
                      <td className="py-2 px-2 text-[#F7F8F8]">{c.channel_name}</td>
                      <td className="py-2 px-2 text-[#8A8F98]">{c.channel_category || '-'}</td>
                      <td className="py-2 px-2 text-right font-mono text-[#D0D6E0]">{fmtNum(Math.round(c.pcs))}</td>
                      <td className="py-2 px-2 text-right font-mono text-[#D0D6E0]">{fmtNum(c.orders)}</td>
                      <td className="py-2 px-2 text-right font-mono text-[#F7F8F8]">
                        ₩{fmtKR(c.revenue)}
                        {revDelta && <DeltaBadge delta={revDelta} />}
                      </td>
                      <td className="py-2 px-2 text-right font-mono text-[#27A644]">
                        ₩{fmtKR(c.contribution_margin)}
                        {cmDelta && <DeltaBadge delta={cmDelta} />}
                      </td>
                      <td className="py-2 px-2 text-right font-mono text-[#828FFF]">{fmtPct(c.cm_rate)}</td>
                    </tr>
                  );
                })
              ) : (
                <tr><td colSpan={7} className="py-8 text-center text-[#62666D]">데이터가 없습니다.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Upload Tab
// ──────────────────────────────────────────────────────────────

function UploadTab({
  channels, batches, authHeaders, onUploaded,
}: {
  channels: Channel[]; batches: Batch[];
  authHeaders: () => HeadersInit; onUploaded: () => void;
}) {
  const [selChannel, setSelChannel] = useState<Channel | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [liveBatches, setLiveBatches] = useState<Batch[]>(batches);
  const fileRef = useRef<HTMLInputElement>(null);

  // 캐시 안 타는 /batches 직접 조회 (업로드 직후 최신 상태 확인용)
  const refreshBatches = useCallback(async (): Promise<Batch[]> => {
    try {
      const r = await fetch(`${API_BASE}/api/csa/batches?limit=50`, { headers: authHeaders() });
      if (r.ok) {
        const list = await r.json();
        setLiveBatches(list);
        return list;
      }
    } catch {}
    return [];
  }, [authHeaders]);

  // 탭 진입 시 1회 + 20초마다 폴링 — 다른 구성원이 올린 업로드도 자동 반영(전사 공유 이력).
  useEffect(() => {
    refreshBatches();
    const t = setInterval(() => { refreshBatches(); }, 20000);
    return () => clearInterval(t);
  }, [refreshBatches]);
  // 최초 1회만 bootstrap batches로 초기화 (이후엔 fresh /batches가 진실원 — stale 캐시 덮어쓰기 방지)
  const _seededRef = useRef(false);
  useEffect(() => {
    if (!_seededRef.current && liveBatches.length === 0 && batches.length > 0) {
      _seededRef.current = true;
      setLiveBatches(batches);
    }
  }, [batches, liveBatches.length]);

  const upload = async (file: File) => {
    if (!selChannel) return;
    setUploading(true); setResult(null);
    try {
      const fd = new FormData();
      fd.append('channel_id', selChannel.id);
      fd.append('channel_name', selChannel.name);
      fd.append('file', file);
      const r = await fetch(`${API_BASE}/api/csa/upload`, {
        method: 'POST', headers: authHeaders(), body: fd,
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail || 'upload failed');

      // 이미 적재된 동일 파일 — 카운트가 바로 옴
      if (data.duplicate_file) {
        setResult({ ...data, processing: false });
        setUploading(false);
        if (fileRef.current) fileRef.current.value = '';
        refreshBatches();
        return;
      }

      // 비동기 처리(queued) — batches를 폴링해 완료까지 추적
      const fhash = data.file_hash;
      const chId = data.channel_id || selChannel.id;
      setResult({ status: 'queued', processing: true });
      const started = Date.now();
      const poll = async (): Promise<void> => {
        await new Promise((res) => setTimeout(res, 1500));
        const list = await refreshBatches();
        const b = list.find((x: any) => fhash && x.file_hash === fhash)
               || list.find((x: any) => x.channel_id === chId);
        if (b) {
          const done = b.status === 'done' || b.status === 'failed';
          setResult({ ...b, processing: !done });
          if (done) {
            setUploading(false);
            if (fileRef.current) fileRef.current.value = '';
            onUploaded();
            return;
          }
        }
        if (Date.now() - started < 180000) return poll();  // 최대 3분
        setUploading(false);  // 타임아웃 — 처리 중일 수 있음
        if (fileRef.current) fileRef.current.value = '';
      };
      poll();
    } catch (e: any) {
      setResult({ error: e.message || String(e) });
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const categories = useMemo(() => {
    const map: Record<string, Channel[]> = {};
    channels.forEach(c => {
      if (!map[c.category]) map[c.category] = [];
      map[c.category].push(c);
    });
    return map;
  }, [channels]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      <div className={`${PANEL} p-5`}>
        <h2 className="text-sm font-semibold mb-3">1) 채널 선택</h2>
        <div className="space-y-4 max-h-[500px] overflow-y-auto pr-2">
          {Object.entries(categories).map(([cat, list]) => (
            <div key={cat}>
              <div className="text-[10px] uppercase tracking-wider text-[#62666D] mb-1.5">{cat}</div>
              <div className="grid grid-cols-2 gap-1.5">
                {list.map(c => (
                  <button
                    key={c.id}
                    onClick={() => setSelChannel(c)}
                    disabled={!c.has_parser}
                    className={`text-left text-xs px-3 py-2 rounded border transition-colors ${
                      selChannel?.id === c.id
                        ? 'bg-[#828FFF] border-[#828FFF] text-white'
                        : c.has_parser
                          ? 'bg-[#08090A] border-[#23252A] text-[#D0D6E0] hover:border-[#828FFF]'
                          : 'bg-[#08090A] border-[#1A1B1F] text-[#62666D] cursor-not-allowed'
                    }`}
                  >
                    <div className="font-medium flex items-center justify-between">
                      <span>{c.name}</span>
                      {!c.has_parser && (
                        <span className="text-[9px] text-[#62666D]">미지원</span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className={`${PANEL} p-5`}>
        <h2 className="text-sm font-semibold mb-3">2) 엑셀 업로드</h2>
        {selChannel ? (
          <>
            <div className={`${SUBPANEL} p-4 mb-4`}>
              <div className="text-xs text-[#8A8F98] mb-1">선택된 채널</div>
              <div className="text-lg font-semibold text-[#F7F8F8]">{selChannel.name}</div>
              <div className="text-[11px] text-[#62666D] mt-1">{selChannel.category} · 파서: {selChannel.has_parser ? '준비 완료' : '미지원'}</div>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.csv,.pdf"
              onChange={(e) => e.target.files && e.target.files[0] && upload(e.target.files[0])}
              disabled={uploading || !selChannel.has_parser}
              className="w-full text-sm text-[#D0D6E0] file:mr-3 file:py-2 file:px-4 file:rounded file:border-0 file:bg-[#828FFF] file:text-white file:cursor-pointer hover:file:bg-[#7070FF] disabled:opacity-50"
            />
            <div className="text-[11px] text-[#62666D] mt-2 leading-relaxed">
              · 동일 파일을 다시 올리면 자동 감지하여 중복 적재하지 않습니다.<br/>
              · (주문번호 + 라인 + 일자 + 상품 + 수량 + 금액)으로 dedup 키 생성.<br/>
              · 표준 품목명 매칭 실패 행은 <span className="text-[#F0BF00]">매핑 대기</span> 큐로 자동 이동.
            </div>

            {uploading && (
              <div className="mt-4 text-sm text-[#828FFF] flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-[#828FFF] border-t-transparent rounded-full animate-spin" />
                {result?.status === 'queued' ? '업로드 완료 — 적재 처리 중...' : '업로드 및 파싱 중...'}
              </div>
            )}

            {result && !result.error && (
              <div className={`${SUBPANEL} p-3 mt-4 text-xs`}>
                {result.duplicate_file ? (
                  <div className="text-[#F0BF00] mb-1">⚠ 이미 업로드된 파일입니다.</div>
                ) : result.status === 'failed' ? (
                  <div className="text-[#EB5757] mb-1">❌ 처리 실패{result.error_message ? `: ${result.error_message}` : ''}</div>
                ) : result.processing ? (
                  <div className="text-[#828FFF] mb-1 flex items-center gap-1.5">
                    <div className="w-3 h-3 border-2 border-[#828FFF] border-t-transparent rounded-full animate-spin" />
                    적재 처리 중... (대용량은 수십 초 걸릴 수 있어요)
                  </div>
                ) : (
                  <div className="text-[#27A644] mb-1">✓ 업로드 성공</div>
                )}
                <div className="grid grid-cols-5 gap-2 text-[#D0D6E0] font-mono">
                  <div><span className="text-[#62666D]">총행: </span>{result.row_total ?? '–'}</div>
                  <div><span className="text-[#62666D]">신규: </span>{result.row_inserted ?? '–'}</div>
                  <div><span className="text-[#62666D]">중복: </span>{result.row_duplicate ?? '–'}</div>
                  <div><span className="text-[#62666D]">미매핑: </span>{result.row_unmatched ?? '–'}</div>
                  <div><span className="text-[#62666D]">취소/환불: </span><span className={result.row_cancelled ? 'text-[#EB9F57]' : ''}>{result.row_cancelled ?? 0}</span></div>
                </div>
                {result.period_start && (
                  <div className="text-[10px] text-[#62666D] mt-1.5 font-mono">기간: {result.period_start} ~ {result.period_end}</div>
                )}
              </div>
            )}
            {result?.error && (
              <div className="mt-4 text-sm text-[#EB5757]">❌ {result.error}</div>
            )}
          </>
        ) : (
          <div className="text-sm text-[#62666D] py-12 text-center">먼저 좌측에서 채널을 선택하세요.</div>
        )}

        <div className="mt-6 pt-4 border-t border-[#23252A]">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[#62666D]">최근 업로드 이력</h3>
            <button onClick={() => refreshBatches()} className="text-[10px] text-[#828FFF] hover:underline">새로고침</button>
          </div>
          <div className="space-y-1.5 max-h-[260px] overflow-y-auto">
            {liveBatches.length === 0 ? (
              <div className="text-xs text-[#62666D]">업로드 이력이 없습니다.</div>
            ) : liveBatches.map(b => (
              <div key={b.id} className={`${SUBPANEL} p-2.5 text-xs flex items-center justify-between`}>
                <div className="min-w-0 flex-1">
                  <div className="text-[#F7F8F8] truncate">{b.channel_name} · <span className="text-[#8A8F98]">{b.file_name}</span></div>
                  <div className="text-[10px] text-[#62666D] font-mono mt-0.5">
                    {b.period_start ? `${b.period_start} ~ ${b.period_end} · ` : ''}신규 {b.row_inserted} · 중복 {b.row_duplicate} · 미매핑 {b.row_unmatched}{b.row_cancelled ? ` · 취소/환불 ${b.row_cancelled}` : ''}
                  </div>
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded font-medium ${
                  b.status === 'done' ? 'bg-[#27A644]/15 text-[#27A644]'
                  : b.status === 'failed' ? 'bg-[#EB5757]/15 text-[#EB5757]'
                  : 'bg-[#F0BF00]/15 text-[#F0BF00]'
                }`}>{b.status === 'parsing' || b.status === 'queued' ? '처리중' : b.status}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Mapping Tab
// ──────────────────────────────────────────────────────────────

function MappingTab({
  unmatched, products, authHeaders, onResolved,
}: {
  unmatched: UnmatchedItem[]; products: Product[];
  authHeaders: () => HeadersInit; onResolved: () => void;
}) {
  const [busy, setBusy] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkProductId, setBulkProductId] = useState<number | ''>('');
  const [bulkUnitPerSet, setBulkUnitPerSet] = useState<number>(1);
  const [bulkExcluded, setBulkExcluded] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  const resolveOne = async (it: UnmatchedItem, productId: number | null, unitPerSet: number, isExcluded: boolean) => {
    const r = await fetch(`${API_BASE}/api/csa/mapping`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({
        channel_id: it.channel_id,
        channel_name: it.channel_name,
        raw_product_name: it.raw_product_name,
        raw_option_name: it.raw_option_name,
        product_id: productId,
        unit_per_set: unitPerSet,
        is_excluded: isExcluded,
      }),
    });
    if (!r.ok) {
      const data = await r.json().catch(() => ({}));
      throw new Error(data.detail || r.statusText);
    }
  };

  const resolve = async (it: UnmatchedItem, productId: number | null, unitPerSet: number, isExcluded: boolean) => {
    setBusy(it.id);
    try {
      await resolveOne(it, productId, unitPerSet, isExcluded);
      onResolved();
    } catch (e: any) {
      alert(`매핑 저장 실패: ${e.message || e}`);
    } finally {
      setBusy(null);
    }
  };

  const toggleAll = () => {
    if (selected.size === unmatched.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(unmatched.map(u => u.id)));
    }
  };

  const toggleOne = (id: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const applyBulk = async () => {
    if (selected.size === 0) {
      alert('선택된 항목이 없습니다.'); return;
    }
    if (!bulkExcluded && !bulkProductId) {
      alert('적용할 표준 품목을 선택하거나, "제외"를 체크해주세요.'); return;
    }
    if (!confirm(`선택된 ${selected.size}개 항목에 일괄 적용하시겠습니까?\n  · 품목: ${bulkExcluded ? '제외 처리' : products.find(p => p.id === bulkProductId)?.name}\n  · 입수: ${bulkUnitPerSet}개`)) return;
    setBulkBusy(true);
    const targets = unmatched.filter(u => selected.has(u.id));
    let ok = 0, fail = 0;
    const errors: string[] = [];
    for (const it of targets) {
      try {
        await resolveOne(
          it,
          bulkExcluded ? null : (bulkProductId as number),
          bulkUnitPerSet,
          bulkExcluded,
        );
        ok++;
      } catch (e: any) {
        fail++;
        errors.push(`${it.raw_product_name}: ${e.message || e}`);
      }
    }
    setBulkBusy(false);
    setSelected(new Set());
    if (fail > 0) {
      alert(`완료: ${ok}건 성공, ${fail}건 실패\n\n${errors.slice(0, 5).join('\n')}`);
    }
    onResolved();
  };

  // 채널 필터 + 페이지네이션
  const [filterChannel, setFilterChannel] = useState<string>('');
  const [filterText, setFilterText] = useState<string>('');
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 500;

  const channelOpts = useMemo(() => {
    const m = new Map<string, string>();
    unmatched.forEach(u => m.set(u.channel_id, u.channel_name));
    return Array.from(m.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [unmatched]);

  const filtered = useMemo(() => {
    const ft = filterText.trim().toLowerCase();
    return unmatched.filter(u => {
      if (filterChannel && u.channel_id !== filterChannel) return false;
      if (ft && !((u.raw_product_name || '').toLowerCase().includes(ft) || (u.raw_option_name || '').toLowerCase().includes(ft))) return false;
      return true;
    });
  }, [unmatched, filterChannel, filterText]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * PAGE_SIZE;
  const pageItems = filtered.slice(pageStart, pageStart + PAGE_SIZE);

  // 페이지 단위 전체선택
  const toggleAllInPage = () => {
    const ids = pageItems.map(u => u.id);
    const allInPage = ids.every(id => selected.has(id));
    setSelected(prev => {
      const next = new Set(prev);
      if (allInPage) ids.forEach(id => next.delete(id));
      else ids.forEach(id => next.add(id));
      return next;
    });
  };
  const allChecked = pageItems.length > 0 && pageItems.every(u => selected.has(u.id));
  const someChecked = pageItems.some(u => selected.has(u.id)) && !allChecked;

  return (
    <div className={`${PANEL} p-4`}>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div>
          <h2 className="text-sm font-semibold">매핑 대기 큐 ({filtered.length.toLocaleString()}건{filtered.length !== unmatched.length && ` / 전체 ${unmatched.length.toLocaleString()}`})</h2>
          <p className="text-[11px] text-[#62666D] mt-0.5">한 번 매핑하면 동일 (채널·상품명·옵션) 조합은 다음 업로드부터 자동 매핑됩니다.</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={filterChannel}
            onChange={(e) => { setFilterChannel(e.target.value); setPage(1); }}
            className="bg-[#0F1011] border border-[#23252A] rounded px-2 py-1 text-xs text-[#F7F8F8] max-w-[160px]"
          >
            <option value="">전체 채널</option>
            {channelOpts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <input
            type="search"
            placeholder="상품명/옵션 검색"
            value={filterText}
            onChange={(e) => { setFilterText(e.target.value); setPage(1); }}
            className="bg-[#0F1011] border border-[#23252A] rounded px-2 py-1 text-xs text-[#F7F8F8] w-40"
          />
        </div>
      </div>

      {/* 일괄 처리 바 */}
      {selected.size > 0 && (
        <div className={`${SUBPANEL} p-2 mb-2 flex items-center gap-2 text-xs border-[#828FFF]/40`}>
          <span className="text-[#828FFF] font-medium whitespace-nowrap">선택 {selected.size}건</span>
          <select
            value={bulkProductId}
            onChange={(e) => setBulkProductId(e.target.value ? parseInt(e.target.value) : '')}
            disabled={bulkExcluded}
            className="flex-1 bg-[#0F1011] border border-[#23252A] rounded px-2 py-1 text-[#F7F8F8] disabled:opacity-40"
          >
            <option value="">품목 선택…</option>
            {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <input
            type="number" min={1} value={bulkUnitPerSet}
            onChange={(e) => setBulkUnitPerSet(parseInt(e.target.value) || 1)}
            disabled={bulkExcluded}
            title="1세트당 낱개 수(입수)"
            className="w-14 bg-[#0F1011] border border-[#23252A] rounded px-2 py-1 text-[#F7F8F8] font-mono text-right disabled:opacity-40"
          />
          <label className="flex items-center gap-1 text-[#8A8F98] cursor-pointer whitespace-nowrap">
            <input type="checkbox" checked={bulkExcluded} onChange={(e) => setBulkExcluded(e.target.checked)} className="accent-[#EB5757]" />
            제외
          </label>
          <button
            onClick={applyBulk}
            disabled={bulkBusy || (!bulkExcluded && !bulkProductId)}
            className="px-3 py-1 bg-[#828FFF] hover:bg-[#7070FF] disabled:opacity-40 text-white rounded text-xs font-medium whitespace-nowrap"
          >
            {bulkBusy ? '적용 중…' : `${selected.size}건 적용`}
          </button>
          <button
            onClick={() => setSelected(new Set())}
            disabled={bulkBusy}
            className="px-2 py-1 bg-[#23252A] hover:bg-[#2A2D33] text-[#8A8F98] rounded text-xs"
          >해제</button>
        </div>
      )}

      {/* 헤더 (sticky) */}
      {pageItems.length > 0 && (
        <div className="sticky top-0 z-10 bg-[#0F1011] border-b border-[#23252A] flex items-center gap-2 px-2 py-1.5 text-[9px] uppercase tracking-wider text-[#62666D]">
          <input
            type="checkbox"
            checked={allChecked}
            ref={el => { if (el) el.indeterminate = someChecked; }}
            onChange={toggleAllInPage}
            className="accent-[#828FFF]"
          />
          <span className="w-20">채널</span>
          <span className="flex-1">원본 상품 / 옵션</span>
          <span className="w-20 text-right">발견/수량</span>
          <span className="w-40">표준 품목</span>
          <span className="w-12 text-center">입수</span>
          <span className="w-10 text-center">제외</span>
          <span className="w-14 text-center">액션</span>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="text-center py-10 text-[#62666D] text-sm">매핑 대기 항목이 없습니다.</div>
      ) : (
        <div className="divide-y divide-[#1A1C22]">
          {pageItems.map(it => (
            <UnmatchedRow
              key={it.id}
              item={it}
              products={products}
              busy={busy === it.id}
              selected={selected.has(it.id)}
              onToggle={() => toggleOne(it.id)}
              onResolve={resolve}
            />
          ))}
        </div>
      )}

      {/* 페이지네이션 */}
      {filtered.length > PAGE_SIZE && (
        <div className="flex items-center justify-between mt-3 pt-3 border-t border-[#23252A] text-xs">
          <span className="text-[#7A7F8A]">
            {pageStart + 1}–{Math.min(pageStart + PAGE_SIZE, filtered.length)} / {filtered.length.toLocaleString()}건
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(1)} disabled={safePage === 1}
              className="px-2 py-1 bg-[#0F1011] border border-[#23252A] rounded text-[#A3A9B3] hover:text-[#F7F8F8] disabled:opacity-30"
            >« 처음</button>
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage === 1}
              className="px-2 py-1 bg-[#0F1011] border border-[#23252A] rounded text-[#A3A9B3] hover:text-[#F7F8F8] disabled:opacity-30"
            >‹ 이전</button>
            <input
              type="number" min={1} max={totalPages} value={safePage}
              onChange={(e) => setPage(Math.max(1, Math.min(totalPages, parseInt(e.target.value) || 1)))}
              className="w-12 px-2 py-1 bg-[#0F1011] border border-[#23252A] rounded text-[#F7F8F8] text-center font-mono"
            />
            <span className="text-[#7A7F8A]">/ {totalPages}</span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={safePage === totalPages}
              className="px-2 py-1 bg-[#0F1011] border border-[#23252A] rounded text-[#A3A9B3] hover:text-[#F7F8F8] disabled:opacity-30"
            >다음 ›</button>
            <button
              onClick={() => setPage(totalPages)} disabled={safePage === totalPages}
              className="px-2 py-1 bg-[#0F1011] border border-[#23252A] rounded text-[#A3A9B3] hover:text-[#F7F8F8] disabled:opacity-30"
            >끝 »</button>
          </div>
        </div>
      )}
    </div>
  );
}

function UnmatchedRow({
  item, products, busy, selected, onToggle, onResolve,
}: {
  item: UnmatchedItem; products: Product[]; busy: boolean;
  selected: boolean; onToggle: () => void;
  onResolve: (it: UnmatchedItem, productId: number | null, unitPerSet: number, isExcluded: boolean) => void;
}) {
  const [productId, setProductId] = useState<number | ''>(item.llm_suggested_product_id || '');
  const [unitPerSet, setUnitPerSet] = useState<number>(item.llm_suggested_unit_per_set || 1);
  const [excluded, setExcluded] = useState(false);

  return (
    <div className={`flex items-center gap-2 px-2 py-1.5 text-xs hover:bg-[#1A1C22] ${selected ? 'bg-[#828FFF]/5' : ''}`}>
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggle}
        className="accent-[#828FFF] flex-shrink-0"
      />
      <span className="w-20 text-[10px] text-[#62666D] truncate" title={item.channel_name}>{item.channel_name}</span>
      <div className="flex-1 min-w-0">
        <div className="text-[#F7F8F8] truncate" title={item.raw_product_name}>{item.raw_product_name}</div>
        {item.raw_option_name && (
          <div className="text-[#7A7F8A] text-[10px] truncate" title={item.raw_option_name}>{item.raw_option_name}</div>
        )}
      </div>
      <div className="w-20 text-right text-[10px] text-[#7A7F8A] font-mono whitespace-nowrap">
        {item.occurrence_count}회<br/>{fmtNum(Math.round(item.total_qty))}
      </div>
      <select
        value={productId}
        onChange={(e) => setProductId(e.target.value ? parseInt(e.target.value) : '')}
        disabled={excluded}
        className="w-40 bg-[#0F1011] border border-[#23252A] rounded px-1.5 py-1 text-[11px] text-[#F7F8F8] disabled:opacity-40"
      >
        <option value="">—</option>
        {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <input
        type="number" min={1} value={unitPerSet}
        onChange={(e) => setUnitPerSet(parseInt(e.target.value) || 1)}
        disabled={excluded}
        className="w-12 bg-[#0F1011] border border-[#23252A] rounded px-1.5 py-1 text-[#F7F8F8] disabled:opacity-40 font-mono text-right text-[11px]"
      />
      <label className="w-10 flex items-center justify-center cursor-pointer">
        <input
          type="checkbox"
          checked={excluded}
          onChange={(e) => setExcluded(e.target.checked)}
          className="accent-[#EB5757]"
        />
      </label>
      <button
        onClick={() => onResolve(item, excluded ? null : (productId || null) as any, unitPerSet, excluded)}
        disabled={busy || (!excluded && !productId)}
        className="w-14 px-2 py-1 bg-[#828FFF] hover:bg-[#7070FF] disabled:opacity-40 text-white rounded text-[11px] font-medium"
      >
        {busy ? '…' : '저장'}
      </button>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Variable Cost Tab — 세분 변동비 (8종 카테고리)
// ──────────────────────────────────────────────────────────────

interface CostItem {
  id: number;
  code: string;
  name: string;
  category: string;
  basis: string;
  description: string | null;
  is_active: boolean;
  sort_order: number;
}

interface CostRule {
  id: number;
  cost_item_id: number;
  channel_id: string | null;
  product_id: number | null;
  rate: number | null;
  amount_per_pcs: number | null;
  amount_per_order: number | null;
  valid_from: string | null;
  valid_to: string | null;
  notes: string | null;
  is_active: boolean;
}

interface ChannelMonthlyCost {
  id: number;
  year: number;
  month: number;
  channel_id: string;
  channel_name: string;
  cost_item_id: number;
  amount: number;
  notes: string | null;
}

const BASIS_LABEL: Record<string, string> = {
  product_pcs: '낱개당 정액 (₩/낱개)',
  channel_revenue_rate: '채널 매출 정률 (%)',
  channel_monthly_fixed: '채널 월정액 (₩/월)',
  order_fixed: '주문당 정액 (₩/주문)',
  order_revenue_rate: '매출 정률 (%) — 주문 단위',
};

function CostTab({
  products, variableCosts, authHeaders, onUpdated, channels,
}: {
  products: Product[]; variableCosts: VariableCost[];
  authHeaders: () => HeadersInit; onUpdated: () => void;
  channels: Channel[];
}) {
  const [items, setItems] = useState<CostItem[]>([]);
  const [rules, setRules] = useState<CostRule[]>([]);
  const [monthly, setMonthly] = useState<ChannelMonthlyCost[]>([]);
  const [selectedItem, setSelectedItem] = useState<CostItem | null>(null);
  const [busy, setBusy] = useState(false);

  const fetchAll = useCallback(async () => {
    const [iRes, rRes, mRes] = await Promise.all([
      fetch(`${API_BASE}/api/csa/cost-items`, { headers: authHeaders() }),
      fetch(`${API_BASE}/api/csa/cost-rules`, { headers: authHeaders() }),
      fetch(`${API_BASE}/api/csa/channel-monthly-costs`, { headers: authHeaders() }),
    ]);
    if (iRes.ok) setItems(await iRes.json());
    if (rRes.ok) setRules(await rRes.json());
    if (mRes.ok) setMonthly(await mRes.json());
  }, [authHeaders]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const rulesForItem = (itemId: number) => rules.filter(r => r.cost_item_id === itemId);
  const monthlyForItem = (itemId: number) => monthly.filter(m => m.cost_item_id === itemId);

  // 변동비 항목별 색상
  const ITEM_COLOR: Record<string, string> = {
    cogs: '#EB5757', labor: '#FC7840', overhead: '#F0BF00',
    logistics_work: '#06B6D4', logistics_oh: '#00B8CC',
    advertising: '#A855F7', commission_rate: '#828FFF', commission_fixed: '#7070FF',
    shipping: '#27A644', packaging: '#68CC58',
  };

  return (
    <div className="space-y-4">
      {/* 안내 */}
      <div className={`${PANEL} p-4`}>
        <div className="flex items-baseline justify-between mb-2">
          <h2 className="text-sm font-semibold">변동비 8종 카테고리 — 공헌이익 계산 기준</h2>
          <span className="text-[10px] text-[#A3A9B3]">규칙 변경 시 즉시 daily 집계 재계산</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
          {items.map(it => {
            const r = rulesForItem(it.id);
            const m = monthlyForItem(it.id);
            const ruleCount = r.length;
            const monthlyCount = m.length;
            const isSel = selectedItem?.id === it.id;
            return (
              <button
                key={it.id}
                onClick={() => setSelectedItem(isSel ? null : it)}
                className={`text-left p-3 rounded-lg border transition-colors ${
                  isSel ? 'border-[#828FFF] bg-[#1A1C22]' : 'border-[#23252A] bg-[#08090A] hover:border-[#828FFF]/50'
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="w-2.5 h-2.5 rounded-sm" style={{ background: ITEM_COLOR[it.code] || '#828FFF' }} />
                  <div className="text-sm font-semibold text-[#F7F8F8]">{it.name}</div>
                </div>
                <div className="text-[10px] text-[#A3A9B3]">{BASIS_LABEL[it.basis] || it.basis}</div>
                <div className="text-[10px] text-[#7A7F8A] mt-1.5">
                  규칙 <span className="text-[#D0D6E0] font-mono">{ruleCount}</span>
                  {it.basis === 'channel_monthly_fixed' && (
                    <> · 월입력 <span className="text-[#D0D6E0] font-mono">{monthlyCount}</span></>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 선택된 항목의 규칙 편집 */}
      {selectedItem && (
        <CostRuleEditor
          item={selectedItem}
          rules={rulesForItem(selectedItem.id)}
          monthlyCosts={monthlyForItem(selectedItem.id)}
          channels={channels}
          products={products}
          authHeaders={authHeaders}
          onSaved={fetchAll}
          onClose={() => setSelectedItem(null)}
        />
      )}

      {/* 도움말 */}
      {!selectedItem && (
        <div className={`${PANEL} p-4 text-xs text-[#A3A9B3] leading-relaxed`}>
          <div className="font-semibold text-[#F7F8F8] mb-2">공헌이익 계산식</div>
          <div className="font-mono text-[11px] bg-[#08090A] border border-[#23252A] rounded p-2.5 text-[#D0D6E0]">
            공헌이익 = 순매출
            <br />&nbsp;&nbsp;− (낱개수량 × <span className="text-[#EB5757]">원가</span>)
            <br />&nbsp;&nbsp;− (낱개수량 × <span className="text-[#FC7840]">노무비</span>)
            <br />&nbsp;&nbsp;− (매출 × <span className="text-[#F0BF00]">제조간접비율</span>)
            <br />&nbsp;&nbsp;− (매출 × <span className="text-[#06B6D4]">물류작업비율</span> + 매출 × <span className="text-[#00B8CC]">물류간접비율</span>)
            <br />&nbsp;&nbsp;− <span className="text-[#A855F7]">광고비</span> (채널 월정액 → 일별 매출 비례 분배)
            <br />&nbsp;&nbsp;− (매출 × <span className="text-[#828FFF]">정률 수수료</span> + 주문건수 × <span className="text-[#7070FF]">정액 수수료</span>)
            <br />&nbsp;&nbsp;− (주문건수 × <span className="text-[#27A644]">운반비</span> + 주문건수 × <span className="text-[#68CC58]">포장비</span>)
          </div>
          <div className="mt-3 text-[11px]">
            우선순위: <span className="font-mono text-[#828FFF]">채널×품목 → 채널 → 품목 → 전역</span> (구체적인 규칙이 우선)
          </div>
        </div>
      )}
    </div>
  );
}

function CostRuleEditor({
  item, rules, monthlyCosts, channels, products, authHeaders, onSaved, onClose,
}: {
  item: CostItem;
  rules: CostRule[];
  monthlyCosts: ChannelMonthlyCost[];
  channels: Channel[];
  products: Product[];
  authHeaders: () => HeadersInit;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [newRule, setNewRule] = useState<Partial<CostRule>>({
    cost_item_id: item.id,
    channel_id: null, product_id: null,
    rate: null, amount_per_pcs: null, amount_per_order: null,
    valid_from: null, valid_to: null,
    is_active: true,
  });
  // 기간 적용 가능 항목 (정액 수수료, 포장비, 기타 모든 항목)
  const PERIOD_ELIGIBLE = ['commission_fixed', 'packaging', 'shipping', 'commission_rate', 'advertising'];
  const showPeriod = PERIOD_ELIGIBLE.includes(item.code);
  const [busy, setBusy] = useState(false);

  const saveRule = async () => {
    setBusy(true);
    try {
      const r = await fetch(`${API_BASE}/api/csa/cost-rules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          cost_item_id: item.id,
          channel_id: newRule.channel_id || null,
          product_id: newRule.product_id || null,
          rate: newRule.rate || null,
          amount_per_pcs: newRule.amount_per_pcs || null,
          amount_per_order: newRule.amount_per_order || null,
          valid_from: newRule.valid_from || null,
          valid_to: newRule.valid_to || null,
          notes: newRule.notes || null,
          is_active: true,
        }),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        alert(`규칙 저장 실패: ${data.detail || r.statusText}`);
        return;
      }
      setNewRule({
        cost_item_id: item.id, channel_id: null, product_id: null,
        rate: null, amount_per_pcs: null, amount_per_order: null,
        valid_from: null, valid_to: null, is_active: true,
      });
      onSaved();
    } finally { setBusy(false); }
  };

  const deleteRule = async (id: number) => {
    if (!confirm('이 규칙을 삭제하시겠습니까?')) return;
    await fetch(`${API_BASE}/api/csa/cost-rules/${id}`, {
      method: 'DELETE', headers: authHeaders(),
    });
    onSaved();
  };

  const channelName = (id: string | null) => id ? (channels.find(c => c.id === id)?.name || '?') : '전체 채널';
  const productName = (id: number | null) => id ? (products.find(p => p.id === id)?.name || '?') : '전체 품목';

  // basis별 입력 필드 결정
  const showRate = ['channel_revenue_rate', 'order_revenue_rate'].includes(item.basis);
  const showPcs = item.basis === 'product_pcs';
  const showOrder = item.basis === 'order_fixed' || item.code === 'shipping';
  // shipping은 둘 다 가능
  const showShippingBoth = item.code === 'shipping';

  return (
    <div className={`${PANEL} p-4`}>
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-sm font-semibold">
          {item.name} — 규칙 편집
          <span className="ml-2 text-[10px] text-[#A3A9B3] font-mono">{BASIS_LABEL[item.basis]}</span>
        </h3>
        <button onClick={onClose} className="text-[#A3A9B3] hover:text-[#F7F8F8] text-xs">✕ 닫기</button>
      </div>

      {item.description && <p className="text-xs text-[#A3A9B3] mb-3">{item.description}</p>}

      {/* 월정액 입력 (광고비) */}
      {item.basis === 'channel_monthly_fixed' && (
        <MonthlyCostEditor
          itemId={item.id}
          channels={channels}
          existing={monthlyCosts}
          authHeaders={authHeaders}
          onSaved={onSaved}
        />
      )}

      {/* 규칙 추가 (정률·정액) */}
      {item.basis !== 'channel_monthly_fixed' && (
        <div className={`${SUBPANEL} p-3 mb-3`}>
          <div className="text-[10px] uppercase tracking-wider text-[#A3A9B3] mb-2">+ 새 규칙 추가</div>
          <div className="grid grid-cols-1 md:grid-cols-6 gap-2 items-end">
            <div className="md:col-span-2">
              <label className="block text-[10px] text-[#7A7F8A] mb-1">채널 (선택 시 그 채널만)</label>
              <select
                value={newRule.channel_id || ''}
                onChange={(e) => setNewRule({ ...newRule, channel_id: e.target.value || null })}
                className="w-full bg-[#0F1011] border border-[#2E3138] rounded px-2 py-1.5 text-sm text-[#F7F8F8]"
              >
                <option value="">전체 채널</option>
                {channels.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="block text-[10px] text-[#7A7F8A] mb-1">품목 (선택 시 그 품목만)</label>
              <select
                value={newRule.product_id || ''}
                onChange={(e) => setNewRule({ ...newRule, product_id: e.target.value ? parseInt(e.target.value) : null })}
                className="w-full bg-[#0F1011] border border-[#2E3138] rounded px-2 py-1.5 text-sm text-[#F7F8F8]"
              >
                <option value="">전체 품목</option>
                {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            {showRate && (
              <div>
                <label className="block text-[10px] text-[#7A7F8A] mb-1">정률 (%)</label>
                <input
                  type="number" step="0.1"
                  value={newRule.rate != null ? newRule.rate * 100 : ''}
                  onChange={(e) => setNewRule({ ...newRule, rate: e.target.value ? parseFloat(e.target.value) / 100 : null })}
                  placeholder="5.0"
                  className="w-full bg-[#0F1011] border border-[#2E3138] rounded px-2 py-1.5 text-sm text-[#F7F8F8] font-mono text-right"
                />
              </div>
            )}
            {showPcs && (
              <div>
                <label className="block text-[10px] text-[#7A7F8A] mb-1">₩/낱개</label>
                <input
                  type="number"
                  value={newRule.amount_per_pcs || ''}
                  onChange={(e) => setNewRule({ ...newRule, amount_per_pcs: e.target.value ? parseFloat(e.target.value) : null })}
                  className="w-full bg-[#0F1011] border border-[#2E3138] rounded px-2 py-1.5 text-sm text-[#F7F8F8] font-mono text-right"
                />
              </div>
            )}
            {showOrder && (
              <div>
                <label className="block text-[10px] text-[#7A7F8A] mb-1">₩/주문</label>
                <input
                  type="number"
                  value={newRule.amount_per_order || ''}
                  onChange={(e) => setNewRule({ ...newRule, amount_per_order: e.target.value ? parseFloat(e.target.value) : null })}
                  className="w-full bg-[#0F1011] border border-[#2E3138] rounded px-2 py-1.5 text-sm text-[#F7F8F8] font-mono text-right"
                />
              </div>
            )}
            {showShippingBoth && !showRate && (
              <div>
                <label className="block text-[10px] text-[#7A7F8A] mb-1">또는 정률 (%)</label>
                <input
                  type="number" step="0.1"
                  value={newRule.rate != null ? newRule.rate * 100 : ''}
                  onChange={(e) => setNewRule({ ...newRule, rate: e.target.value ? parseFloat(e.target.value) / 100 : null })}
                  className="w-full bg-[#0F1011] border border-[#2E3138] rounded px-2 py-1.5 text-sm text-[#F7F8F8] font-mono text-right"
                />
              </div>
            )}
            <button
              onClick={saveRule} disabled={busy}
              className="px-3 py-1.5 bg-[#828FFF] hover:bg-[#7070FF] text-white rounded text-xs font-medium disabled:opacity-50"
            >{busy ? '저장…' : '+ 추가'}</button>
          </div>
          {/* 유효 기간 (시즌·행사 적용) */}
          {showPeriod && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3 pt-3 border-t border-[#23252A]">
              <div className="md:col-span-2 text-[10px] text-[#A3A9B3] flex items-center">
                <span className="font-mono text-[#828FFF]">시즌·기간 적용</span>
                <span className="ml-2">— 비워두면 상시 적용</span>
              </div>
              <div>
                <label className="block text-[10px] text-[#7A7F8A] mb-1">시작일</label>
                <input
                  type="date"
                  value={newRule.valid_from || ''}
                  onChange={(e) => setNewRule({ ...newRule, valid_from: e.target.value || null })}
                  className="w-full bg-[#0F1011] border border-[#2E3138] rounded px-2 py-1.5 text-sm text-[#F7F8F8]"
                />
              </div>
              <div>
                <label className="block text-[10px] text-[#7A7F8A] mb-1">종료일</label>
                <input
                  type="date"
                  value={newRule.valid_to || ''}
                  onChange={(e) => setNewRule({ ...newRule, valid_to: e.target.value || null })}
                  className="w-full bg-[#0F1011] border border-[#2E3138] rounded px-2 py-1.5 text-sm text-[#F7F8F8]"
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* 기존 규칙 리스트 */}
      {item.basis !== 'channel_monthly_fixed' && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-[#A3A9B3] mb-2">기존 규칙 ({rules.length})</div>
          {rules.length === 0 ? (
            <div className="text-xs text-[#7A7F8A] py-3">설정된 규칙이 없습니다. 위에서 추가하세요.</div>
          ) : (
            <div className="space-y-1.5">
              {rules.map(r => (
                <div key={r.id} className={`${SUBPANEL} p-2.5 flex items-center gap-3 text-xs`}>
                  <div className="flex-1 min-w-0">
                    <div className="text-[#F7F8F8] truncate">
                      <span className="text-[#A3A9B3]">대상:</span> {channelName(r.channel_id)} <span className="text-[#7A7F8A]">×</span> {productName(r.product_id)}
                    </div>
                    <div className="text-[10px] text-[#A3A9B3] font-mono mt-0.5">
                      {r.rate != null && <span>정률 {(r.rate * 100).toFixed(2)}%</span>}
                      {r.amount_per_pcs != null && <span> · ₩{fmtNum(r.amount_per_pcs)}/낱개</span>}
                      {r.amount_per_order != null && <span> · ₩{fmtNum(r.amount_per_order)}/주문</span>}
                      {(r.valid_from || r.valid_to) && (
                        <span className="ml-2 text-[#828FFF]">
                          [{r.valid_from || '시작 무제한'} ~ {r.valid_to || '종료 무제한'}]
                        </span>
                      )}
                    </div>
                  </div>
                  <button onClick={() => deleteRule(r.id)} className="text-[#EB5757] hover:underline text-xs">삭제</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MonthlyCostEditor({
  itemId, channels, existing, authHeaders, onSaved,
}: {
  itemId: number;
  channels: Channel[];
  existing: ChannelMonthlyCost[];
  authHeaders: () => HeadersInit;
  onSaved: () => void;
}) {
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;
  const [year, setYear] = useState(currentYear);
  const [month, setMonth] = useState(currentMonth);
  const [draft, setDraft] = useState<Record<string, number>>({});
  const [savingChannel, setSavingChannel] = useState<string | null>(null);

  const valueFor = (channelId: string) => {
    const v = existing.find(e => e.channel_id === channelId && e.year === year && e.month === month);
    return draft[channelId] !== undefined ? draft[channelId] : (v?.amount ?? 0);
  };

  const isDirty = (channelId: string) => {
    if (draft[channelId] === undefined) return false;
    const v = existing.find(e => e.channel_id === channelId && e.year === year && e.month === month);
    return draft[channelId] !== (v?.amount ?? 0);
  };

  const save = async (channel: Channel) => {
    const amount = draft[channel.id];
    if (amount === undefined) return;
    setSavingChannel(channel.id);
    try {
      await fetch(`${API_BASE}/api/csa/channel-monthly-costs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          year, month,
          channel_id: channel.id, channel_name: channel.name,
          cost_item_id: itemId, amount,
        }),
      });
      setDraft(d => { const nd = { ...d }; delete nd[channel.id]; return nd; });
      onSaved();
    } finally { setSavingChannel(null); }
  };

  return (
    <div className={`${SUBPANEL} p-3 mb-3`}>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[10px] uppercase tracking-wider text-[#A3A9B3]">기간:</span>
        <input type="number" value={year} onChange={(e) => setYear(parseInt(e.target.value) || currentYear)}
          className="w-20 bg-[#0F1011] border border-[#2E3138] rounded px-2 py-1 text-xs text-[#F7F8F8] font-mono text-center" />
        <span className="text-[#A3A9B3] text-xs">년</span>
        <select value={month} onChange={(e) => setMonth(parseInt(e.target.value))}
          className="bg-[#0F1011] border border-[#2E3138] rounded px-2 py-1 text-xs text-[#F7F8F8]">
          {Array.from({ length: 12 }).map((_, i) => <option key={i} value={i + 1}>{i + 1}월</option>)}
        </select>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-[500px] overflow-y-auto pr-1">
        {channels.map(c => {
          const v = valueFor(c.id);
          const dirty = isDirty(c.id);
          return (
            <div key={c.id} className="flex items-center gap-2 bg-[#0F1011] border border-[#23252A] rounded p-2 text-xs">
              <div className="flex-1 min-w-0 truncate text-[#F7F8F8]">{c.name}</div>
              <span className="text-[10px] text-[#7A7F8A]">₩</span>
              <input
                type="number"
                value={v || ''}
                onChange={(e) => setDraft(d => ({ ...d, [c.id]: parseFloat(e.target.value) || 0 }))}
                className="w-24 bg-[#08090A] border border-[#2E3138] rounded px-1.5 py-1 text-[#F7F8F8] font-mono text-right"
              />
              <button
                onClick={() => save(c)}
                disabled={savingChannel === c.id || !dirty}
                className={`px-2 py-1 rounded text-[10px] font-medium ${
                  dirty ? 'bg-[#828FFF] text-white hover:bg-[#7070FF]' : 'bg-[#1A1B1F] text-[#7A7F8A]'
                } disabled:opacity-50`}
              >{savingChannel === c.id ? '…' : dirty ? '저장' : '✓'}</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Plan Tab — 사업계획 업로드 + vs 실적 비교 + 객단가
// ──────────────────────────────────────────────────────────────

type CompareBy = 'channel' | 'product' | 'group' | 'employee';

function PlanTab({
  authHeaders, channels, products,
}: {
  authHeaders: () => HeadersInit; channels: Channel[]; products: Product[];
}) {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [month, setMonth] = useState<number | ''>('');
  const [upToToday, setUpToToday] = useState(false);
  const [by, setBy] = useState<CompareBy>('channel');
  const [planSummary, setPlanSummary] = useState<any | null>(null);
  const [comparison, setComparison] = useState<any | null>(null);
  const [avgPrice, setAvgPrice] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const fetchData = useCallback(async () => {
    setBusy(true);
    try {
      const sumRes = await fetch(`${API_BASE}/api/csa/plan/summary?year=${year}`, { headers: authHeaders() });
      if (sumRes.ok) setPlanSummary(await sumRes.json());

      const params = new URLSearchParams({ year: String(year), by });
      if (upToToday) params.set('up_to_today', 'true');
      else if (month) params.set('month', String(month));
      const cmpRes = await fetch(`${API_BASE}/api/csa/plan/comparison?${params}`, { headers: authHeaders() });
      if (cmpRes.ok) setComparison(await cmpRes.json());

      // 객단가는 현재 연도/월 실적 범위
      const today = new Date();
      const start = `${year}-01-01`;
      let end: string;
      if (upToToday) {
        end = today.toISOString().slice(0, 10);
      } else if (month) {
        const lastDay = new Date(year, month, 0).getDate();
        end = `${year}-${String(month).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`;
      } else {
        end = `${year}-12-31`;
      }
      const startFinal = (upToToday || !month) ? `${year}-01-01` : `${year}-${String(month).padStart(2,'0')}-01`;
      const apRes = await fetch(
        `${API_BASE}/api/csa/avg-price?period_start=${startFinal}&period_end=${end}&by=channel_product`,
        { headers: authHeaders() }
      );
      if (apRes.ok) setAvgPrice(await apRes.json());
    } finally {
      setBusy(false);
    }
  }, [authHeaders, year, month, by, upToToday]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const upload = async (file: File) => {
    setBusy(true); setUploadMsg(null);
    try {
      const fd = new FormData();
      fd.append('year', String(year));
      fd.append('file', file);
      const r = await fetch(`${API_BASE}/api/csa/plan/upload`, {
        method: 'POST', headers: authHeaders(), body: fd,
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail || 'upload failed');
      setUploadMsg(
        `${data.status === 'done' ? '✓' : '⚠'} 매출 ${data.revenue_rows}행 · 수량 ${data.qty_rows}행 · 품목류 ${data.category_rows}행 · 그룹 ${data.summary_rows}행`
      );
      fetchData();
    } catch (e: any) {
      setUploadMsg(`❌ ${e.message || e}`);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const items = comparison?.items || [];
  const totalActual = items.reduce((s: number, it: any) => s + (it.actual_revenue || 0), 0);
  const totalTarget = items.reduce((s: number, it: any) => s + (it.target_revenue || 0), 0);
  const totalAchRev = totalTarget ? (totalActual / totalTarget * 100) : 0;

  return (
    <div className="space-y-5">
      {/* 업로드 + 필터 */}
      <div className={`${PANEL} p-5`}>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div>
            <h2 className="text-sm font-semibold mb-2">사업계획 엑셀 업로드</h2>
            <p className="text-xs text-[#62666D] mb-3 leading-relaxed">
              4개 시트 자동 인식: <span className="font-mono text-[#828FFF]">채널별 매출 대시보드 · 채널별 판매수량 · 판매수량 대시보드 · 대시보드(그룹 요약)</span>. 담당자·구분(위탁/사입/오프라인)·직원-채널 매핑이 자동 생성됩니다.
            </p>
            <div className="flex items-end gap-2">
              <div>
                <label className="text-[10px] uppercase tracking-wider text-[#62666D] block mb-1">연도</label>
                <input
                  type="number" value={year}
                  onChange={(e) => setYear(parseInt(e.target.value) || currentYear)}
                  className="w-24 bg-[#08090A] border border-[#23252A] rounded px-2 py-1.5 text-sm text-[#F7F8F8] font-mono"
                />
              </div>
              <input
                ref={fileRef}
                type="file" accept=".xlsx,.xls,.csv,.pdf"
                onChange={(e) => e.target.files && e.target.files[0] && upload(e.target.files[0])}
                disabled={busy}
                className="flex-1 text-sm text-[#D0D6E0] file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:bg-[#828FFF] file:text-white file:cursor-pointer hover:file:bg-[#7070FF] disabled:opacity-50"
              />
            </div>
            {uploadMsg && (
              <div className="mt-3 text-xs font-mono text-[#D0D6E0] bg-[#08090A] border border-[#23252A] rounded p-2">{uploadMsg}</div>
            )}
          </div>

          <div>
            <h2 className="text-sm font-semibold mb-2">비교 필터</h2>
            <div className="flex flex-wrap gap-2 items-end">
              <div>
                <label className="text-[10px] uppercase tracking-wider text-[#62666D] block mb-1">월</label>
                <select
                  value={month}
                  disabled={upToToday}
                  onChange={(e) => setMonth(e.target.value === '' ? '' : parseInt(e.target.value))}
                  className="bg-[#08090A] border border-[#23252A] rounded px-2 py-1.5 text-sm text-[#F7F8F8] disabled:opacity-40"
                >
                  <option value="">전체(연간)</option>
                  {Array.from({ length: 12 }).map((_, i) => (
                    <option key={i} value={i + 1}>{i + 1}월</option>
                  ))}
                </select>
              </div>
              <button
                onClick={() => {
                  setUpToToday(v => {
                    const next = !v;
                    if (next) setMonth('');
                    return next;
                  });
                }}
                className={`px-3 py-1.5 rounded text-xs font-medium border transition-colors ${
                  upToToday
                    ? 'bg-[#828FFF] border-[#828FFF] text-white'
                    : 'bg-[#08090A] border-[#23252A] text-[#A3A9B3] hover:border-[#828FFF] hover:text-[#F7F8F8]'
                }`}
                title="1월 1일부터 오늘까지 누계 분석 (계획은 오늘 기준 일자 비율로 안분)"
              >
                {upToToday ? '✓ 오늘 기준 YTD' : '오늘 기준 YTD'}
              </button>
              <Segment
                label="기준"
                options={[
                  { v: 'channel', l: '채널' },
                  { v: 'product', l: '품목' },
                  { v: 'group', l: '구분(3종)' },
                  { v: 'employee', l: '담당자' },
                ]}
                value={by}
                onChange={setBy}
              />
            </div>
            {upToToday && (
              <p className="text-[11px] text-[#828FFF] mt-2">
                1/1 ~ {new Date().toISOString().slice(0,10)} 누계 분석. 계획은 마지막 월(이번 달)을 오늘 일자 비율로 안분.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* 사업계획 요약 KPI */}
      {planSummary && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <KpiCard label={`${year}년 연간 목표 매출`} value={`₩${fmtKR(planSummary.total_revenue_target)}`} hint={`낱개 목표 ${fmtNum(Math.round(planSummary.total_pcs_target))}개`} accent="#828FFF" />
          <KpiCard label="실적 매출 (선택 기준)" value={`₩${fmtKR(totalActual)}`} hint={`목표 대비 ${fmtPct(totalAchRev)}`} accent={totalAchRev >= 100 ? '#27A644' : '#F0BF00'} />
          <KpiCard label="달성률" value={fmtPct(totalAchRev)} hint={`목표 ₩${fmtKR(totalTarget)} / 실적 ₩${fmtKR(totalActual)}`} accent={totalAchRev >= 100 ? '#27A644' : '#EB5757'} />
        </div>
      )}

      {/* 구분별 도넛 + 담당자별 바 */}
      {planSummary && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className={`${PANEL} p-5`}>
            <h3 className="text-sm font-semibold mb-3">구분별 목표 매출 분포</h3>
            {planSummary.by_group.length ? (
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie
                    data={planSummary.by_group}
                    dataKey="target_revenue"
                    nameKey="group"
                    cx="50%" cy="50%" innerRadius={50} outerRadius={90} paddingAngle={2}
                  >
                    {planSummary.by_group.map((_: any, i: number) => (
                      <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={TOOLTIP_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} itemStyle={TOOLTIP_ITEM_STYLE}
                    formatter={(v: number, n: string) => [`₩${fmtKR(v)}`, n]}
                  />
                  <Legend wrapperStyle={{ fontSize: 10, color: '#8A8F98' }} />
                </PieChart>
              </ResponsiveContainer>
            ) : <Empty />}
          </div>

          <div className={`${PANEL} p-5`}>
            <h3 className="text-sm font-semibold mb-3">담당자별 목표 매출</h3>
            {planSummary.by_employee.length ? (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={planSummary.by_employee} layout="vertical" margin={{ left: 60 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#23252A" />
                  <XAxis type="number" tick={{ fill: '#8A8F98', fontSize: 11 }} tickFormatter={fmtKR} stroke="#62666D" />
                  <YAxis type="category" dataKey="employee" tick={{ fill: '#8A8F98', fontSize: 11 }} stroke="#62666D" width={70} />
                  <Tooltip
                    contentStyle={TOOLTIP_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} itemStyle={TOOLTIP_ITEM_STYLE}
                    formatter={(v: number) => `₩${fmtKR(v)}`}
                  />
                  <Bar dataKey="target_revenue" fill="#828FFF" />
                </BarChart>
              </ResponsiveContainer>
            ) : <Empty />}
          </div>
        </div>
      )}

      {/* 비교 차트 (컴팩트) */}
      <div className={`${PANEL} p-4`}>
        <div className="flex items-baseline justify-between mb-2">
          <h3 className="text-sm font-semibold">
            {by === 'channel' ? '채널' : by === 'product' ? '품목' : by === 'group' ? '구분' : '담당자'}별 — 사업계획 vs 실적
          </h3>
          <span className="text-[10px] text-[#7A7F8A]">Top 15 · 매출 기준</span>
        </div>
        {busy ? <Skeleton h={260} /> : items.length ? (
          (() => {
            const top = [...items]
              .sort((a: any, b: any) => (b.target_revenue || 0) - (a.target_revenue || 0))
              .slice(0, 15);
            const chartH = Math.min(360, Math.max(180, top.length * 22));
            return (
              <ResponsiveContainer width="100%" height={chartH}>
                <BarChart data={top} layout="vertical" margin={{ left: 90, right: 12, top: 4, bottom: 4 }} barCategoryGap={3}>
                  <defs>
                    <linearGradient id="gradPlanTarget" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor="#3A3D45" stopOpacity={0.6} />
                      <stop offset="100%" stopColor="#7A7F8A" stopOpacity={0.85} />
                    </linearGradient>
                    <linearGradient id="gradPlanActual" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor="#5560C8" stopOpacity={0.85} />
                      <stop offset="100%" stopColor="#A8B3FF" stopOpacity={1} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#23252A" />
                  <XAxis type="number" tick={{ fill: '#8A8F98', fontSize: 10 }} tickFormatter={fmtKR} stroke="#62666D" />
                  <YAxis type="category" dataKey="label" tick={{ fill: '#A3A9B3', fontSize: 10 }} stroke="#62666D" width={120} />
                  <Tooltip
                    contentStyle={TOOLTIP_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} itemStyle={TOOLTIP_ITEM_STYLE}
                    formatter={(v: number, n: string) => [`₩${fmtKR(v)}`, n]}
                  />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Bar dataKey="target_revenue" name="계획 매출" fill="url(#gradPlanTarget)" radius={[0, 4, 4, 0]} barSize={9} />
                  <Bar dataKey="actual_revenue" name="실적 매출" fill="url(#gradPlanActual)" radius={[0, 4, 4, 0]} barSize={9} />
                </BarChart>
              </ResponsiveContainer>
            );
          })()
        ) : <Empty />}
      </div>

      {/* 상세 테이블 */}
      <div className={`${PANEL} p-5`}>
        <h3 className="text-sm font-semibold mb-3">상세 — 계획·실적·달성률·객단가</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#23252A] text-[11px] uppercase tracking-wider text-[#62666D]">
                <th className="text-left py-2 px-2">대상</th>
                <th className="text-right py-2 px-2">계획 매출</th>
                <th className="text-right py-2 px-2">실적 매출</th>
                <th className="text-right py-2 px-2">매출 달성률</th>
                <th className="text-right py-2 px-2">계획 수량(낱개)</th>
                <th className="text-right py-2 px-2">실적 수량(낱개)</th>
                <th className="text-right py-2 px-2">수량 달성률</th>
                <th className="text-right py-2 px-2">계획 객단가</th>
                <th className="text-right py-2 px-2">실적 객단가</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr><td colSpan={9} className="py-6 text-center text-[#62666D]">사업계획 또는 실적 데이터가 없습니다.</td></tr>
              ) : items.map((it: any, idx: number) => (
                <tr key={`${it.key}-${idx}`} className="border-b border-[#1A1B1F] hover:bg-[#1A1C22]">
                  <td className="py-1.5 px-2 text-[#F7F8F8]">{it.label}</td>
                  <td className="py-1.5 px-2 text-right font-mono text-[#8A8F98]">₩{fmtKR(it.target_revenue)}</td>
                  <td className="py-1.5 px-2 text-right font-mono text-[#F7F8F8]">₩{fmtKR(it.actual_revenue)}</td>
                  <td className={`py-1.5 px-2 text-right font-mono ${it.rev_ach == null ? 'text-[#62666D]' : it.rev_ach >= 100 ? 'text-[#27A644]' : it.rev_ach >= 80 ? 'text-[#F0BF00]' : 'text-[#EB5757]'}`}>
                    {it.rev_ach == null ? '—' : fmtPct(it.rev_ach)}
                  </td>
                  <td className="py-1.5 px-2 text-right font-mono text-[#8A8F98]">{fmtNum(Math.round(it.target_pcs))}</td>
                  <td className="py-1.5 px-2 text-right font-mono text-[#D0D6E0]">{fmtNum(Math.round(it.actual_pcs))}</td>
                  <td className={`py-1.5 px-2 text-right font-mono ${it.pcs_ach == null ? 'text-[#62666D]' : it.pcs_ach >= 100 ? 'text-[#27A644]' : it.pcs_ach >= 80 ? 'text-[#F0BF00]' : 'text-[#EB5757]'}`}>
                    {it.pcs_ach == null ? '—' : fmtPct(it.pcs_ach)}
                  </td>
                  <td className="py-1.5 px-2 text-right font-mono text-[#8A8F98]">{it.target_avg_price ? `₩${fmtKR(it.target_avg_price)}` : '—'}</td>
                  <td className="py-1.5 px-2 text-right font-mono text-[#828FFF]">{it.actual_avg_price ? `₩${fmtKR(it.actual_avg_price)}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 객단가 분석 */}
      {avgPrice && avgPrice.items.length > 0 && (
        <div className={`${PANEL} p-5`}>
          <h3 className="text-sm font-semibold mb-3">채널×품목 객단가 (실적 기준, Top 20)</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#23252A] text-[11px] uppercase tracking-wider text-[#62666D]">
                  <th className="text-left py-2 px-2">채널 × 품목</th>
                  <th className="text-right py-2 px-2">순매출</th>
                  <th className="text-right py-2 px-2">낱개수량</th>
                  <th className="text-right py-2 px-2">주문건수</th>
                  <th className="text-right py-2 px-2">낱개당 객단가</th>
                  <th className="text-right py-2 px-2">주문당 객단가</th>
                </tr>
              </thead>
              <tbody>
                {avgPrice.items.slice(0, 20).map((it: any, i: number) => (
                  <tr key={i} className="border-b border-[#1A1B1F] hover:bg-[#1A1C22]">
                    <td className="py-1.5 px-2 text-[#F7F8F8]">{it.label}</td>
                    <td className="py-1.5 px-2 text-right font-mono text-[#F7F8F8]">₩{fmtKR(it.revenue)}</td>
                    <td className="py-1.5 px-2 text-right font-mono text-[#D0D6E0]">{fmtNum(Math.round(it.pcs))}</td>
                    <td className="py-1.5 px-2 text-right font-mono text-[#D0D6E0]">{fmtNum(it.orders)}</td>
                    <td className="py-1.5 px-2 text-right font-mono text-[#828FFF]">₩{fmtKR(it.avg_price_per_pcs)}</td>
                    <td className="py-1.5 px-2 text-right font-mono text-[#828FFF]">₩{fmtKR(it.avg_price_per_order)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Admin Tab — 직원 관리 + 담당 채널 배정 + 채널 그룹 매핑
// ──────────────────────────────────────────────────────────────

interface Employee {
  id: number;
  email: string;
  name: string;
  role: string;
  is_active: boolean;
  channels: Array<{ channel_id: string; channel_name: string; is_active: boolean }>;
}

interface Group {
  id: number;
  code: string;
  name: string;
  big_group: string;
  channels: Array<{ channel_id: string; channel_name: string }>;
}

function AdminTab({
  authHeaders, channels, userEmail,
}: {
  authHeaders: () => HeadersInit; channels: Channel[]; userEmail: string;
}) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [editingEmp, setEditingEmp] = useState<Partial<Employee> | null>(null);
  const [assignTarget, setAssignTarget] = useState<Employee | null>(null);
  const [pendingChannels, setPendingChannels] = useState<string[]>([]);
  const [storage, setStorage] = useState<any | null>(null);
  const [adminBusy, setAdminBusy] = useState<string | null>(null);
  const [adminMsg, setAdminMsg] = useState<string | null>(null);

  const fetchStorage = useCallback(async () => {
    const r = await fetch(`${API_BASE}/api/csa/admin/storage`, { headers: authHeaders() });
    if (r.ok) setStorage(await r.json());
  }, [authHeaders]);

  const runAdmin = async (endpoint: string, label: string) => {
    setAdminBusy(label); setAdminMsg(null);
    try {
      const r = await fetch(`${API_BASE}/api/csa/admin/${endpoint}`, {
        method: 'POST', headers: authHeaders(),
      });
      const data = await r.json();
      setAdminMsg(`${label}: ${JSON.stringify(data)}`);
      await fetchStorage();
    } catch (e: any) {
      setAdminMsg(`${label} 실패: ${e.message || e}`);
    } finally {
      setAdminBusy(null);
    }
  };

  const fetchAll = useCallback(async () => {
    const [eRes, gRes] = await Promise.all([
      fetch(`${API_BASE}/api/csa/employees`, { headers: authHeaders() }),
      fetch(`${API_BASE}/api/csa/groups`, { headers: authHeaders() }),
    ]);
    if (eRes.ok) setEmployees(await eRes.json());
    if (gRes.ok) setGroups(await gRes.json());
    await fetchStorage();
  }, [authHeaders, fetchStorage]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const saveEmployee = async () => {
    if (!editingEmp || !editingEmp.email || !editingEmp.name) {
      alert('이메일과 이름을 모두 입력해 주세요'); return;
    }
    try {
      const r = await fetch(`${API_BASE}/api/csa/employees`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          email: editingEmp.email,
          name: editingEmp.name,
          role: editingEmp.role || 'staff',
          is_active: editingEmp.is_active !== false,
        }),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        alert(`저장 실패: ${data.detail || r.statusText}`);
        return;
      }
      setEditingEmp(null);
      fetchAll();
    } catch (e: any) {
      alert(`저장 실패: ${e.message || e}`);
    }
  };

  const deleteEmployee = async (id: number) => {
    const emp = employees.find(e => e.id === id);
    if (!emp) return;
    if (!confirm(`'${emp.name}' 직원을 삭제하시겠습니까?\n· 담당 채널 배정이 해제됩니다.\n· 사업계획 매출 행은 보존되되 담당자가 미배정으로 바뀝니다.`)) return;
    try {
      const r = await fetch(`${API_BASE}/api/csa/employees/${id}`, {
        method: 'DELETE', headers: authHeaders(),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        alert(`삭제 실패: ${data.detail || r.statusText || '알 수 없는 오류'}`);
        return;
      }
      fetchAll();
    } catch (e: any) {
      alert(`삭제 실패: ${e.message || e}`);
    }
  };

  const openAssign = (e: Employee) => {
    setAssignTarget(e);
    setPendingChannels(e.channels.map(c => c.channel_id));
  };

  const saveAssign = async () => {
    if (!assignTarget) return;
    try {
      const r = await fetch(`${API_BASE}/api/csa/employees/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          employee_id: assignTarget.id,
          channel_ids: pendingChannels,
        }),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        alert(`채널 배정 저장 실패: ${data.detail || r.statusText}`);
        return;
      }
      setAssignTarget(null); setPendingChannels([]);
      fetchAll();
    } catch (e: any) {
      alert(`저장 실패: ${e.message || e}`);
    }
  };

  const setChannelGroup = async (channelId: string, groupId: number) => {
    try {
      const r = await fetch(`${API_BASE}/api/csa/groups/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ channel_id: channelId, group_id: groupId }),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        alert(`구분 변경 실패: ${data.detail || r.statusText}`);
        return;
      }
      fetchAll();
    } catch (e: any) {
      alert(`구분 변경 실패: ${e.message || e}`);
    }
  };

  // 채널 → 현재 그룹 매핑
  const channelGroupMap = useMemo(() => {
    const m: Record<string, number> = {};
    groups.forEach(g => g.channels.forEach(c => { m[c.channel_id] = g.id; }));
    return m;
  }, [groups]);

  // Supabase Pro 8GB 한도
  const SUPABASE_LIMIT_BYTES = 8 * 1024 * 1024 * 1024;
  const dbBytes = storage?.db_size?.bytes || 0;
  const dbPct = (dbBytes / SUPABASE_LIMIT_BYTES) * 100;
  const dbBarColor = dbPct < 60 ? '#27A644' : dbPct < 85 ? '#F0BF00' : '#EB5757';

  // P&L 비밀번호 상태
  const [pwStatus, setPwStatus] = useState<{ is_set: boolean; owner_email: string } | null>(null);
  const [newPw, setNewPw] = useState('');
  const [pwMsg, setPwMsg] = useState<string | null>(null);
  const isOwner = userEmail.toLowerCase() === (pwStatus?.owner_email || 'lion9080@joinandjoin.com').toLowerCase();

  const fetchPwStatus = useCallback(async () => {
    const r = await fetch(`${API_BASE}/api/csa/pnl/password-status`, { headers: authHeaders() });
    if (r.ok) setPwStatus(await r.json());
  }, [authHeaders]);

  useEffect(() => { fetchPwStatus(); }, [fetchPwStatus]);

  const savePw = async () => {
    if (!newPw || newPw.length < 4) { setPwMsg('비밀번호는 4자 이상 입력해 주세요'); return; }
    try {
      const r = await fetch(`${API_BASE}/api/csa/pnl/password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ new_password: newPw, user_email: userEmail }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail || '저장 실패');
      setPwMsg('✓ 비밀번호가 저장되었습니다');
      setNewPw('');
      fetchPwStatus();
    } catch (e: any) {
      setPwMsg(`❌ ${e.message || e}`);
    }
  };

  return (
    <div className="space-y-5">
      {/* P&L 비밀번호 설정 (관리자) */}
      <div className={`${PANEL} p-5`}>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold">월별 P&L 차트 수정 비밀번호</h2>
          <span className={`text-[10px] px-2 py-0.5 rounded font-medium ${
            pwStatus?.is_set ? 'bg-[#27A644]/15 text-[#27A644]' : 'bg-[#F0BF00]/15 text-[#F0BF00]'
          }`}>{pwStatus?.is_set ? '설정 완료' : '미설정'}</span>
        </div>
        <p className="text-xs text-[#A3A9B3] mb-3">
          P&L 차트의 셀 값을 수정하려면 비밀번호가 필요합니다. 비밀번호는 <span className="font-mono text-[#828FFF]">{pwStatus?.owner_email || 'lion9080@joinandjoin.com'}</span> 계정으로만 설정·변경할 수 있습니다.
        </p>
        {isOwner ? (
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label className="text-[10px] uppercase tracking-wider text-[#A3A9B3] block mb-1">새 비밀번호</label>
              <input
                type="password" value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
                placeholder="4자 이상"
                className="w-full bg-[#08090A] border border-[#2E3138] rounded px-3 py-1.5 text-sm text-[#F7F8F8]"
              />
            </div>
            <button
              onClick={savePw}
              className="px-4 py-1.5 bg-[#828FFF] hover:bg-[#7070FF] text-white rounded text-xs font-medium"
            >저장</button>
          </div>
        ) : (
          <div className="text-xs text-[#A3A9B3] bg-[#08090A] border border-[#23252A] rounded p-3">
            현재 로그인: <span className="font-mono text-[#D0D6E0]">{userEmail || '로그인 정보 없음'}</span><br/>
            비밀번호 설정 권한이 없습니다. {pwStatus?.owner_email}로 로그인해 주세요.
          </div>
        )}
        {pwMsg && <div className="mt-2 text-[11px] text-[#D0D6E0]">{pwMsg}</div>}
      </div>

      {/* 저장소 관리 */}
      <div className={`${PANEL} p-5`}>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-sm font-semibold">저장소 관리 — 보존 정책 + 월 파티션</h2>
            <p className="text-xs text-[#62666D] mt-1">
              30일 후 원본 JSON 비우기 · 24개월 hot + 5년 cold 압축 · resolved 매핑 6개월 후 삭제 · 매일 02:00 KST 자동 실행.
            </p>
          </div>
          <div className="flex gap-1.5">
            <button
              onClick={() => runAdmin('setup-retention', 'retention 등록')}
              disabled={adminBusy !== null}
              className="px-3 py-1.5 bg-[#1A1B1F] hover:bg-[#23252A] text-[#D0D6E0] rounded text-xs"
            >{adminBusy === 'retention 등록' ? '실행 중…' : 'retention 재등록'}</button>
            <button
              onClick={() => runAdmin('migrate-partitions', '파티션 마이그레이션')}
              disabled={adminBusy !== null}
              className="px-3 py-1.5 bg-[#F0BF00] hover:bg-[#D9A800] text-[#08090A] rounded text-xs font-medium"
            >{adminBusy === '파티션 마이그레이션' ? '실행 중…' : '파티션 전환'}</button>
            <button
              onClick={() => runAdmin('run-retention-now', '즉시 실행')}
              disabled={adminBusy !== null}
              className="px-3 py-1.5 bg-[#828FFF] hover:bg-[#7070FF] text-white rounded text-xs font-medium"
            >{adminBusy === '즉시 실행' ? '실행 중…' : '지금 실행'}</button>
          </div>
        </div>

        {storage && (
          <>
            {/* DB 사용량 게이지 */}
            <div className={`${SUBPANEL} p-4 mb-3`}>
              <div className="flex items-baseline justify-between mb-2">
                <span className="text-xs font-mono uppercase tracking-wider text-[#62666D]">SUPABASE DB 사용량</span>
                <span className="text-sm font-mono text-[#F7F8F8]">
                  {storage.db_size?.s || '?'} <span className="text-[#62666D]">/ 8 GB ({dbPct.toFixed(1)}%)</span>
                </span>
              </div>
              <div className="h-2 bg-[#0F1011] rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, dbPct)}%`, background: dbBarColor }} />
              </div>
            </div>

            {/* 상태 카드 */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
              <div className={`${SUBPANEL} p-3`}>
                <div className="text-[10px] uppercase tracking-wider text-[#62666D] mb-1">월 파티션</div>
                <div className="text-base font-mono text-[#F7F8F8]">
                  {storage.is_partitioned ? `✓ 활성 (${storage.partitions?.length || 0}개월)` : '단일 테이블 (전환 가능)'}
                </div>
              </div>
              <div className={`${SUBPANEL} p-3`}>
                <div className="text-[10px] uppercase tracking-wider text-[#62666D] mb-1">pg_cron 스케줄</div>
                <div className="text-base font-mono text-[#F7F8F8]">
                  {(storage.cron_jobs?.length || 0)}개 등록
                </div>
                {storage.cron_jobs?.map((j: any, i: number) => (
                  <div key={i} className="text-[10px] text-[#62666D] mt-0.5">
                    {j.jobname} · {j.schedule} {j.active ? '✓' : '✗'}
                  </div>
                ))}
              </div>
              <div className={`${SUBPANEL} p-3`}>
                <div className="text-[10px] uppercase tracking-wider text-[#62666D] mb-1">최근 retention 실행</div>
                <div className="text-base font-mono text-[#F7F8F8]">
                  {storage.recent_runs?.[0]?.ran_at ? new Date(storage.recent_runs[0].ran_at).toLocaleString('ko-KR') : '없음'}
                </div>
              </div>
            </div>

            {/* 테이블별 용량 */}
            {storage.tables?.length > 0 && (
              <details className={`${SUBPANEL} p-3 mb-2`}>
                <summary className="text-xs cursor-pointer text-[#D0D6E0]">CSA 테이블별 용량 ({storage.tables.length}개)</summary>
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-[#23252A] text-[10px] uppercase tracking-wider text-[#62666D]">
                        <th className="text-left py-1.5 px-2">테이블</th>
                        <th className="text-right py-1.5 px-2">용량</th>
                        <th className="text-right py-1.5 px-2">행 수 (추정)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {storage.tables.map((t: any) => (
                        <tr key={t.table_name} className="border-b border-[#1A1B1F]">
                          <td className="py-1 px-2 font-mono text-[#D0D6E0]">{t.table_name}</td>
                          <td className="py-1 px-2 text-right font-mono text-[#F7F8F8]">{t.pretty_size}</td>
                          <td className="py-1 px-2 text-right font-mono text-[#8A8F98]">{(t.est_rows || 0).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}

            {/* 파티션 리스트 */}
            {storage.is_partitioned && storage.partitions?.length > 0 && (
              <details className={`${SUBPANEL} p-3 mb-2`}>
                <summary className="text-xs cursor-pointer text-[#D0D6E0]">월 파티션 ({storage.partitions.length}개)</summary>
                <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-1.5">
                  {storage.partitions.map((p: any) => (
                    <div key={p.partition_name} className="text-[10px] font-mono text-[#D0D6E0] bg-[#0F1011] border border-[#23252A] rounded px-2 py-1">
                      {p.partition_name.replace('csa_sales_raw_lines_', '')}
                      <span className="text-[#62666D] ml-1">· {p.pretty_size}</span>
                    </div>
                  ))}
                </div>
              </details>
            )}

            {/* 최근 실행 로그 */}
            {storage.recent_runs?.length > 0 && (
              <details className={`${SUBPANEL} p-3`}>
                <summary className="text-xs cursor-pointer text-[#D0D6E0]">최근 retention 실행 로그 ({storage.recent_runs.length}건)</summary>
                <div className="mt-2 space-y-1 text-[10px] font-mono">
                  {storage.recent_runs.map((r: any, i: number) => (
                    <div key={i} className="text-[#8A8F98]">
                      <span className="text-[#D0D6E0]">{new Date(r.ran_at).toLocaleString('ko-KR')}</span> ·
                      raw_clear {r.result?.cleared_raw_row ?? 0} · archive {r.result?.archived_lines ?? 0}행/{r.result?.archived_months ?? 0}개월 ·
                      5y삭제 {r.result?.purged_archive_5y ?? 0} · 매핑정리 {r.result?.purged_unmatched_6m ?? 0}
                    </div>
                  ))}
                </div>
              </details>
            )}
          </>
        )}

        {adminMsg && (
          <div className="mt-3 text-[11px] font-mono text-[#D0D6E0] bg-[#08090A] border border-[#23252A] rounded p-2 break-all">{adminMsg}</div>
        )}
      </div>

      {/* 직원 관리 */}
      <div className={`${PANEL} p-5`}>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-sm font-semibold">직원 관리</h2>
            <p className="text-xs text-[#62666D] mt-1">직원 이메일(로그인용)·이름·역할 등록. 사업계획 업로드 시 직원이 자동 생성되며, 이메일을 실제 로그인 이메일로 수정해 주세요.</p>
          </div>
          <button
            onClick={() => setEditingEmp({ email: '', name: '', role: 'staff', is_active: true })}
            className="px-3 py-1.5 bg-[#828FFF] hover:bg-[#7070FF] text-white rounded text-xs font-medium"
          >
            + 직원 추가
          </button>
        </div>

        {editingEmp && (
          <div className={`${SUBPANEL} p-3 mb-4`}>
            <div className="grid grid-cols-1 md:grid-cols-5 gap-2 items-end">
              <div className="md:col-span-2">
                <label className="text-[10px] uppercase tracking-wider text-[#62666D] block mb-1">이메일</label>
                <input
                  type="email" value={editingEmp.email || ''}
                  onChange={(e) => setEditingEmp({ ...editingEmp, email: e.target.value })}
                  className="w-full bg-[#0F1011] border border-[#23252A] rounded px-2 py-1.5 text-sm text-[#F7F8F8]"
                  placeholder="example@joinnjoin.com"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-[#62666D] block mb-1">이름</label>
                <input
                  type="text" value={editingEmp.name || ''}
                  onChange={(e) => setEditingEmp({ ...editingEmp, name: e.target.value })}
                  className="w-full bg-[#0F1011] border border-[#23252A] rounded px-2 py-1.5 text-sm text-[#F7F8F8]"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-[#62666D] block mb-1">역할</label>
                <select
                  value={editingEmp.role || 'staff'}
                  onChange={(e) => setEditingEmp({ ...editingEmp, role: e.target.value })}
                  className="w-full bg-[#0F1011] border border-[#23252A] rounded px-2 py-1.5 text-sm text-[#F7F8F8]"
                >
                  <option value="admin">관리자</option>
                  <option value="manager">매니저</option>
                  <option value="staff">담당자</option>
                </select>
              </div>
              <div className="flex gap-1.5">
                <button onClick={saveEmployee} className="px-3 py-1.5 bg-[#828FFF] hover:bg-[#7070FF] text-white rounded text-xs font-medium">저장</button>
                <button onClick={() => setEditingEmp(null)} className="px-3 py-1.5 bg-[#1A1B1F] hover:bg-[#23252A] text-[#D0D6E0] rounded text-xs">취소</button>
              </div>
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#23252A] text-[11px] uppercase tracking-wider text-[#62666D]">
                <th className="text-left py-2 px-2">이름</th>
                <th className="text-left py-2 px-2">이메일</th>
                <th className="text-left py-2 px-2">역할</th>
                <th className="text-left py-2 px-2">담당 채널</th>
                <th className="text-right py-2 px-2">작업</th>
              </tr>
            </thead>
            <tbody>
              {employees.length === 0 ? (
                <tr><td colSpan={5} className="py-6 text-center text-[#62666D]">직원이 등록되지 않았습니다. 사업계획 엑셀을 업로드하면 자동 생성됩니다.</td></tr>
              ) : employees.map(e => (
                <tr key={e.id} className="border-b border-[#1A1B1F] hover:bg-[#1A1C22]">
                  <td className="py-2 px-2 text-[#F7F8F8] font-medium">{e.name}</td>
                  <td className="py-2 px-2 text-[#8A8F98] font-mono text-xs">{e.email}</td>
                  <td className="py-2 px-2">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                      e.role === 'admin' ? 'bg-[#EB5757]/15 text-[#EB5757]'
                      : e.role === 'manager' ? 'bg-[#F0BF00]/15 text-[#F0BF00]'
                      : 'bg-[#828FFF]/15 text-[#828FFF]'
                    }`}>{e.role === 'admin' ? '관리자' : e.role === 'manager' ? '매니저' : '담당자'}</span>
                  </td>
                  <td className="py-2 px-2 text-[#D0D6E0] text-xs">
                    {e.channels.length === 0 ? <span className="text-[#62666D]">없음</span>
                      : e.channels.slice(0, 4).map(c => c.channel_name).join(', ') + (e.channels.length > 4 ? ` +${e.channels.length - 4}` : '')}
                  </td>
                  <td className="py-2 px-2 text-right">
                    <button onClick={() => openAssign(e)} className="text-xs text-[#828FFF] hover:underline mr-2">채널 배정</button>
                    <button onClick={() => setEditingEmp(e)} className="text-xs text-[#8A8F98] hover:text-[#F7F8F8] mr-2">수정</button>
                    <button onClick={() => deleteEmployee(e.id)} className="text-xs text-[#EB5757] hover:underline">삭제</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 채널 그룹 매핑 */}
      <div className={`${PANEL} p-5`}>
        <h2 className="text-sm font-semibold mb-3">채널 구분 (위탁 / 사입 / 오프라인)</h2>
        <p className="text-xs text-[#62666D] mb-4">각 채널이 속한 구분을 지정합니다. 사업계획 업로드 시 자동 매핑되며, 수동으로 변경 가능합니다.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#23252A] text-[11px] uppercase tracking-wider text-[#62666D]">
                <th className="text-left py-2 px-2">채널</th>
                <th className="text-left py-2 px-2">카테고리</th>
                <th className="text-left py-2 px-2">구분 (사업계획 분류)</th>
              </tr>
            </thead>
            <tbody>
              {channels.map(c => (
                <tr key={c.id} className="border-b border-[#1A1B1F] hover:bg-[#1A1C22]">
                  <td className="py-2 px-2 text-[#F7F8F8]">{c.name}</td>
                  <td className="py-2 px-2 text-[#8A8F98] text-xs">{c.category}</td>
                  <td className="py-2 px-2">
                    <select
                      value={channelGroupMap[c.id] || ''}
                      onChange={(e) => e.target.value && setChannelGroup(c.id, parseInt(e.target.value))}
                      className="bg-[#08090A] border border-[#23252A] rounded px-2 py-1 text-xs text-[#F7F8F8]"
                    >
                      <option value="">— 미지정 —</option>
                      {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 채널 배정 모달 (간단 inline) */}
      {assignTarget && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className={`${PANEL} p-5 max-w-2xl w-full max-h-[80vh] overflow-y-auto`}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold">[{assignTarget.name}] 담당 채널 배정</h3>
              <button onClick={() => setAssignTarget(null)} className="text-[#62666D] hover:text-[#F7F8F8]">✕</button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-4">
              {channels.map(c => (
                <label key={c.id} className="flex items-center gap-2 text-xs text-[#D0D6E0] cursor-pointer p-2 rounded hover:bg-[#1A1B1F]">
                  <input
                    type="checkbox"
                    checked={pendingChannels.includes(c.id)}
                    onChange={(e) => {
                      if (e.target.checked) setPendingChannels([...pendingChannels, c.id]);
                      else setPendingChannels(pendingChannels.filter(x => x !== c.id));
                    }}
                    className="accent-[#828FFF]"
                  />
                  {c.name}
                </label>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setAssignTarget(null)} className="px-3 py-1.5 bg-[#1A1B1F] text-[#D0D6E0] rounded text-xs">취소</button>
              <button onClick={saveAssign} className="px-3 py-1.5 bg-[#828FFF] hover:bg-[#7070FF] text-white rounded text-xs font-medium">저장 ({pendingChannels.length}개)</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Reusable bits
// ──────────────────────────────────────────────────────────────

function KpiCard({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent?: string }) {
  return (
    <div className={`${PANEL} p-5`}>
      <div className="text-[10px] font-mono uppercase tracking-wider text-[#A3A9B3] mb-2">{label}</div>
      <div className="text-2xl font-semibold tracking-tight" style={{ color: accent || TEXT_PRIMARY }}>{value}</div>
      {hint && <div className="text-[11px] text-[#A3A9B3] mt-1.5">{hint}</div>}
    </div>
  );
}

function DeltaBadge({ delta }: { delta: { pct: number; sign: 'up' | 'down' | 'flat' } }) {
  const styles =
    delta.sign === 'up'
      ? { bg: 'rgba(39,166,68,0.15)', color: '#3DD971', border: 'rgba(39,166,68,0.35)' }
      : delta.sign === 'down'
        ? { bg: 'rgba(235,87,87,0.15)', color: '#FF7A7A', border: 'rgba(235,87,87,0.35)' }
        : { bg: 'rgba(122,127,138,0.12)', color: '#A3A9B3', border: 'rgba(122,127,138,0.25)' };
  const arrow = delta.sign === 'up' ? '▲' : delta.sign === 'down' ? '▼' : '–';
  return (
    <span
      className="text-[9px] ml-1.5 font-semibold px-1.5 py-0.5 rounded-full inline-flex items-center gap-0.5 border"
      style={{ backgroundColor: styles.bg, color: styles.color, borderColor: styles.border }}
    >
      {arrow} {Math.abs(delta.pct).toFixed(1)}%
    </span>
  );
}


function CompactKpi({
  label, value, hint, accent,
  spark, compareValue, currentValue, deltaFormat = 'pct',
}: {
  label: string; value: string; hint?: string; accent?: string;
  spark?: Array<{ x: string; v: number }>;
  compareValue?: number;
  currentValue?: number;
  deltaFormat?: 'pct' | 'pp';  // 'pp' = 퍼센트포인트 (이미 % 단위 값일 때)
}) {
  let deltaPct: number | null = null;
  let deltaSign: 'up' | 'down' | 'flat' = 'flat';
  if (compareValue !== undefined && currentValue !== undefined && compareValue !== null && currentValue !== null) {
    if (deltaFormat === 'pp') {
      deltaPct = (currentValue - compareValue);
    } else {
      deltaPct = compareValue !== 0 ? ((currentValue - compareValue) / Math.abs(compareValue)) * 100 : (currentValue > 0 ? 100 : 0);
    }
    deltaSign = deltaPct > 0.05 ? 'up' : deltaPct < -0.05 ? 'down' : 'flat';
  }
  const deltaColor = deltaSign === 'up' ? '#27A644' : deltaSign === 'down' ? '#EB5757' : '#7A7F8A';
  const arrow = deltaSign === 'up' ? '▲' : deltaSign === 'down' ? '▼' : '–';

  const accentColor = accent || TEXT_PRIMARY;
  const gradId = `kpi-grad-${label.replace(/\s/g, '')}-${(accent || 'def').replace('#', '')}`;
  const deltaBadgeStyle =
    deltaSign === 'up'
      ? { bg: 'rgba(39,166,68,0.18)', color: '#3DD971', border: 'rgba(39,166,68,0.4)' }
      : deltaSign === 'down'
        ? { bg: 'rgba(235,87,87,0.18)', color: '#FF7A7A', border: 'rgba(235,87,87,0.4)' }
        : { bg: 'rgba(122,127,138,0.15)', color: '#A3A9B3', border: 'rgba(122,127,138,0.3)' };

  return (
    <div className={`${PANEL} p-3 relative overflow-hidden`}>
      {/* 좌측 accent 라인 */}
      <div className="absolute left-0 top-0 bottom-0 w-0.5" style={{ background: `linear-gradient(180deg, ${accentColor}, transparent)` }} />
      {/* 카드 우상단 스파크라인 (Area + 그라데이션) */}
      {spark && spark.length > 1 && (
        <div className="absolute right-2 top-2 opacity-90 pointer-events-none" style={{ width: 64, height: 28 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={spark} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={accentColor} stopOpacity={0.6} />
                  <stop offset="100%" stopColor={accentColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area type="monotone" dataKey="v" stroke={accentColor} strokeWidth={1.5} fill={`url(#${gradId})`} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
      <div className="text-[10px] font-mono uppercase tracking-wider text-[#A3A9B3] mb-1 pl-1.5">{label}</div>
      <div className="text-lg font-semibold tracking-tight truncate pl-1.5" style={{ color: accentColor }}>{value}</div>
      <div className="flex items-center gap-1.5 mt-1 pl-1.5">
        {deltaPct !== null && (
          <span
            className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full border inline-flex items-center"
            style={{ backgroundColor: deltaBadgeStyle.bg, color: deltaBadgeStyle.color, borderColor: deltaBadgeStyle.border }}
          >
            {arrow} {Math.abs(deltaPct).toFixed(1)}{deltaFormat === 'pp' ? 'pp' : '%'}
          </span>
        )}
        {hint && <div className="text-[10px] text-[#7A7F8A] truncate">{hint}</div>}
      </div>
    </div>
  );
}

function DonutCard({
  title, subtitle, data, colors,
}: {
  title: string;
  subtitle?: string;
  data: Array<{ name: string; value: number }>;
  colors?: string[];
}) {
  if (!data || data.length === 0) {
    return (
      <div className={`${PANEL} p-4`}>
        <h3 className="text-sm font-semibold text-[#F7F8F8] mb-1">{title}</h3>
        {subtitle && <div className="text-[10px] text-[#A3A9B3] mb-2">{subtitle}</div>}
        <Empty h={180} />
      </div>
    );
  }
  const total = data.reduce((s, x) => s + (x.value || 0), 0);
  const palette = colors || PALETTE;
  return (
    <div className={`${PANEL} p-4`}>
      <div className="flex items-baseline justify-between mb-1">
        <h3 className="text-sm font-semibold text-[#F7F8F8]">{title}</h3>
        <span className="text-[10px] text-[#A3A9B3] font-mono">총 ₩{fmtKR(total)}</span>
      </div>
      {subtitle && <div className="text-[10px] text-[#7A7F8A] mb-2">{subtitle}</div>}
      <ResponsiveContainer width="100%" height={200}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            cx="50%" cy="50%"
            innerRadius={42} outerRadius={75}
            paddingAngle={2}
          >
            {data.map((_, i) => (
              <Cell key={i} fill={palette[i % palette.length]} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={TOOLTIP_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} itemStyle={TOOLTIP_ITEM_STYLE}
            formatter={(v: number, n: string) => [`₩${fmtKR(v)} (${total ? ((v as number) / total * 100).toFixed(1) : 0}%)`, n]}
          />
        </PieChart>
      </ResponsiveContainer>
      {/* 범례를 직접 그려서 가시성 보장 */}
      <div className="mt-1 grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px]">
        {data.slice(0, 8).map((d, i) => (
          <div key={d.name} className="flex items-center gap-1.5 min-w-0">
            <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ background: palette[i % palette.length] }} />
            <span className="text-[#D0D6E0] truncate">{d.name}</span>
            <span className="text-[#7A7F8A] font-mono ml-auto flex-shrink-0">{total ? ((d.value / total) * 100).toFixed(0) : 0}%</span>
          </div>
        ))}
        {data.length > 8 && (
          <div className="text-[#7A7F8A] col-span-2 text-center">+ {data.length - 8}개 더</div>
        )}
      </div>
    </div>
  );
}

function DateInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-col">
      <label className="text-[10px] uppercase tracking-wider text-[#62666D] mb-1">{label}</label>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-[#08090A] border border-[#23252A] rounded-md px-3 py-1.5 text-sm text-[#F7F8F8]"
      />
    </div>
  );
}

function Segment<T extends string>({ label, options, value, onChange }: {
  label: string;
  options: Array<{ v: T; l: string }>;
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-col">
      <label className="text-[10px] uppercase tracking-wider text-[#62666D] mb-1">{label}</label>
      <div className="flex bg-[#08090A] border border-[#23252A] rounded-md p-0.5">
        {options.map(o => (
          <button
            key={o.v}
            onClick={() => onChange(o.v)}
            className={`px-2.5 py-1 text-xs rounded transition-colors ${
              value === o.v ? 'bg-[#828FFF] text-white' : 'text-[#8A8F98] hover:text-[#F7F8F8]'
            }`}
          >
            {o.l}
          </button>
        ))}
      </div>
    </div>
  );
}

function MultiSelect({ label, options, value, onChange }: {
  label: string;
  options: Array<{ v: string; l: string; group?: string }>;
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const toggle = (v: string) => {
    if (value.includes(v)) onChange(value.filter(x => x !== v));
    else onChange([...value, v]);
  };

  const grouped = useMemo(() => {
    const g: Record<string, typeof options> = {};
    options.forEach(o => {
      const key = o.group || '_';
      if (!g[key]) g[key] = [];
      g[key].push(o);
    });
    return g;
  }, [options]);

  return (
    <div className="flex flex-col relative" ref={wrapRef}>
      <label className="text-[10px] uppercase tracking-wider text-[#62666D] mb-1">{label}</label>
      <button
        onClick={() => setOpen(o => !o)}
        className="bg-[#08090A] border border-[#23252A] rounded-md px-3 py-1.5 text-sm text-[#F7F8F8] min-w-[120px] text-left flex items-center justify-between"
      >
        <span>{value.length === 0 ? '전체' : `${value.length}개 선택`}</span>
        <span className="text-[#62666D] ml-2">▾</span>
      </button>
      {open && (
        <div className="absolute z-20 top-full mt-1 left-0 w-72 max-h-[300px] overflow-y-auto bg-[#0F1011] border border-[#23252A] rounded-md shadow-xl p-2">
          {Object.entries(grouped).map(([g, opts]) => (
            <div key={g} className="mb-1">
              {g !== '_' && <div className="text-[10px] uppercase tracking-wider text-[#62666D] px-2 py-1">{g}</div>}
              {opts.map(o => (
                <label key={o.v} className="flex items-center gap-2 px-2 py-1 hover:bg-[#1A1B1F] rounded cursor-pointer text-xs">
                  <input
                    type="checkbox"
                    checked={value.includes(o.v)}
                    onChange={() => toggle(o.v)}
                    className="accent-[#828FFF]"
                  />
                  <span className="text-[#D0D6E0]">{o.l}</span>
                </label>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Skeleton({ h }: { h: number }) {
  return <div className="animate-pulse bg-[#1A1B1F] rounded" style={{ height: h }} />;
}

// ──────────────────────────────────────────────────────────────
// 품목 관리 탭
// ──────────────────────────────────────────────────────────────

interface ChannelProduct {
  id: number;
  channel_id: string;
  channel_name: string;
  product_id: number;
  product_name: string;
  is_active: boolean;
  added_by: string | null;
}

function ProductsTab({
  authHeaders, channels, products, onRefresh,
}: {
  authHeaders: () => HeadersInit;
  channels: Channel[];
  products: Product[];
  onRefresh: () => void;
}) {
  const [mappings, setMappings] = useState<ChannelProduct[]>([]);
  const [view, setView] = useState<'matrix' | 'channel'>('channel');
  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(null);
  const [pendingPids, setPendingPids] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);

  // 품목 추가/수정 모달
  const [showProdEditor, setShowProdEditor] = useState(false);
  const [editProd, setEditProd] = useState<Partial<Product>>({});

  const fetchMappings = useCallback(async () => {
    const r = await fetch(`${API_BASE}/api/csa/channel-products?only_active=false`, { headers: authHeaders() });
    if (r.ok) setMappings(await r.json());
  }, [authHeaders]);

  useEffect(() => { fetchMappings(); }, [fetchMappings]);

  // 채널별 활성 품목 ID 집합
  const byChannel = useMemo(() => {
    const m: Record<string, Set<number>> = {};
    mappings.forEach(mp => {
      if (mp.is_active) {
        if (!m[mp.channel_id]) m[mp.channel_id] = new Set();
        m[mp.channel_id].add(mp.product_id);
      }
    });
    return m;
  }, [mappings]);

  // 품목별 등록 채널 수
  const productChannelCount = useMemo(() => {
    const m: Record<number, number> = {};
    mappings.filter(mp => mp.is_active).forEach(mp => {
      m[mp.product_id] = (m[mp.product_id] || 0) + 1;
    });
    return m;
  }, [mappings]);

  const openChannel = (ch: Channel) => {
    setSelectedChannel(ch);
    setPendingPids(new Set(byChannel[ch.id] || []));
  };

  const togglePid = (pid: number) => {
    setPendingPids(s => {
      const ns = new Set(s);
      if (ns.has(pid)) ns.delete(pid); else ns.add(pid);
      return ns;
    });
  };

  const saveChannelProducts = async () => {
    if (!selectedChannel) return;
    setBusy(true);
    try {
      const r = await fetch(
        `${API_BASE}/api/csa/channel-products/bulk-set?channel_id=${encodeURIComponent(selectedChannel.id)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify(Array.from(pendingPids)),
        }
      );
      if (!r.ok) {
        const data = await r.json();
        alert(data.detail || '저장 실패');
        return;
      }
      await fetchMappings();
      setSelectedChannel(null);
    } finally { setBusy(false); }
  };

  const saveProduct = async () => {
    if (!editProd.name) return;
    try {
      const r = await fetch(`${API_BASE}/api/csa/products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          name: editProd.name,
          code: editProd.code || null,
          category: editProd.category || null,
          default_unit_size: editProd.default_unit_size || 1,
          is_active: editProd.is_active !== false,
          sort_order: editProd.sort_order || 100,
        }),
      });
      if (!r.ok) {
        const data = await r.json();
        alert(data.detail || '저장 실패');
        return;
      }
      setShowProdEditor(false);
      setEditProd({});
      onRefresh();
      await fetchMappings();
    } catch (e: any) {
      alert(e.message || String(e));
    }
  };

  const deactivateProduct = async (p: Product) => {
    if (!confirm(`'${p.name}' 품목을 비활성화하시겠습니까? (기존 매출 데이터는 보존됩니다)`)) return;
    const r = await fetch(`${API_BASE}/api/csa/products/${p.id}`, {
      method: 'DELETE', headers: authHeaders(),
    });
    if (r.ok) {
      onRefresh();
      await fetchMappings();
    }
  };

  return (
    <div className="space-y-5">
      {/* 헤더 + 토글 + 품목 추가 */}
      <div className={`${PANEL} p-4 flex flex-wrap items-end justify-between gap-3`}>
        <div>
          <h2 className="text-sm font-semibold">품목 관리</h2>
          <p className="text-xs text-[#A3A9B3] mt-1">
            표준 품목 {products.length}종 · 채널 {channels.length}개 · 활성 매핑 {mappings.filter(m => m.is_active).length}건
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Segment
            label="뷰"
            options={[
              { v: 'channel', l: '채널 선택' },
              { v: 'matrix', l: '매트릭스' },
            ]}
            value={view}
            onChange={setView}
          />
          <button
            onClick={() => { setEditProd({ name: '', default_unit_size: 1, is_active: true, sort_order: 100 }); setShowProdEditor(true); }}
            className="px-3 py-1.5 bg-[#828FFF] hover:bg-[#7070FF] text-white rounded text-xs font-medium"
          >+ 품목 추가</button>
        </div>
      </div>

      {/* 품목 마스터 목록 */}
      <div className={`${PANEL} p-4`}>
        <h3 className="text-sm font-semibold mb-3">등록된 품목 ({products.length})</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
          {products.map(p => (
            <div key={p.id} className={`${SUBPANEL} p-3 flex items-center gap-2`}>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-[#F7F8F8] font-medium truncate">{p.name}</div>
                <div className="text-[10px] text-[#A3A9B3] mt-0.5 flex items-center gap-2">
                  <span>{p.category || '-'}</span>
                  <span className="text-[#7A7F8A]">·</span>
                  <span className="text-[#828FFF] font-mono">{productChannelCount[p.id] || 0}채널</span>
                </div>
              </div>
              <button
                onClick={() => { setEditProd(p); setShowProdEditor(true); }}
                className="text-[10px] text-[#8A8F98] hover:text-[#F7F8F8]"
              >수정</button>
              <button
                onClick={() => deactivateProduct(p)}
                className="text-[10px] text-[#EB5757] hover:underline"
              >비활성</button>
            </div>
          ))}
        </div>
      </div>

      {/* 뷰 1: 채널 선택 → 그 채널의 활성 품목 */}
      {view === 'channel' && (
        <div className={`${PANEL} p-4`}>
          <h3 className="text-sm font-semibold mb-3">채널별 판매 품목 설정</h3>
          <p className="text-xs text-[#A3A9B3] mb-3">채널을 클릭하면 그 채널에서 판매하는 품목을 체크박스로 선택할 수 있습니다.</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-1.5">
            {channels.map(c => {
              const count = (byChannel[c.id] || new Set()).size;
              return (
                <button
                  key={c.id}
                  onClick={() => openChannel(c)}
                  className={`${SUBPANEL} p-2.5 text-left hover:border-[#828FFF]/50 transition-colors`}
                >
                  <div className="text-sm text-[#F7F8F8] font-medium truncate">{c.name}</div>
                  <div className="text-[10px] text-[#A3A9B3] mt-0.5">{c.category}</div>
                  <div className="text-[11px] mt-1">
                    <span className="text-[#828FFF] font-mono">{count}</span>
                    <span className="text-[#7A7F8A]"> / {products.length} 품목</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* 뷰 2: 매트릭스 (채널 × 품목 체크박스) */}
      {view === 'matrix' && (
        <div className={`${PANEL} p-0 overflow-x-auto`}>
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-[#0F1011] sticky top-0 z-10">
                <th className="text-left py-2 px-3 border-b-2 border-[#2E3138] text-[10px] uppercase tracking-wider text-[#A3A9B3] sticky left-0 bg-[#0F1011] min-w-[140px]">
                  채널 \ 품목
                </th>
                {products.map(p => (
                  <th key={p.id} className="text-center py-2 px-1 border-b-2 border-[#2E3138] text-[10px] text-[#D0D6E0] min-w-[60px]" style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>
                    {p.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {channels.map(c => (
                <tr key={c.id} className="border-b border-[#1A1B1F] hover:bg-[#1A1C22]">
                  <td className="py-1.5 px-3 sticky left-0 bg-[#0F1011] z-[1] text-[#F7F8F8] min-w-[140px] border-r border-[#2E3138]">
                    {c.name}
                  </td>
                  {products.map(p => {
                    const checked = (byChannel[c.id] || new Set()).has(p.id);
                    return (
                      <td key={p.id} className="text-center py-1 px-1">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={async (e) => {
                            const want = e.target.checked;
                            const currentSet = new Set(byChannel[c.id] || []);
                            if (want) currentSet.add(p.id); else currentSet.delete(p.id);
                            await fetch(
                              `${API_BASE}/api/csa/channel-products/bulk-set?channel_id=${encodeURIComponent(c.id)}`,
                              {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json', ...authHeaders() },
                                body: JSON.stringify(Array.from(currentSet)),
                              }
                            );
                            fetchMappings();
                          }}
                          className="accent-[#828FFF] w-3.5 h-3.5"
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 채널-품목 선택 모달 */}
      {selectedChannel && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className={`${PANEL} p-5 max-w-3xl w-full max-h-[80vh] overflow-y-auto`}>
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-sm font-semibold">[{selectedChannel.name}] 판매 품목 설정</h3>
                <p className="text-[11px] text-[#A3A9B3] mt-0.5">{pendingPids.size} / {products.length} 품목 선택</p>
              </div>
              <button onClick={() => setSelectedChannel(null)} className="text-[#A3A9B3] hover:text-[#F7F8F8]">✕</button>
            </div>
            <div className="flex items-center gap-2 mb-3">
              <button onClick={() => setPendingPids(new Set(products.map(p => p.id)))} className="text-[11px] px-2 py-1 bg-[#1A1B1F] hover:bg-[#23252A] text-[#D0D6E0] rounded">전체 선택</button>
              <button onClick={() => setPendingPids(new Set())} className="text-[11px] px-2 py-1 bg-[#1A1B1F] hover:bg-[#23252A] text-[#D0D6E0] rounded">전체 해제</button>
              <button onClick={() => setPendingPids(new Set(byChannel[selectedChannel.id] || []))} className="text-[11px] px-2 py-1 bg-[#1A1B1F] hover:bg-[#23252A] text-[#D0D6E0] rounded">원래대로</button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1.5 mb-4">
              {products.map(p => (
                <label key={p.id} className="flex items-center gap-2 p-2 hover:bg-[#1A1C22] rounded cursor-pointer text-xs">
                  <input
                    type="checkbox"
                    checked={pendingPids.has(p.id)}
                    onChange={() => togglePid(p.id)}
                    className="accent-[#828FFF]"
                  />
                  <span className="text-[#D0D6E0] truncate">{p.name}</span>
                </label>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setSelectedChannel(null)} className="px-3 py-1.5 bg-[#1A1B1F] text-[#D0D6E0] rounded text-xs">취소</button>
              <button onClick={saveChannelProducts} disabled={busy} className="px-3 py-1.5 bg-[#828FFF] hover:bg-[#7070FF] text-white rounded text-xs font-medium disabled:opacity-50">
                {busy ? '저장 중…' : `저장 (${pendingPids.size}개)`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 품목 추가/수정 모달 */}
      {showProdEditor && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className={`${PANEL} p-5 max-w-md w-full`}>
            <h3 className="text-sm font-semibold mb-3">{editProd.id ? `'${editProd.name}' 수정` : '새 품목 추가'}</h3>
            <div className="space-y-2">
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-[#A3A9B3] mb-1">품목명</label>
                <input
                  type="text"
                  value={editProd.name || ''}
                  onChange={(e) => setEditProd({ ...editProd, name: e.target.value })}
                  className="w-full bg-[#08090A] border border-[#2E3138] rounded px-3 py-1.5 text-sm text-[#F7F8F8]"
                  autoFocus
                  placeholder="예: 마들렌, 비건쿠키"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] uppercase tracking-wider text-[#A3A9B3] mb-1">코드</label>
                  <input
                    type="text"
                    value={editProd.code || ''}
                    onChange={(e) => setEditProd({ ...editProd, code: e.target.value })}
                    className="w-full bg-[#08090A] border border-[#2E3138] rounded px-3 py-1.5 text-sm text-[#F7F8F8] font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase tracking-wider text-[#A3A9B3] mb-1">카테고리</label>
                  <input
                    type="text"
                    value={editProd.category || ''}
                    onChange={(e) => setEditProd({ ...editProd, category: e.target.value })}
                    className="w-full bg-[#08090A] border border-[#2E3138] rounded px-3 py-1.5 text-sm text-[#F7F8F8]"
                    placeholder="베이커리/디저트 등"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] uppercase tracking-wider text-[#A3A9B3] mb-1">기본 입수</label>
                  <input
                    type="number"
                    min={1}
                    value={editProd.default_unit_size || 1}
                    onChange={(e) => setEditProd({ ...editProd, default_unit_size: parseInt(e.target.value) || 1 })}
                    className="w-full bg-[#08090A] border border-[#2E3138] rounded px-3 py-1.5 text-sm text-[#F7F8F8] font-mono text-right"
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase tracking-wider text-[#A3A9B3] mb-1">정렬 순서</label>
                  <input
                    type="number"
                    value={editProd.sort_order || 100}
                    onChange={(e) => setEditProd({ ...editProd, sort_order: parseInt(e.target.value) || 100 })}
                    className="w-full bg-[#08090A] border border-[#2E3138] rounded px-3 py-1.5 text-sm text-[#F7F8F8] font-mono text-right"
                  />
                </div>
              </div>
              <p className="text-[10px] text-[#7A7F8A] mt-2">
                추가 시 자동으로 모든 활성 채널에 등록됩니다. 채널별로는 위에서 체크박스로 토글하세요.
              </p>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => { setShowProdEditor(false); setEditProd({}); }} className="px-3 py-1.5 bg-[#1A1B1F] text-[#D0D6E0] rounded text-xs">취소</button>
              <button onClick={saveProduct} className="px-3 py-1.5 bg-[#828FFF] hover:bg-[#7070FF] text-white rounded text-xs font-medium">저장</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// P&L 월별 매트릭스 탭
// ──────────────────────────────────────────────────────────────

interface PnlRow {
  id: number;
  code: string;
  label: string;
  section: string;
  parent_id: number | null;
  sign: number;
  is_subtotal: boolean;
  is_computed: boolean;
  formula_code: string | null;
  sort_order: number;
  actual: number[];
  plan: number[];
}

interface PnlData {
  year: number;
  rows: PnlRow[];
}

const SECTION_COLOR: Record<string, string> = {
  revenue: '#828FFF',
  cogs_var: '#EB5757',
  cogs_fixed: '#FC7840',
  gross_profit: '#27A644',
  sga_var: '#A855F7',
  sga_fixed: '#7070FF',
  op_profit: '#06B6D4',
  cm: '#F0BF00',
};

const SECTION_BG: Record<string, string> = {
  revenue: 'bg-[#828FFF]/10',
  cogs_var: 'bg-[#EB5757]/8',
  cogs_fixed: 'bg-[#FC7840]/8',
  gross_profit: 'bg-[#27A644]/10',
  sga_var: 'bg-[#A855F7]/8',
  sga_fixed: 'bg-[#7070FF]/8',
  op_profit: 'bg-[#06B6D4]/10',
  cm: 'bg-[#F0BF00]/10',
};

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

function PnlTab({ authHeaders, userEmail }: { authHeaders: () => HeadersInit; userEmail: string }) {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [data, setData] = useState<PnlData | null>(null);
  const [scope, setScope] = useState<'actual' | 'plan' | 'both'>('both');
  const [loading, setLoading] = useState(false);
  const [pwStatus, setPwStatus] = useState<{ is_set: boolean; owner_email: string } | null>(null);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());

  // 셀 편집
  const [editCell, setEditCell] = useState<{ row: PnlRow; month: number; scope: 'actual' | 'plan' } | null>(null);
  const [editValue, setEditValue] = useState('');
  const [editPw, setEditPw] = useState('');
  const [editBusy, setEditBusy] = useState(false);
  const [editMsg, setEditMsg] = useState<string | null>(null);

  // 행 추가 모달
  const [addRowParent, setAddRowParent] = useState<PnlRow | null>(null);
  const [newRowLabel, setNewRowLabel] = useState('');
  const [addRowPw, setAddRowPw] = useState('');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API_BASE}/api/csa/pnl?year=${year}`, { headers: authHeaders() });
      if (r.ok) setData(await r.json());
      const pw = await fetch(`${API_BASE}/api/csa/pnl/password-status`, { headers: authHeaders() });
      if (pw.ok) setPwStatus(await pw.json());
    } finally { setLoading(false); }
  }, [authHeaders, year]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const startEdit = (row: PnlRow, month: number, scopeSel: 'actual' | 'plan') => {
    // 자동 계산 행은 수정 불가
    if (row.is_computed && (row.formula_code === 'gross_profit' || row.formula_code === 'op_profit' || row.formula_code === 'contribution_margin')) {
      setEditMsg('자동 계산 행은 직접 수정할 수 없습니다 (수식)');
      return;
    }
    const v = scopeSel === 'actual' ? row.actual[month - 1] : row.plan[month - 1];
    setEditCell({ row, month, scope: scopeSel });
    setEditValue(String(Math.round(v)));
    setEditPw('');
    setEditMsg(null);
  };

  const saveEdit = async () => {
    if (!editCell) return;
    setEditBusy(true); setEditMsg(null);
    try {
      const r = await fetch(`${API_BASE}/api/csa/pnl/value`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          year, month: editCell.month, row_id: editCell.row.id,
          scope: editCell.scope, value: parseFloat(editValue) || 0,
          password: editPw, user_email: userEmail,
        }),
      });
      const out = await r.json();
      if (!r.ok) throw new Error(out.detail || '저장 실패');
      setEditCell(null);
      fetchData();
    } catch (e: any) {
      setEditMsg(e.message || String(e));
    } finally { setEditBusy(false); }
  };

  const addRow = async () => {
    if (!addRowParent || !newRowLabel) return;
    try {
      const r = await fetch(`${API_BASE}/api/csa/pnl/row`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          parent_id: addRowParent.id, label: newRowLabel, password: addRowPw,
        }),
      });
      const out = await r.json();
      if (!r.ok) throw new Error(out.detail || '추가 실패');
      setAddRowParent(null); setNewRowLabel(''); setAddRowPw('');
      fetchData();
    } catch (e: any) {
      alert(e.message || String(e));
    }
  };

  const deleteRow = async (row: PnlRow) => {
    const pw = prompt(`'${row.label}' 행 삭제 — 비밀번호 입력:`);
    if (!pw) return;
    try {
      const r = await fetch(`${API_BASE}/api/csa/pnl/row/${row.id}?password=${encodeURIComponent(pw)}`, {
        method: 'DELETE', headers: authHeaders(),
      });
      const out = await r.json();
      if (!r.ok) throw new Error(out.detail || '삭제 실패');
      fetchData();
    } catch (e: any) {
      alert(e.message || String(e));
    }
  };

  // 계층 구조 + 펼침/접힘 처리
  const visibleRows = useMemo(() => {
    if (!data) return [];
    const out: PnlRow[] = [];
    for (const r of data.rows) {
      if (r.parent_id && collapsed.has(r.parent_id)) continue;
      out.push(r);
    }
    return out;
  }, [data, collapsed]);

  const childrenCount = useMemo(() => {
    const m: Record<number, number> = {};
    if (!data) return m;
    data.rows.forEach(r => {
      if (r.parent_id) m[r.parent_id] = (m[r.parent_id] || 0) + 1;
    });
    return m;
  }, [data]);

  const toggleCollapse = (id: number) => {
    setCollapsed(c => {
      const nc = new Set(c);
      if (nc.has(id)) nc.delete(id); else nc.add(id);
      return nc;
    });
  };

  const fmtCell = (v: number) => v === 0 ? '–' : fmtKR(v);
  const monthTotal = (key: 'actual' | 'plan', m: number) =>
    data?.rows.find(r => r.code === 'revenue')?.[key][m - 1] || 0;

  return (
    <div className="space-y-3">
      {/* 헤더: 연도 + scope + 안내 */}
      <div className={`${PANEL} p-4`}>
        <div className="flex flex-wrap gap-3 items-end justify-between">
          <div className="flex items-end gap-3">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-[#A3A9B3] block mb-1">연도</label>
              <input
                type="number" value={year}
                onChange={(e) => setYear(parseInt(e.target.value) || currentYear)}
                className="w-24 bg-[#08090A] border border-[#2E3138] rounded px-3 py-1.5 text-sm text-[#F7F8F8] font-mono"
              />
            </div>
            <Segment
              label="표시"
              options={[
                { v: 'both', l: '실적+계획' },
                { v: 'actual', l: '실적만' },
                { v: 'plan', l: '계획만' },
              ]}
              value={scope}
              onChange={setScope}
            />
          </div>
          <div className="text-[11px] text-[#A3A9B3] max-w-md text-right">
            <div>매출·변동비는 <span className="text-[#828FFF]">실제 업로드된 엑셀 + 변동비 규칙</span>에서 자동 산출.</div>
            <div>원재료·부재료·고정비는 직접 입력. 셀 클릭 시 비밀번호 모달.</div>
            {!pwStatus?.is_set && (
              <div className="text-[#F0BF00] mt-1">⚠ 수정 비밀번호 미설정 — 직원·채널 관리 탭에서 설정</div>
            )}
          </div>
        </div>
      </div>

      {/* 매트릭스 */}
      <div className={`${PANEL} p-0 overflow-x-auto`}>
        {loading ? <Skeleton h={500} /> : data ? (
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-[#0F1011] sticky top-0 z-10">
                <th className="text-left py-2.5 px-3 border-b-2 border-[#2E3138] text-[10px] uppercase tracking-wider text-[#A3A9B3] sticky left-0 bg-[#0F1011] min-w-[200px]">
                  계정과목
                </th>
                {scope !== 'plan' && MONTHS.map(m => (
                  <th key={`a-${m}`} className="text-right py-2.5 px-2 border-b-2 border-[#2E3138] text-[10px] uppercase tracking-wider text-[#828FFF] min-w-[80px]">
                    {m}월
                  </th>
                ))}
                {scope === 'both' && <th className="border-b-2 border-l border-[#2E3138]" />}
                {scope !== 'actual' && MONTHS.map(m => (
                  <th key={`p-${m}`} className="text-right py-2.5 px-2 border-b-2 border-[#2E3138] text-[10px] uppercase tracking-wider text-[#A3A9B3] min-w-[80px]">
                    {m}월{scope === 'both' && <span className="block text-[8px] text-[#7A7F8A]">(계획)</span>}
                  </th>
                ))}
              </tr>
              {scope === 'both' && (
                <tr className="bg-[#0A0B0D]">
                  <th className="border-b border-[#2E3138] sticky left-0 bg-[#0A0B0D]" />
                  {MONTHS.map(m => (
                    <th key={`ah-${m}`} className="text-[9px] text-[#828FFF] text-right px-2 py-1 border-b border-[#2E3138]">실적</th>
                  ))}
                </tr>
              )}
            </thead>
            <tbody>
              {visibleRows.map(row => {
                const isMainSection = !row.parent_id;
                const isCollapsed = collapsed.has(row.id);
                const childCount = childrenCount[row.id] || 0;
                const negative = row.sign === -1;
                const formulaRow = row.is_computed && row.is_subtotal && (
                  row.formula_code === 'gross_profit' || row.formula_code === 'op_profit' || row.formula_code === 'contribution_margin'
                );
                const isManualSubtotal = row.is_subtotal && (row.code === 'cogs_fixed' || row.code === 'sga_fixed');
                return (
                  <tr key={row.id} className={`border-b border-[#1A1B1F] ${isMainSection ? SECTION_BG[row.section] || '' : ''} hover:bg-[#1A1C22]`}>
                    <td className={`py-2 px-3 sticky left-0 ${isMainSection ? (SECTION_BG[row.section] || 'bg-[#0F1011]') : 'bg-[#0F1011]'} z-[1] min-w-[200px]`}
                        style={{ paddingLeft: row.parent_id ? 28 : 12 }}>
                      <div className="flex items-center gap-1.5">
                        {childCount > 0 && (
                          <button
                            onClick={() => toggleCollapse(row.id)}
                            className="text-[#A3A9B3] hover:text-[#F7F8F8] w-3 text-xs leading-none"
                          >{isCollapsed ? '▶' : '▼'}</button>
                        )}
                        <span className="w-1.5 h-3 rounded-sm" style={{ background: SECTION_COLOR[row.section] || '#62666D' }} />
                        <span className={`${isMainSection ? 'font-semibold text-[#F7F8F8]' : 'text-[#D0D6E0]'} ${formulaRow ? 'text-[#27A644]' : ''}`}>
                          {row.label}
                          {negative && <span className="text-[#EB5757] ml-1">(−)</span>}
                          {formulaRow && <span className="text-[9px] text-[#7A7F8A] ml-2">자동</span>}
                          {row.parent_id && row.is_computed && <span className="text-[9px] text-[#7A7F8A] ml-2">자동</span>}
                        </span>
                        {/* 행 추가 버튼 (수동 sub-total: cogs_fixed, sga_fixed, cogs_var, sga_var) */}
                        {(row.code === 'cogs_fixed' || row.code === 'sga_fixed' || row.code === 'cogs_var' || row.code === 'sga_var') && (
                          <button
                            onClick={() => setAddRowParent(row)}
                            className="ml-auto text-[#7A7F8A] hover:text-[#828FFF] text-[10px]"
                            title="하위 행 추가"
                          >+ 행</button>
                        )}
                        {/* custom 행 삭제 */}
                        {row.code.startsWith('custom_') && (
                          <button
                            onClick={() => deleteRow(row)}
                            className="ml-auto text-[#EB5757] text-[10px] hover:underline"
                          >삭제</button>
                        )}
                      </div>
                    </td>

                    {/* 실적 셀 */}
                    {scope !== 'plan' && MONTHS.map(m => {
                      const v = row.actual[m - 1];
                      const editable = !formulaRow;
                      return (
                        <td key={`a-${row.id}-${m}`}
                            onClick={editable ? () => startEdit(row, m, 'actual') : undefined}
                            className={`text-right py-2 px-2 font-mono ${
                              editable ? 'cursor-pointer hover:bg-[#23252A]' : ''
                            } ${isMainSection ? 'font-semibold text-[#F7F8F8]' : 'text-[#D0D6E0]'} ${
                              negative && v > 0 ? 'text-[#EB5757]' : ''
                            } ${formulaRow ? 'text-[#27A644]' : ''}`}
                        >
                          {fmtCell(v)}
                        </td>
                      );
                    })}
                    {scope === 'both' && <td className="border-l border-[#2E3138]" />}

                    {/* 계획 셀 */}
                    {scope !== 'actual' && MONTHS.map(m => {
                      const v = row.plan[m - 1];
                      const a = row.actual[m - 1];
                      const editable = !formulaRow;
                      const ach = v ? (a / v * 100) : null;
                      return (
                        <td key={`p-${row.id}-${m}`}
                            onClick={editable ? () => startEdit(row, m, 'plan') : undefined}
                            className={`text-right py-2 px-2 font-mono text-[#A3A9B3] ${
                              editable ? 'cursor-pointer hover:bg-[#23252A]' : ''
                            }`}
                        >
                          {fmtCell(v)}
                          {scope === 'both' && v > 0 && ach !== null && (
                            <div className="text-[8px] mt-0.5" style={{ color: ach >= 100 ? '#27A644' : ach >= 80 ? '#F0BF00' : '#EB5757' }}>
                              {ach.toFixed(0)}%
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : <Empty h={400} />}
      </div>

      {/* 셀 편집 모달 */}
      {editCell && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className={`${PANEL} p-5 max-w-md w-full`}>
            <h3 className="text-sm font-semibold mb-2">
              {editCell.row.label} — {year}년 {editCell.month}월 ({editCell.scope === 'actual' ? '실적' : '계획'}) 수정
            </h3>
            <p className="text-xs text-[#A3A9B3] mb-3">변경 시 P&L 비밀번호가 필요합니다.</p>

            <label className="text-[10px] uppercase tracking-wider text-[#A3A9B3] block mb-1">값 (원)</label>
            <input
              type="number"
              value={editValue} onChange={(e) => setEditValue(e.target.value)}
              className="w-full bg-[#08090A] border border-[#2E3138] rounded px-3 py-2 text-sm text-[#F7F8F8] font-mono text-right mb-3"
              autoFocus
            />

            {pwStatus?.is_set && (
              <>
                <label className="text-[10px] uppercase tracking-wider text-[#A3A9B3] block mb-1">비밀번호</label>
                <input
                  type="password"
                  value={editPw} onChange={(e) => setEditPw(e.target.value)}
                  className="w-full bg-[#08090A] border border-[#2E3138] rounded px-3 py-2 text-sm text-[#F7F8F8] mb-3"
                />
              </>
            )}

            {!pwStatus?.is_set && (
              <div className="text-xs text-[#F0BF00] bg-[#F0BF00]/10 border border-[#F0BF00]/30 rounded p-2 mb-3">
                비밀번호 미설정 상태입니다. {pwStatus?.owner_email}로 로그인한 경우만 저장 가능합니다.
              </div>
            )}

            {editMsg && <div className="text-xs text-[#EB5757] mb-2">{editMsg}</div>}

            <div className="flex justify-end gap-2">
              <button onClick={() => setEditCell(null)} className="px-3 py-1.5 bg-[#1A1B1F] text-[#D0D6E0] rounded text-xs">취소</button>
              <button onClick={saveEdit} disabled={editBusy} className="px-3 py-1.5 bg-[#828FFF] hover:bg-[#7070FF] text-white rounded text-xs font-medium disabled:opacity-50">
                {editBusy ? '저장 중…' : '저장'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 행 추가 모달 */}
      {addRowParent && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className={`${PANEL} p-5 max-w-md w-full`}>
            <h3 className="text-sm font-semibold mb-3">'{addRowParent.label}' 하위 행 추가</h3>
            <label className="text-[10px] uppercase tracking-wider text-[#A3A9B3] block mb-1">행 이름</label>
            <input
              type="text" value={newRowLabel} onChange={(e) => setNewRowLabel(e.target.value)}
              placeholder="예: 임차료, 인건비"
              className="w-full bg-[#08090A] border border-[#2E3138] rounded px-3 py-2 text-sm text-[#F7F8F8] mb-3"
              autoFocus
            />
            <label className="text-[10px] uppercase tracking-wider text-[#A3A9B3] block mb-1">비밀번호</label>
            <input
              type="password" value={addRowPw} onChange={(e) => setAddRowPw(e.target.value)}
              className="w-full bg-[#08090A] border border-[#2E3138] rounded px-3 py-2 text-sm text-[#F7F8F8] mb-3"
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setAddRowParent(null)} className="px-3 py-1.5 bg-[#1A1B1F] text-[#D0D6E0] rounded text-xs">취소</button>
              <button onClick={addRow} className="px-3 py-1.5 bg-[#828FFF] hover:bg-[#7070FF] text-white rounded text-xs font-medium">추가</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Empty({ h = 300 }: { h?: number }) {
  return (
    <div className="flex items-center justify-center text-sm text-[#A3A9B3]" style={{ height: h }}>
      데이터가 없습니다.
    </div>
  );
}
