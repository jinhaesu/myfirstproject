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
// 세션 만료(401) 처리 — 조회는 auth-free지만 수정/입력/삭제는 토큰 필요.
// 토큰이 만료되면 재로그인 유도(백엔드 원문 "유효하지 않거나 만료된 토큰" 대신).
let _authExpiredHandled = false;
const onAuthExpired = () => {
  if (typeof window === 'undefined' || _authExpiredHandled) return;
  _authExpiredHandled = true;
  try { localStorage.removeItem('token'); localStorage.removeItem('user'); } catch {}
  alert('로그인 세션이 만료되었습니다. 다시 로그인해 주세요. (작업 내용은 저장되지 않았습니다)');
  window.location.href = '/login';
};
const getJSON = async <T,>(path: string, def: T): Promise<T> => { try { const r = await fetch(`/api${path}`, { headers: getAuthHeaders() }); if (r.status === 401) { onAuthExpired(); return def; } if (!r.ok) throw new Error(); return await r.json(); } catch { return def; } };
const send = async (path: string, method: string, body?: any) => { try { const r = await fetch(`/api${path}`, { method, headers: getAuthHeaders(), body: body !== undefined ? JSON.stringify(body) : undefined }); if (r.status === 401) { onAuthExpired(); return { ok: false, data: { detail: '세션이 만료되어 다시 로그인이 필요합니다' } }; } const data = await r.json().catch(() => ({})); return { ok: r.ok, data }; } catch { return { ok: false, data: {} }; } };

// 엑셀 다운로드 — 백엔드 /purchase/export(openpyxl xlsx)를 auth 헤더로 받아 저장
const downloadExcel = async (kind: string, params: Record<string, any> = {}) => {
  const q: Record<string, string> = { kind };
  for (const [k, v] of Object.entries(params)) { if (v !== undefined && v !== null && v !== '') q[k] = String(v); }
  const r = await fetch(`/api/purchase/export?${new URLSearchParams(q).toString()}`, { headers: getAuthHeaders() });
  if (!r.ok) { alert('엑셀 다운로드 실패'); return; }
  const blob = await r.blob();
  let name = `구매관리_${kind}.xlsx`;
  const cd = r.headers.get('Content-Disposition') || '';
  const mm = cd.match(/filename\*=UTF-8''([^;]+)/);
  if (mm) { try { name = decodeURIComponent(mm[1]); } catch {} }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
};
function XlsxBtn({ kind, params, label }: { kind: string; params?: Record<string, any>; label?: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button disabled={busy} onClick={async () => { setBusy(true); try { await downloadExcel(kind, params || {}); } finally { setBusy(false); } }}
      className="px-3 py-2 rounded-lg text-sm font-semibold bg-success/10 text-success border border-success/30 hover:bg-success/20 whitespace-nowrap disabled:opacity-50">
      {busy ? '생성 중…' : (label || '⬇ 엑셀')}
    </button>
  );
}

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
// 담당팀 필터 — 전체/구매팀/물류팀
function TeamFilter({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex rounded-lg overflow-hidden border border-border-primary">
      {[{ k: '', l: '전체팀' }, { k: '구매팀', l: '구매팀' }, { k: '물류팀', l: '물류팀' }].map((t) => (
        <button key={t.k} onClick={() => onChange(t.k)} className={`px-2.5 py-2 text-xs font-semibold ${value === t.k ? (t.k === '물류팀' ? 'bg-info text-white' : 'bg-brand text-white') : 'bg-bg-inset text-text-tertiary'}`}>{t.l}</button>
      ))}
    </div>
  );
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

type Tab = '실적 대시보드' | '실적 조회' | '실적 입력' | '단가 추이' | '매입채무' | '자산형 재고' | 'BOM 매핑' | '원부재료 소요' | '거래처' | '발주';

export default function PurchasePage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('실적 대시보드');
  useEffect(() => { if (!isLoading && !user) router.replace('/login'); }, [isLoading, user, router]);
  if (isLoading || !user) return <div className="min-h-screen bg-bg-0" />;
  const tabs: Tab[] = ['실적 대시보드', '실적 조회', '실적 입력', '단가 추이', '매입채무', '자산형 재고', 'BOM 매핑', '원부재료 소요', '거래처', '발주'];
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
        {tab === '자산형 재고' && <AssetTab />}
        {tab === 'BOM 매핑' && <BomMapTab />}
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
  const [dr, setDr] = useState({ ...thisMonth(), vendor: '', mclass: '', q: '', team: '' });
  const [ap, setAp] = useState({ ...thisMonth(), vendor: '', mclass: '', q: '', team: '' });
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [d, setD] = useState<any>(null);
  const [ratio, setRatio] = useState<any>(null);
  const [heat, setHeat] = useState<any>(null);
  const [gapT, setGapT] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const P = presets();
  const applyDraft = () => setAp(dr);
  const applyPreset = (v: { start: string; end: string }) => { const nx = { ...dr, ...v }; setDr(nx); setAp(nx); };
  const qs = () => { const p = new URLSearchParams({ start: ap.start, end: ap.end }); if (ap.vendor) p.set('vendor', ap.vendor); if (ap.mclass) p.set('mclass', ap.mclass); if (ap.q) p.set('q', ap.q); if (ap.team) p.set('team', ap.team); return p.toString(); };
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
        <TeamFilter value={ap.team} onChange={(v) => { setDr({ ...dr, team: v }); setAp({ ...ap, team: v }); }} />
        <button onClick={applyDraft} className={`${C.btn} ${C.btnPrimary} ${dirty ? 'ring-2 ring-brand/50' : ''}`}>조회</button>
        <div className="flex gap-1 ml-auto"><span className="text-xs text-text-quaternary self-center mr-1">추이 단위</span>{(['day', 'week', 'month'] as const).map((g) => <button key={g} onClick={() => setGran(g)} className={`${C.btn} ${gran === g ? C.btnPrimary : C.btnGhost}`}>{g === 'day' ? '일' : g === 'week' ? '주' : '월'}</button>)}</div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select value={dr.vendor} onChange={(e) => setDr({ ...dr, vendor: e.target.value })} className={C.input}><option value="">전체 거래처</option>{vendors.map((v) => <option key={v.id} value={v.name}>{v.name}</option>)}</select>
        <select value={dr.mclass} onChange={(e) => setDr({ ...dr, mclass: e.target.value })} className={C.input}><option value="">전체 구분</option><option>원재료</option><option>부재료</option></select>
        <input value={dr.q} onChange={(e) => setDr({ ...dr, q: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') applyDraft(); }} placeholder="품목명 검색" className={`${C.input} w-40`} />
        {(dr.vendor || dr.mclass || dr.q) && <button onClick={() => { const nx = { ...dr, vendor: '', mclass: '', q: '' }; setDr(nx); setAp(nx); }} className={`${C.btn} ${C.btnGhost}`}>필터 해제</button>}
        {dirty && <span className="text-xs text-warning">변경됨 — 조회를 누르세요</span>}
        <div className="ml-auto flex gap-1.5">
          <XlsxBtn kind="dashboard" label="⬇ 대시보드 엑셀" params={{ start: ap.start, end: ap.end, vendor: ap.vendor || undefined, mclass: ap.mclass || undefined, q: ap.q || undefined, team: ap.team || undefined }} />
          <XlsxBtn kind="all" label="⬇ 구매관리 전체" params={{ start: ap.start, end: ap.end, team: ap.team || undefined, year: Number(ap.start.slice(0, 4)) }} />
        </div>
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

      <MonthlyMatrix defaultYear={Number((ap.start || '').slice(0, 4)) || new Date().getFullYear()} team={ap.team} />
    </div>
  );
}
function Empty() { return <div className="h-[200px] flex items-center justify-center text-sm text-text-quaternary">데이터 없음</div>; }

// 연도별 월별(1~12월) × 거래처(또는 원부재료) 구매 합계 매트릭스 — 설정 기간과 무관
function MonthlyMatrix({ defaultYear, team }: { defaultYear: number; team: string }) {
  const [year, setYear] = useState(defaultYear);
  const [by, setBy] = useState<'vendor' | 'material'>('vendor');
  const [d, setD] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => { setYear(defaultYear); }, [defaultYear]);
  useEffect(() => {
    setLoading(true);
    const p = new URLSearchParams({ year: String(year), by });
    if (team) p.set('team', team);
    getJSON<any>(`/purchase/records/monthly-matrix?${p.toString()}`, null).then((r) => { setD(r); setLoading(false); });
  }, [year, by, team]);
  const nowY = new Date().getFullYear();
  const years = [nowY, nowY - 1, nowY - 2];
  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  const rows: any[] = d?.rows || [];
  return (
    <div className={`${C.card} p-4`}>
      <div className="flex flex-wrap items-center gap-2 mb-1">
        <div className="text-sm font-semibold text-text-primary">연도별 월별 구매 합계 매트릭스</div>
        <div className="flex rounded-lg overflow-hidden border border-border-primary ml-2">
          {years.map((y) => <button key={y} onClick={() => setYear(y)} className={`px-2.5 py-1.5 text-xs font-semibold ${year === y ? 'bg-brand text-white' : 'bg-bg-inset text-text-tertiary'}`}>{y}년</button>)}
        </div>
        <div className="flex rounded-lg overflow-hidden border border-border-primary">
          {([['vendor', '거래처별'], ['material', '원부재료별']] as const).map(([k, l]) => <button key={k} onClick={() => setBy(k)} className={`px-2.5 py-1.5 text-xs font-semibold ${by === k ? 'bg-info text-white' : 'bg-bg-inset text-text-tertiary'}`}>{l}</button>)}
        </div>
        {team && <span className="text-xs text-info">· {team}</span>}
        <div className="ml-auto"><XlsxBtn kind="monthly" params={{ year, by, team: team || undefined }} /></div>
      </div>
      <p className="text-xs text-text-quaternary mb-3">위 조회기간과 무관하게 <b>{year}년 1~12월</b> {by === 'vendor' ? '거래처' : '원부재료'}별 구매 공급가(VAT별도)입니다. 행·열·총계 포함, 상위 금액순.</p>
      <div className="relative overflow-x-auto">
        <LoadingOverlay show={loading} />
        <table className="w-full text-xs">
          <thead><tr>
            <th className="sticky left-0 bg-bg-1 text-left font-semibold text-text-tertiary px-2 py-2 border-b border-border-primary whitespace-nowrap z-10">{by === 'vendor' ? '거래처' : '원부재료'}</th>
            {months.map((m) => <th key={m} className="text-right font-semibold text-text-tertiary px-2 py-2 border-b border-border-primary whitespace-nowrap">{m}월</th>)}
            <th className="text-right font-semibold text-text-primary px-2 py-2 border-b border-border-primary whitespace-nowrap">합계</th>
          </tr></thead>
          <tbody>
            {!rows.length ? <tr><td colSpan={14} className="p-6 text-center text-text-quaternary">데이터 없음</td></tr> : rows.map((r, i) => (
              <tr key={i} className="hover:bg-bg-1">
                <td className="sticky left-0 bg-bg-1 text-text-primary px-2 py-1.5 border-b border-bg-inset max-w-[200px] truncate whitespace-nowrap z-10" title={r.label}>{r.label}{r.code ? <span className="text-text-quaternary"> · {r.code}</span> : ''}</td>
                {r.months.map((v: number, mi: number) => <td key={mi} className={`text-right tabular-nums px-2 py-1.5 border-b border-bg-inset ${v ? 'text-text-secondary' : 'text-text-quaternary'}`}>{v ? wonShort(v) : '·'}</td>)}
                <td className="text-right tabular-nums px-2 py-1.5 border-b border-bg-inset text-warning font-semibold">{won(r.total)}</td>
              </tr>
            ))}
          </tbody>
          {rows.length > 0 && d && (
            <tfoot><tr className="bg-bg-inset font-semibold sticky bottom-0">
              <td className="sticky left-0 bg-bg-inset text-text-primary px-2 py-2 whitespace-nowrap z-10">합계 · {fmt(d.row_count)}{by === 'vendor' ? '개 거래처' : '개 품목'}</td>
              {d.month_totals.map((v: number, mi: number) => <td key={mi} className="text-right tabular-nums px-2 py-2 text-text-primary">{v ? wonShort(v) : '·'}</td>)}
              <td className="text-right tabular-nums px-2 py-2 text-warning">{won(d.grand_total)}</td>
            </tr></tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// 실적 조회
// ─────────────────────────────────────────────
function RecordsTab() {
  const [range, setRange] = useState(thisMonth());
  const [mclass, setMclass] = useState('');
  const [q, setQ] = useState('');
  const [data, setData] = useState<any>(null);
  const [hist, setHist] = useState<any>(null);
  const [unit, setUnit] = useState<'ea' | 'kg'>('ea');   // 수량 표시 단위
  const [team, setTeam] = useState('');
  const load = useCallback(async () => {
    const p = new URLSearchParams({ start: range.start, end: range.end, limit: '500' });
    if (mclass) p.set('mclass', mclass);
    if (q) p.set('q', q);
    if (team) p.set('team', team);
    setData(await getJSON<any>(`/purchase/records?${p.toString()}`, null));
  }, [range, mclass, q, team]);
  useEffect(() => { load(); }, [load]);
  const openVendor = async (v: string) => setHist({ type: 'vendor', ...(await getJSON<any>(`/purchase/records/vendor-history?vendor=${encodeURIComponent(v)}`, {})) });
  const openItem = async (code: string, name: string) => setHist({ type: 'item', ...(await getJSON<any>(`/purchase/records/item-history?item_code=${encodeURIComponent(code || '')}&item_name=${encodeURIComponent(name || '')}`, {})) });
  const [sel, setSel] = useState<Set<number>>(new Set());
  const toggleSel = (id: number) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const applySettle = async (paid: boolean) => {
    const ids = Array.from(sel);
    if (!ids.length) return;
    setData((d: any) => ({ ...d, rows: d.rows.map((x: any) => (sel.has(x.id) ? { ...x, paid, paid_date: paid ? new Date().toISOString().slice(0, 10) : null } : x)) }));
    setSel(new Set());
    await send('/purchase/records/settle', 'POST', { ids, paid });
  };
  const rows: any[] = data?.rows || [];
  const allSel = rows.length > 0 && rows.every((r) => sel.has(r.id));
  const toggleAll = () => setSel(allSel ? new Set() : new Set(rows.map((r) => r.id)));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <PeriodBar value={range} onApply={setRange} />
        <TeamFilter value={team} onChange={setTeam} />
        <select value={mclass} onChange={(e) => setMclass(e.target.value)} className={C.input}><option value="">전체 구분</option><option>원재료</option><option>부재료</option></select>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="품목·거래처 검색" className={`${C.input} w-48`} />
        <div className="flex rounded-lg overflow-hidden border border-border-primary">
          {(['ea', 'kg'] as const).map((u) => <button key={u} onClick={() => setUnit(u)} className={`px-2.5 py-2 text-xs font-semibold ${unit === u ? 'bg-brand text-white' : 'bg-bg-inset text-text-tertiary'}`}>{u === 'ea' ? '수량(ea)' : '중량(kg)'}</button>)}
        </div>
        <XlsxBtn kind="records" params={{ start: range.start, end: range.end, mclass: mclass || undefined, q: q || undefined, team: team || undefined }} />
        {data && <span className="text-xs text-text-tertiary ml-auto">{fmt(data.total)}건 · 공급가 {won(data.supply_total)} · 미지급 {won(data.unpaid_total || 0)}{data.total > 500 && ' (500건 표시)'}</span>}
      </div>
      {/* 정산완료 처리 툴바 — 체크박스로 행 선택 후 버튼 클릭 */}
      <div className="flex flex-wrap items-center gap-2 bg-bg-1 border border-border-primary rounded-lg px-3 py-2">
        <span className="text-xs text-text-tertiary">체크박스로 전표 선택 후 →</span>
        <button onClick={() => applySettle(true)} disabled={!sel.size} className={`${C.btn} ${sel.size ? C.btnPrimary : C.btnGhost} text-xs py-1.5`}>✓ 정산완료 처리{sel.size ? ` (${sel.size}건)` : ''}</button>
        <button onClick={() => applySettle(false)} disabled={!sel.size} className={`${C.btn} ${C.btnGhost} text-xs py-1.5`}>정산 해제</button>
        {!!sel.size && <button onClick={() => setSel(new Set())} className="text-xs text-text-quaternary hover:underline">선택 해제</button>}
      </div>
      <div className={`${C.card} overflow-x-auto`}>
        <table className="w-full"><thead><tr>
          <th className={`${C.th} text-center`} title="전체 선택"><input type="checkbox" checked={allSel} onChange={toggleAll} /></th>
          <th className={C.th}>일자</th><th className={C.th}>거래처</th><th className={C.th}>구분</th><th className={C.th}>품목</th><th className={C.th}>규격</th>
          <th className={`${C.th} text-right`}>{unit === 'ea' ? '수량' : '중량(kg)'}</th><th className={`${C.th} text-right`}>{unit === 'ea' ? '단가' : 'kg당'}</th>
          <th className={`${C.th} text-right`}>공급가</th><th className={`${C.th} text-right`}>합계</th><th className={`${C.th} text-center`}>정산</th>
        </tr></thead>
          <tbody>{!rows.length ? <tr><td colSpan={11} className="p-6 text-center text-text-quaternary text-sm">데이터 없음</td></tr> : rows.map((r: any) => (
            <tr key={r.id} className={`hover:bg-bg-1 ${sel.has(r.id) ? 'bg-brand/10' : ''}`}>
              <td className={`${C.td} text-center`}><input type="checkbox" checked={sel.has(r.id)} onChange={() => toggleSel(r.id)} /></td>
              <td className={C.td}>{r.pdate}</td>
              <td className={`${C.td} text-text-primary`}><button onClick={() => openVendor(r.vendor)} className="hover:text-accent hover:underline text-left">{r.vendor}</button></td>
              <td className={C.td}><span className={r.mclass === '원재료' ? 'text-info' : 'text-warning'}>{r.mclass}</span></td>
              <td className={`${C.td} max-w-[240px] truncate`} title={r.item_name}><button onClick={() => openItem(r.item_code, r.item_name)} className="hover:text-accent hover:underline text-left">{r.item_name_short || r.item_name}</button></td>
              <td className={`${C.td} text-text-tertiary text-xs`}>{r.spec || '-'}</td>
              <td className={`${C.td} text-right tabular-nums`}>{unit === 'kg' ? (r.kg != null ? fmt(r.kg) + 'kg' : '-') : fmt(r.qty) + (r.unit || '')}</td>
              <td className={`${C.td} text-right tabular-nums`}>{unit === 'kg' ? (r.price_per_kg != null ? won(r.price_per_kg) : '-') : won(r.unit_price)}</td>
              <td className={`${C.td} text-right text-warning tabular-nums`}>{won(r.supply)}</td>
              <td className={`${C.td} text-right tabular-nums`}>{won(r.total)}</td>
              <td className={`${C.td} text-center`}>{r.paid ? <span className="text-success-light text-xs" title={r.paid_date || ''}>✓ 완료</span> : <span className="text-text-quaternary text-xs">미지급</span>}</td>
            </tr>
          ))}</tbody>
          {rows.length > 0 && (
            <tfoot><tr className="bg-bg-inset font-semibold sticky bottom-0">
              <td className={C.td}></td>
              <td className={`${C.td} text-text-primary`} colSpan={5}>합계 · {fmt(data.total)}건{data.total > (data.limit || 500) ? ` (전체 기간 기준, 표는 ${fmt(data.limit || 500)}건 표시)` : ''} · 미지급 {won(data.unpaid_total || 0)}</td>
              <td className={`${C.td} text-right text-text-primary`} title="단위 혼재 단순합">{unit === 'kg' ? fmt(data.kg_total || 0) + 'kg' : fmt(data.qty_total || 0)}</td>
              <td className={`${C.td} text-right text-text-tertiary`}>VAT {wonShort(data.vat_total || 0)}</td>
              <td className={`${C.td} text-right text-warning`}>{won(data.supply_total || 0)}</td>
              <td className={`${C.td} text-right text-text-primary`}>{won(data.total_total || 0)}</td>
              <td className={C.td}></td>
            </tr></tfoot>
          )}
        </table>
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
// 실적 입력 — 한 거래처 여러 품목 동시 입력 + ea/kg 단위 + 즉석 품목등록
// ─────────────────────────────────────────────
// 품목명/규격에서 ea당 kg 추출 (백엔드 parse_spec과 동일 규칙)
function parseSpecJS(name: string): { spec: string | null; kg: number | null } {
  const specs = Array.from(String(name || '').matchAll(/\[([^\]]+)\]/g)).map((m) => m[1]);
  if (!specs.length) return { spec: null, kg: null };
  const spec = specs[specs.length - 1].trim();
  const mm = spec.match(/(\d+(?:\.\d+)?)\s*(kg|g)\s*\*\s*(\d+)\s*ea/i);
  if (mm) { let w = parseFloat(mm[1]); if (mm[2].toLowerCase() === 'g') w /= 1000; const kg = w * parseInt(mm[3]); return { spec, kg: kg > 0 ? kg : null }; }
  const m = spec.match(/(\d+(?:\.\d+)?)\s*(kg|g)\b/i);
  if (!m) return { spec, kg: null };
  let v = parseFloat(m[1]); if (m[2].toLowerCase() === 'g') v /= 1000;
  return { spec, kg: v > 0 ? v : null };
}
const specToKg = (specText: string): number => parseSpecJS(`[${specText}]`).kg || 0;
const emptyLine = () => ({ mclass: '원재료', item_code: '', item_name: '', spec: '', boxKg: 0, unit: 'ea' as 'ea' | 'kg', qty: '', unit_price: '', vat_mode: 'auto' as 'auto' | 'zero', note: '' });
const itemFetcher = (q: string) => getJSON<{ items: any[] }>(`/purchase/suggest/items?q=${encodeURIComponent(q)}&limit=30`, { items: [] }).then((r) => r.items);
const vendorFetcherTop = (q: string) => getJSON<{ vendors: string[] }>(`/purchase/suggest/vendors?q=${encodeURIComponent(q)}&limit=30`, { vendors: [] }).then((r) => r.vendors);

function InputTab() {
  const [common, setCommon] = useState<any>({ pdate: iso(new Date()), seq: 0, warehouse: '공장_조인앤조인(F3)', staff: '', vendor: '', team: '구매팀' });
  const [lines, setLines] = useState<any[]>([emptyLine()]);
  const [recent, setRecent] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [edit, setEdit] = useState<any>(null);
  const [rq, setRq] = useState('');        // 최근 실적 검색어(품목·거래처)
  const [rqApplied, setRqApplied] = useState('');
  const loadRecent = useCallback(async () => {
    const p = new URLSearchParams({ limit: rqApplied ? '300' : '60' });
    if (rqApplied) p.set('q', rqApplied);
    setRecent((await getJSON<any>(`/purchase/records?${p.toString()}`, { rows: [] })).rows);
  }, [rqApplied]);
  useEffect(() => { loadRecent(); }, [loadRecent]);

  const setLine = (i: number, patch: any) => setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const addLine = () => setLines((ls) => [...ls, emptyLine()]);
  const rmLine = (i: number) => setLines((ls) => (ls.length > 1 ? ls.filter((_, idx) => idx !== i) : ls));

  const pickItem = (i: number, it: any) => {
    const p = parseSpecJS(it.item_name);
    setLine(i, { item_name: it.item_name, item_code: it.item_code || '', spec: it.spec || p.spec || '', boxKg: it.kg_per_unit || p.kg || 0, mclass: it.mclass || '원재료', unit_price: it.last_price ? String(Math.round(it.last_price)) : '', unit: 'ea' });
  };
  const onNameText = (i: number, v: string) => { const p = parseSpecJS(v); setLine(i, { item_name: v, spec: p.spec || lines[i].spec, boxKg: p.kg || lines[i].boxKg }); };
  const onSpecText = (i: number, v: string) => setLine(i, { spec: v, boxKg: specToKg(v) });

  const toggleUnit = (i: number) => {
    const l = lines[i];
    if (!l.boxKg) { setMsg('kg 환산정보(규격 [Nkg])가 없어 kg 입력 불가 — 규격을 입력하면 활성화됩니다'); return; }
    const to = l.unit === 'ea' ? 'kg' : 'ea';
    const q = Number(l.qty) || 0, up = Number(l.unit_price) || 0;
    const nq = to === 'kg' ? q * l.boxKg : q / l.boxKg;
    const nup = to === 'kg' ? up / l.boxKg : up * l.boxKg;
    setLine(i, { unit: to, qty: q ? String(+nq.toFixed(3)) : '', unit_price: up ? String(Math.round(nup)) : '' });
  };

  const lineSupply = (l: any) => Math.round((Number(l.qty) || 0) * (Number(l.unit_price) || 0));
  const totalSupply = lines.reduce((s, l) => s + lineSupply(l), 0);

  const save = async () => {
    if (!common.vendor) { setMsg('거래처를 입력하세요'); return; }
    const valid = lines.filter((l) => (l.item_name || l.item_code) && Number(l.qty) > 0);
    if (!valid.length) { setMsg('품목·수량이 입력된 라인이 없습니다'); return; }
    setSaving(true); setMsg(null);
    const body = {
      ...common, seq: Number(common.seq) || 0,
      lines: valid.map((l) => {
        const supply = lineSupply(l);
        const vat = l.vat_mode === 'zero' ? 0 : Math.round(supply * 0.1);
        return { mclass: l.mclass, item_code: l.item_code, item_name: l.item_name, spec: l.spec || null, unit: l.unit, qty: Number(l.qty) || 0, unit_price: Number(l.unit_price) || 0, kg_per_unit: l.unit === 'kg' ? 1 : (l.boxKg || null), vat, note: l.note || null };
      }),
    };
    const r = await send('/purchase/records/manual-batch', 'POST', body);
    setSaving(false);
    if (r.ok) { setMsg(`저장 완료 · ${r.data.saved}건${r.data.failed ? ` (실패 ${r.data.failed})` : ''}`); setLines([emptyLine()]); loadRecent(); }
    else setMsg(r.data?.detail || '저장 실패');
  };
  const del = async (id: number) => { if (!confirm('이 입력 건을 삭제할까요?')) return; const r = await send(`/purchase/records/${id}`, 'DELETE'); if (r.ok) loadRecent(); };
  const L = ({ children }: { children: any }) => <div className="text-xs text-text-tertiary mb-1">{children}</div>;

  return (
    <div className="space-y-4">
      <div className={`${C.card} p-4`}>
        <div className="text-sm font-semibold text-text-primary mb-1">구매 실적 직접 입력 (다중 품목)</div>
        <p className="text-xs text-text-quaternary mb-4">한 거래처에 여러 품목을 한 번에 등록합니다. 품목명을 검색해 선택하면 코드·규격·최근단가가 자동 채워집니다. <b className="text-info">목록에 없는 신규 품목</b>은 이름을 그대로 입력하고 <b>코드·규격</b>을 채우면 저장 시 등록됩니다(별도 화면 불필요). 규격 [20kg] 등이 있으면 ea↔kg 전환·자동환산.</p>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-4">
          <div><L>담당팀</L><select value={common.team} onChange={(e) => setCommon({ ...common, team: e.target.value })} className={`${C.input} w-full ${common.team === '물류팀' ? 'text-info font-semibold' : ''}`}><option>구매팀</option><option>물류팀</option></select></div>
          <div><L>구매일자</L><input type="date" value={common.pdate} onChange={(e) => setCommon({ ...common, pdate: e.target.value })} className={`${C.input} w-full`} /></div>
          <div><L>거래처</L><Combobox<string> value={common.vendor} onChange={(v) => setCommon({ ...common, vendor: v })} fetcher={vendorFetcherTop} getLabel={(s) => s} render={(s) => <span className="text-text-primary">{s}</span>} placeholder="클릭 또는 키워드" /></div>
          <div><L>창고</L><input value={common.warehouse} onChange={(e) => setCommon({ ...common, warehouse: e.target.value })} className={`${C.input} w-full`} /></div>
          <div><L>담당자</L><input value={common.staff} onChange={(e) => setCommon({ ...common, staff: e.target.value })} placeholder="예: 이종현" className={`${C.input} w-full`} /></div>
          <div><L>전표 No.</L><input type="number" value={common.seq} onChange={(e) => setCommon({ ...common, seq: e.target.value })} className={`${C.input} w-full`} /></div>
        </div>
        <div className="space-y-2">
          {lines.map((l, i) => {
            const isNew = !!(l.item_name && !l.item_code);
            return (
              <div key={i} className="flex flex-wrap items-end gap-2 p-2 rounded-lg border border-border-primary bg-bg-0">
                <div className="w-24"><L>구분</L><select value={l.mclass} onChange={(e) => setLine(i, { mclass: e.target.value })} className={`${C.input} py-1.5 w-full`}><option>원재료</option><option>부재료</option></select></div>
                <div className="flex-1 min-w-[220px]"><L>품목명 {isNew && <span className="text-info">· 신규</span>}</L>
                  <Combobox<any> value={l.item_name} onChange={(v) => onNameText(i, v)} onPick={(it) => pickItem(i, it)} fetcher={itemFetcher} getLabel={(it) => it.item_name}
                    render={(it) => <div className="flex items-center justify-between gap-2"><span className="text-text-primary truncate">{it.item_name_short || it.item_name}</span><span className="text-[11px] text-text-quaternary whitespace-nowrap shrink-0">{it.item_code || ''} · {it.spec || ''} · {won(it.last_price)}</span></div>}
                    placeholder="검색 또는 신규 입력" /></div>
                <div className="w-28"><L>품목코드</L><input value={l.item_code} onChange={(e) => setLine(i, { item_code: e.target.value })} placeholder="신규 시 입력" className={`${C.input} py-1.5 w-full ${isNew ? 'border-info/50' : ''}`} /></div>
                <div className="w-20"><L>규격</L><input value={l.spec} onChange={(e) => onSpecText(i, e.target.value)} placeholder="20kg" className={`${C.input} py-1.5 w-full`} title={l.boxKg ? `ea당 ${l.boxKg}kg` : 'kg 환산 없음'} /></div>
                <div><L>단위</L><button type="button" onClick={() => toggleUnit(i)} className={`${C.btn} py-1.5 w-14 ${l.unit === 'kg' ? 'bg-info/20 text-info' : C.btnGhost}`} title="ea↔kg 전환(규격 필요)">{l.unit} ⇄</button></div>
                <div className="w-24"><L>수량</L><input type="number" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} className={`${C.input} py-1.5 w-full text-right`} /></div>
                <div className="w-28"><L>단가</L><input type="number" value={l.unit_price} onChange={(e) => setLine(i, { unit_price: e.target.value })} className={`${C.input} py-1.5 w-full text-right`} /></div>
                <div className="w-28 text-right"><L>공급가</L><div className="text-warning tabular-nums text-sm py-1.5">{won(lineSupply(l))}</div></div>
                <div className="w-20"><L>VAT</L><select value={l.vat_mode} onChange={(e) => setLine(i, { vat_mode: e.target.value })} className={`${C.input} py-1.5 w-full`}><option value="auto">10%</option><option value="zero">면세</option></select></div>
                <div className="w-36"><L>비고</L><input value={l.note} onChange={(e) => setLine(i, { note: e.target.value })} placeholder="적요·메모" className={`${C.input} py-1.5 w-full`} /></div>
                <div>{lines.length > 1 && <button onClick={() => rmLine(i)} className="text-danger text-xs hover:underline py-2">삭제</button>}</div>
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-3 mt-3 flex-wrap">
          <button onClick={addLine} className={`${C.btn} ${C.btnGhost}`}>+ 품목 추가</button>
          <span className="text-sm text-text-tertiary ml-auto">총 공급가 <b className="text-warning tabular-nums">{won(totalSupply)}</b> · {lines.filter((l) => (l.item_name || l.item_code) && Number(l.qty) > 0).length}품목</span>
          <button onClick={save} disabled={saving} className={`${C.btn} ${C.btnPrimary}`}>{saving ? '저장 중…' : '실적 저장'}</button>
        </div>
        {msg && <div className="mt-2 text-xs text-accent">{msg}</div>}
      </div>

      <div className={`${C.card} overflow-x-auto`}>
        <div className="flex flex-wrap items-center gap-2 px-4 pt-3">
          <div className="text-sm font-semibold text-text-primary">최근 실적 {rqApplied ? <span className="text-accent">· "{rqApplied}" 검색 {recent.length}건</span> : `(최근 ${recent.length}건 · 전체)`}</div>
          <div className="flex items-center gap-1 ml-auto">
            <input value={rq} onChange={(e) => setRq(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') setRqApplied(rq.trim()); }} placeholder="과거 내역 검색(품목·거래처)" className={`${C.input} w-56`} />
            <button onClick={() => setRqApplied(rq.trim())} className={`${C.btn} ${C.btnPrimary}`}>검색</button>
            {rqApplied && <button onClick={() => { setRq(''); setRqApplied(''); }} className={`${C.btn} ${C.btnGhost}`}>해제</button>}
            <XlsxBtn kind="records" params={{ q: rqApplied || undefined }} />
          </div>
        </div>
        <p className="px-4 pt-1 text-xs text-text-quaternary">과거에 잘못 입력한 건은 검색해서 우측 <b>수정</b> 버튼으로 바로잡을 수 있습니다.</p>
        <table className="w-full mt-2"><thead><tr><th className={C.th}>일자</th><th className={C.th}>거래처</th><th className={C.th}>구분</th><th className={C.th}>품목</th><th className={C.th}>규격</th><th className={`${C.th} text-right`}>수량</th><th className={`${C.th} text-right`}>단가</th><th className={`${C.th} text-right`}>공급가</th><th className={C.th}>비고</th><th className={C.th}>입력자</th><th className={C.th}></th></tr></thead>
          <tbody>{!recent.length ? <tr><td colSpan={11} className="p-6 text-center text-text-quaternary text-sm">{rqApplied ? '검색 결과가 없습니다.' : '실적이 없습니다.'}</td></tr> : recent.map((r) => (
            <tr key={r.id} className="hover:bg-bg-1">
              <td className={C.td}>{r.pdate}{r.seq ? `-${r.seq}` : ''}</td>
              <td className={`${C.td} text-text-primary`}>{r.vendor}</td>
              <td className={C.td}><span className={r.mclass === '원재료' ? 'text-info' : 'text-warning'}>{r.mclass}</span></td>
              <td className={`${C.td} max-w-[220px] truncate`} title={r.item_name}>{r.item_name_short || r.item_name}</td>
              <td className={`${C.td} text-text-tertiary text-xs`}>{r.spec || '-'}</td>
              <td className={`${C.td} text-right`}>{fmt(r.qty)}{r.unit}{r.kg != null ? ` (${fmt(r.kg)}kg)` : ''}</td>
              <td className={`${C.td} text-right`}>{won(r.unit_price)}</td><td className={`${C.td} text-right text-warning`}>{won(r.supply)}</td>
              <td className={`${C.td} max-w-[160px] truncate text-text-tertiary text-xs`} title={r.note || ''}>{r.note || '-'}</td>
              <td className={C.td}>{r.created_by || '-'}</td>
              <td className={`${C.td} whitespace-nowrap`}><button onClick={() => setEdit(r)} className="text-accent text-xs hover:underline mr-2">수정</button><button onClick={() => del(r.id)} className="text-danger text-xs hover:underline">삭제</button></td>
            </tr>
          ))}</tbody></table>
      </div>
      {edit && <RecordEditModal rec={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); loadRecent(); }} />}
    </div>
  );
}

function RecordEditModal({ rec, onClose, onSaved }: { rec: any; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<any>({
    pdate: rec.pdate, vendor: rec.vendor || '', mclass: rec.mclass || '원재료',
    item_name: rec.item_name || '', spec: rec.spec || '', unit: rec.unit || 'ea',
    qty: rec.qty ?? '', unit_price: rec.unit_price ?? '', vat: rec.vat ?? '', note: rec.note || '',
  });
  const [msg, setMsg] = useState<string | null>(null);
  const supply = Math.round((Number(f.qty) || 0) * (Number(f.unit_price) || 0));
  const save = async () => {
    const body: any = { pdate: f.pdate, vendor: f.vendor, mclass: f.mclass, item_name: f.item_name, spec: f.spec || null, unit: f.unit, qty: Number(f.qty) || 0, unit_price: Number(f.unit_price) || 0, note: f.note || '', recompute: true };
    if (f.vat !== '' && f.vat != null) body.vat = Number(f.vat);
    const r = await send(`/purchase/records/${rec.id}`, 'PATCH', body);
    if (r.ok) onSaved(); else setMsg(r.data?.detail || '저장 실패');
  };
  const L = ({ children }: { children: any }) => <div className="text-xs text-text-tertiary mb-1">{children}</div>;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div className="relative bg-bg-1 border border-border-primary rounded-2xl w-full max-w-lg p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4"><div className="text-lg font-bold text-text-primary">실적 수정 (#{rec.id})</div><button onClick={onClose} className="text-text-tertiary hover:text-text-primary text-xl">×</button></div>
        <div className="grid grid-cols-2 gap-3">
          <div><L>구매일자</L><input type="date" value={f.pdate} onChange={(e) => setF({ ...f, pdate: e.target.value })} className={`${C.input} w-full`} /></div>
          <div><L>거래처</L><Combobox<string> value={f.vendor} onChange={(v) => setF({ ...f, vendor: v })} fetcher={vendorFetcherTop} getLabel={(s) => s} render={(s) => <span className="text-text-primary">{s}</span>} /></div>
          <div className="col-span-2"><L>품목명</L><Combobox<any> value={f.item_name} onChange={(v) => setF({ ...f, item_name: v, ...(parseSpecJS(v).spec ? { spec: parseSpecJS(v).spec } : {}) })} onPick={(it) => setF({ ...f, item_name: it.item_name, spec: it.spec || parseSpecJS(it.item_name).spec || f.spec, mclass: it.mclass || f.mclass })} fetcher={itemFetcher} getLabel={(it) => it.item_name} render={(it) => <span className="text-text-primary">{it.item_name}</span>} /></div>
          <div><L>구분</L><select value={f.mclass} onChange={(e) => setF({ ...f, mclass: e.target.value })} className={`${C.input} w-full`}><option>원재료</option><option>부재료</option></select></div>
          <div><L>규격</L><input value={f.spec} onChange={(e) => setF({ ...f, spec: e.target.value })} className={`${C.input} w-full`} /></div>
          <div><L>단위</L><select value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} className={`${C.input} w-full`}><option value="ea">ea</option><option value="kg">kg</option></select></div>
          <div><L>수량</L><input type="number" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} className={`${C.input} w-full`} /></div>
          <div><L>단가</L><input type="number" value={f.unit_price} onChange={(e) => setF({ ...f, unit_price: e.target.value })} className={`${C.input} w-full`} /></div>
          <div><L>부가세(빈칸=자동10%)</L><input type="number" value={f.vat} onChange={(e) => setF({ ...f, vat: e.target.value })} className={`${C.input} w-full`} /></div>
          <div className="col-span-2"><L>비고</L><input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="적요·메모" className={`${C.input} w-full`} /></div>
        </div>
        <div className="flex items-center gap-3 mt-4"><span className="text-sm text-text-tertiary">공급가 <b className="text-warning">{won(supply)}</b></span><button onClick={save} className={`${C.btn} ${C.btnPrimary} ml-auto`}>수정 저장</button></div>
        {msg && <div className="mt-2 text-xs text-danger">{msg}</div>}
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
  const [pu, setPu] = useState<'ea' | 'kg'>('ea');   // 단가 표시 기준
  const [team, setTeam] = useState('');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [hist, setHist] = useState<any>(null);
  const load = useCallback(async () => {
    setLoading(true);
    const p = new URLSearchParams({ start: range.start, end: range.end, min_lines: String(minLines), sort });
    if (mclass) p.set('mclass', mclass);
    if (team) p.set('team', team);
    setData(await getJSON<any>(`/purchase/records/price-tracker?${p.toString()}`, null));
    setLoading(false);
  }, [range, mclass, minLines, sort, team]);
  useEffect(() => { load(); }, [load]);
  const openItem = async (code: string, name: string) => setHist({ type: 'item', ...(await getJSON<any>(`/purchase/records/item-history?item_code=${encodeURIComponent(code || '')}&item_name=${encodeURIComponent(name || '')}&start=${range.start}&end=${range.end}`, {})) });
  const allItems = data?.items || [];
  const ql = q.trim().toLowerCase();
  const items = ql ? allItems.filter((it: any) => (it.item_name || '').toLowerCase().includes(ql) || (it.item_code || '').toLowerCase().includes(ql)) : allItems;
  // 점도표 데이터: x=변동률(%), y=누적공급가, 크기=매입횟수. 상승(빨강)/하락(파랑)/보합.
  const scatter = items.filter((it: any) => it.change_pct != null).map((it: any) => ({ ...it, x: it.change_pct, y: it.total_supply, z: it.buy_count }));
  const rising = scatter.filter((d: any) => d.x > 0), falling = scatter.filter((d: any) => d.x < 0), flat = scatter.filter((d: any) => d.x === 0);
  // 표시 단가: pu에 따라 단위당/kg당 전환 (kg당인데 규격 없으면 '-')
  const V = (it: any, k: string) => { const v = pu === 'kg' ? it[k + '_kg'] : it[k]; return v == null ? '-' : won(v); };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <PeriodBar value={range} onApply={setRange} />
        <TeamFilter value={team} onChange={setTeam} />
        <select value={mclass} onChange={(e) => setMclass(e.target.value)} className={C.input}><option value="">전체 구분</option><option>원재료</option><option>부재료</option></select>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="품목·코드 검색" className={`${C.input} w-40`} />
        <label className="text-xs text-text-tertiary flex items-center gap-1">최소 매입<select value={minLines} onChange={(e) => setMinLines(Number(e.target.value))} className={C.input}>{[1, 2, 3, 5].map((n) => <option key={n} value={n}>{n}회+</option>)}</select></label>
        <div className="flex rounded-lg overflow-hidden border border-border-primary">
          {(['ea', 'kg'] as const).map((u) => <button key={u} onClick={() => setPu(u)} className={`px-2.5 py-2 text-xs font-semibold ${pu === u ? 'bg-brand text-white' : 'bg-bg-inset text-text-tertiary'}`} title={u === 'kg' ? '규격 [Nkg] 기준 kg당 단가' : '전표상 단위(ea/box)당 단가'}>{u === 'ea' ? '단위당' : 'kg당'}</button>)}
        </div>
        <select value={sort} onChange={(e) => setSort(e.target.value)} className={`${C.input} ml-auto`}>{SORTS.map((s) => <option key={s.k} value={s.k}>{s.label}</option>)}</select>
        <XlsxBtn kind="price" params={{ start: range.start, end: range.end, mclass: mclass || undefined, min_lines: minLines, sort, team: team || undefined }} />
      </div>
      <p className="text-xs text-text-quaternary">기간 내 각 품목의 <b className="text-text-tertiary">매입 단가(전표상 단가, 품목×단위별)</b> 최초→최근 변동입니다. 상승=<span className="text-danger">빨강</span>, 하락=<span className="text-info">파랑</span>. 점/행 클릭 시 단가 추이 그래프. <b className="text-text-tertiary">kg당</b> 토글 시 규격 [Nkg] 기준 kg당 단가로 환산(규격 없는 품목은 '-').</p>
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
                  return <div style={TT as any} className="p-2 text-xs"><div className="font-semibold text-text-primary mb-0.5">{d.item_name} <span className="text-text-quaternary">[{pu === 'kg' ? 'kg당' : d.unit}]</span></div><div className={pctTone(d.change_pct)}>{pctStr(d.change_pct)} · {V(d, 'first_price')}→{V(d, 'last_price')}</div><div className="text-text-tertiary">누적 {won(d.total_supply)} · {d.buy_count}회</div></div>;
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
            <th className={C.th}>품목</th><th className={C.th}>규격</th><th className={C.th}>구분</th><th className={`${C.th} text-right`}>매입</th>
            <th className={`${C.th} text-right`}>최초{pu === 'kg' ? '(kg당)' : ''}</th><th className={`${C.th} text-right`}>최근{pu === 'kg' ? '(kg당)' : ''}</th>
            <th className={`${C.th} text-right`}>변동률</th><th className={`${C.th} text-right`}>최저~최고</th>
            <th className={`${C.th} text-right`}>편차</th><th className={`${C.th} text-right`}>가중평균</th><th className={`${C.th} text-right`}>{pu === 'kg' ? '누적kg' : '누적공급가'}</th>
          </tr></thead>
          <tbody>{!items.length ? <tr><td colSpan={11} className="p-6 text-center text-text-quaternary text-sm">{loading ? '조회 중…' : '데이터 없음'}</td></tr> : items.map((it: any, i: number) => (
            <tr key={i} className="hover:bg-bg-1 cursor-pointer" onClick={() => openItem(it.item_code, it.item_name)}>
              <td className={`${C.td} text-text-primary max-w-[260px] truncate`} title={it.item_name}>{it.item_name_short || it.item_name}{it.vendor_count > 1 && <span className="text-text-quaternary text-[11px] ml-1">·{it.vendor_count}처</span>}</td>
              <td className={`${C.td} text-text-tertiary text-xs`}>{it.spec || (pu === 'kg' ? <span className="text-warning">규격없음</span> : '-')}</td>
              <td className={C.td}><span className={it.mclass === '원재료' ? 'text-info' : 'text-warning'}>{it.mclass || '-'}</span></td>
              <td className={`${C.td} text-right tabular-nums`}>{it.buy_count}회</td>
              <td className={`${C.td} text-right tabular-nums`}>{V(it, 'first_price')}<div className="text-[10px] text-text-quaternary">{it.first_date?.slice(2)}</div></td>
              <td className={`${C.td} text-right tabular-nums text-text-primary`}>{V(it, 'last_price')}<div className="text-[10px] text-text-quaternary">{it.last_date?.slice(2)}</div></td>
              <td className={`${C.td} text-right tabular-nums font-semibold ${pctTone(it.change_pct)}`}>{pctStr(it.change_pct)}</td>
              <td className={`${C.td} text-right tabular-nums text-text-tertiary text-xs`}>{V(it, 'min_price')}~{V(it, 'max_price')}</td>
              <td className={`${C.td} text-right tabular-nums text-text-tertiary`}>{it.spread_pct != null ? `${it.spread_pct.toFixed(0)}%` : '-'}</td>
              <td className={`${C.td} text-right tabular-nums`}>{V(it, 'avg_price')}</td>
              <td className={`${C.td} text-right tabular-nums text-warning`}>{pu === 'kg' ? (it.total_kg != null ? fmt(it.total_kg) + 'kg' : '-') : wonShort(it.total_supply)}</td>
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
  const [start, setStart] = useState('');
  const [onlyBalance, setOnlyBalance] = useState(true);
  const [sort, setSort] = useState<{ key: string; dir: number }>({ key: 'priority', dir: 1 });
  const [modal, setModal] = useState<any>(null);

  const loadAging = useCallback(async () => { setLoading(true); setData(await getJSON<any>(`/purchase/ap-aging${start ? `?start=${start}` : ''}`, null)); setLoading(false); }, [start]);
  const loadTerms = useCallback(async () => { setTerms((await getJSON<any>('/purchase/vendor-terms', { terms: [] })).terms); }, []);
  useEffect(() => { loadAging(); loadTerms(); }, [loadAging, loadTerms]);
  const refresh = () => { loadAging(); loadTerms(); };

  const T = data?.totals || {};
  const bo: string[] = data?.bucket_order || [];
  const termByVendor: Record<string, any> = Object.fromEntries(terms.map((t) => [t.vendor, t]));

  const setSortKey = (k: string) => setSort((s) => (s.key === k ? { key: k, dir: -s.dir } : { key: k, dir: 1 }));
  let vendors = (data?.vendors || []).filter((v: any) => !onlyBalance || v.balance > 0);
  vendors = [...vendors].sort((a: any, b: any) => {
    const k = sort.key;
    if (k === 'vendor') return a.vendor.localeCompare(b.vendor) * sort.dir;
    if (k === 'earliest_due') return String(a.earliest_due || '9999').localeCompare(String(b.earliest_due || '9999')) * sort.dir;
    if (k === 'avg_pay_days' || k === 'max_days_overdue') {   // null(이력없음/연체없음)은 방향 무관 항상 하단
      const av = a[k], bv = b[k];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return (av - bv) * sort.dir;
    }
    return ((a[k] || 0) - (b[k] || 0)) * sort.dir;
  });

  const toggleSettle = async (v: any, checked: boolean) => {
    if (checked) {
      if (v.balance > 0 && !confirm(`${v.vendor} 잔액 ${won(v.balance)}을 정산완료 처리할까요? (지급기록 생성)`)) return;
      await send('/purchase/vendor-settle', 'POST', { vendor: v.vendor, done: true, amount: v.balance });
    } else {
      if (!confirm(`${v.vendor} 정산완료를 해제할까요? (체크로 만든 정산기록 삭제)`)) return;
      await send('/purchase/vendor-settle', 'POST', { vendor: v.vendor, done: false });
    }
    refresh();
  };

  const SortTh = ({ k, label, cls }: { k: string; label: string; cls?: string }) => (
    <th className={`${C.th} cursor-pointer select-none hover:text-text-secondary ${cls || ''}`} onClick={() => setSortKey(k)}>{label}{sort.key === k ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''}</th>
  );

  return (
    <div className="space-y-5">
      <LoadingOverlay show={loading} />
      <p className="text-xs text-text-quaternary">
        매입채무 = 구매일보 합계(VAT포함). 잔액 = 매입 − 지급(오래된 발주부터 상계). <b className="text-text-tertiary">연체 평균일</b>=연체 잔액의 금액가중 평균 경과일 / <b className="text-text-tertiary">연체 최장일</b>=가장 오래된 연체 발주 경과일, <b className="text-text-tertiary">평균지급소요</b>=실제 지급기록 기준 발주→지급 금액가중 평균(체크박스 자동정산분 제외). 컬럼 클릭 정렬·거래처명 클릭 설정. 맨 앞 체크박스로 잔액을 정산완료 처리. 기준일 {data?.asof || '-'}.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-text-tertiary">미지급 집계 시작일</span>
        {[{ k: '전체', v: '' }, { k: '올해', v: `${new Date().getFullYear()}-01-01` }, { k: '최근3개월', v: iso(new Date(new Date().getFullYear(), new Date().getMonth() - 2, 1)) }, { k: '당월', v: iso(new Date(new Date().getFullYear(), new Date().getMonth(), 1)) }].map((p) => (
          <button key={p.k} onClick={() => setStart(p.v)} className={`${C.btn} ${start === p.v ? C.btnPrimary : C.btnGhost} text-xs py-1.5`}>{p.k}</button>
        ))}
        <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className={`${C.input} text-xs py-1.5`} />
        <div className="ml-auto"><XlsxBtn kind="ap" params={{ start: start || undefined }} /></div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="총 매입(VAT포함)" value={won(T.payable || 0)} tone="text-text-primary" />
        <StatCard label="지급 완료" value={won(T.paid || 0)} tone="text-info" />
        {(() => {
          const bal = T.balance || 0; const bt = T.balance_target || 0;
          const ratio = bt > 0 ? Math.round((bal / bt) * 100) : null;
          const rtone = ratio == null ? 'text-text-quaternary' : ratio > 130 ? 'text-danger' : ratio > 110 ? 'text-warning' : 'text-success-light';
          return (
            <div className={`${C.card} p-4`} title={T.balance_target_period ? `목표 기준: ${T.balance_target_period} 매출(공급가)` : ''}>
              <div className="text-[11px] text-text-tertiary mb-1 truncate">미지급 잔액</div>
              <div className="text-lg font-bold tabular-nums text-warning">{won(bal)}</div>
              {bt > 0 ? (
                <div className="text-[11px] text-text-quaternary mt-1 leading-tight">
                  목표 {won(bt)}{ratio != null && <span className={`ml-1 font-semibold ${rtone}`}>· 목표대비 {ratio}%</span>}
                  <div className="text-[10px] text-text-quaternary leading-tight">3개월 월평균매출×0.35×2.5</div>
                </div>
              ) : <div className="text-[11px] text-text-quaternary mt-1 truncate">현재 갚아야 할 총액</div>}
            </div>
          );
        })()}
        <StatCard label="연체 잔액" value={won(T.overdue || 0)} tone="text-danger" sub="계약 만기 경과분" />
      </div>

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
          정산조건 미설정 거래처 {data.unset_vendors.length}곳(잔액 보유) — 거래처명을 클릭해 조건을 등록하면 만기·연체가 정확히 계산됩니다: {data.unset_vendors.slice(0, 8).join(', ')}{data.unset_vendors.length > 8 ? ' 외' : ''}
        </div>
      )}

      <div className={`${C.card} overflow-x-auto`}>
        <div className="px-4 pt-3 pb-2 flex items-center justify-between">
          <div className="text-sm font-semibold text-text-primary">거래처별 매입채무 · 정산 우선순위 <span className="text-xs text-text-quaternary font-normal">(컬럼 클릭 정렬 · 거래처명 클릭 설정)</span></div>
          <label className="text-xs text-text-tertiary flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={onlyBalance} onChange={(e) => setOnlyBalance(e.target.checked)} /> 잔액 있는 곳만</label>
        </div>
        <table className="w-full">
          <thead><tr>
            <th className={`${C.th} text-center`}>정산완료</th>
            <SortTh k="priority" label="순위" />
            <SortTh k="vendor" label="거래처" />
            <th className={C.th}>정산조건</th>
            <SortTh k="payable" label="매입" cls="text-right" />
            <SortTh k="paid" label="지급" cls="text-right" />
            <SortTh k="balance" label="잔액" cls="text-right" />
            <SortTh k="overdue" label="연체액" cls="text-right" />
            <SortTh k="avg_days_overdue" label="연체 평균일" cls="text-right" />
            <SortTh k="max_days_overdue" label="연체 최장일" cls="text-right" />
            <SortTh k="avg_pay_days" label="평균지급소요" cls="text-right" />
            <SortTh k="earliest_due" label="최근만기" />
          </tr></thead>
          <tbody>{!vendors.length ? <tr><td colSpan={12} className="p-6 text-center text-text-quaternary text-sm">데이터 없음</td></tr> : vendors.map((v: any) => {
            const settled = v.balance <= 0.5;
            const od = v.max_days_overdue;
            const avgOd = v.avg_days_overdue;
            const odTone = (n: number | null) => n != null ? (n > 60 ? 'text-danger font-bold' : n > 30 ? 'text-danger' : 'text-warning') : 'text-text-quaternary';
            return (
              <tr key={v.vendor} className={`hover:bg-bg-1 ${settled ? 'opacity-60' : ''}`}>
                <td className={`${C.td} text-center`}><input type="checkbox" checked={settled} onChange={(e) => toggleSettle(v, e.target.checked)} title="체크 시 잔액 정산완료 처리" /></td>
                <td className={`${C.td} tabular-nums`}>{v.priority}</td>
                <td className={`${C.td} max-w-[220px] truncate`}><button onClick={() => setModal(v)} className="text-text-primary font-medium hover:text-accent hover:underline text-left" title={v.vendor}>{v.vendor}</button></td>
                <td className={C.td}>{v.term_label || <span className="text-warning">미설정</span>}</td>
                <td className={`${C.td} text-right tabular-nums`}>{won(v.payable)}</td>
                <td className={`${C.td} text-right tabular-nums text-info`}>{won(v.paid)}</td>
                <td className={`${C.td} text-right tabular-nums text-warning font-semibold`}>{won(v.balance)}</td>
                <td className={`${C.td} text-right tabular-nums ${v.overdue > 0 ? 'text-danger font-semibold' : 'text-text-quaternary'}`}>{v.overdue > 0 ? won(v.overdue) : '-'}</td>
                <td className={`${C.td} text-right tabular-nums ${odTone(avgOd)}`} title={avgOd != null ? '연체 잔액의 금액가중 평균 경과일' : '연체 없음'}>{avgOd != null ? `${fmt(avgOd)}일` : '-'}</td>
                <td className={`${C.td} text-right tabular-nums ${odTone(od)}`} title={od != null ? '잔액 중 가장 오래 연체된 발주 경과일' : '연체 없음'}>{od != null ? `${fmt(od)}일` : '-'}</td>
                <td className={`${C.td} text-right tabular-nums ${v.avg_pay_days != null ? 'text-text-secondary' : 'text-text-quaternary'}`} title="실제 지급기록 기준 발주→지급 평균(FIFO·금액가중)">{v.avg_pay_days != null ? `${fmt(v.avg_pay_days)}일` : '-'}</td>
                <td className={C.td}>{v.earliest_due || '-'}</td>
              </tr>
            );
          })}</tbody>
          {vendors.length > 0 && data?.totals && (
            <tfoot><tr className="bg-bg-inset font-semibold sticky bottom-0">
              <td className={C.td}></td>
              <td className={`${C.td} text-text-primary`} colSpan={3}>합계 · {fmt(data.totals.balance_vendor_count ?? vendors.length)}개 거래처(잔액){data.totals.vendor_count ? ` / 전체 ${fmt(data.totals.vendor_count)}` : ''}</td>
              <td className={`${C.td} text-right tabular-nums text-text-primary`}>{won(data.totals.payable)}</td>
              <td className={`${C.td} text-right tabular-nums text-info`}>{won(data.totals.paid)}</td>
              <td className={`${C.td} text-right tabular-nums text-warning`}>{won(data.totals.balance)}{data.totals.balance_target > 0 && <div className="text-[10px] font-normal text-text-quaternary leading-tight" title={data.totals.balance_target_period ? `목표 기준: ${data.totals.balance_target_period} 매출` : ''}>목표 {won(data.totals.balance_target)}{data.totals.balance_target > 0 && <span className="ml-1">({Math.round((data.totals.balance / data.totals.balance_target) * 100)}%)</span>}</div>}</td>
              <td className={`${C.td} text-right tabular-nums text-danger`}>{data.totals.overdue > 0 ? won(data.totals.overdue) : '-'}</td>
              <td className={`${C.td} text-right tabular-nums text-text-secondary`} title="전체 연체 가중 평균 경과일">{data.totals.avg_days_overdue != null ? `평균 ${fmt(data.totals.avg_days_overdue)}일` : '-'}</td>
              <td className={`${C.td} text-right tabular-nums text-text-secondary`} title="전체 최장 연체일">{data.totals.max_days_overdue != null ? `최장 ${fmt(data.totals.max_days_overdue)}일` : '-'}</td>
              <td className={`${C.td} text-right tabular-nums text-text-secondary`} title="전체 가중 평균 지급소요일">{data.totals.avg_pay_days != null ? `평균 ${fmt(data.totals.avg_pay_days)}일` : '-'}</td>
              <td className={C.td}></td>
            </tr></tfoot>
          )}
        </table>
      </div>

      {modal && <VendorModal vendor={modal} term={termByVendor[modal.vendor]} onClose={() => setModal(null)} onChanged={refresh} />}
    </div>
  );
}

function VendorModal({ vendor, term, onClose, onChanged }: { vendor: any; term: any; onClose: () => void; onChanged: () => void }) {
  const [pays, setPays] = useState<any[]>([]);
  const [tf, setTf] = useState<any>(() => term
    ? { term_type: term.term_type, term_month_offset: term.term_month_offset ?? 1, term_day: term.term_day ?? 20, term_days: term.term_days ?? 30, memo: term.memo || '' }
    : { term_type: 'MONTH_END', term_month_offset: 1, term_day: 20, term_days: 30, memo: '' });
  const [pf, setPf] = useState<any>({ pay_date: iso(new Date()), amount: '', method: '이체', memo: '' });
  const [msg, setMsg] = useState<string | null>(null);
  const [orders, setOrders] = useState<any>(null);
  const [showPaid, setShowPaid] = useState(false);   // 완료건 포함 토글
  const loadPays = useCallback(async () => { setPays((await getJSON<any>(`/purchase/payments?vendor=${encodeURIComponent(vendor.vendor)}&limit=100`, { payments: [] })).payments); }, [vendor.vendor]);
  const loadOrders = useCallback(async () => { setOrders(await getJSON<any>(`/purchase/vendor-orders?vendor=${encodeURIComponent(vendor.vendor)}`, null)); }, [vendor.vendor]);
  useEffect(() => { loadPays(); loadOrders(); }, [loadPays, loadOrders]);

  const saveTerm = async () => {
    const r = await send('/purchase/vendor-terms', 'POST', { vendor: vendor.vendor, ...tf });
    if (r.ok) { setMsg(`정산조건 저장: ${r.data.label}`); onChanged(); } else setMsg(r.data?.detail || '실패');
  };
  const savePay = async () => {
    if (!pf.amount) { setMsg('지급액을 입력하세요'); return; }
    const r = await send('/purchase/payments', 'POST', { vendor: vendor.vendor, ...pf, amount: Number(pf.amount) || 0 });
    if (r.ok) { setPf({ ...pf, amount: '', memo: '' }); setMsg('지급 기록 저장'); loadPays(); loadOrders(); onChanged(); } else setMsg(r.data?.detail || '실패');
  };
  const delPay = async (id: number) => { if (!confirm('이 지급 기록을 삭제할까요?')) return; await send(`/purchase/payments/${id}`, 'DELETE'); loadPays(); loadOrders(); onChanged(); };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div className="relative bg-bg-1 border border-border-primary rounded-2xl w-full max-w-2xl max-h-[88vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <div><div className="text-xs text-text-tertiary">거래처 정산 설정</div><div className="text-lg font-bold text-text-primary">{vendor.vendor}</div></div>
          <button onClick={onClose} className="text-text-tertiary hover:text-text-primary text-xl">×</button>
        </div>
        <div className="grid grid-cols-3 gap-2 mb-4">
          <StatCard label="매입(VAT포함)" value={won(vendor.payable || 0)} />
          <StatCard label="미지급 잔액" value={won(vendor.balance || 0)} tone="text-warning" />
          <StatCard label="연체" value={won(vendor.overdue || 0)} tone={vendor.overdue > 0 ? 'text-danger' : 'text-text-tertiary'} sub={vendor.overdue > 0 ? `평균 ${fmt(vendor.avg_days_overdue || 0)}일 · 최장 ${fmt(vendor.max_days_overdue || 0)}일` : ''} />
        </div>

        {/* 정산조건 */}
        <div className="text-sm font-semibold text-text-primary mb-2">계약 정산조건</div>
        <div className="space-y-2 mb-4">
          <select value={tf.term_type} onChange={(e) => setTf({ ...tf, term_type: e.target.value })} className={`${C.input} w-full`}>{TERM_TYPES.map((t) => <option key={t.k} value={t.k}>{t.label}</option>)}</select>
          {tf.term_type === 'DAYS_AFTER' ? (
            <div className="flex items-center gap-2"><span className="text-sm text-text-secondary">발주 후</span><input type="number" value={tf.term_days} onChange={(e) => setTf({ ...tf, term_days: e.target.value })} className={`${C.input} w-24`} /><span className="text-sm text-text-secondary">일</span></div>
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              <select value={tf.term_month_offset} onChange={(e) => setTf({ ...tf, term_month_offset: Number(e.target.value) })} className={C.input}>{OFFSETS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}</select>
              {tf.term_type === 'DAY_OF_MONTH' && <><input type="number" value={tf.term_day} onChange={(e) => setTf({ ...tf, term_day: e.target.value })} className={`${C.input} w-20`} min={1} max={31} /><span className="text-sm text-text-secondary">일</span></>}
              {tf.term_type === 'MONTH_END' && <span className="text-sm text-text-secondary">말일</span>}
            </div>
          )}
          <input value={tf.memo} onChange={(e) => setTf({ ...tf, memo: e.target.value })} placeholder="메모(선택)" className={`${C.input} w-full`} />
          <button onClick={saveTerm} className={`${C.btn} ${C.btnPrimary}`}>정산조건 저장</button>
        </div>

        {/* 지급 추가 */}
        <div className="text-sm font-semibold text-text-primary mb-2">지급(정산) 기록 추가</div>
        <div className="grid grid-cols-2 gap-2 mb-2">
          <div><div className="text-xs text-text-tertiary mb-1">지급일</div><input type="date" value={pf.pay_date} onChange={(e) => setPf({ ...pf, pay_date: e.target.value })} className={`${C.input} w-full`} /></div>
          <div><div className="text-xs text-text-tertiary mb-1">지급액(VAT포함)</div><input type="number" value={pf.amount} onChange={(e) => setPf({ ...pf, amount: e.target.value })} className={`${C.input} w-full`} /></div>
          <div><div className="text-xs text-text-tertiary mb-1">수단</div><select value={pf.method} onChange={(e) => setPf({ ...pf, method: e.target.value })} className={`${C.input} w-full`}><option>이체</option><option>어음</option><option>현금</option><option>카드</option></select></div>
          <div><div className="text-xs text-text-tertiary mb-1">메모</div><input value={pf.memo} onChange={(e) => setPf({ ...pf, memo: e.target.value })} className={`${C.input} w-full`} /></div>
        </div>
        <div className="flex items-center gap-3 mb-4"><button onClick={savePay} className={`${C.btn} ${C.btnPrimary}`}>지급 기록 저장</button>{msg && <span className="text-xs text-accent">{msg}</span>}</div>

        {/* 정산 이력 (일자별) */}
        <div className="text-sm font-semibold text-text-primary mb-2">정산 이력 <span className="text-xs text-text-quaternary font-normal">({pays.length}건)</span></div>
        <div className="overflow-x-auto mb-4">
          <table className="w-full"><thead><tr><th className={C.th}>지급일</th><th className={`${C.th} text-right`}>금액</th><th className={C.th}>수단</th><th className={C.th}>메모</th><th className={C.th}></th></tr></thead>
            <tbody>{!pays.length ? <tr><td colSpan={5} className="p-4 text-center text-text-quaternary text-xs">정산 이력 없음</td></tr> : pays.map((p) => (
              <tr key={p.id} className="hover:bg-bg-0">
                <td className={C.td}>{p.pay_date}</td>
                <td className={`${C.td} text-right tabular-nums text-info`}>{won(p.amount)}</td>
                <td className={C.td}>{p.method || '-'}{p.method === '정산완료' && <span className="ml-1 text-[10px] text-success-light">자동</span>}</td>
                <td className={`${C.td} max-w-[160px] truncate`} title={p.memo || ''}>{p.memo || '-'}</td>
                <td className={`${C.td} text-right`}><button onClick={() => delPay(p.id)} className="text-danger text-xs hover:underline">삭제</button></td>
              </tr>
            ))}</tbody></table>
        </div>

        {/* 발주 상세 — 미지급/완료 토글 */}
        {(orders?.orders?.length > 0) && (() => {
          const allOrders: any[] = orders.orders;
          const shown = showPaid ? allOrders : allOrders.filter((o) => o.status !== '완료');
          const hiddenPaid = allOrders.length - allOrders.filter((o) => o.status !== '완료').length;
          return <>
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-semibold text-text-primary">발주 상세 <span className="text-xs text-text-quaternary font-normal">(총 {orders.order_count}건 · 미지급 {orders.unpaid_count + orders.partial_count} / 완료 {orders.paid_count})</span></div>
              <label className="text-xs text-text-tertiary flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={showPaid} onChange={(e) => setShowPaid(e.target.checked)} /> 지급완료 포함{!showPaid && hiddenPaid > 0 ? ` (숨김 ${hiddenPaid})` : ''}</label>
            </div>
            <div className="flex flex-wrap gap-2 mb-2">{Object.entries(vendor.buckets || {}).map(([b, amt]: any) => <span key={b} className={`text-xs px-2 py-1 rounded-md bg-bg-inset ${BUCKET_TONE[b] || ''}`}>{b}: {won(amt)}</span>)}</div>
            <div className="overflow-x-auto">
              <table className="w-full"><thead><tr><th className={C.th}>발주일</th><th className={C.th}>상태</th><th className={`${C.th} text-right`}>발주액</th><th className={`${C.th} text-right`}>미지급액</th><th className={C.th}>만기일</th><th className={C.th}>경과</th></tr></thead>
                <tbody>{!shown.length ? <tr><td colSpan={6} className="p-4 text-center text-text-quaternary text-xs">{showPaid ? '발주 없음' : '미지급 발주 없음 — 전부 정산 완료'}</td></tr> : shown.map((o: any, i: number) => {
                  const stTone = o.status === '완료' ? 'text-success-light' : o.status === '부분' ? 'text-warning' : 'text-danger';
                  return <tr key={i} className={o.status === '완료' ? 'opacity-60' : ''}>
                    <td className={C.td}>{o.pdate}{o.lines > 1 ? <span className="text-text-quaternary text-[11px]"> ·{o.lines}건</span> : ''}</td>
                    <td className={`${C.td} ${stTone} text-xs font-medium`}>{o.status}</td>
                    <td className={`${C.td} text-right tabular-nums text-text-tertiary`}>{won(o.total)}</td>
                    <td className={`${C.td} text-right tabular-nums ${o.unpaid > 0 ? 'text-warning' : 'text-text-quaternary'}`}>{o.unpaid > 0 ? won(o.unpaid) : '-'}</td>
                    <td className={C.td}>{o.due || '-'}</td>
                    <td className={`${C.td} ${o.unpaid > 0 && o.days_overdue > 0 ? 'text-danger' : 'text-text-tertiary'}`}>{o.days_overdue == null ? '-' : o.days_overdue > 0 ? `+${o.days_overdue}일` : `${o.days_overdue}일`}</td>
                  </tr>;
                })}</tbody></table>
            </div>
          </>;
        })()}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// BOM ↔ 구매관리 매핑 점검 + 마스터 단가 최신구매가 반영
// ─────────────────────────────────────────────
const BOM_FILTERS = [
  { k: 'all', label: '전체' },
  { k: 'no_purchase_used', label: '⚠ BOM사용+구매없음' },
  { k: 'stale', label: '단가 괴리' },
  { k: 'unit_check', label: '단위 확인' },
  { k: 'matched', label: '정상 매칭' },
];
function BomMapTab() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('no_purchase_used');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(async () => { setLoading(true); setData(await getJSON<any>('/purchase/bom-mapping', null)); setLoading(false); }, []);
  useEffect(() => { load(); }, [load]);
  const S = data?.summary || {};
  const all: any[] = data?.items || [];
  const ql = q.trim().toLowerCase();
  const items = all.filter((x) => {
    if (ql && !(x.name || '').toLowerCase().includes(ql) && !(x.erp_code || '').toLowerCase().includes(ql)) return false;
    if (filter === 'all') return true;
    if (filter === 'no_purchase_used') return x.flags.includes('no_purchase') && x.bom_uses > 0;
    if (filter === 'matched') return x.matched && !x.flags.includes('stale');
    return x.flags.includes(filter);
  });
  const toggle = (code: string) => setSel((s) => { const n = new Set(s); n.has(code) ? n.delete(code) : n.add(code); return n; });
  const staleCodes = all.filter((x) => x.flags.includes('stale')).map((x) => x.erp_code);
  const sync = async (codes: string[]) => {
    if (!codes.length) { setMsg('반영할 자재를 선택하세요'); return; }
    const pre = await send('/purchase/bom-sync-prices', 'POST', { erp_codes: codes, dry_run: true });
    const n = pre.data?.changed_count || 0;
    if (!n) { setMsg('반영할 단가 변화가 없습니다'); return; }
    if (!confirm(`${n}개 자재 마스터 단가를 최신 구매가로 반영할까요?\n(원재료 kg당·부자재 롤/개당 기준)`)) return;
    const r = await send('/purchase/bom-sync-prices', 'POST', { erp_codes: codes, dry_run: false });
    setMsg(`${r.data?.changed_count || 0}개 자재 단가 반영 완료`); setSel(new Set()); load();
  };
  const flagBadge = (f: string[]) => {
    if (f.includes('no_purchase')) return <span className="text-danger text-xs">구매기록 없음</span>;
    if (f.includes('stale')) return <span className="text-warning text-xs">단가 괴리</span>;
    if (f.includes('unit_check')) return <span className="text-info text-xs">단위 확인</span>;
    return <span className="text-success-light text-xs">정상</span>;
  };
  return (
    <div className="space-y-4">
      <LoadingOverlay show={loading} />
      <p className="text-xs text-text-quaternary">BOM 원부재료와 구매관리(구매일보)를 <b className="text-text-tertiary">품목코드(erp_code=item_code)</b>로 매핑합니다. 원재료는 kg당, 부자재는 롤/개당 기준으로 마스터 단가와 최신 구매가를 비교합니다. '단가 반영'을 누르면 마스터 단가가 최신 구매가로 갱신되어 BOM 원가에 반영됩니다.</p>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard label="총 자재(활성)" value={fmt(S.total || 0)} />
        <StatCard label="구매 매칭" value={fmt(S.matched || 0)} tone="text-info" sub={`전체 ${fmt(S.total || 0)}종`} />
        <StatCard label="BOM사용+구매없음" value={fmt(S.unused_used_gap || 0)} tone="text-danger" sub="연동 안 됨 — 점검" />
        <StatCard label="단가 괴리(>10%)" value={fmt(S.stale || 0)} tone="text-warning" />
        <StatCard label="단위 확인" value={fmt(S.unit_check || 0)} tone="text-text-tertiary" sub="kg환산 정보 없음" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {BOM_FILTERS.map((f) => <button key={f.k} onClick={() => setFilter(f.k)} className={`${C.btn} ${filter === f.k ? C.btnPrimary : C.btnGhost} text-xs py-1.5`}>{f.label}</button>)}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="자재명·코드" className={`${C.input} w-40`} />
        <div className="ml-auto flex items-center gap-2">
          {msg && <span className="text-xs text-accent">{msg}</span>}
          <button onClick={() => sync(Array.from(sel))} disabled={!sel.size} className={`${C.btn} ${sel.size ? C.btnPrimary : C.btnGhost} text-xs py-1.5`}>선택 {sel.size ? `${sel.size}건 ` : ''}단가 반영</button>
          <button onClick={() => sync(staleCodes)} className={`${C.btn} ${C.btnGhost} text-xs py-1.5`} title="괴리 자재 전체를 최신 구매가로">괴리 전체 반영</button>
          <XlsxBtn kind="bom" />
        </div>
      </div>
      <div className={`${C.card} overflow-x-auto`}>
        <table className="w-full"><thead><tr>
          <th className={`${C.th} text-center`}></th><th className={C.th}>유형</th><th className={C.th}>자재명</th><th className={C.th}>코드</th><th className={C.th}>거래처</th>
          <th className={`${C.th} text-right`}>마스터</th><th className={`${C.th} text-right`}>최신구매</th><th className={`${C.th} text-right`}>괴리</th>
          <th className={`${C.th} text-center`}>BOM사용</th><th className={C.th}>최근구매</th><th className={C.th}>상태</th>
        </tr></thead>
          <tbody>{!items.length ? <tr><td colSpan={11} className="p-6 text-center text-text-quaternary text-sm">{loading ? '조회 중…' : '해당 없음'}</td></tr> : items.map((x: any) => (
            <tr key={x.type + x.erp_code} className={`hover:bg-bg-1 ${sel.has(x.erp_code) ? 'bg-brand/10' : ''}`}>
              <td className={`${C.td} text-center`}>{x.matched && <input type="checkbox" checked={sel.has(x.erp_code)} onChange={() => toggle(x.erp_code)} />}</td>
              <td className={C.td}><span className={x.type === 'raw' ? 'text-info' : 'text-warning'}>{x.type === 'raw' ? '원재료' : '부자재'}</span></td>
              <td className={`${C.td} text-text-primary max-w-[240px] truncate`} title={x.name}>{x.name}</td>
              <td className={`${C.td} text-text-tertiary text-xs`}>{x.erp_code}</td>
              <td className={`${C.td} text-text-tertiary text-xs max-w-[120px] truncate`}>{x.vendor || x.supplier || '-'}</td>
              <td className={`${C.td} text-right tabular-nums`}>{won(x.master_price)}<div className="text-[10px] text-text-quaternary">{x.basis === 'kg' ? '/kg' : x.basis === 'roll' ? '/롤' : '/개'}</div></td>
              <td className={`${C.td} text-right tabular-nums text-text-primary`}>{x.buy_price != null ? won(x.buy_price) : '-'}</td>
              <td className={`${C.td} text-right tabular-nums font-semibold ${x.gap_pct == null ? 'text-text-quaternary' : x.gap_pct > 0 ? 'text-danger' : 'text-info'}`}>{x.gap_pct == null ? '-' : `${x.gap_pct > 0 ? '▲' : '▼'}${Math.abs(x.gap_pct).toFixed(0)}%`}</td>
              <td className={`${C.td} text-center tabular-nums ${x.bom_uses ? '' : 'text-text-quaternary'}`}>{x.bom_uses}</td>
              <td className={`${C.td} text-text-tertiary text-xs`}>{x.last_date || '-'}</td>
              <td className={C.td}>{flagBadge(x.flags)}</td>
            </tr>
          ))}</tbody></table>
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

// ══════════════════════════════════════════════════════════════
// 자산형 재고 — 공장 층별 품목 등록 + 입출고/조정 재고관리
// ══════════════════════════════════════════════════════════════
interface AssetLoc { id: number; name: string; sort_order: number; is_active: boolean; notes?: string; }
interface AssetItem {
  id: number; code?: string; name: string; category?: string; spec?: string; unit: string;
  unit_cost: number; min_qty: number; vendor?: string; default_location_id?: number;
  default_location_name?: string; is_active: boolean; notes?: string;
  stock_by_location: { location_id: number; location_name: string; qty: number; defect_qty: number }[];
  total_qty: number; shown_qty: number; defect_qty: number; good_qty: number; asset_value: number; below_min: boolean;
}
const MOVE_LABEL: Record<string, string> = { in: '입고', out: '출고', adjust: '조정', transfer_in: '이동입고', transfer_out: '이동출고', transfer: '이동', defect: '고장등록', repair: '수리완료' };

function AssetTab() {
  const [locs, setLocs] = useState<AssetLoc[]>([]);
  const [items, setItems] = useState<AssetItem[]>([]);
  const [dash, setDash] = useState<any>(null);
  const [moves, setMoves] = useState<any[]>([]);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [locFilter, setLocFilter] = useState<number | ''>('');
  const [lowOnly, setLowOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [itemModal, setItemModal] = useState<AssetItem | null | 'new'>(null);
  const [moveModal, setMoveModal] = useState<{ item: AssetItem; type: string } | null>(null);
  const [locModal, setLocModal] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const [lr, ir, dr, mr] = await Promise.all([
        getJSON<{ locations: AssetLoc[] }>('/purchase/assets/locations', { locations: [] }),
        getJSON<{ rows: AssetItem[] }>(`/purchase/assets/items?${new URLSearchParams({
          ...(q ? { q } : {}), ...(cat ? { category: cat } : {}),
          ...(locFilter ? { location_id: String(locFilter) } : {}),
          ...(lowOnly ? { low_only: 'true' } : {}),
        }).toString()}`, { rows: [] }),
        getJSON<any>('/purchase/assets/dashboard', null),
        getJSON<{ rows: any[] }>('/purchase/assets/movements?limit=40', { rows: [] }),
      ]);
      setLocs(lr.locations || []);
      setItems(ir.rows || []);
      setDash(dr);
      setMoves(mr.rows || []);
    } finally { setBusy(false); }
  }, [q, cat, locFilter, lowOnly]);
  useEffect(() => { load(); }, [load]);

  const cats = Array.from(new Set(items.map((i) => i.category).filter(Boolean))) as string[];
  const noLoc = locs.length === 0;

  const seedLocs = async () => {
    const r = await send('/purchase/assets/locations/seed', 'POST');
    if (r.ok) load(); else alert(r.data?.detail || '실패');
  };
  const removeItem = async (it: AssetItem) => {
    if (!confirm(`'${it.name}' 품목을 삭제할까요?\n(재고 이동 이력이 있으면 비활성 처리됩니다)`)) return;
    const r = await send(`/purchase/assets/items/${it.id}`, 'DELETE');
    if (r.ok) load(); else alert(r.data?.detail || '실패');
  };
  const removeMove = async (id: number) => {
    if (!confirm('이 재고 이동 기록을 삭제할까요? (현재고가 되돌아갑니다)')) return;
    const r = await send(`/purchase/assets/movements/${id}`, 'DELETE');
    if (r.ok) load(); else alert(r.data?.detail || '실패');
  };

  return (
    <div className="space-y-5">
      <LoadingOverlay show={busy} />
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-bold text-text-primary">자산형 재고</h2>
          <p className="text-xs text-text-tertiary mt-0.5">공장 층별로 자산성 물품(부자재·소모품·비품 등)을 등록하고 입고·출고·조정으로 재고를 관리합니다. 자산가치 = 현재고 × 평가단가.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setLocModal(true)} className={`${C.btn} ${C.btnGhost}`}>🏭 위치 관리</button>
          <button onClick={() => setItemModal('new')} disabled={noLoc} className={`${C.btn} ${C.btnPrimary} disabled:opacity-50`}>+ 품목 등록</button>
        </div>
      </div>

      {noLoc && (
        <div className={`${C.card} p-5 text-center`}>
          <p className="text-sm text-text-secondary mb-3">아직 재고 위치(층)가 없습니다. 공장 1·2·3층을 먼저 생성하세요.</p>
          <button onClick={seedLocs} className={`${C.btn} ${C.btnPrimary}`}>공장 1·2·3층 생성</button>
        </div>
      )}

      {/* 요약 */}
      {dash && !noLoc && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="등록 품목" value={`${fmt(dash.item_count)}종`} />
          <StatCard label="총 자산가치" value={won(dash.total_value)} sub={`기준 ${dash.as_of}`} tone="text-brand" />
          <div className={`${C.card} p-4`}>
            <div className="text-[11px] text-text-tertiary mb-1">안전재고 미달 · 고장</div>
            <div className="flex items-baseline gap-3">
              <div><span className={`text-lg font-bold tabular-nums ${dash.low_count > 0 ? 'text-danger' : 'text-success'}`}>{fmt(dash.low_count)}</span><span className="text-[11px] text-text-tertiary ml-0.5">종 미달</span></div>
              <div className="border-l border-border-subtle pl-3"><span className={`text-lg font-bold tabular-nums ${dash.defect_total > 0 ? 'text-warning' : 'text-success'}`}>{fmt(dash.defect_total || 0)}</span><span className="text-[11px] text-text-tertiary ml-0.5">🔧 고장</span></div>
            </div>
            {(dash.defect_items || []).length > 0 && <div className="text-[10px] text-text-quaternary mt-1 truncate">{(dash.defect_items || []).map((d: any) => `${d.name} ${fmt(d.defect_qty)}${d.unit}`).join(', ')}</div>}
          </div>
          <div className={`${C.card} p-4`}>
            <div className="text-[11px] text-text-tertiary mb-1">위치별 자산가치</div>
            <div className="space-y-0.5">
              {(dash.by_location || []).map((b: any) => (
                <div key={b.location_id} className="flex justify-between text-[11px]"><span className="text-text-tertiary truncate">{b.location_name}</span><span className="tabular-nums font-semibold text-text-secondary">{wonShort(b.value)}</span></div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 필터 */}
      {!noLoc && (
        <div className="flex flex-wrap items-center gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="품목명·코드·규격 검색" className={`${C.input} w-52`} />
          <select value={cat} onChange={(e) => setCat(e.target.value)} className={C.input}>
            <option value="">전체 분류</option>
            {cats.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={locFilter} onChange={(e) => setLocFilter(e.target.value ? Number(e.target.value) : '')} className={C.input}>
            <option value="">전체 위치</option>
            {locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          <label className="flex items-center gap-1.5 text-xs text-text-secondary cursor-pointer select-none">
            <input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} /> 재고 부족만
          </label>
          <div className="ml-auto text-xs text-text-tertiary">{items.length}종</div>
        </div>
      )}

      {/* 품목 테이블 */}
      {!noLoc && (
        <div className={`${C.card} overflow-x-auto`}>
          <table className="w-full text-sm">
            <thead><tr>
              <th className={C.th}>품목</th><th className={C.th}>분류</th><th className={C.th}>규격</th>
              <th className={`${C.th} text-right`}>평가단가</th>
              <th className={C.th}>위치별 재고</th>
              <th className={`${C.th} text-right`}>총재고</th>
              <th className={`${C.th} text-right`}>자산가치</th>
              <th className={`${C.th} text-right`}>안전</th>
              <th className={C.th}></th>
            </tr></thead>
            <tbody>
              {items.length === 0 && <tr><td colSpan={9} className="text-center text-text-tertiary py-8 text-sm">등록된 품목이 없습니다. ‘+ 품목 등록’으로 추가하세요.</td></tr>}
              {items.map((it) => (
                <tr key={it.id} className={it.is_active ? '' : 'opacity-50'}>
                  <td className={C.td}>
                    <div className="font-semibold text-text-primary">{it.name}{!it.is_active && <span className="ml-1 text-[10px] text-text-quaternary">(비활성)</span>}</div>
                    {(it.code || it.vendor) && <div className="text-[10px] text-text-quaternary">{it.code}{it.code && it.vendor ? ' · ' : ''}{it.vendor}</div>}
                  </td>
                  <td className={C.td}>{it.category || '-'}</td>
                  <td className={C.td}>{it.spec || '-'}</td>
                  <td className={`${C.td} text-right tabular-nums`}>{won(it.unit_cost)}<span className="text-[10px] text-text-quaternary">/{it.unit}</span></td>
                  <td className={C.td}>
                    <div className="flex flex-wrap gap-1">
                      {it.stock_by_location.length === 0 && <span className="text-[11px] text-text-quaternary">-</span>}
                      {it.stock_by_location.map((s) => (
                        <span key={s.location_id} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-bg-inset text-[11px]"><span className="text-text-quaternary">{s.location_name}</span><span className="tabular-nums font-semibold text-text-secondary">{fmt(s.qty)}</span>{(s.defect_qty || 0) > 0 && <span className="tabular-nums font-semibold text-warning" title="고장">🔧{fmt(s.defect_qty)}</span>}</span>
                      ))}
                    </div>
                  </td>
                  <td className={`${C.td} text-right`}>
                    <div className={`tabular-nums font-semibold ${it.below_min ? 'text-danger' : 'text-text-primary'}`}>{fmt(it.total_qty)} {it.unit}</div>
                    {(it.defect_qty || 0) > 0 && <div className="text-[10px] text-warning tabular-nums">정상 {fmt(it.good_qty)} · 🔧고장 {fmt(it.defect_qty)}</div>}
                  </td>
                  <td className={`${C.td} text-right tabular-nums`}>{won(it.asset_value)}</td>
                  <td className={`${C.td} text-right tabular-nums text-text-quaternary`}>{it.min_qty ? fmt(it.min_qty) : '-'}</td>
                  <td className={C.td}>
                    <div className="flex gap-1">
                      <button onClick={() => setMoveModal({ item: it, type: 'in' })} className="px-2 py-1 rounded text-[11px] font-semibold bg-success/10 text-success border border-success/30 hover:bg-success/20">입고</button>
                      <button onClick={() => setMoveModal({ item: it, type: 'out' })} className="px-2 py-1 rounded text-[11px] font-semibold bg-danger/10 text-danger border border-danger/30 hover:bg-danger/20">출고</button>
                      <button onClick={() => setMoveModal({ item: it, type: 'adjust' })} className="px-2 py-1 rounded text-[11px] font-semibold bg-warning/10 text-warning border border-warning/30 hover:bg-warning/20">조정</button>
                      <button onClick={() => setMoveModal({ item: it, type: 'transfer' })} className="px-2 py-1 rounded text-[11px] font-semibold bg-info/10 text-info border border-info/30 hover:bg-info/20">이동</button>
                      <button onClick={() => setMoveModal({ item: it, type: 'defect' })} className="px-2 py-1 rounded text-[11px] font-semibold bg-warning/10 text-warning border border-warning/30 hover:bg-warning/20">고장</button>
                      {(it.defect_qty || 0) > 0 && <button onClick={() => setMoveModal({ item: it, type: 'repair' })} className="px-2 py-1 rounded text-[11px] font-semibold bg-success/10 text-success border border-success/30 hover:bg-success/20">수리</button>}
                      <button onClick={() => setItemModal(it)} className="px-2 py-1 rounded text-[11px] text-text-tertiary hover:text-text-primary hover:bg-bg-inset">수정</button>
                      <button onClick={() => removeItem(it)} className="px-2 py-1 rounded text-[11px] text-text-quaternary hover:text-danger hover:bg-danger/10">삭제</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 최근 이동 이력 */}
      {!noLoc && (
        <div className={`${C.card} p-4`}>
          <div className="text-sm font-bold text-text-primary mb-2">최근 재고 이동</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr>
                <th className={C.th}>일자</th><th className={C.th}>구분</th><th className={C.th}>품목</th>
                <th className={C.th}>위치</th><th className={`${C.th} text-right`}>수량</th>
                <th className={C.th}>사유/참조</th><th className={C.th}>담당</th><th className={C.th}></th>
              </tr></thead>
              <tbody>
                {moves.length === 0 && <tr><td colSpan={8} className="text-center text-text-tertiary py-6 text-sm">이동 이력 없음</td></tr>}
                {moves.map((m) => {
                  const inc = (m.qty_delta || 0) >= 0;
                  const isDef = m.movement_type === 'defect' || m.movement_type === 'repair';
                  const badgeCls = m.movement_type === 'defect' ? 'bg-warning/10 text-warning'
                    : m.movement_type === 'repair' ? 'bg-success/10 text-success'
                    : inc ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger';
                  const qtyCls = isDef ? 'text-warning' : inc ? 'text-success' : 'text-danger';
                  return (
                    <tr key={m.id}>
                      <td className={C.td}>{m.movement_date}</td>
                      <td className={C.td}><span className={`px-1.5 py-0.5 rounded text-[11px] font-semibold ${badgeCls}`}>{MOVE_LABEL[m.movement_type] || m.movement_type}</span></td>
                      <td className={`${C.td} text-text-primary`}>{m.item_name}</td>
                      <td className={C.td}>{m.location_name}</td>
                      <td className={`${C.td} text-right tabular-nums font-semibold ${qtyCls}`}>{isDef ? '🔧' : inc ? '+' : ''}{fmt(m.qty_delta)} {m.item_unit || ''}</td>
                      <td className={`${C.td} text-[11px] text-text-tertiary max-w-[220px] truncate`}>{[m.reason, m.ref].filter(Boolean).join(' · ') || '-'}</td>
                      <td className={`${C.td} text-[11px] text-text-quaternary`}>{(m.created_by || '').split('@')[0]}</td>
                      <td className={C.td}><button onClick={() => removeMove(m.id)} className="text-[11px] text-text-quaternary hover:text-danger">삭제</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {itemModal && <AssetItemModal item={itemModal === 'new' ? null : itemModal} locs={locs} onClose={() => setItemModal(null)} onSaved={() => { setItemModal(null); load(); }} />}
      {moveModal && <AssetMoveModal item={moveModal.item} type={moveModal.type} locs={locs} onClose={() => setMoveModal(null)} onSaved={() => { setMoveModal(null); load(); }} />}
      {locModal && <AssetLocationModal locs={locs} onClose={() => setLocModal(false)} onChanged={load} />}
    </div>
  );
}

function AssetItemModal({ item, locs, onClose, onSaved }: { item: AssetItem | null; locs: AssetLoc[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<any>({
    id: item?.id, name: item?.name || '', code: item?.code || '', category: item?.category || '',
    spec: item?.spec || '', unit: item?.unit || 'ea', unit_cost: item?.unit_cost || 0,
    min_qty: item?.min_qty || 0, vendor: item?.vendor || '',
    default_location_id: item?.default_location_id || (locs[0]?.id ?? null),
    is_active: item?.is_active ?? true, notes: item?.notes || '',
  });
  const [saving, setSaving] = useState(false);
  const up = (k: string, v: any) => setF((p: any) => ({ ...p, [k]: v }));
  const save = async () => {
    if (!f.name.trim()) { alert('품목명을 입력하세요'); return; }
    setSaving(true);
    const r = await send('/purchase/assets/items', 'POST', { ...f, unit_cost: Number(f.unit_cost) || 0, min_qty: Number(f.min_qty) || 0 });
    setSaving(false);
    if (r.ok) onSaved(); else alert(r.data?.detail || '저장 실패');
  };
  const F = 'text-[11px] text-text-tertiary mb-1';
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className={`${C.card} p-5 w-full max-w-lg`} onClick={(e) => e.stopPropagation()}>
        <div className="text-base font-bold text-text-primary mb-4">{item ? '품목 수정' : '품목 등록'}</div>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2"><div className={F}>품목명 *</div><input value={f.name} onChange={(e) => up('name', e.target.value)} className={`${C.input} w-full`} placeholder="예: 라벨지 60mm" /></div>
          <div><div className={F}>관리코드</div><input value={f.code} onChange={(e) => up('code', e.target.value)} className={`${C.input} w-full`} placeholder="선택" /></div>
          <div><div className={F}>분류</div><input value={f.category} onChange={(e) => up('category', e.target.value)} className={`${C.input} w-full`} placeholder="부자재/소모품/비품…" /></div>
          <div><div className={F}>규격</div><input value={f.spec} onChange={(e) => up('spec', e.target.value)} className={`${C.input} w-full`} /></div>
          <div><div className={F}>단위</div><input value={f.unit} onChange={(e) => up('unit', e.target.value)} className={`${C.input} w-full`} placeholder="ea/box/kg" /></div>
          <div><div className={F}>평가단가(원)</div><input type="number" value={f.unit_cost} onChange={(e) => up('unit_cost', e.target.value)} className={`${C.input} w-full text-right`} /></div>
          <div><div className={F}>안전재고</div><input type="number" value={f.min_qty} onChange={(e) => up('min_qty', e.target.value)} className={`${C.input} w-full text-right`} placeholder="0=미설정" /></div>
          <div><div className={F}>기본 위치</div><select value={f.default_location_id ?? ''} onChange={(e) => up('default_location_id', e.target.value ? Number(e.target.value) : null)} className={`${C.input} w-full`}><option value="">-</option>{locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></div>
          <div><div className={F}>주 구매처</div><input value={f.vendor} onChange={(e) => up('vendor', e.target.value)} className={`${C.input} w-full`} placeholder="참고" /></div>
          <div className="col-span-2"><div className={F}>메모</div><input value={f.notes} onChange={(e) => up('notes', e.target.value)} className={`${C.input} w-full`} /></div>
          {item && <label className="col-span-2 flex items-center gap-2 text-sm text-text-secondary cursor-pointer"><input type="checkbox" checked={f.is_active} onChange={(e) => up('is_active', e.target.checked)} /> 활성</label>}
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className={`${C.btn} ${C.btnGhost}`}>취소</button>
          <button onClick={save} disabled={saving} className={`${C.btn} ${C.btnPrimary} disabled:opacity-50`}>{saving ? '저장 중…' : '저장'}</button>
        </div>
      </div>
    </div>
  );
}

function AssetMoveModal({ item, type, locs, onClose, onSaved }: { item: AssetItem; type: string; locs: AssetLoc[]; onClose: () => void; onSaved: () => void }) {
  const stockLocs = item.stock_by_location;
  const defectLoc = stockLocs.find((s) => (s.defect_qty || 0) > 0)?.location_id;
  const defLoc = (type === 'repair' ? (defectLoc || stockLocs[0]?.location_id)
    : type === 'in' ? (item.default_location_id || stockLocs[0]?.location_id)
    : (stockLocs[0]?.location_id || item.default_location_id)) || locs[0]?.id;
  const [f, setF] = useState<any>({
    location_id: defLoc, to_location_id: locs.find((l) => l.id !== defLoc)?.id ?? null,
    qty: '', movement_date: iso(new Date()), unit_cost: item.unit_cost || '', reason: '', ref: '',
  });
  const [saving, setSaving] = useState(false);
  const up = (k: string, v: any) => setF((p: any) => ({ ...p, [k]: v }));
  const title = MOVE_LABEL[type] || type;
  const isDefectMove = type === 'defect' || type === 'repair';
  const curStock = (lid: number) => stockLocs.find((s) => s.location_id === lid)?.qty ?? 0;
  const curDefect = (lid: number) => stockLocs.find((s) => s.location_id === lid)?.defect_qty ?? 0;
  const save = async () => {
    const qn = Number(f.qty);
    if (!qn) { alert('수량을 입력하세요'); return; }
    if (type === 'transfer' && f.location_id === f.to_location_id) { alert('출발/도착 위치가 같습니다'); return; }
    setSaving(true);
    const r = await send('/purchase/assets/movements', 'POST', {
      item_id: item.id, location_id: f.location_id, movement_type: type,
      qty: qn, to_location_id: type === 'transfer' ? f.to_location_id : undefined,
      movement_date: f.movement_date,
      unit_cost: type === 'in' && f.unit_cost !== '' ? Number(f.unit_cost) : undefined,
      reason: f.reason || undefined, ref: f.ref || undefined,
    });
    setSaving(false);
    if (r.ok) onSaved(); else alert(r.data?.detail || '실패');
  };
  const F = 'text-[11px] text-text-tertiary mb-1';
  const tone = type === 'in' ? 'text-success' : type === 'out' ? 'text-danger' : (type === 'adjust' || type === 'defect') ? 'text-warning' : type === 'repair' ? 'text-success' : 'text-info';
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className={`${C.card} p-5 w-full max-w-md`} onClick={(e) => e.stopPropagation()}>
        <div className="text-base font-bold mb-1"><span className={tone}>{title}</span> <span className="text-text-primary">— {item.name}</span></div>
        <div className="text-[11px] text-text-tertiary mb-4">현재 총재고 {fmt(item.total_qty)} {item.unit}{(item.defect_qty || 0) > 0 && <span className="text-warning"> · 🔧고장 {fmt(item.defect_qty)}</span>}{isDefectMove && <span className="block text-text-quaternary mt-0.5">※ 고장/수리는 총 보유수량은 그대로 두고 고장수량만 조정합니다(현장 존치).</span>}</div>
        <div className="grid grid-cols-2 gap-3">
          <div><div className={F}>{type === 'transfer' ? '출발 위치' : '위치'}</div><select value={f.location_id ?? ''} onChange={(e) => up('location_id', Number(e.target.value))} className={`${C.input} w-full`}>{locs.map((l) => <option key={l.id} value={l.id}>{l.name} {isDefectMove ? `(재고 ${fmt(curStock(l.id))} · 고장 ${fmt(curDefect(l.id))})` : `(${fmt(curStock(l.id))})`}</option>)}</select></div>
          {type === 'transfer' && <div><div className={F}>도착 위치</div><select value={f.to_location_id ?? ''} onChange={(e) => up('to_location_id', Number(e.target.value))} className={`${C.input} w-full`}>{locs.filter((l) => l.id !== f.location_id).map((l) => <option key={l.id} value={l.id}>{l.name} ({fmt(curStock(l.id))})</option>)}</select></div>}
          <div><div className={F}>수량 {type === 'adjust' ? '(±)' : type === 'defect' ? '(고장 대수)' : type === 'repair' ? '(수리 대수)' : ''}</div><input type="number" value={f.qty} onChange={(e) => up('qty', e.target.value)} className={`${C.input} w-full text-right`} placeholder={type === 'adjust' ? '증가+/감소−' : '수량'} autoFocus /></div>
          <div><div className={F}>일자</div><input type="date" value={f.movement_date} onChange={(e) => up('movement_date', e.target.value)} className={`${C.input} w-full`} /></div>
          {type === 'in' && <div className="col-span-2"><div className={F}>입고 단가(원, 선택)</div><input type="number" value={f.unit_cost} onChange={(e) => up('unit_cost', e.target.value)} className={`${C.input} w-full text-right`} placeholder="미입력 시 품목 평가단가" /></div>}
          <div className="col-span-2"><div className={F}>사유{(type === 'adjust' || isDefectMove) ? ' (권장)' : ''}</div><input value={f.reason} onChange={(e) => up('reason', e.target.value)} className={`${C.input} w-full`} placeholder={type === 'adjust' ? '실사 보정 등' : type === 'defect' ? '고장 증상·세부위치 등' : type === 'repair' ? '수리 내용·교체 등' : '선택'} /></div>
          <div className="col-span-2"><div className={F}>참조</div><input value={f.ref} onChange={(e) => up('ref', e.target.value)} className={`${C.input} w-full`} placeholder="발주번호/전표 등 (선택)" /></div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className={`${C.btn} ${C.btnGhost}`}>취소</button>
          <button onClick={save} disabled={saving} className={`${C.btn} ${C.btnPrimary} disabled:opacity-50`}>{saving ? '처리 중…' : `${title} 기록`}</button>
        </div>
      </div>
    </div>
  );
}

function AssetLocationModal({ locs, onClose, onChanged }: { locs: AssetLoc[]; onClose: () => void; onChanged: () => void }) {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const add = async () => {
    if (!name.trim()) return;
    setSaving(true);
    const r = await send('/purchase/assets/locations', 'POST', { name: name.trim(), sort_order: locs.length });
    setSaving(false);
    if (r.ok) { setName(''); onChanged(); } else alert(r.data?.detail || '실패');
  };
  const toggle = async (l: AssetLoc) => {
    const r = await send('/purchase/assets/locations', 'POST', { id: l.id, name: l.name, sort_order: l.sort_order, is_active: !l.is_active });
    if (r.ok) onChanged(); else alert(r.data?.detail || '실패');
  };
  const remove = async (l: AssetLoc) => {
    if (!confirm(`'${l.name}' 위치를 삭제할까요?\n(재고 이력이 있으면 비활성 처리됩니다)`)) return;
    const r = await send(`/purchase/assets/locations/${l.id}`, 'DELETE');
    if (r.ok) onChanged(); else alert(r.data?.detail || '실패');
  };
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className={`${C.card} p-5 w-full max-w-md`} onClick={(e) => e.stopPropagation()}>
        <div className="text-base font-bold text-text-primary mb-4">재고 위치(층) 관리</div>
        <div className="flex gap-2 mb-4">
          <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder="예: 공장 4층 / 외부창고" className={`${C.input} flex-1`} />
          <button onClick={add} disabled={saving} className={`${C.btn} ${C.btnPrimary} disabled:opacity-50`}>추가</button>
        </div>
        <div className="space-y-1.5">
          {locs.length === 0 && <div className="text-sm text-text-tertiary text-center py-4">위치 없음</div>}
          {locs.map((l) => (
            <div key={l.id} className={`flex items-center justify-between px-3 py-2 rounded-lg bg-bg-inset ${l.is_active ? '' : 'opacity-50'}`}>
              <span className="text-sm text-text-primary">{l.name}{!l.is_active && <span className="ml-1 text-[10px] text-text-quaternary">(비활성)</span>}</span>
              <div className="flex gap-2">
                <button onClick={() => toggle(l)} className="text-[11px] text-text-tertiary hover:text-text-primary">{l.is_active ? '비활성화' : '활성화'}</button>
                <button onClick={() => remove(l)} className="text-[11px] text-text-quaternary hover:text-danger">삭제</button>
              </div>
            </div>
          ))}
        </div>
        <div className="flex justify-end mt-5"><button onClick={onClose} className={`${C.btn} ${C.btnGhost}`}>닫기</button></div>
      </div>
    </div>
  );
}
