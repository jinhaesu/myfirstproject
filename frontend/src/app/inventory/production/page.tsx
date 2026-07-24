'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Navigation } from '@/components/layout/Navigation';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
  LineChart, Line,
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

// ── types ──
interface Warehouse { id: number; name: string; }
interface ProdRow { id: number; prod_date: string; worker: string; location: string; category: string; product_name: string; qty: number; hours: number; unit_price: number; prod_amount: number; unit_cost: number; total_cost: number; grade: string; matched: boolean; matched_name: string | null; batch_id: string; }
interface Batch { batch_id: string; count: number; qty: number; period: string; uploaded_at: string; }
interface ProdDash {
  record_count: number; total_qty: number; total_amount: number; total_cost: number; total_hours: number; cost_ratio: number;
  by_category: { category: string; qty: number; amount: number; cost: number }[];
  by_worker: { worker: string; qty: number; amount: number; hours: number }[];
  by_month: { month: string; qty: number; amount: number; cost: number }[];
  by_grade: { grade: string; qty: number }[];
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
const COLORS = ['#5E6AD2', '#27A644', '#F0BF00', '#00B8CC', '#EB5757', '#A855F7', '#F97316', '#14B8A6'];
const todayISO = () => new Date().toISOString().slice(0, 10);

function StatCard({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className={`${C.card} p-4`}>
      <div className="text-xs text-[#8A8F98] mb-1">{label}</div>
      <div className={`text-2xl font-bold ${tone || 'text-[#F7F8F8]'}`}>{value}</div>
      {sub && <div className="text-xs text-[#62666D] mt-1">{sub}</div>}
    </div>
  );
}

type Tab = '대시보드' | '실적 조회' | '업로드';

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
  const tabs: Tab[] = ['대시보드', '실적 조회', '업로드'];

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
        {tab === '업로드' && <UploadTab warehouses={warehouses} />}
      </main>
    </div>
  );
}

function DashTab() {
  const [start, setStart] = useState('2025-01-01');
  const [end, setEnd] = useState(todayISO());
  const [d, setD] = useState<ProdDash | null>(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    setD(await getJSON<ProdDash | null>(`/inventory/production/dashboard?start=${start}&end=${end}`, null));
    setLoading(false);
  }, [start, end]);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className={C.input} />
        <span className="text-[#62666D]">~</span>
        <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className={C.input} />
        {loading && <span className="text-xs text-[#62666D]">불러오는 중…</span>}
      </div>
      {d && d.record_count === 0 && (
        <div className={`${C.card} p-8 text-center text-sm text-[#62666D]`}>생산 데이터가 없습니다. [업로드] 탭에서 RAW-DATA 엑셀을 올려주세요.</div>
      )}
      {d && d.record_count > 0 && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <StatCard label="총 생산량 (낱개)" value={fmt(d.total_qty)} />
            <StatCard label="총 생산액" value={won(d.total_amount)} />
            <StatCard label="총 원가" value={won(d.total_cost)} tone="text-[#F0BF00]" />
            <StatCard label="원가율" value={`${d.cost_ratio}%`} tone={d.cost_ratio > 40 ? 'text-[#EB5757]' : 'text-[#3FBE5B]'} />
            <StatCard label="총 생산시간" value={`${fmt(d.total_hours)}h`} sub={`${fmt(d.record_count)}건`} />
          </div>

          <div className={`${C.card} p-4`}>
            <div className="text-sm font-semibold text-[#F7F8F8] mb-3">월별 생산 추이</div>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={d.by_month}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1A1B1E" />
                <XAxis dataKey="month" tick={{ fill: '#8A8F98', fontSize: 11 }} />
                <YAxis tick={{ fill: '#8A8F98', fontSize: 11 }} />
                <Tooltip contentStyle={{ background: '#0F1011', border: '1px solid #23252A', borderRadius: 8 }} formatter={(v: any) => fmt(v)} />
                <Line type="monotone" dataKey="qty" name="생산량" stroke="#5E6AD2" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="cost" name="원가" stroke="#F0BF00" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className={`${C.card} p-4`}>
              <div className="text-sm font-semibold text-[#F7F8F8] mb-3">품목류별 생산량</div>
              <ResponsiveContainer width="100%" height={260}>
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
              <div className="text-sm font-semibold text-[#F7F8F8] mb-3">담당자별 생산량 · 시간</div>
              <div className="overflow-x-auto max-h-[260px]">
                <table className="w-full">
                  <thead className="sticky top-0 bg-[#0F1011]"><tr><th className={C.th}>담당자</th><th className={C.th}>생산량</th><th className={C.th}>생산액</th><th className={C.th}>시간</th></tr></thead>
                  <tbody>
                    {d.by_worker.map((w) => (
                      <tr key={w.worker}><td className={`${C.td} text-[#F7F8F8]`}>{w.worker}</td><td className={C.td}>{fmt(w.qty)}</td><td className={C.td}>{won(w.amount)}</td><td className={C.td}>{fmt(w.hours)}h</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          <p className="text-xs text-[#62666D]">기간 {d.by_month[0]?.month ?? start} ~ {end} · {fmt(d.record_count)}건 집계</p>
        </>
      )}
    </div>
  );
}

function RecordsTab() {
  const [rows, setRows] = useState<ProdRow[]>([]);
  const [total, setTotal] = useState(0);
  const [start, setStart] = useState('2025-01-01');
  const [end, setEnd] = useState(todayISO());
  const [cat, setCat] = useState('');
  const [worker, setWorker] = useState('');
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    const qs = new URLSearchParams({ start, end, limit: '500' });
    if (cat) qs.set('category', cat);
    if (worker) qs.set('worker', worker);
    const r = await getJSON<{ rows: ProdRow[]; total: number }>(`/inventory/production?${qs}`, { rows: [], total: 0 });
    setRows(r.rows); setTotal(r.total); setLoading(false);
  }, [start, end, cat, worker]);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className={C.input} />
        <span className="text-[#62666D]">~</span>
        <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className={C.input} />
        <input value={cat} onChange={(e) => setCat(e.target.value)} placeholder="품목류" className={`${C.input} w-28`} />
        <input value={worker} onChange={(e) => setWorker(e.target.value)} placeholder="담당자" className={`${C.input} w-28`} />
        <span className="text-xs text-[#8A8F98] ml-auto">{loading ? '불러오는 중…' : `${fmt(rows.length)} / 총 ${fmt(total)}건`}</span>
      </div>
      <div className={`${C.card} overflow-x-auto max-h-[70vh]`}>
        <table className="w-full">
          <thead className="sticky top-0 bg-[#0F1011]"><tr>
            <th className={C.th}>생산일</th><th className={C.th}>담당자</th><th className={C.th}>위치</th><th className={C.th}>품목류</th>
            <th className={C.th}>품목명</th><th className={C.th}>생산량</th><th className={C.th}>생산액</th><th className={C.th}>원가총액</th>
            <th className={C.th}>등급</th><th className={C.th}>재고반영</th>
          </tr></thead>
          <tbody>
            {rows.length === 0 ? <tr><td colSpan={10} className="p-6 text-center text-[#62666D] text-sm">데이터 없음</td></tr> :
              rows.map((r) => (
                <tr key={r.id}>
                  <td className={C.td}>{r.prod_date}</td>
                  <td className={C.td}>{r.worker || '-'}</td>
                  <td className={C.td}>{r.location || '-'}</td>
                  <td className={`${C.td} text-[#F7F8F8]`}>{r.category}</td>
                  <td className={C.td}>{r.product_name}</td>
                  <td className={`${C.td} font-semibold`}>{fmt(r.qty)}</td>
                  <td className={C.td}>{won(r.prod_amount)}</td>
                  <td className={C.td}>{won(r.total_cost)}</td>
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
