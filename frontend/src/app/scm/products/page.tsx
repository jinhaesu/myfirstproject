'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Navigation } from '@/components/layout/Navigation';

// ─────────────────────────────────────────────
// API helper
// ─────────────────────────────────────────────
const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';

const getAuthHeaders = () => {
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
};

const fetchSafe = async <T,>(path: string, defaultValue: T): Promise<T> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: getAuthHeaders(),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!res.ok) throw new Error();
    return await res.json();
  } catch {
    clearTimeout(timeoutId);
    return defaultValue;
  }
};

const fetchMutate = async (
  path: string,
  method: 'POST' | 'PUT' | 'DELETE',
  body?: unknown,
): Promise<{ ok: boolean; data?: any }> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: getAuthHeaders(),
      signal: controller.signal,
      body: body ? JSON.stringify(body) : undefined,
    });
    clearTimeout(timeoutId);
    if (!res.ok) throw new Error();
    const data = await res.json().catch(() => null);
    return { ok: true, data };
  } catch {
    clearTimeout(timeoutId);
    return { ok: false };
  }
};

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────
interface Product {
  id: number;
  product_name: string;
  product_code: string;
  product_category: string;
  item_type?: string;
  flavor_group?: string;
  default_location: string;
  default_unit_price: number;
  default_cost: number;
  avg_hourly_rate: number;
  total_produced: number;
  total_hours: number;
  safety_stock: number;
  is_active: boolean;
  notes: string;
}

type SortField = keyof Product;
type SortDirection = 'asc' | 'desc';

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────
const CATEGORIES = ['마카롱', '케이크', '쿠키', '비누', '캔들'];
const LOCATIONS = ['1층', '2층', '3층'];

const CATEGORY_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  '마카롱': { bg: 'bg-[#EB5757]/10', text: 'text-[#D04040]', border: 'border-[#EB5757]/25' },
  '케이크': { bg: 'bg-[#F0BF00]/10', text: 'text-[#F0BF00]', border: 'border-[#F0BF00]/30' },
  '쿠키':   { bg: 'bg-[#FC7840]/10', text: 'text-[#FC7840]', border: 'border-[#FC7840]/30' },
  '비누':   { bg: 'bg-[#27A644]/10', text: 'text-[#27A644]', border: 'border-[#27A644]/25' },
  '캔들':   { bg: 'bg-[#5E6AD2]/10', text: 'text-[#828FFF]', border: 'border-[#5E6AD2]/30' },
};

const DEFAULT_CATEGORY_COLOR = { bg: 'bg-[#08090A]', text: 'text-[#D0D6E0]', border: 'border-[#23252A]' };

const ITEM_TYPE_BADGE: Record<string, string> = {
  '세트': 'bg-[#5E6AD2]/15 text-[#828FFF] border-[#5E6AD2]/30',
  '혼합세트': 'bg-[#5E6AD2]/15 text-[#828FFF] border-[#5E6AD2]/30',
  '완제품': 'bg-[#27A644]/10 text-[#27A644] border-[#27A644]/25',
  '반제품': 'bg-[#F0BF00]/10 text-[#F0BF00] border-[#F0BF00]/30',
  '원재료': 'bg-[#4DA3FF]/10 text-[#4DA3FF] border-[#4DA3FF]/25',
  '부자재': 'bg-[#08090A] text-[#8A8F98] border-[#23252A]',
};

// ─────────────────────────────────────────────
// Sample data
// ─────────────────────────────────────────────
const sampleProducts: Product[] = [
  { id: 1, product_name: '널담 마카롱 복숭아 요거트 [50g]', product_code: 'MK-001', product_category: '마카롱', default_location: '2층', default_unit_price: 1200, default_cost: 290, avg_hourly_rate: 290, total_produced: 152800, total_hours: 527, safety_stock: 5000, is_active: true, notes: '' },
  { id: 2, product_name: '널담 마카롱 녹차브라우니 [50g]', product_code: 'MK-002', product_category: '마카롱', default_location: '2층', default_unit_price: 1200, default_cost: 282, avg_hourly_rate: 281, total_produced: 143500, total_hours: 510, safety_stock: 5000, is_active: true, notes: '' },
  { id: 3, product_name: '널담 마카롱 얼그레이캐러멜 [50g]', product_code: 'MK-003', product_category: '마카롱', default_location: '2층', default_unit_price: 1200, default_cost: 275, avg_hourly_rate: 274, total_produced: 98000, total_hours: 358, safety_stock: 3000, is_active: true, notes: '' },
  { id: 4, product_name: '널담 케이크 바닐라치즈 [120g]', product_code: 'CK-001', product_category: '케이크', default_location: '1층', default_unit_price: 3500, default_cost: 820, avg_hourly_rate: 85, total_produced: 42000, total_hours: 494, safety_stock: 2000, is_active: true, notes: '' },
  { id: 5, product_name: '널담 케이크 초콜릿 [120g]', product_code: 'CK-002', product_category: '케이크', default_location: '1층', default_unit_price: 3500, default_cost: 850, avg_hourly_rate: 80, total_produced: 38000, total_hours: 475, safety_stock: 2000, is_active: true, notes: '' },
  { id: 6, product_name: '수제 비누 라벤더 [100g]', product_code: 'SP-001', product_category: '비누', default_location: '3층', default_unit_price: 800, default_cost: 180, avg_hourly_rate: 150, total_produced: 75000, total_hours: 500, safety_stock: 3000, is_active: true, notes: '' },
  { id: 7, product_name: '수제 비누 티트리 [100g]', product_code: 'SP-002', product_category: '비누', default_location: '3층', default_unit_price: 800, default_cost: 190, avg_hourly_rate: 145, total_produced: 58000, total_hours: 400, safety_stock: 3000, is_active: true, notes: '' },
  { id: 8, product_name: '아로마 캔들 우드 [200g]', product_code: 'CD-001', product_category: '캔들', default_location: '3층', default_unit_price: 2000, default_cost: 450, avg_hourly_rate: 45, total_produced: 22500, total_hours: 500, safety_stock: 1000, is_active: true, notes: '시즌 상품' },
  { id: 9, product_name: '버터 쿠키 어쏘트 [150g]', product_code: 'CK-003', product_category: '쿠키', default_location: '1층', default_unit_price: 1500, default_cost: 350, avg_hourly_rate: 120, total_produced: 60000, total_hours: 500, safety_stock: 4000, is_active: true, notes: '' },
  { id: 10, product_name: '초코칩 쿠키 [100g]', product_code: 'CK-004', product_category: '쿠키', default_location: '1층', default_unit_price: 1200, default_cost: 280, avg_hourly_rate: 135, total_produced: 67500, total_hours: 500, safety_stock: 4000, is_active: false, notes: '단종 예정' },
];

// ─────────────────────────────────────────────
// Utility
// ─────────────────────────────────────────────
const fmt = (n: number) => n.toLocaleString('ko-KR');
const fmtDecimal = (n: number) => n.toLocaleString('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const getCategoryColor = (cat: string) => CATEGORY_COLORS[cat] || DEFAULT_CATEGORY_COLOR;

const downloadCSV = (products: Product[]) => {
  const BOM = '\uFEFF';
  const headers = ['품목류', '품목명', '품목코드', '생산 위치', '생산 단가', '원가', '시간당 생산량', '누적 생산량', '누적 시간', '안전재고', '상태', '비고'];
  const csvRows = products.map(p => [
    p.product_category,
    p.product_name,
    p.product_code,
    p.default_location,
    p.default_unit_price,
    p.default_cost,
    p.avg_hourly_rate,
    p.total_produced,
    p.total_hours,
    p.safety_stock,
    p.is_active ? '활성' : '비활성',
    p.notes,
  ].map(v => `"${v}"`).join(','));
  const csv = [headers.map(h => `"${h}"`).join(','), ...csvRows].join('\n');
  const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `품목관리_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
};

let nextTempId = -1;
const getNextTempId = () => nextTempId--;

const createEmptyProduct = (): Product => ({
  id: getNextTempId(),
  product_name: '',
  product_code: '',
  product_category: '마카롱',
  default_location: '2층',
  default_unit_price: 0,
  default_cost: 0,
  avg_hourly_rate: 0,
  total_produced: 0,
  total_hours: 0,
  safety_stock: 0,
  is_active: true,
  notes: '',
});

// ═══════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════
export default function ProductsPage() {
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();

  // ── State ──
  const [products, setProducts] = useState<Product[]>(sampleProducts);
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('전체');
  const [typeFilter, setTypeFilter] = useState<string>('전체');
  const [activeOnlyFilter, setActiveOnlyFilter] = useState(false);
  const [sortField, setSortField] = useState<SortField>('product_category');
  const [sortDir, setSortDir] = useState<SortDirection>('asc');
  const [toast, setToast] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [formData, setFormData] = useState<Product>(createEmptyProduct());

  // Delete confirmation
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);

  // ── Auth guard ──
  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
    }
  }, [authLoading, user, router]);

  // ── Load data ──
  useEffect(() => {
    if (!user) return;
    (async () => {
      const data = await fetchSafe<Product[]>('/api/scm/products', []);
      if (data.length > 0) setProducts(data);
    })();
  }, [user]);

  // ── Toast auto-dismiss ──
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  // ── Filtered + Sorted ──
  const filteredProducts = useMemo(() => {
    let result = [...products];

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter(
        p => p.product_name.toLowerCase().includes(term) || p.product_code.toLowerCase().includes(term),
      );
    }

    if (categoryFilter !== '전체') {
      result = result.filter(p => p.product_category === categoryFilter);
    }

    if (typeFilter !== '전체') {
      result = result.filter(p => (p.item_type || '미분류') === typeFilter);
    }

    if (activeOnlyFilter) {
      result = result.filter(p => p.is_active);
    }

    result.sort((a, b) => {
      const av = a[sortField];
      const bv = b[sortField];
      if (typeof av === 'string' && typeof bv === 'string') {
        return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      if (typeof av === 'number' && typeof bv === 'number') {
        return sortDir === 'asc' ? av - bv : bv - av;
      }
      if (typeof av === 'boolean' && typeof bv === 'boolean') {
        return sortDir === 'asc' ? (av === bv ? 0 : av ? -1 : 1) : (av === bv ? 0 : av ? 1 : -1);
      }
      return 0;
    });

    return result;
  }, [products, searchTerm, categoryFilter, typeFilter, activeOnlyFilter, sortField, sortDir]);

  // ── 동적 카테고리 / 품목유형 (BOM 적재로 늘어난 분류 자동 반영) ──
  const dynamicCategories = useMemo(() => {
    const set = new Set<string>(CATEGORIES);
    products.forEach(p => { if (p.product_category) set.add(p.product_category); });
    return Array.from(set);
  }, [products]);

  const itemTypes = useMemo(() => {
    const set = new Set<string>();
    products.forEach(p => { if (p.item_type) set.add(p.item_type); });
    const order = ['세트', '혼합세트', '완제품', '반제품', '원재료', '부자재'];
    return Array.from(set).sort((a, b) => order.indexOf(a) - order.indexOf(b));
  }, [products]);

  // ── Summary stats ──
  const stats = useMemo(() => {
    const total = products.length;
    const active = products.filter(p => p.is_active).length;
    const activeProducts = products.filter(p => p.is_active && p.avg_hourly_rate > 0);
    const avgRate = activeProducts.length > 0
      ? Math.round(activeProducts.reduce((sum, p) => sum + p.avg_hourly_rate, 0) / activeProducts.length)
      : 0;
    const belowSafety = products.filter(p => p.is_active && p.total_produced < p.safety_stock).length;
    return { total, active, avgRate, belowSafety };
  }, [products]);

  // ── Handlers ──
  const handleSort = useCallback((field: SortField) => {
    setSortField(prev => {
      if (prev === field) {
        setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
        return prev;
      }
      setSortDir('asc');
      return field;
    });
  }, []);

  const showToast = useCallback((msg: string) => setToast(msg), []);

  const openAddModal = useCallback(() => {
    setEditingProduct(null);
    setFormData(createEmptyProduct());
    setShowModal(true);
  }, []);

  const openEditModal = useCallback((product: Product) => {
    setEditingProduct(product);
    setFormData({ ...product });
    setShowModal(true);
  }, []);

  const closeModal = useCallback(() => {
    setShowModal(false);
    setEditingProduct(null);
  }, []);

  const handleFormChange = useCallback((field: keyof Product, value: string | number | boolean) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  }, []);

  const handleSaveProduct = useCallback(async () => {
    if (!formData.product_name.trim() || !formData.product_code.trim()) {
      showToast('품목명과 품목코드를 입력해주세요.');
      return;
    }

    if (editingProduct) {
      // Update
      const result = await fetchMutate(`/api/scm/products/${editingProduct.id}`, 'PUT', formData);
      setProducts(prev => prev.map(p => (p.id === editingProduct.id ? { ...formData } : p)));
      showToast(result.ok ? '품목이 수정되었습니다.' : '품목이 수정되었습니다. (로컬)');
    } else {
      // Create
      const result = await fetchMutate('/api/scm/products', 'POST', formData);
      const newProduct = result.data || { ...formData, id: getNextTempId() };
      setProducts(prev => [...prev, newProduct]);
      showToast(result.ok ? '품목이 추가되었습니다.' : '품목이 추가되었습니다. (로컬)');
    }

    closeModal();
  }, [formData, editingProduct, closeModal, showToast]);

  const handleDelete = useCallback(async (id: number) => {
    const result = await fetchMutate(`/api/scm/products/${id}`, 'DELETE');
    setProducts(prev => prev.filter(p => p.id !== id));
    setDeleteConfirmId(null);
    showToast(result.ok ? '품목이 삭제되었습니다.' : '품목이 삭제되었습니다. (로컬)');
  }, [showToast]);

  const handleToggleActive = useCallback(async (product: Product) => {
    const updated = { ...product, is_active: !product.is_active };
    await fetchMutate(`/api/scm/products/${product.id}`, 'PUT', updated);
    setProducts(prev => prev.map(p => (p.id === product.id ? updated : p)));
    showToast(`${product.product_name} ${updated.is_active ? '활성화' : '비활성화'} 되었습니다.`);
  }, [showToast]);

  const handleSyncRates = useCallback(async () => {
    setSyncing(true);
    const result = await fetchMutate('/api/scm/products/sync-rates', 'POST');
    if (result.ok && Array.isArray(result.data)) {
      setProducts(result.data);
      showToast('시간당 생산량이 동기화되었습니다.');
    } else {
      showToast('동기화 요청을 보냈으나 응답이 없습니다. (API 확인 필요)');
    }
    setSyncing(false);
  }, [showToast]);

  // ── Render guards ──
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#08090A]">
        <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-[#5E6AD2]" />
      </div>
    );
  }
  if (!user) return null;

  // ── Sort indicator ──
  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <span className="ml-1 text-[#62666D]">&#8597;</span>;
    return <span className="ml-1 text-[#7070FF]">{sortDir === 'asc' ? '▲' : '▼'}</span>;
  };

  // ═══════════════════════════════════════════════
  // JSX
  // ═══════════════════════════════════════════════
  return (
    <div className="min-h-screen bg-[#08090A]">
      <Navigation />

      <main className="max-w-[1600px] mx-auto px-4 sm:px-6 py-6">
        {/* ── Header ── */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-[#F7F8F8]">품목 관리</h1>
            <p className="text-sm text-[#8A8F98] mt-1">SCM 전체 품목 마스터 관리</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSyncRates}
              disabled={syncing}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg border border-[#5E6AD2]/30 bg-[#5E6AD2]/10 text-[#828FFF] hover:bg-[#5E6AD2]/15 transition disabled:opacity-50"
            >
              {syncing ? (
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
              ) : (
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
              )}
              시간당 생산량 동기화
            </button>
            <button
              onClick={() => downloadCSV(filteredProducts)}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg border border-[#23252A] bg-[#0F1011] text-[#D0D6E0] hover:bg-white/5/5 transition"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
              CSV 다운로드
            </button>
            <button
              onClick={openAddModal}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-[#5E6AD2] text-white hover:bg-[#828FFF] transition shadow-[0px_1px_3px_rgba(0,0,0,0.2)]"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
              품목 추가
            </button>
          </div>
        </div>

        {/* ── Summary Cards ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div className="bg-[#0F1011] rounded-xl border border-[#23252A] p-5">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-lg bg-[#5E6AD2]/10">
                <svg className="h-5 w-5 text-[#7070FF]" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>
              </div>
              <div>
                <p className="text-xs font-medium text-[#8A8F98] uppercase tracking-wider">총 등록 품목</p>
                <p className="text-2xl font-bold text-[#F7F8F8]">{fmt(stats.total)}</p>
              </div>
            </div>
          </div>
          <div className="bg-[#0F1011] rounded-xl border border-[#23252A] p-5">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-lg bg-[#27A644]/10">
                <svg className="h-5 w-5 text-[#27A644]" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              </div>
              <div>
                <p className="text-xs font-medium text-[#8A8F98] uppercase tracking-wider">활성 품목</p>
                <p className="text-2xl font-bold text-[#F7F8F8]">{fmt(stats.active)}</p>
              </div>
            </div>
          </div>
          <div className="bg-[#0F1011] rounded-xl border border-[#23252A] p-5">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-lg bg-[#F0BF00]/10">
                <svg className="h-5 w-5 text-[#F0BF00]" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
              </div>
              <div>
                <p className="text-xs font-medium text-[#8A8F98] uppercase tracking-wider">평균 시간당 생산량</p>
                <p className="text-2xl font-bold text-[#F7F8F8]">{fmt(stats.avgRate)}<span className="text-sm font-normal text-[#62666D] ml-1">개/h</span></p>
              </div>
            </div>
          </div>
          <div className="bg-[#0F1011] rounded-xl border border-[#23252A] p-5">
            <div className="flex items-center gap-3">
              <div className={`p-2.5 rounded-lg ${stats.belowSafety > 0 ? 'bg-[#EB5757]/10' : 'bg-[#08090A]'}`}>
                <svg className={`h-5 w-5 ${stats.belowSafety > 0 ? 'text-[#EB5757]' : 'text-[#62666D]'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" /></svg>
              </div>
              <div>
                <p className="text-xs font-medium text-[#8A8F98] uppercase tracking-wider">안전재고 미달</p>
                <p className={`text-2xl font-bold ${stats.belowSafety > 0 ? 'text-[#EB5757]' : 'text-[#F7F8F8]'}`}>{stats.belowSafety}<span className="text-sm font-normal text-[#62666D] ml-1">건</span></p>
              </div>
            </div>
          </div>
        </div>

        {/* ── Filters ── */}
        <div className="bg-[#0F1011] rounded-xl border border-[#23252A] p-4 mb-4 flex flex-col sm:flex-row sm:items-center gap-3">
          {/* Search */}
          <div className="relative flex-1 max-w-md">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#62666D]" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            <input
              type="text"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              placeholder="품목명 또는 품목코드 검색..."
              className="w-full pl-10 pr-4 py-2 text-sm border border-[#23252A] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#5E6AD2]/20 focus:border-[#5E6AD2]/50"
            />
          </div>

          {/* Category filter */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {['전체', ...dynamicCategories].map(cat => {
              const isActive = categoryFilter === cat;
              const color = cat !== '전체' ? getCategoryColor(cat) : null;
              return (
                <button
                  key={cat}
                  onClick={() => setCategoryFilter(cat)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-full border transition ${
                    isActive
                      ? cat === '전체'
                        ? 'bg-[#08090A] text-white border-[#34343A]'
                        : `${color!.bg} ${color!.text} ${color!.border} ring-2 ring-offset-1 ring-current`
                      : 'bg-[#0F1011] text-[#8A8F98] border-[#23252A] hover:bg-white/5/5'
                  }`}
                >
                  {cat}
                </button>
              );
            })}
          </div>

          {/* Item type filter (BOM 적재 시 표시) */}
          {itemTypes.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap sm:border-l sm:border-[#23252A] sm:pl-3">
              {['전체', ...itemTypes].map(t => (
                <button
                  key={t}
                  onClick={() => setTypeFilter(t)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-full border transition ${
                    typeFilter === t
                      ? 'bg-[#5E6AD2] text-white border-[#5E6AD2]'
                      : 'bg-[#0F1011] text-[#8A8F98] border-[#23252A] hover:bg-white/5'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          )}

          {/* Active only toggle */}
          <label className="flex items-center gap-2 text-sm text-[#8A8F98] cursor-pointer select-none whitespace-nowrap">
            <input
              type="checkbox"
              checked={activeOnlyFilter}
              onChange={e => setActiveOnlyFilter(e.target.checked)}
              className="rounded border-[#23252A] text-[#7070FF] focus:ring-[#5E6AD2]"
            />
            활성만
          </label>

          <span className="text-xs text-[#62666D] whitespace-nowrap">{filteredProducts.length}건</span>
        </div>

        {/* ── Product Table ── */}
        <div className="bg-[#0F1011] rounded-xl border border-[#23252A] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#08090A] border-b border-[#23252A]">
                  {[
                    { field: 'product_category' as SortField, label: '품목류', w: 'w-24', align: 'text-center' },
                    { field: 'product_name' as SortField, label: '품목명', w: 'min-w-[200px]', align: 'text-left' },
                    { field: 'product_code' as SortField, label: '품목코드', w: 'w-28', align: 'text-center' },
                    { field: 'default_location' as SortField, label: '생산 위치', w: 'w-24', align: 'text-center' },
                    { field: 'default_unit_price' as SortField, label: '생산 단가', w: 'w-28', align: 'text-right' },
                    { field: 'default_cost' as SortField, label: '원가', w: 'w-24', align: 'text-right' },
                    { field: 'avg_hourly_rate' as SortField, label: '시간당 생산량', w: 'w-32', align: 'text-right' },
                    { field: 'total_produced' as SortField, label: '누적 생산량', w: 'w-32', align: 'text-right' },
                    { field: 'total_hours' as SortField, label: '누적 시간', w: 'w-28', align: 'text-right' },
                    { field: 'safety_stock' as SortField, label: '안전재고', w: 'w-28', align: 'text-right' },
                    { field: 'is_active' as SortField, label: '상태', w: 'w-20', align: 'text-center' },
                  ].map(col => (
                    <th
                      key={col.field}
                      onClick={() => handleSort(col.field)}
                      className={`px-3 py-3 ${col.w} ${col.align} font-semibold text-xs text-[#8A8F98] uppercase tracking-wider cursor-pointer hover:bg-white/5/5 transition select-none whitespace-nowrap`}
                    >
                      {col.label}
                      <SortIcon field={col.field} />
                    </th>
                  ))}
                  <th className="px-3 py-3 w-28 text-center font-semibold text-xs text-[#8A8F98] uppercase tracking-wider">액션</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#23252A]">
                {filteredProducts.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="px-4 py-16 text-center text-[#62666D]">
                      <svg className="mx-auto h-12 w-12 text-[#62666D] mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>
                      검색 결과가 없습니다.
                    </td>
                  </tr>
                ) : (
                  filteredProducts.map(product => {
                    const catColor = getCategoryColor(product.product_category);
                    const isInactive = !product.is_active;
                    const rowClass = isInactive ? 'opacity-50' : '';
                    // Trend indicator: compute rate vs simple average to show up/down
                    const computedRate = product.total_hours > 0
                      ? Math.round(product.total_produced / product.total_hours)
                      : 0;
                    const rateMatch = computedRate === product.avg_hourly_rate;
                    const rateUp = computedRate > product.avg_hourly_rate;

                    return (
                      <tr
                        key={product.id}
                        className={`hover:bg-white/5/5/80 transition ${rowClass}`}
                      >
                        {/* Category badge */}
                        <td className="px-3 py-3 text-center">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${catColor.bg} ${catColor.text} ${catColor.border}`}>
                            {product.product_category}
                          </span>
                        </td>
                        {/* Name */}
                        <td className="px-3 py-3 text-left">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => openEditModal(product)}
                              className="text-left text-[#F7F8F8] font-medium hover:text-[#7070FF] hover:underline transition"
                            >
                              {product.product_name}
                            </button>
                            {product.item_type && (
                              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ${ITEM_TYPE_BADGE[product.item_type] || 'bg-[#08090A] text-[#8A8F98] border-[#23252A]'}`}>
                                {product.item_type}
                              </span>
                            )}
                            {product.flavor_group && (
                              <span className="text-[10px] text-[#62666D]">{product.flavor_group}</span>
                            )}
                          </div>
                          {product.notes && (
                            <p className="text-xs text-[#62666D] mt-0.5">{product.notes}</p>
                          )}
                        </td>
                        {/* Code */}
                        <td className="px-3 py-3 text-center font-mono text-xs text-[#8A8F98]">{product.product_code}</td>
                        {/* Location */}
                        <td className="px-3 py-3 text-center text-[#8A8F98]">{product.default_location}</td>
                        {/* Unit Price */}
                        <td className="px-3 py-3 text-right text-[#D0D6E0] font-medium tabular-nums">{fmt(product.default_unit_price)}</td>
                        {/* Cost */}
                        <td className="px-3 py-3 text-right text-[#D0D6E0] tabular-nums">{fmt(product.default_cost)}</td>
                        {/* Hourly Rate with trend */}
                        <td className="px-3 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <span className="font-semibold text-[#F7F8F8] tabular-nums">{fmt(product.avg_hourly_rate)}</span>
                            <span className="text-xs text-[#62666D]">개/h</span>
                            {product.avg_hourly_rate > 0 && (
                              <span className={`text-xs ${rateUp ? 'text-[#27A644]' : rateMatch ? 'text-[#62666D]' : 'text-[#EB5757]'}`}>
                                {rateUp ? '▲' : rateMatch ? '─' : '▼'}
                              </span>
                            )}
                          </div>
                        </td>
                        {/* Total Produced */}
                        <td className="px-3 py-3 text-right text-[#D0D6E0] tabular-nums">{fmt(product.total_produced)}</td>
                        {/* Total Hours */}
                        <td className="px-3 py-3 text-right text-[#D0D6E0] tabular-nums">{fmtDecimal(product.total_hours)}</td>
                        {/* Safety Stock */}
                        <td className="px-3 py-3 text-right tabular-nums">
                          <span className={product.is_active && product.total_produced < product.safety_stock ? 'text-[#EB5757] font-semibold' : 'text-[#D0D6E0]'}>
                            {fmt(product.safety_stock)}
                          </span>
                        </td>
                        {/* Active toggle */}
                        <td className="px-3 py-3 text-center">
                          <button
                            onClick={() => handleToggleActive(product)}
                            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${product.is_active ? 'bg-[#27A644]' : 'bg-[#28282C]'}`}
                          >
                            <span className={`inline-block h-3.5 w-3.5 rounded-full bg-[#0F1011] transition-transform shadow-[0px_1px_3px_rgba(0,0,0,0.2)] ${product.is_active ? 'translate-x-[18px]' : 'translate-x-[3px]'}`} />
                          </button>
                        </td>
                        {/* Actions */}
                        <td className="px-3 py-3 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              onClick={() => openEditModal(product)}
                              className="p-1.5 rounded-md text-[#62666D] hover:text-[#7070FF] hover:bg-[#5E6AD2]/10 transition"
                              title="수정"
                            >
                              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                            </button>
                            {deleteConfirmId === product.id ? (
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={() => handleDelete(product.id)}
                                  className="px-2 py-1 text-xs rounded bg-[#EB5757] text-white hover:bg-[#F07070] transition"
                                >
                                  확인
                                </button>
                                <button
                                  onClick={() => setDeleteConfirmId(null)}
                                  className="px-2 py-1 text-xs rounded bg-[#232326] text-[#8A8F98] hover:bg-white/5/7 transition"
                                >
                                  취소
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => setDeleteConfirmId(product.id)}
                                className="p-1.5 rounded-md text-[#62666D] hover:text-[#EB5757] hover:bg-[#EB5757]/10 transition"
                                title="삭제"
                              >
                                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Toast ── */}
        {toast && (
          <div className="fixed bottom-6 right-6 z-50 animate-slide-up">
            <div className="bg-[#08090A] text-white px-5 py-3 rounded-xl shadow-2xl text-sm flex items-center gap-2">
              <svg className="h-4 w-4 text-[#68CC58] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
              {toast}
            </div>
          </div>
        )}

        {/* ── Add / Edit Modal ── */}
        {showModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={closeModal} />

            {/* Modal content */}
            <div className="relative bg-[#0F1011] rounded-2xl shadow-2xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto">
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-[#23252A]">
                <h2 className="text-lg font-bold text-[#F7F8F8]">
                  {editingProduct ? '품목 수정' : '품목 추가'}
                </h2>
                <button onClick={closeModal} className="p-1 rounded-lg hover:bg-white/5/5 transition">
                  <svg className="h-5 w-5 text-[#62666D]" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>

              {/* Form */}
              <div className="px-6 py-5 space-y-4">
                {/* Row 1: Name + Code */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-[#8A8F98] mb-1.5">품목명 <span className="text-[#EB5757]">*</span></label>
                    <input
                      type="text"
                      value={formData.product_name}
                      onChange={e => handleFormChange('product_name', e.target.value)}
                      placeholder="예: 널담 마카롱 복숭아 요거트 [50g]"
                      className="w-full px-3 py-2 text-sm border border-[#23252A] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#5E6AD2]/20 focus:border-[#5E6AD2]/50"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#8A8F98] mb-1.5">품목코드 <span className="text-[#EB5757]">*</span></label>
                    <input
                      type="text"
                      value={formData.product_code}
                      onChange={e => handleFormChange('product_code', e.target.value)}
                      placeholder="예: MK-001"
                      className="w-full px-3 py-2 text-sm border border-[#23252A] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#5E6AD2]/20 focus:border-[#5E6AD2]/50 font-mono"
                    />
                  </div>
                </div>

                {/* Row 2: Category + Location */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-[#8A8F98] mb-1.5">품목류</label>
                    <select
                      value={formData.product_category}
                      onChange={e => handleFormChange('product_category', e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-[#23252A] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#5E6AD2]/20 focus:border-[#5E6AD2]/50 bg-[#0F1011]"
                    >
                      {CATEGORIES.map(cat => (
                        <option key={cat} value={cat}>{cat}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#8A8F98] mb-1.5">기본 생산 위치</label>
                    <select
                      value={formData.default_location}
                      onChange={e => handleFormChange('default_location', e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-[#23252A] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#5E6AD2]/20 focus:border-[#5E6AD2]/50 bg-[#0F1011]"
                    >
                      {LOCATIONS.map(loc => (
                        <option key={loc} value={loc}>{loc}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Row 3: Unit Price + Cost */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-[#8A8F98] mb-1.5">기본 생산 단가 (원)</label>
                    <input
                      type="number"
                      value={formData.default_unit_price || ''}
                      onChange={e => handleFormChange('default_unit_price', Number(e.target.value))}
                      placeholder="0"
                      className="w-full px-3 py-2 text-sm border border-[#23252A] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#5E6AD2]/20 focus:border-[#5E6AD2]/50 tabular-nums"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#8A8F98] mb-1.5">기본 원가 (원)</label>
                    <input
                      type="number"
                      value={formData.default_cost || ''}
                      onChange={e => handleFormChange('default_cost', Number(e.target.value))}
                      placeholder="0"
                      className="w-full px-3 py-2 text-sm border border-[#23252A] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#5E6AD2]/20 focus:border-[#5E6AD2]/50 tabular-nums"
                    />
                  </div>
                </div>

                {/* Row 4: Safety Stock + Active */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-[#8A8F98] mb-1.5">안전재고</label>
                    <input
                      type="number"
                      value={formData.safety_stock || ''}
                      onChange={e => handleFormChange('safety_stock', Number(e.target.value))}
                      placeholder="0"
                      className="w-full px-3 py-2 text-sm border border-[#23252A] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#5E6AD2]/20 focus:border-[#5E6AD2]/50 tabular-nums"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#8A8F98] mb-1.5">활성 여부</label>
                    <div className="flex items-center gap-3 h-[38px]">
                      <button
                        onClick={() => handleFormChange('is_active', !formData.is_active)}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${formData.is_active ? 'bg-[#27A644]' : 'bg-[#28282C]'}`}
                      >
                        <span className={`inline-block h-4 w-4 rounded-full bg-[#0F1011] transition-transform shadow-[0px_1px_3px_rgba(0,0,0,0.2)] ${formData.is_active ? 'translate-x-6' : 'translate-x-1'}`} />
                      </button>
                      <span className="text-sm text-[#8A8F98]">{formData.is_active ? '활성' : '비활성'}</span>
                    </div>
                  </div>
                </div>

                {/* Row 5: Notes */}
                <div>
                  <label className="block text-xs font-semibold text-[#8A8F98] mb-1.5">비고</label>
                  <textarea
                    value={formData.notes}
                    onChange={e => handleFormChange('notes', e.target.value)}
                    rows={2}
                    placeholder="메모 입력..."
                    className="w-full px-3 py-2 text-sm border border-[#23252A] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#5E6AD2]/20 focus:border-[#5E6AD2]/50 resize-none"
                  />
                </div>

                {/* Info (read-only fields for edit mode) */}
                {editingProduct && (
                  <div className="bg-[#08090A] rounded-lg p-4 border border-[#23252A]">
                    <p className="text-xs font-semibold text-[#8A8F98] mb-2 uppercase tracking-wider">생산 실적 (자동 계산)</p>
                    <div className="grid grid-cols-3 gap-4 text-sm">
                      <div>
                        <span className="text-[#62666D]">시간당 생산량</span>
                        <p className="font-semibold text-[#F7F8F8]">{fmt(formData.avg_hourly_rate)} 개/h</p>
                      </div>
                      <div>
                        <span className="text-[#62666D]">누적 생산량</span>
                        <p className="font-semibold text-[#F7F8F8]">{fmt(formData.total_produced)}</p>
                      </div>
                      <div>
                        <span className="text-[#62666D]">누적 시간</span>
                        <p className="font-semibold text-[#F7F8F8]">{fmtDecimal(formData.total_hours)} h</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-[#23252A] bg-[#08090A] rounded-b-2xl">
                <button
                  onClick={closeModal}
                  className="px-4 py-2 text-sm font-medium text-[#8A8F98] bg-[#0F1011] border border-[#23252A] rounded-lg hover:bg-white/5/5 transition"
                >
                  취소
                </button>
                <button
                  onClick={handleSaveProduct}
                  className="px-5 py-2 text-sm font-medium text-white bg-[#5E6AD2] rounded-lg hover:bg-[#828FFF] transition shadow-[0px_1px_3px_rgba(0,0,0,0.2)]"
                >
                  {editingProduct ? '수정' : '추가'}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* ── Slide-up animation ── */}
      <style jsx>{`
        @keyframes slide-up {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-slide-up {
          animation: slide-up 0.3s ease-out;
        }
      `}</style>
    </div>
  );
}
