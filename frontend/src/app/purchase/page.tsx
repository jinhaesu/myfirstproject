'use client';

import { useEffect, useState, useCallback, Fragment } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Navigation } from '@/components/layout/Navigation';
import { LoadingOverlay } from '@/components/LoadingOverlay';
import { Combobox } from '@/components/Combobox';
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
// 구매 관리 공통 기간 토글 — 프리셋 즉시 적용 + 날짜는 '조회' 버튼으로만 반영.
// value = 적용된 기간, onApply = 조회 시 부모에 반영. 날짜 편집은 내부 draft에만 반영된다.
function PeriodBar({ value, onApply }: { value: any; onApply: (r: any) => void }) {
  const P = presets();
  const [draft, setDraft] = useState({ start: value.start, end: value.end });
  useEffect(() => { setDraft({ start: value.start, end: value.end }); }, [value.start, value.end]);
  const dirty = draft.start !== value.start || draft.end !== value.end;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {Object.keys(P).map((k) => {
        const on = value.start === P[k].start && value.end === P[k].end;
        return <button key={k} onClick={() => { setDraft(P[k]); onApply(P[k]); }} className={`${C.btn} ${on ? C.btnPrimary : C.btnGhost}`}>{k}</button>;
      })}
      <input type="date" value={draft.start} onChange={(e) => setDraft({ ...draft, start: e.target.value })} className={C.input} />
      <span className="text-text-quaternary">~</span>
      <input type="date" value={draft.end} onChange={(e) => setDraft({ ...draft, end: e.target.value })} className={C.input} />
      <button onClick={() => onApply(draft)} className={`${C.btn} ${C.btnPrimary} ${dirty ? 'ring-2 ring-brand/50' : ''}`}>조회</button>
      {dirty && <span className="text-xs text-warning self-center">변경됨 — 조회를 누르세요</span>}
    </div>
  );
}

interface MatReq { materials: { type: string; name: string; erp_code: string; qty: number; unit: string; unit_price: number; cost: number; vendor: string; material_id: number }[]; total_cost: number; raw_count: number; sub_count: number; by_vendor: { vendor: string; cost: number; items: number }[]; matched_qty: number; unmatched_qty: number; unmatched: { name: string; qty: number }[]; error?: string; }
interface Vendor { id: number; name: string; biz_no: string; contact: string; phone: string; email: string; category: string; lead_time_days: number; is_active: boolean; raw_materials: number; sub_materials: number; }
interface PO { id: number; po_no: string; vendor_id: number; vendor_name: string; order_date: string; expected_date: string; status: string; total_amount: number; line_count: number; lines: any[]; }

type Tab = '실적 대시보드' | '실적 조회' | '실적 입력' | '단가 추이' | '매입채무' | '원부재료 소요' | '거래처' | '발주';

export default function PurchasePage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('실적 대시보드');
  useEffect(() => { if (!isLoading && !user) router.replace('/login'); }, [isLoading, user, router]);
  if (isLoading || !user) return <div className="min-h-screen bg-bg-0" />;
  const tabs: Tab[] = ['실적 대시보드', '실적 조회', '실적 입력', '단가 추이', '매입채무', '원부재료 소요', '거래처', '발주'];
  return (
    <div className="min-h-screen bg-bg-0">
      <Navigation />
      <main className="max-w-[1400px] mx-auto px-4 py-6">
        <div className="mb-4"><h1 className="text-xl font-bold text-text-primary">구매 관리</h1><p className="text-sm text-text-tertiary mt-0.5">구매일보 실적 분석 · 매출대비 구매비율 · 거래처/품목 이력 · 발주·발주서 발행.</p></div>
        <div className="flex gap-1 mb-5 border-b border-border-primary overflow-x-auto">{tabs.map((t) => <button key={t} onClick={() => setTab(t)} className={`px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px whitespace-nowrap ${tab === t ? 'border-brand text-accent' : 'border-transparent text-text-tertiary hover:text-text-secondary'}`}>{t}</button>)}</div>
        {tab === '실적 대시보드' && <DashTab />}
        {tab === '실적 조회' && <RecordsTab />}
        {tab === '실적 입력' && <InputTab />}
        {tab === '단가 추이' && <PriceTab />}
        {tab === '매입채무' && <APTab />}
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
        <PeriodBar value={range} onApply={setRange} />
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
// 실적 입력 — 구매일보 1건 직접 입력 (엑셀 없이)
// ─────────────────────────────────────────────
const EMPTY_FORM = { pdate: iso(new Date()), seq: 0, warehouse: '공장_조인앤조인(F3)', vendor: '', mclass: '원재료', staff: '', item_code: '', item_name: '', unit: 'ea', qty: 0, unit_price: 0, vat_mode: 'auto' as 'auto' | 'zero', note: '' };
function InputTab() {
  const [f, setF] = useState({ ...EMPTY_FORM });
  const [recent, setRecent] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const loadRecent = useCallback(async () => { setRecent((await getJSON<any>('/purchase/records/manual-recent?limit=30', { rows: [] })).rows); }, []);
  useEffect(() => { loadRecent(); }, [loadRecent]);
  const supply = Math.round((Number(f.qty) || 0) * (Number(f.unit_price) || 0));
  const vat = f.vat_mode === 'zero' ? 0 : Math.round(supply * 0.1);
  const total = supply + vat;
  const set = (k: string, v: any) => setF({ ...f, [k]: v });
  const save = async () => {
    if (!f.item_name && !f.item_code) { setMsg('품목명 또는 품목코드를 입력하세요.'); return; }
    if (!f.vendor) { setMsg('거래처를 선택/입력하세요.'); return; }
    setSaving(true); setMsg(null);
    const body = { pdate: f.pdate, seq: Number(f.seq) || 0, warehouse: f.warehouse, vendor: f.vendor, mclass: f.mclass, staff: f.staff, item_code: f.item_code, item_name: f.item_name, unit: f.unit, qty: Number(f.qty) || 0, unit_price: Number(f.unit_price) || 0, vat, note: f.note };
    const r = await send('/purchase/records/manual', 'POST', body);
    setSaving(false);
    if (r.ok) { setMsg(`저장 완료 (공급가 ${won(r.data.supply)})`); setF({ ...EMPTY_FORM, pdate: f.pdate, warehouse: f.warehouse, staff: f.staff, mclass: f.mclass }); loadRecent(); }
    else setMsg(r.data?.detail || '저장 실패');
  };
  const del = async (id: number) => { if (!confirm('이 입력 건을 삭제할까요?')) return; const r = await send(`/purchase/records/${id}`, 'DELETE'); if (r.ok) loadRecent(); };
  const L = ({ children }: { children: any }) => <div className="text-xs text-text-tertiary mb-1">{children}</div>;
  return (
    <div className="space-y-4">
      <div className={`${C.card} p-4`}>
        <div className="text-sm font-semibold text-text-primary mb-1">구매 실적 직접 입력</div>
        <p className="text-xs text-text-quaternary mb-4">구매일보 엑셀 없이 1건씩 입력합니다. 공급가·부가세·합계는 수량×단가로 자동 계산됩니다. (매출연동·재고 분석에 즉시 반영)</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div><L>구매일자</L><input type="date" value={f.pdate} onChange={(e) => set('pdate', e.target.value)} className={`${C.input} w-full`} /></div>
          <div><L>전표 No.(일자내)</L><input type="number" value={f.seq} onChange={(e) => set('seq', e.target.value)} className={`${C.input} w-full`} /></div>
          <div><L>창고</L><input value={f.warehouse} onChange={(e) => set('warehouse', e.target.value)} className={`${C.input} w-full`} /></div>
          <div><L>담당자</L><input value={f.staff} onChange={(e) => set('staff', e.target.value)} placeholder="예: 이종현" className={`${C.input} w-full`} /></div>
          <div><L>거래처</L><Combobox<string>
            value={f.vendor} onChange={(v) => set('vendor', v)} placeholder="클릭 또는 키워드 입력"
            fetcher={(q) => getJSON<{ vendors: string[] }>(`/purchase/suggest/vendors?q=${encodeURIComponent(q)}&limit=30`, { vendors: [] }).then((r) => r.vendors)}
            getLabel={(s) => s}
            render={(s) => <span className="text-text-primary">{s}</span>}
          /></div>
          <div><L>구분</L><select value={f.mclass} onChange={(e) => set('mclass', e.target.value)} className={`${C.input} w-full`}><option>원재료</option><option>부재료</option></select></div>
          <div><L>품목코드</L><input value={f.item_code} onChange={(e) => set('item_code', e.target.value)} placeholder="예: 4130130" className={`${C.input} w-full`} /></div>
          <div><L>단위</L><input value={f.unit} onChange={(e) => set('unit', e.target.value)} className={`${C.input} w-full`} /></div>
          <div className="col-span-2 md:col-span-4"><L>품목명 [규격] <span className="text-text-quaternary">— 클릭 또는 키워드 입력 시 선택하면 코드·단위·구분·최근단가 자동 채움</span></L><Combobox<any>
            value={f.item_name} onChange={(v) => set('item_name', v)} placeholder="예: 아몬드분말 (키워드 입력)"
            fetcher={(q) => getJSON<{ items: any[] }>(`/purchase/suggest/items?q=${encodeURIComponent(q)}&limit=30`, { items: [] }).then((r) => r.items)}
            getLabel={(it) => it.item_name}
            onPick={(it) => setF((prev) => ({ ...prev, item_name: it.item_name, item_code: it.item_code || prev.item_code, unit: it.unit || prev.unit, mclass: it.mclass || prev.mclass, unit_price: it.last_price ? Math.round(it.last_price) : prev.unit_price }))}
            render={(it) => (
              <div className="flex items-center justify-between gap-2">
                <span className="text-text-primary truncate">{it.item_name}</span>
                <span className="text-[11px] text-text-quaternary whitespace-nowrap shrink-0">{it.item_code || ''} · {it.unit || '-'} · 최근 {won(it.last_price)} · {it.count}건</span>
              </div>
            )}
          /></div>
          <div><L>수량</L><input type="number" value={f.qty} onChange={(e) => set('qty', e.target.value)} className={`${C.input} w-full`} /></div>
          <div><L>단가</L><input type="number" value={f.unit_price} onChange={(e) => set('unit_price', e.target.value)} className={`${C.input} w-full`} /></div>
          <div><L>부가세</L><select value={f.vat_mode} onChange={(e) => set('vat_mode', e.target.value)} className={`${C.input} w-full`}><option value="auto">10% 자동</option><option value="zero">면세(0)</option></select></div>
          <div><L>적요</L><input value={f.note} onChange={(e) => set('note', e.target.value)} className={`${C.input} w-full`} /></div>
        </div>
        <div className="flex items-center gap-4 mt-4 flex-wrap">
          <div className="flex gap-4 text-sm">
            <span className="text-text-tertiary">공급가 <b className="text-warning tabular-nums">{won(supply)}</b></span>
            <span className="text-text-tertiary">부가세 <b className="text-text-secondary tabular-nums">{won(vat)}</b></span>
            <span className="text-text-tertiary">합계 <b className="text-text-primary tabular-nums">{won(total)}</b></span>
          </div>
          <button onClick={save} disabled={saving} className={`${C.btn} ${C.btnPrimary} ml-auto`}>{saving ? '저장 중…' : '+ 실적 저장'}</button>
        </div>
        {msg && <div className="mt-2 text-xs text-accent">{msg}</div>}
      </div>

      <div className={`${C.card} overflow-x-auto`}>
        <div className="px-4 pt-3 text-sm font-semibold text-text-primary">최근 직접입력 ({recent.length})</div>
        <table className="w-full mt-2"><thead><tr><th className={C.th}>일자</th><th className={C.th}>거래처</th><th className={C.th}>구분</th><th className={C.th}>품목</th><th className={C.th}>수량</th><th className={C.th}>단가</th><th className={C.th}>공급가</th><th className={C.th}>입력자</th><th className={C.th}></th></tr></thead>
          <tbody>{!recent.length ? <tr><td colSpan={9} className="p-6 text-center text-text-quaternary text-sm">직접 입력한 실적이 없습니다.</td></tr> : recent.map((r) => (
            <tr key={r.id} className="hover:bg-bg-1">
              <td className={C.td}>{r.pdate}{r.seq ? `-${r.seq}` : ''}</td>
              <td className={`${C.td} text-text-primary`}>{r.vendor}</td>
              <td className={C.td}><span className={r.mclass === '원재료' ? 'text-info' : 'text-warning'}>{r.mclass}</span></td>
              <td className={`${C.td} max-w-[280px] truncate`} title={r.item_name}>{r.item_name}</td>
              <td className={C.td}>{fmt(r.qty)}{r.unit}</td><td className={C.td}>{won(r.unit_price)}</td><td className={`${C.td} text-warning`}>{won(r.supply)}</td>
              <td className={C.td}>{r.created_by || '-'}</td>
              <td className={C.td}><button onClick={() => del(r.id)} className="text-danger text-xs hover:underline">삭제</button></td>
            </tr>
          ))}</tbody></table>
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
        <PeriodBar value={range} onApply={setRange} />
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
// 매입채무 (AP) — 거래처 정산조건 + 지급 + aging + 정산 우선순위
// ─────────────────────────────────────────────
const BUCKET_TONE: Record<string, string> = {
  '미도래': 'text-info', '당일': 'text-warning', '1~30일': 'text-warning',
  '31~60일': 'text-danger', '61~90일': 'text-danger', '90일+': 'text-danger', '미설정': 'text-text-quaternary',
};
const TERM_TYPES = [
  { k: 'MONTH_END', label: '지정월 말일 (예: 월말)' },
  { k: 'DAY_OF_MONTH', label: '지정월 N일 (예: 익월 20일)' },
  { k: 'DAYS_AFTER', label: '발주 후 N일 (예: 30일)' },
];
const OFFSETS = [{ v: 0, label: '당월' }, { v: 1, label: '익월' }, { v: 2, label: '익익월' }];

function APTab() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [terms, setTerms] = useState<any[]>([]);
  const [pays, setPays] = useState<any[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [onlyBalance, setOnlyBalance] = useState(true);
  const [start, setStart] = useState('');   // 미지급 기준 시작일(이전 발주는 지급완료 간주). 빈값=전체

  const loadAging = useCallback(async () => { setLoading(true); setData(await getJSON<any>(`/purchase/ap-aging${start ? `?start=${start}` : ''}`, null)); setLoading(false); }, [start]);
  const loadTerms = useCallback(async () => { setTerms((await getJSON<any>('/purchase/vendor-terms', { terms: [] })).terms); }, []);
  const loadPays = useCallback(async () => { setPays((await getJSON<any>('/purchase/payments?limit=50', { payments: [] })).payments); }, []);
  useEffect(() => { loadAging(); loadTerms(); loadPays(); }, [loadAging, loadTerms, loadPays]);

  // 정산조건 편집 폼
  const [tf, setTf] = useState<any>({ vendor: '', term_type: 'MONTH_END', term_month_offset: 1, term_day: 20, term_days: 30, memo: '' });
  const [tmsg, setTmsg] = useState<string | null>(null);
  const saveTerm = async () => {
    if (!tf.vendor) { setTmsg('거래처를 선택하세요.'); return; }
    const r = await send('/purchase/vendor-terms', 'POST', tf);
    if (r.ok) { setTmsg(`저장: ${r.data.vendor} → ${r.data.label}`); setTf({ ...tf, vendor: '', memo: '' }); loadTerms(); loadAging(); }
    else setTmsg(r.data?.detail || '저장 실패');
  };
  const editTerm = (t: any) => setTf({ vendor: t.vendor, term_type: t.term_type, term_month_offset: t.term_month_offset ?? 1, term_day: t.term_day ?? 20, term_days: t.term_days ?? 30, memo: t.memo || '' });
  const delTerm = async (id: number) => { if (!confirm('이 정산조건을 삭제할까요?')) return; await send(`/purchase/vendor-terms/${id}`, 'DELETE'); loadTerms(); loadAging(); };

  // 지급 입력 폼
  const [pf, setPf] = useState<any>({ vendor: '', pay_date: iso(new Date()), amount: '', method: '이체', memo: '' });
  const [pmsg, setPmsg] = useState<string | null>(null);
  const savePay = async () => {
    if (!pf.vendor || !pf.amount) { setPmsg('거래처·금액을 입력하세요.'); return; }
    const r = await send('/purchase/payments', 'POST', { ...pf, amount: Number(pf.amount) || 0 });
    if (r.ok) { setPmsg('지급 기록 저장'); setPf({ ...pf, amount: '', memo: '' }); loadPays(); loadAging(); }
    else setPmsg(r.data?.detail || '저장 실패');
  };
  const delPay = async (id: number) => { if (!confirm('이 지급 기록을 삭제할까요?')) return; await send(`/purchase/payments/${id}`, 'DELETE'); loadPays(); loadAging(); };

  const T = data?.totals || {};
  const vendorFetcher = (q: string) => getJSON<{ vendors: string[] }>(`/purchase/suggest/vendors?q=${encodeURIComponent(q)}&limit=30`, { vendors: [] }).then((r) => r.vendors);
  const vendors = (data?.vendors || []).filter((v: any) => !onlyBalance || v.balance > 0);
  const bo: string[] = data?.bucket_order || [];

  return (
    <div className="space-y-5">
      <LoadingOverlay show={loading} />
      <p className="text-xs text-text-quaternary">
        매입채무 = 구매일보 합계(VAT포함). 잔액 = 매입 − 지급(오래된 발주부터 상계). 만기일은 거래처 계약 정산조건으로 산출하며, 지난 만기는 연체로 집계합니다. 기준일 {data?.asof || '-'}.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-text-tertiary">미지급 집계 시작일</span>
        {[{ k: '전체', v: '' }, { k: '올해', v: `${new Date().getFullYear()}-01-01` }, { k: '최근3개월', v: iso(new Date(new Date().getFullYear(), new Date().getMonth() - 2, 1)) }, { k: '당월', v: iso(new Date(new Date().getFullYear(), new Date().getMonth(), 1)) }].map((p) => (
          <button key={p.k} onClick={() => setStart(p.v)} className={`${C.btn} ${start === p.v ? C.btnPrimary : C.btnGhost} text-xs py-1.5`}>{p.k}</button>
        ))}
        <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className={`${C.input} text-xs py-1.5`} />
        <span className="text-[11px] text-text-quaternary">이전 발주는 지급완료로 간주(지급기록 누적 전 임시 기준)</span>
      </div>

      {/* 총계 카드 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="총 매입(VAT포함)" value={won(T.payable || 0)} tone="text-text-primary" />
        <StatCard label="지급 완료" value={won(T.paid || 0)} tone="text-info" />
        <StatCard label="미지급 잔액" value={won(T.balance || 0)} tone="text-warning" sub="현재 갚아야 할 총액" />
        <StatCard label="연체 잔액" value={won(T.overdue || 0)} tone="text-danger" sub="계약 만기 경과분" />
      </div>

      {/* 버킷 바 */}
      {data?.bucket_totals && (
        <div className={`${C.card} p-4`}>
          <div className="text-sm font-semibold text-text-primary mb-3">만기(정산일) 기준 잔액 분포</div>
          <div className="h-[180px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={bo.map((b) => ({ bucket: b, amount: data.bucket_totals[b] || 0 }))} margin={{ top: 8, right: 8, left: 8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-primary)" vertical={false} />
                <XAxis dataKey="bucket" tick={{ fontSize: 11, fill: 'var(--color-text-tertiary)' }} />
                <YAxis tickFormatter={wonShort} tick={{ fontSize: 11, fill: 'var(--color-text-tertiary)' }} width={54} />
                <Tooltip contentStyle={TT} formatter={(v: any) => won(v)} />
                <Bar dataKey="amount" radius={[4, 4, 0, 0]}>
                  {bo.map((b, i) => <Cell key={i} fill={b === '미도래' ? '#00B8CC' : b === '당일' || b === '1~30일' ? '#F0BF00' : '#EB5757'} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {data?.unset_vendors?.length > 0 && (
        <div className="text-xs text-warning bg-warning/10 border border-warning/30 rounded-lg px-3 py-2">
          정산조건 미설정 거래처 {data.unset_vendors.length}곳(잔액 보유) — 아래에서 조건을 등록하면 만기·연체가 정확히 계산됩니다: {data.unset_vendors.slice(0, 8).join(', ')}{data.unset_vendors.length > 8 ? ' 외' : ''}
        </div>
      )}

      {/* 정산 우선순위 테이블 */}
      <div className={`${C.card} overflow-x-auto`}>
        <div className="px-4 pt-3 pb-2 flex items-center justify-between">
          <div className="text-sm font-semibold text-text-primary">거래처별 매입채무 · 정산 우선순위 (연체 → 만기임박 순)</div>
          <label className="text-xs text-text-tertiary flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={onlyBalance} onChange={(e) => setOnlyBalance(e.target.checked)} /> 잔액 있는 곳만</label>
        </div>
        <table className="w-full">
          <thead><tr>
            <th className={C.th}>순위</th><th className={C.th}>거래처</th><th className={C.th}>정산조건</th>
            <th className={`${C.th} text-right`}>매입</th><th className={`${C.th} text-right`}>지급</th>
            <th className={`${C.th} text-right`}>잔액</th><th className={`${C.th} text-right`}>연체</th>
            <th className={C.th}>최근만기</th><th className={C.th}></th>
          </tr></thead>
          <tbody>{!vendors.length ? <tr><td colSpan={9} className="p-6 text-center text-text-quaternary text-sm">데이터 없음</td></tr> : vendors.map((v: any) => (
            <Fragment key={v.vendor}>
              <tr className="hover:bg-bg-1 cursor-pointer" onClick={() => setExpanded(expanded === v.vendor ? null : v.vendor)}>
                <td className={`${C.td} tabular-nums`}>{v.priority}</td>
                <td className={`${C.td} text-text-primary font-medium max-w-[220px] truncate`} title={v.vendor}>{v.vendor}</td>
                <td className={C.td}>{v.term_label || <span className="text-warning">미설정</span>}</td>
                <td className={`${C.td} text-right tabular-nums`}>{won(v.payable)}</td>
                <td className={`${C.td} text-right tabular-nums text-info`}>{won(v.paid)}</td>
                <td className={`${C.td} text-right tabular-nums text-warning font-semibold`}>{won(v.balance)}</td>
                <td className={`${C.td} text-right tabular-nums ${v.overdue > 0 ? 'text-danger font-semibold' : 'text-text-quaternary'}`}>{v.overdue > 0 ? won(v.overdue) : '-'}</td>
                <td className={C.td}>{v.earliest_due || '-'}</td>
                <td className={`${C.td} text-accent text-xs`}>{expanded === v.vendor ? '접기' : '상세'}</td>
              </tr>
              {expanded === v.vendor && (
                <tr className="bg-bg-0">
                  <td colSpan={9} className="px-4 py-3">
                    <div className="flex flex-wrap gap-2 mb-3">
                      {Object.entries(v.buckets || {}).map(([b, amt]: any) => (
                        <span key={b} className={`text-xs px-2 py-1 rounded-md bg-bg-inset ${BUCKET_TONE[b] || ''}`}>{b}: {won(amt)}</span>
                      ))}
                    </div>
                    <div className="text-xs text-text-tertiary mb-1">미지급 발주 상세(최근 순, 만기일 기준)</div>
                    <table className="w-full">
                      <thead><tr><th className={C.th}>발주일</th><th className={`${C.th} text-right`}>미지급액</th><th className={C.th}>만기일</th><th className={C.th}>경과</th><th className={C.th}>구간</th></tr></thead>
                      <tbody>{(v.open_items || []).map((o: any, i: number) => (
                        <tr key={i}>
                          <td className={C.td}>{o.pdate}</td>
                          <td className={`${C.td} text-right tabular-nums`}>{won(o.amount)}</td>
                          <td className={C.td}>{o.due || '-'}</td>
                          <td className={`${C.td} tabular-nums ${o.days_overdue > 0 ? 'text-danger' : 'text-text-tertiary'}`}>{o.days_overdue == null ? '-' : o.days_overdue > 0 ? `+${o.days_overdue}일` : `${o.days_overdue}일`}</td>
                          <td className={`${C.td} ${BUCKET_TONE[o.bucket] || ''}`}>{o.bucket}</td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}</tbody>
        </table>
      </div>

      <div className="grid md:grid-cols-2 gap-5">
        {/* 정산조건 관리 */}
        <div className={`${C.card} p-4`}>
          <div className="text-sm font-semibold text-text-primary mb-3">거래처 정산조건 등록/수정</div>
          <div className="space-y-3">
            <div><div className="text-xs text-text-tertiary mb-1">거래처</div>
              <Combobox<string> value={tf.vendor} onChange={(v) => setTf({ ...tf, vendor: v })} fetcher={vendorFetcher} getLabel={(s) => s} render={(s) => <span className="text-text-primary">{s}</span>} placeholder="클릭 또는 키워드 입력" />
            </div>
            <div><div className="text-xs text-text-tertiary mb-1">정산 기준</div>
              <select value={tf.term_type} onChange={(e) => setTf({ ...tf, term_type: e.target.value })} className={`${C.input} w-full`}>{TERM_TYPES.map((t) => <option key={t.k} value={t.k}>{t.label}</option>)}</select>
            </div>
            {tf.term_type === 'DAYS_AFTER' ? (
              <div className="flex items-center gap-2"><span className="text-sm text-text-secondary">발주 후</span><input type="number" value={tf.term_days} onChange={(e) => setTf({ ...tf, term_days: e.target.value })} className={`${C.input} w-24`} /><span className="text-sm text-text-secondary">일</span></div>
            ) : (
              <div className="flex items-center gap-2 flex-wrap">
                <select value={tf.term_month_offset} onChange={(e) => setTf({ ...tf, term_month_offset: Number(e.target.value) })} className={`${C.input}`}>{OFFSETS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}</select>
                {tf.term_type === 'DAY_OF_MONTH' && <><input type="number" value={tf.term_day} onChange={(e) => setTf({ ...tf, term_day: e.target.value })} className={`${C.input} w-20`} min={1} max={31} /><span className="text-sm text-text-secondary">일</span></>}
                {tf.term_type === 'MONTH_END' && <span className="text-sm text-text-secondary">말일</span>}
              </div>
            )}
            <input value={tf.memo} onChange={(e) => setTf({ ...tf, memo: e.target.value })} placeholder="메모(선택)" className={`${C.input} w-full`} />
            <div className="flex items-center gap-3"><button onClick={saveTerm} className={`${C.btn} ${C.btnPrimary}`}>정산조건 저장</button>{tmsg && <span className="text-xs text-accent">{tmsg}</span>}</div>
          </div>
          <div className="mt-4 max-h-56 overflow-y-auto">
            <table className="w-full"><thead><tr><th className={C.th}>거래처</th><th className={C.th}>조건</th><th className={C.th}></th></tr></thead>
              <tbody>{!terms.length ? <tr><td colSpan={3} className="p-4 text-center text-text-quaternary text-xs">등록된 조건 없음</td></tr> : terms.map((t) => (
                <tr key={t.id} className="hover:bg-bg-1">
                  <td className={`${C.td} text-text-primary max-w-[160px] truncate`} title={t.vendor}>{t.vendor}</td>
                  <td className={C.td}>{t.label}</td>
                  <td className={`${C.td} text-right whitespace-nowrap`}><button onClick={() => editTerm(t)} className="text-accent text-xs hover:underline mr-2">수정</button><button onClick={() => delTerm(t.id)} className="text-danger text-xs hover:underline">삭제</button></td>
                </tr>
              ))}</tbody></table>
          </div>
        </div>

        {/* 지급 기록 */}
        <div className={`${C.card} p-4`}>
          <div className="text-sm font-semibold text-text-primary mb-3">거래처 지급(정산) 기록</div>
          <div className="space-y-3">
            <div><div className="text-xs text-text-tertiary mb-1">거래처</div>
              <Combobox<string> value={pf.vendor} onChange={(v) => setPf({ ...pf, vendor: v })} fetcher={vendorFetcher} getLabel={(s) => s} render={(s) => <span className="text-text-primary">{s}</span>} placeholder="클릭 또는 키워드 입력" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><div className="text-xs text-text-tertiary mb-1">지급일</div><input type="date" value={pf.pay_date} onChange={(e) => setPf({ ...pf, pay_date: e.target.value })} className={`${C.input} w-full`} /></div>
              <div><div className="text-xs text-text-tertiary mb-1">지급액(VAT포함)</div><input type="number" value={pf.amount} onChange={(e) => setPf({ ...pf, amount: e.target.value })} className={`${C.input} w-full`} /></div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><div className="text-xs text-text-tertiary mb-1">수단</div><select value={pf.method} onChange={(e) => setPf({ ...pf, method: e.target.value })} className={`${C.input} w-full`}><option>이체</option><option>어음</option><option>현금</option><option>카드</option></select></div>
              <div><div className="text-xs text-text-tertiary mb-1">메모</div><input value={pf.memo} onChange={(e) => setPf({ ...pf, memo: e.target.value })} className={`${C.input} w-full`} /></div>
            </div>
            <div className="flex items-center gap-3"><button onClick={savePay} className={`${C.btn} ${C.btnPrimary}`}>지급 기록 저장</button>{pmsg && <span className="text-xs text-accent">{pmsg}</span>}</div>
          </div>
          <div className="mt-4 max-h-56 overflow-y-auto">
            <table className="w-full"><thead><tr><th className={C.th}>지급일</th><th className={C.th}>거래처</th><th className={`${C.th} text-right`}>금액</th><th className={C.th}></th></tr></thead>
              <tbody>{!pays.length ? <tr><td colSpan={4} className="p-4 text-center text-text-quaternary text-xs">지급 기록 없음</td></tr> : pays.map((p) => (
                <tr key={p.id} className="hover:bg-bg-1">
                  <td className={C.td}>{p.pay_date}</td>
                  <td className={`${C.td} text-text-primary max-w-[140px] truncate`} title={p.vendor}>{p.vendor}</td>
                  <td className={`${C.td} text-right tabular-nums text-info`}>{won(p.amount)}</td>
                  <td className={`${C.td} text-right`}><button onClick={() => delPay(p.id)} className="text-danger text-xs hover:underline">삭제</button></td>
                </tr>
              ))}</tbody></table>
          </div>
        </div>
      </div>
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
        <PeriodBar value={range} onApply={setRange} />
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
