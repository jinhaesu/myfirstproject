'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Navigation } from '@/components/layout/Navigation';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, LineChart, Line } from 'recharts';

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
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const thisMonth = () => { const n = new Date(); return { start: iso(new Date(n.getFullYear(), n.getMonth(), 1)), end: iso(new Date(n.getFullYear(), n.getMonth() + 1, 0)) }; };
function StatCard({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return <div className={`${C.card} p-4`}><div className="text-[11px] text-[#8A8F98] mb-1 truncate">{label}</div><div className={`text-lg font-bold tabular-nums ${tone || 'text-[#F7F8F8]'}`}>{value}</div>{sub && <div className="text-[11px] text-[#62666D] mt-1">{sub}</div>}</div>;
}

interface MatReq { materials: { type: string; name: string; erp_code: string; qty: number; unit: string; unit_price: number; cost: number; vendor: string; material_id: number }[]; total_cost: number; raw_count: number; sub_count: number; by_vendor: { vendor: string; cost: number; items: number }[]; matched_qty: number; unmatched_qty: number; unmatched: { name: string; qty: number }[]; error?: string; }
interface Vendor { id: number; name: string; biz_no: string; contact: string; phone: string; email: string; category: string; lead_time_days: number; is_active: boolean; raw_materials: number; sub_materials: number; }
interface PO { id: number; po_no: string; vendor_name: string; order_date: string; expected_date: string; status: string; total_amount: number; line_count: number; lines: any[]; }

type Tab = '대시보드' | '원부재료 소요' | '거래처' | '발주';

export default function PurchasePage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('대시보드');
  useEffect(() => { if (!isLoading && !user) router.replace('/login'); }, [isLoading, user, router]);
  if (isLoading || !user) return <div className="min-h-screen bg-[#08090A]" />;
  const tabs: Tab[] = ['대시보드', '원부재료 소요', '거래처', '발주'];
  return (
    <div className="min-h-screen bg-[#08090A]">
      <Navigation />
      <main className="max-w-[1400px] mx-auto px-4 py-6">
        <div className="mb-4"><h1 className="text-xl font-bold text-[#F7F8F8]">구매 관리</h1><p className="text-sm text-[#8A8F98] mt-0.5">생산 실적 → BOM 원부재료 소요 → 거래처별 발주·분석.</p></div>
        <div className="flex gap-1 mb-5 border-b border-[#23252A]">{tabs.map((t) => <button key={t} onClick={() => setTab(t)} className={`px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px ${tab === t ? 'border-[#5E6AD2] text-[#828FFF]' : 'border-transparent text-[#8A8F98] hover:text-[#D0D6E0]'}`}>{t}</button>)}</div>
        {tab === '대시보드' && <DashTab />}
        {tab === '원부재료 소요' && <MatTab />}
        {tab === '거래처' && <VendorTab />}
        {tab === '발주' && <POTab />}
      </main>
    </div>
  );
}

function DashTab() {
  const [range, setRange] = useState(thisMonth());
  const [d, setD] = useState<any>(null);
  const [mr, setMr] = useState<MatReq | null>(null);
  useEffect(() => {
    getJSON<any>(`/purchase/dashboard?start=${range.start}&end=${range.end}`, null).then(setD);
    getJSON<MatReq | null>(`/purchase/material-requirement?start=${range.start}&end=${range.end}`, null).then(setMr);
  }, [range]);
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <input type="date" value={range.start} onChange={(e) => setRange({ ...range, start: e.target.value })} className={C.input} />
        <span className="text-[#62666D]">~</span>
        <input type="date" value={range.end} onChange={(e) => setRange({ ...range, end: e.target.value })} className={C.input} />
        <button onClick={() => setRange(thisMonth())} className={`${C.btn} ${C.btnGhost}`}>당월</button>
      </div>
      {mr && !mr.error && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="생산기반 소요원가" value={wonShort(mr.total_cost)} tone="text-[#F0BF00]" sub={`원재료 ${mr.raw_count}·부자재 ${mr.sub_count}`} />
          <StatCard label="발주 총액" value={wonShort(d?.total_amount || 0)} tone="text-[#00B8CC]" sub={`${fmt(d?.po_count || 0)}건`} />
          <StatCard label="소요 대비 발주" value={mr.total_cost ? `${Math.round((d?.total_amount || 0) / mr.total_cost * 100)}%` : '-'} sub="발주÷소요" />
          <StatCard label="거래처 수" value={fmt(mr.by_vendor.length)} sub="소요 발생" />
        </div>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className={`${C.card} p-4`}>
          <div className="text-sm font-semibold text-[#F7F8F8] mb-3">거래처별 소요원가 (생산기반)</div>
          {mr && mr.by_vendor.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}><BarChart data={mr.by_vendor.slice(0, 12)} layout="vertical" margin={{ left: 40 }}><CartesianGrid strokeDasharray="3 3" stroke="#1A1B1E" /><XAxis type="number" tick={{ fill: '#8A8F98', fontSize: 10 }} /><YAxis type="category" dataKey="vendor" tick={{ fill: '#8A8F98', fontSize: 10 }} width={100} /><Tooltip contentStyle={{ background: '#0F1011', border: '1px solid #23252A', borderRadius: 8 }} formatter={(v: any) => won(v)} /><Bar dataKey="cost" radius={[0, 4, 4, 0]}>{mr.by_vendor.slice(0, 12).map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}</Bar></BarChart></ResponsiveContainer>
          ) : <div className="h-[200px] flex items-center justify-center text-sm text-[#62666D]">데이터 없음</div>}
        </div>
        <div className={`${C.card} p-4`}>
          <div className="text-sm font-semibold text-[#F7F8F8] mb-3">월별 발주액</div>
          {d?.by_month?.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}><LineChart data={d.by_month}><CartesianGrid strokeDasharray="3 3" stroke="#1A1B1E" /><XAxis dataKey="month" tick={{ fill: '#8A8F98', fontSize: 10 }} /><YAxis tick={{ fill: '#8A8F98', fontSize: 10 }} /><Tooltip contentStyle={{ background: '#0F1011', border: '1px solid #23252A', borderRadius: 8 }} formatter={(v: any) => won(v)} /><Line type="monotone" dataKey="amount" name="발주액" stroke="#5E6AD2" strokeWidth={2} /></LineChart></ResponsiveContainer>
          ) : <div className="h-[200px] flex items-center justify-center text-sm text-[#62666D]">발주 데이터 없음 — [발주] 탭에서 등록</div>}
        </div>
      </div>
    </div>
  );
}

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
        <input type="date" value={range.start} onChange={(e) => setRange({ ...range, start: e.target.value })} className={C.input} />
        <span className="text-[#62666D]">~</span>
        <input type="date" value={range.end} onChange={(e) => setRange({ ...range, end: e.target.value })} className={C.input} />
        <button onClick={() => setRange(thisMonth())} className={`${C.btn} ${C.btnGhost}`}>당월</button>
        {loading && <span className="text-xs text-[#62666D]">계산 중…</span>}
        {mr && <span className="text-xs text-[#8A8F98] ml-auto">생산 매칭 {fmt(mr.matched_qty)} · 미매칭 {fmt(mr.unmatched_qty)}</span>}
      </div>
      {mr?.error && <div className="text-xs text-[#EB5757]">오류: {mr.error}</div>}
      {mr && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="총 소요원가" value={wonShort(mr.total_cost)} tone="text-[#F0BF00]" />
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

function VendorTab() {
  const [rows, setRows] = useState<Vendor[]>([]);
  const [form, setForm] = useState<any>({ name: '', category: '원재료', contact: '', phone: '', biz_no: '', lead_time_days: 0 });
  const load = useCallback(async () => { setRows((await getJSON<{ vendors: Vendor[] }>('/purchase/vendors', { vendors: [] })).vendors); }, []);
  useEffect(() => { load(); }, [load]);
  const seed = async () => { const r = await send('/purchase/vendors/seed', 'POST'); if (r.ok) { alert(`자재 공급처에서 ${r.data.added}개 거래처 생성`); load(); } };
  const save = async () => { if (!form.name.trim()) { alert('거래처명'); return; } const r = await send('/purchase/vendors', 'POST', { ...form, is_active: true }); if (r.ok) { setForm({ name: '', category: '원재료', contact: '', phone: '', biz_no: '', lead_time_days: 0 }); load(); } else alert('실패'); };
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
          <div><div className="text-xs text-[#8A8F98] mb-1">사업자번호</div><input value={form.biz_no} onChange={(e) => setForm({ ...form, biz_no: e.target.value })} className={`${C.input} w-32`} /></div>
          <div><div className="text-xs text-[#8A8F98] mb-1">리드타임(일)</div><input type="number" value={form.lead_time_days} onChange={(e) => setForm({ ...form, lead_time_days: Number(e.target.value) })} className={`${C.input} w-20`} /></div>
          <button onClick={save} className={`${C.btn} ${C.btnPrimary}`}>{form.id ? '수정' : '+ 추가'}</button>
        </div>
      </div>
      <div className={`${C.card} overflow-x-auto`}>
        <table className="w-full"><thead><tr><th className={C.th}>거래처</th><th className={C.th}>구분</th><th className={C.th}>담당자</th><th className={C.th}>연락처</th><th className={C.th}>사업자</th><th className={C.th}>리드타임</th><th className={C.th}>취급자재</th><th className={C.th}></th></tr></thead>
          <tbody>{rows.map((v) => (<tr key={v.id}><td className={`${C.td} text-[#F7F8F8] font-medium`}>{v.name}</td><td className={C.td}>{v.category || '-'}</td><td className={C.td}>{v.contact || '-'}</td><td className={C.td}>{v.phone || '-'}</td><td className={C.td}>{v.biz_no || '-'}</td><td className={C.td}>{v.lead_time_days}일</td><td className={C.td}>원 {v.raw_materials}·부 {v.sub_materials}</td><td className={C.td}><button onClick={() => setForm({ id: v.id, name: v.name, category: v.category, contact: v.contact, phone: v.phone, biz_no: v.biz_no, lead_time_days: v.lead_time_days })} className="text-[#828FFF] text-xs hover:underline mr-2">수정</button><button onClick={() => del(v.id)} className="text-[#EB5757] text-xs hover:underline">삭제</button></td></tr>))}</tbody></table>
      </div>
    </div>
  );
}

function POTab() {
  const [rows, setRows] = useState<PO[]>([]);
  const [range, setRange] = useState({ start: '2026-01-01', end: iso(new Date()) });
  const [open, setOpen] = useState<number | null>(null);
  const load = useCallback(async () => { setRows((await getJSON<{ orders: PO[] }>(`/purchase/orders?start=${range.start}&end=${range.end}`, { orders: [] })).orders); }, [range]);
  useEffect(() => { load(); }, [load]);
  const setStatus = async (id: number, status: string) => { const r = await send(`/purchase/orders/${id}/status?status=${encodeURIComponent(status)}`, 'PATCH'); if (r.ok) load(); };
  const del = async (id: number) => { if (!confirm('발주 삭제?')) return; const r = await send(`/purchase/orders/${id}`, 'DELETE'); if (r.ok) load(); };
  const STATUS = ['요청', '발주', '입고', '완료', '취소'];
  const badge: Record<string, string> = { 요청: 'text-[#F0BF00]', 발주: 'text-[#828FFF]', 입고: 'text-[#00B8CC]', 완료: 'text-[#3FBE5B]', 취소: 'text-[#EB5757]' };
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <input type="date" value={range.start} onChange={(e) => setRange({ ...range, start: e.target.value })} className={C.input} />
        <span className="text-[#62666D]">~</span>
        <input type="date" value={range.end} onChange={(e) => setRange({ ...range, end: e.target.value })} className={C.input} />
        <span className="text-xs text-[#62666D] ml-auto">{rows.length}건 · [원부재료 소요] 탭에서 거래처별 발주를 생성할 수 있습니다</span>
      </div>
      <div className={`${C.card} overflow-x-auto`}>
        <table className="w-full"><thead><tr><th className={C.th}>발주일</th><th className={C.th}>거래처</th><th className={C.th}>품목수</th><th className={C.th}>발주액</th><th className={C.th}>상태</th><th className={C.th}></th></tr></thead>
          <tbody>{rows.length === 0 ? <tr><td colSpan={6} className="p-6 text-center text-[#62666D] text-sm">발주 없음</td></tr> : rows.map((p) => (
            <>
              <tr key={p.id} className="hover:bg-[#0F1011] cursor-pointer" onClick={() => setOpen(open === p.id ? null : p.id)}>
                <td className={C.td}>{p.order_date}</td><td className={`${C.td} text-[#F7F8F8]`}>{p.vendor_name}</td><td className={C.td}>{p.line_count}</td><td className={`${C.td} text-[#F0BF00]`}>{won(p.total_amount)}</td>
                <td className={C.td}><select value={p.status} onClick={(e) => e.stopPropagation()} onChange={(e) => setStatus(p.id, e.target.value)} className={`bg-[#08090A] border border-[#23252A] rounded px-2 py-1 text-xs ${badge[p.status] || ''}`}>{STATUS.map((s) => <option key={s} value={s}>{s}</option>)}</select></td>
                <td className={C.td}><button onClick={(e) => { e.stopPropagation(); del(p.id); }} className="text-[#EB5757] text-xs hover:underline">삭제</button> <span className="text-[#62666D] text-xs ml-1">{open === p.id ? '▲' : '▼'}</span></td>
              </tr>
              {open === p.id && <tr key={`${p.id}-d`} className="bg-[#08090A]"><td colSpan={6} className="px-4 py-2 border-b border-[#1A1B1E]"><table className="w-full"><thead><tr><th className={C.th}>자재</th><th className={C.th}>소요량</th><th className={C.th}>단가</th><th className={C.th}>금액</th></tr></thead><tbody>{p.lines.map((l: any) => (<tr key={l.id}><td className={C.td}>{l.material_name}</td><td className={C.td}>{fmt(l.qty)}{l.unit}</td><td className={C.td}>{won(l.unit_price)}</td><td className={C.td}>{won(l.amount)}</td></tr>))}</tbody></table></td></tr>}
            </>
          ))}</tbody></table>
      </div>
    </div>
  );
}
