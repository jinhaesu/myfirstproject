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
const TEXT_DIM = '#8A8F98';
const TEXT_MUTED = '#62666D';

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
  status: string;
  period_start: string | null;
  period_end: string | null;
  row_total: number;
  row_inserted: number;
  row_duplicate: number;
  row_unmatched: number;
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

type Tab = 'dashboard' | 'upload' | 'mapping' | 'cost' | 'plan';

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

  // Filters
  const [periodStart, setPeriodStart] = useState(isoDate(firstOfMonth));
  const [periodEnd, setPeriodEnd] = useState(isoDate(today));
  const [granularity, setGranularity] = useState<Granularity>('day');
  const [selChannels, setSelChannels] = useState<string[]>([]);
  const [selProducts, setSelProducts] = useState<number[]>([]);

  const [loading, setLoading] = useState(false);
  const [seedDone, setSeedDone] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) router.push('/login');
  }, [user, authLoading, router]);

  const authHeaders = useCallback((): HeadersInit => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, []);

  const fetchAll = useCallback(async () => {
    try {
      const [cRes, pRes, bRes, uRes, vRes] = await Promise.all([
        fetch(`${API_BASE}/api/csa/channels`, { headers: authHeaders() }),
        fetch(`${API_BASE}/api/csa/products`, { headers: authHeaders() }),
        fetch(`${API_BASE}/api/csa/batches?limit=20`, { headers: authHeaders() }),
        fetch(`${API_BASE}/api/csa/unmatched`, { headers: authHeaders() }),
        fetch(`${API_BASE}/api/csa/variable-costs`, { headers: authHeaders() }),
      ]);
      if (cRes.ok) setChannels(await cRes.json());
      if (pRes.ok) setProducts(await pRes.json());
      if (bRes.ok) setBatches(await bRes.json());
      if (uRes.ok) setUnmatched(await uRes.json());
      if (vRes.ok) setVariableCosts(await vRes.json());
    } catch (e) {
      console.error(e);
    }
  }, [authHeaders]);

  const fetchDashboard = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({
        period_start: periodStart,
        period_end: periodEnd,
        granularity,
      });
      if (selChannels.length) qs.set('channel_ids', selChannels.join(','));
      if (selProducts.length) qs.set('product_ids', selProducts.join(','));
      const r = await fetch(`${API_BASE}/api/csa/dashboard?${qs.toString()}`, { headers: authHeaders() });
      if (r.ok) setDashboard(await r.json());
    } finally {
      setLoading(false);
    }
  }, [authHeaders, periodStart, periodEnd, granularity, selChannels, selProducts]);

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
            loading={loading}
            channels={channels}
            products={products}
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
            authHeaders={authHeaders}
            onUpdated={() => { fetchAll(); fetchDashboard(); }}
          />
        )}

        {activeTab === 'plan' && (
          <PlanTab dashboard={dashboard} />
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
    { key: 'upload', label: '엑셀 업로드' },
    { key: 'mapping', label: '매핑 대기', badge: unmatchedCount },
    { key: 'cost', label: '변동비 설정' },
    { key: 'plan', label: '사업계획 비교' },
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

function DashboardTab({
  data, loading, channels, products,
  periodStart, periodEnd, setPeriodStart, setPeriodEnd,
  granularity, setGranularity,
  selChannels, setSelChannels, selProducts, setSelProducts,
}: any) {
  return (
    <div>
      {/* Filter bar */}
      <div className={`${PANEL} p-4 mb-5`}>
        <div className="flex flex-wrap gap-3 items-end">
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
          <div className="ml-auto">
            {(selChannels.length > 0 || selProducts.length > 0) && (
              <button
                onClick={() => { setSelChannels([]); setSelProducts([]); }}
                className="text-xs text-[#8A8F98] hover:text-[#F7F8F8] px-3 py-2"
              >
                필터 초기화
              </button>
            )}
          </div>
        </div>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
        <KpiCard label="순매출" value={data ? `₩${fmtKR(data.summary.revenue)}` : '—'} hint={data ? `${fmtNum(data.summary.orders)} 주문` : ''} />
        <KpiCard label="판매수량 (낱개)" value={data ? fmtNum(Math.round(data.summary.pcs)) : '—'} hint={data ? '입수 환산 적용' : ''} />
        <KpiCard label="공헌이익" value={data ? `₩${fmtKR(data.summary.contribution_margin)}` : '—'} hint={data ? `변동비 ₩${fmtKR(data.summary.variable_cost)} 차감` : ''} accent="#27A644" />
        <KpiCard label="공헌이익률" value={data ? fmtPct(data.summary.cm_rate) : '—'} hint={data && data.summary.commission ? `수수료 ₩${fmtKR(data.summary.commission)}` : ''} accent="#828FFF" />
      </div>

      {/* 시리즈 + 채널 도넛 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-5">
        <div className={`${PANEL} p-5 lg:col-span-2`}>
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-sm font-semibold text-[#F7F8F8]">기간별 매출/공헌이익 추이</h2>
            <span className="text-[10px] font-mono uppercase tracking-wider text-[#62666D]">
              {granularity === 'day' ? '일간' : granularity === 'month' ? '월간' : granularity === 'quarter' ? '분기' : '연간'}
            </span>
          </div>
          {loading ? (
            <Skeleton h={300} />
          ) : data && data.series.length ? (
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={data.series} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#23252A" />
                <XAxis dataKey="period" stroke="#62666D" tick={{ fill: '#8A8F98', fontSize: 11 }} />
                <YAxis stroke="#62666D" tick={{ fill: '#8A8F98', fontSize: 11 }} tickFormatter={fmtKR} />
                <Tooltip
                  contentStyle={{ background: '#08090A', border: '1px solid #23252A', borderRadius: 8, color: '#F7F8F8' }}
                  formatter={(v: number) => `₩${fmtKR(v)}`}
                />
                <Legend wrapperStyle={{ fontSize: 11, color: '#8A8F98' }} />
                <Bar dataKey="revenue" name="순매출" fill="#828FFF" opacity={0.7} />
                <Line type="monotone" dataKey="contribution_margin" name="공헌이익" stroke="#27A644" strokeWidth={2} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          ) : <Empty />}
        </div>

        <div className={`${PANEL} p-5`}>
          <h2 className="text-sm font-semibold text-[#F7F8F8] mb-3">채널별 매출 비중</h2>
          {data && data.channels.length ? (
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={data.channels.slice(0, 12)}
                  dataKey="revenue"
                  nameKey="channel_name"
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={90}
                  paddingAngle={2}
                >
                  {data.channels.slice(0, 12).map((_: any, i: number) => (
                    <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ background: '#08090A', border: '1px solid #23252A', borderRadius: 8, color: '#F7F8F8', fontSize: 11 }}
                  formatter={(v: number, name: string) => [`₩${fmtKR(v)}`, name]}
                />
                <Legend wrapperStyle={{ fontSize: 10, color: '#8A8F98' }} />
              </PieChart>
            </ResponsiveContainer>
          ) : <Empty />}
        </div>
      </div>

      {/* 품목 도넛 + 공헌이익률 도넛 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-5">
        <div className={`${PANEL} p-5`}>
          <h2 className="text-sm font-semibold text-[#F7F8F8] mb-3">품목별 매출 비중</h2>
          {data && data.products.length ? (
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={data.products.slice(0, 15)}
                  dataKey="revenue"
                  nameKey="product_name"
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={90}
                  paddingAngle={2}
                >
                  {data.products.slice(0, 15).map((_: any, i: number) => (
                    <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ background: '#08090A', border: '1px solid #23252A', borderRadius: 8, color: '#F7F8F8', fontSize: 11 }}
                  formatter={(v: number, name: string) => [`₩${fmtKR(v)}`, name]}
                />
                <Legend wrapperStyle={{ fontSize: 10, color: '#8A8F98' }} />
              </PieChart>
            </ResponsiveContainer>
          ) : <Empty />}
        </div>

        <div className={`${PANEL} p-5`}>
          <h2 className="text-sm font-semibold text-[#F7F8F8] mb-3">품목별 공헌이익 (Top 12)</h2>
          {data && data.products.length ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={data.products.slice(0, 12)} layout="vertical" margin={{ left: 60 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#23252A" />
                <XAxis type="number" stroke="#62666D" tick={{ fill: '#8A8F98', fontSize: 11 }} tickFormatter={fmtKR} />
                <YAxis type="category" dataKey="product_name" stroke="#62666D" tick={{ fill: '#8A8F98', fontSize: 11 }} width={70} />
                <Tooltip
                  contentStyle={{ background: '#08090A', border: '1px solid #23252A', borderRadius: 8, color: '#F7F8F8' }}
                  formatter={(v: number) => `₩${fmtKR(v)}`}
                />
                <Bar dataKey="contribution_margin" fill="#27A644" />
              </BarChart>
            </ResponsiveContainer>
          ) : <Empty />}
        </div>
      </div>

      {/* 품목 테이블 */}
      <div className={`${PANEL} p-5 mb-5`}>
        <h2 className="text-sm font-semibold text-[#F7F8F8] mb-3">품목별 상세</h2>
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
                data.products.map((p: any) => (
                  <tr key={p.product_id} className="border-b border-[#1A1B1F] hover:bg-[#0A0B0D]">
                    <td className="py-2 px-2 text-[#F7F8F8]">{p.product_name}</td>
                    <td className="py-2 px-2 text-right font-mono text-[#D0D6E0]">{fmtNum(Math.round(p.pcs))}</td>
                    <td className="py-2 px-2 text-right font-mono text-[#D0D6E0]">{fmtNum(p.orders)}</td>
                    <td className="py-2 px-2 text-right font-mono text-[#F7F8F8]">₩{fmtKR(p.revenue)}</td>
                    <td className="py-2 px-2 text-right font-mono text-[#27A644]">₩{fmtKR(p.contribution_margin)}</td>
                    <td className="py-2 px-2 text-right font-mono text-[#828FFF]">{fmtPct(p.cm_rate)}</td>
                  </tr>
                ))
              ) : (
                <tr><td colSpan={6} className="py-8 text-center text-[#62666D]">데이터가 없습니다. 엑셀을 업로드해보세요.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 채널 테이블 */}
      <div className={`${PANEL} p-5`}>
        <h2 className="text-sm font-semibold text-[#F7F8F8] mb-3">채널별 상세</h2>
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
                data.channels.map((c: any) => (
                  <tr key={c.channel_id} className="border-b border-[#1A1B1F] hover:bg-[#0A0B0D]">
                    <td className="py-2 px-2 text-[#F7F8F8]">{c.channel_name}</td>
                    <td className="py-2 px-2 text-[#8A8F98]">{c.channel_category || '-'}</td>
                    <td className="py-2 px-2 text-right font-mono text-[#D0D6E0]">{fmtNum(Math.round(c.pcs))}</td>
                    <td className="py-2 px-2 text-right font-mono text-[#D0D6E0]">{fmtNum(c.orders)}</td>
                    <td className="py-2 px-2 text-right font-mono text-[#F7F8F8]">₩{fmtKR(c.revenue)}</td>
                    <td className="py-2 px-2 text-right font-mono text-[#27A644]">₩{fmtKR(c.contribution_margin)}</td>
                    <td className="py-2 px-2 text-right font-mono text-[#828FFF]">{fmtPct(c.cm_rate)}</td>
                  </tr>
                ))
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
  const fileRef = useRef<HTMLInputElement>(null);

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
      setResult(data);
      onUploaded();
    } catch (e: any) {
      setResult({ error: e.message || String(e) });
    } finally {
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
              accept=".xlsx,.xls,.csv"
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
                업로드 및 파싱 중...
              </div>
            )}

            {result && !result.error && (
              <div className={`${SUBPANEL} p-3 mt-4 text-xs`}>
                {result.duplicate_file ? (
                  <div className="text-[#F0BF00] mb-1">⚠ 이미 업로드된 파일입니다.</div>
                ) : (
                  <div className="text-[#27A644] mb-1">✓ 업로드 성공</div>
                )}
                <div className="grid grid-cols-4 gap-2 text-[#D0D6E0] font-mono">
                  <div><span className="text-[#62666D]">총행: </span>{result.row_total}</div>
                  <div><span className="text-[#62666D]">신규: </span>{result.row_inserted}</div>
                  <div><span className="text-[#62666D]">중복: </span>{result.row_duplicate}</div>
                  <div><span className="text-[#62666D]">미매핑: </span>{result.row_unmatched}</div>
                </div>
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
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[#62666D] mb-3">최근 업로드 이력</h3>
          <div className="space-y-1.5 max-h-[260px] overflow-y-auto">
            {batches.length === 0 ? (
              <div className="text-xs text-[#62666D]">업로드 이력이 없습니다.</div>
            ) : batches.map(b => (
              <div key={b.id} className={`${SUBPANEL} p-2.5 text-xs flex items-center justify-between`}>
                <div className="min-w-0 flex-1">
                  <div className="text-[#F7F8F8] truncate">{b.channel_name} · <span className="text-[#8A8F98]">{b.file_name}</span></div>
                  <div className="text-[10px] text-[#62666D] font-mono mt-0.5">
                    {b.period_start} ~ {b.period_end} · 신규 {b.row_inserted} · 중복 {b.row_duplicate} · 미매핑 {b.row_unmatched}
                  </div>
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded font-medium ${
                  b.status === 'done' ? 'bg-[#27A644]/15 text-[#27A644]' : 'bg-[#F0BF00]/15 text-[#F0BF00]'
                }`}>{b.status}</span>
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

  const resolve = async (it: UnmatchedItem, productId: number | null, unitPerSet: number, isExcluded: boolean) => {
    setBusy(it.id);
    try {
      await fetch(`${API_BASE}/api/csa/mapping`, {
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
      onResolved();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={`${PANEL} p-5`}>
      <h2 className="text-sm font-semibold mb-3">매핑 대기 큐 ({unmatched.length})</h2>
      <p className="text-xs text-[#62666D] mb-4">
        각 채널의 원본 상품명을 자사 표준 품목으로 매핑하고, 1세트당 낱개 수(입수)를 입력하세요. 카운트 대상이 아니면 "제외"로 처리합니다.
      </p>
      {unmatched.length === 0 ? (
        <div className="text-center py-10 text-[#62666D] text-sm">매핑 대기 항목이 없습니다.</div>
      ) : (
        <div className="space-y-2">
          {unmatched.map(it => (
            <UnmatchedRow
              key={it.id}
              item={it}
              products={products}
              busy={busy === it.id}
              onResolve={resolve}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function UnmatchedRow({
  item, products, busy, onResolve,
}: {
  item: UnmatchedItem; products: Product[]; busy: boolean;
  onResolve: (it: UnmatchedItem, productId: number | null, unitPerSet: number, isExcluded: boolean) => void;
}) {
  const [productId, setProductId] = useState<number | ''>(item.llm_suggested_product_id || '');
  const [unitPerSet, setUnitPerSet] = useState<number>(item.llm_suggested_unit_per_set || 1);
  const [excluded, setExcluded] = useState(false);

  return (
    <div className={`${SUBPANEL} p-3 grid grid-cols-12 gap-3 items-center text-xs`}>
      <div className="col-span-4">
        <div className="text-[10px] uppercase tracking-wider text-[#62666D]">{item.channel_name}</div>
        <div className="text-[#F7F8F8] font-medium truncate">{item.raw_product_name}</div>
        {item.raw_option_name && (
          <div className="text-[#8A8F98] text-[11px] truncate">{item.raw_option_name}</div>
        )}
        <div className="text-[10px] text-[#62666D] mt-0.5">
          발견 {item.occurrence_count}회 · 누적수량 {fmtNum(Math.round(item.total_qty))}
        </div>
      </div>
      <div className="col-span-3">
        <label className="block text-[10px] text-[#62666D] uppercase tracking-wider mb-1">표준 품목</label>
        <select
          value={productId}
          onChange={(e) => setProductId(e.target.value ? parseInt(e.target.value) : '')}
          disabled={excluded}
          className="w-full bg-[#0F1011] border border-[#23252A] rounded px-2 py-1.5 text-[#F7F8F8] disabled:opacity-50"
        >
          <option value="">— 선택 —</option>
          {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      <div className="col-span-2">
        <label className="block text-[10px] text-[#62666D] uppercase tracking-wider mb-1">1세트=N개입</label>
        <input
          type="number"
          min={1}
          value={unitPerSet}
          onChange={(e) => setUnitPerSet(parseInt(e.target.value) || 1)}
          disabled={excluded}
          className="w-full bg-[#0F1011] border border-[#23252A] rounded px-2 py-1.5 text-[#F7F8F8] disabled:opacity-50 font-mono text-right"
        />
      </div>
      <div className="col-span-3 flex items-center gap-2 justify-end">
        <label className="flex items-center gap-1.5 text-[#8A8F98] cursor-pointer">
          <input
            type="checkbox"
            checked={excluded}
            onChange={(e) => setExcluded(e.target.checked)}
            className="accent-[#EB5757]"
          />
          제외
        </label>
        <button
          onClick={() => onResolve(item, excluded ? null : (productId || null) as any, unitPerSet, excluded)}
          disabled={busy || (!excluded && !productId)}
          className="px-3 py-1.5 bg-[#828FFF] hover:bg-[#7070FF] disabled:opacity-40 text-white rounded text-xs font-medium"
        >
          {busy ? '저장 중…' : '저장'}
        </button>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Variable Cost Tab
// ──────────────────────────────────────────────────────────────

function CostTab({
  products, variableCosts, authHeaders, onUpdated,
}: {
  products: Product[]; variableCosts: VariableCost[];
  authHeaders: () => HeadersInit; onUpdated: () => void;
}) {
  const costMap = useMemo(() => {
    const m: Record<number, VariableCost> = {};
    variableCosts.filter(v => !v.channel_id).forEach(v => { m[v.product_id] = v; });
    return m;
  }, [variableCosts]);

  const [draft, setDraft] = useState<Record<number, number>>({});
  const [savingId, setSavingId] = useState<number | null>(null);

  const save = async (productId: number) => {
    const cost = draft[productId];
    if (cost === undefined) return;
    setSavingId(productId);
    try {
      await fetch(`${API_BASE}/api/csa/variable-costs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ product_id: productId, cost_per_pcs: cost }),
      });
      onUpdated();
      setDraft(d => { const nd = { ...d }; delete nd[productId]; return nd; });
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className={`${PANEL} p-5`}>
      <h2 className="text-sm font-semibold mb-3">품목별 변동비 (낱개당)</h2>
      <p className="text-xs text-[#62666D] mb-4">
        공헌이익 = 순매출 − (낱개수량 × 낱개당 변동비) − 채널 수수료. 변동비를 변경하면 즉시 전체 집계가 재계산됩니다.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {products.map(p => {
          const current = costMap[p.id]?.cost_per_pcs ?? 0;
          const value = draft[p.id] !== undefined ? draft[p.id] : current;
          const dirty = draft[p.id] !== undefined && draft[p.id] !== current;
          return (
            <div key={p.id} className={`${SUBPANEL} p-3 flex items-center gap-3`}>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-[#F7F8F8] truncate">{p.name}</div>
                <div className="text-[10px] text-[#62666D]">{p.category || '-'}</div>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-xs text-[#62666D]">₩</span>
                <input
                  type="number"
                  step={1}
                  min={0}
                  value={value}
                  onChange={(e) => setDraft(d => ({ ...d, [p.id]: parseFloat(e.target.value) || 0 }))}
                  className="w-24 bg-[#0F1011] border border-[#23252A] rounded px-2 py-1.5 text-[#F7F8F8] font-mono text-right text-sm"
                />
              </div>
              <button
                onClick={() => save(p.id)}
                disabled={savingId === p.id || !dirty}
                className={`px-3 py-1.5 rounded text-xs font-medium ${
                  dirty ? 'bg-[#828FFF] text-white hover:bg-[#7070FF]' : 'bg-[#1A1B1F] text-[#62666D]'
                } disabled:opacity-40`}
              >
                {savingId === p.id ? '저장 중' : dirty ? '저장' : '저장됨'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Plan Tab (Phase 5 placeholder + 실적 표시)
// ──────────────────────────────────────────────────────────────

function PlanTab({ dashboard }: { dashboard: DashboardData | null }) {
  return (
    <div className={`${PANEL} p-5`}>
      <h2 className="text-sm font-semibold mb-3">사업계획 vs 실적 비교</h2>
      <p className="text-xs text-[#62666D] mb-4">
        사업계획(연/월 매출, 채널별·품목별 목표, 공헌이익 목표)을 업로드하면 실적과 자동 비교합니다.
      </p>
      <div className={`${SUBPANEL} p-5 text-sm text-[#8A8F98] leading-relaxed`}>
        <div className="font-mono text-[10px] uppercase tracking-wider text-[#62666D] mb-2">준비 단계</div>
        <div className="text-[#D0D6E0]">
          이 기능은 다음 릴리스에 활성화됩니다.<br/>
          사업계획 엑셀 양식을 공유해 주시면 매핑 로직과 비교 차트(달성률·차이·추세선)를 연결해 드리겠습니다.
        </div>
        {dashboard && (
          <div className="mt-4 pt-4 border-t border-[#23252A] text-xs">
            <div className="text-[#62666D] mb-1">현재 기간 실적 요약</div>
            <div className="text-[#F7F8F8] font-mono">
              {dashboard.period_start} ~ {dashboard.period_end}<br/>
              매출 ₩{fmtKR(dashboard.summary.revenue)} · 공헌이익 ₩{fmtKR(dashboard.summary.contribution_margin)} ({fmtPct(dashboard.summary.cm_rate)})
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Reusable bits
// ──────────────────────────────────────────────────────────────

function KpiCard({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent?: string }) {
  return (
    <div className={`${PANEL} p-5`}>
      <div className="text-[10px] font-mono uppercase tracking-wider text-[#62666D] mb-2">{label}</div>
      <div className="text-2xl font-semibold tracking-tight" style={{ color: accent || TEXT_PRIMARY }}>{value}</div>
      {hint && <div className="text-[11px] text-[#62666D] mt-1.5">{hint}</div>}
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

function Empty() {
  return (
    <div className="h-[300px] flex items-center justify-center text-sm text-[#62666D]">
      데이터가 없습니다. 엑셀 업로드 탭에서 데이터를 추가해 주세요.
    </div>
  );
}
