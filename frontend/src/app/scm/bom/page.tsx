'use client';

import { useEffect, useState, useCallback } from 'react';
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
const TYPE_COLORS: Record<string, string> = {
  세트: 'bg-purple-100 text-purple-700',
  완제품: 'bg-emerald-100 text-emerald-700',
  반제품: 'bg-amber-100 text-amber-700',
  원재료: 'bg-sky-100 text-sky-700',
  부자재: 'bg-slate-100 text-slate-600',
};
const won = (n: number) => `${Math.round(n).toLocaleString()}원`;

export default function BomPage() {
  const { } = useAuth();
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

  const loadSummary = useCallback(async () => {
    const r = await fetchSafe<any>('/scm/bom/summary', null);
    if (r?.data) setSummary(r.data);
  }, []);

  const loadList = useCallback(async () => {
    if (tab === '원재료') {
      const r = await fetchSafe<any>(`/scm/materials/raw?search=${encodeURIComponent(search)}`, { data: [] });
      setRawList(r.data || []);
    } else if (tab === '부자재') {
      const r = await fetchSafe<any>(`/scm/materials/sub?search=${encodeURIComponent(search)}`, { data: [] });
      setSubList(r.data || []);
    } else {
      const r = await fetchSafe<any>(`/scm/products?item_type=${encodeURIComponent(tab)}&search=${encodeURIComponent(search)}&active_only=true`, { data: [] });
      setItems(r.data || []);
    }
  }, [tab, search]);

  useEffect(() => { loadSummary(); }, [loadSummary]);
  useEffect(() => { loadList(); }, [loadList]);

  const openItem = async (it: Item) => {
    setSelected(it);
    const r = await fetchSafe<any>(`/scm/items/${it.id}/bom`, null);
    setBom(r?.data || null);
  };

  const addToCart = (it: Item) => {
    setCart((c) => c.find((x) => x.item.id === it.id) ? c : [...c, { item: it, qty: 100 }]);
  };
  const setCartQty = (id: number, q: number) => setCart((c) => c.map((x) => x.item.id === id ? { ...x, qty: q } : x));
  const removeCart = (id: number) => setCart((c) => c.filter((x) => x.item.id !== id));

  const compute = async () => {
    if (!cart.length) return;
    const r = await postJson('/scm/production-requirement', { items: cart.map((c) => ({ item_id: c.item.id, qty: c.qty })) });
    if (r?.data) setReq(r.data);
  };

  const onImport = async (file: File) => {
    setImporting(true);
    setToast('');
    const fd = new FormData();
    fd.append('file', file);
    try {
      const res = await fetch(`${API_BASE}/scm/bom/import?replace=true`, {
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

  return (
    <div className="min-h-screen bg-[#F7F8FA]">
      <Navigation />
      <main className="max-w-[1500px] mx-auto px-6 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-xl font-bold text-gray-900">BOM · 원부재료 관리</h1>
            <p className="text-sm text-gray-500 mt-0.5">제품별 배합비(BOM)와 세트·혼합 구성을 관리하고, 판매·생산 수량으로 원부재료 소요량을 산출합니다.</p>
          </div>
          <label className={`px-4 py-2 rounded-lg text-sm font-medium cursor-pointer ${importing ? 'bg-gray-200 text-gray-400' : 'bg-gray-900 text-white hover:bg-gray-800'}`}>
            {importing ? '적재 중…' : 'BOM 엑셀 재업로드'}
            <input type="file" accept=".xlsx,.xls" className="hidden" disabled={importing}
              onChange={(e) => e.target.files?.[0] && onImport(e.target.files[0])} />
          </label>
        </div>
        {toast && <div className="mb-4 px-4 py-2 rounded-lg bg-emerald-50 text-emerald-700 text-sm border border-emerald-200">{toast}</div>}

        {/* Summary cards */}
        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-7 gap-3 mb-6">
            {Object.entries(summary.by_type || {}).map(([k, v]) => (
              <div key={k} className="bg-white rounded-xl p-3 border border-gray-100">
                <div className="text-xs text-gray-500">{k}</div>
                <div className="text-lg font-bold text-gray-900">{v as number}</div>
              </div>
            ))}
            <div className="bg-white rounded-xl p-3 border border-gray-100">
              <div className="text-xs text-gray-500">원재료</div>
              <div className="text-lg font-bold text-sky-600">{summary.raw_materials}</div>
            </div>
            <div className="bg-white rounded-xl p-3 border border-gray-100">
              <div className="text-xs text-gray-500">부자재</div>
              <div className="text-lg font-bold text-slate-600">{summary.sub_materials}</div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: list */}
          <div className="bg-white rounded-2xl border border-gray-100 p-4">
            <div className="flex gap-1 mb-3 flex-wrap">
              {TYPE_TABS.map((t) => (
                <button key={t} onClick={() => { setTab(t); setSelected(null); setBom(null); }}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium ${tab === t ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>{t}</button>
              ))}
            </div>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="검색…"
              className="w-full px-3 py-2 mb-3 rounded-lg border border-gray-200 text-sm" />
            <div className="max-h-[560px] overflow-auto divide-y divide-gray-50">
              {tab === '원재료' && rawList.map((r) => (
                <div key={r.id} className="py-2 px-1 text-sm flex justify-between">
                  <span className="text-gray-800 truncate">{r.name}</span>
                  <span className="text-sky-600 shrink-0 ml-2">{won(r.kg_price)}/kg</span>
                </div>
              ))}
              {tab === '부자재' && subList.map((r) => (
                <div key={r.id} className="py-2 px-1 text-sm flex justify-between">
                  <span className="text-gray-800 truncate">{r.name}</span>
                  <span className="text-slate-600 shrink-0 ml-2">{won(r.unit_price)}/ea</span>
                </div>
              ))}
              {!['원재료', '부자재'].includes(tab) && items.map((it) => (
                <div key={it.id} className={`py-2 px-1 flex items-center justify-between cursor-pointer rounded-lg ${selected?.id === it.id ? 'bg-gray-50' : 'hover:bg-gray-50'}`}>
                  <button onClick={() => openItem(it)} className="text-left flex-1 min-w-0">
                    <div className="text-sm text-gray-800 truncate">{it.product_name}</div>
                    <div className="text-xs text-gray-400">{it.product_category}{it.flavor_group ? ` · ${it.flavor_group}` : ''}</div>
                  </button>
                  <button onClick={() => addToCart(it)} title="생산소요에 추가"
                    className="ml-2 text-xs px-2 py-1 rounded bg-blue-50 text-blue-600 hover:bg-blue-100 shrink-0">+담기</button>
                </div>
              ))}
              {!['원재료', '부자재'].includes(tab) && items.length === 0 && (
                <div className="py-8 text-center text-sm text-gray-400">품목이 없습니다.</div>
              )}
            </div>
          </div>

          {/* Mid: BOM detail */}
          <div className="bg-white rounded-2xl border border-gray-100 p-4">
            {!selected && <div className="py-20 text-center text-sm text-gray-400">좌측에서 품목을 선택하면 BOM이 표시됩니다.</div>}
            {selected && (
              <>
                <div className="flex items-center gap-2 mb-3">
                  <span className={`text-xs px-2 py-0.5 rounded ${TYPE_COLORS[selected.item_type] || 'bg-gray-100 text-gray-600'}`}>{selected.item_type}</span>
                  <h3 className="font-bold text-gray-900">{selected.product_name}</h3>
                </div>
                {bom?.components && bom.components.length > 0 && (
                  <div className="mb-4">
                    <div className="text-xs font-semibold text-gray-500 mb-1">구성 품목 ({bom.components.length})</div>
                    <div className="space-y-1">
                      {bom.components.map((c) => (
                        <div key={c.id} className="flex justify-between text-sm py-1 px-2 rounded bg-gray-50">
                          <span className="text-gray-700 truncate">{c.child_name}</span>
                          <span className="text-gray-500 shrink-0 ml-2">×{c.qty}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {bom?.bom_lines && bom.bom_lines.length > 0 && (
                  <div>
                    <div className="text-xs font-semibold text-gray-500 mb-1">자재 (개당 투입량) — {bom.bom_lines.length}건</div>
                    <table className="w-full text-sm">
                      <tbody>
                        {bom.bom_lines.map((b) => (
                          <tr key={b.id} className="border-b border-gray-50">
                            <td className="py-1.5 text-gray-700">{b.material_name}</td>
                            <td className="py-1.5 text-right text-gray-500 whitespace-nowrap">
                              {b.material_type === 'raw' ? b.qty_per_unit.toFixed(5) : b.qty_per_unit}
                              <span className="text-gray-400 ml-1">{b.qty_unit}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {bom && bom.components.length === 0 && bom.bom_lines.length === 0 && (
                  <div className="py-10 text-center text-sm text-gray-400">등록된 BOM이 없습니다.</div>
                )}
              </>
            )}
          </div>

          {/* Right: production requirement */}
          <div className="bg-white rounded-2xl border border-gray-100 p-4">
            <h3 className="font-bold text-gray-900 mb-1">생산소요 계산</h3>
            <p className="text-xs text-gray-400 mb-3">세트·완제품을 담고 수량을 입력하면 원부재료 소요량·예상 재료원가를 산출합니다.</p>
            {cart.length === 0 && <div className="py-6 text-center text-xs text-gray-400">좌측 목록에서 “+담기”로 추가하세요.</div>}
            <div className="space-y-2 mb-3">
              {cart.map((c) => (
                <div key={c.item.id} className="flex items-center gap-2">
                  <span className="text-sm text-gray-700 flex-1 truncate">{c.item.product_name}</span>
                  <input type="number" value={c.qty} onChange={(e) => setCartQty(c.item.id, Number(e.target.value))}
                    className="w-20 px-2 py-1 rounded border border-gray-200 text-sm text-right" />
                  <button onClick={() => removeCart(c.item.id)} className="text-gray-300 hover:text-red-400 text-sm">✕</button>
                </div>
              ))}
            </div>
            {cart.length > 0 && (
              <button onClick={compute} className="w-full py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 mb-4">소요량 계산</button>
            )}
            {req && (
              <div>
                <div className="flex justify-between items-baseline mb-2">
                  <span className="text-xs font-semibold text-gray-500">예상 재료원가</span>
                  <span className="text-lg font-bold text-gray-900">{won(req.total_material_cost)}</span>
                </div>
                <div className="text-xs font-semibold text-sky-600 mt-3 mb-1">원재료 {req.raw_materials.length}종</div>
                <div className="max-h-44 overflow-auto">
                  {req.raw_materials.map((r, i) => (
                    <div key={i} className="flex justify-between text-xs py-0.5">
                      <span className="text-gray-600 truncate">{r.name}</span>
                      <span className="text-gray-500 shrink-0 ml-2">{r.qty_kg.toFixed(2)}kg · {won(r.cost)}</span>
                    </div>
                  ))}
                </div>
                <div className="text-xs font-semibold text-slate-600 mt-3 mb-1">부자재 {req.sub_materials.length}종</div>
                <div className="max-h-32 overflow-auto">
                  {req.sub_materials.map((r, i) => (
                    <div key={i} className="flex justify-between text-xs py-0.5">
                      <span className="text-gray-600 truncate">{r.name}</span>
                      <span className="text-gray-500 shrink-0 ml-2">{r.qty_ea.toFixed(0)}ea · {won(r.cost)}</span>
                    </div>
                  ))}
                </div>
                {req.unresolved_semi?.length > 0 && (
                  <div className="text-xs text-amber-600 mt-2">미해결 반제품 {req.unresolved_semi.length}건 (매핑 확인 필요)</div>
                )}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
