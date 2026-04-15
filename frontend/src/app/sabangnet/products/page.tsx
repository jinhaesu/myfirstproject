'use client';

import { useEffect, useState, useMemo } from 'react';
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
): Promise<{ ok: boolean; data?: unknown }> => {
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
  sabangnet_product_code: string;
  product_name: string;
  options: Record<string, unknown> | null;
  category: string | null;
  is_set: boolean;
  set_components: Array<{ product_code: string; qty: number }> | null;
  is_active: boolean;
  mapped_count: number;
  created_at: string | null;
  updated_at: string | null;
}

interface ProductForm {
  sabangnet_product_code: string;
  product_name: string;
  category: string;
  is_set: boolean;
  set_components: Array<{ product_code: string; qty: number }>;
  is_active: boolean;
}

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────
const PRODUCT_CATEGORIES = ['전체', '마카롱', '케이크', '캔들', '비누', '쿠키', '세트'];
const FORM_CATEGORIES = ['마카롱', '케이크', '캔들', '비누', '쿠키', '세트'];

const DEFAULT_FORM: ProductForm = {
  sabangnet_product_code: '',
  product_name: '',
  category: '마카롱',
  is_set: false,
  set_components: [],
  is_active: true,
};

// ─────────────────────────────────────────────
// Sample Data
// ─────────────────────────────────────────────
const sampleProducts: Product[] = [
  {
    id: 1,
    sabangnet_product_code: 'ND-MAC-001',
    product_name: '널담 마카롱 복숭아 요거트 [50g]',
    options: null,
    category: '마카롱',
    is_set: false,
    set_components: null,
    is_active: true,
    mapped_count: 2,
    created_at: '2026-03-20T09:00:00',
    updated_at: null,
  },
  {
    id: 2,
    sabangnet_product_code: 'ND-CAK-001',
    product_name: '널담 케이크 바닐라치즈 [120g]',
    options: null,
    category: '케이크',
    is_set: false,
    set_components: null,
    is_active: true,
    mapped_count: 1,
    created_at: '2026-03-20T09:00:00',
    updated_at: null,
  },
  {
    id: 3,
    sabangnet_product_code: 'ND-CAN-001',
    product_name: '널담 아로마 캔들 우드 [200g]',
    options: null,
    category: '캔들',
    is_set: false,
    set_components: null,
    is_active: true,
    mapped_count: 0,
    created_at: '2026-03-20T09:00:00',
    updated_at: null,
  },
  {
    id: 4,
    sabangnet_product_code: 'ND-SOP-001',
    product_name: '널담 수제 비누 라벤더 [100g]',
    options: null,
    category: '비누',
    is_set: false,
    set_components: null,
    is_active: true,
    mapped_count: 0,
    created_at: '2026-03-20T09:00:00',
    updated_at: null,
  },
  {
    id: 5,
    sabangnet_product_code: 'ND-COK-001',
    product_name: '널담 버터 쿠키 어쏘트 [150g]',
    options: null,
    category: '쿠키',
    is_set: false,
    set_components: null,
    is_active: true,
    mapped_count: 1,
    created_at: '2026-03-20T09:00:00',
    updated_at: null,
  },
  {
    id: 6,
    sabangnet_product_code: 'ND-SET-001',
    product_name: '널담 마카롱 3종 선물세트',
    options: null,
    category: '세트',
    is_set: true,
    set_components: [{ product_code: 'ND-MAC-001', qty: 3 }],
    is_active: true,
    mapped_count: 1,
    created_at: '2026-03-20T09:00:00',
    updated_at: null,
  },
  {
    id: 7,
    sabangnet_product_code: 'ND-SET-002',
    product_name: '널담 비누 라벤더 3개 세트',
    options: null,
    category: '세트',
    is_set: true,
    set_components: [{ product_code: 'ND-SOP-001', qty: 3 }],
    is_active: true,
    mapped_count: 0,
    created_at: '2026-03-20T09:00:00',
    updated_at: null,
  },
];

// ─────────────────────────────────────────────
// Utility
// ─────────────────────────────────────────────
const formatDate = (dateStr: string | null) => {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
};

let nextLocalId = 100;
const getNextId = () => nextLocalId++;

// ═══════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════
export default function ProductsPage() {
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();

  // ── State ──
  const [activeTab, setActiveTab] = useState<'list' | 'register'>('list');
  const [products, setProducts] = useState<Product[]>(sampleProducts);
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('전체');
  const [showProductModal, setShowProductModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [productForm, setProductForm] = useState<ProductForm>({ ...DEFAULT_FORM });
  const [syncing, setSyncing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());

  // ── Auth Guard ──
  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
    }
  }, [user, authLoading, router]);

  // ── Initial Fetch ──
  useEffect(() => {
    if (!user) return;
    fetchSafe<Product[]>('/api/sabangnet/mapping/products', sampleProducts).then((data) => {
      if (data && data.length > 0) setProducts(data);
    });
  }, [user]);

  // ── Toast helper ──
  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  // ── Derived stats ──
  const stats = useMemo(() => ({
    total: products.length,
    setCount: products.filter((p) => p.is_set).length,
    mappedCount: products.filter((p) => p.mapped_count > 0).length,
  }), [products]);

  // ── Filtered list ──
  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      const matchSearch =
        searchTerm === '' ||
        p.product_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.sabangnet_product_code.toLowerCase().includes(searchTerm.toLowerCase());
      const matchCategory =
        categoryFilter === '전체' || p.category === categoryFilter;
      return matchSearch && matchCategory;
    });
  }, [products, searchTerm, categoryFilter]);

  // ── Handlers ──
  const handleSync = async () => {
    setSyncing(true);
    const result = await fetchSafe<Product[]>('/api/sabangnet/mapping/products', []);
    setSyncing(false);
    if (result.length > 0) {
      setProducts(result);
      showToast('사방넷 동기화가 완료되었습니다.');
    } else {
      showToast('동기화 중 오류가 발생했습니다. 샘플 데이터를 유지합니다.');
    }
  };

  const handleInitSample = async () => {
    const result = await fetchMutate('/api/sabangnet/mapping/init-sample-products', 'POST');
    if (result.ok) {
      const refreshed = await fetchSafe<Product[]>('/api/sabangnet/mapping/products', sampleProducts);
      setProducts(refreshed);
      showToast('샘플 제품이 초기화되었습니다.');
    } else {
      setProducts(sampleProducts);
      showToast('샘플 데이터로 초기화되었습니다. (API 미연결)');
    }
  };

  const openRegisterModal = () => {
    setEditingProduct(null);
    setProductForm({ ...DEFAULT_FORM });
    setShowProductModal(true);
  };

  const openEditModal = (product: Product) => {
    setEditingProduct(product);
    setProductForm({
      sabangnet_product_code: product.sabangnet_product_code,
      product_name: product.product_name,
      category: product.category ?? '마카롱',
      is_set: product.is_set,
      set_components: product.set_components ?? [],
      is_active: product.is_active,
    });
    setShowProductModal(true);
  };

  const handleSaveProduct = async () => {
    if (!productForm.sabangnet_product_code.trim() || !productForm.product_name.trim()) {
      showToast('상품코드와 상품명은 필수 입력 항목입니다.');
      return;
    }

    if (editingProduct) {
      // Update
      const result = await fetchMutate(
        `/api/sabangnet/mapping/products/${editingProduct.id}`,
        'PUT',
        productForm,
      );
      if (result.ok) {
        setProducts((prev) =>
          prev.map((p) =>
            p.id === editingProduct.id
              ? {
                  ...p,
                  ...productForm,
                  updated_at: new Date().toISOString(),
                }
              : p,
          ),
        );
        showToast('제품 정보가 수정되었습니다.');
      } else {
        // Fallback: update locally
        setProducts((prev) =>
          prev.map((p) =>
            p.id === editingProduct.id
              ? {
                  ...p,
                  ...productForm,
                  set_components: productForm.is_set ? productForm.set_components : null,
                  updated_at: new Date().toISOString(),
                }
              : p,
          ),
        );
        showToast('제품 정보가 수정되었습니다. (로컬 반영)');
      }
    } else {
      // Create
      const result = await fetchMutate('/api/sabangnet/mapping/products', 'POST', productForm);
      const newProduct: Product = {
        id: (result.ok && result.data && typeof result.data === 'object' && 'id' in result.data)
          ? (result.data as { id: number }).id
          : getNextId(),
        sabangnet_product_code: productForm.sabangnet_product_code,
        product_name: productForm.product_name,
        options: null,
        category: productForm.category,
        is_set: productForm.is_set,
        set_components: productForm.is_set ? productForm.set_components : null,
        is_active: productForm.is_active,
        mapped_count: 0,
        created_at: new Date().toISOString(),
        updated_at: null,
      };
      setProducts((prev) => [newProduct, ...prev]);
      showToast(result.ok ? '제품이 등록되었습니다.' : '제품이 등록되었습니다. (로컬 반영)');
    }

    setShowProductModal(false);
    setEditingProduct(null);
  };

  const toggleRowExpand = (id: number) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const addSetComponent = () => {
    setProductForm((prev) => ({
      ...prev,
      set_components: [...prev.set_components, { product_code: '', qty: 1 }],
    }));
  };

  const updateSetComponent = (index: number, field: 'product_code' | 'qty', value: string | number) => {
    setProductForm((prev) => {
      const updated = [...prev.set_components];
      updated[index] = { ...updated[index], [field]: value };
      return { ...prev, set_components: updated };
    });
  };

  const removeSetComponent = (index: number) => {
    setProductForm((prev) => ({
      ...prev,
      set_components: prev.set_components.filter((_, i) => i !== index),
    }));
  };

  // ── Loading / Unauth ──
  if (authLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-[#08090A]/30 flex items-center justify-center">
        <div className="text-[#8A8F98] text-sm">로딩 중...</div>
      </div>
    );
  }
  if (!user) return null;

  // ══════════════════════════════════════════════
  // Render
  // ══════════════════════════════════════════════
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-[#08090A]/30">
      <Navigation />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* ── Page Header ── */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-[#F7F8F8]">제품 관리</h1>
          <p className="text-sm text-[#8A8F98] mt-1">사방넷에 등록된 자사 제품을 조회하고 관리합니다.</p>
        </div>

        {/* ── Tab Bar ── */}
        <div className="flex gap-1 mb-6 bg-[#0F1011] rounded-xl border border-[#23252A] shadow-[0px_1px_3px_rgba(0,0,0,0.2)] p-1 w-fit">
          {([
            { key: 'list', label: '제품 목록' },
            { key: 'register', label: '제품 등록/수정' },
          ] as const).map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === tab.key
                  ? 'bg-[#5E6AD2] text-white shadow-[0px_1px_3px_rgba(0,0,0,0.2)]'
                  : 'text-[#8A8F98] hover:bg-[#141516]/5'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* ══════════════════════════════════════
            TAB: 제품 목록
        ══════════════════════════════════════ */}
        {activeTab === 'list' && (
          <div className="space-y-5">
            {/* ── Action Row ── */}
            <div className="flex flex-wrap gap-2 justify-between items-center">
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={handleSync}
                  disabled={syncing}
                  className="flex items-center gap-2 px-4 py-2 bg-[#0F1011] border border-[#23252A] rounded-lg text-sm font-medium text-[#D0D6E0] hover:bg-[#141516]/5 shadow-[0px_1px_3px_rgba(0,0,0,0.2)] transition-all disabled:opacity-60"
                >
                  <span className={syncing ? 'animate-spin inline-block' : ''}>&#8635;</span>
                  {syncing ? '동기화 중...' : '사방넷 동기화'}
                </button>
                <button
                  onClick={handleInitSample}
                  className="px-4 py-2 bg-[#0F1011] border border-[#23252A] rounded-lg text-sm font-medium text-[#8A8F98] hover:bg-[#141516]/5 shadow-[0px_1px_3px_rgba(0,0,0,0.2)] transition-all"
                >
                  샘플 초기화
                </button>
              </div>
              <button
                onClick={openRegisterModal}
                className="px-4 py-2 bg-[#5E6AD2] text-white rounded-lg text-sm font-medium hover:bg-[#828FFF] shadow-[0px_1px_3px_rgba(0,0,0,0.2)] transition-all"
              >
                + 제품 등록
              </button>
            </div>

            {/* ── Stats Cards ── */}
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-[#0F1011] rounded-2xl shadow-[0px_1px_3px_rgba(0,0,0,0.2)] border border-[#23252A] p-5">
                <p className="text-xs font-medium text-[#8A8F98] mb-1">총 제품수</p>
                <p className="text-3xl font-bold text-[#F7F8F8]">{stats.total}</p>
              </div>
              <div className="bg-[#0F1011] rounded-2xl shadow-[0px_1px_3px_rgba(0,0,0,0.2)] border border-[#23252A] p-5">
                <p className="text-xs font-medium text-[#8A8F98] mb-1">세트 상품수</p>
                <p className="text-3xl font-bold text-[#7070FF]">{stats.setCount}</p>
              </div>
              <div className="bg-[#0F1011] rounded-2xl shadow-[0px_1px_3px_rgba(0,0,0,0.2)] border border-[#23252A] p-5">
                <p className="text-xs font-medium text-[#8A8F98] mb-1">매핑 완료</p>
                <p className="text-3xl font-bold text-[#27A644]">{stats.mappedCount}</p>
              </div>
            </div>

            {/* ── Filters ── */}
            <div className="bg-[#0F1011] rounded-2xl shadow-[0px_1px_3px_rgba(0,0,0,0.2)] border border-[#23252A] p-5">
              <div className="flex flex-wrap gap-3">
                <input
                  type="text"
                  placeholder="상품명 또는 코드 검색..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="flex-1 min-w-[200px] px-3 py-2 border border-[#23252A] rounded-lg text-sm text-[#D0D6E0] placeholder-[#62666D] focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-[#5E6AD2]/50"
                />
                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  className="px-3 py-2 border border-[#23252A] rounded-lg text-sm text-[#D0D6E0] bg-[#0F1011] focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-[#5E6AD2]/50"
                >
                  {PRODUCT_CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* ── Table ── */}
            <div className="bg-[#0F1011] rounded-2xl shadow-[0px_1px_3px_rgba(0,0,0,0.2)] border border-[#23252A] overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-[#08090A] border-b border-[#23252A]">
                      <th className="text-left px-4 py-3 font-medium text-[#8A8F98] whitespace-nowrap">상품코드</th>
                      <th className="text-left px-4 py-3 font-medium text-[#8A8F98]">상품명</th>
                      <th className="text-left px-4 py-3 font-medium text-[#8A8F98] whitespace-nowrap">카테고리</th>
                      <th className="text-center px-4 py-3 font-medium text-[#8A8F98] whitespace-nowrap">세트</th>
                      <th className="text-center px-4 py-3 font-medium text-[#8A8F98] whitespace-nowrap">매핑수</th>
                      <th className="text-center px-4 py-3 font-medium text-[#8A8F98] whitespace-nowrap">상태</th>
                      <th className="text-left px-4 py-3 font-medium text-[#8A8F98] whitespace-nowrap">등록일</th>
                      <th className="text-center px-4 py-3 font-medium text-[#8A8F98] whitespace-nowrap">액션</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredProducts.length === 0 && (
                      <tr>
                        <td colSpan={8} className="text-center py-12 text-[#62666D]">
                          검색 조건에 맞는 제품이 없습니다.
                        </td>
                      </tr>
                    )}
                    {filteredProducts.map((product) => (
                      <>
                        <tr
                          key={product.id}
                          className="border-b border-[#23252A] hover:bg-[#141516]/5/50 transition-colors"
                        >
                          <td className="px-4 py-3 font-mono text-xs text-[#8A8F98] whitespace-nowrap">
                            {product.sabangnet_product_code}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <span className="text-[#F7F8F8] font-medium">{product.product_name}</span>
                              {product.is_set && product.set_components && product.set_components.length > 0 && (
                                <button
                                  onClick={() => toggleRowExpand(product.id)}
                                  className="text-xs text-[#7070FF] hover:text-[#828FFF]"
                                  title="구성 보기"
                                >
                                  {expandedRows.has(product.id) ? '▲' : '▼'}
                                </button>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-[#141516] text-[#8A8F98] border border-[#23252A]">
                              {product.category ?? '-'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            {product.is_set ? (
                              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-[#5E6AD2]/10 text-[#828FFF] border border-[#5E6AD2]/30">
                                세트
                              </span>
                            ) : (
                              <span className="text-[#62666D]">-</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span
                              className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                                product.mapped_count > 0
                                  ? 'bg-[#27A644]/10 text-[#27A644] border border-emerald-200'
                                  : 'bg-[#08090A] text-[#62666D] border border-[#23252A]'
                              }`}
                            >
                              {product.mapped_count}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span
                              className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                                product.is_active
                                  ? 'bg-[#27A644]/10 text-[#27A644] border border-emerald-200'
                                  : 'bg-[#08090A] text-[#62666D] border border-[#23252A]'
                              }`}
                            >
                              {product.is_active ? '활성' : '비활성'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-[#8A8F98] text-xs whitespace-nowrap">
                            {formatDate(product.created_at)}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <button
                              onClick={() => openEditModal(product)}
                              className="px-3 py-1 text-xs font-medium text-[#7070FF] hover:text-[#828FFF] hover:bg-[#5E6AD2]/10 rounded-lg transition-colors border border-[#5E6AD2]/20"
                            >
                              수정
                            </button>
                          </td>
                        </tr>
                        {/* ── Set Components Row ── */}
                        {product.is_set && expandedRows.has(product.id) && product.set_components && (
                          <tr key={`${product.id}-components`} className="bg-[#5E6AD2]/10/30 border-b border-[#23252A]">
                            <td colSpan={8} className="px-8 py-3">
                              <p className="text-xs font-medium text-[#8A8F98] mb-2">구성 상품</p>
                              <div className="flex flex-wrap gap-2">
                                {product.set_components.map((comp, idx) => (
                                  <span
                                    key={idx}
                                    className="inline-flex items-center gap-1 px-3 py-1 bg-[#0F1011] border border-[#5E6AD2]/30 rounded-full text-xs text-[#828FFF]"
                                  >
                                    <span className="font-mono">{comp.product_code}</span>
                                    <span className="text-[#4EA7FC]">x{comp.qty}</span>
                                  </span>
                                ))}
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Footer count */}
              <div className="px-4 py-3 border-t border-[#23252A] bg-[#08090A]/50">
                <p className="text-xs text-[#62666D]">
                  총 {filteredProducts.length}개 제품
                  {categoryFilter !== '전체' || searchTerm ? ` (전체 ${products.length}개 중 필터됨)` : ''}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════
            TAB: 제품 등록/수정
        ══════════════════════════════════════ */}
        {activeTab === 'register' && (
          <div className="space-y-5">
            <div className="bg-[#0F1011] rounded-2xl shadow-[0px_1px_3px_rgba(0,0,0,0.2)] border border-[#23252A] p-6">
              <h2 className="text-base font-semibold text-[#D0D6E0] mb-5">
                {editingProduct ? '제품 수정' : '신규 제품 등록'}
              </h2>
              <ProductFormFields
                form={productForm}
                onChange={setProductForm}
                onAddComponent={addSetComponent}
                onUpdateComponent={updateSetComponent}
                onRemoveComponent={removeSetComponent}
              />
              <div className="flex gap-3 mt-6 pt-5 border-t border-[#23252A]">
                <button
                  onClick={() => {
                    setEditingProduct(null);
                    setProductForm({ ...DEFAULT_FORM });
                    showToast('폼이 초기화되었습니다.');
                  }}
                  className="px-4 py-2 border border-[#23252A] rounded-lg text-sm font-medium text-[#8A8F98] hover:bg-[#141516]/5 transition-all"
                >
                  초기화
                </button>
                <button
                  onClick={handleSaveProduct}
                  className="px-6 py-2 bg-[#5E6AD2] text-white rounded-lg text-sm font-medium hover:bg-[#828FFF] shadow-[0px_1px_3px_rgba(0,0,0,0.2)] transition-all"
                >
                  {editingProduct ? '수정 저장' : '등록'}
                </button>
              </div>
            </div>

            {/* ── Registered Products List (compact) ── */}
            <div className="bg-[#0F1011] rounded-2xl shadow-[0px_1px_3px_rgba(0,0,0,0.2)] border border-[#23252A] p-5">
              <h3 className="text-sm font-semibold text-[#D0D6E0] mb-4">등록된 제품 ({products.length}개)</h3>
              <div className="space-y-2 max-h-[400px] overflow-y-auto">
                {products.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between px-4 py-3 rounded-xl border border-[#23252A] hover:border-[#23252A] hover:bg-[#141516]/5/50 transition-all"
                  >
                    <div>
                      <span className="font-mono text-xs text-[#62666D] mr-2">{p.sabangnet_product_code}</span>
                      <span className="text-sm text-[#D0D6E0] font-medium">{p.product_name}</span>
                      {p.is_set && (
                        <span className="ml-2 text-xs px-1.5 py-0.5 bg-[#5E6AD2]/10 text-[#7070FF] rounded border border-[#5E6AD2]/20">
                          세트
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => {
                        openEditModal(p);
                        // Switch to inline form for tab-based editing
                        setActiveTab('register');
                      }}
                      className="text-xs text-[#7070FF] hover:text-[#828FFF] font-medium px-2 py-1 rounded hover:bg-[#5E6AD2]/10 transition-colors"
                    >
                      수정
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ══════════════════════════════════════
          Modal: 제품 등록/수정
      ══════════════════════════════════════ */}
      {showProductModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
          <div className="bg-[#0F1011] rounded-2xl shadow-[0px_7px_32px_rgba(0,0,0,0.35)] border border-[#23252A] w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-[#23252A] flex items-center justify-between">
              <h2 className="text-base font-semibold text-[#F7F8F8]">
                {editingProduct ? '제품 수정' : '신규 제품 등록'}
              </h2>
              <button
                onClick={() => {
                  setShowProductModal(false);
                  setEditingProduct(null);
                }}
                className="text-[#62666D] hover:text-[#D0D6E0] text-xl leading-none"
              >
                &times;
              </button>
            </div>

            <div className="px-6 py-5">
              <ProductFormFields
                form={productForm}
                onChange={setProductForm}
                onAddComponent={addSetComponent}
                onUpdateComponent={updateSetComponent}
                onRemoveComponent={removeSetComponent}
              />
            </div>

            <div className="px-6 py-4 border-t border-[#23252A] flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowProductModal(false);
                  setEditingProduct(null);
                }}
                className="px-4 py-2 border border-[#23252A] rounded-lg text-sm font-medium text-[#8A8F98] hover:bg-[#141516]/5 transition-all"
              >
                취소
              </button>
              <button
                onClick={handleSaveProduct}
                className="px-5 py-2 bg-[#5E6AD2] text-white rounded-lg text-sm font-medium hover:bg-[#828FFF] shadow-[0px_1px_3px_rgba(0,0,0,0.2)] transition-all"
              >
                {editingProduct ? '수정 저장' : '등록'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Toast ── */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 px-5 py-3 bg-[#0F1011] text-white text-sm rounded-xl shadow-[0px_7px_32px_rgba(0,0,0,0.35)] animate-fade-in">
          {toast}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// Sub-component: ProductFormFields
// ─────────────────────────────────────────────
interface ProductFormFieldsProps {
  form: ProductForm;
  onChange: React.Dispatch<React.SetStateAction<ProductForm>>;
  onAddComponent: () => void;
  onUpdateComponent: (index: number, field: 'product_code' | 'qty', value: string | number) => void;
  onRemoveComponent: (index: number) => void;
}

function ProductFormFields({
  form,
  onChange,
  onAddComponent,
  onUpdateComponent,
  onRemoveComponent,
}: ProductFormFieldsProps) {
  return (
    <div className="space-y-4">
      {/* 상품코드 */}
      <div>
        <label className="block text-xs font-medium text-[#8A8F98] mb-1">
          상품코드 <span className="text-red-400">*</span>
        </label>
        <input
          type="text"
          placeholder="예: ND-MAC-001"
          value={form.sabangnet_product_code}
          onChange={(e) => onChange((prev) => ({ ...prev, sabangnet_product_code: e.target.value }))}
          className="w-full px-3 py-2 border border-[#23252A] rounded-lg text-sm text-[#D0D6E0] placeholder-[#62666D] focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-[#5E6AD2]/50"
        />
      </div>

      {/* 상품명 */}
      <div>
        <label className="block text-xs font-medium text-[#8A8F98] mb-1">
          상품명 <span className="text-red-400">*</span>
        </label>
        <input
          type="text"
          placeholder="예: 널담 마카롱 복숭아 요거트 [50g]"
          value={form.product_name}
          onChange={(e) => onChange((prev) => ({ ...prev, product_name: e.target.value }))}
          className="w-full px-3 py-2 border border-[#23252A] rounded-lg text-sm text-[#D0D6E0] placeholder-[#62666D] focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-[#5E6AD2]/50"
        />
      </div>

      {/* 카테고리 */}
      <div>
        <label className="block text-xs font-medium text-[#8A8F98] mb-1">카테고리</label>
        <select
          value={form.category}
          onChange={(e) => onChange((prev) => ({ ...prev, category: e.target.value }))}
          className="w-full px-3 py-2 border border-[#23252A] rounded-lg text-sm text-[#D0D6E0] bg-[#0F1011] focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-[#5E6AD2]/50"
        >
          {FORM_CATEGORIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>

      {/* 상태 */}
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-[#8A8F98]">활성 상태</label>
        <button
          type="button"
          onClick={() => onChange((prev) => ({ ...prev, is_active: !prev.is_active }))}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
            form.is_active ? 'bg-[#5E6AD2]' : 'bg-[#232326]'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-[#0F1011] shadow transition-transform ${
              form.is_active ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      {/* 세트 여부 토글 */}
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-[#8A8F98]">세트 상품 여부</label>
        <button
          type="button"
          onClick={() =>
            onChange((prev) => ({
              ...prev,
              is_set: !prev.is_set,
              set_components: !prev.is_set ? prev.set_components : [],
            }))
          }
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
            form.is_set ? 'bg-[#5E6AD2]' : 'bg-[#232326]'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-[#0F1011] shadow transition-transform ${
              form.is_set ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      {/* 세트 구성 상품 */}
      {form.is_set && (
        <div className="bg-[#5E6AD2]/10/50 rounded-xl border border-[#5E6AD2]/20 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-[#828FFF]">구성 상품</p>
            <button
              type="button"
              onClick={onAddComponent}
              className="text-xs text-[#7070FF] hover:text-[#828FFF] font-medium px-2 py-1 bg-[#0F1011] border border-[#5E6AD2]/30 rounded-lg hover:bg-[#5E6AD2]/10 transition-colors"
            >
              + 추가
            </button>
          </div>
          {form.set_components.length === 0 && (
            <p className="text-xs text-[#62666D] text-center py-2">구성 상품을 추가하세요.</p>
          )}
          {form.set_components.map((comp, idx) => (
            <div key={idx} className="flex gap-2 items-center">
              <input
                type="text"
                placeholder="상품코드"
                value={comp.product_code}
                onChange={(e) => onUpdateComponent(idx, 'product_code', e.target.value)}
                className="flex-1 px-3 py-1.5 border border-[#23252A] rounded-lg text-sm text-[#D0D6E0] placeholder-[#62666D] bg-[#0F1011] focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-[#5E6AD2]/50"
              />
              <input
                type="number"
                min={1}
                placeholder="수량"
                value={comp.qty}
                onChange={(e) => onUpdateComponent(idx, 'qty', Number(e.target.value))}
                className="w-20 px-3 py-1.5 border border-[#23252A] rounded-lg text-sm text-[#D0D6E0] bg-[#0F1011] focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-[#5E6AD2]/50"
              />
              <button
                type="button"
                onClick={() => onRemoveComponent(idx)}
                className="text-[#62666D] hover:text-[#EB5757] text-lg leading-none px-1 transition-colors"
              >
                &times;
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
