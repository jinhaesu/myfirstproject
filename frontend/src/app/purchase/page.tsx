'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Navigation } from '@/components/layout/Navigation';
import { LoadingOverlay } from '@/components/LoadingOverlay';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, LineChart, Line, PieChart, Pie, Legend, ComposedChart, ScatterChart, Scatter, ZAxis, ReferenceLine } from 'recharts';

const getAuthHeaders = (): Record<string, string> => {
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) h['Authorization'] = `Bearer ${token}`;
  return h;
};
const getJSON = async <T,>(path: string, def: T): Promise<T> => { try { const r = await fetch(`/api${path}`, { headers: getAuthHeaders() }); if (!r.ok) throw new Error(); return await r.json(); } catch { return def; } };
const send = async (path: string, method: string, body?: any) => { try { const r = await fetch(`/api${path}`, { method, headers: getAuthHeaders(), body: body !== undefined ? JSON.stringify(body) : undefined }); const data = await r.json().catch(() => ({})); return { ok: r.ok, data }; } catch { return { ok: false, data: {} }; } };

const C = { card: 'bg-bg-1 border border-border-primary rounded-xl', input: 'bg-bg-0 border border-border-primary rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-brand', btn: 'px-3 py-2 rounded-lg text-sm font-semibold transition-colors', btnPrimary: 'bg-brand hover:bg-brand-hover text-white', btnGhost: 'bg-bg-inset hover:bg-border-primary text-text-secondary border border-border-primary', th: 'text-left text-xs font-semibold text-text-tertiary px-3 py-2 border-b border-border-primary whitespace-nowrap', td: 'px-3 py-2 text-sm text-text-secondary border-b border-bg-inset whitespace-nowrap' };
const fmt = (n: number) => Number(n || 0).toLocaleString('ko-KR');
const won = (n: number) => '₩' + Number(n || 0).toLocaleString('ko-KR');
const wonShort = (n: number) => { const a = Math.abs(n || 0); if (a >= 1e8) return (n / 1e8).toFixed(1).replace(/\.0$/, '') + '억'; if (a >= 1e4) return Math.round(n / 1e4).toLocaleString('ko-KR') + '만'; return '₩' + Math.round(n || 0).toLocaleString('ko-KR'); };
const COLORS = ['#5E6AD2', '#27A644', '#F0BF00', '#00B8CC', '#EB5757', '#A855F7', '#F97316', '#14B8A6'];
const TT = { background: 'var(--color-bg-level-1)', border: '1px solid var(--color-border-primary)', borderRadius: 8, color: 'var(--color-text-primary)', fontSize: 12 } as const;
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const thisMonth = () => { const n = new Date(); return { start: iso(new Date(n.getFullYear(), n.getMonth(), 1)), end: iso(new Date(n.getFullYear(), n.getMonth() + 1, 0)) }; };
function StatCard({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return <div className={`${C.card} p-4`}><div className="text-[11px] text-text-tertiary mb-1 truncate">{label}</div><div className={`text-lg font-bold tabular-nums ${tone || 'text-text-primary'}`}>{value}</div>{sub && <div className="text-[11px] text-text-quaternary mt-1 truncate">{sub}</div>}</div>;
}
// 구매 관리 공통 기간 토글 — 프리셋 즉시 적용 + 날짜 직접 지정
function RangeBar({ range, setRange }: { range: any; setRange: (r: any) => void }) {
  const P = presets();
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {Object.keys(P).map((k) => {
        const on = range.start === P[k].start && range.end === P[k].end;
        return <button key={k} onClick={() => setRange({ ...range, ...P[k] })} className={`${C.btn} ${on ? C.btnPrimary : C.btnGhost}`}>{k}</button>;
      })}
      <input type="date" value={range.start} onChange={(e) => setRange({ ...range, start: e.target.value })} className={C.input} />
      <span className="text-text-quaternary">~</span>
      <input type="date" value={range.end} onChange={(e) => setRange({ ...range, end: e.target.value })} className={C.input} />
    </div>
  );
}

interface MatReq { materials: { type: string; name: string; erp_code: string; qty: number; unit: string; unit_price: number; cost: number; vendor: string; material_id: number }[]; total_cost: number; raw_count: number; sub_count: number; by_vendor: { vendor: string; cost: number; items: number }[]; matched_qty: number; unmatched_qty: number; unmatched: { name: string; qty: number }[]; error?: string; }
interface Vendor { id: number; name: string; biz_no: string; contact: string; phone: string; email: string; category: string; lead_time_days: number; is_active: boolean; raw_materials: number; sub_materials: number; }
interface PO { id: number; po_no: string; vendor_id: number; vendor_name: string; order_date: string; expected_date: string; status: string; total_amount: number; line_count: number; lines: any[]; }

type Tab = '실적 대시보드' | '실적 조회' | '단가 추이' | '원부재료 소요' | '거래처' | '발주';

export default function PurchasePage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('실적 대시보드');
  useEffect(() => { if (!isLoading && !user) router.replace('/login'); }, [isLoading, user, router]);
  if (isLoading || !user) return <div className="min-h-screen bg-bg-0" />;
  const tabs: Tab[] = ['실적 대시보드', '실적 조회', '단가 추이', '원부재료 소요', '거래처', '발주'];
  return (
    <div className="min-h-screen bg-bg-0">
      <Navigation />
      <main className="max-w-[1400px] mx-auto px-4 py-6">
        <div className="mb-4"><h1 className="text-xl font-bold text-text-primary">구매 관리</h1><p className="text-sm text-text-tertiary mt-0.5">구매일보 실적 분석 · 매출대비 구매비율 · 거래처/품목 이력 · 발주·발주서 발행.</p></div>
        <div className="flex gap-1 mb-5 border-b border-border-primary overflow-x-auto">{tabs.map((t) => <button key={t} onClick={() => setTab(t)} className={`px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px whitespace-nowrap ${tab === t ? 'border-brand text-accent' : 'border-transparent text-text-tertiary hover:text-text-secondary'}`}>{t}</button>)}</div>
        {tab === '실적 대시보드' && <DashTab />}
        {tab === '실적 조회' && <RecordsTab />}
        {tab === '단가 추이' && <PriceTab />}
        {tab === '원부재료 소요' && <MatTab />}
        {tab === '거래처' && <VendorTab />}
        {tab === '발주' && <POTab />}
      </main>
    </div>
  );
}

// 기간 프리셋 — 구매 관리 전 탭 공통 (금주/당월/전월/당분기/전분기/전년 + 올해/전체)
const presets = () => {
  const n = new Date();
  const ym = (y: number, m: number, d: number) => iso(new Date(y, m, d));
  const y = n.getFullYear(), m = n.getMonth();
  // 금주: 월요일~일요일
  const dow = n.getDay(); // 0=일..6=토
  const monOffset = dow === 0 ? -6 : 1 - dow;
  const mon = new Date(y, m, n.getDate() + monOffset);
  const sun = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 6);
  // 분기
  const q = Math.floor(m / 3);          // 0..3
  const qStart = q * 3;                 // 분기 시작월
  const pq = q === 0 ? 3 : q - 1;       // 전분기
  const pqYear = q === 0 ? y - 1 : y;
  const pqStart = pq * 3;
  return {
    금주: { start: iso(mon), end: iso(sun) },
    당월: { start: ym(y, m, 1), end: ym(y, m + 1, 0) },
    전월: { start: ym(y, m - 1, 1), end: ym(y, m, 0) },
    당분기: { start: ym(y, qStart, 1), end: ym(y, qStart + 3, 0) },
    전분기: { start: ym(pqYear, pqStart, 1), end: ym(pqYear, pqStart + 3, 0) },
    전년: { start: ym(y - 1, 0, 1), end: ym(y - 1, 11, 31) },
    올해: { start: ym(y, 0, 1), end: iso(n) },
    전체: { start: '2025-01-01', end: iso(n) },
  } as Record<string, { start: string; end: string }>;
};

// ─────────────────────────────────────────────
// 실적 대시보드
// ─────────────────────────────────────────────
function DashTab() {
  const [gran, setGran] = useState<'day' | 'week' | 'month'>('month');
  // 입력(draft)과 적용(applied) 분리 — 조회 버튼으로만 반영
  const [dr, setDr] = useState({ ...thisMonth(), vendor: '', mclass: '', q: '' });
  const [ap, setAp] = useState({ ...thisMonth(), vendor: '', mclass: '', q: '' });
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [d, setD] = useState<any>(null);
  const [ratio, setRatio] = useState<any>(null);
  const [heat, setHeat] = useState<any>(null);
  const [gapT, setGapT] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const P = presets();
  const applyDraft = () => setAp(dr);
  const applyPreset = (v: { start: string; end: string }) => { const nx = { ...dr, ...v }; setDr(nx); setAp(nx); };
  const qs = () => { const p = new URLSearchParams({ start: ap.start, end: ap.end }); if (ap.vendor) p.set('vendor', ap.vendor); if (ap.mclass) p.set('mclass', ap.mclass); if (ap.q) p.set('q', ap.q); return p.toString(); };
  useEffect(() => { getJSON<{ vendors: Vendor[] }>('/purchase/vendors', { vendors: [] }).then((r) => setVendors(r.vendors)); }, []);
  useEffect(() => { setLoading(true); getJSON<any>(`/purchase/records/dashboard?${qs()}`, null).then((r) => { setD(r); setLoading(false); }); }, [ap]);
  useEffect(() => { getJSON<any>(`/purchase/records/sales-ratio?start=${ap.start}&end=${ap.end}&granularity=${gran}`, null).then(setRatio); }, [ap, gran]);
  useEffect(() => { getJSON<any>(`/purchase/records/req-vs-actual?start=${ap.start}&end=${ap.end}&top=30`, null).then(setHeat); }, [ap]);
  useEffect(() => { getJSON<any>(`/purchase/records/gap-trend?start=${ap.start}&end=${ap.end}&granularity=${gran}`, null).then(setGapT); }, [ap, gran]);
  const dirty = dr.start !== ap.start || dr.end !== ap.end || dr.vendor !== ap.vendor || dr.mclass !== ap.mclass || dr.q !== ap.q;
  const classData = (d?.by_class || []).map((x: any) => ({ name: x.mclass, value: x.supply }));
  return (
    <div className="space-y-5 relative">
      <LoadingOverlay show={loading} />
      <div className="flex flex-wrap items-center gap-2">
        {Object.keys(P).map((k) => { const on = ap.start === P[k].start && ap.end === P[k].end; return <button key={k} onClick={() => applyPreset(P[k])} className={`${C.btn} ${on ? C.btnPrimary : C.btnGhost}`}>{k}</button>; })}
        <input type="date" value={dr.start} onChange={(e) => setDr({ ...dr, start: e.target.value })} className={C.input} />
        <span className="text-text-quaternary">~</span>
        <input type="date" value={dr.end} onChange={(e) => setDr({ ...dr, end: e.target.value })} className={C.input} />
        <button onClick={applyDraft} className={`${C.btn} ${C.btnPrimary} ${dirty ? 'ring-2 ring-brand/50' : ''}`}>조회</button>
        <div className="flex gap-1 ml-auto"><span className="text-xs text-text-quaternary self-center mr-1">추이 단위</span>{(['day', 'week', 'month'] as const).map((g) => <button key={g} onClick={() => setGran(g)} className={`${C.btn} ${gran === g ? C.btnPrimary : C.btnGhost}`}>{g === 'day' ? '일' : g === 'week' ? '주' : '월'}</button>)}</div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select value={dr.vendor} onChange={(e) => setDr({ ...dr, vendor: e.target.value })} className={C.input}><option value="">전체 거래처</option>{vendors.map((v) => <option key={v.id} value={v.name}>{v.name}</option>)}</select>
        <select value={dr.mclass} onChange={(e) => setDr({ ...dr, mclass: e.target.value })} className={C.input}><option value="">전체 구분</option><option>원재료</option><option>부재료</option></select>
        <input value={dr.q} onChange={(e) => setDr({ ...dr, q: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') applyDraft(); }} placeholder="품목명 검색" className={`${C.input} w-40`} />
        {(dr.vendor || dr.mclass || dr.q) && <button onClick={() => { const nx = { ...dr, vendor: '', mclass: '', q: '' }; setDr(nx); setAp(nx); }} className={`${C.btn} ${C.btnGhost}`}>필터 해제</button>}
        {dirty && <span className="text-xs text-warning">변경됨 — 조회를 누르세요</span>}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard label="구매액(공급가)" value={wonShort(d?.total_supply || 0)} tone="text-warning" sub={`${fmt(d?.line_count || 0)}건`} />
        <StatCard label="원재료" value={wonShort((d?.by_class || []).find((x: any) => x.mclass === '원재료')?.supply || 0)} tone="text-info" />
        <StatCard label="부재료" value={wonShort((d?.by_class || []).find((x: any) => x.mclass === '부재료')?.supply || 0)} tone="text-warning" />
        <StatCard label="매출액(순)" value={wonShort(d?.sales || 0)} tone="text-success" />
        <StatCard label="구매/매출" value={d?.purchase_to_sales_ratio != null ? `${d.purchase_to_sales_ratio}%` : '-'} tone="text-purple" sub="공급가÷순매출" />
        <StatCard label="거래처·품목" value={`${fmt(d?.vendor_count || 0)}·${fmt(d?.item_count || 0)}`} sub="거래처 · 품목수" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className={`${C.card} p-4`}>
          <div className="text-sm font-semibold text-text-primary mb-3">원/부재료 구성</div>
          {classData.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}><PieChart><Pie data={classData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label={(e: any) => `${e.name} ${Math.round(e.percent * 100)}%`} labelLine={false}>{classData.map((_: any, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}</Pie><Tooltip contentStyle={TT} formatter={(v: any) => won(v)} /></PieChart></ResponsiveContainer>
          ) : <Empty />}
        </div>
        <div className={`${C.card} p-4 lg:col-span-2`}>
          <div className="text-sm font-semibold text-text-primary mb-3">거래처별 구매액 (Top 12)</div>
          {d?.by_vendor?.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}><BarChart data={d.by_vendor.slice(0, 12)} layout="vertical" margin={{ left: 30 }}><CartesianGrid strokeDasharray="3 3" stroke="var(--color-bg-inset)" /><XAxis type="number" tick={{ fill: 'var(--color-text-tertiary)', fontSize: 10 }} tickFormatter={wonShort} /><YAxis type="category" dataKey="vendor" tick={{ fill: 'var(--color-text-tertiary)', fontSize: 10 }} width={110} /><Tooltip contentStyle={TT} formatter={(v: any) => won(v)} /><Bar dataKey="supply" radius={[0, 4, 4, 0]}>{d.by_vendor.slice(0, 12).map((_: any, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}</Bar></BarChart></ResponsiveContainer>
          ) : <Empty />}
        </div>
      </div>

      <div className={`${C.card} p-4`}>
        <div className="text-sm font-semibold text-text-primary mb-3">매출 대비 구매 누적비율 · {gran === 'day' ? '일별' : gran === 'week' ? '주별' : '월별'} {ratio?.cum_ratio != null && <span className="text-purple ml-2">기간 누적 {ratio.cum_ratio}%</span>}</div>
        {ratio?.series?.length > 0 ? (
          <ResponsiveContainer width="100%" height={300}><LineChart data={ratio.series}><CartesianGrid strokeDasharray="3 3" stroke="var(--color-bg-inset)" /><XAxis dataKey="bucket" tick={{ fill: 'var(--color-text-tertiary)', fontSize: 10 }} /><YAxis yAxisId="l" tick={{ fill: 'var(--color-text-tertiary)', fontSize: 10 }} tickFormatter={wonShort} /><YAxis yAxisId="r" orientation="right" tick={{ fill: 'var(--color-purple)', fontSize: 10 }} tickFormatter={(v) => `${v}%`} /><Tooltip contentStyle={TT} formatter={(v: any, n: any) => n.includes('비율') ? `${v}%` : won(v)} /><Legend wrapperStyle={{ fontSize: 11 }} /><Line yAxisId="l" type="monotone" dataKey="purchase" name="구매액" stroke="var(--color-warning)" strokeWidth={2} dot={false} /><Line yAxisId="l" type="monotone" dataKey="sales" name="매출액" stroke="var(--color-success)" strokeWidth={2} dot={false} /><Line yAxisId="r" type="monotone" dataKey="cum_ratio" name="누적 구매/매출 비율" stroke="var(--color-purple)" strokeWidth={2} dot={false} /></LineChart></ResponsiveContainer>
        ) : <Empty />}
      </div>

      {/* 월별 BOM소요 vs 실구매 / 원가추정 vs 실구매 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className={`${C.card} p-4`}>
          <div className="text-sm font-semibold text-text-primary mb-1">BOM 이론소요 vs 실제구매 · {gran === 'day' ? '일별' : gran === 'week' ? '주별' : '월별'}</div>
          <p className="text-xs text-text-quaternary mb-3">생산량×BOM개당원가(이론소요) 대비 실제 매입. gap=재고 증감.</p>
          {gapT?.series?.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}><ComposedChart data={gapT.series}><CartesianGrid strokeDasharray="3 3" stroke="var(--color-bg-inset)" /><XAxis dataKey="bucket" tick={{ fill: 'var(--color-text-tertiary)', fontSize: 10 }} /><YAxis tick={{ fill: 'var(--color-text-tertiary)', fontSize: 10 }} tickFormatter={wonShort} /><Tooltip contentStyle={TT} formatter={(v: any) => won(v)} /><Legend wrapperStyle={{ fontSize: 11 }} /><Bar dataKey="bom_req" name="BOM이론소요" fill="var(--color-purple)" radius={[3, 3, 0, 0]} /><Bar dataKey="purchase" name="실제구매" fill="var(--color-info)" radius={[3, 3, 0, 0]} /></ComposedChart></ResponsiveContainer>
          ) : <Empty />}
        </div>
        <div className={`${C.card} p-4`}>
          <div className="text-sm font-semibold text-text-primary mb-1">매출기반 원가추정 vs 실제구매 · {gran === 'day' ? '일별' : gran === 'week' ? '주별' : '월별'}</div>
          <p className="text-xs text-text-quaternary mb-3">판매수량×BOM원가(매출원가) 대비 실제 매입. gap=재고 빌드업/소진.</p>
          {gapT?.series?.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}><ComposedChart data={gapT.series}><CartesianGrid strokeDasharray="3 3" stroke="var(--color-bg-inset)" /><XAxis dataKey="bucket" tick={{ fill: 'var(--color-text-tertiary)', fontSize: 10 }} /><YAxis tick={{ fill: 'var(--color-text-tertiary)', fontSize: 10 }} tickFormatter={wonShort} /><Tooltip contentStyle={TT} formatter={(v: any) => won(v)} /><Legend wrapperStyle={{ fontSize: 11 }} /><Bar dataKey="cogs_est" name="매출원가추정" fill="var(--color-warning)" radius={[3, 3, 0, 0]} /><Bar dataKey="purchase" name="실제구매" fill="var(--color-info)" radius={[3, 3, 0, 0]} /></ComposedChart></ResponsiveContainer>
          ) : <Empty />}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className={`${C.card} p-4`}>
          <div className="text-sm font-semibold text-text-primary mb-3">일별 구매액</div>
          {d?.by_day?.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}><BarChart data={d.by_day}><CartesianGrid strokeDasharray="3 3" stroke="var(--color-bg-inset)" /><XAxis dataKey="date" tick={{ fill: 'var(--color-text-tertiary)', fontSize: 9 }} /><YAxis tick={{ fill: 'var(--color-text-tertiary)', fontSize: 10 }} tickFormatter={wonShort} /><Tooltip contentStyle={TT} formatter={(v: any) => won(v)} /><Bar dataKey="supply" fill="var(--color-brand-bg)" radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer>
          ) : <Empty />}
        </div>
        <div className={`${C.card} p-4`}>
          <div className="text-sm font-semibold text-text-primary mb-3">품목별 구매액 (Top 12)</div>
          {d?.by_item?.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}><BarChart data={d.by_item.slice(0, 12)} layout="vertical" margin={{ left: 30 }}><CartesianGrid strokeDasharray="3 3" stroke="var(--color-bg-inset)" /><XAxis type="number" tick={{ fill: 'var(--color-text-tertiary)', fontSize: 10 }} tickFormatter={wonShort} /><YAxis type="category" dataKey="item_name" tick={{ fill: 'var(--color-text-tertiary)', fontSize: 9 }} width={130} tickFormatter={(v) => String(v).slice(0, 14)} /><Tooltip contentStyle={TT} formatter={(v: any) => won(v)} /><Bar dataKey="supply" radius={[0, 4, 4, 0]}>{d.by_item.slice(0, 12).map((_: any, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}</Bar></BarChart></ResponsiveContainer>
          ) : <Empty />}
        </div>
      </div>

      {/* 생산 소요 vs 실제 구매 히트맵 */}
      <div className={`${C.card} p-4`}>
        <div className="flex items-center justify-between mb-1">
          <div className="text-sm font-semibold text-text-primary">생산 BOM 소요 vs 실제 구매 · 품목별 히트맵</div>
          {heat && <div className="text-xs text-text-tertiary">이론소요 {wonShort(heat.total_req)} · 실구매 {wonShort(heat.total_act)} · 매칭 {heat.matched_count}품목</div>}
        </div>
        <p className="text-xs text-text-quaternary mb-3">색이 진할수록 금액 큼. 커버리지 = 실구매÷이론소요(100% 미만=재고소진/과소구매, 초과=재고빌드/선구매).</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr>
              <th className="text-left text-xs text-text-tertiary px-2 py-1.5 border-b border-border-primary">원부재료</th>
              <th className="text-right text-xs text-text-tertiary px-2 py-1.5 border-b border-border-primary">BOM 소요</th>
              <th className="text-right text-xs text-text-tertiary px-2 py-1.5 border-b border-border-primary">실제 구매</th>
              <th className="text-right text-xs text-text-tertiary px-2 py-1.5 border-b border-border-primary">gap</th>
              <th className="text-center text-xs text-text-tertiary px-2 py-1.5 border-b border-border-primary">커버리지</th>
            </tr></thead>
            <tbody>
              {(heat?.items || []).map((it: any, i: number) => {
                const maxv = Math.max(...(heat?.items || []).map((x: any) => Math.max(x.req_cost, x.act_cost)), 1);
                const cell = (v: number, hue: string) => ({ background: v > 0 ? `${hue}${Math.max(0.06, Math.min(0.55, v / maxv)).toFixed(2)})` : 'transparent' });
                const cov = it.coverage;
                const covColor = cov == null ? 'text-text-quaternary' : cov > 130 ? 'text-warning' : cov < 70 ? 'text-danger' : 'text-success-light';
                return (
                  <tr key={i}>
                    <td className="px-2 py-1.5 text-text-secondary border-b border-bg-inset"><span className={it.type === 'raw' ? 'text-info' : it.type === 'sub' ? 'text-warning' : 'text-text-quaternary'}>[{it.type === 'raw' ? '원' : it.type === 'sub' ? '부' : '?'}]</span> {it.name}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums border-b border-bg-inset" style={cell(it.req_cost, 'rgba(168,85,247,')}>{it.req_cost ? won(it.req_cost) : '-'}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums border-b border-bg-inset" style={cell(it.act_cost, 'rgba(77,163,255,')}>{it.act_cost ? won(it.act_cost) : '-'}</td>
                    <td className={`px-2 py-1.5 text-right tabular-nums border-b border-bg-inset ${it.gap >= 0 ? 'text-info' : 'text-danger'}`}>{wonShort(it.gap)}</td>
                    <td className={`px-2 py-1.5 text-center tabular-nums border-b border-bg-inset ${covColor}`}>{cov == null ? '구매만' : cov >= 9999 ? '소요없음' : `${cov}%`}</td>
                  </tr>
                );
              })}
              {(!heat?.items || heat.items.length === 0) && <tr><td colSpan={5} className="px-2 py-6 text-center text-text-quaternary">데이터 없음</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
function Empty() { return <div className="h-[200px] flex items-center justify-center text-sm text-text-quaternary">데이터 없음</div>; }

// ─────────────────────────────────────────────
// 실적 조회
// ─────────────────────────────────────────────
function RecordsTab() {
  const [range, setRange] = useState(thisMonth());
  const [mclass, setMclass] = useState('');
  const [q, setQ] = useState('');
  const [data, setData] = useState<any>(null);
  const [hist, setHist] = useState<any>(null);
  const load = useCallback(async () => {
    const p = new URLSearchParams({ start: range.start, end: range.end, limit: '500' });
    if (mclass) p.set('mclass', mclass);
    if (q) p.set('q', q);
    setData(await getJSON<any>(`/purchase/records?${p.toString()}`, null));
  }, [range, mclass, q]);
  useEffect(() => { load(); }, [load]);
  const openVendor = async (v: string) => setHist({ type: 'vendor', ...(await getJSON<any>(`/purchase/records/vendor-history?vendor=${encodeURIComponent(v)}`, {})) });
  const openItem = async (code: string, name: string) => setHist({ type: 'item', ...(await getJSON<any>(`/purchase/records/item-history?item_code=${encodeURIComponent(code || '')}&item_name=${encodeURIComponent(name || '')}`, {})) });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <RangeBar range={range} setRange={setRange} />
        <select value={mclass} onChange={(e) => setMclass(e.target.value)} className={C.input}><option value="">전체 구분</option><option>원재료</option><option>부재료</option></select>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="품목·거래처 검색" className={`${C.input} w-48`} />
        {data && <span className="text-xs text-text-tertiary ml-auto">{fmt(data.total)}건 · 공급가 {won(data.supply_total)}{data.total > 500 && ' (500건 표시)'}</span>}
      </div>
      <div className={`${C.card} overflow-x-auto`}>
        <table className="w-full"><thead><tr><th className={C.th}>일자</th><th className={C.th}>거래처</th><th className={C.th}>구분</th><th className={C.th}>품목</th><th className={C.th}>담당</th><th className={C.th}>수량</th><th className={C.th}>단가</th><th className={C.th}>공급가</th><th className={C.th}>합계</th></tr></thead>
          <tbody>{!data?.rows?.length ? <tr><td colSpan={9} className="p-6 text-center text-text-quaternary text-sm">데이터 없음</td></tr> : data.rows.map((r: any) => (
            <tr key={r.id} className="hover:bg-bg-1">
              <td className={C.td}>{r.pdate}</td>
              <td className={`${C.td} text-text-primary`}><button onClick={() => openVendor(r.vendor)} className="hover:text-accent hover:underline text-left">{r.vendor}</button></td>
              <td className={C.td}><span className={r.mclass === '원재료' ? 'text-info' : 'text-warning'}>{r.mclass}</span></td>
              <td className={C.td}><button onClick={() => openItem(r.item_code, r.item_name)} className="hover:text-accent hover:underline text-left">{r.item_name}</button></td>
              <td className={C.td}>{r.staff}</td><td className={C.td}>{fmt(r.qty)}{r.unit}</td><td className={C.td}>{won(r.unit_price)}</td><td className={`${C.td} text-warning`}>{won(r.supply)}</td><td className={C.td}>{won(r.total)}</td>
            </tr>
          ))}</tbody></table>
      </div>
      {hist && <HistoryModal hist={hist} onClose={() => setHist(null)} />}
    </div>
  );
}

function HistoryModal({ hist, onClose }: { hist: any; onClose: () => void }) {
  const isVendor = hist.type === 'vendor';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div className="relative bg-bg-1 border border-border-primary rounded-2xl w-full max-w-3xl max-h-[85vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div><div className="text-xs text-text-tertiary">{isVendor ? '거래처 누적 이력' : '품목 구매 이력'}</div><div className="text-lg font-bold text-text-primary">{isVendor ? hist.vendor : hist.item_name}</div></div>
          <button onClick={onClose} className="text-text-tertiary hover:text-text-primary text-xl">×</button>
        </div>
        <div className="grid grid-cols-3 gap-3 mb-4">
          <StatCard label="누적 구매액" value={wonShort(hist.total_supply || 0)} tone="text-warning" />
          <StatCard label="라인수" value={fmt(hist.line_count || 0)} />
          <StatCard label={isVendor ? '거래기간' : '누적수량'} value={isVendor ? `${hist.first || '-'}~` : fmt(hist.total_qty || 0)} sub={isVendor ? (hist.last || '') : ''} />
        </div>
        <div className="text-sm font-semibold text-text-primary mb-2">월별 구매</div>
        <ResponsiveContainer width="100%" height={200}><BarChart data={hist.by_month || []}><CartesianGrid strokeDasharray="3 3" stroke="var(--color-bg-inset)" /><XAxis dataKey="month" tick={{ fill: 'var(--color-text-tertiary)', fontSize: 10 }} /><YAxis tick={{ fill: 'var(--color-text-tertiary)', fontSize: 10 }} tickFormatter={wonShort} /><Tooltip contentStyle={TT} formatter={(v: any) => won(v)} /><Bar dataKey="supply" fill="var(--color-brand-bg)" radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer>
        {!isVendor && hist.price_trend?.length > 1 && <>
          <div className="text-sm font-semibold text-text-primary mt-4 mb-2">단가 추이</div>
          <ResponsiveContainer width="100%" height={180}><LineChart data={hist.price_trend}><CartesianGrid strokeDasharray="3 3" stroke="var(--color-bg-inset)" /><XAxis dataKey="date" tick={{ fill: 'var(--color-text-tertiary)', fontSize: 9 }} /><YAxis tick={{ fill: 'var(--color-text-tertiary)', fontSize: 10 }} tickFormatter={wonShort} /><Tooltip contentStyle={TT} formatter={(v: any) => won(v)} /><Line type="monotone" dataKey="unit_price" name="단가" stroke="var(--color-cyan)" strokeWidth={2} dot={false} /></LineChart></ResponsiveContainer>
        </>}
        <div className="text-sm font-semibold text-text-primary mt-4 mb-2">{isVendor ? '품목별' : '거래처별'}</div>
        <div className="overflow-x-auto"><table className="w-full"><thead><tr><th className={C.th}>{isVendor ? '품목' : '거래처'}</th>{isVendor && <th className={C.th}>수량</th>}<th className={C.th}>구매액</th></tr></thead>
          <tbody>{(isVendor ? hist.by_item : hist.by_vendor || []).slice(0, 20).map((x: any, i: number) => (<tr key={i}><td className={`${C.td} text-text-secondary`}>{isVendor ? x.item_name : x.vendor}</td>{isVendor && <td className={C.td}>{fmt(x.qty)}</td>}<td className={`${C.td} text-warning`}>{won(x.supply)}</td></tr>))}</tbody></table></div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// 단가 추이 — 품목별 매입단가 변동 개요
// ─────────────────────────────────────────────
const SORTS: { k: string; label: string }[] = [
  { k: 'abs_change', label: '변동폭 큰순' },
  { k: 'change_desc', label: '상승률순' },
  { k: 'change_asc', label: '하락률순' },
  { k: 'spread', label: '가격편차순' },
  { k: 'supply', label: '구매액순' },
  { k: 'name', label: '품목명순' },
];
function pctTone(p: number | null) { if (p == null) return 'text-text-quaternary'; if (p > 0) return 'text-danger'; if (p < 0) return 'text-info'; return 'text-text-tertiary'; }
function pctStr(p: number | null) { if (p == null) return '-'; const s = p > 0 ? '▲' : p < 0 ? '▼' : '='; return `${s} ${Math.abs(p).toFixed(1)}%`; }

function PriceTab() {
  const [range, setRange] = useState({ start: '2025-01-01', end: iso(new Date()) });
  const [mclass, setMclass] = useState('');
  const [q, setQ] = useState('');
  const [minLines, setMinLines] = useState(2);
  const [sort, setSort] = useState('abs_change');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [hist, setHist] = useState<any>(null);
  const load = useCallback(async () => {
    setLoading(true);
    const p = new URLSearchParams({ start: range.start, end: range.end, min_lines: String(minLines), sort });
    if (mclass) p.set('mclass', mclass);
    setData(await getJSON<any>(`/purchase/records/price-tracker?${p.toString()}`, null));
    setLoading(false);
  }, [range, mclass, minLines, sort]);
  useEffect(() => { load(); }, [load]);
  const openItem = async (code: string, name: string) => setHist({ type: 'item', ...(await getJSON<any>(`/purchase/records/item-history?item_code=${encodeURIComponent(code || '')}&item_name=${encodeURIComponent(name || '')}&start=${range.start}&end=${range.end}`, {})) });
  const allItems = data?.items || [];
  const ql = q.trim().toLowerCase();
  const items = ql ? allItems.filter((it: any) => (it.item_name || '').toLowerCase().includes(ql) || (it.item_code || '').toLowerCase().includes(ql)) : allItems;
  // 점도표 데이터: x=변동률(%), y=누적공급가, 크기=매입횟수. 상승(빨강)/하락(파랑)/보합.
  const scatter = items.filter((it: any) => it.change_pct != null).map((it: any) => ({ ...it, x: it.change_pct, y: it.total_supply, z: it.buy_count }));
  const rising = scatter.filter((d: any) => d.x > 0), falling = scatter.filter((d: any) => d.x < 0), flat = scatter.filter((d: any) => d.x === 0);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <RangeBar range={range} setRange={setRange} />
        <select value={mclass} onChange={(e) => setMclass(e.target.value)} className={C.input}><option value="">전체 구분</option><option>원재료</option><option>부재료</option></select>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="품목·코드 검색" className={`${C.input} w-40`} />
        <label className="text-xs text-text-tertiary flex items-center gap-1">최소 매입<select value={minLines} onChange={(e) => setMinLines(Number(e.target.value))} className={C.input}>{[1, 2, 3, 5].map((n) => <option key={n} value={n}>{n}회+</option>)}</select></label>
        <select value={sort} onChange={(e) => setSort(e.target.value)} className={`${C.input} ml-auto`}>{SORTS.map((s) => <option key={s.k} value={s.k}>{s.label}</option>)}</select>
      </div>
      <p className="text-xs text-text-quaternary">기간 내 각 품목의 <b className="text-text-tertiary">매입 단가(전표상 단가, 품목×단위별)</b> 최초→최근 변동입니다. 상승=<span className="text-danger">빨강</span>, 하락=<span className="text-info">파랑</span>. 점/행 클릭 시 단가 추이 그래프.</p>
      {data && <>
        {/* 기간 총 단가효과 (인하 절감 − 인상 부담) — 총액 관점 순효과 */}
        <div className={`${C.card} p-4 border-l-4 ${(data.net_savings ?? 0) >= 0 ? 'border-l-success' : 'border-l-danger'}`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-[11px] text-text-tertiary mb-1">기간 총 단가효과 (인하 절감 − 인상 부담) · 발주량 가중</div>
              <div className={`text-2xl font-bold tabular-nums ${(data.net_savings ?? 0) >= 0 ? 'text-success' : 'text-danger'}`}>
                {(data.net_savings ?? 0) >= 0 ? '▼ 절감 ' : '▲ 부담 '}{won(Math.abs(data.net_savings || 0))}
              </div>
              <div className="text-xs text-text-quaternary mt-1">
                {(data.net_savings ?? 0) >= 0 ? '인하분이 인상분보다 커서 총액상 원가 절감 우위' : '인상분이 인하분보다 커서 총액상 원가 부담 우위'}
                <span className="text-text-tertiary"> · {range.start}~{range.end}</span>
                {data.excluded_outliers > 0 && <span className="text-warning"> · 단가 오기입 의심 {fmt(data.excluded_outliers)}건(비현실적 변동·수량↔단가 기준 불일치) 집계 제외</span>}
              </div>
            </div>
            <div className="flex gap-6">
              <div className="text-right"><div className="text-[11px] text-info mb-0.5">인하 절감액</div><div className="text-lg font-bold tabular-nums text-info">−{wonShort(data.savings_amount || 0)}</div><div className="text-[10px] text-text-quaternary">{fmt(data.falling_count)}품목</div></div>
              <div className="text-right"><div className="text-[11px] text-danger mb-0.5">인상 부담액</div><div className="text-lg font-bold tabular-nums text-danger">+{wonShort(data.increase_amount || 0)}</div><div className="text-[10px] text-text-quaternary">{fmt(data.rising_count)}품목</div></div>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="대상 품목" value={fmt(items.length)} sub={`${range.start} ~ ${range.end}`} />
          <StatCard label="단가 상승" value={fmt(rising.length)} tone="text-danger" />
          <StatCard label="단가 하락" value={fmt(falling.length)} tone="text-info" />
          <StatCard label="보합" value={fmt(flat.length)} tone="text-text-tertiary" />
        </div>
      </>}

      {/* 점도표 — 단가 변동률 분포 (x=변동률, y=누적공급가, 점크기=매입횟수) */}
      <div className={`${C.card} p-4 relative`}>
        {loading && <div className="absolute inset-0 bg-bg-0/40 z-10 rounded-xl" />}
        <div className="flex items-center justify-between mb-1">
          <div className="text-sm font-semibold text-text-primary">단가 변동 점도표</div>
          <div className="text-xs text-text-quaternary">x축 = 변동률(%) · y축 = 누적 공급가 · 점 크기 = 매입 횟수 · 점 클릭 = 상세</div>
        </div>
        {scatter.length > 0 ? (
          <ResponsiveContainer width="100%" height={300}>
            <ScatterChart margin={{ top: 10, right: 20, bottom: 20, left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-bg-inset)" />
              <XAxis type="number" dataKey="x" name="변동률" unit="%" tick={{ fill: 'var(--color-text-tertiary)', fontSize: 10 }} domain={['dataMin', 'dataMax']} tickFormatter={(v) => `${Math.round(v)}%`} />
              <YAxis type="number" dataKey="y" name="누적공급가" tick={{ fill: 'var(--color-text-tertiary)', fontSize: 10 }} tickFormatter={wonShort} width={54} />
              <ZAxis type="number" dataKey="z" range={[40, 400]} name="매입횟수" />
              <ReferenceLine x={0} stroke="var(--color-text-quaternary)" strokeDasharray="4 4" />
              <Tooltip contentStyle={TT} cursor={{ strokeDasharray: '3 3' }} formatter={(v: any, n: any) => n === '누적공급가' ? won(v) : n === '변동률' ? `${v}%` : v}
                labelFormatter={() => ''} content={({ payload }: any) => {
                  const d = payload?.[0]?.payload; if (!d) return null;
                  return <div style={TT as any} className="p-2 text-xs"><div className="font-semibold text-text-primary mb-0.5">{d.item_name} <span className="text-text-quaternary">[{d.unit}]</span></div><div className={pctTone(d.change_pct)}>{pctStr(d.change_pct)} · {won(d.first_price)}→{won(d.last_price)}</div><div className="text-text-tertiary">누적 {won(d.total_supply)} · {d.buy_count}회</div></div>;
                }} />
              <Scatter name="상승" data={rising} fill="var(--color-danger)" fillOpacity={0.7} onClick={(d: any) => openItem(d.item_code, d.item_name)} cursor="pointer" />
              <Scatter name="하락" data={falling} fill="var(--color-info)" fillOpacity={0.7} onClick={(d: any) => openItem(d.item_code, d.item_name)} cursor="pointer" />
              <Scatter name="보합" data={flat} fill="var(--color-text-quaternary)" fillOpacity={0.6} onClick={(d: any) => openItem(d.item_code, d.item_name)} cursor="pointer" />
            </ScatterChart>
          </ResponsiveContainer>
        ) : <div className="py-16 text-center text-text-quaternary text-sm">{loading ? '조회 중…' : '데이터 없음'}</div>}
      </div>

      <div className={`${C.card} overflow-x-auto relative`}>
        {loading && <div className="absolute inset-0 bg-bg-0/40 z-10" />}
        <table className="w-full">
          <thead><tr>
            <th className={C.th}>품목</th><th className={C.th}>구분</th><th className={C.th}>단위</th><th className={`${C.th} text-right`}>매입</th>
            <th className={`${C.th} text-right`}>최초단가</th><th className={`${C.th} text-right`}>최근단가</th>
            <th className={`${C.th} text-right`}>변동률</th><th className={`${C.th} text-right`}>최저~최고</th>
            <th className={`${C.th} text-right`}>편차</th><th className={`${C.th} text-right`}>가중평균</th><th className={`${C.th} text-right`}>누적공급가</th>
          </tr></thead>
          <tbody>{!items.length ? <tr><td colSpan={11} className="p-6 text-center text-text-quaternary text-sm">{loading ? '조회 중…' : '데이터 없음'}</td></tr> : items.map((it: any, i: number) => (
            <tr key={i} className="hover:bg-bg-1 cursor-pointer" onClick={() => openItem(it.item_code, it.item_name)}>
              <td className={`${C.td} text-text-primary max-w-[280px] truncate`} title={it.item_name}>{it.item_name}{it.vendor_count > 1 && <span className="text-text-quaternary text-[11px] ml-1">·{it.vendor_count}처</span>}</td>
              <td className={C.td}><span className={it.mclass === '원재료' ? 'text-info' : 'text-warning'}>{it.mclass || '-'}</span></td>
              <td className={`${C.td} text-text-tertiary`}>{it.unit || '-'}</td>
              <td className={`${C.td} text-right tabular-nums`}>{it.buy_count}회</td>
              <td className={`${C.td} text-right tabular-nums`}>{won(it.first_price)}<div className="text-[10px] text-text-quaternary">{it.first_date?.slice(2)}</div></td>
              <td className={`${C.td} text-right tabular-nums text-text-primary`}>{won(it.last_price)}<div className="text-[10px] text-text-quaternary">{it.last_date?.slice(2)}</div></td>
              <td className={`${C.td} text-right tabular-nums font-semibold ${pctTone(it.change_pct)}`}>{pctStr(it.change_pct)}</td>
              <td className={`${C.td} text-right tabular-nums text-text-tertiary text-xs`}>{won(it.min_price)}~{won(it.max_price)}</td>
              <td className={`${C.td} text-right tabular-nums text-text-tertiary`}>{it.spread_pct != null ? `${it.spread_pct.toFixed(0)}%` : '-'}</td>
              <td className={`${C.td} text-right tabular-nums`}>{it.avg_price != null ? won(it.avg_price) : '-'}</td>
              <td className={`${C.td} text-right tabular-nums text-warning`}>{wonShort(it.total_supply)}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {hist && <HistoryModal hist={hist} onClose={() => setHist(null)} />}
    </div>
  );
}

// ─────────────────────────────────────────────
// 원부재료 소요 (BOM 계획) + 실제 구매 gap
// ─────────────────────────────────────────────
function MatTab() {
  const [range, setRange] = useState(thisMonth());
  const [mr, setMr] = useState<MatReq | null>(null);
  const [loading, setLoading] = useState(false);
  const [openVendor, setOpenVendor] = useState<string | null>(null);
  const load = useCallback(async () => { setLoading(true); setMr(await getJSON<MatReq | null>(`/purchase/material-requirement?start=${range.start}&end=${range.end}`, null)); setLoading(false); }, [range]);
  useEffect(() => { load(); }, [load]);
  const createPO = async (vendor: string) => {
    const lines = (mr?.materials || []).filter((m) => m.vendor === vendor).map((m) => ({ material_type: m.type, material_id: m.material_id, material_name: m.name, erp_code: m.erp_code, qty: m.qty, unit: m.unit, unit_price: m.unit_price }));
    if (!lines.length) return;
    if (!confirm(`[${vendor}] 소요 자재 ${lines.length}건으로 발주를 생성합니다.`)) return;
    const r = await send('/purchase/orders', 'POST', { vendor_name: vendor, order_date: iso(new Date()), status: '요청', lines });
    if (r.ok) alert(`발주 생성 완료 (₩${fmt(r.data.total_amount)})`); else alert('실패');
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <RangeBar range={range} setRange={setRange} />
        {loading && <span className="text-xs text-text-quaternary">계산 중…</span>}
        {mr && <span className="text-xs text-text-tertiary ml-auto">생산 매칭 {fmt(mr.matched_qty)} · 미매칭 {fmt(mr.unmatched_qty)}</span>}
      </div>
      <p className="text-xs text-text-quaternary">생산 실적을 BOM으로 폭발한 <b className="text-text-tertiary">이론 소요(계획)</b>입니다. 실제 매입은 [실적 대시보드/조회]에서 확인하세요.</p>
      {mr?.error && <div className="text-xs text-danger">오류: {mr.error}</div>}
      {mr && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="총 소요원가(이론)" value={wonShort(mr.total_cost)} tone="text-warning" />
            <StatCard label="원재료 종류" value={fmt(mr.raw_count)} />
            <StatCard label="부자재 종류" value={fmt(mr.sub_count)} />
            <StatCard label="거래처 수" value={fmt(mr.by_vendor.length)} />
          </div>
          <div className={`${C.card} p-4`}>
            <div className="text-sm font-semibold text-text-primary mb-3">거래처별 소요 (클릭 시 자재 상세 · 발주 생성)</div>
            <div className="overflow-x-auto">
              <table className="w-full"><thead><tr><th className={C.th}>거래처</th><th className={C.th}>자재수</th><th className={C.th}>소요원가</th><th className={C.th}></th></tr></thead>
                <tbody>{mr.by_vendor.map((v) => (
                  <>
                    <tr key={v.vendor} className="hover:bg-bg-1 cursor-pointer" onClick={() => setOpenVendor(openVendor === v.vendor ? null : v.vendor)}>
                      <td className={`${C.td} text-text-primary font-medium`}>{v.vendor}</td><td className={C.td}>{v.items}</td><td className={`${C.td} text-warning`}>{won(v.cost)}</td>
                      <td className={C.td}><button onClick={(e) => { e.stopPropagation(); createPO(v.vendor); }} className="text-accent text-xs hover:underline">발주 생성</button> <span className="text-text-quaternary text-xs ml-2">{openVendor === v.vendor ? '▲' : '▼'}</span></td>
                    </tr>
                    {openVendor === v.vendor && (
                      <tr key={`${v.vendor}-d`} className="bg-bg-0"><td colSpan={4} className="px-4 py-2 border-b border-bg-inset">
                        <table className="w-full"><thead><tr><th className={C.th}>자재</th><th className={C.th}>ERP</th><th className={C.th}>소요량</th><th className={C.th}>단가</th><th className={C.th}>원가</th></tr></thead>
                          <tbody>{mr.materials.filter((m) => m.vendor === v.vendor).map((m, i) => (<tr key={i}><td className={`${C.td} text-text-secondary`}><span className={m.type === 'raw' ? 'text-info' : 'text-warning'}>[{m.type === 'raw' ? '원' : '부'}]</span> {m.name}</td><td className={C.td}>{m.erp_code || '-'}</td><td className={C.td}>{fmt(m.qty)}{m.unit}</td><td className={C.td}>{won(m.unit_price)}</td><td className={C.td}>{won(m.cost)}</td></tr>))}</tbody></table>
                      </td></tr>
                    )}
                  </>
                ))}</tbody></table>
            </div>
          </div>
          {mr.unmatched.length > 0 && <div className="text-xs text-warning">미매칭 생산 품목(BOM 연결 안됨): {mr.unmatched.slice(0, 8).map((u) => `${u.name}(${fmt(u.qty)})`).join(', ')} … → SCM 품목관리에서 BOM 연결 필요</div>}
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// 거래처
// ─────────────────────────────────────────────
function VendorTab() {
  const [rows, setRows] = useState<Vendor[]>([]);
  const [form, setForm] = useState<any>({ name: '', category: '원재료', contact: '', phone: '', email: '', biz_no: '', lead_time_days: 0 });
  const load = useCallback(async () => { setRows((await getJSON<{ vendors: Vendor[] }>('/purchase/vendors', { vendors: [] })).vendors); }, []);
  useEffect(() => { load(); }, [load]);
  const seed = async () => { const r = await send('/purchase/vendors/seed', 'POST'); if (r.ok) { alert(`자재 공급처에서 ${r.data.added}개 거래처 생성`); load(); } };
  const save = async () => { if (!form.name.trim()) { alert('거래처명'); return; } const r = await send('/purchase/vendors', 'POST', { ...form, is_active: true }); if (r.ok) { setForm({ name: '', category: '원재료', contact: '', phone: '', email: '', biz_no: '', lead_time_days: 0 }); load(); } else alert('실패'); };
  const del = async (id: number) => { if (!confirm('삭제?')) return; const r = await send(`/purchase/vendors/${id}`, 'DELETE'); if (r.ok) load(); };
  return (
    <div className="space-y-4">
      <div className={`${C.card} p-4`}>
        <div className="flex items-center justify-between mb-3"><div className="text-sm font-semibold text-text-primary">거래처 ({rows.length})</div><button onClick={seed} className={`${C.btn} ${C.btnGhost}`}>자재 공급처에서 가져오기</button></div>
        <div className="flex flex-wrap items-end gap-2">
          <div><div className="text-xs text-text-tertiary mb-1">거래처명 *</div><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={`${C.input} w-40`} /></div>
          <div><div className="text-xs text-text-tertiary mb-1">구분</div><select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className={C.input}><option>원재료</option><option>부자재</option><option>포장</option><option>기타</option></select></div>
          <div><div className="text-xs text-text-tertiary mb-1">담당자</div><input value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} className={`${C.input} w-24`} /></div>
          <div><div className="text-xs text-text-tertiary mb-1">연락처</div><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={`${C.input} w-32`} /></div>
          <div><div className="text-xs text-text-tertiary mb-1">이메일(발주서)</div><input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={`${C.input} w-44`} /></div>
          <div><div className="text-xs text-text-tertiary mb-1">사업자번호</div><input value={form.biz_no} onChange={(e) => setForm({ ...form, biz_no: e.target.value })} className={`${C.input} w-32`} /></div>
          <div><div className="text-xs text-text-tertiary mb-1">리드타임(일)</div><input type="number" value={form.lead_time_days} onChange={(e) => setForm({ ...form, lead_time_days: Number(e.target.value) })} className={`${C.input} w-20`} /></div>
          <button onClick={save} className={`${C.btn} ${C.btnPrimary}`}>{form.id ? '수정' : '+ 추가'}</button>
          {form.id && <button onClick={() => setForm({ name: '', category: '원재료', contact: '', phone: '', email: '', biz_no: '', lead_time_days: 0 })} className={`${C.btn} ${C.btnGhost}`}>취소</button>}
        </div>
      </div>
      <div className={`${C.card} overflow-x-auto`}>
        <table className="w-full"><thead><tr><th className={C.th}>거래처</th><th className={C.th}>구분</th><th className={C.th}>담당자</th><th className={C.th}>연락처</th><th className={C.th}>이메일</th><th className={C.th}>사업자</th><th className={C.th}>리드타임</th><th className={C.th}>취급자재</th><th className={C.th}></th></tr></thead>
          <tbody>{rows.map((v) => (<tr key={v.id}><td className={`${C.td} text-text-primary font-medium`}>{v.name}</td><td className={C.td}>{v.category || '-'}</td><td className={C.td}>{v.contact || '-'}</td><td className={C.td}>{v.phone || '-'}</td><td className={C.td}>{v.email || <span className="text-text-quaternary">미등록</span>}</td><td className={C.td}>{v.biz_no || '-'}</td><td className={C.td}>{v.lead_time_days}일</td><td className={C.td}>원 {v.raw_materials}·부 {v.sub_materials}</td><td className={C.td}><button onClick={() => setForm({ id: v.id, name: v.name, category: v.category, contact: v.contact, phone: v.phone, email: v.email, biz_no: v.biz_no, lead_time_days: v.lead_time_days })} className="text-accent text-xs hover:underline mr-2">수정</button><button onClick={() => del(v.id)} className="text-danger text-xs hover:underline">삭제</button></td></tr>))}</tbody></table>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// 발주
// ─────────────────────────────────────────────
function POTab() {
  const [rows, setRows] = useState<PO[]>([]);
  const [range, setRange] = useState({ start: '2026-01-01', end: iso(new Date()) });
  const [open, setOpen] = useState<number | null>(null);
  const load = useCallback(async () => { setRows((await getJSON<{ orders: PO[] }>(`/purchase/orders?start=${range.start}&end=${range.end}`, { orders: [] })).orders); }, [range]);
  useEffect(() => { load(); }, [load]);
  const setStatus = async (id: number, status: string) => { const r = await send(`/purchase/orders/${id}/status?status=${encodeURIComponent(status)}`, 'PATCH'); if (r.ok) load(); };
  const del = async (id: number) => { if (!confirm('발주 삭제?')) return; const r = await send(`/purchase/orders/${id}`, 'DELETE'); if (r.ok) load(); };
  const issue = async (p: PO) => {
    const to = prompt(`발주서를 이메일로 발송합니다.\n거래처(${p.vendor_name}) 이메일이 등록돼 있으면 비워두세요. 다른 주소로 보내려면 입력:`, '');
    if (to === null) return;
    const r = await send(`/purchase/orders/${p.id}/issue${to ? `?to=${encodeURIComponent(to)}` : ''}`, 'POST');
    if (r.ok) alert(`발주서 발송 완료 → ${r.data.sent_to}`); else alert(`발송 실패: ${r.data.detail || ''}`);
    load();
  };
  const STATUS = ['요청', '발주', '입고', '완료', '취소'];
  const badge: Record<string, string> = { 요청: 'text-warning', 발주: 'text-accent', 입고: 'text-cyan', 완료: 'text-success-light', 취소: 'text-danger' };
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <input type="date" value={range.start} onChange={(e) => setRange({ ...range, start: e.target.value })} className={C.input} />
        <span className="text-text-quaternary">~</span>
        <input type="date" value={range.end} onChange={(e) => setRange({ ...range, end: e.target.value })} className={C.input} />
        <span className="text-xs text-text-quaternary ml-auto">{rows.length}건 · [원부재료 소요] 탭에서 거래처별 발주 생성 → 여기서 발주서 발행</span>
      </div>
      <div className={`${C.card} overflow-x-auto`}>
        <table className="w-full"><thead><tr><th className={C.th}>발주일</th><th className={C.th}>거래처</th><th className={C.th}>품목수</th><th className={C.th}>발주액</th><th className={C.th}>상태</th><th className={C.th}></th></tr></thead>
          <tbody>{rows.length === 0 ? <tr><td colSpan={6} className="p-6 text-center text-text-quaternary text-sm">발주 없음</td></tr> : rows.map((p) => (
            <>
              <tr key={p.id} className="hover:bg-bg-1 cursor-pointer" onClick={() => setOpen(open === p.id ? null : p.id)}>
                <td className={C.td}>{p.order_date}</td><td className={`${C.td} text-text-primary`}>{p.vendor_name}</td><td className={C.td}>{p.line_count}</td><td className={`${C.td} text-warning`}>{won(p.total_amount)}</td>
                <td className={C.td}><select value={p.status} onClick={(e) => e.stopPropagation()} onChange={(e) => setStatus(p.id, e.target.value)} className={`bg-bg-0 border border-border-primary rounded px-2 py-1 text-xs ${badge[p.status] || ''}`}>{STATUS.map((s) => <option key={s} value={s}>{s}</option>)}</select></td>
                <td className={C.td}><button onClick={(e) => { e.stopPropagation(); issue(p); }} className="text-success text-xs hover:underline mr-2">발주서 발행</button><button onClick={(e) => { e.stopPropagation(); del(p.id); }} className="text-danger text-xs hover:underline">삭제</button> <span className="text-text-quaternary text-xs ml-1">{open === p.id ? '▲' : '▼'}</span></td>
              </tr>
              {open === p.id && <tr key={`${p.id}-d`} className="bg-bg-0"><td colSpan={6} className="px-4 py-2 border-b border-bg-inset"><table className="w-full"><thead><tr><th className={C.th}>자재</th><th className={C.th}>소요량</th><th className={C.th}>단가</th><th className={C.th}>금액</th></tr></thead><tbody>{p.lines.map((l: any) => (<tr key={l.id}><td className={C.td}>{l.material_name}</td><td className={C.td}>{fmt(l.qty)}{l.unit}</td><td className={C.td}>{won(l.unit_price)}</td><td className={C.td}>{won(l.amount)}</td></tr>))}</tbody></table></td></tr>}
            </>
          ))}</tbody></table>
      </div>
    </div>
  );
}
