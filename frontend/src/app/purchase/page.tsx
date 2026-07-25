'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Navigation } from '@/components/layout/Navigation';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, LineChart, Line, PieChart, Pie, Legend } from 'recharts';

const getAuthHeaders = (): Record<string, string> => {
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) h['Authorization'] = `Bearer ${token}`;
  return h;
};
const getJSON = async <T,>(path: string, def: T): Promise<T> => { try { const r = await fetch(`/api${path}`, { headers: getAuthHeaders() }); if (!r.ok) throw new Error(); return await r.json(); } catch { return def; } };
const send = async (path: string, method: string, body?: any) => { try { const r = await fetch(`/api${path}`, { method, headers: getAuthHeaders(), body: body !== undefined ? JSON.stringify(body) : undefined }); const data = await r.json().catch(() => ({})); return { ok: r.ok, data }; } catch { return { ok: false, data: {} }; } };

const C = { card: 'bg-[#0F1011] border border-[#23252A] rounded-xl', input: 'bg-[#08090A] border border-[#23252A] rounded-lg px-3 py-2 text-sm text-[#F7F8F8] focus:outline-none focus:border-[#5E6AD2]', btn: 'px-3 py-2 rounded-lg text-sm font-semibold transition-colors', btnPrimary: 'bg-[#5E6AD2] hover:bg-[#4d58bd] text-white', btnGhost: 'bg-[#1A1B1E] hover:bg-[#23252A] text-[#D0D6E0] border border-[#23252A]', th: 'text-left text-xs font-semibold text-[#8A8F98] px-3 py-2 border-b border-[#23252A] whitespace-nowrap', td: 'px-3 py-2 text-sm text-[#D0D6E0] border-b border-[#1A1B1E] whitespace-nowrap' };
const fmt = (n: number) => Number(n || 0).toLocaleString('ko-KR');
const won = (n: number) => '₩' + Number(n || 0).toLocaleString('ko-KR');
const wonShort = (n: number) => { const a = Math.abs(n || 0); if (a >= 1e8) return (n / 1e8).toFixed(1).replace(/\.0$/, '') + '억'; if (a >= 1e4) return Math.round(n / 1e4).toLocaleString('ko-KR') + '만'; return '₩' + Math.round(n || 0).toLocaleString('ko-KR'); };
const COLORS = ['#5E6AD2', '#27A644', '#F0BF00', '#00B8CC', '#EB5757', '#A855F7', '#F97316', '#14B8A6'];
const TT = { background: '#0F1011', border: '1px solid #23252A', borderRadius: 8, color: '#F7F8F8', fontSize: 12 } as const;
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const thisMonth = () => { const n = new Date(); return { start: iso(new Date(n.getFullYear(), n.getMonth(), 1)), end: iso(new Date(n.getFullYear(), n.getMonth() + 1, 0)) }; };
function StatCard({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return <div className={`${C.card} p-4`}><div className="text-[11px] text-[#8A8F98] mb-1 truncate">{label}</div><div className={`text-lg font-bold tabular-nums ${tone || 'text-[#F7F8F8]'}`}>{value}</div>{sub && <div className="text-[11px] text-[#62666D] mt-1 truncate">{sub}</div>}</div>;
}
function RangeBar({ range, setRange }: { range: any; setRange: (r: any) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input type="date" value={range.start} onChange={(e) => setRange({ ...range, start: e.target.value })} className={C.input} />
      <span className="text-[#62666D]">~</span>
      <input type="date" value={range.end} onChange={(e) => setRange({ ...range, end: e.target.value })} className={C.input} />
      <button onClick={() => setRange(thisMonth())} className={`${C.btn} ${C.btnGhost}`}>당월</button>
      <button onClick={() => setRange({ start: '2025-01-01', end: iso(new Date()) })} className={`${C.btn} ${C.btnGhost}`}>전체</button>
    </div>
  );
}

interface MatReq { materials: { type: string; name: string; erp_code: string; qty: number; unit: string; unit_price: number; cost: number; vendor: string; material_id: number }[]; total_cost: number; raw_count: number; sub_count: number; by_vendor: { vendor: string; cost: number; items: number }[]; matched_qty: number; unmatched_qty: number; unmatched: { name: string; qty: number }[]; error?: string; }
interface Vendor { id: number; name: string; biz_no: string; contact: string; phone: string; email: string; category: string; lead_time_days: number; is_active: boolean; raw_materials: number; sub_materials: number; }
interface PO { id: number; po_no: string; vendor_id: number; vendor_name: string; order_date: string; expected_date: string; status: string; total_amount: number; line_count: number; lines: any[]; }

type Tab = '실적 대시보드' | '실적 조회' | '원부재료 소요' | '거래처' | '발주';

export default function PurchasePage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('실적 대시보드');
  useEffect(() => { if (!isLoading && !user) router.replace('/login'); }, [isLoading, user, router]);
  if (isLoading || !user) return <div className="min-h-screen bg-[#08090A]" />;
  const tabs: Tab[] = ['실적 대시보드', '실적 조회', '원부재료 소요', '거래처', '발주'];
  return (
    <div className="min-h-screen bg-[#08090A]">
      <Navigation />
      <main className="max-w-[1400px] mx-auto px-4 py-6">
        <div className="mb-4"><h1 className="text-xl font-bold text-[#F7F8F8]">구매 관리</h1><p className="text-sm text-[#8A8F98] mt-0.5">구매일보 실적 분석 · 매출대비 구매비율 · 거래처/품목 이력 · 발주·발주서 발행.</p></div>
        <div className="flex gap-1 mb-5 border-b border-[#23252A] overflow-x-auto">{tabs.map((t) => <button key={t} onClick={() => setTab(t)} className={`px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px whitespace-nowrap ${tab === t ? 'border-[#5E6AD2] text-[#828FFF]' : 'border-transparent text-[#8A8F98] hover:text-[#D0D6E0]'}`}>{t}</button>)}</div>
        {tab === '실적 대시보드' && <DashTab />}
        {tab === '실적 조회' && <RecordsTab />}
        {tab === '원부재료 소요' && <MatTab />}
        {tab === '거래처' && <VendorTab />}
        {tab === '발주' && <POTab />}
      </main>
    </div>
  );
}

// ─────────────────────────────────────────────
// 실적 대시보드
// ─────────────────────────────────────────────
function DashTab() {
  const [range, setRange] = useState(thisMonth());
  const [gran, setGran] = useState<'day' | 'week' | 'month'>('day');
  const [d, setD] = useState<any>(null);
  const [ratio, setRatio] = useState<any>(null);
  useEffect(() => { getJSON<any>(`/purchase/records/dashboard?start=${range.start}&end=${range.end}`, null).then(setD); }, [range]);
  useEffect(() => { getJSON<any>(`/purchase/records/sales-ratio?start=${range.start}&end=${range.end}&granularity=${gran}`, null).then(setRatio); }, [range, gran]);
  const classData = (d?.by_class || []).map((x: any) => ({ name: x.mclass, value: x.supply }));
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <RangeBar range={range} setRange={setRange} />
        <div className="flex gap-1 ml-auto">{(['day', 'week', 'month'] as const).map((g) => <button key={g} onClick={() => setGran(g)} className={`${C.btn} ${gran === g ? C.btnPrimary : C.btnGhost}`}>{g === 'day' ? '일' : g === 'week' ? '주' : '월'}</button>)}</div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard label="구매액(공급가)" value={wonShort(d?.total_supply || 0)} tone="text-[#F0BF00]" sub={`${fmt(d?.line_count || 0)}건`} />
        <StatCard label="원재료" value={wonShort((d?.by_class || []).find((x: any) => x.mclass === '원재료')?.supply || 0)} tone="text-[#4DA3FF]" />
        <StatCard label="부재료" value={wonShort((d?.by_class || []).find((x: any) => x.mclass === '부재료')?.supply || 0)} tone="text-[#F0BF00]" />
        <StatCard label="매출액(순)" value={wonShort(d?.sales || 0)} tone="text-[#27A644]" />
        <StatCard label="구매/매출" value={d?.purchase_to_sales_ratio != null ? `${d.purchase_to_sales_ratio}%` : '-'} tone="text-[#A855F7]" sub="공급가÷순매출" />
        <StatCard label="거래처·품목" value={`${fmt(d?.vendor_count || 0)}·${fmt(d?.item_count || 0)}`} sub="거래처 · 품목수" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className={`${C.card} p-4`}>
          <div className="text-sm font-semibold text-[#F7F8F8] mb-3">원/부재료 구성</div>
          {classData.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}><PieChart><Pie data={classData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label={(e: any) => `${e.name} ${Math.round(e.percent * 100)}%`} labelLine={false}>{classData.map((_: any, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}</Pie><Tooltip contentStyle={TT} formatter={(v: any) => won(v)} /></PieChart></ResponsiveContainer>
          ) : <Empty />}
        </div>
        <div className={`${C.card} p-4 lg:col-span-2`}>
          <div className="text-sm font-semibold text-[#F7F8F8] mb-3">거래처별 구매액 (Top 12)</div>
          {d?.by_vendor?.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}><BarChart data={d.by_vendor.slice(0, 12)} layout="vertical" margin={{ left: 30 }}><CartesianGrid strokeDasharray="3 3" stroke="#1A1B1E" /><XAxis type="number" tick={{ fill: '#8A8F98', fontSize: 10 }} tickFormatter={wonShort} /><YAxis type="category" dataKey="vendor" tick={{ fill: '#8A8F98', fontSize: 10 }} width={110} /><Tooltip contentStyle={TT} formatter={(v: any) => won(v)} /><Bar dataKey="supply" radius={[0, 4, 4, 0]}>{d.by_vendor.slice(0, 12).map((_: any, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}</Bar></BarChart></ResponsiveContainer>
          ) : <Empty />}
        </div>
      </div>

      <div className={`${C.card} p-4`}>
        <div className="text-sm font-semibold text-[#F7F8F8] mb-3">매출 대비 구매 누적비율 · {gran === 'day' ? '일별' : gran === 'week' ? '주별' : '월별'} {ratio?.cum_ratio != null && <span className="text-[#A855F7] ml-2">기간 누적 {ratio.cum_ratio}%</span>}</div>
        {ratio?.series?.length > 0 ? (
          <ResponsiveContainer width="100%" height={300}><LineChart data={ratio.series}><CartesianGrid strokeDasharray="3 3" stroke="#1A1B1E" /><XAxis dataKey="bucket" tick={{ fill: '#8A8F98', fontSize: 10 }} /><YAxis yAxisId="l" tick={{ fill: '#8A8F98', fontSize: 10 }} tickFormatter={wonShort} /><YAxis yAxisId="r" orientation="right" tick={{ fill: '#A855F7', fontSize: 10 }} tickFormatter={(v) => `${v}%`} /><Tooltip contentStyle={TT} formatter={(v: any, n: any) => n.includes('비율') ? `${v}%` : won(v)} /><Legend wrapperStyle={{ fontSize: 11 }} /><Line yAxisId="l" type="monotone" dataKey="purchase" name="구매액" stroke="#F0BF00" strokeWidth={2} dot={false} /><Line yAxisId="l" type="monotone" dataKey="sales" name="매출액" stroke="#27A644" strokeWidth={2} dot={false} /><Line yAxisId="r" type="monotone" dataKey="cum_ratio" name="누적 구매/매출 비율" stroke="#A855F7" strokeWidth={2} dot={false} /></LineChart></ResponsiveContainer>
        ) : <Empty />}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className={`${C.card} p-4`}>
          <div className="text-sm font-semibold text-[#F7F8F8] mb-3">일별 구매액</div>
          {d?.by_day?.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}><BarChart data={d.by_day}><CartesianGrid strokeDasharray="3 3" stroke="#1A1B1E" /><XAxis dataKey="date" tick={{ fill: '#8A8F98', fontSize: 9 }} /><YAxis tick={{ fill: '#8A8F98', fontSize: 10 }} tickFormatter={wonShort} /><Tooltip contentStyle={TT} formatter={(v: any) => won(v)} /><Bar dataKey="supply" fill="#5E6AD2" radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer>
          ) : <Empty />}
        </div>
        <div className={`${C.card} p-4`}>
          <div className="text-sm font-semibold text-[#F7F8F8] mb-3">품목별 구매액 (Top 12)</div>
          {d?.by_item?.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}><BarChart data={d.by_item.slice(0, 12)} layout="vertical" margin={{ left: 30 }}><CartesianGrid strokeDasharray="3 3" stroke="#1A1B1E" /><XAxis type="number" tick={{ fill: '#8A8F98', fontSize: 10 }} tickFormatter={wonShort} /><YAxis type="category" dataKey="item_name" tick={{ fill: '#8A8F98', fontSize: 9 }} width={130} tickFormatter={(v) => String(v).slice(0, 14)} /><Tooltip contentStyle={TT} formatter={(v: any) => won(v)} /><Bar dataKey="supply" radius={[0, 4, 4, 0]}>{d.by_item.slice(0, 12).map((_: any, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}</Bar></BarChart></ResponsiveContainer>
          ) : <Empty />}
        </div>
      </div>
    </div>
  );
}
function Empty() { return <div className="h-[200px] flex items-center justify-center text-sm text-[#62666D]">데이터 없음</div>; }

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
        {data && <span className="text-xs text-[#8A8F98] ml-auto">{fmt(data.total)}건 · 공급가 {won(data.supply_total)}{data.total > 500 && ' (500건 표시)'}</span>}
      </div>
      <div className={`${C.card} overflow-x-auto`}>
        <table className="w-full"><thead><tr><th className={C.th}>일자</th><th className={C.th}>거래처</th><th className={C.th}>구분</th><th className={C.th}>품목</th><th className={C.th}>담당</th><th className={C.th}>수량</th><th className={C.th}>단가</th><th className={C.th}>공급가</th><th className={C.th}>합계</th></tr></thead>
          <tbody>{!data?.rows?.length ? <tr><td colSpan={9} className="p-6 text-center text-[#62666D] text-sm">데이터 없음</td></tr> : data.rows.map((r: any) => (
            <tr key={r.id} className="hover:bg-[#0F1011]">
              <td className={C.td}>{r.pdate}</td>
              <td className={`${C.td} text-[#F7F8F8]`}><button onClick={() => openVendor(r.vendor)} className="hover:text-[#828FFF] hover:underline text-left">{r.vendor}</button></td>
              <td className={C.td}><span className={r.mclass === '원재료' ? 'text-[#4DA3FF]' : 'text-[#F0BF00]'}>{r.mclass}</span></td>
              <td className={C.td}><button onClick={() => openItem(r.item_code, r.item_name)} className="hover:text-[#828FFF] hover:underline text-left">{r.item_name}</button></td>
              <td className={C.td}>{r.staff}</td><td className={C.td}>{fmt(r.qty)}{r.unit}</td><td className={C.td}>{won(r.unit_price)}</td><td className={`${C.td} text-[#F0BF00]`}>{won(r.supply)}</td><td className={C.td}>{won(r.total)}</td>
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
      <div className="relative bg-[#0F1011] border border-[#23252A] rounded-2xl w-full max-w-3xl max-h-[85vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div><div className="text-xs text-[#8A8F98]">{isVendor ? '거래처 누적 이력' : '품목 구매 이력'}</div><div className="text-lg font-bold text-[#F7F8F8]">{isVendor ? hist.vendor : hist.item_name}</div></div>
          <button onClick={onClose} className="text-[#8A8F98] hover:text-white text-xl">×</button>
        </div>
        <div className="grid grid-cols-3 gap-3 mb-4">
          <StatCard label="누적 구매액" value={wonShort(hist.total_supply || 0)} tone="text-[#F0BF00]" />
          <StatCard label="라인수" value={fmt(hist.line_count || 0)} />
          <StatCard label={isVendor ? '거래기간' : '누적수량'} value={isVendor ? `${hist.first || '-'}~` : fmt(hist.total_qty || 0)} sub={isVendor ? (hist.last || '') : ''} />
        </div>
        <div className="text-sm font-semibold text-[#F7F8F8] mb-2">월별 구매</div>
        <ResponsiveContainer width="100%" height={200}><BarChart data={hist.by_month || []}><CartesianGrid strokeDasharray="3 3" stroke="#1A1B1E" /><XAxis dataKey="month" tick={{ fill: '#8A8F98', fontSize: 10 }} /><YAxis tick={{ fill: '#8A8F98', fontSize: 10 }} tickFormatter={wonShort} /><Tooltip contentStyle={TT} formatter={(v: any) => won(v)} /><Bar dataKey="supply" fill="#5E6AD2" radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer>
        {!isVendor && hist.price_trend?.length > 1 && <>
          <div className="text-sm font-semibold text-[#F7F8F8] mt-4 mb-2">단가 추이</div>
          <ResponsiveContainer width="100%" height={180}><LineChart data={hist.price_trend}><CartesianGrid strokeDasharray="3 3" stroke="#1A1B1E" /><XAxis dataKey="date" tick={{ fill: '#8A8F98', fontSize: 9 }} /><YAxis tick={{ fill: '#8A8F98', fontSize: 10 }} tickFormatter={wonShort} /><Tooltip contentStyle={TT} formatter={(v: any) => won(v)} /><Line type="monotone" dataKey="unit_price" name="단가" stroke="#00B8CC" strokeWidth={2} dot={false} /></LineChart></ResponsiveContainer>
        </>}
        <div className="text-sm font-semibold text-[#F7F8F8] mt-4 mb-2">{isVendor ? '품목별' : '거래처별'}</div>
        <div className="overflow-x-auto"><table className="w-full"><thead><tr><th className={C.th}>{isVendor ? '품목' : '거래처'}</th>{isVendor && <th className={C.th}>수량</th>}<th className={C.th}>구매액</th></tr></thead>
          <tbody>{(isVendor ? hist.by_item : hist.by_vendor || []).slice(0, 20).map((x: any, i: number) => (<tr key={i}><td className={`${C.td} text-[#D0D6E0]`}>{isVendor ? x.item_name : x.vendor}</td>{isVendor && <td className={C.td}>{fmt(x.qty)}</td>}<td className={`${C.td} text-[#F0BF00]`}>{won(x.supply)}</td></tr>))}</tbody></table></div>
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
        <RangeBar range={range} setRange={setRange} />
        {loading && <span className="text-xs text-[#62666D]">계산 중…</span>}
        {mr && <span className="text-xs text-[#8A8F98] ml-auto">생산 매칭 {fmt(mr.matched_qty)} · 미매칭 {fmt(mr.unmatched_qty)}</span>}
      </div>
      <p className="text-xs text-[#62666D]">생산 실적을 BOM으로 폭발한 <b className="text-[#8A8F98]">이론 소요(계획)</b>입니다. 실제 매입은 [실적 대시보드/조회]에서 확인하세요.</p>
      {mr?.error && <div className="text-xs text-[#EB5757]">오류: {mr.error}</div>}
      {mr && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="총 소요원가(이론)" value={wonShort(mr.total_cost)} tone="text-[#F0BF00]" />
            <StatCard label="원재료 종류" value={fmt(mr.raw_count)} />
            <StatCard label="부자재 종류" value={fmt(mr.sub_count)} />
            <StatCard label="거래처 수" value={fmt(mr.by_vendor.length)} />
          </div>
          <div className={`${C.card} p-4`}>
            <div className="text-sm font-semibold text-[#F7F8F8] mb-3">거래처별 소요 (클릭 시 자재 상세 · 발주 생성)</div>
            <div className="overflow-x-auto">
              <table className="w-full"><thead><tr><th className={C.th}>거래처</th><th className={C.th}>자재수</th><th className={C.th}>소요원가</th><th className={C.th}></th></tr></thead>
                <tbody>{mr.by_vendor.map((v) => (
                  <>
                    <tr key={v.vendor} className="hover:bg-[#0F1011] cursor-pointer" onClick={() => setOpenVendor(openVendor === v.vendor ? null : v.vendor)}>
                      <td className={`${C.td} text-[#F7F8F8] font-medium`}>{v.vendor}</td><td className={C.td}>{v.items}</td><td className={`${C.td} text-[#F0BF00]`}>{won(v.cost)}</td>
                      <td className={C.td}><button onClick={(e) => { e.stopPropagation(); createPO(v.vendor); }} className="text-[#828FFF] text-xs hover:underline">발주 생성</button> <span className="text-[#62666D] text-xs ml-2">{openVendor === v.vendor ? '▲' : '▼'}</span></td>
                    </tr>
                    {openVendor === v.vendor && (
                      <tr key={`${v.vendor}-d`} className="bg-[#08090A]"><td colSpan={4} className="px-4 py-2 border-b border-[#1A1B1E]">
                        <table className="w-full"><thead><tr><th className={C.th}>자재</th><th className={C.th}>ERP</th><th className={C.th}>소요량</th><th className={C.th}>단가</th><th className={C.th}>원가</th></tr></thead>
                          <tbody>{mr.materials.filter((m) => m.vendor === v.vendor).map((m, i) => (<tr key={i}><td className={`${C.td} text-[#D0D6E0]`}><span className={m.type === 'raw' ? 'text-[#4DA3FF]' : 'text-[#F0BF00]'}>[{m.type === 'raw' ? '원' : '부'}]</span> {m.name}</td><td className={C.td}>{m.erp_code || '-'}</td><td className={C.td}>{fmt(m.qty)}{m.unit}</td><td className={C.td}>{won(m.unit_price)}</td><td className={C.td}>{won(m.cost)}</td></tr>))}</tbody></table>
                      </td></tr>
                    )}
                  </>
                ))}</tbody></table>
            </div>
          </div>
          {mr.unmatched.length > 0 && <div className="text-xs text-[#F0BF00]">미매칭 생산 품목(BOM 연결 안됨): {mr.unmatched.slice(0, 8).map((u) => `${u.name}(${fmt(u.qty)})`).join(', ')} … → SCM 품목관리에서 BOM 연결 필요</div>}
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
        <div className="flex items-center justify-between mb-3"><div className="text-sm font-semibold text-[#F7F8F8]">거래처 ({rows.length})</div><button onClick={seed} className={`${C.btn} ${C.btnGhost}`}>자재 공급처에서 가져오기</button></div>
        <div className="flex flex-wrap items-end gap-2">
          <div><div className="text-xs text-[#8A8F98] mb-1">거래처명 *</div><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={`${C.input} w-40`} /></div>
          <div><div className="text-xs text-[#8A8F98] mb-1">구분</div><select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className={C.input}><option>원재료</option><option>부자재</option><option>포장</option><option>기타</option></select></div>
          <div><div className="text-xs text-[#8A8F98] mb-1">담당자</div><input value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} className={`${C.input} w-24`} /></div>
          <div><div className="text-xs text-[#8A8F98] mb-1">연락처</div><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={`${C.input} w-32`} /></div>
          <div><div className="text-xs text-[#8A8F98] mb-1">이메일(발주서)</div><input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={`${C.input} w-44`} /></div>
          <div><div className="text-xs text-[#8A8F98] mb-1">사업자번호</div><input value={form.biz_no} onChange={(e) => setForm({ ...form, biz_no: e.target.value })} className={`${C.input} w-32`} /></div>
          <div><div className="text-xs text-[#8A8F98] mb-1">리드타임(일)</div><input type="number" value={form.lead_time_days} onChange={(e) => setForm({ ...form, lead_time_days: Number(e.target.value) })} className={`${C.input} w-20`} /></div>
          <button onClick={save} className={`${C.btn} ${C.btnPrimary}`}>{form.id ? '수정' : '+ 추가'}</button>
          {form.id && <button onClick={() => setForm({ name: '', category: '원재료', contact: '', phone: '', email: '', biz_no: '', lead_time_days: 0 })} className={`${C.btn} ${C.btnGhost}`}>취소</button>}
        </div>
      </div>
      <div className={`${C.card} overflow-x-auto`}>
        <table className="w-full"><thead><tr><th className={C.th}>거래처</th><th className={C.th}>구분</th><th className={C.th}>담당자</th><th className={C.th}>연락처</th><th className={C.th}>이메일</th><th className={C.th}>사업자</th><th className={C.th}>리드타임</th><th className={C.th}>취급자재</th><th className={C.th}></th></tr></thead>
          <tbody>{rows.map((v) => (<tr key={v.id}><td className={`${C.td} text-[#F7F8F8] font-medium`}>{v.name}</td><td className={C.td}>{v.category || '-'}</td><td className={C.td}>{v.contact || '-'}</td><td className={C.td}>{v.phone || '-'}</td><td className={C.td}>{v.email || <span className="text-[#62666D]">미등록</span>}</td><td className={C.td}>{v.biz_no || '-'}</td><td className={C.td}>{v.lead_time_days}일</td><td className={C.td}>원 {v.raw_materials}·부 {v.sub_materials}</td><td className={C.td}><button onClick={() => setForm({ id: v.id, name: v.name, category: v.category, contact: v.contact, phone: v.phone, email: v.email, biz_no: v.biz_no, lead_time_days: v.lead_time_days })} className="text-[#828FFF] text-xs hover:underline mr-2">수정</button><button onClick={() => del(v.id)} className="text-[#EB5757] text-xs hover:underline">삭제</button></td></tr>))}</tbody></table>
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
  const badge: Record<string, string> = { 요청: 'text-[#F0BF00]', 발주: 'text-[#828FFF]', 입고: 'text-[#00B8CC]', 완료: 'text-[#3FBE5B]', 취소: 'text-[#EB5757]' };
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <input type="date" value={range.start} onChange={(e) => setRange({ ...range, start: e.target.value })} className={C.input} />
        <span className="text-[#62666D]">~</span>
        <input type="date" value={range.end} onChange={(e) => setRange({ ...range, end: e.target.value })} className={C.input} />
        <span className="text-xs text-[#62666D] ml-auto">{rows.length}건 · [원부재료 소요] 탭에서 거래처별 발주 생성 → 여기서 발주서 발행</span>
      </div>
      <div className={`${C.card} overflow-x-auto`}>
        <table className="w-full"><thead><tr><th className={C.th}>발주일</th><th className={C.th}>거래처</th><th className={C.th}>품목수</th><th className={C.th}>발주액</th><th className={C.th}>상태</th><th className={C.th}></th></tr></thead>
          <tbody>{rows.length === 0 ? <tr><td colSpan={6} className="p-6 text-center text-[#62666D] text-sm">발주 없음</td></tr> : rows.map((p) => (
            <>
              <tr key={p.id} className="hover:bg-[#0F1011] cursor-pointer" onClick={() => setOpen(open === p.id ? null : p.id)}>
                <td className={C.td}>{p.order_date}</td><td className={`${C.td} text-[#F7F8F8]`}>{p.vendor_name}</td><td className={C.td}>{p.line_count}</td><td className={`${C.td} text-[#F0BF00]`}>{won(p.total_amount)}</td>
                <td className={C.td}><select value={p.status} onClick={(e) => e.stopPropagation()} onChange={(e) => setStatus(p.id, e.target.value)} className={`bg-[#08090A] border border-[#23252A] rounded px-2 py-1 text-xs ${badge[p.status] || ''}`}>{STATUS.map((s) => <option key={s} value={s}>{s}</option>)}</select></td>
                <td className={C.td}><button onClick={(e) => { e.stopPropagation(); issue(p); }} className="text-[#27A644] text-xs hover:underline mr-2">발주서 발행</button><button onClick={(e) => { e.stopPropagation(); del(p.id); }} className="text-[#EB5757] text-xs hover:underline">삭제</button> <span className="text-[#62666D] text-xs ml-1">{open === p.id ? '▲' : '▼'}</span></td>
              </tr>
              {open === p.id && <tr key={`${p.id}-d`} className="bg-[#08090A]"><td colSpan={6} className="px-4 py-2 border-b border-[#1A1B1E]"><table className="w-full"><thead><tr><th className={C.th}>자재</th><th className={C.th}>소요량</th><th className={C.th}>단가</th><th className={C.th}>금액</th></tr></thead><tbody>{p.lines.map((l: any) => (<tr key={l.id}><td className={C.td}>{l.material_name}</td><td className={C.td}>{fmt(l.qty)}{l.unit}</td><td className={C.td}>{won(l.unit_price)}</td><td className={C.td}>{won(l.amount)}</td></tr>))}</tbody></table></td></tr>}
            </>
          ))}</tbody></table>
      </div>
    </div>
  );
}
