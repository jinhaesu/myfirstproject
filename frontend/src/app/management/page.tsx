'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Navigation } from '@/components/layout/Navigation';
import { LoadingOverlay } from '@/components/LoadingOverlay';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, ComposedChart, Line, Legend } from 'recharts';

const getAuthHeaders = (): Record<string, string> => {
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) h['Authorization'] = `Bearer ${token}`;
  return h;
};
const getJSON = async <T,>(path: string, def: T): Promise<T> => { try { const r = await fetch(`/api${path}`, { headers: getAuthHeaders() }); if (!r.ok) throw new Error(); return await r.json(); } catch { return def; } };

const C = { card: 'bg-[#0F1011] border border-[#23252A] rounded-xl', input: 'bg-[#08090A] border border-[#23252A] rounded-lg px-3 py-2 text-sm text-[#F7F8F8] focus:outline-none focus:border-[#5E6AD2]', btn: 'px-3 py-2 rounded-lg text-sm font-semibold transition-colors', btnGhost: 'bg-[#1A1B1E] hover:bg-[#23252A] text-[#D0D6E0] border border-[#23252A]' };
const won = (n: number) => '₩' + Number(n || 0).toLocaleString('ko-KR');
const wonShort = (n: number) => { const a = Math.abs(n || 0); const s = n < 0 ? '-' : ''; if (a >= 1e8) return s + (a / 1e8).toFixed(1).replace(/\.0$/, '') + '억'; if (a >= 1e4) return s + Math.round(a / 1e4).toLocaleString('ko-KR') + '만'; return s + '₩' + Math.round(a).toLocaleString('ko-KR'); };
const fmt = (n: number) => Number(n || 0).toLocaleString('ko-KR');
const TT = { background: '#0F1011', border: '1px solid #23252A', borderRadius: 8, color: '#F7F8F8', fontSize: 12 } as const;
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const thisMonth = () => { const n = new Date(); return { start: iso(new Date(n.getFullYear(), n.getMonth(), 1)), end: iso(new Date(n.getFullYear(), n.getMonth() + 1, 0)) }; };
const presets = () => {
  const n = new Date();
  const ym = (y: number, m: number, d: number) => iso(new Date(y, m, d));
  return {
    당월: { start: ym(n.getFullYear(), n.getMonth(), 1), end: ym(n.getFullYear(), n.getMonth() + 1, 0) },
    전월: { start: ym(n.getFullYear(), n.getMonth() - 1, 1), end: ym(n.getFullYear(), n.getMonth(), 0) },
    '최근3개월': { start: ym(n.getFullYear(), n.getMonth() - 2, 1), end: iso(n) },
    올해: { start: ym(n.getFullYear(), 0, 1), end: iso(n) },
    전체: { start: '2025-01-01', end: iso(n) },
  } as Record<string, { start: string; end: string }>;
};

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return <div className={`${C.card} p-4`}><div className="text-[11px] text-[#8A8F98] mb-1 truncate">{label}</div><div className={`text-lg font-bold tabular-nums ${tone || 'text-[#F7F8F8]'}`}>{value}</div>{sub && <div className="text-[11px] text-[#62666D] mt-1 truncate">{sub}</div>}</div>;
}

export default function ManagementPage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const [draft, setDraft] = useState(thisMonth());   // 입력 중(미적용)
  const [range, setRange] = useState(thisMonth());    // 조회 적용된 기간
  const [gran, setGran] = useState<'day' | 'week' | 'month'>('month');
  const [d, setD] = useState<any>(null);
  const [tr, setTr] = useState<any>(null);
  const [lt, setLt] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const apply = (r: { start: string; end: string }) => { setDraft(r); setRange(r); };
  useEffect(() => { if (!isLoading && !user) router.replace('/login'); }, [isLoading, user, router]);
  useEffect(() => { if (!user) return; setLoading(true); getJSON<any>(`/management/overview?start=${range.start}&end=${range.end}`, null).then((r) => { setD(r); setLoading(false); }); }, [range, user]);
  useEffect(() => { if (!user) return; getJSON<any>(`/management/trend?start=${range.start}&end=${range.end}&granularity=${gran}`, null).then(setTr); }, [range, gran, user]);
  useEffect(() => { if (!user) return; getJSON<any>(`/management/labor-trend?start=${range.start}&end=${range.end}&granularity=${gran}`, null).then(setLt); }, [range, gran, user]);
  if (isLoading || !user) return <div className="min-h-screen bg-[#08090A]" />;

  const cp = d?.cost_vs_purchase, bp = d?.bom_vs_purchase, lb = d?.labor, iv = d?.inventory, adj = d?.adjustments;
  const costBars = cp ? [{ name: '매출원가추정', v: cp.cogs_est }, { name: '실제구매액', v: cp.purchase_actual }] : [];
  const laborBars = lb ? [
    { name: '생산 기입', v: lb.production.logged_hours }, { name: '생산 근무', v: lb.production.attendance_hours },
    { name: '물류 기입', v: lb.logistics.logged_hours }, { name: '물류 근무', v: lb.logistics.attendance_hours },
  ] : [];

  return (
    <div className="min-h-screen bg-[#08090A]">
      <Navigation />
      <main className="max-w-[1400px] mx-auto px-4 py-6 relative">
        <LoadingOverlay show={loading} />
        <div className="mb-4"><h1 className="text-xl font-bold text-[#F7F8F8]">경영관리 · 교차분석</h1><p className="text-sm text-[#8A8F98] mt-0.5">영업·구매·생산·물류·재고 데이터를 대조해 경영 관점의 gap·이상치를 요약합니다.</p></div>
        <div className="flex flex-wrap items-center gap-2 mb-1">
          {Object.entries(presets()).map(([k, v]) => { const on = range.start === v.start && range.end === v.end; return <button key={k} onClick={() => apply(v)} className={`${C.btn} ${on ? 'bg-[#5E6AD2] text-white' : C.btnGhost}`}>{k}</button>; })}
          <input type="date" value={draft.start} onChange={(e) => setDraft({ ...draft, start: e.target.value })} className={C.input} />
          <span className="text-[#62666D]">~</span>
          <input type="date" value={draft.end} onChange={(e) => setDraft({ ...draft, end: e.target.value })} className={C.input} />
          <button onClick={() => setRange(draft)} className={`${C.btn} bg-[#5E6AD2] text-white hover:bg-[#4d58bd] ${draft.start !== range.start || draft.end !== range.end ? 'ring-2 ring-[#5E6AD2]/50' : ''}`}>조회</button>
          <div className="flex gap-1 ml-auto"><span className="text-xs text-[#62666D] self-center mr-1">추이 단위</span>{(['day', 'week', 'month'] as const).map((g) => <button key={g} onClick={() => setGran(g)} className={`${C.btn} ${gran === g ? 'bg-[#5E6AD2] text-white' : C.btnGhost}`}>{g === 'day' ? '일' : g === 'week' ? '주' : '월'}</button>)}</div>
          {loading && <span className="text-xs text-[#62666D]">집계 중…</span>}
        </div>
        <p className="text-xs text-[#62666D] mb-4">기간·날짜를 바꾼 뒤 <b className="text-[#8A8F98]">조회</b>를 눌러야 반영됩니다(프리셋은 즉시 적용). 시작·종료일 모두 반영됩니다.</p>

        {/* 월별 추이 */}
        <div className={`${C.card} p-4 mb-5`}>
          <div className="text-sm font-semibold text-[#F7F8F8] mb-1">구매·원가·매출 추이 ({gran === 'day' ? '일별' : gran === 'week' ? '주별' : '월별'})</div>
          <p className="text-xs text-[#62666D] mb-3">실제구매 · 매출원가추정(판매수량×BOM원가) · BOM이론소요 · 매출을 기간별로 비교.</p>
          {tr?.series?.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}><ComposedChart data={tr.series}><CartesianGrid strokeDasharray="3 3" stroke="#1A1B1E" /><XAxis dataKey="bucket" tick={{ fill: '#8A8F98', fontSize: 10 }} /><YAxis yAxisId="l" tick={{ fill: '#8A8F98', fontSize: 10 }} tickFormatter={wonShort} /><YAxis yAxisId="r" orientation="right" tick={{ fill: '#27A644', fontSize: 10 }} tickFormatter={wonShort} /><Tooltip contentStyle={TT} formatter={(v: any) => won(v)} /><Legend wrapperStyle={{ fontSize: 11 }} /><Bar yAxisId="l" dataKey="purchase" name="실제구매" fill="#4DA3FF" radius={[3, 3, 0, 0]} /><Bar yAxisId="l" dataKey="cogs_est" name="매출원가추정" fill="#F0BF00" radius={[3, 3, 0, 0]} /><Bar yAxisId="l" dataKey="bom_req" name="BOM이론소요" fill="#A855F7" radius={[3, 3, 0, 0]} /><Line yAxisId="r" type="monotone" dataKey="sales" name="매출" stroke="#27A644" strokeWidth={2} dot={false} /></ComposedChart></ResponsiveContainer>
          ) : <div className="h-[220px] flex items-center justify-center text-sm text-[#62666D]">데이터 없음</div>}
        </div>

        {/* 매출원가율 추이 + 근무시간 추이 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-5">
          <div className={`${C.card} p-4`}>
            <div className="text-sm font-semibold text-[#F7F8F8] mb-1">매출원가율 추이 ({gran === 'day' ? '일별' : gran === 'week' ? '주별' : '월별'})</div>
            <p className="text-xs text-[#62666D] mb-3">실제구매액÷매출(구매기반 원가율) · 매출원가추정÷매출(BOM기반) 비교.</p>
            {tr?.series?.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}><ComposedChart data={tr.series}><CartesianGrid strokeDasharray="3 3" stroke="#1A1B1E" /><XAxis dataKey="bucket" tick={{ fill: '#8A8F98', fontSize: 10 }} /><YAxis tick={{ fill: '#8A8F98', fontSize: 10 }} tickFormatter={(v) => `${v}%`} domain={[0, 'auto']} /><Tooltip contentStyle={TT} formatter={(v: any) => v == null ? '-' : `${v}%`} /><Legend wrapperStyle={{ fontSize: 11 }} /><Bar dataKey="purchase_ratio" name="구매기반 원가율" fill="#4DA3FF" radius={[3, 3, 0, 0]} /><Line type="monotone" dataKey="cogs_ratio" name="BOM기반 원가율" stroke="#F0BF00" strokeWidth={2} dot={{ r: 3 }} /></ComposedChart></ResponsiveContainer>
            ) : <div className="h-[220px] flex items-center justify-center text-sm text-[#62666D]">데이터 없음</div>}
          </div>
          <div className={`${C.card} p-4`}>
            <div className="text-sm font-semibold text-[#F7F8F8] mb-1">근무시간 vs 기입시간 추이 ({gran === 'day' ? '일별' : gran === 'week' ? '주별' : '월별'})</div>
            <p className="text-xs text-[#62666D] mb-3">mysixth 근무시간 대비 생산·물류 일지 기입시간.</p>
            {lt?.series?.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}><ComposedChart data={lt.series}><CartesianGrid strokeDasharray="3 3" stroke="#1A1B1E" /><XAxis dataKey="bucket" tick={{ fill: '#8A8F98', fontSize: 10 }} /><YAxis tick={{ fill: '#8A8F98', fontSize: 10 }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} /><Tooltip contentStyle={TT} formatter={(v: any) => `${fmt(v)}h`} /><Legend wrapperStyle={{ fontSize: 11 }} /><Bar dataKey="prod_logged" name="생산 기입" fill="#5E6AD2" radius={[3, 3, 0, 0]} /><Bar dataKey="prod_att" name="생산 근무" fill="#00B8CC" radius={[3, 3, 0, 0]} /><Bar dataKey="logi_logged" name="물류 기입" fill="#A855F7" radius={[3, 3, 0, 0]} /><Bar dataKey="logi_att" name="물류 근무" fill="#F0BF00" radius={[3, 3, 0, 0]} /></ComposedChart></ResponsiveContainer>
            ) : <div className="h-[220px] flex items-center justify-center text-sm text-[#62666D]">데이터 없음</div>}
          </div>
        </div>

        {/* 핵심 요약 경보 */}
        {d?.alerts?.length > 0 && (
          <div className={`${C.card} p-4 mb-5`}>
            <div className="text-sm font-semibold text-[#F7F8F8] mb-2">핵심 요약</div>
            <div className="space-y-1.5">
              {d.alerts.map((a: any, i: number) => (
                <div key={i} className="flex items-start gap-2 text-sm">
                  <span className={`mt-0.5 text-xs px-1.5 py-0.5 rounded ${a.level === 'warn' ? 'bg-[#EB5757]/15 text-[#EB5757]' : 'bg-[#5E6AD2]/15 text-[#828FFF]'}`}>{a.level === 'warn' ? '주의' : '정보'}</span>
                  <span className="text-[#D0D6E0]">{a.text}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {d && d.alerts?.length === 0 && <div className={`${C.card} p-4 mb-5 text-sm text-[#3FBE5B]`}>✔ 기간 내 특이 gap·경보 없음</div>}

        {/* KPI */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
          <Stat label="순매출" value={wonShort(cp?.net_sales || 0)} tone="text-[#27A644]" />
          <Stat label="매출원가추정" value={wonShort(cp?.cogs_est || 0)} tone="text-[#F0BF00]" sub={cp?.cogs_ratio != null ? `매출比 ${cp.cogs_ratio}%` : ''} />
          <Stat label="실제 구매액" value={wonShort(cp?.purchase_actual || 0)} tone="text-[#4DA3FF]" sub={cp?.purchase_ratio != null ? `매출比 ${cp.purchase_ratio}%` : ''} />
          <Stat label="구매−원가 gap" value={wonShort(cp?.gap || 0)} tone={(cp?.gap || 0) >= 0 ? 'text-[#EB5757]' : 'text-[#3FBE5B]'} sub={(cp?.gap || 0) >= 0 ? '재고빌드/과다구매' : '재고소진'} />
          <Stat label="BOM소요 대비 구매" value={bp?.gap_pct != null ? `${bp.gap_pct}%` : '-'} tone="text-[#A855F7]" sub="이론소요 대비 gap" />
          <Stat label="마이너스 재고" value={`${fmt(iv?.negative_count || 0)}`} tone={(iv?.negative_count || 0) > 0 ? 'text-[#EB5757]' : 'text-[#F7F8F8]'} sub={`전체 ${fmt(iv?.product_count || 0)}품목`} />
        </div>

        {/* 1. 매출원가추정 vs 실제구매 · BOM소요 vs 구매 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-5">
          <div className={`${C.card} p-4`}>
            <div className="text-sm font-semibold text-[#F7F8F8] mb-1">① 매출기반 원가추정 vs 실제 원부재료 구매액</div>
            <p className="text-xs text-[#62666D] mb-3">판매수량×BOM원가(원가추정)와 실제 매입액 비교. 구매가 크면 재고 빌드업, 작으면 재고 소진.</p>
            {costBars.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}><BarChart data={costBars}><CartesianGrid strokeDasharray="3 3" stroke="#1A1B1E" /><XAxis dataKey="name" tick={{ fill: '#8A8F98', fontSize: 11 }} /><YAxis tick={{ fill: '#8A8F98', fontSize: 10 }} tickFormatter={wonShort} /><Tooltip contentStyle={TT} formatter={(v: any) => won(v)} /><Bar dataKey="v" radius={[4, 4, 0, 0]}>{costBars.map((_, i) => <Cell key={i} fill={i === 0 ? '#F0BF00' : '#4DA3FF'} />)}</Bar></BarChart></ResponsiveContainer>
            ) : <div className="h-[180px]" />}
            <div className="grid grid-cols-3 gap-2 mt-2 text-center">
              <div><div className="text-[11px] text-[#62666D]">원재료 구매</div><div className="text-sm text-[#4DA3FF] font-semibold">{wonShort(cp?.purchase_raw || 0)}</div></div>
              <div><div className="text-[11px] text-[#62666D]">부재료 구매</div><div className="text-sm text-[#F0BF00] font-semibold">{wonShort(cp?.purchase_sub || 0)}</div></div>
              <div><div className="text-[11px] text-[#62666D]">gap</div><div className={`text-sm font-semibold ${(cp?.gap || 0) >= 0 ? 'text-[#EB5757]' : 'text-[#3FBE5B]'}`}>{wonShort(cp?.gap || 0)}</div></div>
            </div>
          </div>
          <div className={`${C.card} p-4`}>
            <div className="text-sm font-semibold text-[#F7F8F8] mb-1">② 생산 BOM 이론소요 vs 실제 구매</div>
            <p className="text-xs text-[#62666D] mb-3">생산실적을 BOM으로 폭발한 이론 소요금액과 실제 매입액의 차이. gap이 크면 단가·수율·매핑 점검.</p>
            {bp ? (
              <ResponsiveContainer width="100%" height={220}><BarChart data={[{ name: 'BOM 이론소요', v: bp.bom_req_cost }, { name: '실제 구매액', v: bp.purchase_actual }]}><CartesianGrid strokeDasharray="3 3" stroke="#1A1B1E" /><XAxis dataKey="name" tick={{ fill: '#8A8F98', fontSize: 11 }} /><YAxis tick={{ fill: '#8A8F98', fontSize: 10 }} tickFormatter={wonShort} /><Tooltip contentStyle={TT} formatter={(v: any) => won(v)} /><Bar dataKey="v" radius={[4, 4, 0, 0]}><Cell fill="#A855F7" /><Cell fill="#4DA3FF" /></Bar></BarChart></ResponsiveContainer>
            ) : <div className="h-[180px]" />}
            <div className="text-center mt-2 text-xs text-[#8A8F98]">gap <span className={`${(bp?.gap || 0) >= 0 ? 'text-[#EB5757]' : 'text-[#3FBE5B]'} font-semibold`}>{wonShort(bp?.gap || 0)}</span> ({bp?.gap_pct != null ? `${bp.gap_pct}%` : '-'})</div>
          </div>
        </div>

        {/* 3. 근무시간 vs 기입시간 */}
        <div className={`${C.card} p-4 mb-5`}>
          <div className="text-sm font-semibold text-[#F7F8F8] mb-1">③ 근무시간(mysixth) vs 생산·물류 기입시간</div>
          <p className="text-xs text-[#62666D] mb-3">근태 실근무시간과 생산일보·물류일지에 기입된 투여시간의 괴리. 비율이 1에서 멀수록 기입 정확도 점검 필요.</p>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2">
              <ResponsiveContainer width="100%" height={220}><BarChart data={laborBars}><CartesianGrid strokeDasharray="3 3" stroke="#1A1B1E" /><XAxis dataKey="name" tick={{ fill: '#8A8F98', fontSize: 10 }} /><YAxis tick={{ fill: '#8A8F98', fontSize: 10 }} /><Tooltip contentStyle={TT} formatter={(v: any) => `${fmt(v)}h`} /><Bar dataKey="v" radius={[4, 4, 0, 0]}>{laborBars.map((_, i) => <Cell key={i} fill={i % 2 === 0 ? '#5E6AD2' : '#00B8CC'} />)}</Bar></BarChart></ResponsiveContainer>
            </div>
            <div className="space-y-3">
              {lb && [{ t: '생산', o: lb.production }, { t: '물류', o: lb.logistics }].map((x) => (
                <div key={x.t} className="border border-[#1A1B1E] rounded-lg p-3">
                  <div className="text-sm text-[#F7F8F8] font-medium mb-1">{x.t}팀</div>
                  <div className="text-xs text-[#8A8F98] flex justify-between"><span>기입시간</span><span className="text-[#828FFF]">{fmt(x.o.logged_hours)}h</span></div>
                  <div className="text-xs text-[#8A8F98] flex justify-between"><span>근무시간</span><span className="text-[#00B8CC]">{fmt(x.o.attendance_hours)}h</span></div>
                  <div className="text-xs text-[#8A8F98] flex justify-between"><span>기입/근무</span><span className={x.o.ratio < 0.7 || x.o.ratio > 1.3 ? 'text-[#EB5757] font-semibold' : 'text-[#3FBE5B]'}>{x.o.ratio}</span></div>
                  <div className="text-xs text-[#8A8F98] flex justify-between"><span>gap</span><span>{fmt(x.o.gap_hours)}h</span></div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 4 & 5. 재고 현황 + 조정 사유 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className={`${C.card} p-4`}>
            <div className="text-sm font-semibold text-[#F7F8F8] mb-1">④ 재고 현황 (기말)</div>
            <p className="text-xs text-[#62666D] mb-3">마이너스 재고는 기초재고 미입력 또는 채널→품목 매핑 누락 신호.</p>
            <div className="grid grid-cols-3 gap-2 mb-3 text-center">
              <Stat label="관리 품목" value={fmt(iv?.product_count || 0)} />
              <Stat label="마이너스" value={fmt(iv?.negative_count || 0)} tone={(iv?.negative_count || 0) > 0 ? 'text-[#EB5757]' : ''} />
              <Stat label="총 재고수량" value={fmt(iv?.total_qty || 0)} />
            </div>
            <div className="overflow-x-auto max-h-[220px] overflow-y-auto"><table className="w-full text-sm"><thead><tr><th className="text-left text-xs text-[#8A8F98] px-2 py-1 border-b border-[#23252A]">품목</th><th className="text-right text-xs text-[#8A8F98] px-2 py-1 border-b border-[#23252A]">재고</th></tr></thead>
              <tbody>{(iv?.top_negative || []).map((r: any, i: number) => (<tr key={i}><td className="px-2 py-1 text-[#D0D6E0] border-b border-[#1A1B1E]">{r.product}</td><td className="px-2 py-1 text-right text-[#EB5757] border-b border-[#1A1B1E]">{fmt(r.qty)}</td></tr>))}
                {(!iv?.top_negative || iv.top_negative.length === 0) && <tr><td colSpan={2} className="px-2 py-4 text-center text-[#62666D]">마이너스 재고 없음</td></tr>}</tbody></table></div>
          </div>
          <div className={`${C.card} p-4`}>
            <div className="text-sm font-semibold text-[#F7F8F8] mb-1">⑤ 재고 조정·실사보정 사유</div>
            <p className="text-xs text-[#62666D] mb-3">실사에서 실재고와 달라 조정된 이력과 사유. 순조정 {fmt(adj?.net_qty || 0)} · 총 {fmt(adj?.count || 0)}건.</p>
            <div className="overflow-x-auto max-h-[260px] overflow-y-auto"><table className="w-full text-sm"><thead><tr><th className="text-left text-xs text-[#8A8F98] px-2 py-1 border-b border-[#23252A]">일자</th><th className="text-left text-xs text-[#8A8F98] px-2 py-1 border-b border-[#23252A]">구분</th><th className="text-left text-xs text-[#8A8F98] px-2 py-1 border-b border-[#23252A]">품목</th><th className="text-right text-xs text-[#8A8F98] px-2 py-1 border-b border-[#23252A]">조정</th><th className="text-left text-xs text-[#8A8F98] px-2 py-1 border-b border-[#23252A]">사유</th></tr></thead>
              <tbody>{(adj?.items || []).map((r: any, i: number) => (<tr key={i}><td className="px-2 py-1 text-[#8A8F98] border-b border-[#1A1B1E] whitespace-nowrap">{r.date}</td><td className="px-2 py-1 border-b border-[#1A1B1E]"><span className={r.type === '실사보정' ? 'text-[#00B8CC]' : 'text-[#F0BF00]'}>{r.type}</span></td><td className="px-2 py-1 text-[#D0D6E0] border-b border-[#1A1B1E]">{r.product}</td><td className={`px-2 py-1 text-right border-b border-[#1A1B1E] ${r.qty_delta < 0 ? 'text-[#EB5757]' : 'text-[#3FBE5B]'}`}>{fmt(r.qty_delta)}</td><td className="px-2 py-1 text-[#8A8F98] border-b border-[#1A1B1E]">{r.reason}</td></tr>))}
                {(!adj?.items || adj.items.length === 0) && <tr><td colSpan={5} className="px-2 py-4 text-center text-[#62666D]">기간 내 조정 이력 없음</td></tr>}</tbody></table></div>
          </div>
        </div>
      </main>
    </div>
  );
}
