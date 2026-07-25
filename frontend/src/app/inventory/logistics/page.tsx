'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Navigation } from '@/components/layout/Navigation';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
  LineChart, Line, PieChart, Pie, Legend, ComposedChart,
} from 'recharts';

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
  try { const r = await fetch(`/api${path}`, { method, headers: getAuthHeaders(), body: body !== undefined ? JSON.stringify(body) : undefined }); const data = await r.json().catch(() => ({})); return { ok: r.ok, data }; }
  catch { return { ok: false, data: {} }; }
};

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
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const todayISO = () => iso(new Date());
function presetRange(kind: string): { start: string; end: string } {
  const now = new Date(); const y = now.getFullYear(), m = now.getMonth();
  if (kind === '7d') { const s = new Date(now); s.setDate(now.getDate() - 6); return { start: iso(s), end: iso(now) }; }
  if (kind === '14d') { const s = new Date(now); s.setDate(now.getDate() - 13); return { start: iso(s), end: iso(now) }; }
  if (kind === 'thisMonth') return { start: iso(new Date(y, m, 1)), end: iso(new Date(y, m + 1, 0)) };
  if (kind === 'lastMonth') return { start: iso(new Date(y, m - 1, 1)), end: iso(new Date(y, m, 0)) };
  if (kind === 'thisQuarter') { const q = Math.floor(m / 3); return { start: iso(new Date(y, q * 3, 1)), end: iso(new Date(y, q * 3 + 3, 0)) }; }
  if (kind === 'lastYear') return { start: iso(new Date(y - 1, 0, 1)), end: iso(new Date(y - 1, 11, 31)) };
  return { start: iso(new Date(y, m, 1)), end: iso(now) };
}
const PRESETS: [string, string][] = [['7d', '7일'], ['14d', '14일'], ['thisMonth', '당월'], ['lastMonth', '전월'], ['thisQuarter', '당분기'], ['lastYear', '전년도']];
function StatCard({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className={`${C.card} p-4`}>
      <div className="text-[11px] text-[#8A8F98] mb-1 truncate" title={label}>{label}</div>
      <div className={`text-lg font-bold tabular-nums leading-tight ${tone || 'text-[#F7F8F8]'}`}>{value}</div>
      {sub && <div className="text-[11px] text-[#62666D] mt-1 truncate">{sub}</div>}
    </div>
  );
}
function PeriodBar({ range, setRange }: { range: { start: string; end: string }; setRange: (r: { start: string; end: string }) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input type="date" value={range.start} onChange={(e) => setRange({ ...range, start: e.target.value })} className={C.input} />
      <span className="text-[#62666D]">~</span>
      <input type="date" value={range.end} onChange={(e) => setRange({ ...range, end: e.target.value })} className={C.input} />
      <div className="flex flex-wrap gap-1">{PRESETS.map(([k, l]) => <button key={k} onClick={() => setRange(presetRange(k))} className={`${C.btn} ${C.btnGhost} px-2.5 py-1.5`}>{l}</button>)}</div>
    </div>
  );
}

interface WorkRow { id: number; work_date: string; worker: string; team: string; work_type: string; work_name: string; qty: number; hours: number; unit_price: number; amount: number; labor_cost: number; shift: string; batch_id: string; }
interface Dash {
  record_count: number; total_qty: number; total_amount: number; total_hours: number; total_labor: number; hourly_wage: number;
  profitability: number; hourly_qty: number; labor_ratio: number;
  by_type: { work_type: string; qty: number; amount: number; hours: number; labor: number; hourly_qty: number; profitability: number }[];
  by_worker: { worker: string; qty: number; amount: number; hours: number; labor: number; hourly_qty: number }[];
  by_team: { team: string; qty: number; hours: number; labor: number; hourly_qty: number }[];
  by_shift: { shift: string; qty: number }[];
}
interface TS { period: string; qty: number; hours: number; amount: number; labor: number; hourly_qty: number; profitability: number; unit_price: number; unit_labor: number; day_qty: number; night_qty: number; }
interface LaborCmp { total_prod_hours: number; total_att_hours: number; total_regular_hours: number; total_dispatch_hours: number; total_hours_ratio: number; total_prod_labor: number; total_att_cost: number; total_regular_pay: number; note: string; error?: string; series: { period: string; prod_hours: number; att_hours: number; hours_ratio: number }[]; }

type Tab = '대시보드' | '실적 조회' | '실적 입력' | '담당자·문자' | '업로드';

export default function LogisticsPage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('대시보드');
  useEffect(() => { if (!isLoading && !user) router.replace('/login'); }, [isLoading, user, router]);
  if (isLoading || !user) return <div className="min-h-screen bg-[#08090A]" />;
  const tabs: Tab[] = ['대시보드', '실적 조회', '실적 입력', '담당자·문자', '업로드'];
  return (
    <div className="min-h-screen bg-[#08090A]">
      <Navigation />
      <main className="max-w-[1400px] mx-auto px-4 py-6">
        <div className="mb-4">
          <h1 className="text-xl font-bold text-[#F7F8F8]">물류 작업 실적</h1>
          <p className="text-sm text-[#8A8F98] mt-0.5">물류 현장 작업(단상자·택배·B2B 등) 실적·생산성·채산성과 근태 노무시간 대조.</p>
        </div>
        <div className="flex gap-1 mb-5 border-b border-[#23252A]">
          {tabs.map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors ${tab === t ? 'border-[#5E6AD2] text-[#828FFF]' : 'border-transparent text-[#8A8F98] hover:text-[#D0D6E0]'}`}>{t}</button>
          ))}
        </div>
        {tab === '대시보드' && <DashTab />}
        {tab === '실적 조회' && <RecordsTab />}
        {tab === '실적 입력' && <InputTab />}
        {tab === '담당자·문자' && <PhoneTab />}
        {tab === '업로드' && <UploadTab />}
      </main>
    </div>
  );
}

function DashTab() {
  const [range, setRange] = useState(presetRange('thisMonth'));
  const [wtype, setWtype] = useState('');
  const [gran, setGran] = useState<'month' | 'week' | 'day'>('day');
  const [d, setD] = useState<Dash | null>(null);
  const [ts, setTs] = useState<TS[]>([]);
  const [types, setTypes] = useState<string[]>([]);
  const [labor, setLabor] = useState<LaborCmp | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => { getJSON<{ categories: string[] }>('/inventory/logistics/categories', { categories: [] }).then((r) => setTypes(r.categories)); }, []);
  const load = useCallback(async () => {
    setLoading(true);
    const tq = wtype ? `&work_type=${encodeURIComponent(wtype)}` : '';
    const [dd, tt, lb] = await Promise.all([
      getJSON<Dash | null>(`/inventory/logistics/dashboard?start=${range.start}&end=${range.end}`, null),
      getJSON<{ series: TS[] }>(`/inventory/logistics/timeseries?granularity=${gran}&start=${range.start}&end=${range.end}${tq}`, { series: [] }),
      getJSON<LaborCmp | null>(`/inventory/logistics-labor-compare?start=${range.start}&end=${range.end}&granularity=${gran}`, null),
    ]);
    setD(dd); setTs(tt.series); setLabor(lb); setLoading(false);
  }, [range, wtype, gran]);
  useEffect(() => { load(); }, [load]);
  const PIE = d?.by_type.slice(0, 8).map((t, i) => ({ name: t.work_type, value: t.qty, fill: COLORS[i % COLORS.length] })) || [];
  const gl = gran === 'day' ? '일별' : gran === 'week' ? '주별' : '월별';

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <PeriodBar range={range} setRange={setRange} />
        <select value={wtype} onChange={(e) => setWtype(e.target.value)} className={C.input}><option value="">전체 작업종류</option>{types.map((t) => <option key={t} value={t}>{t}</option>)}</select>
        <div className="flex bg-[#0F1011] border border-[#23252A] rounded-lg p-0.5">
          {(['month', 'week', 'day'] as const).map((g) => <button key={g} onClick={() => setGran(g)} className={`${C.btn} px-2.5 py-1 ${gran === g ? C.btnPrimary : 'text-[#8A8F98]'}`}>{g === 'month' ? '월' : g === 'week' ? '주' : '일'}</button>)}
        </div>
        {loading && <span className="text-xs text-[#62666D]">불러오는 중…</span>}
      </div>
      {d && d.record_count === 0 && <div className={`${C.card} p-8 text-center text-sm text-[#62666D]`}>이 기간 물류 작업 데이터가 없습니다.</div>}
      {d && d.record_count > 0 && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <StatCard label="총 작업량" value={numShort(d.total_qty)} sub={`${fmt(d.record_count)}건`} />
            <StatCard label="총 작업액" value={wonShort(d.total_amount)} />
            <StatCard label={`노무비(시급${fmt(d.hourly_wage)}·야1.5)`} value={wonShort(d.total_labor)} tone="text-[#00B8CC]" sub={`노무비율 ${d.labor_ratio}%`} />
            <StatCard label="채산성" value={`${d.profitability}배`} tone={d.profitability >= 3 ? 'text-[#3FBE5B]' : 'text-[#F0BF00]'} sub="작업액÷노무비" />
            <StatCard label="총 작업시간" value={`${numShort(d.total_hours)}h`} />
            <StatCard label="시간당 작업량" value={fmt(d.hourly_qty)} sub="개/시간" />
          </div>

          {labor && !labor.error && (
            <div className={`${C.card} p-4 border-l-2 border-l-[#F0BF00]`}>
              <div className="text-sm font-semibold text-[#F7F8F8] mb-2">노무시간 대조 (근태 연동 · 물류팀 · {gl})</div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                <StatCard label="작업일보 투여시간" value={`${numShort(labor.total_prod_hours)}h`} />
                <StatCard label="근태 노무시간(물류팀)" value={`${numShort(labor.total_att_hours)}h`} tone="text-[#00B8CC]" sub={`정규직 ${numShort(labor.total_regular_hours)} + 파견 ${numShort(labor.total_dispatch_hours)}`} />
                <StatCard label="시간 비율(작업÷근태)" value={`${labor.total_hours_ratio}배`} tone={labor.total_hours_ratio > 1.2 || labor.total_hours_ratio < 0.8 ? 'text-[#F0BF00]' : 'text-[#3FBE5B]'} sub="1에 가까울수록 정합" />
                <StatCard label="근태 실지급+환산" value={wonShort(labor.total_att_cost)} sub={`정규직 실급여 ${wonShort(labor.total_regular_pay)}`} />
              </div>
              <ResponsiveContainer width="100%" height={220}>
                <ComposedChart data={labor.series}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1A1B1E" /><XAxis dataKey="period" tick={{ fill: '#8A8F98', fontSize: 10 }} />
                  <YAxis yAxisId="l" tick={{ fill: '#8A8F98', fontSize: 10 }} /><YAxis yAxisId="r" orientation="right" domain={[0, 2]} tick={{ fill: '#8A8F98', fontSize: 10 }} />
                  <Tooltip contentStyle={{ background: '#0F1011', border: '1px solid #23252A', borderRadius: 8 }} formatter={(v: any) => fmt(v)} /><Legend />
                  <Bar yAxisId="l" dataKey="prod_hours" name="작업일보 시간" fill="#5E6AD2" /><Bar yAxisId="l" dataKey="att_hours" name="근태 노무시간" fill="#00B8CC" />
                  <Line yAxisId="r" type="monotone" dataKey="hours_ratio" name="비율(배)" stroke="#F0BF00" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className={`${C.card} p-4`}>
              <div className="text-sm font-semibold text-[#F7F8F8] mb-3">{gl} 작업 생산성 (시간당 작업량){wtype && ` · ${wtype}`}</div>
              <ResponsiveContainer width="100%" height={240}>
                <ComposedChart data={ts}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1A1B1E" /><XAxis dataKey="period" tick={{ fill: '#8A8F98', fontSize: 10 }} />
                  <YAxis yAxisId="l" tick={{ fill: '#8A8F98', fontSize: 10 }} /><YAxis yAxisId="r" orientation="right" tick={{ fill: '#8A8F98', fontSize: 10 }} />
                  <Tooltip contentStyle={{ background: '#0F1011', border: '1px solid #23252A', borderRadius: 8 }} formatter={(v: any) => fmt(v)} />
                  <Bar yAxisId="l" dataKey="hours" name="투여시간" fill="#23252A" /><Line yAxisId="r" type="monotone" dataKey="hourly_qty" name="시간당작업량" stroke="#5E6AD2" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div className={`${C.card} p-4`}>
              <div className="text-sm font-semibold text-[#F7F8F8] mb-3">{gl} 채산성 (작업액÷노무비)</div>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={ts}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1A1B1E" /><XAxis dataKey="period" tick={{ fill: '#8A8F98', fontSize: 10 }} /><YAxis tick={{ fill: '#8A8F98', fontSize: 10 }} />
                  <Tooltip contentStyle={{ background: '#0F1011', border: '1px solid #23252A', borderRadius: 8 }} /><Line type="monotone" dataKey="profitability" name="채산성(배)" stroke="#3FBE5B" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className={`${C.card} p-4`}>
            <div className="text-sm font-semibold text-[#F7F8F8] mb-1">{gl} 작업 단가 흐름 {wtype ? `· ${wtype}` : '(전체)'}</div>
            <div className="text-xs text-[#62666D] mb-3">평균 작업단가(작업액÷작업량) vs 개당 노무단가(실인건비÷작업량). 작업종류를 고르면 그 종류의 단가 추이입니다.</div>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={ts}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1A1B1E" />
                <XAxis dataKey="period" tick={{ fill: '#8A8F98', fontSize: 10 }} />
                <YAxis tick={{ fill: '#8A8F98', fontSize: 10 }} />
                <Tooltip contentStyle={{ background: '#0F1011', border: '1px solid #23252A', borderRadius: 8 }} formatter={(v: any) => won(v)} />
                <Legend />
                <Line type="monotone" dataKey="unit_price" name="평균 작업단가" stroke="#F0BF00" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="unit_labor" name="개당 노무단가" stroke="#00B8CC" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className={`${C.card} p-4`}>
              <div className="text-sm font-semibold text-[#F7F8F8] mb-3">작업종류별 비중</div>
              <ResponsiveContainer width="100%" height={260}>
                <PieChart><Pie data={PIE} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={95} label={(e: any) => e.name}>{PIE.map((p, i) => <Cell key={i} fill={p.fill} />)}</Pie><Tooltip contentStyle={{ background: '#0F1011', border: '1px solid #23252A', borderRadius: 8 }} formatter={(v: any) => fmt(v)} /></PieChart>
              </ResponsiveContainer>
            </div>
            <div className={`${C.card} p-4`}>
              <div className="text-sm font-semibold text-[#F7F8F8] mb-3">주간/야간 작업량 비교</div>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={ts}><CartesianGrid strokeDasharray="3 3" stroke="#1A1B1E" /><XAxis dataKey="period" tick={{ fill: '#8A8F98', fontSize: 10 }} /><YAxis tick={{ fill: '#8A8F98', fontSize: 10 }} /><Tooltip contentStyle={{ background: '#0F1011', border: '1px solid #23252A', borderRadius: 8 }} formatter={(v: any) => fmt(v)} /><Legend /><Bar dataKey="day_qty" name="주간" stackId="s" fill="#5E6AD2" /><Bar dataKey="night_qty" name="야간" stackId="s" fill="#A855F7" /></BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className={`${C.card} p-4`}>
            <div className="text-sm font-semibold text-[#F7F8F8] mb-3">작업종류별 작업량·작업액·노무비·생산성</div>
            <div className="overflow-x-auto max-h-[300px]">
              <table className="w-full"><thead className="sticky top-0 bg-[#0F1011]"><tr><th className={C.th}>작업종류</th><th className={C.th}>작업량</th><th className={C.th}>작업액</th><th className={C.th}>노무비</th><th className={C.th}>시간당작업량</th><th className={C.th}>채산성</th></tr></thead>
                <tbody>{d.by_type.map((t) => (<tr key={t.work_type}><td className={`${C.td} text-[#F7F8F8]`}>{t.work_type}</td><td className={C.td}>{fmt(t.qty)}</td><td className={C.td}>{won(t.amount)}</td><td className={`${C.td} text-[#00B8CC]`}>{won(t.labor)}</td><td className={C.td}>{fmt(t.hourly_qty)}/h</td><td className={C.td}>{t.profitability}배</td></tr>))}</tbody></table>
            </div>
          </div>

          <div className={`${C.card} p-4`}>
            <div className="text-sm font-semibold text-[#F7F8F8] mb-3">담당자별 · 조별 작업량·시간·노무비</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="overflow-x-auto max-h-[240px]"><table className="w-full"><thead className="sticky top-0 bg-[#0F1011]"><tr><th className={C.th}>담당자</th><th className={C.th}>작업량</th><th className={C.th}>시간</th><th className={C.th}>노무비</th></tr></thead><tbody>{d.by_worker.map((w) => (<tr key={w.worker}><td className={`${C.td} text-[#F7F8F8]`}>{w.worker}</td><td className={C.td}>{fmt(w.qty)}</td><td className={C.td}>{fmt(w.hours)}h</td><td className={`${C.td} text-[#00B8CC]`}>{won(w.labor)}</td></tr>))}</tbody></table></div>
              <div className="overflow-x-auto max-h-[240px]"><table className="w-full"><thead className="sticky top-0 bg-[#0F1011]"><tr><th className={C.th}>조</th><th className={C.th}>작업량</th><th className={C.th}>시간</th><th className={C.th}>시간당</th></tr></thead><tbody>{d.by_team.map((t) => (<tr key={t.team}><td className={`${C.td} text-[#F7F8F8]`}>{t.team}</td><td className={C.td}>{fmt(t.qty)}</td><td className={C.td}>{fmt(t.hours)}h</td><td className={C.td}>{fmt(t.hourly_qty)}/h</td></tr>))}</tbody></table></div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function RecordsTab() {
  const [rows, setRows] = useState<WorkRow[]>([]);
  const [total, setTotal] = useState(0);
  const [range, setRange] = useState(presetRange('thisMonth'));
  const [wtype, setWtype] = useState('');
  const [worker, setWorker] = useState('');
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    const qs = new URLSearchParams({ start: range.start, end: range.end, limit: '500' });
    if (wtype) qs.set('work_type', wtype); if (worker) qs.set('worker', worker);
    const r = await getJSON<{ rows: WorkRow[]; total: number }>(`/inventory/logistics?${qs}`, { rows: [], total: 0 });
    setRows(r.rows); setTotal(r.total); setLoading(false);
  }, [range, wtype, worker]);
  useEffect(() => { load(); }, [load]);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <PeriodBar range={range} setRange={setRange} />
        <input value={wtype} onChange={(e) => setWtype(e.target.value)} placeholder="작업종류" className={`${C.input} w-28`} />
        <input value={worker} onChange={(e) => setWorker(e.target.value)} placeholder="담당자" className={`${C.input} w-24`} />
        <span className="text-xs text-[#8A8F98] ml-auto">{loading ? '불러오는 중…' : `${fmt(rows.length)} / 총 ${fmt(total)}건`}</span>
      </div>
      <div className={`${C.card} overflow-x-auto max-h-[70vh]`}>
        <table className="w-full"><thead className="sticky top-0 bg-[#0F1011]"><tr><th className={C.th}>작업일</th><th className={C.th}>담당자</th><th className={C.th}>조</th><th className={C.th}>작업종류</th><th className={C.th}>작업명</th><th className={C.th}>작업량</th><th className={C.th}>시간</th><th className={C.th}>작업액</th><th className={C.th}>노무비</th><th className={C.th}>주야</th></tr></thead>
          <tbody>{rows.length === 0 ? <tr><td colSpan={10} className="p-6 text-center text-[#62666D] text-sm">데이터 없음</td></tr> :
            rows.map((r) => (<tr key={r.id}><td className={C.td}>{r.work_date}</td><td className={C.td}>{r.worker || '-'}</td><td className={C.td}>{r.team || '-'}</td><td className={`${C.td} text-[#F7F8F8]`}>{r.work_type}</td><td className={C.td}>{r.work_name}</td><td className={`${C.td} font-semibold`}>{fmt(r.qty)}</td><td className={C.td}>{fmt(r.hours)}h</td><td className={C.td}>{won(r.amount)}</td><td className={`${C.td} text-[#00B8CC]`}>{won(r.labor_cost)}</td><td className={C.td}>{r.shift || '-'}</td></tr>))}</tbody></table>
      </div>
    </div>
  );
}

function InputTab() {
  const [types, setTypes] = useState<string[]>([]);
  const [catalog, setCatalog] = useState<{ work_name: string; work_type: string; unit_price: number }[]>([]);
  const [recent, setRecent] = useState<WorkRow[]>([]);
  const [f, setF] = useState<any>({ work_date: todayISO(), worker: '', team: '1조', work_type: '', work_name: '', qty: '', hours: '', unit_price: '', shift: '주간' });
  const [saving, setSaving] = useState(false);
  const loadRecent = useCallback(async () => { const r = await getJSON<{ rows: WorkRow[] }>('/inventory/logistics?limit=20', { rows: [] }); setRecent(r.rows.filter((x) => x.batch_id === 'manual')); }, []);
  useEffect(() => {
    getJSON<{ categories: string[] }>('/inventory/logistics/categories', { categories: [] }).then((r) => setTypes(r.categories));
    getJSON<{ items: any[] }>('/inventory/logistics/catalog', { items: [] }).then((r) => setCatalog(r.items));
    loadRecent();
  }, [loadRecent]);
  const onPick = (name: string) => { const hit = catalog.find((c) => c.work_name === name); setF((p: any) => ({ ...p, work_name: name, ...(hit ? { unit_price: hit.unit_price, work_type: hit.work_type || p.work_type } : {}) })); };
  const filtered = f.work_type ? catalog.filter((c) => c.work_type === f.work_type) : catalog;
  const submit = async () => {
    if (!f.work_type) { alert('작업종류 필수'); return; }
    if (!f.work_name) { alert('작업명 필수'); return; }
    if (!f.hours || Number(f.hours) <= 0) { alert('투여시간 필수'); return; }
    if (!f.qty || Number(f.qty) <= 0) { alert('작업량 필수'); return; }
    setSaving(true);
    const r = await send('/inventory/logistics/manual', 'POST', { ...f, qty: Number(f.qty), hours: Number(f.hours), unit_price: Number(f.unit_price || 0) });
    setSaving(false);
    if (r.ok) { alert('등록되었습니다'); setF((p: any) => ({ ...p, work_name: '', qty: '', hours: '', unit_price: '' })); loadRecent(); } else alert('실패: ' + (r.data?.detail || ''));
  };
  const del = async (id: number) => { if (!confirm('삭제?')) return; const r = await send(`/inventory/logistics/${id}`, 'DELETE'); if (r.ok) loadRecent(); };
  const nightLabor = f.hours ? Math.round(15000 * Number(f.hours) * (String(f.shift).includes('야') ? 1.5 : 1)) : 0;
  return (
    <div className="space-y-4">
      <div className={`${C.card} p-4`}>
        <div className="text-sm font-semibold text-[#F7F8F8] mb-3">물류 작업 실적 직접 입력</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div><div className="text-xs text-[#8A8F98] mb-1">작업일 *</div><input type="date" value={f.work_date} onChange={(e) => setF({ ...f, work_date: e.target.value })} className={`${C.input} w-full`} /></div>
          <div><div className="text-xs text-[#8A8F98] mb-1">책임자</div><input value={f.worker} onChange={(e) => setF({ ...f, worker: e.target.value })} className={`${C.input} w-full`} /></div>
          <div><div className="text-xs text-[#8A8F98] mb-1">소속 조</div><select value={f.team} onChange={(e) => setF({ ...f, team: e.target.value })} className={`${C.input} w-full`}><option>1조</option><option>2조</option><option>3조</option><option value="">기타</option></select></div>
          <div><div className="text-xs text-[#8A8F98] mb-1">주야</div><select value={f.shift} onChange={(e) => setF({ ...f, shift: e.target.value })} className={`${C.input} w-full`}><option value="주간">주간</option><option value="주간 연장">주간 연장</option><option value="야간">야간(1.5배)</option></select></div>
          <div><div className="text-xs text-[#8A8F98] mb-1">작업종류 *</div><input list="wtlist" value={f.work_type} onChange={(e) => setF({ ...f, work_type: e.target.value })} placeholder="단상자/택배 등" className={`${C.input} w-full`} /><datalist id="wtlist">{types.map((t) => <option key={t} value={t} />)}</datalist></div>
          <div><div className="text-xs text-[#8A8F98] mb-1">작업명 *</div><input list="wnlist" value={f.work_name} onChange={(e) => onPick(e.target.value)} className={`${C.input} w-full ${!f.work_name ? 'border-[#EB5757]/50' : ''}`} /><datalist id="wnlist">{filtered.slice(0, 300).map((c) => <option key={c.work_name} value={c.work_name} />)}</datalist></div>
          <div><div className="text-xs text-[#8A8F98] mb-1">작업량 *</div><input type="number" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} className={`${C.input} w-full`} /></div>
          <div><div className="text-xs text-[#8A8F98] mb-1">투여시간(h) *</div><input type="number" value={f.hours} onChange={(e) => setF({ ...f, hours: e.target.value })} className={`${C.input} w-full ${!f.hours ? 'border-[#EB5757]/50' : ''}`} /></div>
          <div><div className="text-xs text-[#8A8F98] mb-1">작업단가(자동)</div><input readOnly value={f.unit_price !== '' ? Number(f.unit_price).toLocaleString('ko-KR') : ''} placeholder="작업명 선택 시" className={`${C.input} w-full bg-[#141516] text-[#8A8F98]`} /></div>
          <div className="flex items-end"><button onClick={submit} disabled={saving} className={`${C.btn} ${C.btnPrimary} w-full`}>{saving ? '저장 중…' : '작업 등록'}</button></div>
        </div>
        <p className="text-xs text-[#62666D] mt-2">예상 노무비: <span className="text-[#00B8CC]">{won(nightLabor)}</span> (시급 15,000{String(f.shift).includes('야') ? ' ×1.5' : ''} × {f.hours || 0}h)</p>
      </div>
      <div className={`${C.card} p-4`}>
        <div className="text-sm font-semibold text-[#F7F8F8] mb-3">최근 직접 입력분</div>
        {recent.length === 0 ? <div className="text-sm text-[#62666D]">없음</div> : (
          <div className="overflow-x-auto"><table className="w-full"><thead><tr><th className={C.th}>작업일</th><th className={C.th}>작업종류</th><th className={C.th}>작업명</th><th className={C.th}>작업량</th><th className={C.th}>시간</th><th className={C.th}>노무비</th><th className={C.th}></th></tr></thead><tbody>{recent.map((r) => (<tr key={r.id}><td className={C.td}>{r.work_date}</td><td className={`${C.td} text-[#F7F8F8]`}>{r.work_type}</td><td className={C.td}>{r.work_name}</td><td className={C.td}>{fmt(r.qty)}</td><td className={C.td}>{fmt(r.hours)}h</td><td className={`${C.td} text-[#00B8CC]`}>{won(r.labor_cost)}</td><td className={C.td}><button onClick={() => del(r.id)} className="text-[#EB5757] text-xs hover:underline">삭제</button></td></tr>))}</tbody></table></div>
        )}
      </div>
    </div>
  );
}

function PhoneTab() {
  const [rows, setRows] = useState<any[]>([]);
  const [form, setForm] = useState<any>({ name: '', phone: '', location: '물류', role: '물류' });
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [msg, setMsg] = useState('');
  const load = useCallback(async () => { const r = await getJSON<{ rows: any[] }>('/inventory/worker-phones', { rows: [] }); setRows(r.rows); }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { const link = typeof window !== 'undefined' ? `${window.location.origin}/inventory/logistics` : ''; setMsg(`[조인앤조인 물류] 오늘 작업 실적을 입력해 주세요.\n입력: ${link}\n(작업종류·작업량·투여시간 필수)`); }, []);
  const save = async () => { if (!form.name.trim() || !form.phone.trim()) { alert('이름·핸드폰'); return; } const r = await send('/inventory/worker-phones', 'POST', { id: form.id, name: form.name, phone: form.phone, location: form.location || null, role: form.role || null, is_active: true }); if (r.ok) { setForm({ name: '', phone: '', location: '물류', role: '물류' }); load(); } };
  const del = async (id: number) => { if (!confirm('삭제?')) return; const r = await send(`/inventory/worker-phones/${id}`, 'DELETE'); if (r.ok) load(); };
  const toggle = (id: number) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const active = rows.filter((r) => r.is_active);
  const sendSms = async () => {
    const ids = sel.size ? Array.from(sel) : active.map((r) => r.id);
    if (!ids.length) { alert('대상 없음'); return; }
    if (!confirm(`${ids.length}명에게 작업 입력 요청 문자 발송`)) return;
    const r = await send('/inventory/worker-phones/send', 'POST', { ids, message: msg });
    if (r.ok && r.data.sent) { alert(`발송 완료 · ${r.data.count}건`); load(); return; }
    const phones: string[] = r.data?.phones || rows.filter((x) => ids.includes(x.id)).map((x) => x.phone);
    if (typeof window !== 'undefined') window.location.href = `sms:${phones.join(',')}?&body=${encodeURIComponent(msg)}`;
    load();
  };
  return (
    <div className="space-y-4">
      <div className={`${C.card} p-4`}>
        <div className="text-sm font-semibold text-[#F7F8F8] mb-1">담당자 핸드폰 (생산·물류 공용)</div>
        <p className="text-xs text-[#62666D] mb-3">작업 입력 요청 문자 발송 대상. (서버 SMS 미설정 시 휴대폰 문자앱이 열립니다)</p>
        <div className="flex flex-wrap items-end gap-2 mb-3">
          <div><div className="text-xs text-[#8A8F98] mb-1">이름 *</div><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={`${C.input} w-28`} /></div>
          <div><div className="text-xs text-[#8A8F98] mb-1">핸드폰 *</div><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="010-…" className={`${C.input} w-36`} /></div>
          <div><div className="text-xs text-[#8A8F98] mb-1">구분</div><input value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className={`${C.input} w-24`} /></div>
          <button onClick={save} className={`${C.btn} ${C.btnPrimary}`}>{form.id ? '수정' : '+ 추가'}</button>
        </div>
        <div className="overflow-x-auto"><table className="w-full"><thead><tr><th className={C.th}><input type="checkbox" checked={sel.size > 0 && sel.size === active.length} onChange={(e) => setSel(e.target.checked ? new Set(active.map((r) => r.id)) : new Set())} /></th><th className={C.th}>이름</th><th className={C.th}>핸드폰</th><th className={C.th}>구분</th><th className={C.th}></th></tr></thead><tbody>{rows.length === 0 ? <tr><td colSpan={5} className="p-6 text-center text-[#62666D] text-sm">담당자를 추가하세요</td></tr> : rows.map((r) => (<tr key={r.id}><td className={C.td}><input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} /></td><td className={`${C.td} text-[#F7F8F8]`}>{r.name}</td><td className={C.td}>{r.phone}</td><td className={C.td}>{r.role || '-'}</td><td className={C.td}><button onClick={() => setForm({ id: r.id, name: r.name, phone: r.phone, location: r.location || '', role: r.role || '' })} className="text-[#828FFF] text-xs hover:underline mr-2">수정</button><button onClick={() => del(r.id)} className="text-[#EB5757] text-xs hover:underline">삭제</button></td></tr>))}</tbody></table></div>
      </div>
      <div className={`${C.card} p-4`}>
        <div className="text-sm font-semibold text-[#F7F8F8] mb-2">작업 입력 요청 문자</div>
        <textarea value={msg} onChange={(e) => setMsg(e.target.value)} rows={4} className={`${C.input} w-full mb-2`} />
        <button onClick={sendSms} className={`${C.btn} ${C.btnPrimary}`}>📩 {sel.size ? sel.size + '명 선택' : '활성 전체'} 발송</button>
      </div>
    </div>
  );
}

function UploadTab() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [batches, setBatches] = useState<any[]>([]);
  const loadBatches = useCallback(async () => { setBatches((await getJSON<{ batches: any[] }>('/inventory/logistics/batches', { batches: [] })).batches); }, []);
  useEffect(() => { loadBatches(); }, [loadBatches]);
  const run = async (dry: boolean) => {
    if (!file) { alert('파일 선택'); return; }
    setBusy(true);
    const fd = new FormData(); fd.append('file', file);
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    const r = await fetch(`/api/inventory/logistics/upload?dry_run=${dry}`, { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: fd });
    const data = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok || data.ok === false) { alert('오류: ' + (data.parse_errors?.join(', ') || data.detail || '실패')); setPreview(data); return; }
    setPreview(data);
    if (!dry) { alert(`적재 완료 · ${data.applied}건 (중복 ${data.duplicate})`); loadBatches(); }
  };
  const delBatch = async (id: string) => { if (!confirm('이 업로드분 삭제?')) return; const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null; await fetch(`/api/inventory/logistics/batch/${id}`, { method: 'DELETE', headers: token ? { Authorization: `Bearer ${token}` } : {} }); loadBatches(); };
  return (
    <div className="space-y-4">
      <div className={`${C.card} p-4 space-y-3`}>
        <p className="text-sm text-[#D0D6E0]">물류 <b>RAW-DATA</b> 엑셀을 올리면 작업 실적으로 적재됩니다. 인식 열: <span className="text-[#8A8F98]">날짜·책임자·소속조·작업종류·작업명·작업량·투여시간·단가·작업액·주야</span>. 재업로드해도 중복 적재되지 않습니다.</p>
        <div className="flex flex-wrap items-end gap-3">
          <div><div className="text-xs text-[#8A8F98] mb-1">RAW-DATA 엑셀</div><input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => setFile(e.target.files?.[0] || null)} className="text-sm text-[#D0D6E0] file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-[#23252A] file:text-[#D0D6E0]" /></div>
          <button onClick={() => run(true)} disabled={busy} className={`${C.btn} ${C.btnGhost}`}>미리보기</button>
          <button onClick={() => run(false)} disabled={busy} className={`${C.btn} ${C.btnPrimary}`}>{busy ? '처리 중…' : '적재'}</button>
        </div>
      </div>
      {preview?.rows && (
        <div className={`${C.card} p-4`}>
          <div className="text-sm font-semibold text-[#F7F8F8] mb-2">{preview.dry_run ? '미리보기' : '적재 결과'} · 시트 {preview.sheet} · {fmt(preview.row_count)}행</div>
          <div className="overflow-x-auto max-h-72"><table className="w-full"><thead><tr><th className={C.th}>작업일</th><th className={C.th}>작업종류</th><th className={C.th}>작업명</th><th className={C.th}>작업량</th><th className={C.th}>시간</th></tr></thead><tbody>{(preview.rows || []).slice(0, 100).map((r: any, i: number) => (<tr key={i}><td className={C.td}>{r.work_date}</td><td className={C.td}>{r.work_type}</td><td className={C.td}>{r.work_name}</td><td className={C.td}>{fmt(r.qty)}</td><td className={C.td}>{fmt(r.hours)}h</td></tr>))}</tbody></table></div>
        </div>
      )}
      <div className={`${C.card} p-4`}>
        <div className="text-sm font-semibold text-[#F7F8F8] mb-3">업로드 이력</div>
        {batches.length === 0 ? <div className="text-sm text-[#62666D]">없음</div> : (
          <div className="overflow-x-auto"><table className="w-full"><thead><tr><th className={C.th}>업로드</th><th className={C.th}>기간</th><th className={C.th}>건수</th><th className={C.th}>작업량</th><th className={C.th}></th></tr></thead><tbody>{batches.map((b) => (<tr key={b.batch_id}><td className={C.td}>{b.uploaded_at ? new Date(b.uploaded_at).toLocaleString('ko-KR') : '-'}</td><td className={C.td}>{b.period}</td><td className={C.td}>{fmt(b.count)}</td><td className={C.td}>{fmt(b.qty)}</td><td className={C.td}><button onClick={() => delBatch(b.batch_id)} className="text-[#EB5757] text-xs hover:underline">삭제</button></td></tr>))}</tbody></table></div>
        )}
      </div>
    </div>
  );
}
