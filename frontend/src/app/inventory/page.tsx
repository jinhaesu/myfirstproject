'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Navigation } from '@/components/layout/Navigation';
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

type Tab = '대시보드' | '재고 현황' | '보충 알림' | '재고 실사' | '설정';
type SettingsTab = '창고' | '채널-창고 매핑' | '안전재고' | '기초재고 업로드';

// ─────────────────────────────────────────────────────────
// UI atoms
// ─────────────────────────────────────────────────────────
const C = {
  card: 'bg-[#0F1011] border border-[#23252A] rounded-xl',
  input: 'bg-[#08090A] border border-[#23252A] rounded-lg px-3 py-2 text-sm text-[#F7F8F8] focus:outline-none focus:border-[#5E6AD2]',
  btn: 'px-3 py-2 rounded-lg text-sm font-semibold transition-colors',
  btnPrimary: 'bg-[#5E6AD2] hover:bg-[#4d58bd] text-white',
  btnGhost: 'bg-[#1A1B1E] hover:bg-[#23252A] text-[#D0D6E0] border border-[#23252A]',
  th: 'text-left text-xs font-semibold text-[#8A8F98] px-3 py-2 border-b border-[#23252A] whitespace-nowrap',
  td: 'px-3 py-2 text-sm text-[#D0D6E0] border-b border-[#1A1B1E] whitespace-nowrap',
};
const fmt = (n: number | null | undefined) => (n === null || n === undefined ? '-' : Number(n).toLocaleString('ko-KR'));
const numShort = (n: number) => { const a = Math.abs(n || 0); if (a >= 1e8) return (n / 1e8).toFixed(2).replace(/\.00$/, '') + '억'; if (a >= 1e4) return (n / 1e4).toFixed(1).replace(/\.0$/, '') + '만'; return Math.round(n || 0).toLocaleString('ko-KR'); };

function StatusBadge({ s }: { s: string }) {
  const m: Record<string, string> = {
    정상: 'bg-[#27A644]/15 text-[#3FBE5B]', 주의: 'bg-[#F0BF00]/15 text-[#F0BF00]',
    부족: 'bg-[#EB5757]/15 text-[#EB5757]', 품절: 'bg-[#EB5757]/25 text-[#FF7A7A]',
  };
  return <span className={`px-2 py-0.5 rounded-md text-xs font-semibold ${m[s] || 'bg-[#23252A] text-[#8A8F98]'}`}>{s}</span>;
}

function StatCard({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className={`${C.card} p-4`}>
      <div className="text-[11px] text-[#8A8F98] mb-1 truncate" title={label}>{label}</div>
      <div className={`text-lg font-bold tabular-nums leading-tight break-keep ${tone || 'text-[#F7F8F8]'}`}>{value}</div>
      {sub && <div className="text-[11px] text-[#62666D] mt-1 truncate">{sub}</div>}
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

  if (isLoading || !user) return <div className="min-h-screen bg-[#08090A]" />;

  const tabs: Tab[] = ['대시보드', '재고 현황', '보충 알림', '재고 실사', '설정'];

  return (
    <div className="min-h-screen bg-[#08090A]">
      <Navigation />
      <main className="max-w-[1400px] mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-xl font-bold text-[#F7F8F8]">물류/재고 실적</h1>
            <p className="text-sm text-[#8A8F98] mt-0.5">판매 데이터 연동 재고 — 기초재고에서 출발해 판매만큼 자동 차감됩니다.</p>
          </div>
        </div>

        <div className="flex gap-1 mb-5 border-b border-[#23252A]">
          {tabs.map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors ${
                tab === t ? 'border-[#5E6AD2] text-[#828FFF]' : 'border-transparent text-[#8A8F98] hover:text-[#D0D6E0]'}`}>
              {t}
            </button>
          ))}
        </div>

        {tab === '대시보드' && <DashboardTab warehouses={warehouses} />}
        {tab === '재고 현황' && <StockTab warehouses={warehouses} categories={categories} />}
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
  const [range, setRange] = useState(presetRange('thisMonth'));
  const [gran, setGran] = useState<'month' | 'week' | 'day'>('day');
  const [whId, setWhId] = useState<number | ''>('');
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [heat, setHeat] = useState<{ months: string[]; rows: HeatRow[] }>({ months: [], rows: [] });
  const [logi, setLogi] = useState<any>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setD(await getJSON<Dashboard | null>(`/inventory/dashboard?as_of=${range.end}`, null));
    setLoading(false);
  }, [range.end]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { getJSON<any>(`/inventory/logistics/dashboard?start=${range.start}&end=${range.end}`, null).then(setLogi); }, [range]);

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
    <div className="space-y-5">
      <div className={`${C.card} p-3 flex flex-wrap items-center gap-2 sticky top-[52px] z-10`}>
        <span className="text-sm font-semibold text-[#F7F8F8]">기간</span>
        <input type="date" value={range.start} onChange={(e) => setRange({ ...range, start: e.target.value })} className={C.input} />
        <span className="text-[#62666D]">~</span>
        <input type="date" value={range.end} onChange={(e) => setRange({ ...range, end: e.target.value })} className={C.input} />
        <div className="flex flex-wrap gap-1">
          {RANGE_PRESETS.map(([k, l]) => <button key={k} onClick={() => setRange(presetRange(k))} className={`${C.btn} ${C.btnGhost} px-2 py-1`}>{l}</button>)}
        </div>
        <div className="flex bg-[#08090A] border border-[#23252A] rounded-lg p-0.5">
          {(['month', 'week', 'day'] as const).map((g) => (
            <button key={g} onClick={() => setGran(g)} className={`${C.btn} px-2.5 py-1 ${gran === g ? C.btnPrimary : 'text-[#8A8F98]'}`}>{g === 'month' ? '월' : g === 'week' ? '주' : '일'}</button>
          ))}
        </div>
        <select value={whId} onChange={(e) => setWhId(e.target.value ? Number(e.target.value) : '')} className={C.input}>
          <option value="">전체 창고</option>
          {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        <span className="text-xs text-[#62666D] ml-auto">현황 기준일 = {range.end}</span>
        {loading && <span className="text-xs text-[#62666D]">불러오는 중…</span>}
      </div>

      {d && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <StatCard label="총 재고 수량 (낱개)" value={numShort(d.total_qty)} />
            <StatCard label="관리 품목 수" value={fmt(d.product_count)} />
            <StatCard label="창고 수" value={fmt(d.warehouse_count)} />
            <StatCard label="보충 필요" value={fmt(d.shortage_count)} tone="text-[#F0BF00]" sub="재주문점 이하" />
            <StatCard label="품절" value={fmt(d.out_of_stock_count)} tone="text-[#EB5757]" sub="현재고 0 이하" />
          </div>

          {(() => {
            const oos = d.out_of_stock_count, short = d.shortage_count;
            const normal = Math.max(d.product_count - oos - short, 0);
            const segs = [
              { label: '정상', v: normal, c: '#27A644' },
              { label: '보충 필요', v: short, c: '#F0BF00' },
              { label: '품절', v: oos, c: '#EB5757' },
            ];
            const tot = Math.max(d.product_count, 1);
            return (
              <div className={`${C.card} p-4`}>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-semibold text-[#F7F8F8]">재고 상태 분포</div>
                  <div className="text-xs text-[#8A8F98]">총 {fmt(d.product_count)} 품목</div>
                </div>
                <div className="flex h-4 rounded-lg overflow-hidden mb-2">
                  {segs.map((s) => s.v > 0 && <div key={s.label} style={{ width: `${(s.v / tot) * 100}%`, background: s.c }} title={`${s.label} ${s.v}`} />)}
                </div>
                <div className="flex flex-wrap gap-4">
                  {segs.map((s) => (
                    <div key={s.label} className="flex items-center gap-1.5 text-xs">
                      <span className="w-2.5 h-2.5 rounded-sm" style={{ background: s.c }} />
                      <span className="text-[#8A8F98]">{s.label}</span>
                      <span className="text-[#F7F8F8] font-semibold">{fmt(s.v)}</span>
                      <span className="text-[#62666D]">({Math.round((s.v / tot) * 100)}%)</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* 물류 작업 요약 (생산 실적 대시보드 기능 병합) */}
          {logi && logi.record_count > 0 && (
            <div className={`${C.card} p-4 border-l-2 border-l-[#00B8CC]`}>
              <div className="flex items-center justify-between mb-3">
                <div className="text-sm font-semibold text-[#F7F8F8]">물류 작업 요약 <span className="text-xs text-[#62666D]">({range.start}~{range.end})</span></div>
                <a href="/inventory/logistics" className="text-xs text-[#828FFF] hover:underline">물류 작업 실적 →</a>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-3">
                <StatCard label="총 작업량" value={numShort(logi.total_qty)} sub={`${fmt(logi.record_count)}건`} />
                <StatCard label="총 작업액" value={numShort(logi.total_amount)} />
                <StatCard label="노무비" value={numShort(logi.total_labor)} tone="text-[#00B8CC]" sub={`노무비율 ${logi.labor_ratio}%`} />
                <StatCard label="채산성" value={`${logi.profitability}배`} tone={logi.profitability >= 3 ? 'text-[#3FBE5B]' : 'text-[#F0BF00]'} />
                <StatCard label="시간당 작업량" value={fmt(logi.hourly_qty)} sub={`${numShort(logi.total_hours)}h`} />
              </div>
              {logi.by_type?.length > 0 && (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={logi.by_type.slice(0, 8)} layout="vertical" margin={{ left: 30 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1A1B1E" />
                    <XAxis type="number" tick={{ fill: '#8A8F98', fontSize: 11 }} />
                    <YAxis type="category" dataKey="work_type" tick={{ fill: '#8A8F98', fontSize: 11 }} width={80} />
                    <Tooltip contentStyle={{ background: '#0F1011', border: '1px solid #23252A', borderRadius: 8 }} formatter={(v: any) => fmt(v)} />
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
            <div className="text-sm font-semibold text-[#F7F8F8] mb-3">재고 흐름 · {gran === 'month' ? '월별' : gran === 'week' ? '주별' : '일별'} (생산입고·판매출고·기말재고)</div>
            {trend.length === 0 ? <Empty msg="이 기간 흐름 데이터 없음" /> : (
              <ResponsiveContainer width="100%" height={280}>
                <ComposedChart data={trend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1A1B1E" />
                  <XAxis dataKey="period" tick={{ fill: '#8A8F98', fontSize: 10 }} />
                  <YAxis yAxisId="l" tick={{ fill: '#8A8F98', fontSize: 10 }} />
                  <YAxis yAxisId="r" orientation="right" tick={{ fill: '#8A8F98', fontSize: 10 }} />
                  <Tooltip contentStyle={{ background: '#0F1011', border: '1px solid #23252A', borderRadius: 8 }} formatter={(v: any) => fmt(v)} />
                  <Legend />
                  <Bar yAxisId="l" dataKey="inbound" name="생산입고" fill="#27A644" />
                  <Bar yAxisId="l" dataKey="outbound" name="판매출고" fill="#EB5757" />
                  <Line yAxisId="r" type="monotone" dataKey="closing" name="기말재고" stroke="#5E6AD2" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className={`${C.card} p-4`}>
            <div className="text-sm font-semibold text-[#F7F8F8] mb-1">재고 입출고 히트맵 (순증감 = 생산−판매)</div>
            <div className="text-xs text-[#62666D] mb-3">초록=순증(생산 우위) · 빨강=순감(판매 우위) · 활동 상위 15품목</div>
            {heat.rows.length === 0 ? <Empty msg="데이터 없음" /> : (
              <div className="overflow-x-auto">
                <table className="border-collapse">
                  <thead><tr>
                    <th className="text-left text-xs font-semibold text-[#8A8F98] px-2 py-1 sticky left-0 bg-[#0F1011]">품목</th>
                    {heat.months.map((m) => <th key={m} className="text-xs text-[#8A8F98] px-1 py-1 whitespace-nowrap">{m.slice(5)}</th>)}
                    <th className="text-xs text-[#8A8F98] px-2 py-1">누계</th>
                  </tr></thead>
                  <tbody>
                    {heat.rows.map((r) => (
                      <tr key={r.product_id}>
                        <td className="text-xs text-[#F7F8F8] px-2 py-1 whitespace-nowrap sticky left-0 bg-[#0F1011]">{r.product_name}</td>
                        {r.cells.map((c, i) => (
                          <td key={i} className="text-[10px] text-center px-1 py-1 whitespace-nowrap" style={{ background: heatColor(c), color: Math.abs(c) / heatMax > 0.5 ? '#fff' : '#8A8F98' }}
                            title={`${heat.months[i]}: ${c > 0 ? '+' : ''}${fmt(c)}`}>
                            {c === 0 ? '·' : (c > 0 ? '+' : '') + (Math.abs(c) >= 10000 ? Math.round(c / 1000) + 'k' : fmt(c))}
                          </td>
                        ))}
                        <td className={`text-xs px-2 py-1 text-right font-semibold ${r.total >= 0 ? 'text-[#3FBE5B]' : 'text-[#EB5757]'}`}>{r.total > 0 ? '+' : ''}{fmt(r.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className={`${C.card} p-4`}>
              <div className="text-sm font-semibold text-[#F7F8F8] mb-3">창고별 재고 분포</div>
              {d.by_warehouse.length === 0 ? <Empty /> : (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={d.by_warehouse} layout="vertical" margin={{ left: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1A1B1E" />
                    <XAxis type="number" tick={{ fill: '#8A8F98', fontSize: 11 }} />
                    <YAxis type="category" dataKey="warehouse_name" tick={{ fill: '#8A8F98', fontSize: 11 }} width={90} />
                    <Tooltip contentStyle={{ background: '#0F1011', border: '1px solid #23252A', borderRadius: 8, color: '#F7F8F8' }}
                      formatter={(v: any) => fmt(v)} />
                    <Bar dataKey="qty" radius={[0, 4, 4, 0]}>
                      {d.by_warehouse.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
            <div className={`${C.card} p-4`}>
              <div className="text-sm font-semibold text-[#F7F8F8] mb-3">카테고리별 재고 분포</div>
              {d.by_category.length === 0 ? <Empty /> : (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={d.by_category} layout="vertical" margin={{ left: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1A1B1E" />
                    <XAxis type="number" tick={{ fill: '#8A8F98', fontSize: 11 }} />
                    <YAxis type="category" dataKey="category" tick={{ fill: '#8A8F98', fontSize: 11 }} width={90} />
                    <Tooltip contentStyle={{ background: '#0F1011', border: '1px solid #23252A', borderRadius: 8, color: '#F7F8F8' }}
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
                <div className="text-sm font-semibold text-[#F7F8F8] mb-1">{usingAbs ? '카테고리별 재고 포지션 규모 (원형)' : '현재 잔여 재고 비중 (카테고리별)'}</div>
                <div className="text-xs text-[#62666D] mb-3">기준일 {d.as_of} · {usingAbs ? '기초재고 미반영 → 순포지션(절대값) 규모 표시. 기초재고 업로드 시 실제 잔여재고로 전환' : '잔여(양수) 재고'}</div>
                {PIE.length === 0 ? <Empty msg="데이터 없음" /> : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-center">
                    <ResponsiveContainer width="100%" height={260}>
                      <PieChart>
                        <Pie data={PIE} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={95} label={(e: any) => e.name}>
                          {PIE.map((p, i) => <Cell key={i} fill={p.fill} />)}
                        </Pie>
                        <Tooltip contentStyle={{ background: '#0F1011', border: '1px solid #23252A', borderRadius: 8 }} formatter={(v: any) => fmt(v)} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="space-y-1">
                      {src.slice(0, 10).map((c, i) => (
                        <div key={c.category} className="flex items-center justify-between text-sm py-1 border-b border-[#1A1B1E]">
                          <span className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} /><span className="text-[#D0D6E0]">{c.category}</span></span>
                          <span className="text-[#F7F8F8] tabular-nums">{usingAbs ? '−' : ''}{fmt(c.qty)}</span>
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
              <div className="text-sm font-semibold text-[#F7F8F8]">보충 필요 품목 (Top {d.replenishment_top.length})</div>
              <div className="text-xs text-[#8A8F98]">총 {fmt(d.replenishment_total)}건</div>
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
                        <td className={`${C.td} font-semibold text-[#828FFF]`}>{fmt(r.suggest_qty)}</td>
                        <td className={C.td}><StatusBadge s={r.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <p className="text-xs text-[#62666D]">기준일 {d.as_of} · 판매 데이터 연동 실시간 계산</p>
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
        <div className="flex bg-[#0F1011] border border-[#23252A] rounded-lg p-0.5">
          <button onClick={() => setMode('snapshot')} className={`${C.btn} ${mode === 'snapshot' ? C.btnPrimary : 'text-[#8A8F98]'}`}>시점 재고</button>
          <button onClick={() => setMode('flow')} className={`${C.btn} ${mode === 'flow' ? C.btnPrimary : 'text-[#8A8F98]'}`}>기간 흐름</button>
        </div>
        {mode === 'snapshot' ? (
          <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} className={C.input} />
        ) : (
          <>
            <input type="date" value={range.start} onChange={(e) => setRange({ ...range, start: e.target.value })} className={C.input} />
            <span className="text-[#62666D]">~</span>
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
        {loading && <span className="text-xs text-[#62666D]">불러오는 중…</span>}
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
              {snap.length === 0 ? <tr><td colSpan={8} className="p-6 text-center text-[#62666D] text-sm">데이터 없음</td></tr> :
                snap.map((r, i) => (
                  <tr key={`${r.product_id}-${i}`}>
                    <td className={C.td}>{r.product_code}</td>
                    <td className={`${C.td} text-[#F7F8F8] font-medium`}>{r.product_name}</td>
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
              {flows.length === 0 ? <tr><td colSpan={8} className="p-6 text-center text-[#62666D] text-sm">데이터 없음</td></tr> :
                flows.map((r) => (
                  <tr key={r.product_id}>
                    <td className={`${C.td} text-[#F7F8F8] font-medium`}>{r.product_name}</td>
                    <td className={C.td}>{r.category}</td>
                    <td className={C.td}>{fmt(r.opening)}</td>
                    <td className={`${C.td} text-[#3FBE5B]`}>{r.inflow ? '+' + fmt(r.inflow) : '-'}</td>
                    <td className={`${C.td} text-[#EB5757]`}>{r.sold ? '−' + fmt(r.sold) : '-'}</td>
                    <td className={C.td}>{r.adjustment ? fmt(r.adjustment) : '-'}</td>
                    <td className={C.td}>{r.correction ? fmt(r.correction) : '-'}</td>
                    <td className={`${C.td} font-semibold text-[#F7F8F8]`}>{fmt(r.closing)}</td>
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
        {loading && <span className="text-xs text-[#62666D]">불러오는 중…</span>}
        <span className="text-sm text-[#8A8F98] ml-auto">현재고가 재주문점 이하인 품목 · 안전재고 기준 설정 필요</span>
      </div>
      <div className={`${C.card} overflow-x-auto`}>
        <table className="w-full">
          <thead><tr>
            <th className={C.th}>품목명</th><th className={C.th}>카테고리</th><th className={C.th}>현재고</th>
            <th className={C.th}>안전재고</th><th className={C.th}>재주문점</th><th className={C.th}>부족분</th>
            <th className={C.th}>권장 보충</th><th className={C.th}>상태</th>
          </tr></thead>
          <tbody>
            {items.length === 0 ? <tr><td colSpan={8} className="p-6 text-center text-[#62666D] text-sm">보충 필요 품목 없음 (또는 안전재고 미설정)</td></tr> :
              items.map((r) => (
                <tr key={r.product_id}>
                  <td className={`${C.td} text-[#F7F8F8] font-medium`}>{r.product_name}</td>
                  <td className={C.td}>{r.category}</td>
                  <td className={C.td}>{fmt(r.qty)}</td>
                  <td className={C.td}>{fmt(r.safety_stock)}</td>
                  <td className={C.td}>{fmt(r.reorder_point)}</td>
                  <td className={`${C.td} text-[#EB5757]`}>{fmt(r.shortfall)}</td>
                  <td className={`${C.td} font-semibold text-[#828FFF]`}>{fmt(r.suggest_qty)}</td>
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
      <div className="flex items-center justify-between">
        <span className="text-sm text-[#8A8F98]">주·월·분기 실사로 시스템재고와 실재고를 대조합니다. 차이 발생 시 수정 사유 입력이 필수입니다.</span>
        <button onClick={() => setCreating(!creating)} className={`${C.btn} ${C.btnPrimary}`}>+ 실사 세션</button>
      </div>
      {creating && (
        <div className={`${C.card} p-4 flex flex-wrap items-end gap-3`}>
          <div><div className="text-xs text-[#8A8F98] mb-1">창고</div>
            <select value={nWh} onChange={(e) => setNWh(e.target.value ? Number(e.target.value) : '')} className={C.input}>
              <option value="">선택</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select></div>
          <div><div className="text-xs text-[#8A8F98] mb-1">실사일</div>
            <input type="date" value={nDate} onChange={(e) => setNDate(e.target.value)} className={C.input} /></div>
          <div><div className="text-xs text-[#8A8F98] mb-1">주기</div>
            <select value={nPeriod} onChange={(e) => setNPeriod(e.target.value)} className={C.input}>
              <option value="weekly">주간</option><option value="monthly">월간</option><option value="quarterly">분기</option><option value="adhoc">수시</option>
            </select></div>
          <div className="flex-1 min-w-[160px]"><div className="text-xs text-[#8A8F98] mb-1">제목(선택)</div>
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
            {sessions.length === 0 ? <tr><td colSpan={7} className="p-6 text-center text-[#62666D] text-sm">실사 세션 없음</td></tr> :
              sessions.map((s) => (
                <tr key={s.id} className="hover:bg-[#0F1011] cursor-pointer" onClick={() => setOpenId(s.id)}>
                  <td className={C.td}>{s.count_date}</td>
                  <td className={C.td}>{s.warehouse_name}</td>
                  <td className={C.td}>{({ weekly: '주간', monthly: '월간', quarterly: '분기', adhoc: '수시' } as any)[s.period_type] || s.period_type}</td>
                  <td className={C.td}>{s.title || '-'}</td>
                  <td className={C.td}>{s.status === 'confirmed'
                    ? <span className="px-2 py-0.5 rounded-md text-xs font-semibold bg-[#27A644]/15 text-[#3FBE5B]">확정</span>
                    : <span className="px-2 py-0.5 rounded-md text-xs font-semibold bg-[#F0BF00]/15 text-[#F0BF00]">작성중</span>}</td>
                  <td className={C.td}>{s.confirmed_by || '-'}</td>
                  <td className={C.td}>{s.status !== 'confirmed' &&
                    <button onClick={(e) => { e.stopPropagation(); del(s.id); }} className="text-[#EB5757] text-xs hover:underline">삭제</button>}</td>
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
        {sess && <div className="text-sm text-[#D0D6E0]"><span className="font-semibold text-[#F7F8F8]">{sess.warehouse_name}</span> · {sess.count_date} · {sess.title || '실사'}</div>}
        {locked && <span className="px-2 py-0.5 rounded-md text-xs font-semibold bg-[#27A644]/15 text-[#3FBE5B]">확정됨 (읽기전용)</span>}
        <div className="ml-auto flex gap-2">
          {!locked && <button onClick={save} disabled={saving} className={`${C.btn} ${C.btnGhost}`}>{saving ? '저장 중…' : '임시 저장'}</button>}
          {!locked && <button onClick={confirm_} className={`${C.btn} ${C.btnPrimary}`}>실사 확정</button>}
        </div>
      </div>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="품목/카테고리 검색" className={`${C.input} w-64`} />
      {loading ? <div className="text-sm text-[#62666D] p-4">불러오는 중…</div> : (
        <div className={`${C.card} overflow-x-auto max-h-[65vh]`}>
          <table className="w-full">
            <thead className="sticky top-0 bg-[#0F1011]"><tr>
              <th className={C.th}>품목명</th><th className={C.th}>카테고리</th><th className={C.th}>시스템재고</th>
              <th className={C.th}>실재고</th><th className={C.th}>차이</th><th className={C.th}>수정 사유</th>
            </tr></thead>
            <tbody>
              {shown.map((l) => {
                const d = diffOf(l);
                const needReason = d !== null && Math.abs(d) > 0;
                return (
                  <tr key={l.product_id}>
                    <td className={`${C.td} text-[#F7F8F8] font-medium`}>{l.product_name}</td>
                    <td className={C.td}>{l.category}</td>
                    <td className={C.td}>{fmt(l.system_qty)}</td>
                    <td className={C.td}>
                      <input type="number" disabled={locked} value={edited[l.product_id]?.counted_qty ?? ''}
                        onChange={(e) => setVal(l.product_id, 'counted_qty', e.target.value === '' ? null : Number(e.target.value))}
                        className={`${C.input} w-24 py-1`} placeholder="—" />
                    </td>
                    <td className={`${C.td} font-semibold ${d === null ? '' : d > 0 ? 'text-[#3FBE5B]' : d < 0 ? 'text-[#EB5757]' : 'text-[#8A8F98]'}`}>
                      {d === null ? '-' : (d > 0 ? '+' : '') + fmt(d)}
                    </td>
                    <td className={C.td}>
                      <input disabled={locked} value={edited[l.product_id]?.reason || ''}
                        onChange={(e) => setVal(l.product_id, 'reason', e.target.value)}
                        placeholder={needReason ? '사유 필수' : ''}
                        className={`${C.input} w-56 py-1 ${needReason && !(edited[l.product_id]?.reason || '').trim() ? 'border-[#EB5757]' : ''}`} />
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
        <div><div className="text-xs text-[#8A8F98] mb-1">코드</div><input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="WH1" className={`${C.input} w-24`} /></div>
        <div className="flex-1 min-w-[160px]"><div className="text-xs text-[#8A8F98] mb-1">창고명 *</div><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="본사 물류창고" className={`${C.input} w-full`} /></div>
        <div className="flex-1 min-w-[160px]"><div className="text-xs text-[#8A8F98] mb-1">위치</div><input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} className={`${C.input} w-full`} /></div>
        <button onClick={save} className={`${C.btn} ${C.btnPrimary}`}>{form.id ? '수정' : '+ 추가'}</button>
        {form.id && <button onClick={() => setForm({ code: '', name: '', location: '' })} className={`${C.btn} ${C.btnGhost}`}>취소</button>}
      </div>
      <div className={`${C.card} overflow-x-auto`}>
        <table className="w-full">
          <thead><tr><th className={C.th}>코드</th><th className={C.th}>창고명</th><th className={C.th}>위치</th><th className={C.th}>상태</th><th className={C.th}></th></tr></thead>
          <tbody>
            {warehouses.length === 0 ? <tr><td colSpan={5} className="p-6 text-center text-[#62666D] text-sm">창고를 추가하세요</td></tr> :
              warehouses.map((w) => (
                <tr key={w.id}>
                  <td className={C.td}>{w.code || '-'}</td>
                  <td className={`${C.td} text-[#F7F8F8] font-medium`}>{w.name}</td>
                  <td className={C.td}>{w.location || '-'}</td>
                  <td className={C.td}>{w.is_active ? <StatusBadge s="정상" /> : <span className="text-xs text-[#62666D]">비활성</span>}</td>
                  <td className={C.td}>
                    <button onClick={() => setForm({ id: w.id, code: w.code || '', name: w.name, location: w.location || '' })} className="text-[#828FFF] text-xs hover:underline mr-3">수정</button>
                    <button onClick={() => del(w.id)} className="text-[#EB5757] text-xs hover:underline">삭제</button>
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
        <span className="text-sm text-[#8A8F98]">각 판매채널이 어느 창고에서 출고되는지 지정하면, 그 채널의 판매가 해당 창고 재고에서 차감됩니다.</span>
        {unassigned > 0 && <span className="px-2 py-0.5 rounded-md text-xs font-semibold bg-[#F0BF00]/15 text-[#F0BF00]">미지정 {unassigned}개</span>}
        <button onClick={save} disabled={saving} className={`${C.btn} ${C.btnPrimary} ml-auto`}>{saving ? '저장 중…' : '변경 저장'}</button>
      </div>
      <div className={`${C.card} overflow-x-auto max-h-[65vh]`}>
        <table className="w-full">
          <thead className="sticky top-0 bg-[#0F1011]"><tr><th className={C.th}>채널명</th><th className={C.th}>카테고리</th><th className={C.th}>창고 지정</th></tr></thead>
          <tbody>
            {channels.map((c) => (
              <tr key={c.channel_id} className={effective(c) === null ? 'bg-[#F0BF00]/[0.03]' : ''}>
                <td className={`${C.td} text-[#F7F8F8] font-medium`}>{c.channel_name}</td>
                <td className={C.td}>{c.category || '-'}</td>
                <td className={C.td}>
                  <select value={effective(c) ?? ''} onChange={(e) => setWh(c.channel_id, e.target.value ? Number(e.target.value) : null)}
                    className={`${C.input} py-1 ${c.channel_id in dirty ? 'border-[#5E6AD2]' : ''}`}>
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
        <div className="col-span-2"><div className="text-xs text-[#8A8F98] mb-1">품목 *</div>
          <select value={form.product_id} onChange={(e) => setForm({ ...form, product_id: e.target.value ? Number(e.target.value) : '' })} className={`${C.input} w-full`}>
            <option value="">선택</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.category})</option>)}
          </select></div>
        <div><div className="text-xs text-[#8A8F98] mb-1">창고</div>
          <select value={form.warehouse_id} onChange={(e) => setForm({ ...form, warehouse_id: e.target.value ? Number(e.target.value) : '' })} className={`${C.input} w-full`}>
            <option value="">전체공통</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select></div>
        <div><div className="text-xs text-[#8A8F98] mb-1">안전재고</div><input type="number" value={form.safety_stock} onChange={(e) => setForm({ ...form, safety_stock: e.target.value })} className={`${C.input} w-full`} /></div>
        <div><div className="text-xs text-[#8A8F98] mb-1">재주문점</div><input type="number" value={form.reorder_point} onChange={(e) => setForm({ ...form, reorder_point: e.target.value })} className={`${C.input} w-full`} /></div>
        <div><div className="text-xs text-[#8A8F98] mb-1">목표재고</div><input type="number" value={form.target_stock} onChange={(e) => setForm({ ...form, target_stock: e.target.value })} className={`${C.input} w-full`} /></div>
        <button onClick={save} className={`${C.btn} ${C.btnPrimary}`}>저장</button>
      </div>
      <p className="text-xs text-[#62666D]">현재고 ≤ 재주문점 → 보충 알림. 권장 보충량은 목표재고−현재고로 자동 산출됩니다. 창고를 비우면 전체 창고 공통 기준입니다.</p>
      <div className={`${C.card} overflow-x-auto`}>
        <table className="w-full">
          <thead><tr><th className={C.th}>품목</th><th className={C.th}>카테고리</th><th className={C.th}>창고</th><th className={C.th}>안전재고</th><th className={C.th}>재주문점</th><th className={C.th}>목표재고</th><th className={C.th}></th></tr></thead>
          <tbody>
            {rows.length === 0 ? <tr><td colSpan={7} className="p-6 text-center text-[#62666D] text-sm">설정된 안전재고 없음</td></tr> :
              rows.map((r) => (
                <tr key={r.id}>
                  <td className={`${C.td} text-[#F7F8F8] font-medium`}>{r.product_name}</td>
                  <td className={C.td}>{r.category}</td>
                  <td className={C.td}>{r.warehouse_name}</td>
                  <td className={C.td}>{fmt(r.safety_stock)}</td>
                  <td className={C.td}>{fmt(r.reorder_point)}</td>
                  <td className={C.td}>{fmt(r.target_stock)}</td>
                  <td className={C.td}><button onClick={() => del(r.id)} className="text-[#EB5757] text-xs hover:underline">삭제</button></td>
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
        <p className="text-sm text-[#D0D6E0]">기존 엑셀로 정리해 둔 <b>기초재고</b>를 업로드하세요. 인식 열: <span className="text-[#8A8F98]">창고 · 품목(명/코드) · 수량 · (선택)기준일</span>.
          판매 데이터 시작점(2025-01-01)을 기준일로 두면, 이후 판매만큼 자동 차감됩니다.</p>
        <div className="flex flex-wrap items-end gap-3">
          <div><div className="text-xs text-[#8A8F98] mb-1">기본 창고 *</div>
            <select value={whId} onChange={(e) => setWhId(e.target.value ? Number(e.target.value) : '')} className={C.input}>
              <option value="">선택</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select></div>
          <div><div className="text-xs text-[#8A8F98] mb-1">기준일</div><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={C.input} /></div>
          <div><div className="text-xs text-[#8A8F98] mb-1">엑셀 파일</div>
            <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="text-sm text-[#D0D6E0] file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-[#23252A] file:text-[#D0D6E0]" /></div>
          <button onClick={() => run(true)} disabled={busy} className={`${C.btn} ${C.btnGhost}`}>미리보기</button>
          <button onClick={() => run(false)} disabled={busy} className={`${C.btn} ${C.btnPrimary}`}>{busy ? '처리 중…' : '기초재고 반영'}</button>
        </div>
        <p className="text-xs text-[#62666D]">반영(mode=replace)은 동일 창고·품목의 기존 기초재고를 대체합니다. 판매·조정·실사 이력은 보존됩니다.</p>
      </div>
      {preview && preview.rows && (
        <div className={`${C.card} p-4`}>
          <div className="text-sm font-semibold text-[#F7F8F8] mb-2">
            {preview.dry_run ? '미리보기' : '반영 결과'} · 총 {fmt(preview.row_count)}행 {preview.unmatched != null && <span className="text-[#F0BF00]">· 매칭실패 {fmt(preview.unmatched)}</span>}
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
                    <td className={C.td}>{r.matched === false ? <span className="text-[#EB5757] text-xs">실패</span> : <span className="text-[#3FBE5B] text-xs">{r.matched_name || 'OK'}</span>}</td>
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
  return <div className="h-[200px] flex items-center justify-center text-sm text-[#62666D]">{msg || '데이터 없음'}</div>;
}
