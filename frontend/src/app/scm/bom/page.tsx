'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Navigation } from '@/components/layout/Navigation';

// ─────────────────────────────────────────────
// API helpers
// ─────────────────────────────────────────────
const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';

const getAuthHeaders = () => {
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
};

const fetchSafe = async <T,>(path: string, defaultValue: T): Promise<T> => {
  try {
    const res = await fetch(`${API_BASE}${path}`, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error();
    return await res.json();
  } catch {
    return defaultValue;
  }
};

const postJson = async (path: string, body: unknown) => {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error();
    return await res.json();
  } catch {
    return null;
  }
};

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────
interface Item {
  id: number;
  product_name: string;
  product_category: string;
  item_type: string;
  flavor?: string;
  flavor_group?: string;
  unit_weight_g?: number;
}
interface BomLine {
  id: number;
  material_type: string;
  material_name: string;
  material_erp_code?: string;
  qty_per_unit: number;
  qty_unit?: string;
}
interface Component {
  id: number;
  child_item_id: number;
  qty: number;
  child_name?: string;
  child_type?: string;
}
interface ReqRaw { name: string; erp_code?: string; qty_kg: number; kg_price: number; cost: number; }
interface ReqSub { name: string; erp_code?: string; qty_ea: number; unit_price: number; cost: number; }
interface CartRow { item: Item; qty: number; }

const TYPE_TABS = ['세트', '완제품', '반제품', '원재료', '부자재'] as const;

// 다크 테마 타입 배지 색상
const TYPE_BADGE: Record<string, string> = {
  세트: 'bg-[#5E6AD2]/15 text-[#828FFF] border-[#5E6AD2]/30',
  완제품: 'bg-[#27A644]/10 text-[#27A644] border-[#27A644]/25',
  반제품: 'bg-[#F0BF00]/10 text-[#F0BF00] border-[#F0BF00]/30',
  원재료: 'bg-[#4DA3FF]/10 text-[#4DA3FF] border-[#4DA3FF]/25',
  부자재: 'bg-[#08090A] text-[#8A8F98] border-[#23252A]',
};
const won = (n: number) => `${Math.round(n).toLocaleString('ko-KR')}원`;

export default function BomPage() {
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();

  const [summary, setSummary] = useState<any>(null);
  const [tab, setTab] = useState<string>('세트');
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [rawList, setRawList] = useState<any[]>([]);
  const [subList, setSubList] = useState<any[]>([]);
  const [selected, setSelected] = useState<Item | null>(null);
  const [bom, setBom] = useState<{ bom_lines: BomLine[]; components: Component[] } | null>(null);
  const [cart, setCart] = useState<CartRow[]>([]);
  const [req, setReq] = useState<{ raw_materials: ReqRaw[]; sub_materials: ReqSub[]; total_material_cost: number; unresolved_semi: any[] } | null>(null);
  const [importing, setImporting] = useState(false);
  const [toast, setToast] = useState('');

  // ── Auth guard ──
  useEffect(() => {
    if (!authLoading && !user) router.push('/login');
  }, [authLoading, user, router]);

  const loadSummary = useCallback(async () => {
    const r = await fetchSafe<any>('/api/scm/bom/summary', null);
    if (r?.data) setSummary(r.data);
  }, []);

  const loadList = useCallback(async () => {
    if (tab === '원재료') {
      const r = await fetchSafe<any>(`/api/scm/materials/raw?search=${encodeURIComponent(search)}`, { data: [] });
      setRawList(r.data || []);
    } else if (tab === '부자재') {
      const r = await fetchSafe<any>(`/api/scm/materials/sub?search=${encodeURIComponent(search)}`, { data: [] });
      setSubList(r.data || []);
    } else {
      const r = await fetchSafe<any>(`/api/scm/products?item_type=${encodeURIComponent(tab)}&search=${encodeURIComponent(search)}&active_only=true`, { data: [] });
      setItems(r.data || []);
    }
  }, [tab, search]);

  useEffect(() => { if (user) loadSummary(); }, [user, loadSummary]);
  useEffect(() => { if (user) loadList(); }, [user, loadList]);

  const openItem = async (it: Item) => {
    setSelected(it);
    const r = await fetchSafe<any>(`/api/scm/items/${it.id}/bom`, null);
    setBom(r?.data || null);
  };

  const addToCart = (it: Item) => setCart((c) => c.find((x) => x.item.id === it.id) ? c : [...c, { item: it, qty: 100 }]);
  const setCartQty = (id: number, q: number) => setCart((c) => c.map((x) => x.item.id === id ? { ...x, qty: q } : x));
  const removeCart = (id: number) => setCart((c) => c.filter((x) => x.item.id !== id));

  const compute = async () => {
    if (!cart.length) return;
    const r = await postJson('/api/scm/production-requirement', { items: cart.map((c) => ({ item_id: c.item.id, qty: c.qty })) });
    if (r?.data) setReq(r.data);
  };

  const onImport = async (file: File) => {
    setImporting(true);
    setToast('');
    const fd = new FormData();
    fd.append('file', file);
    try {
      const res = await fetch(`${API_BASE}/api/scm/bom/import?replace=true`, {
        method: 'POST',
        headers: (() => { const h = getAuthHeaders(); delete h['Content-Type']; return h; })(),
        body: fd,
      });
      const j = await res.json();
      if (j?.success) {
        setToast(`적재 완료 — 원재료 ${j.report.raw_materials} · 부자재 ${j.report.sub_materials} · 시트 ${j.report.sheets.length}개`);
        loadSummary(); loadList();
      } else setToast('적재 실패');
    } catch { setToast('적재 실패'); }
    setImporting(false);
  };

  const inputCls = 'bg-[#08090A] border border-[#23252A] rounded-lg text-[#D0D6E0] placeholder-[#62666D] focus:outline-none focus:ring-2 focus:ring-[#5E6AD2]/20 focus:border-[#5E6AD2]/50';

  return (
    <div className="min-h-screen bg-[#08090A]">
      <Navigation />
      <main className="max-w-[1600px] mx-auto px-4 sm:px-6 py-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-[#F7F8F8]">BOM · 원부재료</h1>
            <p className="text-sm text-[#8A8F98] mt-1">제품별 배합비(BOM)·세트 구성 관리 및 판매·생산 수량 기반 원부재료 소요량 산출</p>
          </div>
          <label className={`inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg cursor-pointer transition ${importing ? 'bg-[#0F1011] text-[#62666D] border border-[#23252A]' : 'bg-[#5E6AD2] text-white hover:bg-[#828FFF] shadow-[0px_1px_3px_rgba(0,0,0,0.2)]'}`}>
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L7 8m4-4v12" /></svg>
            {importing ? '적재 중…' : 'BOM 엑셀 재업로드'}
            <input type="file" accept=".xlsx,.xls" className="hidden" disabled={importing}
              onChange={(e) => e.target.files?.[0] && onImport(e.target.files[0])} />
          </label>
        </div>
        {toast && <div className="mb-4 px-4 py-2.5 rounded-lg bg-[#27A644]/10 text-[#27A644] text-sm border border-[#27A644]/25">{toast}</div>}

        {/* Summary cards */}
        {summary && (
          <div className="grid grid-cols-3 md:grid-cols-7 gap-3 mb-6">
            {['세트', '완제품', '반제품'].map((k) => (
              <div key={k} className="bg-[#0F1011] rounded-xl border border-[#23252A] p-4">
                <p className="text-xs font-medium text-[#8A8F98] uppercase tracking-wider">{k}</p>
                <p className="text-2xl font-bold text-[#F7F8F8] mt-1">{summary.by_type?.[k] ?? 0}</p>
              </div>
            ))}
            <div className="bg-[#0F1011] rounded-xl border border-[#23252A] p-4">
              <p className="text-xs font-medium text-[#8A8F98] uppercase tracking-wider">원재료</p>
              <p className="text-2xl font-bold text-[#4DA3FF] mt-1">{summary.raw_materials}</p>
            </div>
            <div className="bg-[#0F1011] rounded-xl border border-[#23252A] p-4">
              <p className="text-xs font-medium text-[#8A8F98] uppercase tracking-wider">부자재</p>
              <p className="text-2xl font-bold text-[#D0D6E0] mt-1">{summary.sub_materials}</p>
            </div>
            <div className="bg-[#0F1011] rounded-xl border border-[#23252A] p-4">
              <p className="text-xs font-medium text-[#8A8F98] uppercase tracking-wider">BOM 라인</p>
              <p className="text-2xl font-bold text-[#F7F8F8] mt-1">{(summary.bom_lines ?? 0).toLocaleString('ko-KR')}</p>
            </div>
            <div className="bg-[#0F1011] rounded-xl border border-[#23252A] p-4">
              <p className="text-xs font-medium text-[#8A8F98] uppercase tracking-wider">구성</p>
              <p className="text-2xl font-bold text-[#F7F8F8] mt-1">{summary.components}</p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Left: list */}
          <div className="bg-[#0F1011] rounded-xl border border-[#23252A] p-4">
            <div className="flex gap-1.5 mb-3 flex-wrap">
              {TYPE_TABS.map((t) => (
                <button key={t} onClick={() => { setTab(t); setSelected(null); setBom(null); }}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border transition ${tab === t ? 'bg-[#5E6AD2] text-white border-[#5E6AD2]' : 'bg-[#0F1011] text-[#8A8F98] border-[#23252A] hover:bg-white/5'}`}>{t}</button>
              ))}
            </div>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="품목명 검색..."
              className={`w-full px-3 py-2 mb-3 text-sm ${inputCls}`} />
            <div className="max-h-[560px] overflow-auto divide-y divide-[#1A1B1E]">
              {tab === '원재료' && rawList.map((r) => (
                <div key={r.id} className="py-2 px-1 text-sm flex justify-between items-center">
                  <span className="text-[#D0D6E0] truncate">{r.name}</span>
                  <span className="text-[#4DA3FF] shrink-0 ml-2 text-xs">{won(r.kg_price)}/kg</span>
                </div>
              ))}
              {tab === '부자재' && subList.map((r) => (
                <div key={r.id} className="py-2 px-1 text-sm flex justify-between items-center">
                  <span className="text-[#D0D6E0] truncate">{r.name}</span>
                  <span className="text-[#8A8F98] shrink-0 ml-2 text-xs">{won(r.unit_price)}/ea</span>
                </div>
              ))}
              {!['원재료', '부자재'].includes(tab) && items.map((it) => (
                <div key={it.id} className={`py-2 px-2 flex items-center justify-between rounded-lg ${selected?.id === it.id ? 'bg-[#5E6AD2]/10' : 'hover:bg-white/5'}`}>
                  <button onClick={() => openItem(it)} className="text-left flex-1 min-w-0">
                    <div className="text-sm text-[#D0D6E0] truncate">{it.product_name}</div>
                    <div className="text-xs text-[#62666D]">{it.product_category}{it.flavor_group ? ` · ${it.flavor_group}` : ''}</div>
                  </button>
                  <button onClick={() => addToCart(it)} title="생산소요에 추가"
                    className="ml-2 text-xs px-2 py-1 rounded bg-[#5E6AD2]/10 text-[#828FFF] hover:bg-[#5E6AD2]/20 shrink-0">+담기</button>
                </div>
              ))}
              {!['원재료', '부자재'].includes(tab) && items.length === 0 && (
                <div className="py-12 text-center text-sm text-[#62666D]">품목이 없습니다.</div>
              )}
              {tab === '원재료' && rawList.length === 0 && <div className="py-12 text-center text-sm text-[#62666D]">원재료가 없습니다.</div>}
              {tab === '부자재' && subList.length === 0 && <div className="py-12 text-center text-sm text-[#62666D]">부자재가 없습니다.</div>}
            </div>
          </div>

          {/* Mid: BOM detail */}
          <div className="bg-[#0F1011] rounded-xl border border-[#23252A] p-4">
            {!selected && <div className="py-24 text-center text-sm text-[#62666D]">좌측에서 품목을 선택하면 BOM이 표시됩니다.</div>}
            {selected && (
              <>
                <div className="flex items-center gap-2 mb-4">
                  <span className={`text-xs px-2 py-0.5 rounded border ${TYPE_BADGE[selected.item_type] || 'bg-[#08090A] text-[#8A8F98] border-[#23252A]'}`}>{selected.item_type}</span>
                  <h3 className="font-bold text-[#F7F8F8]">{selected.product_name}</h3>
                </div>
                {bom?.components && bom.components.length > 0 && (
                  <div className="mb-5">
                    <div className="text-xs font-semibold text-[#8A8F98] uppercase tracking-wider mb-2">구성 품목 ({bom.components.length})</div>
                    <div className="space-y-1">
                      {bom.components.map((c) => (
                        <div key={c.id} className="flex justify-between text-sm py-1.5 px-2.5 rounded-lg bg-[#08090A] border border-[#1A1B1E]">
                          <span className="text-[#D0D6E0] truncate">{c.child_name}</span>
                          <span className="text-[#62666D] shrink-0 ml-2">×{c.qty}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {bom?.bom_lines && bom.bom_lines.length > 0 && (
                  <div>
                    <div className="text-xs font-semibold text-[#8A8F98] uppercase tracking-wider mb-2">자재 · 개당 투입량 ({bom.bom_lines.length})</div>
                    <table className="w-full text-sm">
                      <tbody>
                        {bom.bom_lines.map((b) => (
                          <tr key={b.id} className="border-b border-[#1A1B1E]">
                            <td className="py-1.5 text-[#D0D6E0]">{b.material_name}</td>
                            <td className="py-1.5 text-right text-[#8A8F98] whitespace-nowrap">
                              {b.material_type === 'raw' ? b.qty_per_unit.toFixed(5) : b.qty_per_unit}
                              <span className="text-[#62666D] ml-1">{b.qty_unit}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {bom && bom.components.length === 0 && bom.bom_lines.length === 0 && (
                  <div className="py-12 text-center text-sm text-[#62666D]">등록된 BOM이 없습니다.</div>
                )}
              </>
            )}
          </div>

          {/* Right: production requirement */}
          <div className="bg-[#0F1011] rounded-xl border border-[#23252A] p-4">
            <h3 className="font-bold text-[#F7F8F8] mb-1">생산소요 계산</h3>
            <p className="text-xs text-[#62666D] mb-3">세트·완제품을 담고 수량을 입력하면 원부재료 소요량·예상 재료원가를 산출합니다.</p>
            {cart.length === 0 && <div className="py-8 text-center text-xs text-[#62666D]">좌측 목록의 “+담기”로 추가하세요.</div>}
            <div className="space-y-2 mb-3">
              {cart.map((c) => (
                <div key={c.item.id} className="flex items-center gap-2">
                  <span className="text-sm text-[#D0D6E0] flex-1 truncate">{c.item.product_name}</span>
                  <input type="number" value={c.qty} onChange={(e) => setCartQty(c.item.id, Number(e.target.value))}
                    className={`w-20 px-2 py-1 text-sm text-right ${inputCls}`} />
                  <button onClick={() => removeCart(c.item.id)} className="text-[#62666D] hover:text-[#EB5757] text-sm">✕</button>
                </div>
              ))}
            </div>
            {cart.length > 0 && (
              <button onClick={compute} className="w-full py-2 rounded-lg bg-[#5E6AD2] text-white text-sm font-medium hover:bg-[#828FFF] transition mb-4">소요량 계산</button>
            )}
            {req && (
              <div>
                <div className="flex justify-between items-baseline mb-3 pb-3 border-b border-[#23252A]">
                  <span className="text-xs font-semibold text-[#8A8F98] uppercase tracking-wider">예상 재료원가</span>
                  <span className="text-xl font-bold text-[#F7F8F8]">{won(req.total_material_cost)}</span>
                </div>
                <div className="text-xs font-semibold text-[#4DA3FF] mb-1.5">원재료 {req.raw_materials.length}종</div>
                <div className="max-h-44 overflow-auto mb-3">
                  {req.raw_materials.map((r, i) => (
                    <div key={i} className="flex justify-between text-xs py-0.5">
                      <span className="text-[#8A8F98] truncate">{r.name}</span>
                      <span className="text-[#62666D] shrink-0 ml-2">{r.qty_kg.toFixed(2)}kg · {won(r.cost)}</span>
                    </div>
                  ))}
                </div>
                <div className="text-xs font-semibold text-[#D0D6E0] mb-1.5">부자재 {req.sub_materials.length}종</div>
                <div className="max-h-32 overflow-auto">
                  {req.sub_materials.map((r, i) => (
                    <div key={i} className="flex justify-between text-xs py-0.5">
                      <span className="text-[#8A8F98] truncate">{r.name}</span>
                      <span className="text-[#62666D] shrink-0 ml-2">{r.qty_ea.toFixed(0)}ea · {won(r.cost)}</span>
                    </div>
                  ))}
                </div>
                {req.unresolved_semi?.length > 0 && (
                  <div className="text-xs text-[#F0BF00] mt-2">미해결 반제품 {req.unresolved_semi.length}건 (매핑 확인 필요)</div>
                )}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
