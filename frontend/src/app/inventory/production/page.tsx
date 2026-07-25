'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Navigation } from '@/components/layout/Navigation';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
  LineChart, Line, PieChart, Pie, Legend, ComposedChart, Area,
} from 'recharts';

// ── API ──
const getAuthHeaders = (): Record<string, string> => {
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) h['Authorization'] = `Bearer ${token}`;
  return h;
};
const getJSON = async <T,>(path: string, def: T): Promise<T> => {
  try { const r = await fetch(`/api${path}`, { headers: getAuthHeaders() }); if (!r.ok) throw new Error(); return await r.json(); }
  catch { return def; }
};
const send = async (path: string, method: string, body?: any): Promise<{ ok: boolean; data: any }> => {
  try {
    const r = await fetch(`/api${path}`, { method, headers: getAuthHeaders(), body: body !== undefined ? JSON.stringify(body) : undefined });
    const data = await r.json().catch(() => ({}));
    return { ok: r.ok, data };
  } catch { return { ok: false, data: {} }; }
};

// ── types ──
interface Warehouse { id: number; name: string; }
interface ProdRow { id: number; prod_date: string; worker: string; location: string; category: string; product_name: string; qty: number; hours: number; unit_price: number; prod_amount: number; unit_cost: number; total_cost: number; labor_cost: number; unit_labor: number; hourly_qty: number; grade: string; matched: boolean; matched_name: string | null; batch_id: string; }
interface Batch { batch_id: string; count: number; qty: number; period: string; uploaded_at: string; }
interface ProdDash {
  record_count: number; total_qty: number; total_amount: number; total_cost: number; total_hours: number;
  total_labor: number; hourly_wage: number; cost_ratio: number; labor_ratio: number;
  profitability: number; hourly_qty: number;
  by_category: { category: string; qty: number; amount: number; cost: number; labor: number; hours: number; unit_labor: number; hourly_qty: number; profitability: number }[];
  by_worker: { worker: string; qty: number; amount: number; hours: number; labor: number }[];
  by_month: { month: string; qty: number; amount: number; cost: number; labor: number }[];
  by_grade: { grade: string; qty: number }[];
  by_location: { location: string; qty: number; hours: number; labor: number; hourly_qty: number }[];
}

// ── UI atoms ──
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
const won = (n: number) => '₩' + Number(n || 0).toLocaleString('ko-KR');
const wonShort = (n: number) => { const a = Math.abs(n || 0); if (a >= 1e8) return (n / 1e8).toFixed(1).replace(/\.0$/, '') + '억'; if (a >= 1e4) return Math.round(n / 1e4).toLocaleString('ko-KR') + '만'; return '₩' + Math.round(n || 0).toLocaleString('ko-KR'); };
const numShort = (n: number) => { const a = Math.abs(n || 0); if (a >= 1e8) return (n / 1e8).toFixed(2).replace(/\.00$/, '') + '억'; if (a >= 1e4) return (n / 1e4).toFixed(1).replace(/\.0$/, '') + '만'; return Math.round(n || 0).toLocaleString('ko-KR'); };
const COLORS = ['#5E6AD2', '#27A644', '#F0BF00', '#00B8CC', '#EB5757', '#A855F7', '#F97316', '#14B8A6'];
const todayISO = () => new Date().toISOString().slice(0, 10);
const iso = (d: Date) => d.toISOString().slice(0, 10);
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
  if (kind === 'thisYear') return { start: iso(new Date(y, 0, 1)), end: iso(now) };
  return { start: '2025-01-01', end: iso(now) };
}
const PRESETS: [string, string][] = [
  ['7d', '7일'], ['14d', '14일'], ['thisMonth', '당월'], ['lastMonth', '전월'],
  ['thisQuarter', '당분기'], ['lastQuarter', '전분기'], ['lastYear', '전년도'], ['all', '전체'],
];
function PeriodBar({ range, setRange }: { range: { start: string; end: string }; setRange: (r: { start: string; end: string }) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input type="date" value={range.start} onChange={(e) => setRange({ ...range, start: e.target.value })} className={C.input} />
      <span className="text-[#62666D]">~</span>
      <input type="date" value={range.end} onChange={(e) => setRange({ ...range, end: e.target.value })} className={C.input} />
      <div className="flex flex-wrap gap-1">
        {PRESETS.map(([k, l]) => (
          <button key={k} onClick={() => setRange(presetRange(k))} className={`${C.btn} ${C.btnGhost} px-2.5 py-1.5`}>{l}</button>
        ))}
      </div>
    </div>
  );
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

type Tab = '대시보드' | '실적 조회' | '실적 입력' | '담당자·문자' | '업로드';
interface TSPoint { period: string; qty: number; hours: number; amount: number; cost: number; labor: number; hourly_qty: number; profitability: number; day_qty: number; night_qty: number; }
interface LaborCmp { total_prod_hours: number; total_att_hours: number; total_hours_ratio: number; total_prod_labor: number; total_att_cost: number; total_att_cost_est: number; note: string; error?: string; series: { month: string; prod_hours: number; att_hours: number; dispatch_hours: number; regular_hours: number; hours_ratio: number; prod_labor: number; att_cost: number; att_cost_est: number; regular_pay: number; att_ok: boolean; by_workplace: Record<string, number>; by_dept: Record<string, number> }[]; }

export default function ProductionPage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('대시보드');
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);

  useEffect(() => { if (!isLoading && !user) router.replace('/login'); }, [isLoading, user, router]);
  useEffect(() => {
    if (user) getJSON<{ warehouses: Warehouse[] }>('/inventory/warehouses', { warehouses: [] }).then((r) => setWarehouses(r.warehouses));
  }, [user]);

  if (isLoading || !user) return <div className="min-h-screen bg-[#08090A]" />;
  const tabs: Tab[] = ['대시보드', '실적 조회', '실적 입력', '담당자·문자', '업로드'];

  return (
    <div className="min-h-screen bg-[#08090A]">
      <Navigation />
      <main className="max-w-[1400px] mx-auto px-4 py-6">
        <div className="mb-4">
          <h1 className="text-xl font-bold text-[#F7F8F8]">생산 실적</h1>
          <p className="text-sm text-[#8A8F98] mt-0.5">생산 RAW-DATA를 업로드하면 품목류 단위로 재고가 보충됩니다(판매 차감과 상계).</p>
        </div>
        <div className="flex gap-1 mb-5 border-b border-[#23252A]">
          {tabs.map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors ${tab === t ? 'border-[#5E6AD2] text-[#828FFF]' : 'border-transparent text-[#8A8F98] hover:text-[#D0D6E0]'}`}>
              {t}
            </button>
          ))}
        </div>
        {tab === '대시보드' && <DashTab />}
        {tab === '실적 조회' && <RecordsTab />}
        {tab === '실적 입력' && <InputTab warehouses={warehouses} />}
        {tab === '담당자·문자' && <PhoneTab />}
        {tab === '업로드' && <UploadTab warehouses={warehouses} />}
      </main>
    </div>
  );
}

function DashTab() {
  const [range, setRange] = useState(presetRange('thisMonth'));
  const [cat, setCat] = useState('');
  const [gran, setGran] = useState<'month' | 'week' | 'day'>('day');
  const [d, setD] = useState<ProdDash | null>(null);
  const [ts, setTs] = useState<TSPoint[]>([]);
  const [cats, setCats] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [labor, setLabor] = useState<LaborCmp | null>(null);
  const [laborLoading, setLaborLoading] = useState(false);
  useEffect(() => {
    setLaborLoading(true);
    getJSON<LaborCmp | null>(`/inventory/labor-compare?start=${range.start}&end=${range.end}`, null).then((r) => { setLabor(r); setLaborLoading(false); });
  }, [range]);

  useEffect(() => { getJSON<{ categories: string[] }>('/inventory/production/categories', { categories: [] }).then((r) => setCats(r.categories)); }, []);
  const load = useCallback(async () => {
    setLoading(true);
    const catq = cat ? `&category=${encodeURIComponent(cat)}` : '';
    const [dd, tt] = await Promise.all([
      getJSON<ProdDash | null>(`/inventory/production/dashboard?start=${range.start}&end=${range.end}`, null),
      getJSON<{ series: TSPoint[] }>(`/inventory/production/timeseries?granularity=${gran}&start=${range.start}&end=${range.end}${catq}`, { series: [] }),
    ]);
    setD(dd); setTs(tt.series); setLoading(false);
  }, [range, cat, gran]);
  useEffect(() => { load(); }, [load]);

  const PIE = d?.by_category.slice(0, 10).map((c, i) => ({ name: c.category, value: c.qty, fill: COLORS[i % COLORS.length] })) || [];
  const granLabel = gran === 'day' ? '일별' : gran === 'week' ? '주별' : '월별';

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <PeriodBar range={range} setRange={setRange} />
        <select value={cat} onChange={(e) => setCat(e.target.value)} className={C.input}>
          <option value="">전체 품목류</option>
          {cats.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <div className="flex bg-[#0F1011] border border-[#23252A] rounded-lg p-0.5">
          <button onClick={() => setGran('month')} className={`${C.btn} px-2.5 py-1 ${gran === 'month' ? C.btnPrimary : 'text-[#8A8F98]'}`}>월</button>
          <button onClick={() => setGran('week')} className={`${C.btn} px-2.5 py-1 ${gran === 'week' ? C.btnPrimary : 'text-[#8A8F98]'}`}>주</button>
          <button onClick={() => setGran('day')} className={`${C.btn} px-2.5 py-1 ${gran === 'day' ? C.btnPrimary : 'text-[#8A8F98]'}`}>일</button>
        </div>
        {loading && <span className="text-xs text-[#62666D]">불러오는 중…</span>}
      </div>
      {d && d.record_count === 0 && (
        <div className={`${C.card} p-8 text-center text-sm text-[#62666D]`}>이 기간에 생산 데이터가 없습니다. [업로드] 또는 [실적 입력] 탭에서 추가하세요.</div>
      )}
      {d && d.record_count > 0 && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
            <StatCard label="총 생산량 (낱개)" value={numShort(d.total_qty)} sub={`${fmt(d.record_count)}건`} />
            <StatCard label="총 생산액" value={wonShort(d.total_amount)} />
            <StatCard label="총 원가" value={wonShort(d.total_cost)} tone="text-[#F0BF00]" sub={`원가율 ${d.cost_ratio}%`} />
            <StatCard label={`노무비 (시급 ${fmt(d.hourly_wage)}·야1.5)`} value={wonShort(d.total_labor)} tone="text-[#00B8CC]" sub={`노무비율 ${d.labor_ratio}%`} />
            <StatCard label="채산성" value={`${d.profitability}배`} tone={d.profitability >= 3 ? 'text-[#3FBE5B]' : 'text-[#F0BF00]'} sub="생산액÷노무비" />
            <StatCard label="총 생산시간" value={`${numShort(d.total_hours)}h`} />
            <StatCard label="시간당 생산량" value={fmt(d.hourly_qty)} sub="낱개/시간" />
          </div>

          {/* 층별 생산량·투여시간·시간당생산량 */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {d.by_location.filter((l) => l.location && l.location !== '미상').map((l, i) => (
              <div key={l.location} className={`${C.card} p-4`}>
                <div className="text-sm font-semibold mb-2 flex items-center gap-2" style={{ color: COLORS[i % COLORS.length] }}>
                  <span className="w-2 h-2 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />{l.location} 생산
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div><div className="text-[11px] text-[#8A8F98]">생산량</div><div className="text-lg font-bold tabular-nums text-[#F7F8F8]">{numShort(l.qty)}</div></div>
                  <div><div className="text-[11px] text-[#8A8F98]">투여시간</div><div className="text-lg font-bold tabular-nums text-[#F7F8F8]">{numShort(l.hours)}h</div></div>
                  <div><div className="text-[11px] text-[#8A8F98]">시간당생산량</div><div className="text-lg font-bold tabular-nums text-[#3FBE5B]">{fmt(l.hourly_qty)}</div></div>
                </div>
              </div>
            ))}
          </div>

          {/* 근태(mysixthproject) 노무시간·노무비 대조 */}
          <div className={`${C.card} p-4 border-l-2 border-l-[#F0BF00]`}>
            <div className="flex items-center gap-2 mb-1">
              <div className="text-sm font-semibold text-[#F7F8F8]">노무시간·노무비 대조 (근태 시스템 연동)</div>
              {laborLoading && <span className="text-xs text-[#62666D]">근태 불러오는 중…</span>}
            </div>
            {labor?.error && <div className="text-xs text-[#EB5757] mb-2">연동 오류: {labor.error}</div>}
            {labor && !labor.error && (
              <>
                {(() => {
                  const totReg = labor.series.reduce((s, x) => s + (x.regular_hours || 0), 0);
                  const totDisp = labor.series.reduce((s, x) => s + (x.dispatch_hours || 0), 0);
                  const totRegPay = labor.series.reduce((s, x) => s + (x.regular_pay || 0), 0);
                  return (
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-3">
                      <StatCard label="생산일보 투여시간" value={`${numShort(labor.total_prod_hours)}h`} />
                      <StatCard label="근태 노무시간" value={`${numShort(labor.total_att_hours)}h`} tone="text-[#00B8CC]" sub={`정규직 ${numShort(totReg)}h + 파견 ${numShort(totDisp)}h`} />
                      <StatCard label="시간 비율(생산÷근태)" value={`${labor.total_hours_ratio}배`} tone={labor.total_hours_ratio > 1.3 || labor.total_hours_ratio < 0.7 ? 'text-[#EB5757]' : 'text-[#3FBE5B]'} sub="1에 가까울수록 정합" />
                      <StatCard label="산출 노무비(15k기준)" value={wonShort(labor.total_prod_labor)} tone="text-[#00B8CC]" />
                      <StatCard label="근태 실지급+환산" value={wonShort(labor.total_att_cost)} sub={`정규직 실급여 ${wonShort(totRegPay)}`} />
                    </div>
                  );
                })()}
                <ResponsiveContainer width="100%" height={240}>
                  <ComposedChart data={labor.series}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1A1B1E" />
                    <XAxis dataKey="month" tick={{ fill: '#8A8F98', fontSize: 10 }} />
                    <YAxis yAxisId="l" tick={{ fill: '#8A8F98', fontSize: 10 }} />
                    <YAxis yAxisId="r" orientation="right" tick={{ fill: '#8A8F98', fontSize: 10 }} />
                    <Tooltip contentStyle={{ background: '#0F1011', border: '1px solid #23252A', borderRadius: 8 }} formatter={(v: any) => fmt(v)} />
                    <Legend />
                    <Bar yAxisId="l" dataKey="prod_hours" name="생산일보 투여시간" fill="#5E6AD2" />
                    <Bar yAxisId="l" dataKey="att_hours" name="근태 노무시간" fill="#00B8CC" />
                    <Line yAxisId="r" type="monotone" dataKey="hours_ratio" name="비율(배)" stroke="#F0BF00" strokeWidth={2} dot />
                  </ComposedChart>
                </ResponsiveContainer>
                <div className="text-xs text-[#F0BF00] mt-2">⚠ {labor.note}</div>
                {labor.total_hours_ratio > 1.5 && <div className="text-xs text-[#8A8F98] mt-1">생산일보 투여시간이 실제 근태보다 {labor.total_hours_ratio}배 많습니다 — 생산일보의 시간 기입 기준(공정 중복/설비시간 포함 여부)을 점검하세요.</div>}
              </>
            )}
          </div>

          {/* 생산성·채산성 시계열 (품목류 필터 적용) */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className={`${C.card} p-4`}>
              <div className="text-sm font-semibold text-[#F7F8F8] mb-3">{granLabel} 생산성 (시간당 생산량){cat && ` · ${cat}`}</div>
              <ResponsiveContainer width="100%" height={240}>
                <ComposedChart data={ts}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1A1B1E" />
                  <XAxis dataKey="period" tick={{ fill: '#8A8F98', fontSize: 10 }} />
                  <YAxis yAxisId="l" tick={{ fill: '#8A8F98', fontSize: 10 }} />
                  <YAxis yAxisId="r" orientation="right" tick={{ fill: '#8A8F98', fontSize: 10 }} />
                  <Tooltip contentStyle={{ background: '#0F1011', border: '1px solid #23252A', borderRadius: 8 }} formatter={(v: any) => fmt(v)} />
                  <Bar yAxisId="l" dataKey="hours" name="투여시간" fill="#23252A" />
                  <Line yAxisId="r" type="monotone" dataKey="hourly_qty" name="시간당 생산량" stroke="#5E6AD2" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div className={`${C.card} p-4`}>
              <div className="text-sm font-semibold text-[#F7F8F8] mb-3">{granLabel} 채산성 (생산액÷노무비){cat && ` · ${cat}`}</div>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={ts}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1A1B1E" />
                  <XAxis dataKey="period" tick={{ fill: '#8A8F98', fontSize: 10 }} />
                  <YAxis tick={{ fill: '#8A8F98', fontSize: 10 }} />
                  <Tooltip contentStyle={{ background: '#0F1011', border: '1px solid #23252A', borderRadius: 8 }} formatter={(v: any) => v} />
                  <Line type="monotone" dataKey="profitability" name="채산성(배)" stroke="#3FBE5B" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* 생산량 추이 + 주야 비교 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className={`${C.card} p-4`}>
              <div className="text-sm font-semibold text-[#F7F8F8] mb-3">{granLabel} 생산량 · 원가 · 노무비</div>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={ts}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1A1B1E" />
                  <XAxis dataKey="period" tick={{ fill: '#8A8F98', fontSize: 10 }} />
                  <YAxis yAxisId="l" tick={{ fill: '#8A8F98', fontSize: 10 }} />
                  <YAxis yAxisId="r" orientation="right" tick={{ fill: '#8A8F98', fontSize: 10 }} />
                  <Tooltip contentStyle={{ background: '#0F1011', border: '1px solid #23252A', borderRadius: 8 }} formatter={(v: any) => fmt(v)} />
                  <Line yAxisId="l" type="monotone" dataKey="qty" name="생산량" stroke="#5E6AD2" strokeWidth={2} dot={false} />
                  <Line yAxisId="r" type="monotone" dataKey="cost" name="원가" stroke="#F0BF00" strokeWidth={2} dot={false} />
                  <Line yAxisId="r" type="monotone" dataKey="labor" name="노무비" stroke="#00B8CC" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className={`${C.card} p-4`}>
              <div className="text-sm font-semibold text-[#F7F8F8] mb-3">주간 / 야간 생산량 비교</div>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={ts}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1A1B1E" />
                  <XAxis dataKey="period" tick={{ fill: '#8A8F98', fontSize: 10 }} />
                  <YAxis tick={{ fill: '#8A8F98', fontSize: 10 }} />
                  <Tooltip contentStyle={{ background: '#0F1011', border: '1px solid #23252A', borderRadius: 8 }} formatter={(v: any) => fmt(v)} />
                  <Legend />
                  <Bar dataKey="day_qty" name="주간" stackId="s" fill="#5E6AD2" />
                  <Bar dataKey="night_qty" name="야간" stackId="s" fill="#A855F7" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* 생산 비중 파이 + 층/주야 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className={`${C.card} p-4`}>
              <div className="text-sm font-semibold text-[#F7F8F8] mb-3">기간 누계 품목류별 생산 비중</div>
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie data={PIE} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} label={(e: any) => e.name}>
                    {PIE.map((p, i) => <Cell key={i} fill={p.fill} />)}
                  </Pie>
                  <Tooltip contentStyle={{ background: '#0F1011', border: '1px solid #23252A', borderRadius: 8 }} formatter={(v: any) => fmt(v)} />
                </PieChart>
              </ResponsiveContainer>
            </div>

          <div className="contents">
            <div className={`${C.card} p-4`}>
              <div className="text-sm font-semibold text-[#F7F8F8] mb-3">품목류별 생산량</div>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={d.by_category.slice(0, 12)} layout="vertical" margin={{ left: 30 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1A1B1E" />
                  <XAxis type="number" tick={{ fill: '#8A8F98', fontSize: 11 }} />
                  <YAxis type="category" dataKey="category" tick={{ fill: '#8A8F98', fontSize: 11 }} width={80} />
                  <Tooltip contentStyle={{ background: '#0F1011', border: '1px solid #23252A', borderRadius: 8 }} formatter={(v: any) => fmt(v)} />
                  <Bar dataKey="qty" radius={[0, 4, 4, 0]}>
                    {d.by_category.slice(0, 12).map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className={`${C.card} p-4`}>
              <div className="flex items-center justify-between mb-3">
                <div className="text-sm font-semibold text-[#F7F8F8]">생산위치(층)별 · 주야</div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs text-[#8A8F98] mb-2">층별 생산량·시간</div>
                  {d.by_location.map((l, i) => (
                    <div key={l.location} className="flex items-center justify-between py-1.5 border-b border-[#1A1B1E]">
                      <span className="text-sm text-[#F7F8F8]" style={{ color: COLORS[i % COLORS.length] }}>{l.location}</span>
                      <span className="text-sm text-[#D0D6E0]">{fmt(l.qty)} · {fmt(l.hours)}h</span>
                    </div>
                  ))}
                </div>
                <div>
                  <div className="text-xs text-[#8A8F98] mb-2">주간/야간 생산량</div>
                  {d.by_grade.map((g, i) => (
                    <div key={g.grade} className="flex items-center justify-between py-1.5 border-b border-[#1A1B1E]">
                      <span className="text-sm text-[#F7F8F8]">{g.grade}</span>
                      <span className="text-sm text-[#D0D6E0]">{fmt(g.qty)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
          </div>

          <div className={`${C.card} p-4`}>
            <div className="text-sm font-semibold text-[#F7F8F8] mb-3">품목류별 원가·노무비·생산성</div>
            <div className="overflow-x-auto max-h-[360px]">
              <table className="w-full">
                <thead className="sticky top-0 bg-[#0F1011]"><tr>
                  <th className={C.th}>품목류</th><th className={C.th}>생산량</th><th className={C.th}>생산액</th><th className={C.th}>원가총액</th>
                  <th className={C.th}>노무비</th><th className={C.th}>시간당 생산량</th><th className={C.th}>개당 노무비</th>
                </tr></thead>
                <tbody>
                  {d.by_category.map((c) => (
                    <tr key={c.category}>
                      <td className={`${C.td} text-[#F7F8F8] font-medium`}>{c.category}</td>
                      <td className={C.td}>{fmt(c.qty)}</td>
                      <td className={C.td}>{won(c.amount)}</td>
                      <td className={C.td}>{won(c.cost)}</td>
                      <td className={`${C.td} text-[#00B8CC]`}>{won(c.labor)}</td>
                      <td className={C.td}>{fmt(c.hourly_qty)}/h</td>
                      <td className={C.td}>₩{fmt(c.unit_labor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className={`${C.card} p-4`}>
            <div className="text-sm font-semibold text-[#F7F8F8] mb-3">담당자별 생산량 · 시간 · 노무비</div>
            <div className="overflow-x-auto max-h-[300px]">
              <table className="w-full">
                <thead className="sticky top-0 bg-[#0F1011]"><tr><th className={C.th}>담당자</th><th className={C.th}>생산량</th><th className={C.th}>생산액</th><th className={C.th}>시간</th><th className={C.th}>노무비</th></tr></thead>
                <tbody>
                  {d.by_worker.map((w) => (
                    <tr key={w.worker}><td className={`${C.td} text-[#F7F8F8]`}>{w.worker}</td><td className={C.td}>{fmt(w.qty)}</td><td className={C.td}>{won(w.amount)}</td><td className={C.td}>{fmt(w.hours)}h</td><td className={`${C.td} text-[#00B8CC]`}>{won(w.labor)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <p className="text-xs text-[#62666D]">노무비 = 시급 {fmt(d.hourly_wage)}원 × 생산투여시간 · 개당 노무비 = 노무비 ÷ 생산량 · {range.start} ~ {range.end}</p>
        </>
      )}
    </div>
  );
}

function RecordsTab() {
  const [rows, setRows] = useState<ProdRow[]>([]);
  const [total, setTotal] = useState(0);
  const [range, setRange] = useState({ start: '2025-01-01', end: todayISO() });
  const [cat, setCat] = useState('');
  const [worker, setWorker] = useState('');
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    const qs = new URLSearchParams({ start: range.start, end: range.end, limit: '500' });
    if (cat) qs.set('category', cat);
    if (worker) qs.set('worker', worker);
    const r = await getJSON<{ rows: ProdRow[]; total: number }>(`/inventory/production?${qs}`, { rows: [], total: 0 });
    setRows(r.rows); setTotal(r.total); setLoading(false);
  }, [range, cat, worker]);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <PeriodBar range={range} setRange={setRange} />
        <input value={cat} onChange={(e) => setCat(e.target.value)} placeholder="품목류" className={`${C.input} w-28`} />
        <input value={worker} onChange={(e) => setWorker(e.target.value)} placeholder="담당자" className={`${C.input} w-28`} />
        <span className="text-xs text-[#8A8F98] ml-auto">{loading ? '불러오는 중…' : `${fmt(rows.length)} / 총 ${fmt(total)}건`}</span>
      </div>
      <div className={`${C.card} overflow-x-auto max-h-[70vh]`}>
        <table className="w-full">
          <thead className="sticky top-0 bg-[#0F1011]"><tr>
            <th className={C.th}>생산일</th><th className={C.th}>담당자</th><th className={C.th}>위치</th><th className={C.th}>품목류</th>
            <th className={C.th}>품목명</th><th className={C.th}>생산량</th><th className={C.th}>시간</th><th className={C.th}>생산액</th>
            <th className={C.th}>원가총액</th><th className={C.th}>노무비</th><th className={C.th}>주야</th><th className={C.th}>재고반영</th>
          </tr></thead>
          <tbody>
            {rows.length === 0 ? <tr><td colSpan={12} className="p-6 text-center text-[#62666D] text-sm">데이터 없음</td></tr> :
              rows.map((r) => (
                <tr key={r.id}>
                  <td className={C.td}>{r.prod_date}</td>
                  <td className={C.td}>{r.worker || '-'}</td>
                  <td className={C.td}>{r.location || '-'}</td>
                  <td className={`${C.td} text-[#F7F8F8]`}>{r.category}</td>
                  <td className={C.td}>{r.product_name}</td>
                  <td className={`${C.td} font-semibold`}>{fmt(r.qty)}</td>
                  <td className={C.td}>{fmt(r.hours)}h</td>
                  <td className={C.td}>{won(r.prod_amount)}</td>
                  <td className={C.td}>{won(r.total_cost)}</td>
                  <td className={`${C.td} text-[#00B8CC]`}>{won(r.labor_cost)}</td>
                  <td className={C.td}>{r.grade || '-'}</td>
                  <td className={C.td}>{r.matched ? <span className="text-[#3FBE5B] text-xs">{r.matched_name}</span> : <span className="text-[#EB5757] text-xs">미매칭</span>}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface WorkerPhone { id: number; name: string; phone: string; location: string | null; role: string | null; is_active: boolean; last_sent_at: string | null; }
function PhoneTab() {
  const [rows, setRows] = useState<WorkerPhone[]>([]);
  const [form, setForm] = useState<any>({ name: '', phone: '', location: '2층', role: '생산' });
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [msg, setMsg] = useState('');
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    const r = await getJSON<{ rows: WorkerPhone[] }>('/inventory/worker-phones', { rows: [] });
    setRows(r.rows);
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const link = typeof window !== 'undefined' ? `${window.location.origin}/inventory/production` : '';
    setMsg(`[조인앤조인 생산] 오늘 생산 실적을 입력해 주세요.\n입력: ${link}\n(품목명·생산량·투여시간 필수)`);
  }, []);

  const save = async () => {
    if (!form.name.trim() || !form.phone.trim()) { alert('이름·핸드폰을 입력하세요'); return; }
    const r = await send('/inventory/worker-phones', 'POST', { id: form.id, name: form.name, phone: form.phone, location: form.location || null, role: form.role || null, is_active: true });
    if (r.ok) { setForm({ name: '', phone: '', location: '2층', role: '생산' }); load(); } else alert('저장 실패');
  };
  const del = async (id: number) => { if (!confirm('삭제?')) return; const r = await send(`/inventory/worker-phones/${id}`, 'DELETE'); if (r.ok) load(); };
  const toggle = (id: number) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allActive = rows.filter((r) => r.is_active);

  const sendSms = async () => {
    const ids = sel.size ? Array.from(sel) : allActive.map((r) => r.id);
    if (!ids.length) { alert('발송 대상이 없습니다'); return; }
    if (!confirm(`${ids.length}명에게 실적 입력 요청 문자를 발송합니다.`)) return;
    setSending(true);
    const r = await send('/inventory/worker-phones/send', 'POST', { ids, message: msg });
    setSending(false);
    if (r.ok && r.data.sent) { alert(`서버 발송 완료 · ${r.data.count}건`); load(); return; }
    // provider 미설정 → 문자앱 딥링크
    const phones: string[] = r.data?.phones || rows.filter((x) => ids.includes(x.id)).map((x) => x.phone);
    const link = `sms:${phones.join(',')}?&body=${encodeURIComponent(msg)}`;
    if (typeof window !== 'undefined') window.location.href = link;
    load();
  };

  return (
    <div className="space-y-4">
      <div className={`${C.card} p-4`}>
        <div className="text-sm font-semibold text-[#F7F8F8] mb-1">생산 담당자 핸드폰 리스트</div>
        <p className="text-xs text-[#62666D] mb-3">여기 담긴 담당자에게 실적 입력 요청 문자를 발송합니다. (서버 SMS 미설정 시 휴대폰 문자앱이 열립니다)</p>
        <div className="flex flex-wrap items-end gap-2 mb-3">
          <div><div className="text-xs text-[#8A8F98] mb-1">이름 *</div><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={`${C.input} w-28`} /></div>
          <div><div className="text-xs text-[#8A8F98] mb-1">핸드폰 *</div><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="010-1234-5678" className={`${C.input} w-36`} /></div>
          <div><div className="text-xs text-[#8A8F98] mb-1">담당 층</div>
            <select value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} className={C.input}><option>2층</option><option>3층</option><option value="">기타</option></select></div>
          <div><div className="text-xs text-[#8A8F98] mb-1">구분</div><input value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className={`${C.input} w-24`} /></div>
          <button onClick={save} className={`${C.btn} ${C.btnPrimary}`}>{form.id ? '수정' : '+ 추가'}</button>
          {form.id && <button onClick={() => setForm({ name: '', phone: '', location: '2층', role: '생산' })} className={`${C.btn} ${C.btnGhost}`}>취소</button>}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead><tr>
              <th className={C.th}><input type="checkbox" checked={sel.size > 0 && sel.size === allActive.length} onChange={(e) => setSel(e.target.checked ? new Set(allActive.map((r) => r.id)) : new Set())} /></th>
              <th className={C.th}>이름</th><th className={C.th}>핸드폰</th><th className={C.th}>층</th><th className={C.th}>구분</th><th className={C.th}>최근 발송</th><th className={C.th}></th>
            </tr></thead>
            <tbody>
              {rows.length === 0 ? <tr><td colSpan={7} className="p-6 text-center text-[#62666D] text-sm">담당자를 추가하세요</td></tr> :
                rows.map((r) => (
                  <tr key={r.id}>
                    <td className={C.td}><input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} /></td>
                    <td className={`${C.td} text-[#F7F8F8]`}>{r.name}</td>
                    <td className={C.td}>{r.phone}</td>
                    <td className={C.td}>{r.location || '-'}</td>
                    <td className={C.td}>{r.role || '-'}</td>
                    <td className={C.td}>{r.last_sent_at ? new Date(r.last_sent_at).toLocaleString('ko-KR') : '-'}</td>
                    <td className={C.td}>
                      <button onClick={() => setForm({ id: r.id, name: r.name, phone: r.phone, location: r.location || '', role: r.role || '' })} className="text-[#828FFF] text-xs hover:underline mr-2">수정</button>
                      <button onClick={() => del(r.id)} className="text-[#EB5757] text-xs hover:underline">삭제</button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className={`${C.card} p-4`}>
        <div className="text-sm font-semibold text-[#F7F8F8] mb-2">실적 입력 요청 문자</div>
        <textarea value={msg} onChange={(e) => setMsg(e.target.value)} rows={4} className={`${C.input} w-full mb-2`} />
        <div className="flex items-center gap-2">
          <button onClick={sendSms} disabled={sending} className={`${C.btn} ${C.btnPrimary}`}>{sending ? '발송 중…' : `📩 ${sel.size ? sel.size + '명 선택' : '활성 전체'} 발송`}</button>
          <span className="text-xs text-[#62666D]">체크한 담당자에게(미선택 시 전체) 발송 · 링크 포함</span>
        </div>
      </div>
    </div>
  );
}

interface CatalogItem { product_name: string; category: string; unit_price: number; unit_cost: number; }
function InputTab({ warehouses }: { warehouses: Warehouse[] }) {
  const [cats, setCats] = useState<string[]>([]);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [recent, setRecent] = useState<ProdRow[]>([]);
  const [f, setF] = useState<any>({ prod_date: todayISO(), worker: '', location: '2층', category: '', product_name: '', qty: '', hours: '', unit_price: '', unit_cost: '', grade: '주간', warehouse_id: '' });
  const [saving, setSaving] = useState(false);

  const loadRecent = useCallback(async () => {
    const r = await getJSON<{ rows: ProdRow[] }>('/inventory/production?limit=20', { rows: [] });
    setRecent(r.rows.filter((x) => x.batch_id === 'manual'));
  }, []);
  useEffect(() => {
    getJSON<{ categories: string[] }>('/inventory/production/categories', { categories: [] }).then((r) => setCats(r.categories));
    getJSON<{ items: CatalogItem[] }>('/inventory/production/catalog', { items: [] }).then((r) => setCatalog(r.items));
    loadRecent();
  }, [loadRecent]);
  useEffect(() => { if (warehouses.length && !f.warehouse_id) setF((p: any) => ({ ...p, warehouse_id: warehouses[0].id })); }, [warehouses, f.warehouse_id]);

  // 품목명 선택 시 평균 생산단가·원가 자동계산
  const onPickProduct = (name: string) => {
    const hit = catalog.find((c) => c.product_name === name);
    setF((p: any) => ({ ...p, product_name: name, ...(hit ? { unit_price: hit.unit_price, unit_cost: hit.unit_cost, category: hit.category || p.category } : {}) }));
  };
  const filteredCatalog = f.category ? catalog.filter((c) => c.category === f.category) : catalog;

  const submit = async () => {
    if (!f.category) { alert('품목류를 입력/선택하세요'); return; }
    if (!f.product_name) { alert('품목명(상세)을 선택/입력하세요 — 필수'); return; }
    if (!f.hours || Number(f.hours) <= 0) { alert('투여시간을 입력하세요 — 필수'); return; }
    if (!f.qty || Number(f.qty) <= 0) { alert('생산량을 입력하세요'); return; }
    if (!f.warehouse_id) { alert('입고 창고를 선택하세요'); return; }
    setSaving(true);
    const body = { ...f, qty: Number(f.qty), hours: Number(f.hours || 0), unit_price: Number(f.unit_price || 0), unit_cost: Number(f.unit_cost || 0), warehouse_id: Number(f.warehouse_id) };
    const r = await send('/inventory/production/manual', 'POST', body);
    setSaving(false);
    if (r.ok) {
      alert(`등록 완료 · ${r.data.matched ? '재고반영(' + r.data.matched_name + ')' : '미매칭(재고 미반영)'}`);
      setF((p: any) => ({ ...p, product_name: '', qty: '', hours: '', unit_price: '', unit_cost: '' }));
      loadRecent();
    } else alert('실패: ' + (r.data?.detail || r.data?.msg || ''));
  };
  const del = async (id: number) => {
    if (!confirm('삭제하시겠습니까? (재고 반영분도 취소됩니다)')) return;
    const r = await send(`/inventory/production/${id}`, 'DELETE');
    if (r.ok) loadRecent();
  };

  const nightLabor = f.hours ? Math.round(15000 * Number(f.hours) * (f.grade === '야간' ? 1.5 : 1)) : 0;

  return (
    <div className="space-y-4">
      <div className={`${C.card} p-4`}>
        <div className="text-sm font-semibold text-[#F7F8F8] mb-3">생산 실적 직접 입력</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div><div className="text-xs text-[#8A8F98] mb-1">생산일 *</div><input type="date" value={f.prod_date} onChange={(e) => setF({ ...f, prod_date: e.target.value })} className={`${C.input} w-full`} /></div>
          <div><div className="text-xs text-[#8A8F98] mb-1">담당자</div><input value={f.worker} onChange={(e) => setF({ ...f, worker: e.target.value })} className={`${C.input} w-full`} /></div>
          <div><div className="text-xs text-[#8A8F98] mb-1">생산위치(층)</div>
            <select value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} className={`${C.input} w-full`}>
              <option value="2층">2층</option><option value="3층">3층</option><option value="">기타</option>
            </select></div>
          <div><div className="text-xs text-[#8A8F98] mb-1">주야 구분</div>
            <select value={f.grade} onChange={(e) => setF({ ...f, grade: e.target.value })} className={`${C.input} w-full`}>
              <option value="주간">주간</option><option value="야간">야간(노무비 1.5배)</option>
            </select></div>
          <div><div className="text-xs text-[#8A8F98] mb-1">품목류 * (마스터 매칭)</div>
            <input list="catlist" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} placeholder="마카롱 등" className={`${C.input} w-full`} />
            <datalist id="catlist">{cats.map((c) => <option key={c} value={c} />)}</datalist></div>
          <div><div className="text-xs text-[#8A8F98] mb-1">품목명(상세) *</div>
            <input list="prodlist" value={f.product_name} onChange={(e) => onPickProduct(e.target.value)} placeholder="목록에서 선택" className={`${C.input} w-full ${!f.product_name ? 'border-[#EB5757]/50' : ''}`} />
            <datalist id="prodlist">{filteredCatalog.map((c) => <option key={c.product_name} value={c.product_name}>{c.category}</option>)}</datalist></div>
          <div><div className="text-xs text-[#8A8F98] mb-1">생산량(낱개) *</div><input type="number" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} className={`${C.input} w-full`} /></div>
          <div><div className="text-xs text-[#8A8F98] mb-1">투여시간(h) *</div><input type="number" value={f.hours} onChange={(e) => setF({ ...f, hours: e.target.value })} className={`${C.input} w-full ${!f.hours ? 'border-[#EB5757]/50' : ''}`} /></div>
          <div><div className="text-xs text-[#8A8F98] mb-1">개당 생산단가 (자동)</div><input readOnly value={f.unit_price !== '' ? Number(f.unit_price).toLocaleString('ko-KR') : ''} placeholder="품목명 선택 시 자동" className={`${C.input} w-full bg-[#141516] text-[#8A8F98]`} /></div>
          <div><div className="text-xs text-[#8A8F98] mb-1">개당 원가 (자동)</div><input readOnly value={f.unit_cost !== '' ? Number(f.unit_cost).toLocaleString('ko-KR') : ''} placeholder="품목명 선택 시 자동" className={`${C.input} w-full bg-[#141516] text-[#8A8F98]`} /></div>
          <div><div className="text-xs text-[#8A8F98] mb-1">입고 창고 *</div>
            <select value={f.warehouse_id} onChange={(e) => setF({ ...f, warehouse_id: e.target.value })} className={`${C.input} w-full`}>
              <option value="">선택</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select></div>
          <div className="flex items-end"><button onClick={submit} disabled={saving} className={`${C.btn} ${C.btnPrimary} w-full`}>{saving ? '저장 중…' : '실적 등록'}</button></div>
        </div>
        <p className="text-xs text-[#62666D] mt-2">예상 노무비: <span className="text-[#00B8CC]">{won(nightLabor)}</span> (시급 15,000{f.grade === '야간' ? ' × 1.5(야간)' : ''} × {f.hours || 0}h)</p>
      </div>

      <div className={`${C.card} p-4`}>
        <div className="text-sm font-semibold text-[#F7F8F8] mb-3">최근 직접 입력분</div>
        {recent.length === 0 ? <div className="text-sm text-[#62666D]">없음</div> : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr><th className={C.th}>생산일</th><th className={C.th}>품목류</th><th className={C.th}>생산량</th><th className={C.th}>시간</th><th className={C.th}>노무비</th><th className={C.th}>주야</th><th className={C.th}>반영</th><th className={C.th}></th></tr></thead>
              <tbody>
                {recent.map((r) => (
                  <tr key={r.id}>
                    <td className={C.td}>{r.prod_date}</td><td className={`${C.td} text-[#F7F8F8]`}>{r.category}</td>
                    <td className={C.td}>{fmt(r.qty)}</td><td className={C.td}>{fmt(r.hours)}h</td>
                    <td className={`${C.td} text-[#00B8CC]`}>{won(r.labor_cost)}</td><td className={C.td}>{r.grade}</td>
                    <td className={C.td}>{r.matched ? <span className="text-[#3FBE5B] text-xs">{r.matched_name}</span> : <span className="text-[#EB5757] text-xs">미매칭</span>}</td>
                    <td className={C.td}><button onClick={() => del(r.id)} className="text-[#EB5757] text-xs hover:underline">삭제</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function UploadTab({ warehouses }: { warehouses: Warehouse[] }) {
  const [file, setFile] = useState<File | null>(null);
  const [whId, setWhId] = useState<number | ''>('');
  const [preview, setPreview] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [batches, setBatches] = useState<Batch[]>([]);

  const loadBatches = useCallback(async () => {
    setBatches((await getJSON<{ batches: Batch[] }>('/inventory/production/batches', { batches: [] })).batches);
  }, []);
  useEffect(() => { loadBatches(); }, [loadBatches]);
  useEffect(() => { if (warehouses.length && !whId) setWhId(warehouses[0].id); }, [warehouses, whId]);

  const run = async (dry: boolean) => {
    if (!file) { alert('파일을 선택하세요'); return; }
    if (!whId) { alert('입고 창고를 선택하세요'); return; }
    setBusy(true);
    const fd = new FormData(); fd.append('file', file);
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    const r = await fetch(`/api/inventory/production/upload?warehouse_id=${whId}&dry_run=${dry}`,
      { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: fd });
    const data = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok || data.ok === false) { alert('오류: ' + (data.parse_errors?.join(', ') || data.detail || '실패')); setPreview(data); return; }
    setPreview(data);
    if (!dry) { alert(`재고 반영 완료 · 적재 ${data.applied}건 (중복 ${data.duplicate}, 미매칭 ${data.unmatched_count})`); loadBatches(); }
  };
  const delBatch = async (id: string) => {
    if (!confirm('이 업로드분을 삭제하시겠습니까? (재고 보충분이 취소됩니다)')) return;
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    await fetch(`/api/inventory/production/batch/${id}`, { method: 'DELETE', headers: token ? { Authorization: `Bearer ${token}` } : {} });
    loadBatches();
  };

  return (
    <div className="space-y-4">
      <div className={`${C.card} p-4 space-y-3`}>
        <p className="text-sm text-[#D0D6E0]">생산 <b>RAW-DATA</b> 엑셀을 올리면 <b>품목류</b> 기준으로 재고가 보충됩니다. 인식 열: <span className="text-[#8A8F98]">날짜·담당자·생산위치·품목류·품목명·생산량·단가·생산액·원가 등</span>. 같은 행은 재업로드해도 중복 적재되지 않습니다.</p>
        <div className="flex flex-wrap items-end gap-3">
          <div><div className="text-xs text-[#8A8F98] mb-1">입고 창고 *</div>
            <select value={whId} onChange={(e) => setWhId(e.target.value ? Number(e.target.value) : '')} className={C.input}>
              <option value="">선택</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select></div>
          <div><div className="text-xs text-[#8A8F98] mb-1">RAW-DATA 엑셀</div>
            <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="text-sm text-[#D0D6E0] file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-[#23252A] file:text-[#D0D6E0]" /></div>
          <button onClick={() => run(true)} disabled={busy} className={`${C.btn} ${C.btnGhost}`}>미리보기</button>
          <button onClick={() => run(false)} disabled={busy} className={`${C.btn} ${C.btnPrimary}`}>{busy ? '처리 중…' : '재고 반영'}</button>
        </div>
      </div>

      {preview && preview.rows && (
        <div className={`${C.card} p-4`}>
          <div className="text-sm font-semibold text-[#F7F8F8] mb-2">
            {preview.dry_run ? '미리보기' : '반영 결과'} · 시트 {preview.sheet} · 총 {fmt(preview.row_count)}행
            {preview.matched != null && <span className="text-[#3FBE5B]"> · 매칭 {fmt(preview.matched)}</span>}
            {preview.unmatched != null && preview.unmatched > 0 && <span className="text-[#EB5757]"> · 미매칭 {fmt(preview.unmatched)}</span>}
          </div>
          {preview.unmatched_keys?.length > 0 && (
            <div className="mb-3 text-xs text-[#F0BF00]">
              미매칭 품목류(재고 미반영): {preview.unmatched_keys.map((u: any) => `${u.key}(${fmt(u.qty)})`).join(', ')}
              <div className="text-[#62666D] mt-1">→ 품목 관리에서 표준명/별칭을 맞추면 다음 업로드부터 반영됩니다.</div>
            </div>
          )}
          <div className="overflow-x-auto max-h-72">
            <table className="w-full">
              <thead><tr><th className={C.th}>생산일</th><th className={C.th}>품목류</th><th className={C.th}>품목명</th><th className={C.th}>생산량</th></tr></thead>
              <tbody>
                {(preview.rows || []).slice(0, 100).map((r: any, i: number) => (
                  <tr key={i}><td className={C.td}>{r.prod_date}</td><td className={C.td}>{r.category}</td><td className={C.td}>{r.product_name}</td><td className={C.td}>{fmt(r.qty)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className={`${C.card} p-4`}>
        <div className="text-sm font-semibold text-[#F7F8F8] mb-3">업로드 이력</div>
        {batches.length === 0 ? <div className="text-sm text-[#62666D]">업로드 이력 없음</div> : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr><th className={C.th}>업로드 시각</th><th className={C.th}>기간</th><th className={C.th}>건수</th><th className={C.th}>생산량</th><th className={C.th}></th></tr></thead>
              <tbody>
                {batches.map((b) => (
                  <tr key={b.batch_id}>
                    <td className={C.td}>{b.uploaded_at ? new Date(b.uploaded_at).toLocaleString('ko-KR') : '-'}</td>
                    <td className={C.td}>{b.period}</td>
                    <td className={C.td}>{fmt(b.count)}</td>
                    <td className={C.td}>{fmt(b.qty)}</td>
                    <td className={C.td}><button onClick={() => delBatch(b.batch_id)} className="text-[#EB5757] text-xs hover:underline">삭제</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
