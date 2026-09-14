'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Navigation } from '@/components/layout/Navigation';
import { MatrixTable } from '@/components/MatrixTable';
import { LoadingOverlay } from '@/components/LoadingOverlay';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
  ComposedChart, Line, Legend, PieChart, Pie,
} from 'recharts';

// ─────────────────────────────────────────────────────────
// API helpers
// ─────────────────────────────────────────────────────────
const getAuthHeaders = (): Record<string, string> => {
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) h['Authorization'] = `Bearer ${token}`;
  return h;
};
const getJSON = async <T,>(path: string, def: T): Promise<T> => {
  try {
    const r = await fetch(`/api${path}`, { headers: getAuthHeaders() });
    if (!r.ok) throw new Error();
    return await r.json();
  } catch { return def; }
};
const send = async (path: string, method: string, body?: any): Promise<{ ok: boolean; data: any }> => {
  try {
    const r = await fetch(`/api${path}`, {
      method, headers: getAuthHeaders(),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = await r.json().catch(() => ({}));
    return { ok: r.ok, data };
  } catch { return { ok: false, data: {} }; }
};

// ─────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────
interface Warehouse { id: number; code: string | null; name: string; location: string | null; is_active: boolean; sort_order: number; notes: string | null; }
interface ChannelRow { channel_id: string; channel_name: string; category: string | null; warehouse_id: number | null; is_active: boolean | null; }
interface StockRow { product_id: number; product_code: string; product_name: string; category: string; warehouse_id: number | null; warehouse_name: string | null; qty: number; safety_stock: number | null; reorder_point: number | null; status: string; }
interface FlowRow { product_id: number; product_code: string; product_name: string; category: string; opening: number; inflow: number; sold: number; adjustment: number; correction: number; transfer_out: number; closing: number; }
interface ReplItem extends StockRow { reorder_qty: number; target_stock: number; suggest_qty: number; shortfall: number; }
interface SafetyRow { id: number; warehouse_id: number | null; warehouse_name: string; product_id: number; product_name: string; category: string; safety_stock: number; reorder_point: number; reorder_qty: number; target_stock: number; is_active: boolean; }
interface ProductRow { id: number; code: string; name: string; category: string; }
interface CountSession { id: number; warehouse_id: number; warehouse_name: string; count_date: string; period_type: string; status: string; title: string | null; confirmed_at: string | null; confirmed_by: string | null; }
interface CountLine { line_id: number; product_id: number; product_code: string; product_name: string; category: string; system_qty: number; counted_qty: number | null; diff: number; reason: string; }
interface Dashboard {
  as_of: string; total_qty: number; product_count: number; shortage_count: number;
  out_of_stock_count: number; warehouse_count: number;
  by_warehouse: { warehouse_id: number; warehouse_name: string; qty: number }[];
  by_category: { category: string; qty: number }[];
  replenishment_top: ReplItem[]; replenishment_total: number;
}

interface TrendPoint { period: string; inbound: number; outbound: number; net: number; closing: number; }
interface HeatRow { product_id: number; product_name: string; category: string; cells: number[]; total: number; }

type Tab = '대시보드' | '재고 현황' | '재고 실사' | '보충 알림' | '설정';
type SettingsTab = '창고' | '채널-창고 매핑' | '안전재고' | '기초재고 업로드';

// ─────────────────────────────────────────────────────────
// UI atoms
// ─────────────────────────────────────────────────────────
const C = {
  card: 'bg-bg-1 border border-border-primary rounded-xl',
  input: 'bg-bg-0 border border-border-primary rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-brand',
  btn: 'px-3 py-2 rounded-lg text-sm font-semibold transition-colors',
  btnPrimary: 'bg-brand hover:bg-brand-hover text-white',
  btnGhost: 'bg-bg-inset hover:bg-border-primary text-text-secondary border border-border-primary',
  th: 'text-left text-xs font-semibold text-text-tertiary px-3 py-2 border-b border-border-primary whitespace-nowrap',
  td: 'px-3 py-2 text-sm text-text-secondary border-b border-bg-inset whitespace-nowrap',
};
const fmt = (n: number | null | undefined) => (n === null || n === undefined ? '-' : Number(n).toLocaleString('ko-KR'));
const numShort = (n: number) => { const a = Math.abs(n || 0); if (a >= 1e8) return (n / 1e8).toFixed(2).replace(/\.00$/, '') + '억'; if (a >= 1e4) return (n / 1e4).toFixed(1).replace(/\.0$/, '') + '만'; return Math.round(n || 0).toLocaleString('ko-KR'); };
const won = (n: number | null | undefined) => (n === null || n === undefined ? '-' : '₩' + Math.round(Number(n)).toLocaleString('ko-KR'));
const wonShort = (n: number) => '₩' + numShort(n);

function StatusBadge({ s }: { s: string }) {
  const m: Record<string, string> = {
    정상: 'bg-success/15 text-success-light', 주의: 'bg-warning/15 text-warning',
    부족: 'bg-danger/15 text-danger', 품절: 'bg-danger/25 text-[#FF7A7A]',
  };
  return <span className={`px-2 py-0.5 rounded-md text-xs font-semibold ${m[s] || 'bg-border-primary text-text-tertiary'}`}>{s}</span>;
}

function StatCard({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className={`${C.card} p-4`}>
      <div className="text-[11px] text-text-tertiary mb-1 truncate" title={label}>{label}</div>
      <div className={`text-lg font-bold tabular-nums leading-tight break-keep ${tone || 'text-text-primary'}`}>{value}</div>
      {sub && <div className="text-[11px] text-text-quaternary mt-1 truncate">{sub}</div>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Date helpers
// ─────────────────────────────────────────────────────────
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const todayISO = () => iso(new Date());
function presetRange(kind: string): { start: string; end: string } {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  if (kind === '7d') { const s = new Date(now); s.setDate(now.getDate() - 6); return { start: iso(s), end: iso(now) }; }
  if (kind === '14d') { const s = new Date(now); s.setDate(now.getDate() - 13); return { start: iso(s), end: iso(now) }; }
  if (kind === 'thisMonth') return { start: iso(new Date(y, m, 1)), end: iso(new Date(y, m + 1, 0)) };
  if (kind === 'lastMonth') return { start: iso(new Date(y, m - 1, 1)), end: iso(new Date(y, m, 0)) };
  if (kind === 'thisQuarter') { const q = Math.floor(m / 3); return { start: iso(new Date(y, q * 3, 1)), end: iso(new Date(y, q * 3 + 3, 0)) }; }
  if (kind === 'lastQuarter') { const q = Math.floor(m / 3) - 1; const yy = q < 0 ? y - 1 : y; const qq = (q + 4) % 4; return { start: iso(new Date(yy, qq * 3, 1)), end: iso(new Date(yy, qq * 3 + 3, 0)) }; }
  if (kind === 'lastYear') return { start: iso(new Date(y - 1, 0, 1)), end: iso(new Date(y - 1, 11, 31)) };
  return { start: todayISO(), end: todayISO() };
}
const RANGE_PRESETS: [string, string][] = [
  ['7d', '7일'], ['14d', '14일'], ['thisMonth', '당월'], ['lastMonth', '전월'],
  ['thisQuarter', '당분기'], ['lastQuarter', '전분기'], ['lastYear', '전년도'],
];
const CHART_COLORS = ['#5E6AD2', '#27A644', '#F0BF00', '#00B8CC', '#EB5757', '#A855F7', '#F97316', '#14B8A6'];

// ═════════════════════════════════════════════════════════
// Main
// ═════════════════════════════════════════════════════════
export default function InventoryPage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('대시보드');
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => { if (!isLoading && !user) router.replace('/login'); }, [isLoading, user, router]);

  const loadMasters = useCallback(async () => {
    const [w, c] = await Promise.all([
      getJSON<{ warehouses: Warehouse[] }>('/inventory/warehouses', { warehouses: [] }),
      getJSON<{ categories: string[] }>('/inventory/categories', { categories: [] }),
    ]);
    setWarehouses(w.warehouses); setCategories(c.categories);
  }, []);
  useEffect(() => { if (user) loadMasters(); }, [user, loadMasters, refreshKey]);

  if (isLoading || !user) return <div className="min-h-screen bg-bg-0" />;

  const tabs: { key: Tab; icon: string; sub: string }[] = [
    { key: '대시보드', icon: '📊', sub: '요약·흐름' },
    { key: '재고 현황', icon: '📦', sub: '제품·원부재료·포장재' },
    { key: '재고 실사', icon: '📋', sub: '실사·가액' },
    { key: '보충 알림', icon: '🔔', sub: '재주문' },
    { key: '설정', icon: '⚙️', sub: '창고·매핑' },
  ];

  return (
    <div className="min-h-screen bg-bg-0">
      <Navigation />
      <main className="max-w-[1400px] mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-xl font-bold text-text-primary">재고 관리</h1>
            <p className="text-sm text-text-tertiary mt-0.5">완제품(판매연동)·원부재료·포장재 재고와 실사·가액을 한 곳에서 관리합니다.</p>
          </div>
        </div>

        <div className="flex gap-1.5 mb-5 flex-wrap">
          {tabs.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`group flex items-center gap-2 px-3.5 py-2 rounded-xl border transition-all ${
                tab === t.key
                  ? 'bg-brand/10 border-brand/40 text-accent shadow-[0_1px_3px_rgba(0,0,0,0.15)]'
                  : 'bg-bg-1 border-border-primary text-text-tertiary hover:text-text-secondary hover:border-border-secondary'}`}>
              <span className="text-base leading-none">{t.icon}</span>
              <span className="text-left leading-tight">
                <span className="block text-[13px] font-semibold">{t.key}</span>
                <span className={`block text-[10px] ${tab === t.key ? 'text-accent/70' : 'text-text-quaternary'}`}>{t.sub}</span>
              </span>
            </button>
          ))}
        </div>

        {tab === '대시보드' && <DashboardTab warehouses={warehouses} />}
        {tab === '재고 현황' && <StockHubTab warehouses={warehouses} categories={categories} />}
        {tab === '보충 알림' && <ReplenishmentTab warehouses={warehouses} />}
        {tab === '재고 실사' && <CountTab warehouses={warehouses} />}
        {tab === '설정' && <SettingsTab warehouses={warehouses} onChange={() => setRefreshKey((k) => k + 1)} />}
      </main>
    </div>
  );
}

// ═════════════════════════════════════════════════════════
// 대시보드
// ═════════════════════════════════════════════════════════
function DashboardTab({ warehouses }: { warehouses: Warehouse[] }) {
  const [d, setD] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(false);
  const [range, setRange] = useState(presetRange('thisMonth'));      // 적용된(조회된) 기간
  const [draftRange, setDraftRange] = useState(presetRange('thisMonth')); // 입력 중(미적용)
  const [gran, setGran] = useState<'month' | 'week' | 'day'>('day');
  const [whId, setWhId] = useState<number | ''>('');
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [heat, setHeat] = useState<{ months: string[]; rows: HeatRow[] }>({ months: [], rows: [] });
  const [logi, setLogi] = useState<any>(null);
  const [netMx, setNetMx] = useState<any>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setD(await getJSON<Dashboard | null>(`/inventory/dashboard?as_of=${range.end}`, null));
    setLoading(false);
  }, [range.end]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { getJSON<any>(`/inventory/logistics/dashboard?start=${range.start}&end=${range.end}`, null).then(setLogi); }, [range]);
  useEffect(() => {
    const whq = whId ? `&warehouse_id=${whId}` : '';
    getJSON<any>(`/inventory/stock-net-matrix?start=${range.start}&end=${range.end}${whq}`, null).then(setNetMx);
  }, [range, whId]);

  const loadTrend = useCallback(async () => {
    const whq = whId ? `&warehouse_id=${whId}` : '';
    const [t, h] = await Promise.all([
      getJSON<{ series: TrendPoint[] }>(`/inventory/stock-trend?start=${range.start}&end=${range.end}&granularity=${gran}${whq}`, { series: [] }),
      getJSON<{ months: string[]; rows: HeatRow[] }>(`/inventory/heatmap?start=${range.start}&end=${range.end}&granularity=${gran}&top_n=15${whq}`, { months: [], rows: [] }),
    ]);
    setTrend(t.series); setHeat(h);
  }, [range, gran, whId]);
  useEffect(() => { loadTrend(); }, [loadTrend]);

  const heatMax = Math.max(1, ...heat.rows.flatMap((r) => r.cells.map((c) => Math.abs(c))));
  const heatColor = (v: number) => {
    if (v === 0) return 'transparent';
    const a = Math.min(Math.abs(v) / heatMax, 1) * 0.85 + 0.1;
    return v > 0 ? `rgba(39,166,68,${a})` : `rgba(235,87,87,${a})`;
  };

  return (
    <div className="space-y-5 relative">
      <LoadingOverlay show={loading} />
      <div className={`${C.card} p-3 flex flex-wrap items-center gap-2 sticky top-[52px] z-10`}>
        <span className="text-sm font-semibold text-text-primary">기간</span>
        <input type="date" value={draftRange.start} onChange={(e) => setDraftRange({ ...draftRange, start: e.target.value })} className={C.input} />
        <span className="text-text-quaternary">~</span>
        <input type="date" value={draftRange.end} onChange={(e) => setDraftRange({ ...draftRange, end: e.target.value })} className={C.input} />
        <button onClick={() => setRange(draftRange)} className={`${C.btn} ${C.btnPrimary} ${(draftRange.start !== range.start || draftRange.end !== range.end) ? 'ring-2 ring-brand/50' : ''}`}>조회</button>
        {(draftRange.start !== range.start || draftRange.end !== range.end) && <span className="text-[11px] text-warning">변경됨 — 조회</span>}
        <div className="flex flex-wrap gap-1">
          {RANGE_PRESETS.map(([k, l]) => <button key={k} onClick={() => { const r = presetRange(k); setDraftRange(r); setRange(r); }} className={`${C.btn} ${C.btnGhost} px-2 py-1`}>{l}</button>)}
        </div>
        <div className="flex bg-bg-0 border border-border-primary rounded-lg p-0.5">
          {(['month', 'week', 'day'] as const).map((g) => (
            <button key={g} onClick={() => setGran(g)} className={`${C.btn} px-2.5 py-1 ${gran === g ? C.btnPrimary : 'text-text-tertiary'}`}>{g === 'month' ? '월' : g === 'week' ? '주' : '일'}</button>
          ))}
        </div>
        <select value={whId} onChange={(e) => setWhId(e.target.value ? Number(e.target.value) : '')} className={C.input}>
          <option value="">전체 창고</option>
          {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        <span className="text-xs text-text-quaternary ml-auto">현황 기준일 = {range.end}</span>
        {loading && <span className="text-xs text-text-quaternary">불러오는 중…</span>}
      </div>

      {d && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <StatCard label="총 재고 수량 (낱개)" value={numShort(d.total_qty)} />
            <StatCard label="관리 품목 수" value={fmt(d.product_count)} />
            <StatCard label="창고 수" value={fmt(d.warehouse_count)} />
            <StatCard label="보충 필요" value={fmt(d.shortage_count)} tone="text-warning" sub="재주문점 이하" />
            <StatCard label="품절" value={fmt(d.out_of_stock_count)} tone="text-danger" sub="현재고 0 이하" />
          </div>

          <StockValuationPanel />

          {(() => {
            const oos = d.out_of_stock_count, short = d.shortage_count;
            const normal = Math.max(d.product_count - oos - short, 0);
            const segs = [
              { label: '정상', v: normal, c: 'var(--color-success)' },
              { label: '보충 필요', v: short, c: 'var(--color-warning)' },
              { label: '품절', v: oos, c: 'var(--color-danger)' },
            ];
            const tot = Math.max(d.product_count, 1);
            return (
              <div className={`${C.card} p-4`}>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-semibold text-text-primary">재고 상태 분포</div>
                  <div className="text-xs text-text-tertiary">총 {fmt(d.product_count)} 품목</div>
                </div>
                <div className="flex h-4 rounded-lg overflow-hidden mb-2">
                  {segs.map((s) => s.v > 0 && <div key={s.label} style={{ width: `${(s.v / tot) * 100}%`, background: s.c }} title={`${s.label} ${s.v}`} />)}
                </div>
                <div className="flex flex-wrap gap-4">
                  {segs.map((s) => (
                    <div key={s.label} className="flex items-center gap-1.5 text-xs">
                      <span className="w-2.5 h-2.5 rounded-sm" style={{ background: s.c }} />
                      <span className="text-text-tertiary">{s.label}</span>
                      <span className="text-text-primary font-semibold">{fmt(s.v)}</span>
                      <span className="text-text-quaternary">({Math.round((s.v / tot) * 100)}%)</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* 물류 작업 요약 (생산 실적 대시보드 기능 병합) */}
          {logi && logi.record_count > 0 && (
            <div className={`${C.card} p-4 border-l-2 border-l-cyan`}>
              <div className="flex items-center justify-between mb-3">
                <div className="text-sm font-semibold text-text-primary">물류 작업 요약 <span className="text-xs text-text-quaternary">({range.start}~{range.end})</span></div>
                <a href="/inventory/logistics" className="text-xs text-accent hover:underline">물류 작업 실적 →</a>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-3">
                <StatCard label="총 작업량" value={numShort(logi.total_qty)} sub={`${fmt(logi.record_count)}건`} />
                <StatCard label="총 작업액" value={numShort(logi.total_amount)} />
                <StatCard label="노무비" value={numShort(logi.total_labor)} tone="text-cyan" sub={`노무비율 ${logi.labor_ratio}%`} />
                <StatCard label="채산성" value={`${logi.profitability}배`} tone={logi.profitability >= 3 ? 'text-success-light' : 'text-warning'} />
                <StatCard label="시간당 작업량" value={fmt(logi.hourly_qty)} sub={`${numShort(logi.total_hours)}h`} />
              </div>
              {logi.by_type?.length > 0 && (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={logi.by_type.slice(0, 8)} layout="vertical" margin={{ left: 30 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-bg-inset)" />
                    <XAxis type="number" tick={{ fill: 'var(--color-text-tertiary)', fontSize: 11 }} />
                    <YAxis type="category" dataKey="work_type" tick={{ fill: 'var(--color-text-tertiary)', fontSize: 11 }} width={80} />
                    <Tooltip contentStyle={{ background: 'var(--color-bg-level-1)', border: '1px solid var(--color-border-primary)', borderRadius: 8 }} formatter={(v: any) => fmt(v)} />
                    <Bar dataKey="qty" name="작업량" radius={[0, 4, 4, 0]}>
                      {logi.by_type.slice(0, 8).map((_: any, i: number) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          )}

          {/* 기간 재고 흐름 + 입출고 히트맵 */}
          <div className={`${C.card} p-4`}>
            <div className="text-sm font-semibold text-text-primary mb-3">재고 흐름 · {gran === 'month' ? '월별' : gran === 'week' ? '주별' : '일별'} (생산입고·판매출고·기말재고)</div>
            {trend.length === 0 ? <Empty msg="이 기간 흐름 데이터 없음" /> : (
              <ResponsiveContainer width="100%" height={280}>
                <ComposedChart data={trend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-bg-inset)" />
                  <XAxis dataKey="period" tick={{ fill: 'var(--color-text-tertiary)', fontSize: 10 }} />
                  <YAxis yAxisId="l" tick={{ fill: 'var(--color-text-tertiary)', fontSize: 10 }} />
                  <YAxis yAxisId="r" orientation="right" tick={{ fill: 'var(--color-text-tertiary)', fontSize: 10 }} />
                  <Tooltip contentStyle={{ background: 'var(--color-bg-level-1)', border: '1px solid var(--color-border-primary)', borderRadius: 8 }} formatter={(v: any) => fmt(v)} />
                  <Legend />
                  <Bar yAxisId="l" dataKey="inbound" name="생산입고" fill="var(--color-success)" />
                  <Bar yAxisId="l" dataKey="outbound" name="판매출고" fill="var(--color-danger)" />
                  <Line yAxisId="r" type="monotone" dataKey="closing" name="기말재고" stroke="var(--color-brand-bg)" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className={`${C.card} p-4`}>
            <div className="text-sm font-semibold text-text-primary mb-1">재고 입출고 히트맵 (순증감 = 생산−판매)</div>
            <div className="text-xs text-text-quaternary mb-3">초록=순증(생산 우위) · 빨강=순감(판매 우위) · 활동 상위 15품목</div>
            {heat.rows.length === 0 ? <Empty msg="데이터 없음" /> : (
              <div className="overflow-x-auto">
                <table className="border-collapse">
                  <thead><tr>
                    <th className="text-left text-xs font-semibold text-text-tertiary px-2 py-1 sticky left-0 bg-bg-1">품목</th>
                    {heat.months.map((m) => <th key={m} className="text-xs text-text-tertiary px-1 py-1 whitespace-nowrap">{m.slice(5)}</th>)}
                    <th className="text-xs text-text-tertiary px-2 py-1">누계</th>
                  </tr></thead>
                  <tbody>
                    {heat.rows.map((r) => (
                      <tr key={r.product_id}>
                        <td className="text-xs text-text-primary px-2 py-1 whitespace-nowrap sticky left-0 bg-bg-1">{r.product_name}</td>
                        {r.cells.map((c, i) => (
                          <td key={i} className="text-[10px] text-center px-1 py-1 whitespace-nowrap" style={{ background: heatColor(c), color: Math.abs(c) / heatMax > 0.5 ? '#fff' : 'var(--color-text-tertiary)' }}
                            title={`${heat.months[i]}: ${c > 0 ? '+' : ''}${fmt(c)}`}>
                            {c === 0 ? '·' : (c > 0 ? '+' : '') + (Math.abs(c) >= 10000 ? Math.round(c / 1000) + 'k' : fmt(c))}
                          </td>
                        ))}
                        <td className={`text-xs px-2 py-1 text-right font-semibold ${r.total >= 0 ? 'text-success-light' : 'text-danger'}`}>{r.total > 0 ? '+' : ''}{fmt(r.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className={`${C.card} p-4`}>
              <div className="text-sm font-semibold text-text-primary mb-3">창고별 재고 분포</div>
              {d.by_warehouse.length === 0 ? <Empty /> : (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={d.by_warehouse} layout="vertical" margin={{ left: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-bg-inset)" />
                    <XAxis type="number" tick={{ fill: 'var(--color-text-tertiary)', fontSize: 11 }} />
                    <YAxis type="category" dataKey="warehouse_name" tick={{ fill: 'var(--color-text-tertiary)', fontSize: 11 }} width={90} />
                    <Tooltip contentStyle={{ background: 'var(--color-bg-level-1)', border: '1px solid var(--color-border-primary)', borderRadius: 8, color: 'var(--color-text-primary)' }}
                      formatter={(v: any) => fmt(v)} />
                    <Bar dataKey="qty" radius={[0, 4, 4, 0]}>
                      {d.by_warehouse.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
            <div className={`${C.card} p-4`}>
              <div className="text-sm font-semibold text-text-primary mb-3">카테고리별 재고 분포</div>
              {d.by_category.length === 0 ? <Empty /> : (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={d.by_category} layout="vertical" margin={{ left: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-bg-inset)" />
                    <XAxis type="number" tick={{ fill: 'var(--color-text-tertiary)', fontSize: 11 }} />
                    <YAxis type="category" dataKey="category" tick={{ fill: 'var(--color-text-tertiary)', fontSize: 11 }} width={90} />
                    <Tooltip contentStyle={{ background: 'var(--color-bg-level-1)', border: '1px solid var(--color-border-primary)', borderRadius: 8, color: 'var(--color-text-primary)' }}
                      formatter={(v: any) => fmt(v)} />
                    <Bar dataKey="qty" radius={[0, 4, 4, 0]}>
                      {d.by_category.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {(() => {
            const positives = d.by_category.filter((c) => c.qty > 0);
            const usingAbs = positives.length === 0;
            const src = (usingAbs ? d.by_category.map((c) => ({ ...c, qty: Math.abs(c.qty) })) : positives)
              .filter((c) => c.qty > 0).sort((a, b) => b.qty - a.qty);
            const PIE = src.slice(0, 10).map((c, i) => ({ name: c.category, value: c.qty, fill: CHART_COLORS[i % CHART_COLORS.length] }));
            return (
              <div className={`${C.card} p-4`}>
                <div className="text-sm font-semibold text-text-primary mb-1">{usingAbs ? '카테고리별 재고 포지션 규모 (원형)' : '현재 잔여 재고 비중 (카테고리별)'}</div>
                <div className="text-xs text-text-quaternary mb-3">기준일 {d.as_of} · {usingAbs ? '기초재고 미반영 → 순포지션(절대값) 규모 표시. 기초재고 업로드 시 실제 잔여재고로 전환' : '잔여(양수) 재고'}</div>
                {PIE.length === 0 ? <Empty msg="데이터 없음" /> : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-center">
                    <ResponsiveContainer width="100%" height={260}>
                      <PieChart>
                        <Pie data={PIE} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={95} label={(e: any) => e.name}>
                          {PIE.map((p, i) => <Cell key={i} fill={p.fill} />)}
                        </Pie>
                        <Tooltip contentStyle={{ background: 'var(--color-bg-level-1)', border: '1px solid var(--color-border-primary)', borderRadius: 8 }} formatter={(v: any) => fmt(v)} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="space-y-1">
                      {src.slice(0, 10).map((c, i) => (
                        <div key={c.category} className="flex items-center justify-between text-sm py-1 border-b border-bg-inset">
                          <span className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} /><span className="text-text-secondary">{c.category}</span></span>
                          <span className="text-text-primary tabular-nums">{usingAbs ? '−' : ''}{fmt(c.qty)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          <div className={`${C.card} p-4`}>
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-semibold text-text-primary">보충 필요 품목 (Top {d.replenishment_top.length})</div>
              <div className="text-xs text-text-tertiary">총 {fmt(d.replenishment_total)}건</div>
            </div>
            {d.replenishment_top.length === 0 ? <Empty msg="보충이 필요한 품목이 없습니다." /> : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead><tr>
                    <th className={C.th}>품목</th><th className={C.th}>카테고리</th><th className={C.th}>현재고</th>
                    <th className={C.th}>재주문점</th><th className={C.th}>권장 보충</th><th className={C.th}>상태</th>
                  </tr></thead>
                  <tbody>
                    {d.replenishment_top.map((r) => (
                      <tr key={r.product_id}>
                        <td className={C.td}>{r.product_name}</td>
                        <td className={C.td}>{r.category}</td>
                        <td className={C.td}>{fmt(r.qty)}</td>
                        <td className={C.td}>{fmt(r.reorder_point)}</td>
                        <td className={`${C.td} font-semibold text-accent`}>{fmt(r.suggest_qty)}</td>
                        <td className={C.td}><StatusBadge s={r.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <p className="text-xs text-text-quaternary">기준일 {d.as_of} · 판매 데이터 연동 실시간 계산</p>

          {/* 품목별 기간 재고 순증감 누계 */}
          <div className="bg-bg-1 border border-border-primary rounded-xl p-4">
            <div className="flex items-center justify-between mb-1 gap-2 flex-wrap">
              <div>
                <div className="text-sm font-semibold text-text-primary">품목별 재고 +/- 누계 (기간)</div>
                <p className="text-xs text-text-quaternary mt-0.5">{range.start} ~ {range.end} 기간 순증감(입고−판매출고±조정). 감소 큰 순.</p>
              </div>
              <button
                onClick={() => {
                  if (!netMx?.period_rows?.length) return;
                  const BOM = '﻿';
                  const lines = ['"품목류","품목","순증감"'];
                  netMx.period_rows.forEach((r: any) => lines.push([`"${r.category || ''}"`, `"${r.product}"`, `"${r.net}"`].join(',')));
                  const blob = new Blob([BOM + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
                  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
                  a.download = `품목별_재고순증감_${range.start}_${range.end}.csv`; a.click();
                }}
                disabled={!netMx?.period_rows?.length}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-bg-inset border border-border-primary text-text-secondary hover:bg-border-primary disabled:opacity-40"
              >⬇ 엑셀 다운로드</button>
            </div>
            <div className="overflow-x-auto max-h-[360px] overflow-y-auto mt-2">
              <table className="w-full">
                <thead className="sticky top-0 bg-bg-1"><tr>
                  <th className={`${C.th} text-left`}>품목류</th><th className={`${C.th} text-left`}>품목</th><th className={`${C.th} text-right`}>재고 순증감</th>
                </tr></thead>
                <tbody>
                  {!netMx?.period_rows?.length ? (
                    <tr><td colSpan={3} className="px-3 py-8 text-center text-sm text-text-quaternary">데이터 없음</td></tr>
                  ) : netMx.period_rows.map((r: any, i: number) => (
                    <tr key={i} className="hover:bg-white/5">
                      <td className={`${C.td} text-text-tertiary`}>{r.category}</td>
                      <td className={`${C.td} text-text-primary`}>{r.product}</td>
                      <td className={`${C.td} text-right font-semibold ${r.net < 0 ? 'text-danger' : 'text-success-light'}`}>{r.net > 0 ? '+' : ''}{fmt(r.net)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* 품목별 월별 재고 순증감 매트릭스 (연도별 1~12월, 상단 기간필터와 독립) */}
          <MatrixTable
            title="품목별 월별 재고 +/- 누계"
            subtitle="품목×월 재고 순증감(입고−판매출고±조정). 상단 기간필터와 무관하게 연도별 1~12월. 감소는 빨강 · 엑셀."
            firstCol="품목"
            showCategory
            loader={async (s, e) => {
              const whq = whId ? `&warehouse_id=${whId}` : '';
              const r = await getJSON<any>(`/inventory/stock-net-matrix?start=${s}&end=${e}${whq}`, null);
              if (!r) return null;
              return { months: r.months, rows: (r.matrix_rows || []).map((x: any) => ({ name: x.product, category: x.category, values: x.values, total: x.total })), col_totals: r.col_totals, grand_total: r.grand_total };
            }}
          />
        </>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════
// 재고 현황 (시점 재고 / 기간 흐름)
// ═════════════════════════════════════════════════════════
function StockTab({ warehouses, categories }: { warehouses: Warehouse[]; categories: string[] }) {
  const [mode, setMode] = useState<'snapshot' | 'flow'>('snapshot');
  const [asOf, setAsOf] = useState(todayISO());
  const [range, setRange] = useState(presetRange('month'));
  const [whId, setWhId] = useState<number | ''>('');
  const [cat, setCat] = useState('');
  const [snap, setSnap] = useState<StockRow[]>([]);
  const [flows, setFlows] = useState<FlowRow[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const whq = whId ? `&warehouse_id=${whId}` : '';
    const catq = cat ? `&category=${encodeURIComponent(cat)}` : '';
    if (mode === 'snapshot') {
      const r = await getJSON<{ rows: StockRow[] }>(`/inventory/stock?as_of=${asOf}${whq}${catq}`, { rows: [] });
      setSnap(r.rows);
    } else {
      const r = await getJSON<{ rows: FlowRow[] }>(`/inventory/flows?start=${range.start}&end=${range.end}${whq}${catq}`, { rows: [] });
      setFlows(r.rows);
    }
    setLoading(false);
  }, [mode, asOf, range, whId, cat]);
  useEffect(() => { load(); }, [load]);

  const download = async () => {
    const whq = whId ? `&warehouse_id=${whId}` : '';
    const catq = cat ? `&category=${encodeURIComponent(cat)}` : '';
    const r = await fetch(`/api/inventory/report.xlsx?as_of=${asOf}${whq}${catq}`, { headers: getAuthHeaders() });
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `재고현황_${asOf}.xlsx`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex bg-bg-1 border border-border-primary rounded-lg p-0.5">
          <button onClick={() => setMode('snapshot')} className={`${C.btn} ${mode === 'snapshot' ? C.btnPrimary : 'text-text-tertiary'}`}>시점 재고</button>
          <button onClick={() => setMode('flow')} className={`${C.btn} ${mode === 'flow' ? C.btnPrimary : 'text-text-tertiary'}`}>기간 흐름</button>
        </div>
        {mode === 'snapshot' ? (
          <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} className={C.input} />
        ) : (
          <>
            <input type="date" value={range.start} onChange={(e) => setRange({ ...range, start: e.target.value })} className={C.input} />
            <span className="text-text-quaternary">~</span>
            <input type="date" value={range.end} onChange={(e) => setRange({ ...range, end: e.target.value })} className={C.input} />
            <div className="flex flex-wrap gap-1">
              {RANGE_PRESETS.map(([k, l]) => (
                <button key={k} onClick={() => setRange(presetRange(k))} className={`${C.btn} ${C.btnGhost} px-2.5 py-1.5`}>{l}</button>
              ))}
            </div>
          </>
        )}
        <select value={whId} onChange={(e) => setWhId(e.target.value ? Number(e.target.value) : '')} className={C.input}>
          <option value="">전체 창고</option>
          {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        <select value={cat} onChange={(e) => setCat(e.target.value)} className={C.input}>
          <option value="">전체 카테고리</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        {mode === 'snapshot' && <button onClick={download} className={`${C.btn} ${C.btnGhost}`}>📥 리포트 다운로드</button>}
        {loading && <span className="text-xs text-text-quaternary">불러오는 중…</span>}
      </div>

      <div className={`${C.card} overflow-x-auto`}>
        {mode === 'snapshot' ? (
          <table className="w-full">
            <thead><tr>
              <th className={C.th}>품목코드</th><th className={C.th}>품목명</th><th className={C.th}>카테고리</th>
              {!whId && <th className={C.th}>창고</th>}
              <th className={C.th}>현재고</th><th className={C.th}>안전재고</th><th className={C.th}>재주문점</th><th className={C.th}>상태</th>
            </tr></thead>
            <tbody>
              {snap.length === 0 ? <tr><td colSpan={8} className="p-6 text-center text-text-quaternary text-sm">데이터 없음</td></tr> :
                snap.map((r, i) => (
                  <tr key={`${r.product_id}-${i}`}>
                    <td className={C.td}>{r.product_code}</td>
                    <td className={`${C.td} text-text-primary font-medium`}>{r.product_name}</td>
                    <td className={C.td}>{r.category}</td>
                    {!whId && <td className={C.td}>{r.warehouse_name || '-'}</td>}
                    <td className={`${C.td} font-semibold`}>{fmt(r.qty)}</td>
                    <td className={C.td}>{fmt(r.safety_stock)}</td>
                    <td className={C.td}>{fmt(r.reorder_point)}</td>
                    <td className={C.td}><StatusBadge s={r.status} /></td>
                  </tr>
                ))}
            </tbody>
          </table>
        ) : (
          <table className="w-full">
            <thead><tr>
              <th className={C.th}>품목명</th><th className={C.th}>카테고리</th><th className={C.th}>기초</th>
              <th className={C.th}>입고</th><th className={C.th}>판매출고</th><th className={C.th}>조정</th>
              <th className={C.th}>실사보정</th><th className={C.th}>기말</th>
            </tr></thead>
            <tbody>
              {flows.length === 0 ? <tr><td colSpan={8} className="p-6 text-center text-text-quaternary text-sm">데이터 없음</td></tr> :
                flows.map((r) => (
                  <tr key={r.product_id}>
                    <td className={`${C.td} text-text-primary font-medium`}>{r.product_name}</td>
                    <td className={C.td}>{r.category}</td>
                    <td className={C.td}>{fmt(r.opening)}</td>
                    <td className={`${C.td} text-success-light`}>{r.inflow ? '+' + fmt(r.inflow) : '-'}</td>
                    <td className={`${C.td} text-danger`}>{r.sold ? '−' + fmt(r.sold) : '-'}</td>
                    <td className={C.td}>{r.adjustment ? fmt(r.adjustment) : '-'}</td>
                    <td className={C.td}>{r.correction ? fmt(r.correction) : '-'}</td>
                    <td className={`${C.td} font-semibold text-text-primary`}>{fmt(r.closing)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════
// 보충 알림
// ═════════════════════════════════════════════════════════
function ReplenishmentTab({ warehouses }: { warehouses: Warehouse[] }) {
  const [whId, setWhId] = useState<number | ''>('');
  const [items, setItems] = useState<ReplItem[]>([]);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    const r = await getJSON<{ items: ReplItem[] }>(`/inventory/replenishment${whId ? `?warehouse_id=${whId}` : ''}`, { items: [] });
    setItems(r.items); setLoading(false);
  }, [whId]);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <select value={whId} onChange={(e) => setWhId(e.target.value ? Number(e.target.value) : '')} className={C.input}>
          <option value="">전체 창고</option>
          {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        {loading && <span className="text-xs text-text-quaternary">불러오는 중…</span>}
        <span className="text-sm text-text-tertiary ml-auto">현재고가 재주문점 이하인 품목 · 안전재고 기준 설정 필요</span>
      </div>
      <div className={`${C.card} overflow-x-auto`}>
        <table className="w-full">
          <thead><tr>
            <th className={C.th}>품목명</th><th className={C.th}>카테고리</th><th className={C.th}>현재고</th>
            <th className={C.th}>안전재고</th><th className={C.th}>재주문점</th><th className={C.th}>부족분</th>
            <th className={C.th}>권장 보충</th><th className={C.th}>상태</th>
          </tr></thead>
          <tbody>
            {items.length === 0 ? <tr><td colSpan={8} className="p-6 text-center text-text-quaternary text-sm">보충 필요 품목 없음 (또는 안전재고 미설정)</td></tr> :
              items.map((r) => (
                <tr key={r.product_id}>
                  <td className={`${C.td} text-text-primary font-medium`}>{r.product_name}</td>
                  <td className={C.td}>{r.category}</td>
                  <td className={C.td}>{fmt(r.qty)}</td>
                  <td className={C.td}>{fmt(r.safety_stock)}</td>
                  <td className={C.td}>{fmt(r.reorder_point)}</td>
                  <td className={`${C.td} text-danger`}>{fmt(r.shortfall)}</td>
                  <td className={`${C.td} font-semibold text-accent`}>{fmt(r.suggest_qty)}</td>
                  <td className={C.td}><StatusBadge s={r.status} /></td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════
// 재고 실사
// ═════════════════════════════════════════════════════════
function SegmentedControl<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { v: T; label: string; sub?: string }[] }) {
  return (
    <div className="inline-flex bg-bg-0 border border-border-primary rounded-xl p-1 gap-1">
      {options.map((o) => (
        <button key={o.v} onClick={() => onChange(o.v)}
          className={`px-4 py-1.5 rounded-lg transition-all text-left ${
            value === o.v ? 'bg-brand text-white shadow-[0_1px_3px_rgba(0,0,0,0.2)]' : 'text-text-tertiary hover:text-text-secondary'}`}>
          <span className="block text-[13px] font-semibold leading-tight">{o.label}</span>
          {o.sub && <span className={`block text-[10px] leading-tight ${value === o.v ? 'text-white/75' : 'text-text-quaternary'}`}>{o.sub}</span>}
        </button>
      ))}
    </div>
  );
}

function ProductStockAnalytics() {
  const [v, setV] = useState<any>(null);
  useEffect(() => { getJSON<any>('/inventory/valuation', null).then(setV); }, []);
  if (!v) return <div className={`${C.card} p-4 text-sm text-text-quaternary`}>제품 재고 분석 불러오는 중…</div>;
  const rows = (v.rows || []).filter((r: any) => r.qty > 0);
  const pie = (v.by_category || []).filter((c: any) => c.value > 0).slice(0, 8).map((c: any, i: number) => ({ name: c.category, value: c.value, fill: CHART_COLORS[i % CHART_COLORS.length] }));
  const topItems = rows.slice(0, 10).map((r: any) => ({ name: (r.product_name || '').slice(0, 12), value: r.value }));
  const stCount: Record<string, number> = {};
  rows.forEach((r: any) => { stCount[r.status] = (stCount[r.status] || 0) + 1; });
  const stSeg = [
    { label: '정상', v: stCount['정상'] || 0, c: 'var(--color-success)' },
    { label: '주의', v: stCount['주의'] || 0, c: 'var(--color-warning)' },
    { label: '부족', v: stCount['부족'] || 0, c: 'var(--color-warning)' },
    { label: '품절', v: stCount['품절'] || 0, c: 'var(--color-danger)' },
  ];
  const stTot = Math.max(stSeg.reduce((a, b) => a + b.v, 0), 1);
  const TT = { background: 'var(--color-bg-level-1)', border: '1px solid var(--color-border-primary)', borderRadius: 8, color: 'var(--color-text-primary)' };
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="제품 재고가액" value={won(v.total_value)} tone="text-brand" sub={v.basis === 'count' ? `실사 ${v.last_count_date} 기준` : `${v.as_of} 기준`} />
        <StatCard label="평가 품목수" value={fmt(v.product_count)} sub={`총 ${numShort(v.total_qty)}낱개`} />
        <StatCard label="음수 재고" value={fmt(v.negative_count)} tone={v.negative_count > 0 ? 'text-danger' : 'text-success'} sub="생산·실사 보정" />
        <StatCard label="원가 미상" value={fmt(v.no_cost_count)} tone={v.no_cost_count > 0 ? 'text-warning' : 'text-success'} sub="SCM 원가 등록" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className={`${C.card} p-4`}>
          <div className="text-sm font-semibold text-text-primary mb-2">카테고리별 재고가액</div>
          {pie.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}><PieChart><Pie data={pie} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={85} label={(e: any) => `${e.name} ${Math.round((e.percent || 0) * 100)}%`} labelLine={false}>{pie.map((p: any, i: number) => <Cell key={i} fill={p.fill} />)}</Pie><Tooltip contentStyle={TT} formatter={(x: any) => won(x)} /></PieChart></ResponsiveContainer>
          ) : <div className="h-[200px] flex items-center justify-center text-text-quaternary text-sm">데이터 없음</div>}
        </div>
        <div className={`${C.card} p-4`}>
          <div className="text-sm font-semibold text-text-primary mb-2">상위 제품 재고가액 (Top 10)</div>
          {topItems.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}><BarChart data={topItems} layout="vertical" margin={{ left: 20 }}><CartesianGrid strokeDasharray="3 3" stroke="var(--color-bg-inset)" /><XAxis type="number" tick={{ fill: 'var(--color-text-tertiary)', fontSize: 10 }} tickFormatter={wonShort} /><YAxis type="category" dataKey="name" tick={{ fill: 'var(--color-text-tertiary)', fontSize: 10 }} width={90} /><Tooltip contentStyle={TT} formatter={(x: any) => won(x)} /><Bar dataKey="value" radius={[0, 4, 4, 0]}>{topItems.map((_: any, i: number) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}</Bar></BarChart></ResponsiveContainer>
          ) : <div className="h-[200px] flex items-center justify-center text-text-quaternary text-sm">데이터 없음</div>}
        </div>
      </div>
      <div className={`${C.card} p-4`}>
        <div className="flex items-center justify-between mb-2"><div className="text-sm font-semibold text-text-primary">재고 상태 분포</div><div className="text-xs text-text-tertiary">양수재고 {fmt(rows.length)}품목</div></div>
        <div className="flex h-4 rounded-md overflow-hidden mb-2">{stSeg.map((s) => s.v > 0 && <div key={s.label} style={{ width: `${(s.v / stTot) * 100}%`, background: s.c }} title={`${s.label} ${s.v}`} />)}</div>
        <div className="flex flex-wrap gap-3">{stSeg.map((s) => <div key={s.label} className="flex items-center gap-1.5 text-[11px]"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: s.c }} /><span className="text-text-tertiary">{s.label}</span><span className="tabular-nums font-semibold text-text-secondary">{fmt(s.v)}</span></div>)}</div>
      </div>
    </div>
  );
}

function StockHubTab({ warehouses, categories }: { warehouses: Warehouse[]; categories: string[] }) {
  const [seg, setSeg] = useState<'제품' | '원부재료' | '포장재'>('제품');
  return (
    <div className="space-y-4">
      <SegmentedControl<'제품' | '원부재료' | '포장재'>
        value={seg} onChange={setSeg}
        options={[
          { v: '제품', label: '제품', sub: '완제품·판매연동' },
          { v: '원부재료', label: '원부재료', sub: '담당: 구매팀' },
          { v: '포장재', label: '포장재', sub: '담당: 물류팀' },
        ]} />
      {seg === '제품' && <><ProductStockAnalytics /><StockTab warehouses={warehouses} categories={categories} /></>}
      {seg === '원부재료' && <MaterialInventoryTab key="raw" initialTeam="구매팀" />}
      {seg === '포장재' && <MaterialInventoryTab key="pkg" initialTeam="물류팀" />}
    </div>
  );
}

function FlowBar({ opening, purchase, consumed, stock }: { opening: number; purchase: number; consumed: number; stock: number }) {
  const inflow = Math.max(opening + purchase, 1);
  const pct = (v: number) => `${Math.max(0, Math.min(100, (v / inflow) * 100)).toFixed(1)}%`;
  return (
    <div className="space-y-2">
      <div>
        <div className="flex justify-between text-[11px] mb-1"><span className="text-text-tertiary">유입 (기초 + 매입)</span><span className="tabular-nums text-text-secondary">{won(opening + purchase)}</span></div>
        <div className="flex h-6 rounded-md overflow-hidden bg-bg-inset">
          {opening > 0 && <div className="flex items-center justify-center text-[10px] text-white/90" style={{ width: pct(opening), background: 'var(--color-text-quaternary)' }} title={`기초 ${won(opening)}`}>{opening / inflow > 0.08 ? '기초' : ''}</div>}
          <div className="flex items-center justify-center text-[10px] text-white/90" style={{ width: pct(purchase), background: 'var(--color-warning)' }} title={`매입 ${won(purchase)}`}>{purchase / inflow > 0.12 ? `매입 ${wonShort(purchase)}` : ''}</div>
        </div>
      </div>
      <div>
        <div className="flex justify-between text-[11px] mb-1"><span className="text-info">− 소모 (BOM 이론소요)</span><span className="tabular-nums text-info">{won(consumed)}</span></div>
        <div className="flex h-6 rounded-md overflow-hidden bg-bg-inset"><div className="flex items-center justify-center text-[10px] text-white/90" style={{ width: pct(consumed), background: 'var(--color-info)' }}>{consumed / inflow > 0.12 ? `소모 ${wonShort(consumed)}` : ''}</div></div>
      </div>
      <div>
        <div className="flex justify-between text-[11px] mb-1"><span className="text-brand font-semibold">= 재고금액</span><span className="tabular-nums text-brand font-semibold">{won(stock)}</span></div>
        <div className="flex h-7 rounded-md overflow-hidden bg-bg-inset"><div className="flex items-center justify-center text-[11px] font-semibold text-white" style={{ width: pct(stock), background: 'var(--color-brand)' }}>{stock / inflow > 0.1 ? won(stock) : ''}</div></div>
      </div>
    </div>
  );
}

function MatchBar({ matched, buyOnly, reqOnly }: { matched: number; buyOnly: number; reqOnly: number }) {
  const tot = Math.max(matched + buyOnly + reqOnly, 1);
  const segs = [
    { label: '매칭(소모반영)', v: matched, c: 'var(--color-success)' },
    { label: '구매만(미소모)', v: buyOnly, c: 'var(--color-warning)' },
    { label: '소요만(구매없음)', v: reqOnly, c: 'var(--color-text-quaternary)' },
  ];
  return (
    <div>
      <div className="flex h-4 rounded-md overflow-hidden mb-2">
        {segs.map((s) => s.v > 0 && <div key={s.label} style={{ width: `${(s.v / tot) * 100}%`, background: s.c }} title={`${s.label} ${s.v}`} />)}
      </div>
      <div className="flex flex-wrap gap-3">
        {segs.map((s) => <div key={s.label} className="flex items-center gap-1.5 text-[11px]"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: s.c }} /><span className="text-text-tertiary">{s.label}</span><span className="tabular-nums font-semibold text-text-secondary">{fmt(s.v)}</span></div>)}
      </div>
    </div>
  );
}

function MaterialInventoryTab({ initialTeam = '' }: { initialTeam?: string } = {}) {
  const init = { start: '2026-01-01', end: todayISO() };
  const [range, setRange] = useState(init);
  const [draft, setDraft] = useState(init);
  const [team, setTeam] = useState(initialTeam);
  const [mclass, setMclass] = useState('');
  const [q, setQ] = useState('');
  const [d, setD] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [modal, setModal] = useState<any>(null);       // null | 'new' | prefill obj
  const [openings, setOpenings] = useState<any[]>([]);
  const [showOpen, setShowOpen] = useState(false);
  const [showReg, setShowReg] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const p = new URLSearchParams({ start: range.start, end: range.end });
    if (team) p.set('team', team);
    if (mclass) p.set('mclass', mclass);
    setD(await getJSON<any>(`/inventory/material-inventory?${p.toString()}`, null));
    setLoading(false);
  }, [range, team, mclass]);
  useEffect(() => { load(); }, [load]);
  const loadOpenings = useCallback(async () => {
    setOpenings((await getJSON<any>('/inventory/material-opening', { rows: [] })).rows);
  }, []);
  useEffect(() => { loadOpenings(); }, [loadOpenings]);

  const rows = (d?.rows || []).filter((r: any) => !q || (r.name || '').toLowerCase().includes(q.toLowerCase()) || (r.code || '').toLowerCase().includes(q.toLowerCase()));
  const dirty = draft.start !== range.start || draft.end !== range.end;
  const delOpening = async (id: number) => { if (!confirm('기초앵커를 삭제할까요?')) return; const r = await send(`/inventory/material-opening/${id}`, 'DELETE'); if (r.ok) { loadOpenings(); load(); } };

  return (
    <div className="space-y-4 relative">
      <LoadingOverlay show={loading} />
      <div className={`${C.card} p-3 flex flex-wrap items-center gap-2`}>
        <input type="date" value={draft.start} onChange={(e) => setDraft({ ...draft, start: e.target.value })} className={C.input} />
        <span className="text-text-quaternary">~</span>
        <input type="date" value={draft.end} onChange={(e) => setDraft({ ...draft, end: e.target.value })} className={C.input} />
        <button onClick={() => setRange(draft)} className={`${C.btn} ${C.btnPrimary} ${dirty ? 'ring-2 ring-brand/50' : ''}`}>조회</button>
        <select value={team} onChange={(e) => setTeam(e.target.value)} className={C.input}>
          <option value="">전체 팀</option><option value="구매팀">구매팀</option><option value="물류팀">물류팀</option>
        </select>
        <select value={mclass} onChange={(e) => setMclass(e.target.value)} className={C.input}>
          <option value="">전체 구분</option><option value="원재료">원재료</option><option value="부재료">부재료</option>
        </select>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="품목·코드 검색" className={`${C.input} w-40`} />
        <div className="ml-auto flex gap-1.5">
          <button onClick={() => setShowReg(!showReg)} className={`${C.btn} ${showReg ? C.btnPrimary : C.btnGhost}`}>미등록 자재 등록</button>
          <button onClick={() => setShowOpen(!showOpen)} className={`${C.btn} ${C.btnGhost}`}>기초앵커 {openings.length}건</button>
          <button onClick={() => setModal('new')} className={`${C.btn} ${C.btnGhost}`}>+ 기초재고</button>
        </div>
      </div>

      {showReg && <MaterialRegisterPanel range={range} onDone={() => load()} />}

      {d && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <div className={`${C.card} p-4 lg:col-span-2`}>
            <div className="text-sm font-bold text-text-primary mb-3">재고 흐름 · 가액 기준 <span className="text-xs text-text-quaternary font-normal">{range.start} ~ {range.end}</span></div>
            <FlowBar opening={d.total_opening} purchase={d.total_purchase} consumed={d.total_req_cost} stock={d.total_stock_value} />
          </div>
          <div className={`${C.card} p-4 flex flex-col`}>
            <div className="text-[11px] text-text-tertiary mb-1">구분별 재고금액</div>
            <div className="space-y-0.5 mb-2">
              {(d.by_mclass || []).map((b: any) => <div key={b.mclass} className="flex justify-between text-xs"><span className="text-text-tertiary">{b.mclass}</span><span className="tabular-nums font-semibold text-text-secondary">{wonShort(b.value)}</span></div>)}
            </div>
            <div className="text-[11px] text-text-tertiary mb-1 mt-auto">팀별 재고금액</div>
            <div className="space-y-0.5">
              {(d.by_team || []).map((b: any) => <div key={b.team} className="flex justify-between text-xs"><span className={b.team === '물류팀' ? 'text-info' : 'text-text-tertiary'}>{b.team}</span><span className="tabular-nums font-semibold text-text-secondary">{wonShort(b.value)}</span></div>)}
            </div>
          </div>
        </div>
      )}
      {d && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <div className={`${C.card} p-4 lg:col-span-2`}>
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-semibold text-text-primary">BOM 소모 매칭 현황</div>
              <div className="text-xs text-text-tertiary">총 {fmt(d.material_count)}품목</div>
            </div>
            <MatchBar matched={d.matched_count} buyOnly={d.buy_only_count} reqOnly={d.req_only_count} />
            <p className="text-[11px] text-text-quaternary mt-2">‘구매만’은 아직 BOM 소모가 안 잡힌 품목 — 매입이 통째로 재고로 남습니다. ‘매칭’ 품목은 생산 BOM 소요만큼 재고에서 차감됩니다. 미매칭이 크면 BOM erp_code·품목명 매칭 또는 기초앵커 보정이 필요합니다.</p>
          </div>
          <div className="grid grid-cols-2 gap-3 content-start">
            <StatCard label="재고금액" value={wonShort(d.total_stock_value)} tone="text-brand" />
            <StatCard label="기간 매입" value={wonShort(d.total_purchase)} tone="text-warning" />
            <StatCard label="소모(BOM)" value={wonShort(d.total_req_cost)} tone="text-info" />
            <StatCard label="기초앵커" value={wonShort(d.total_opening)} />
          </div>
        </div>
      )}

      {showOpen && (
        <div className={`${C.card} p-3`}>
          <div className="text-sm font-semibold text-text-primary mb-2">기초앵커 (직접입력)</div>
          {openings.length === 0 ? <div className="text-xs text-text-quaternary py-2">등록된 기초앵커 없음 — 마지막 실사/기초 시점의 재고금액을 품목별로 입력하세요.</div> : (
            <table className="w-full text-sm"><thead><tr>
              <th className={C.th}>기준일</th><th className={C.th}>품목</th><th className={C.th}>팀</th>
              <th className={`${C.th} text-right`}>수량</th><th className={`${C.th} text-right`}>기초금액</th><th className={C.th}></th>
            </tr></thead><tbody>
              {openings.map((o) => (
                <tr key={o.id} className="hover:bg-bg-1">
                  <td className={C.td}>{o.as_of_date}</td>
                  <td className={`${C.td} text-text-primary`}>{o.material_name || o.material_key}</td>
                  <td className={C.td}>{o.team || '-'}</td>
                  <td className={`${C.td} text-right tabular-nums`}>{o.opening_qty ? fmt(o.opening_qty) : '-'}</td>
                  <td className={`${C.td} text-right tabular-nums text-brand`}>{won(o.opening_value)}</td>
                  <td className={C.td}><button onClick={() => setModal(o)} className="text-accent text-xs hover:underline mr-2">수정</button><button onClick={() => delOpening(o.id)} className="text-danger text-xs hover:underline">삭제</button></td>
                </tr>
              ))}
            </tbody></table>
          )}
        </div>
      )}

      <div className={`${C.card} overflow-x-auto`}>
        <table className="w-full text-sm">
          <thead><tr>
            <th className={C.th}>품목</th><th className={C.th}>구분·팀</th>
            <th className={`${C.th} text-right`}>기초</th>
            <th className={`${C.th} text-right`}>매입</th>
            <th className={`${C.th}`}>소모율 (소모÷매입)</th>
            <th className={`${C.th} text-right`}>소모(BOM)</th>
            <th className={`${C.th} text-right`}>재고금액</th>
            <th className={C.th}>상태</th>
            <th className={C.th}></th>
          </tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={9} className="p-6 text-center text-text-quaternary text-sm">데이터 없음</td></tr>}
            {rows.slice(0, 400).map((r: any) => {
              const cp = r.consumed_pct;
              const st = r.matched ? { t: '매칭', c: 'bg-success/15 text-success-light' }
                : r.purchase_value > 0 ? { t: '구매만', c: 'bg-warning/15 text-warning' }
                : { t: '소요만', c: 'bg-bg-inset text-text-quaternary' };
              return (
                <tr key={r.material_key} className="hover:bg-bg-1">
                  <td className={`${C.td} text-text-primary max-w-[230px] truncate`} title={`${r.name}${r.code ? ' · ' + r.code : ''}`}>{r.name}{r.code && <span className="ml-1 text-[10px] text-text-quaternary">{r.code}</span>}</td>
                  <td className={C.td}>
                    <span className={`text-xs ${r.mclass === '원재료' ? 'text-info' : r.mclass === '부재료' ? 'text-warning' : 'text-text-quaternary'}`}>{r.mclass || '-'}</span>
                    {r.team && <span className={`text-[10px] ml-1 ${r.team === '물류팀' ? 'text-info' : 'text-text-quaternary'}`}>· {r.team.replace('팀', '')}</span>}
                  </td>
                  <td className={`${C.td} text-right tabular-nums text-text-tertiary`}>{r.has_opening ? wonShort(r.opening_value) : '-'}</td>
                  <td className={`${C.td} text-right tabular-nums text-warning`}>{r.purchase_value ? wonShort(r.purchase_value) : '-'}<div className="text-[10px] text-text-quaternary">{r.purchase_qty ? `${numShort(r.purchase_qty)}${r.unit || ''}` : ''}</div></td>
                  <td className={C.td}>
                    <div className="flex items-center gap-1.5 min-w-[90px]">
                      <div className="flex-1 h-2 rounded-full bg-bg-inset overflow-hidden"><div className="h-full rounded-full" style={{ width: `${Math.min(100, cp || 0)}%`, background: cp == null ? 'transparent' : cp >= 90 ? 'var(--color-success)' : cp >= 40 ? 'var(--color-info)' : 'var(--color-warning)' }} /></div>
                      <span className="text-[10px] tabular-nums text-text-quaternary w-8 text-right">{cp == null ? '-' : `${Math.round(cp)}%`}</span>
                    </div>
                  </td>
                  <td className={`${C.td} text-right tabular-nums text-info`}>{r.req_cost ? wonShort(r.req_cost) : '-'}</td>
                  <td className={`${C.td} text-right tabular-nums font-semibold ${r.stock_value < 0 ? 'text-danger' : 'text-brand'}`}>{won(r.stock_value)}</td>
                  <td className={C.td}><span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${st.c}`}>{st.t}</span></td>
                  <td className={C.td}><button onClick={() => setModal({ material_key: r.material_key, material_name: r.name, team: r.team, mclass: r.mclass, unit: r.unit, unit_cost: r.last_price })} className="text-accent text-[11px] hover:underline whitespace-nowrap">기초입력</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {modal && <MaterialOpeningModal prefill={modal === 'new' ? null : modal} onClose={() => setModal(null)} onSaved={() => { setModal(null); loadOpenings(); load(); }} />}
    </div>
  );
}

function MaterialRegisterPanel({ range, onDone }: { range: { start: string; end: string }; onDone: () => void }) {
  const [d, setD] = useState<any>(null);
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [onlyRaw, setOnlyRaw] = useState(true);
  const load = useCallback(async () => {
    setD(await getJSON<any>(`/inventory/material-unregistered?start=${range.start}&end=${range.end}&limit=120`, null));
  }, [range]);
  useEffect(() => { load(); }, [load]);
  if (!d) return <div className={`${C.card} p-4 text-sm text-text-quaternary`}>미등록 자재 분석 중…</div>;
  const rows = (d.rows || []).filter((r: any) => !onlyRaw || r.suggested_type === 'raw');
  const selRows = rows.filter((r: any) => sel[r.material_key]);
  const toggle = (k: string) => setSel((s) => ({ ...s, [k]: !s[k] }));
  const allOn = rows.length > 0 && rows.every((r: any) => sel[r.material_key]);
  const toggleAll = () => { const n: Record<string, boolean> = {}; if (!allOn) rows.forEach((r: any) => { n[r.material_key] = true; }); setSel(n); };
  const register = async () => {
    if (!selRows.length) { setMsg('등록할 자재를 선택하세요'); return; }
    setSaving(true); setMsg(null);
    const items = selRows.map((r: any) => ({ name: r.name, erp_code: r.code, type: r.suggested_type, mclass: r.mclass, vendor: r.vendor, unit: r.unit, last_price: r.last_price, kg_price: r.kg_price }));
    const res = await send('/inventory/material-register', 'POST', { items });
    setSaving(false);
    if (res.ok) { setMsg(`등록 ${res.data.created}건 (중복 ${res.data.skipped})`); setSel({}); await load(); onDone(); }
    else setMsg(res.data?.detail || '등록 실패');
  };
  const autofix = async () => {
    setSaving(true); setMsg(null);
    const res = await send(`/inventory/material-alias-autofix?start=${range.start}&end=${range.end}`, 'POST');
    setSaving(false);
    if (res.ok) { setMsg(`유사 마스터 자동매핑 ${res.data.created}건 — 해당 자재의 소모가 이제 매칭됩니다`); await load(); onDone(); }
    else setMsg(res.data?.detail || '자동매핑 실패');
  };
  return (
    <div className={`${C.card} p-4 space-y-3 border border-warning/30`}>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <div className="text-sm font-bold text-text-primary">BOM 미등록 매입 자재 <span className="text-warning">{fmt(d.count)}건</span></div>
          <div className="text-[11px] text-text-quaternary">미등록 매입액 합 {won(d.total_unregistered_value)} · 유사 마스터 있음 {fmt(d.has_similar_master)}건(코드/이름 불일치)</div>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-xs text-text-secondary cursor-pointer"><input type="checkbox" checked={onlyRaw} onChange={(e) => setOnlyRaw(e.target.checked)} /> 원재료만</label>
          {d.has_similar_master > 0 && <button onClick={autofix} disabled={saving} className={`${C.btn} ${C.btnGhost}`} title="유사 마스터가 이미 있는 자재를 별칭으로 자동 연결(코드 미변경)">유사 {fmt(d.has_similar_master)}건 자동매핑</button>}
          <button onClick={register} disabled={saving || selRows.length === 0} className={`${C.btn} ${C.btnPrimary} disabled:opacity-40`}>{saving ? '등록 중…' : `선택 ${selRows.length}건 SCM 등록`}</button>
        </div>
      </div>
      <p className="text-[11px] text-text-quaternary">※ 자재 <b>마스터(이름·단가·거래처)만</b> 등록합니다. 실제 소모 차감은 이후 <b>SCM › BOM 화면에서 레시피(배합비) 연결</b> 시 반영됩니다(배합비는 여기서 다루지 않음). ‘유사 마스터 있음’은 이미 등록됐으니 그 마스터의 코드/별칭 보정이 우선입니다.</p>
      <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-bg-1"><tr>
            <th className={`${C.th} w-8`}><input type="checkbox" checked={allOn} onChange={toggleAll} /></th>
            <th className={C.th}>품목</th><th className={C.th}>구분·팀</th>
            <th className={`${C.th} text-right`}>매입액</th><th className={`${C.th} text-right`}>최근단가</th>
            <th className={`${C.th} text-right`}>kg단가</th><th className={C.th}>거래처</th><th className={C.th}>유사 마스터</th>
          </tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={8} className="p-4 text-center text-text-quaternary text-sm">미등록 자재 없음</td></tr>}
            {rows.map((r: any) => (
              <tr key={r.material_key} className={`hover:bg-bg-1 ${sel[r.material_key] ? 'bg-brand/5' : ''}`}>
                <td className={C.td}><input type="checkbox" checked={!!sel[r.material_key]} onChange={() => toggle(r.material_key)} /></td>
                <td className={`${C.td} text-text-primary max-w-[240px] truncate`} title={r.name}>{r.name}{r.code && <span className="ml-1 text-[10px] text-text-quaternary">{r.code}</span>}</td>
                <td className={C.td}><span className={`text-xs ${r.suggested_type === 'raw' ? 'text-info' : 'text-warning'}`}>{r.mclass || (r.suggested_type === 'raw' ? '원재료' : '부자재')}</span>{r.team && <span className="text-[10px] text-text-quaternary ml-1">· {r.team.replace('팀', '')}</span>}</td>
                <td className={`${C.td} text-right tabular-nums text-warning`}>{won(r.purchase_value)}</td>
                <td className={`${C.td} text-right tabular-nums text-text-tertiary`}>{r.last_price ? won(r.last_price) : '-'}<span className="text-[10px] text-text-quaternary">{r.unit ? `/${r.unit}` : ''}</span></td>
                <td className={`${C.td} text-right tabular-nums text-text-tertiary`}>{r.kg_price ? won(r.kg_price) : '-'}</td>
                <td className={`${C.td} text-xs text-text-tertiary max-w-[120px] truncate`} title={r.vendor}>{r.vendor || '-'}</td>
                <td className={C.td}>{r.master_suggestion ? <span className="text-[10px] text-success-light" title={r.master_suggestion.name}>있음: {r.master_suggestion.name.slice(0, 12)}</span> : <span className="text-[10px] text-text-quaternary">신규</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {msg && <div className="text-xs text-accent">{msg}</div>}
    </div>
  );
}

function MaterialOpeningModal({ prefill, onClose, onSaved }: { prefill: any; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<any>({
    id: prefill?.id ?? null,
    material_key: prefill?.material_key ?? '',
    material_name: prefill?.material_name ?? '',
    team: prefill?.team ?? '',
    mclass: prefill?.mclass ?? '',
    as_of_date: prefill?.as_of_date ?? todayISO(),
    opening_qty: prefill?.opening_qty ?? '',
    unit: prefill?.unit ?? '',
    unit_cost: prefill?.unit_cost ?? '',
    opening_value: prefill?.opening_value ?? '',
    note: prefill?.note ?? '',
  });
  const [msg, setMsg] = useState<string | null>(null);
  const up = (k: string, v: any) => setF((p: any) => ({ ...p, [k]: v }));
  const calcVal = Math.round((Number(f.opening_qty) || 0) * (Number(f.unit_cost) || 0));
  const save = async () => {
    if (!f.material_key) { setMsg('품목키(코드 또는 품목명) 필요'); return; }
    const body = { ...f, opening_qty: Number(f.opening_qty) || 0, unit_cost: Number(f.unit_cost) || 0, opening_value: Number(f.opening_value) || 0 };
    const r = await send('/inventory/material-opening', 'POST', body);
    if (r.ok) onSaved(); else setMsg(r.data?.detail || '저장 실패');
  };
  const L = ({ children }: { children: any }) => <div className="text-xs text-text-tertiary mb-1">{children}</div>;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div className="relative bg-bg-1 border border-border-primary rounded-2xl w-full max-w-lg p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4"><div className="text-lg font-bold text-text-primary">기초재고 앵커 {f.id ? '수정' : '입력'}</div><button onClick={onClose} className="text-text-tertiary hover:text-text-primary text-xl">×</button></div>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2"><L>품목키(코드 또는 품목명) *</L><input value={f.material_key} onChange={(e) => up('material_key', e.target.value)} className={`${C.input} w-full`} placeholder="구매 item_code 또는 품목명" /></div>
          <div className="col-span-2"><L>품목명</L><input value={f.material_name} onChange={(e) => up('material_name', e.target.value)} className={`${C.input} w-full`} /></div>
          <div><L>팀</L><select value={f.team} onChange={(e) => up('team', e.target.value)} className={`${C.input} w-full`}><option value="">-</option><option value="구매팀">구매팀</option><option value="물류팀">물류팀</option></select></div>
          <div><L>구분</L><select value={f.mclass} onChange={(e) => up('mclass', e.target.value)} className={`${C.input} w-full`}><option value="">-</option><option value="원재료">원재료</option><option value="부재료">부재료</option></select></div>
          <div><L>기준일(이 날짜의 재고) *</L><input type="date" value={f.as_of_date} onChange={(e) => up('as_of_date', e.target.value)} className={`${C.input} w-full`} /></div>
          <div><L>단위</L><input value={f.unit} onChange={(e) => up('unit', e.target.value)} className={`${C.input} w-full`} placeholder="kg/ea/box" /></div>
          <div><L>기초 수량</L><input type="number" value={f.opening_qty} onChange={(e) => up('opening_qty', e.target.value)} className={`${C.input} w-full`} /></div>
          <div><L>기초 단가</L><input type="number" value={f.unit_cost} onChange={(e) => up('unit_cost', e.target.value)} className={`${C.input} w-full`} /></div>
          <div className="col-span-2"><L>기초 재고금액(비우면 수량×단가 = {won(calcVal)})</L><input type="number" value={f.opening_value} onChange={(e) => up('opening_value', e.target.value)} className={`${C.input} w-full`} placeholder={String(calcVal)} /></div>
        </div>
        <div className="flex items-center gap-3 mt-4"><span className="text-xs text-text-tertiary">앵커 금액 = {won(Number(f.opening_value) || calcVal)}</span><button onClick={save} className={`${C.btn} ${C.btnPrimary} ml-auto`}>저장</button></div>
        {msg && <div className="mt-2 text-xs text-danger">{msg}</div>}
      </div>
    </div>
  );
}

function StockValuationPanel() {
  const [v, setV] = useState<any>(null);
  const [showAll, setShowAll] = useState(false);
  useEffect(() => { getJSON<any>('/inventory/valuation', null).then(setV); }, []);
  if (!v) return null;
  const isCount = v.basis === 'count';
  const rows = (v.rows || []).filter((r: any) => Math.abs(r.qty) > 0);
  const shown = showAll ? rows : rows.slice(0, 12);
  return (
    <div className={`${C.card} p-4 space-y-3`}>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-sm font-bold text-text-primary">재고 가액</div>
        <div className="text-xs">
          {isCount
            ? <span className="text-success-light">✔ 마지막 확정 실사 <b>{v.last_count_date}</b> 기준</span>
            : <span className="text-warning">확정 실사 없음 — {v.as_of} 시스템재고 기준</span>}
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="실보유 재고가액" value={won(v.total_value)} tone="text-brand" sub={v.net_value !== v.total_value ? `순장부 ${wonShort(v.net_value)}` : `기준일 ${v.as_of}`} />
        <StatCard label="평가 품목수" value={fmt(v.product_count)} sub={`총 ${numShort(v.total_qty)}낱개`} />
        <StatCard label="원가 미상" value={fmt(v.no_cost_count)} tone={v.no_cost_count > 0 ? 'text-warning' : 'text-success'} sub="가액 미반영" />
        <StatCard label="음수 재고" value={fmt(v.negative_count)} tone={v.negative_count > 0 ? 'text-danger' : 'text-success'} sub="초과판매·생산누락" />
      </div>
      <p className="text-[11px] text-text-quaternary">
        ※ 개당원가 = SCM 재료원가 + 노무비(기본 200원/ea, 깜빠뉴·슬랩 500원/ea). 실보유 가액 = 양수 재고 × 개당원가 합산.
        {v.no_cost_count > 0 && ` 원가 미상 ${v.no_cost_count}품목은 SCM 원가 등록 시 반영.`}
        {v.negative_count > 0 && ` 음수 재고 ${v.negative_count}품목은 실사·생산실적 보정 필요.`}
      </p>
      {(v.by_category || []).length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {v.by_category.map((b: any) => (
            <span key={b.category} className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-bg-inset text-[11px]">
              <span className="text-text-quaternary">{b.category}</span>
              <span className="tabular-nums font-semibold text-text-secondary">{wonShort(b.value)}</span>
            </span>
          ))}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr>
            <th className={C.th}>품목</th><th className={C.th}>분류</th>
            <th className={`${C.th} text-right`}>현재고</th><th className={`${C.th} text-right`}>개당원가</th>
            <th className={`${C.th} text-right`}>재고가액</th><th className={C.th}>상태</th>
          </tr></thead>
          <tbody>
            {shown.length === 0 && <tr><td colSpan={6} className="p-4 text-center text-text-quaternary text-sm">재고 없음</td></tr>}
            {shown.map((r: any) => (
              <tr key={r.product_id} className="hover:bg-bg-1">
                <td className={`${C.td} text-text-primary`}>{r.product_name}{!r.has_cost && <span className="ml-1 text-[10px] text-warning" title="개당원가 미상 — 가액 0">원가?</span>}</td>
                <td className={`${C.td} text-text-tertiary text-xs`}>{r.category}</td>
                <td className={`${C.td} text-right tabular-nums ${r.negative ? 'text-danger' : ''}`}>{numShort(r.qty)}{r.unit ? ` ${r.unit}` : ''}</td>
                <td className={`${C.td} text-right tabular-nums text-text-tertiary`} title={r.unit_cost ? `재료 ${fmt(r.material_cost)} + 노무 ${fmt(r.labor_cost)}` : ''}>{r.unit_cost ? won(r.unit_cost) : '-'}</td>
                <td className={`${C.td} text-right tabular-nums font-semibold ${r.negative ? 'text-danger' : 'text-brand'}`}>{r.negative ? '음수재고' : won(r.value)}</td>
                <td className={C.td}><span className={`text-[11px] ${r.status === '품절' ? 'text-danger' : r.status === '부족' ? 'text-warning' : r.status === '주의' ? 'text-warning' : 'text-success-light'}`}>{r.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > 12 && <button onClick={() => setShowAll(!showAll)} className="text-xs text-accent hover:underline">{showAll ? '접기' : `전체 ${rows.length}품목 보기`}</button>}
    </div>
  );
}

function CountTab({ warehouses }: { warehouses: Warehouse[] }) {
  const [sessions, setSessions] = useState<CountSession[]>([]);
  const [openId, setOpenId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [nWh, setNWh] = useState<number | ''>('');
  const [nDate, setNDate] = useState(todayISO());
  const [nPeriod, setNPeriod] = useState('monthly');
  const [nTitle, setNTitle] = useState('');

  const load = useCallback(async () => {
    setSessions((await getJSON<{ rows: CountSession[] }>('/inventory/count-sessions', { rows: [] })).rows);
  }, []);
  useEffect(() => { load(); }, [load]);

  const create = async () => {
    if (!nWh) { alert('창고를 선택하세요'); return; }
    const r = await send('/inventory/count-sessions', 'POST', { warehouse_id: nWh, count_date: nDate, period_type: nPeriod, title: nTitle || null });
    if (r.ok) { setCreating(false); setNTitle(''); await load(); setOpenId(r.data.id); }
    else alert('생성 실패');
  };
  const del = async (id: number) => {
    if (!confirm('삭제하시겠습니까?')) return;
    const r = await send(`/inventory/count-sessions/${id}`, 'DELETE');
    if (r.ok) load(); else alert(r.data?.detail || '삭제 실패');
  };

  if (openId) return <CountDetail sessionId={openId} onBack={() => { setOpenId(null); load(); }} />;

  return (
    <div className="space-y-4">
      <StockValuationPanel />
      <div className="flex items-center justify-between">
        <span className="text-sm text-text-tertiary">주·월·분기 실사로 시스템재고와 실재고를 대조합니다. 차이 발생 시 수정 사유 입력이 필수입니다.</span>
        <button onClick={() => setCreating(!creating)} className={`${C.btn} ${C.btnPrimary}`}>+ 실사 세션</button>
      </div>
      {creating && (
        <div className={`${C.card} p-4 flex flex-wrap items-end gap-3`}>
          <div><div className="text-xs text-text-tertiary mb-1">창고</div>
            <select value={nWh} onChange={(e) => setNWh(e.target.value ? Number(e.target.value) : '')} className={C.input}>
              <option value="">선택</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select></div>
          <div><div className="text-xs text-text-tertiary mb-1">실사일</div>
            <input type="date" value={nDate} onChange={(e) => setNDate(e.target.value)} className={C.input} /></div>
          <div><div className="text-xs text-text-tertiary mb-1">주기</div>
            <select value={nPeriod} onChange={(e) => setNPeriod(e.target.value)} className={C.input}>
              <option value="weekly">주간</option><option value="monthly">월간</option><option value="quarterly">분기</option><option value="adhoc">수시</option>
            </select></div>
          <div className="flex-1 min-w-[160px]"><div className="text-xs text-text-tertiary mb-1">제목(선택)</div>
            <input value={nTitle} onChange={(e) => setNTitle(e.target.value)} placeholder="예: 3월 정기 실사" className={`${C.input} w-full`} /></div>
          <button onClick={create} className={`${C.btn} ${C.btnPrimary}`}>생성 후 입력</button>
        </div>
      )}
      <div className={`${C.card} overflow-x-auto`}>
        <table className="w-full">
          <thead><tr>
            <th className={C.th}>실사일</th><th className={C.th}>창고</th><th className={C.th}>주기</th>
            <th className={C.th}>제목</th><th className={C.th}>상태</th><th className={C.th}>확정자</th><th className={C.th}></th>
          </tr></thead>
          <tbody>
            {sessions.length === 0 ? <tr><td colSpan={7} className="p-6 text-center text-text-quaternary text-sm">실사 세션 없음</td></tr> :
              sessions.map((s) => (
                <tr key={s.id} className="hover:bg-bg-1 cursor-pointer" onClick={() => setOpenId(s.id)}>
                  <td className={C.td}>{s.count_date}</td>
                  <td className={C.td}>{s.warehouse_name}</td>
                  <td className={C.td}>{({ weekly: '주간', monthly: '월간', quarterly: '분기', adhoc: '수시' } as any)[s.period_type] || s.period_type}</td>
                  <td className={C.td}>{s.title || '-'}</td>
                  <td className={C.td}>{s.status === 'confirmed'
                    ? <span className="px-2 py-0.5 rounded-md text-xs font-semibold bg-success/15 text-success-light">확정</span>
                    : <span className="px-2 py-0.5 rounded-md text-xs font-semibold bg-warning/15 text-warning">작성중</span>}</td>
                  <td className={C.td}>{s.confirmed_by || '-'}</td>
                  <td className={C.td}>{s.status !== 'confirmed' &&
                    <button onClick={(e) => { e.stopPropagation(); del(s.id); }} className="text-danger text-xs hover:underline">삭제</button>}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CountDetail({ sessionId, onBack }: { sessionId: number; onBack: () => void }) {
  const [sess, setSess] = useState<CountSession | null>(null);
  const [lines, setLines] = useState<CountLine[]>([]);
  const [edited, setEdited] = useState<Record<number, { counted_qty: number | null; reason: string }>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const r = await getJSON<{ session: CountSession; lines: CountLine[] }>(`/inventory/count-sessions/${sessionId}`, { session: null as any, lines: [] });
    setSess(r.session); setLines(r.lines);
    const init: Record<number, { counted_qty: number | null; reason: string }> = {};
    r.lines.forEach((l) => { init[l.product_id] = { counted_qty: l.counted_qty, reason: l.reason }; });
    setEdited(init); setLoading(false);
  }, [sessionId]);
  useEffect(() => { load(); }, [load]);

  const locked = sess?.status === 'confirmed';
  const setVal = (pid: number, k: 'counted_qty' | 'reason', v: any) =>
    setEdited((p) => ({ ...p, [pid]: { ...p[pid], [k]: v } }));
  const diffOf = (l: CountLine) => {
    const c = edited[l.product_id]?.counted_qty;
    return c === null || c === undefined ? null : Math.round((Number(c) - l.system_qty) * 100) / 100;
  };

  const save = async () => {
    setSaving(true);
    const items = lines.map((l) => ({ product_id: l.product_id, counted_qty: edited[l.product_id]?.counted_qty ?? null, reason: edited[l.product_id]?.reason || null }))
      .filter((it) => it.counted_qty !== null || it.reason);
    const r = await send(`/inventory/count-sessions/${sessionId}/lines`, 'POST', items);
    setSaving(false);
    if (r.ok) { await load(); alert('저장되었습니다'); } else alert('저장 실패');
  };
  const confirm_ = async () => {
    // 확정 전 사유 누락 체크 (프론트)
    const missing = lines.filter((l) => { const d = diffOf(l); return d !== null && Math.abs(d) > 0 && !(edited[l.product_id]?.reason || '').trim(); });
    if (missing.length) { alert(`차이가 있는 ${missing.length}개 품목에 수정 사유가 필요합니다.`); return; }
    if (!confirm('확정하면 차이만큼 재고가 보정되고 되돌릴 수 없습니다. 진행할까요?')) return;
    await send(`/inventory/count-sessions/${sessionId}/lines`, 'POST',
      lines.map((l) => ({ product_id: l.product_id, counted_qty: edited[l.product_id]?.counted_qty ?? null, reason: edited[l.product_id]?.reason || null })));
    const r = await send(`/inventory/count-sessions/${sessionId}/confirm`, 'POST');
    if (r.ok) { await load(); alert(`확정 완료 · 보정 ${r.data.corrections_posted}건`); }
    else {
      const detail = r.data?.detail;
      if (detail?.error === 'reason_required') alert(`사유 누락 ${detail.missing.length}건`);
      else alert(detail?.error || detail || '확정 실패');
    }
  };

  const shown = lines.filter((l) => !q || l.product_name.includes(q) || l.category.includes(q));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className={`${C.btn} ${C.btnGhost}`}>← 목록</button>
        {sess && <div className="text-sm text-text-secondary"><span className="font-semibold text-text-primary">{sess.warehouse_name}</span> · {sess.count_date} · {sess.title || '실사'}</div>}
        {locked && <span className="px-2 py-0.5 rounded-md text-xs font-semibold bg-success/15 text-success-light">확정됨 (읽기전용)</span>}
        <div className="ml-auto flex gap-2">
          {!locked && <button onClick={save} disabled={saving} className={`${C.btn} ${C.btnGhost}`}>{saving ? '저장 중…' : '임시 저장'}</button>}
          {!locked && <button onClick={confirm_} className={`${C.btn} ${C.btnPrimary}`}>실사 확정</button>}
        </div>
      </div>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="품목/카테고리 검색" className={`${C.input} w-64`} />
      {loading ? <div className="text-sm text-text-quaternary p-4">불러오는 중…</div> : (
        <div className={`${C.card} overflow-x-auto max-h-[65vh]`}>
          <table className="w-full">
            <thead className="sticky top-0 bg-bg-1"><tr>
              <th className={C.th}>품목명</th><th className={C.th}>카테고리</th><th className={C.th}>시스템재고</th>
              <th className={C.th}>실재고</th><th className={C.th}>차이</th><th className={C.th}>수정 사유</th>
            </tr></thead>
            <tbody>
              {shown.map((l) => {
                const d = diffOf(l);
                const needReason = d !== null && Math.abs(d) > 0;
                return (
                  <tr key={l.product_id}>
                    <td className={`${C.td} text-text-primary font-medium`}>{l.product_name}</td>
                    <td className={C.td}>{l.category}</td>
                    <td className={C.td}>{fmt(l.system_qty)}</td>
                    <td className={C.td}>
                      <input type="number" disabled={locked} value={edited[l.product_id]?.counted_qty ?? ''}
                        onChange={(e) => setVal(l.product_id, 'counted_qty', e.target.value === '' ? null : Number(e.target.value))}
                        className={`${C.input} w-24 py-1`} placeholder="—" />
                    </td>
                    <td className={`${C.td} font-semibold ${d === null ? '' : d > 0 ? 'text-success-light' : d < 0 ? 'text-danger' : 'text-text-tertiary'}`}>
                      {d === null ? '-' : (d > 0 ? '+' : '') + fmt(d)}
                    </td>
                    <td className={C.td}>
                      <input disabled={locked} value={edited[l.product_id]?.reason || ''}
                        onChange={(e) => setVal(l.product_id, 'reason', e.target.value)}
                        placeholder={needReason ? '사유 필수' : ''}
                        className={`${C.input} w-56 py-1 ${needReason && !(edited[l.product_id]?.reason || '').trim() ? 'border-danger' : ''}`} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════
// 설정
// ═════════════════════════════════════════════════════════
function SettingsTab({ warehouses, onChange }: { warehouses: Warehouse[]; onChange: () => void }) {
  const [sub, setSub] = useState<SettingsTab>('창고');
  const subs: SettingsTab[] = ['창고', '채널-창고 매핑', '안전재고', '기초재고 업로드'];
  return (
    <div className="space-y-4">
      <div className="flex gap-1">
        {subs.map((s) => (
          <button key={s} onClick={() => setSub(s)} className={`${C.btn} ${sub === s ? C.btnPrimary : C.btnGhost}`}>{s}</button>
        ))}
      </div>
      {sub === '창고' && <WarehouseSettings warehouses={warehouses} onChange={onChange} />}
      {sub === '채널-창고 매핑' && <ChannelMapSettings warehouses={warehouses} />}
      {sub === '안전재고' && <SafetySettings warehouses={warehouses} />}
      {sub === '기초재고 업로드' && <OpeningUpload warehouses={warehouses} />}
    </div>
  );
}

function WarehouseSettings({ warehouses, onChange }: { warehouses: Warehouse[]; onChange: () => void }) {
  const [form, setForm] = useState<{ id?: number; code: string; name: string; location: string }>({ code: '', name: '', location: '' });
  const save = async () => {
    if (!form.name.trim()) { alert('창고명을 입력하세요'); return; }
    const r = await send('/inventory/warehouses', 'POST', { id: form.id, code: form.code || null, name: form.name, location: form.location || null });
    if (r.ok) { setForm({ code: '', name: '', location: '' }); onChange(); } else alert(r.data?.detail || '저장 실패');
  };
  const del = async (id: number) => {
    if (!confirm('삭제(또는 비활성화)하시겠습니까?')) return;
    const r = await send(`/inventory/warehouses/${id}`, 'DELETE');
    if (r.ok) onChange(); else alert('삭제 실패');
  };
  return (
    <div className="space-y-3">
      <div className={`${C.card} p-4 flex flex-wrap items-end gap-3`}>
        <div><div className="text-xs text-text-tertiary mb-1">코드</div><input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="WH1" className={`${C.input} w-24`} /></div>
        <div className="flex-1 min-w-[160px]"><div className="text-xs text-text-tertiary mb-1">창고명 *</div><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="본사 물류창고" className={`${C.input} w-full`} /></div>
        <div className="flex-1 min-w-[160px]"><div className="text-xs text-text-tertiary mb-1">위치</div><input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} className={`${C.input} w-full`} /></div>
        <button onClick={save} className={`${C.btn} ${C.btnPrimary}`}>{form.id ? '수정' : '+ 추가'}</button>
        {form.id && <button onClick={() => setForm({ code: '', name: '', location: '' })} className={`${C.btn} ${C.btnGhost}`}>취소</button>}
      </div>
      <div className={`${C.card} overflow-x-auto`}>
        <table className="w-full">
          <thead><tr><th className={C.th}>코드</th><th className={C.th}>창고명</th><th className={C.th}>위치</th><th className={C.th}>상태</th><th className={C.th}></th></tr></thead>
          <tbody>
            {warehouses.length === 0 ? <tr><td colSpan={5} className="p-6 text-center text-text-quaternary text-sm">창고를 추가하세요</td></tr> :
              warehouses.map((w) => (
                <tr key={w.id}>
                  <td className={C.td}>{w.code || '-'}</td>
                  <td className={`${C.td} text-text-primary font-medium`}>{w.name}</td>
                  <td className={C.td}>{w.location || '-'}</td>
                  <td className={C.td}>{w.is_active ? <StatusBadge s="정상" /> : <span className="text-xs text-text-quaternary">비활성</span>}</td>
                  <td className={C.td}>
                    <button onClick={() => setForm({ id: w.id, code: w.code || '', name: w.name, location: w.location || '' })} className="text-accent text-xs hover:underline mr-3">수정</button>
                    <button onClick={() => del(w.id)} className="text-danger text-xs hover:underline">삭제</button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ChannelMapSettings({ warehouses }: { warehouses: Warehouse[] }) {
  const [channels, setChannels] = useState<ChannelRow[]>([]);
  const [unassigned, setUnassigned] = useState(0);
  const [dirty, setDirty] = useState<Record<string, number | null>>({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const r = await getJSON<{ channels: ChannelRow[]; unassigned: number }>('/inventory/channels', { channels: [], unassigned: 0 });
    setChannels(r.channels); setUnassigned(r.unassigned); setDirty({});
  }, []);
  useEffect(() => { load(); }, [load]);

  const setWh = (cid: string, wid: number | null) => setDirty((p) => ({ ...p, [cid]: wid }));
  const effective = (c: ChannelRow) => (c.channel_id in dirty ? dirty[c.channel_id] : c.warehouse_id);
  const save = async () => {
    const items = channels.filter((c) => c.channel_id in dirty && dirty[c.channel_id] !== null)
      .map((c) => ({ channel_id: c.channel_id, channel_name: c.channel_name, warehouse_id: dirty[c.channel_id] as number, is_active: true }));
    if (!items.length) { alert('변경사항 없음'); return; }
    setSaving(true);
    const r = await send('/inventory/channel-warehouse/bulk', 'POST', items);
    setSaving(false);
    if (r.ok) load(); else alert('저장 실패');
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <span className="text-sm text-text-tertiary">각 판매채널이 어느 창고에서 출고되는지 지정하면, 그 채널의 판매가 해당 창고 재고에서 차감됩니다.</span>
        {unassigned > 0 && <span className="px-2 py-0.5 rounded-md text-xs font-semibold bg-warning/15 text-warning">미지정 {unassigned}개</span>}
        <button onClick={save} disabled={saving} className={`${C.btn} ${C.btnPrimary} ml-auto`}>{saving ? '저장 중…' : '변경 저장'}</button>
      </div>
      <div className={`${C.card} overflow-x-auto max-h-[65vh]`}>
        <table className="w-full">
          <thead className="sticky top-0 bg-bg-1"><tr><th className={C.th}>채널명</th><th className={C.th}>카테고리</th><th className={C.th}>창고 지정</th></tr></thead>
          <tbody>
            {channels.map((c) => (
              <tr key={c.channel_id} className={effective(c) === null ? 'bg-warning/[0.03]' : ''}>
                <td className={`${C.td} text-text-primary font-medium`}>{c.channel_name}</td>
                <td className={C.td}>{c.category || '-'}</td>
                <td className={C.td}>
                  <select value={effective(c) ?? ''} onChange={(e) => setWh(c.channel_id, e.target.value ? Number(e.target.value) : null)}
                    className={`${C.input} py-1 ${c.channel_id in dirty ? 'border-brand' : ''}`}>
                    <option value="">미지정</option>
                    {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SafetySettings({ warehouses }: { warehouses: Warehouse[] }) {
  const [rows, setRows] = useState<SafetyRow[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [form, setForm] = useState<{ warehouse_id: number | ''; product_id: number | ''; safety_stock: string; reorder_point: string; reorder_qty: string; target_stock: string }>(
    { warehouse_id: '', product_id: '', safety_stock: '', reorder_point: '', reorder_qty: '', target_stock: '' });

  const load = useCallback(async () => {
    const [s, p] = await Promise.all([
      getJSON<{ rows: SafetyRow[] }>('/inventory/safety-stock', { rows: [] }),
      getJSON<{ products: ProductRow[] }>('/inventory/products', { products: [] }),
    ]);
    setRows(s.rows); setProducts(p.products);
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!form.product_id) { alert('품목을 선택하세요'); return; }
    const r = await send('/inventory/safety-stock', 'POST', {
      warehouse_id: form.warehouse_id || null, product_id: form.product_id,
      safety_stock: Number(form.safety_stock || 0), reorder_point: Number(form.reorder_point || 0),
      reorder_qty: Number(form.reorder_qty || 0), target_stock: Number(form.target_stock || 0), is_active: true,
    });
    if (r.ok) { setForm({ warehouse_id: '', product_id: '', safety_stock: '', reorder_point: '', reorder_qty: '', target_stock: '' }); load(); } else alert('저장 실패');
  };
  const del = async (id: number) => { const r = await send(`/inventory/safety-stock/${id}`, 'DELETE'); if (r.ok) load(); };

  return (
    <div className="space-y-3">
      <div className={`${C.card} p-4 grid grid-cols-2 md:grid-cols-7 gap-2 items-end`}>
        <div className="col-span-2"><div className="text-xs text-text-tertiary mb-1">품목 *</div>
          <select value={form.product_id} onChange={(e) => setForm({ ...form, product_id: e.target.value ? Number(e.target.value) : '' })} className={`${C.input} w-full`}>
            <option value="">선택</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.category})</option>)}
          </select></div>
        <div><div className="text-xs text-text-tertiary mb-1">창고</div>
          <select value={form.warehouse_id} onChange={(e) => setForm({ ...form, warehouse_id: e.target.value ? Number(e.target.value) : '' })} className={`${C.input} w-full`}>
            <option value="">전체공통</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select></div>
        <div><div className="text-xs text-text-tertiary mb-1">안전재고</div><input type="number" value={form.safety_stock} onChange={(e) => setForm({ ...form, safety_stock: e.target.value })} className={`${C.input} w-full`} /></div>
        <div><div className="text-xs text-text-tertiary mb-1">재주문점</div><input type="number" value={form.reorder_point} onChange={(e) => setForm({ ...form, reorder_point: e.target.value })} className={`${C.input} w-full`} /></div>
        <div><div className="text-xs text-text-tertiary mb-1">목표재고</div><input type="number" value={form.target_stock} onChange={(e) => setForm({ ...form, target_stock: e.target.value })} className={`${C.input} w-full`} /></div>
        <button onClick={save} className={`${C.btn} ${C.btnPrimary}`}>저장</button>
      </div>
      <p className="text-xs text-text-quaternary">현재고 ≤ 재주문점 → 보충 알림. 권장 보충량은 목표재고−현재고로 자동 산출됩니다. 창고를 비우면 전체 창고 공통 기준입니다.</p>
      <div className={`${C.card} overflow-x-auto`}>
        <table className="w-full">
          <thead><tr><th className={C.th}>품목</th><th className={C.th}>카테고리</th><th className={C.th}>창고</th><th className={C.th}>안전재고</th><th className={C.th}>재주문점</th><th className={C.th}>목표재고</th><th className={C.th}></th></tr></thead>
          <tbody>
            {rows.length === 0 ? <tr><td colSpan={7} className="p-6 text-center text-text-quaternary text-sm">설정된 안전재고 없음</td></tr> :
              rows.map((r) => (
                <tr key={r.id}>
                  <td className={`${C.td} text-text-primary font-medium`}>{r.product_name}</td>
                  <td className={C.td}>{r.category}</td>
                  <td className={C.td}>{r.warehouse_name}</td>
                  <td className={C.td}>{fmt(r.safety_stock)}</td>
                  <td className={C.td}>{fmt(r.reorder_point)}</td>
                  <td className={C.td}>{fmt(r.target_stock)}</td>
                  <td className={C.td}><button onClick={() => del(r.id)} className="text-danger text-xs hover:underline">삭제</button></td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function OpeningUpload({ warehouses }: { warehouses: Warehouse[] }) {
  const [file, setFile] = useState<File | null>(null);
  const [whId, setWhId] = useState<number | ''>('');
  const [date, setDate] = useState('2025-01-01');
  const [preview, setPreview] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  const run = async (dry: boolean) => {
    if (!file) { alert('파일을 선택하세요'); return; }
    if (!whId) { alert('기본 창고를 선택하세요 (엑셀에 창고 열이 없으면 이 창고로 반영)'); return; }
    setBusy(true);
    const fd = new FormData(); fd.append('file', file);
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    const r = await fetch(`/api/inventory/opening/upload?default_warehouse_id=${whId}&default_date=${date}&dry_run=${dry}&mode=replace`,
      { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: fd });
    const data = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok || data.ok === false) { alert('오류: ' + (data.parse_errors?.join(', ') || data.detail || '실패')); setPreview(data); return; }
    setPreview(data);
    if (!dry) alert(`반영 완료 · ${data.applied}건 (매칭실패 ${data.error_count}건)`);
  };

  return (
    <div className="space-y-3">
      <div className={`${C.card} p-4 space-y-3`}>
        <p className="text-sm text-text-secondary">기존 엑셀로 정리해 둔 <b>기초재고</b>를 업로드하세요. 인식 열: <span className="text-text-tertiary">창고 · 품목(명/코드) · 수량 · (선택)기준일</span>.
          판매 데이터 시작점(2025-01-01)을 기준일로 두면, 이후 판매만큼 자동 차감됩니다.</p>
        <div className="flex flex-wrap items-end gap-3">
          <div><div className="text-xs text-text-tertiary mb-1">기본 창고 *</div>
            <select value={whId} onChange={(e) => setWhId(e.target.value ? Number(e.target.value) : '')} className={C.input}>
              <option value="">선택</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select></div>
          <div><div className="text-xs text-text-tertiary mb-1">기준일</div><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={C.input} /></div>
          <div><div className="text-xs text-text-tertiary mb-1">엑셀 파일</div>
            <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="text-sm text-text-secondary file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-border-primary file:text-text-secondary" /></div>
          <button onClick={() => run(true)} disabled={busy} className={`${C.btn} ${C.btnGhost}`}>미리보기</button>
          <button onClick={() => run(false)} disabled={busy} className={`${C.btn} ${C.btnPrimary}`}>{busy ? '처리 중…' : '기초재고 반영'}</button>
        </div>
        <p className="text-xs text-text-quaternary">반영(mode=replace)은 동일 창고·품목의 기존 기초재고를 대체합니다. 판매·조정·실사 이력은 보존됩니다.</p>
      </div>
      {preview && preview.rows && (
        <div className={`${C.card} p-4`}>
          <div className="text-sm font-semibold text-text-primary mb-2">
            {preview.dry_run ? '미리보기' : '반영 결과'} · 총 {fmt(preview.row_count)}행 {preview.unmatched != null && <span className="text-warning">· 매칭실패 {fmt(preview.unmatched)}</span>}
          </div>
          <div className="overflow-x-auto max-h-80">
            <table className="w-full">
              <thead><tr><th className={C.th}>창고</th><th className={C.th}>품목(엑셀)</th><th className={C.th}>수량</th><th className={C.th}>매칭</th></tr></thead>
              <tbody>
                {(preview.rows || []).slice(0, 200).map((r: any, i: number) => (
                  <tr key={i}>
                    <td className={C.td}>{r.warehouse || '(기본)'}</td>
                    <td className={C.td}>{r.product_name || r.product_code}</td>
                    <td className={C.td}>{fmt(r.qty)}</td>
                    <td className={C.td}>{r.matched === false ? <span className="text-danger text-xs">실패</span> : <span className="text-success-light text-xs">{r.matched_name || 'OK'}</span>}</td>
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

function Empty({ msg }: { msg?: string }) {
  return <div className="h-[200px] flex items-center justify-center text-sm text-text-quaternary">{msg || '데이터 없음'}</div>;
}
