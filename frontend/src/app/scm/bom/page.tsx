'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
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

const mutate = async (path: string, method: 'POST' | 'PUT' | 'DELETE', body?: unknown) => {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: getAuthHeaders(),
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => null);
    return { ok: res.ok, data };
  } catch {
    return { ok: false, data: null };
  }
};

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────
interface Item {
  id: number;
  product_name: string;
  product_category: string;
  product_code?: string;
  item_type: string;
  flavor?: string;
  flavor_group?: string;
  unit_weight_g?: number;
}
interface Material {
  id: number;
  erp_code?: string;
  name: string;
  supplier?: string;
  unit?: string;
  spec?: string;
  spec_unit?: string;
  kg_price?: number;
  spec_price?: number;
  roll_price?: number;
  producible_qty?: number;
  unit_price?: number;
  notes?: string;
}
interface BomLine {
  id: number;
  material_type: string;
  material_name: string;
  material_erp_code?: string;
  qty_per_unit: number;
  qty_unit?: string;
  unit_price: number;
  line_cost: number;
  raw_material_id?: number;
  sub_material_id?: number;
}
interface Component {
  id: number;
  child_item_id: number;
  qty: number;
  child_name?: string;
  child_type?: string;
  child_code?: string;
}
interface BomDetail {
  item: any;
  bom_lines: BomLine[];
  bom_cost: number;
  components: Component[];
}
interface ReqRaw { name: string; qty_kg: number; kg_price: number; cost: number; }
interface ReqSub { name: string; qty_ea: number; unit_price: number; cost: number; }
interface CartRow { item: Item; qty: number; }

const TYPE_TABS = ['세트', '완제품', '반제품', '원재료', '부자재'] as const;
const ITEM_TABS = ['세트', '완제품', '반제품'];

const TYPE_BADGE: Record<string, string> = {
  세트: 'bg-[#5E6AD2]/15 text-[#828FFF] border-[#5E6AD2]/30',
  혼합세트: 'bg-[#5E6AD2]/15 text-[#828FFF] border-[#5E6AD2]/30',
  완제품: 'bg-[#27A644]/10 text-[#27A644] border-[#27A644]/25',
  반제품: 'bg-[#F0BF00]/10 text-[#F0BF00] border-[#F0BF00]/30',
  원재료: 'bg-[#4DA3FF]/10 text-[#4DA3FF] border-[#4DA3FF]/25',
  부자재: 'bg-[#08090A] text-[#8A8F98] border-[#23252A]',
};
const won = (n: number) => `${Math.round(n || 0).toLocaleString('ko-KR')}원`;
const inputCls = 'bg-[#08090A] border border-[#23252A] rounded-lg text-[#D0D6E0] placeholder-[#62666D] focus:outline-none focus:ring-2 focus:ring-[#5E6AD2]/20 focus:border-[#5E6AD2]/50';

export default function BomPage() {
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();

  const [summary, setSummary] = useState<any>(null);
  const [tab, setTab] = useState<string>('세트');
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [rawList, setRawList] = useState<Material[]>([]);
  const [subList, setSubList] = useState<Material[]>([]);
  const [selected, setSelected] = useState<Item | null>(null);
  const [bom, setBom] = useState<BomDetail | null>(null);
  const [weightUnit, setWeightUnit] = useState<'kg' | 'g'>('kg');

  // 묶기(compose) 선택
  const [picked, setPicked] = useState<Set<number>>(new Set());

  // 생산소요
  const [cart, setCart] = useState<CartRow[]>([]);
  const [req, setReq] = useState<{ raw_materials: ReqRaw[]; sub_materials: ReqSub[]; total_material_cost: number; unresolved_semi: any[] } | null>(null);
  const [showCalc, setShowCalc] = useState(false);

  // Modals
  const [matModal, setMatModal] = useState<{ kind: 'raw' | 'sub'; data: Material | null } | null>(null);
  const [composeModal, setComposeModal] = useState<{ targetType: string; children: Item[] } | null>(null);
  const [lineModal, setLineModal] = useState<{ item: Item } | null>(null);
  const [compModal, setCompModal] = useState<{ item: Item } | null>(null);

  const [importing, setImporting] = useState(false);
  const [toast, setToast] = useState('');
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(''), 3500); };

  // ── Auth guard ──
  useEffect(() => { if (!authLoading && !user) router.push('/login'); }, [authLoading, user, router]);

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

  const openItem = useCallback(async (it: Item) => {
    setSelected(it);
    const r = await fetchSafe<any>(`/api/scm/items/${it.id}/bom`, null);
    setBom(r?.data || null);
  }, []);

  const refreshDetail = useCallback(async () => {
    if (selected) {
      const r = await fetchSafe<any>(`/api/scm/items/${selected.id}/bom`, null);
      setBom(r?.data || null);
    }
    loadSummary();
  }, [selected, loadSummary]);

  // ── compose 선택 토글 ──
  const togglePick = (id: number) => setPicked((s) => {
    const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n;
  });
  const pickedItems = useMemo(() => items.filter((i) => picked.has(i.id)), [items, picked]);
  const clearPick = () => setPicked(new Set());

  // ── 생산소요 ──
  const addToCart = (it: Item) => { setCart((c) => c.find((x) => x.item.id === it.id) ? c : [...c, { item: it, qty: 100 }]); setShowCalc(true); };
  const setCartQty = (id: number, q: number) => setCart((c) => c.map((x) => x.item.id === id ? { ...x, qty: q } : x));
  const removeCart = (id: number) => setCart((c) => c.filter((x) => x.item.id !== id));
  const compute = async () => {
    if (!cart.length) return;
    const r = await mutate('/api/scm/production-requirement', 'POST', { items: cart.map((c) => ({ item_id: c.item.id, qty: c.qty })) });
    if (r.data?.data) setReq(r.data.data);
  };

  const onImport = async (file: File) => {
    setImporting(true);
    const fd = new FormData();
    fd.append('file', file);
    try {
      const res = await fetch(`${API_BASE}/api/scm/bom/import?replace=true`, {
        method: 'POST',
        headers: (() => { const h = getAuthHeaders(); delete h['Content-Type']; return h; })(),
        body: fd,
      });
      const j = await res.json();
      if (j?.success) { flash(`적재 완료 — 원재료 ${j.report.raw_materials} · 부자재 ${j.report.sub_materials} · 시트 ${j.report.sheets.length}개`); loadSummary(); loadList(); }
      else flash('적재 실패');
    } catch { flash('적재 실패'); }
    setImporting(false);
  };

  // ── BOM 라인 표시값 (kg/g 토글) ──
  const lineQtyDisplay = (b: BomLine) => {
    if (b.material_type === 'raw') {
      return weightUnit === 'g'
        ? `${(b.qty_per_unit * 1000).toLocaleString('ko-KR', { maximumFractionDigits: 2 })} g`
        : `${b.qty_per_unit.toLocaleString('ko-KR', { maximumFractionDigits: 5 })} kg`;
    }
    return `${b.qty_per_unit.toLocaleString('ko-KR', { maximumFractionDigits: 2 })} ${b.qty_unit || 'ea'}`;
  };

  if (authLoading) return <div className="min-h-screen flex items-center justify-center bg-[#08090A]"><div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-[#5E6AD2]" /></div>;
  if (!user) return null;

  return (
    <div className="min-h-screen bg-[#08090A]">
      <Navigation />
      <main className="max-w-[1700px] mx-auto px-4 sm:px-6 py-6">
        {/* Header */}
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-5">
          <div>
            <h1 className="text-2xl font-bold text-[#F7F8F8]">BOM · 원부재료</h1>
            <p className="text-sm text-[#8A8F98] mt-1">품목 배합비(BOM)·세트 구성 관리 + 판매·생산 수량 기반 원부재료 소요량·원가 산출</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => setMatModal({ kind: 'raw', data: null })} className="px-3 py-2 text-sm font-medium rounded-lg border border-[#4DA3FF]/30 bg-[#4DA3FF]/10 text-[#4DA3FF] hover:bg-[#4DA3FF]/15 transition">+ 원재료</button>
            <button onClick={() => setMatModal({ kind: 'sub', data: null })} className="px-3 py-2 text-sm font-medium rounded-lg border border-[#23252A] bg-[#0F1011] text-[#D0D6E0] hover:bg-white/5 transition">+ 부자재</button>
            <button onClick={() => setShowCalc((v) => !v)} className="px-3 py-2 text-sm font-medium rounded-lg border border-[#23252A] bg-[#0F1011] text-[#D0D6E0] hover:bg-white/5 transition">생산소요 계산{cart.length > 0 ? ` (${cart.length})` : ''}</button>
            <label className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg cursor-pointer transition ${importing ? 'bg-[#0F1011] text-[#62666D] border border-[#23252A]' : 'bg-[#5E6AD2] text-white hover:bg-[#828FFF]'}`}>
              {importing ? '적재 중…' : 'BOM 엑셀'}
              <input type="file" accept=".xlsx,.xls" className="hidden" disabled={importing} onChange={(e) => e.target.files?.[0] && onImport(e.target.files[0])} />
            </label>
          </div>
        </div>

        {/* Summary cards */}
        {summary && (
          <div className="grid grid-cols-3 md:grid-cols-7 gap-3 mb-5">
            {ITEM_TABS.map((k) => (
              <button key={k} onClick={() => { setTab(k); setSelected(null); setBom(null); clearPick(); }}
                className={`text-left bg-[#0F1011] rounded-xl border p-3.5 transition hover:border-[#34343A] ${tab === k ? 'border-[#5E6AD2]/50' : 'border-[#23252A]'}`}>
                <p className="text-xs font-medium text-[#8A8F98]">{k}</p>
                <p className="text-2xl font-bold text-[#F7F8F8] mt-1">{summary.by_type?.[k] ?? 0}</p>
              </button>
            ))}
            <button onClick={() => { setTab('원재료'); setSelected(null); clearPick(); }} className={`text-left bg-[#0F1011] rounded-xl border p-3.5 transition hover:border-[#34343A] ${tab === '원재료' ? 'border-[#4DA3FF]/50' : 'border-[#23252A]'}`}>
              <p className="text-xs font-medium text-[#8A8F98]">원재료</p>
              <p className="text-2xl font-bold text-[#4DA3FF] mt-1">{summary.raw_materials}</p>
            </button>
            <button onClick={() => { setTab('부자재'); setSelected(null); clearPick(); }} className={`text-left bg-[#0F1011] rounded-xl border p-3.5 transition hover:border-[#34343A] ${tab === '부자재' ? 'border-[#34343A]' : 'border-[#23252A]'}`}>
              <p className="text-xs font-medium text-[#8A8F98]">부자재</p>
              <p className="text-2xl font-bold text-[#D0D6E0] mt-1">{summary.sub_materials}</p>
            </button>
            <div className="bg-[#0F1011] rounded-xl border border-[#23252A] p-3.5">
              <p className="text-xs font-medium text-[#8A8F98]">BOM 라인</p>
              <p className="text-2xl font-bold text-[#F7F8F8] mt-1">{(summary.bom_lines ?? 0).toLocaleString('ko-KR')}</p>
            </div>
            <div className="bg-[#0F1011] rounded-xl border border-[#23252A] p-3.5">
              <p className="text-xs font-medium text-[#8A8F98]">구성</p>
              <p className="text-2xl font-bold text-[#F7F8F8] mt-1">{summary.components}</p>
            </div>
          </div>
        )}

        {toast && <div className="mb-4 px-4 py-2.5 rounded-lg bg-[#27A644]/10 text-[#27A644] text-sm border border-[#27A644]/25">{toast}</div>}

        {/* 생산소요 계산 (collapsible) */}
        {showCalc && (
          <div className="bg-[#0F1011] rounded-xl border border-[#5E6AD2]/30 p-4 mb-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-[#F7F8F8]">생산소요 계산 <span className="text-xs font-normal text-[#62666D] ml-1">세트·완제품 담기 → 수량 입력 → 원부재료·원가 산출</span></h3>
              <button onClick={() => setShowCalc(false)} className="text-[#62666D] hover:text-[#D0D6E0]">✕</button>
            </div>
            {cart.length === 0 && <div className="py-4 text-center text-xs text-[#62666D]">좌측 목록의 “담기” 버튼으로 추가하세요.</div>}
            <div className="grid lg:grid-cols-2 gap-4">
              <div className="space-y-2">
                {cart.map((c) => (
                  <div key={c.item.id} className="flex items-center gap-2">
                    <span className="text-sm text-[#D0D6E0] flex-1 truncate">{c.item.product_name}</span>
                    <input type="number" value={c.qty} onChange={(e) => setCartQty(c.item.id, Number(e.target.value))} className={`w-24 px-2 py-1 text-sm text-right ${inputCls}`} />
                    <button onClick={() => removeCart(c.item.id)} className="text-[#62666D] hover:text-[#EB5757]">✕</button>
                  </div>
                ))}
                {cart.length > 0 && <button onClick={compute} className="w-full py-2 rounded-lg bg-[#5E6AD2] text-white text-sm font-medium hover:bg-[#828FFF] transition mt-1">소요량 계산</button>}
              </div>
              {req && (
                <div className="bg-[#08090A] rounded-lg border border-[#23252A] p-3">
                  <div className="flex justify-between items-baseline mb-2 pb-2 border-b border-[#23252A]">
                    <span className="text-xs font-semibold text-[#8A8F98]">예상 재료원가</span>
                    <span className="text-xl font-bold text-[#F7F8F8]">{won(req.total_material_cost)}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div className="text-xs font-semibold text-[#4DA3FF] mb-1">원재료 {req.raw_materials.length}종</div>
                      <div className="max-h-40 overflow-auto space-y-0.5">
                        {req.raw_materials.map((r, i) => (
                          <div key={i} className="flex justify-between text-xs"><span className="text-[#8A8F98] truncate">{r.name}</span><span className="text-[#62666D] shrink-0 ml-2">{r.qty_kg.toFixed(2)}kg · {won(r.cost)}</span></div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-[#D0D6E0] mb-1">부자재 {req.sub_materials.length}종</div>
                      <div className="max-h-40 overflow-auto space-y-0.5">
                        {req.sub_materials.map((r, i) => (
                          <div key={i} className="flex justify-between text-xs"><span className="text-[#8A8F98] truncate">{r.name}</span><span className="text-[#62666D] shrink-0 ml-2">{r.qty_ea.toFixed(0)}ea · {won(r.cost)}</span></div>
                        ))}
                      </div>
                    </div>
                  </div>
                  {req.unresolved_semi?.length > 0 && <div className="text-xs text-[#F0BF00] mt-2">미해결 반제품 {req.unresolved_semi.length}건 (매핑 확인 필요)</div>}
                </div>
              )}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
          {/* Left: list (2/5) */}
          <div className="lg:col-span-2 bg-[#0F1011] rounded-xl border border-[#23252A] p-4">
            <div className="flex gap-1.5 mb-3 flex-wrap">
              {TYPE_TABS.map((t) => (
                <button key={t} onClick={() => { setTab(t); setSelected(null); setBom(null); clearPick(); }}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border transition ${tab === t ? 'bg-[#5E6AD2] text-white border-[#5E6AD2]' : 'bg-[#0F1011] text-[#8A8F98] border-[#23252A] hover:bg-white/5'}`}>{t}</button>
              ))}
            </div>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="이름·코드 검색..." className={`w-full px-3 py-2 mb-3 text-sm ${inputCls}`} />

            {/* 묶기 액션바 (완제품→세트, 반제품→완제품) */}
            {(tab === '완제품' || tab === '반제품') && picked.size > 0 && (
              <div className="flex items-center justify-between mb-3 px-3 py-2 rounded-lg bg-[#5E6AD2]/10 border border-[#5E6AD2]/30">
                <span className="text-xs text-[#828FFF] font-medium">{picked.size}개 선택</span>
                <div className="flex gap-1.5">
                  <button onClick={() => setComposeModal({ targetType: tab === '완제품' ? '세트' : '완제품', children: pickedItems })}
                    className="text-xs px-2.5 py-1 rounded bg-[#5E6AD2] text-white hover:bg-[#828FFF]">{tab === '완제품' ? '세트로 묶기' : '완제품으로 묶기'}</button>
                  <button onClick={clearPick} className="text-xs px-2 py-1 rounded text-[#8A8F98] hover:bg-white/5">취소</button>
                </div>
              </div>
            )}

            <div className="max-h-[620px] overflow-auto divide-y divide-[#1A1B1E]">
              {/* 자재 (원재료/부자재) */}
              {tab === '원재료' && rawList.map((r) => (
                <button key={r.id} onClick={() => setMatModal({ kind: 'raw', data: r })} className="w-full text-left py-2.5 px-2 hover:bg-white/5 rounded-lg flex justify-between items-center group">
                  <div className="min-w-0">
                    <div className="text-sm text-[#D0D6E0] truncate">{r.name}</div>
                    <div className="text-xs text-[#62666D] truncate">{r.erp_code}{r.supplier ? ` · ${r.supplier}` : ''}</div>
                  </div>
                  <span className="text-[#4DA3FF] shrink-0 ml-2 text-xs">{won(r.kg_price || 0)}/kg</span>
                </button>
              ))}
              {tab === '부자재' && subList.map((r) => (
                <button key={r.id} onClick={() => setMatModal({ kind: 'sub', data: r })} className="w-full text-left py-2.5 px-2 hover:bg-white/5 rounded-lg flex justify-between items-center">
                  <div className="min-w-0">
                    <div className="text-sm text-[#D0D6E0] truncate">{r.name}</div>
                    <div className="text-xs text-[#62666D] truncate">{r.erp_code}{r.supplier ? ` · ${r.supplier}` : ''}</div>
                  </div>
                  <span className="text-[#8A8F98] shrink-0 ml-2 text-xs">{won(r.unit_price || 0)}/{r.unit || 'ea'}</span>
                </button>
              ))}
              {/* 품목 (세트/완제품/반제품) */}
              {ITEM_TABS.includes(tab) && items.map((it) => (
                <div key={it.id} className={`py-2 px-2 flex items-center gap-2 rounded-lg ${selected?.id === it.id ? 'bg-[#5E6AD2]/10' : 'hover:bg-white/5'}`}>
                  {(tab === '완제품' || tab === '반제품') && (
                    <input type="checkbox" checked={picked.has(it.id)} onChange={() => togglePick(it.id)} className="rounded border-[#34343A] text-[#7070FF] focus:ring-[#5E6AD2] shrink-0" />
                  )}
                  <button onClick={() => openItem(it)} className="text-left flex-1 min-w-0">
                    <div className="text-sm text-[#D0D6E0] truncate">{it.product_name}</div>
                    <div className="text-xs text-[#62666D] truncate">{it.product_code ? `${it.product_code} · ` : ''}{it.product_category}{it.flavor_group ? ` · ${it.flavor_group}` : ''}</div>
                  </button>
                  <button onClick={() => addToCart(it)} title="생산소요에 담기" className="text-xs px-2 py-1 rounded bg-[#5E6AD2]/10 text-[#828FFF] hover:bg-[#5E6AD2]/20 shrink-0">담기</button>
                </div>
              ))}
              {ITEM_TABS.includes(tab) && items.length === 0 && <div className="py-12 text-center text-sm text-[#62666D]">품목이 없습니다.</div>}
              {tab === '원재료' && rawList.length === 0 && <div className="py-12 text-center text-sm text-[#62666D]">원재료가 없습니다. 우측 상단 “+ 원재료”로 등록하세요.</div>}
              {tab === '부자재' && subList.length === 0 && <div className="py-12 text-center text-sm text-[#62666D]">부자재가 없습니다.</div>}
            </div>
          </div>

          {/* Right: BOM detail (3/5) */}
          <div className="lg:col-span-3 bg-[#0F1011] rounded-xl border border-[#23252A] p-5">
            {!selected && <div className="py-32 text-center text-sm text-[#62666D]">좌측에서 품목을 선택하면 BOM 상세가 표시됩니다.<br />원재료·부자재 탭에서는 항목을 클릭해 수정할 수 있습니다.</div>}
            {selected && bom && (
              <>
                <div className="flex items-start justify-between gap-3 mb-4">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-xs px-2 py-0.5 rounded border ${TYPE_BADGE[selected.item_type] || 'bg-[#08090A] text-[#8A8F98] border-[#23252A]'}`}>{selected.item_type}</span>
                    <h3 className="font-bold text-[#F7F8F8] text-lg">{selected.product_name}</h3>
                    {bom.item?.product_code && <span className="text-xs font-mono text-[#62666D]">{bom.item.product_code}</span>}
                  </div>
                  {/* kg/g 토글 */}
                  <div className="flex items-center rounded-lg border border-[#23252A] overflow-hidden shrink-0">
                    {(['kg', 'g'] as const).map((u) => (
                      <button key={u} onClick={() => setWeightUnit(u)} className={`px-3 py-1 text-xs font-medium transition ${weightUnit === u ? 'bg-[#5E6AD2] text-white' : 'bg-[#0F1011] text-[#8A8F98] hover:bg-white/5'}`}>{u}</button>
                    ))}
                  </div>
                </div>

                {/* 구성 품목 */}
                <div className="mb-5">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-xs font-semibold text-[#8A8F98] uppercase tracking-wider">구성 품목 ({bom.components.length})</div>
                    <button onClick={() => setCompModal({ item: selected })} className="text-xs px-2 py-1 rounded bg-[#5E6AD2]/10 text-[#828FFF] hover:bg-[#5E6AD2]/20">+ 구성 추가</button>
                  </div>
                  {bom.components.length > 0 ? (
                    <div className="space-y-1">
                      {bom.components.map((c) => (
                        <div key={c.id} className="flex justify-between items-center text-sm py-1.5 px-2.5 rounded-lg bg-[#08090A] border border-[#1A1B1E]">
                          <span className="text-[#D0D6E0] truncate">{c.child_code ? <span className="font-mono text-xs text-[#62666D] mr-1.5">{c.child_code}</span> : null}{c.child_name}</span>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-[#62666D]">×{c.qty}</span>
                            <button onClick={async () => { await mutate(`/api/scm/items/components/${c.id}`, 'DELETE'); refreshDetail(); }} className="text-[#62666D] hover:text-[#EB5757] text-xs">✕</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : <div className="text-xs text-[#62666D] py-2">구성 품목 없음</div>}
                </div>

                {/* 자재 라인 (금액 포함) */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-xs font-semibold text-[#8A8F98] uppercase tracking-wider">자재 · 개당 투입량 ({bom.bom_lines.length})</div>
                    <button onClick={() => setLineModal({ item: selected })} className="text-xs px-2 py-1 rounded bg-[#4DA3FF]/10 text-[#4DA3FF] hover:bg-[#4DA3FF]/20">+ 자재 추가</button>
                  </div>
                  {bom.bom_lines.length > 0 ? (
                    <div className="overflow-hidden rounded-lg border border-[#1A1B1E]">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-[#08090A] text-[#62666D] text-xs">
                            <th className="text-left font-medium px-3 py-2">자재명</th>
                            <th className="text-right font-medium px-3 py-2">투입량 ({weightUnit}/ea)</th>
                            <th className="text-right font-medium px-3 py-2">단가</th>
                            <th className="text-right font-medium px-3 py-2">금액</th>
                            <th className="w-8" />
                          </tr>
                        </thead>
                        <tbody>
                          {bom.bom_lines.map((b) => (
                            <tr key={b.id} className="border-t border-[#1A1B1E]">
                              <td className="px-3 py-2 text-[#D0D6E0]">
                                {b.material_name}
                                <span className={`ml-1.5 text-[10px] px-1 py-0.5 rounded border ${b.material_type === 'raw' ? 'text-[#4DA3FF] border-[#4DA3FF]/25' : b.material_type === 'sub' ? 'text-[#8A8F98] border-[#23252A]' : 'text-[#F0BF00] border-[#F0BF00]/25'}`}>{b.material_type === 'raw' ? '원' : b.material_type === 'sub' ? '부' : '반'}</span>
                              </td>
                              <td className="px-3 py-2 text-right text-[#8A8F98] whitespace-nowrap tabular-nums">{lineQtyDisplay(b)}</td>
                              <td className="px-3 py-2 text-right text-[#62666D] whitespace-nowrap tabular-nums">{b.material_type === 'raw' ? (weightUnit === 'g' ? won(b.unit_price / 1000) + '/g' : won(b.unit_price) + '/kg') : won(b.unit_price) + '/' + (b.qty_unit || 'ea')}</td>
                              <td className="px-3 py-2 text-right text-[#D0D6E0] font-medium whitespace-nowrap tabular-nums">{won(b.line_cost)}</td>
                              <td className="px-2 py-2 text-center"><button onClick={async () => { await mutate(`/api/scm/bom-lines/${b.id}`, 'DELETE'); refreshDetail(); }} className="text-[#62666D] hover:text-[#EB5757] text-xs">✕</button></td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="border-t border-[#23252A] bg-[#08090A]">
                            <td className="px-3 py-2.5 font-semibold text-[#F7F8F8]" colSpan={3}>개당 재료원가 합계</td>
                            <td className="px-3 py-2.5 text-right font-bold text-[#5E6AD2] tabular-nums">{won(bom.bom_cost)}</td>
                            <td />
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  ) : <div className="text-xs text-[#62666D] py-2">등록된 자재 라인 없음 — “+ 자재 추가”로 등록하세요.</div>}
                  {bom.components.length > 0 && (
                    <p className="text-xs text-[#62666D] mt-2">※ 합계는 직접 자재만 반영합니다. 구성 품목(반제품·완제품)의 원가는 “생산소요 계산”에서 전개됩니다.</p>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {/* ── 사용 가이드 ── */}
        <details className="mt-6 bg-[#0F1011] rounded-xl border border-[#23252A] group" open>
          <summary className="flex items-center justify-between px-5 py-4 cursor-pointer select-none list-none">
            <div className="flex items-center gap-2">
              <svg className="h-4 w-4 text-[#828FFF]" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              <h3 className="font-bold text-[#F7F8F8] text-sm">사용 가이드 — 품목·BOM·세트 관리</h3>
            </div>
            <svg className="h-4 w-4 text-[#62666D] transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
          </summary>
          <div className="px-5 pb-5 pt-1 border-t border-[#23252A] grid md:grid-cols-2 gap-x-8 gap-y-5 text-sm text-[#D0D6E0]">
            <GuideBlock n="1" title="계층 구조" color="#828FFF">
              원재료 · 부자재 → <b className="text-[#F0BF00]">반제품</b>(꼬끄·크림 등) → <b className="text-[#27A644]">완제품</b>(맛별) → <b className="text-[#828FFF]">세트/혼합세트</b> 순으로 묶입니다.
              판매량을 넣으면 세트→완제품→반제품→원부재료까지 거꾸로 전개돼 소요량·원가가 계산됩니다.
            </GuideBlock>
            <GuideBlock n="2" title="원재료·부자재 등록" color="#4DA3FF">
              우측 상단 <Btn>+ 원재료</Btn> <Btn>+ 부자재</Btn> 로 직접 등록합니다. 좌측 목록에서 <b>원재료/부자재 탭</b>의 항목을 클릭하면 단가·거래처 등을 수정할 수 있어요. ERP 코드(RM·SM)는 자동 부여됩니다.
            </GuideBlock>
            <GuideBlock n="3" title="완제품을 묶어 세트 만들기" color="#27A644">
              좌측 <b className="text-[#27A644]">완제품</b> 탭 → 넣을 완제품들의 <b>체크박스</b> 선택 → 목록 위 보라색 바의 <Btn>세트로 묶기</Btn> → 창에서 <b>품목명·유형(세트/혼합세트)·맛그룹·구성수량</b> 입력 후 <b>생성</b>. 코드는 ST/MX 자동.
            </GuideBlock>
            <GuideBlock n="4" title="반제품·원부재료로 완제품 만들기" color="#F0BF00">
              <b className="text-[#F0BF00]">반제품</b> 탭에서 꼬끄·크림을 체크 → <Btn>완제품으로 묶기</Btn> → 생성. 이후 상세에서 <Btn>+ 자재 추가</Btn>로 포장재 등 원부재료를, <Btn>+ 구성 추가</Btn>로 하위 품목을 더 붙입니다.
            </GuideBlock>
            <GuideBlock n="5" title="BOM 상세 · kg/g · 금액" color="#828FFF">
              좌측 품목 클릭 → 우측에 <b>구성 품목 + 자재 라인</b> 표시. 우상단 <Btn>kg/g</Btn> 토글로 투입량·단가 단위를 바꾸고, 각 라인의 <b>투입량 × 단가 = 금액</b>과 맨 아래 <b>개당 재료원가 합계</b>를 확인합니다.
            </GuideBlock>
            <GuideBlock n="6" title="생산소요 계산" color="#5E6AD2">
              품목 행의 <Btn>담기</Btn> → 상단 <Btn>생산소요 계산</Btn> 패널에서 수량 입력 → <b>소요량 계산</b>. "이 세트 100개 = 원재료 N종·부자재 M종·재료원가 얼마"까지 자동 전개됩니다.
            </GuideBlock>
            <GuideBlock n="7" title="엑셀 일괄 적재 · 코드체계" color="#8A8F98">
              <Btn>BOM 엑셀</Btn>로 〈조인앤조인 제품별 BOM〉 양식을 통째로 재적재할 수 있습니다(기존 BOM 교체). 모든 품목·자재는 유형별 코드를 갖습니다 — <b>원재료 RM · 부자재 SM · 반제품 SF · 완제품 FG · 세트 ST · 혼합세트 MX</b>.
            </GuideBlock>
            <GuideBlock n="8" title="품목관리와의 연결" color="#62666D">
              <b>품목 관리</b> 메뉴의 ‘품목 추가’에서 <b>BOM 리스트에서 불러오기</b>로 여기 등록된 완제품·반제품·세트·원부재료를 골라 바로 마스터에 올릴 수 있습니다.
            </GuideBlock>
          </div>
        </details>
      </main>

      {/* ── 자재 등록/수정 모달 ── */}
      {matModal && <MaterialModal kind={matModal.kind} data={matModal.data} onClose={() => setMatModal(null)} onSaved={() => { setMatModal(null); loadList(); loadSummary(); }} flash={flash} />}

      {/* ── 묶기(compose) 모달 ── */}
      {composeModal && <ComposeModal targetType={composeModal.targetType} children={composeModal.children}
        onClose={() => setComposeModal(null)}
        onSaved={(name) => { setComposeModal(null); clearPick(); flash(`${name} 생성 완료`); loadSummary(); }} />}

      {/* ── 자재 라인 추가 모달 ── */}
      {lineModal && <BomLineModal item={lineModal.item} onClose={() => setLineModal(null)} onSaved={() => { setLineModal(null); refreshDetail(); }} />}

      {/* ── 구성 추가 모달 ── */}
      {compModal && <ComponentModal item={compModal.item} onClose={() => setCompModal(null)} onSaved={() => { setCompModal(null); refreshDetail(); }} />}
    </div>
  );
}

// ═══════════════════════════════════════════════
// 자재 등록/수정 모달
// ═══════════════════════════════════════════════
function MaterialModal({ kind, data, onClose, onSaved, flash }: { kind: 'raw' | 'sub'; data: Material | null; onClose: () => void; onSaved: () => void; flash: (m: string) => void }) {
  const isRaw = kind === 'raw';
  const [f, setF] = useState<Material>(data || { id: 0, name: '', unit: isRaw ? 'kg' : 'ea' } as Material);
  const [code, setCode] = useState(data?.erp_code || '');
  const set = (k: keyof Material, v: any) => setF((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    if (!data) fetchSafe<any>(`/api/scm/next-code?kind=${kind}`, null).then((r) => r?.data?.code && setCode(r.data.code));
  }, [data, kind]);

  const save = async () => {
    if (!f.name?.trim()) { flash('이름을 입력하세요'); return; }
    const body: any = isRaw
      ? { erp_code: code || undefined, name: f.name, supplier: f.supplier, spec: f.spec, spec_unit: f.spec_unit, unit: f.unit || 'kg', kg_price: Number(f.kg_price) || 0, spec_price: Number(f.spec_price) || 0, notes: f.notes }
      : { erp_code: code || undefined, name: f.name, supplier: f.supplier, unit: f.unit || 'ea', roll_price: Number(f.roll_price) || 0, producible_qty: Number(f.producible_qty) || 0, unit_price: Number(f.unit_price) || 0, notes: f.notes };
    const path = data ? `/api/scm/materials/${kind}/${data.id}` : `/api/scm/materials/${kind}`;
    const r = await mutate(path, data ? 'PUT' : 'POST', body);
    if (r.ok) onSaved(); else flash('저장 실패');
  };

  return (
    <ModalShell title={`${isRaw ? '원재료' : '부자재'} ${data ? '수정' : '등록'}`} onClose={onClose} onSave={save} saveLabel={data ? '수정' : '등록'}>
      <Field label="ERP 코드"><input value={code} onChange={(e) => setCode(e.target.value)} placeholder="자동생성" className={`w-full px-3 py-2 text-sm font-mono ${inputCls}`} /></Field>
      <Field label="품목명 *"><input value={f.name} onChange={(e) => set('name', e.target.value)} className={`w-full px-3 py-2 text-sm ${inputCls}`} /></Field>
      <Field label="거래처"><input value={f.supplier || ''} onChange={(e) => set('supplier', e.target.value)} className={`w-full px-3 py-2 text-sm ${inputCls}`} /></Field>
      {isRaw ? (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Field label="규격"><input value={f.spec || ''} onChange={(e) => set('spec', e.target.value)} className={`w-full px-3 py-2 text-sm ${inputCls}`} /></Field>
            <Field label="단위"><input value={f.unit || ''} onChange={(e) => set('unit', e.target.value)} placeholder="kg" className={`w-full px-3 py-2 text-sm ${inputCls}`} /></Field>
          </div>
          <Field label="kg당 단가 (원, VAT별도)"><input type="number" value={f.kg_price || ''} onChange={(e) => set('kg_price', e.target.value)} className={`w-full px-3 py-2 text-sm text-right tabular-nums ${inputCls}`} /></Field>
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Field label="단위"><input value={f.unit || ''} onChange={(e) => set('unit', e.target.value)} placeholder="ea" className={`w-full px-3 py-2 text-sm ${inputCls}`} /></Field>
            <Field label="롤당 단가"><input type="number" value={f.roll_price || ''} onChange={(e) => set('roll_price', e.target.value)} className={`w-full px-3 py-2 text-sm text-right tabular-nums ${inputCls}`} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="생산가능수량(롤당)"><input type="number" value={f.producible_qty || ''} onChange={(e) => set('producible_qty', e.target.value)} className={`w-full px-3 py-2 text-sm text-right tabular-nums ${inputCls}`} /></Field>
            <Field label="개당 단가 (원)"><input type="number" value={f.unit_price || ''} onChange={(e) => set('unit_price', e.target.value)} className={`w-full px-3 py-2 text-sm text-right tabular-nums ${inputCls}`} /></Field>
          </div>
        </>
      )}
    </ModalShell>
  );
}

// ═══════════════════════════════════════════════
// 묶기(compose) 모달
// ═══════════════════════════════════════════════
function ComposeModal({ targetType, children, onClose, onSaved }: { targetType: string; children: Item[]; onClose: () => void; onSaved: (name: string) => void }) {
  const [name, setName] = useState('');
  const [type, setType] = useState(targetType);
  const [group, setGroup] = useState('');
  const [qtys, setQtys] = useState<Record<number, number>>(() => Object.fromEntries(children.map((c) => [c.id, 1])));
  const [code, setCode] = useState('');
  const [saving, setSaving] = useState(false);
  const cat = children[0]?.product_category;

  useEffect(() => { fetchSafe<any>(`/api/scm/next-code?item_type=${encodeURIComponent(type)}&category=${encodeURIComponent(cat || '')}`, null).then((r) => r?.data?.code && setCode(r.data.code)); }, [type, cat]);

  const typeOptions = targetType === '세트' ? ['세트', '혼합세트'] : ['완제품', '반제품'];

  const save = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    const r = await mutate('/api/scm/items/compose', 'POST', {
      product_name: name, item_type: type, product_category: cat, flavor_group: group || undefined,
      components: children.map((c) => ({ child_item_id: c.id, qty: qtys[c.id] || 1 })),
    });
    setSaving(false);
    if (r.ok && r.data?.success) onSaved(name);
    else alert(r.data?.detail || '생성 실패 (이름 중복 확인)');
  };

  return (
    <ModalShell title={`${children.length}개 품목 묶어 ${targetType} 만들기`} onClose={onClose} onSave={save} saveLabel="생성" wide>
      <div className="grid grid-cols-2 gap-3">
        <Field label="품목명 *"><input value={name} onChange={(e) => setName(e.target.value)} placeholder={targetType === '세트' ? '예: 마카롱 사랑세트' : '예: 마카롱 딸기요거트'} className={`w-full px-3 py-2 text-sm ${inputCls}`} /></Field>
        <Field label="유형"><select value={type} onChange={(e) => setType(e.target.value)} className={`w-full px-3 py-2 text-sm ${inputCls}`}>{typeOptions.map((o) => <option key={o} value={o}>{o}</option>)}</select></Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="맛 그룹 (선택)"><input value={group} onChange={(e) => setGroup(e.target.value)} placeholder="사랑 / 감동 등" className={`w-full px-3 py-2 text-sm ${inputCls}`} /></Field>
        <Field label="ERP 코드"><input value={code} readOnly className={`w-full px-3 py-2 text-sm font-mono ${inputCls} text-[#62666D]`} /></Field>
      </div>
      <Field label={`구성 품목 (${children.length})`}>
        <div className="space-y-1.5 max-h-60 overflow-auto">
          {children.map((c) => (
            <div key={c.id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#08090A] border border-[#1A1B1E]">
              <span className="text-sm text-[#D0D6E0] flex-1 truncate">{c.product_code ? <span className="font-mono text-xs text-[#62666D] mr-1.5">{c.product_code}</span> : null}{c.product_name}</span>
              <span className="text-xs text-[#62666D]">×</span>
              <input type="number" value={qtys[c.id]} onChange={(e) => setQtys((p) => ({ ...p, [c.id]: Number(e.target.value) }))} className={`w-16 px-2 py-1 text-sm text-right ${inputCls}`} />
            </div>
          ))}
        </div>
      </Field>
      {targetType === '완제품' && <p className="text-xs text-[#62666D]">생성 후 상세 화면에서 “+ 자재 추가”로 원부재료(꼬끄·크림 외 포장재 등)를 더할 수 있습니다.</p>}
    </ModalShell>
  );
}

// ═══════════════════════════════════════════════
// 자재 라인 추가 모달 (품목에 원/부자재 투입)
// ═══════════════════════════════════════════════
function BomLineModal({ item, onClose, onSaved }: { item: Item; onClose: () => void; onSaved: () => void }) {
  const [matKind, setMatKind] = useState<'raw' | 'sub'>('raw');
  const [q, setQ] = useState('');
  const [list, setList] = useState<Material[]>([]);
  const [sel, setSel] = useState<Material | null>(null);
  const [qty, setQty] = useState('');
  const [unitMode, setUnitMode] = useState<'kg' | 'g'>('kg');

  useEffect(() => { fetchSafe<any>(`/api/scm/materials/${matKind}?search=${encodeURIComponent(q)}`, { data: [] }).then((r) => setList(r.data || [])); }, [matKind, q]);

  const save = async () => {
    if (!sel) return;
    let qpu = Number(qty) || 0;
    if (matKind === 'raw' && unitMode === 'g') qpu = qpu / 1000;
    await mutate(`/api/scm/items/${item.id}/bom-lines`, 'POST', {
      material_type: matKind,
      raw_material_id: matKind === 'raw' ? sel.id : undefined,
      sub_material_id: matKind === 'sub' ? sel.id : undefined,
      material_name: sel.name, material_erp_code: sel.erp_code,
      qty_per_unit: qpu, qty_unit: matKind === 'raw' ? 'kg' : (sel.unit || 'ea'),
    });
    onSaved();
  };

  return (
    <ModalShell title={`자재 추가 — ${item.product_name}`} onClose={onClose} onSave={save} saveLabel="추가" wide>
      <div className="flex gap-1.5 mb-2">
        {(['raw', 'sub'] as const).map((k) => (
          <button key={k} onClick={() => { setMatKind(k); setSel(null); }} className={`px-3 py-1.5 rounded-full text-xs font-medium border ${matKind === k ? 'bg-[#5E6AD2] text-white border-[#5E6AD2]' : 'bg-[#0F1011] text-[#8A8F98] border-[#23252A]'}`}>{k === 'raw' ? '원재료' : '부자재'}</button>
        ))}
      </div>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="자재 검색..." className={`w-full px-3 py-2 text-sm mb-2 ${inputCls}`} />
      <div className="max-h-48 overflow-auto divide-y divide-[#1A1B1E] border border-[#1A1B1E] rounded-lg mb-3">
        {list.map((m) => (
          <button key={m.id} onClick={() => setSel(m)} className={`w-full text-left px-3 py-2 text-sm flex justify-between ${sel?.id === m.id ? 'bg-[#5E6AD2]/15 text-[#F7F8F8]' : 'text-[#D0D6E0] hover:bg-white/5'}`}>
            <span className="truncate">{m.name}</span>
            <span className="text-xs text-[#62666D] shrink-0 ml-2">{matKind === 'raw' ? `${won(m.kg_price || 0)}/kg` : `${won(m.unit_price || 0)}/${m.unit || 'ea'}`}</span>
          </button>
        ))}
        {list.length === 0 && <div className="px-3 py-6 text-center text-xs text-[#62666D]">검색 결과 없음</div>}
      </div>
      {sel && (
        <div className="flex items-end gap-2">
          <Field label={`개당 투입량 (${matKind === 'raw' ? unitMode : sel.unit || 'ea'})`}>
            <input type="number" value={qty} onChange={(e) => setQty(e.target.value)} className={`w-full px-3 py-2 text-sm text-right tabular-nums ${inputCls}`} />
          </Field>
          {matKind === 'raw' && (
            <div className="flex items-center rounded-lg border border-[#23252A] overflow-hidden mb-0.5">
              {(['kg', 'g'] as const).map((u) => <button key={u} onClick={() => setUnitMode(u)} className={`px-3 py-2 text-xs ${unitMode === u ? 'bg-[#5E6AD2] text-white' : 'text-[#8A8F98]'}`}>{u}</button>)}
            </div>
          )}
        </div>
      )}
    </ModalShell>
  );
}

// ═══════════════════════════════════════════════
// 구성(하위 품목) 추가 모달
// ═══════════════════════════════════════════════
function ComponentModal({ item, onClose, onSaved }: { item: Item; onClose: () => void; onSaved: () => void }) {
  const [q, setQ] = useState('');
  const [list, setList] = useState<Item[]>([]);
  const [sel, setSel] = useState<Item | null>(null);
  const [qty, setQty] = useState('1');

  useEffect(() => { fetchSafe<any>(`/api/scm/products?search=${encodeURIComponent(q)}&active_only=true`, { data: [] }).then((r) => setList((r.data || []).filter((x: Item) => x.id !== item.id))); }, [q, item.id]);

  const save = async () => {
    if (!sel) return;
    await mutate(`/api/scm/items/${item.id}/components`, 'POST', { child_item_id: sel.id, qty: Number(qty) || 1 });
    onSaved();
  };

  return (
    <ModalShell title={`구성 추가 — ${item.product_name}`} onClose={onClose} onSave={save} saveLabel="추가" wide>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="하위 품목 검색 (반제품·완제품)..." className={`w-full px-3 py-2 text-sm mb-2 ${inputCls}`} />
      <div className="max-h-56 overflow-auto divide-y divide-[#1A1B1E] border border-[#1A1B1E] rounded-lg mb-3">
        {list.map((m) => (
          <button key={m.id} onClick={() => setSel(m)} className={`w-full text-left px-3 py-2 text-sm flex justify-between items-center ${sel?.id === m.id ? 'bg-[#5E6AD2]/15 text-[#F7F8F8]' : 'text-[#D0D6E0] hover:bg-white/5'}`}>
            <span className="truncate">{m.product_name}</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded border shrink-0 ml-2 ${TYPE_BADGE[m.item_type] || 'text-[#62666D] border-[#23252A]'}`}>{m.item_type}</span>
          </button>
        ))}
        {list.length === 0 && <div className="px-3 py-6 text-center text-xs text-[#62666D]">검색 결과 없음</div>}
      </div>
      {sel && <Field label="수량 (모품목 1개당)"><input type="number" value={qty} onChange={(e) => setQty(e.target.value)} className={`w-full px-3 py-2 text-sm text-right tabular-nums ${inputCls}`} /></Field>}
    </ModalShell>
  );
}

// ═══════════════════════════════════════════════
// 공통 모달 셸 / 필드
// ═══════════════════════════════════════════════
function ModalShell({ title, children, onClose, onSave, saveLabel, wide }: { title: string; children: React.ReactNode; onClose: () => void; onSave: () => void; saveLabel: string; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative bg-[#0F1011] rounded-2xl shadow-2xl w-full ${wide ? 'max-w-xl' : 'max-w-md'} mx-4 max-h-[90vh] overflow-y-auto border border-[#23252A]`}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#23252A] sticky top-0 bg-[#0F1011] z-10">
          <h2 className="text-base font-bold text-[#F7F8F8]">{title}</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-white/5 text-[#62666D]">✕</button>
        </div>
        <div className="px-5 py-4 space-y-3">{children}</div>
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-[#23252A] bg-[#08090A] rounded-b-2xl sticky bottom-0">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-[#8A8F98] bg-[#0F1011] border border-[#23252A] rounded-lg hover:bg-white/5">취소</button>
          <button onClick={onSave} className="px-5 py-2 text-sm font-medium text-white bg-[#5E6AD2] rounded-lg hover:bg-[#828FFF]">{saveLabel}</button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-[#8A8F98] mb-1.5">{label}</label>
      {children}
    </div>
  );
}

// 가이드용 헬퍼
function GuideBlock({ n, title, color, children }: { n: string; title: string; color: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold" style={{ backgroundColor: `${color}22`, color }}>{n}</span>
      <div>
        <p className="font-semibold text-[#F7F8F8] mb-1">{title}</p>
        <p className="text-[13px] leading-relaxed text-[#8A8F98]">{children}</p>
      </div>
    </div>
  );
}

function Btn({ children }: { children: React.ReactNode }) {
  return <span className="inline-block mx-0.5 px-1.5 py-0.5 rounded bg-[#08090A] border border-[#23252A] text-[#D0D6E0] text-[11px] font-medium align-middle">{children}</span>;
}
