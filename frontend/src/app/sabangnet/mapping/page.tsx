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
interface MallProduct {
  id: number;
  mall_name: string;
  mall_product_code: string | null;
  mall_product_name: string;
  mall_option_name: string | null;
  mall_option_code: string | null;
  is_mapped: boolean;
  mapped_product_id: number | null;
  mapped_at: string | null;
  created_at: string | null;
}

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

interface Suggestion {
  id: number;
  mall_product_id: number;
  suggested_product_id: number;
  confidence: number;
  match_reason: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'auto_approved';
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string | null;
  mall_product?: MallProduct;
  suggested_product?: Product;
}

interface MappingLog {
  id: number;
  action: string;
  mall_name: string | null;
  details: Record<string, unknown> | null;
  items_processed: number;
  items_success: number;
  items_failed: number;
  error_message: string | null;
  created_at: string | null;
}

interface DashboardData {
  total_products: number;
  total_mall_products: number;
  mapped_count: number;
  unmapped_count: number;
  mapping_rate: number;
  pending_suggestions: number;
  today_processed: number;
  by_mall: Array<{ mall_name: string; total: number; mapped: number; unmapped: number; rate: number }>;
}

interface MappingConfig {
  auto_approve_threshold: number;
  operation_mode: 'semi_auto' | 'auto';
  sabangnet_api_key: string;
}

type TabType = 'unmapped' | 'suggestions' | 'products' | 'dashboard' | 'settings';

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────
const MALL_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  '스마트스토어': { bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-200' },
  '쿠팡':         { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200' },
  '11번가':       { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200' },
  '카카오선물하기': { bg: 'bg-yellow-50', text: 'text-yellow-700', border: 'border-yellow-200' },
  '옥션':         { bg: 'bg-indigo-50', text: 'text-indigo-700', border: 'border-indigo-200' },
  '지마켓':       { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200' },
};

const SUGGESTION_STATUS: Record<string, { bg: string; text: string; border: string; label: string }> = {
  'pending':       { bg: 'bg-amber-50',   text: 'text-amber-700',   border: 'border-amber-200',   label: '대기' },
  'approved':      { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', label: '승인' },
  'rejected':      { bg: 'bg-red-50',     text: 'text-red-700',     border: 'border-red-200',     label: '거부' },
  'auto_approved': { bg: 'bg-blue-50',    text: 'text-blue-700',    border: 'border-blue-200',    label: '자동승인' },
};

const ACTION_LABELS: Record<string, string> = {
  'collect':      '상품 수집',
  'ai_suggest':   'AI 매칭',
  'approve':      '매핑 승인',
  'reject':       '매핑 거부',
  'register':     '상품 등록',
  'auto_approve': '자동 승인',
};

const DEFAULT_BADGE = { bg: 'bg-gray-50', text: 'text-gray-700', border: 'border-gray-200' };
const MALL_OPTIONS = ['전체', '스마트스토어', '쿠팡', '11번가', '카카오선물하기', '옥션', '지마켓'];
const PRODUCT_CATEGORIES = ['전체', '마카롱', '케이크', '캔들', '비누', '쿠키', '세트'];

// ─────────────────────────────────────────────
// Sample Data
// ─────────────────────────────────────────────
const sampleProducts: Product[] = [
  { id: 1, sabangnet_product_code: 'ND-MAC-001', product_name: '널담 마카롱 복숭아 요거트 [50g]', options: null, category: '마카롱', is_set: false, set_components: null, is_active: true, mapped_count: 2, created_at: '2026-03-20T09:00:00', updated_at: null },
  { id: 2, sabangnet_product_code: 'ND-CAK-001', product_name: '널담 케이크 바닐라치즈 [120g]', options: null, category: '케이크', is_set: false, set_components: null, is_active: true, mapped_count: 1, created_at: '2026-03-20T09:00:00', updated_at: null },
  { id: 3, sabangnet_product_code: 'ND-CAN-001', product_name: '널담 아로마 캔들 우드 [200g]', options: null, category: '캔들', is_set: false, set_components: null, is_active: true, mapped_count: 0, created_at: '2026-03-20T09:00:00', updated_at: null },
  { id: 4, sabangnet_product_code: 'ND-SOP-001', product_name: '널담 수제 비누 라벤더 [100g]', options: null, category: '비누', is_set: false, set_components: null, is_active: true, mapped_count: 0, created_at: '2026-03-20T09:00:00', updated_at: null },
  { id: 5, sabangnet_product_code: 'ND-COK-001', product_name: '널담 버터 쿠키 어쏘트 [150g]', options: null, category: '쿠키', is_set: false, set_components: null, is_active: true, mapped_count: 0, created_at: '2026-03-20T09:00:00', updated_at: null },
  { id: 6, sabangnet_product_code: 'ND-SET-001', product_name: '널담 마카롱 3종 선물세트', options: null, category: '세트', is_set: true, set_components: [{ product_code: 'ND-MAC-001', qty: 3 }], is_active: true, mapped_count: 0, created_at: '2026-03-20T09:00:00', updated_at: null },
];

const sampleUnmapped: MallProduct[] = [
  { id: 1, mall_name: '쿠팡', mall_product_code: 'CP-001234', mall_product_name: '널담 마카롱 복숭아 요거트 50g', mall_option_name: '1박스 (10개입)', mall_option_code: null, is_mapped: false, mapped_product_id: null, mapped_at: null, created_at: '2026-03-22T09:00:00' },
  { id: 2, mall_name: '스마트스토어', mall_product_code: 'NSS-005678', mall_product_name: '[널담] 수제 마카롱 복숭아요거트맛 50g', mall_option_name: null, mall_option_code: null, is_mapped: false, mapped_product_id: null, mapped_at: null, created_at: '2026-03-22T09:00:00' },
  { id: 3, mall_name: '11번가', mall_product_code: '11ST-009012', mall_product_name: '널담 바닐라치즈케이크 120g 선물세트', mall_option_name: '2개 묶음', mall_option_code: null, is_mapped: false, mapped_product_id: null, mapped_at: null, created_at: '2026-03-22T09:00:00' },
  { id: 4, mall_name: '쿠팡', mall_product_code: 'CP-003456', mall_product_name: '널담 아로마캔들 우드향 200g', mall_option_name: '단품', mall_option_code: null, is_mapped: false, mapped_product_id: null, mapped_at: null, created_at: '2026-03-22T09:00:00' },
  { id: 5, mall_name: '카카오선물하기', mall_product_code: 'KK-007890', mall_product_name: '널담 수제비누 라벤더 100g 3개 세트', mall_option_name: '3개입 세트', mall_option_code: null, is_mapped: false, mapped_product_id: null, mapped_at: null, created_at: '2026-03-22T09:00:00' },
  { id: 6, mall_name: '지마켓', mall_product_code: 'GM-002345', mall_product_name: '널담 버터쿠키 어쏘트 150g', mall_option_name: null, mall_option_code: null, is_mapped: false, mapped_product_id: null, mapped_at: null, created_at: '2026-03-22T09:00:00' },
];

const sampleSuggestions: Suggestion[] = [
  {
    id: 1, mall_product_id: 1, suggested_product_id: 1, confidence: 0.92,
    match_reason: "상품명 유사도 92%: '널담 마카롱 복숭아 요거트 50g' ≈ '널담 마카롱 복숭아 요거트 [50g]'",
    status: 'pending', reviewed_by: null, reviewed_at: null, created_at: '2026-03-22T09:30:00',
    mall_product: sampleUnmapped[0],
    suggested_product: sampleProducts[0],
  },
  {
    id: 2, mall_product_id: 2, suggested_product_id: 1, confidence: 0.85,
    match_reason: "상품명 유사도 85%: '[널담] 수제 마카롱 복숭아요거트맛 50g' ≈ '널담 마카롱 복숭아 요거트 [50g]'",
    status: 'pending', reviewed_by: null, reviewed_at: null, created_at: '2026-03-22T09:30:00',
    mall_product: sampleUnmapped[1],
    suggested_product: sampleProducts[0],
  },
  {
    id: 3, mall_product_id: 3, suggested_product_id: 2, confidence: 0.78,
    match_reason: "상품명에 '바닐라치즈케이크'가 포함됨, '케이크 바닐라치즈 [120g]'과 매칭. 단, '선물세트' '2개 묶음' 옵션 확인 필요",
    status: 'pending', reviewed_by: null, reviewed_at: null, created_at: '2026-03-22T09:30:00',
    mall_product: sampleUnmapped[2],
    suggested_product: sampleProducts[1],
  },
];

const sampleDashboard: DashboardData = {
  total_products: 7,
  total_mall_products: 6,
  mapped_count: 0,
  unmapped_count: 6,
  mapping_rate: 0,
  pending_suggestions: 3,
  today_processed: 0,
  by_mall: [
    { mall_name: '쿠팡', total: 2, mapped: 0, unmapped: 2, rate: 0 },
    { mall_name: '스마트스토어', total: 1, mapped: 0, unmapped: 1, rate: 0 },
    { mall_name: '11번가', total: 1, mapped: 0, unmapped: 1, rate: 0 },
    { mall_name: '카카오선물하기', total: 1, mapped: 0, unmapped: 1, rate: 0 },
    { mall_name: '지마켓', total: 1, mapped: 0, unmapped: 1, rate: 0 },
  ],
};

const defaultConfig: MappingConfig = {
  auto_approve_threshold: 0.95,
  operation_mode: 'semi_auto',
  sabangnet_api_key: '',
};

// ─────────────────────────────────────────────
// Utility
// ─────────────────────────────────────────────
const formatDate = (dateStr: string | null) => {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day} ${hours}:${minutes}`;
};

const getMallColor = (mall: string) => MALL_COLORS[mall] || DEFAULT_BADGE;
const getSuggestionStatusColor = (status: string) => SUGGESTION_STATUS[status] || { ...DEFAULT_BADGE, label: status };

// ═══════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════
export default function MappingPage() {
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();

  // ── Tab State ──
  const [activeTab, setActiveTab] = useState<TabType>('unmapped');
  const [toast, setToast] = useState<string | null>(null);

  // ── Unmapped tab ──
  const [unmapped, setUnmapped] = useState<MallProduct[]>(sampleUnmapped);
  const [unmappedMallFilter, setUnmappedMallFilter] = useState('전체');
  const [unmappedSearch, setUnmappedSearch] = useState('');
  const [selectedUnmappedIds, setSelectedUnmappedIds] = useState<Set<number>>(new Set());
  const [collecting, setCollecting] = useState(false);
  const [suggestingIds, setSuggestingIds] = useState<Set<number>>(new Set());
  const [bulkSuggesting, setBulkSuggesting] = useState(false);

  // ── Suggestions tab ──
  const [suggestions, setSuggestions] = useState<Suggestion[]>(sampleSuggestions);
  const [suggestionStatusFilter, setSuggestionStatusFilter] = useState('전체');
  const [suggestionMallFilter, setSuggestionMallFilter] = useState('전체');
  const [approvingIds, setApprovingIds] = useState<Set<number>>(new Set());
  const [selectedSuggestionIds, setSelectedSuggestionIds] = useState<Set<number>>(new Set());
  const [bulkApproving, setBulkApproving] = useState(false);

  // ── Products tab ──
  const [products, setProducts] = useState<Product[]>(sampleProducts);
  const [productSearch, setProductSearch] = useState('');
  const [productCategoryFilter, setProductCategoryFilter] = useState('전체');
  const [showProductModal, setShowProductModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [productForm, setProductForm] = useState({
    sabangnet_product_code: '',
    product_name: '',
    category: '',
    is_set: false,
    set_components: [] as Array<{ product_code: string; qty: number }>,
  });

  // ── Dashboard tab ──
  const [dashboard, setDashboard] = useState<DashboardData>(sampleDashboard);
  const [logs, setLogs] = useState<MappingLog[]>([]);

  // ── Settings tab ──
  const [config, setConfig] = useState<MappingConfig>(defaultConfig);
  const [savingConfig, setSavingConfig] = useState(false);

  // ── Auth guard ──
  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
    }
  }, [authLoading, user, router]);

  // ── Load data ──
  useEffect(() => {
    if (!user) return;
    loadUnmapped();
    loadSuggestions();
    loadProducts();
    loadDashboard();
    loadConfig();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const loadUnmapped = async () => {
    const data = await fetchSafe<MallProduct[]>('/api/sabangnet/mapping/unmapped', []);
    if (data.length > 0) setUnmapped(data);
  };

  const loadSuggestions = async () => {
    const data = await fetchSafe<Suggestion[]>('/api/sabangnet/mapping/suggestions', []);
    if (data.length > 0) setSuggestions(data);
  };

  const loadProducts = async () => {
    const data = await fetchSafe<Product[]>('/api/sabangnet/mapping/products', []);
    if (data.length > 0) setProducts(data);
  };

  const loadDashboard = async () => {
    const data = await fetchSafe<DashboardData | null>('/api/sabangnet/mapping/dashboard', null);
    if (data) setDashboard(data);
    const logData = await fetchSafe<MappingLog[]>('/api/sabangnet/mapping/logs', []);
    if (logData.length > 0) setLogs(logData);
  };

  const loadConfig = async () => {
    const data = await fetchSafe<MappingConfig | null>('/api/sabangnet/mapping/config', null);
    if (data) setConfig(prev => ({ ...prev, ...data }));
  };

  // ── Handlers ──
  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const handleCollect = async () => {
    setCollecting(true);
    const result = await fetchMutate('/api/sabangnet/mapping/collect', 'POST');
    setCollecting(false);
    if (result.ok) {
      showToast(`${result.data?.items_created || 0}건 수집 완료`);
      loadUnmapped();
      loadDashboard();
    } else {
      showToast('수집 실패');
    }
  };

  const handleAiSuggest = async (id: number) => {
    setSuggestingIds(prev => new Set(prev).add(id));
    const result = await fetchMutate(`/api/sabangnet/mapping/ai-suggest/${id}`, 'POST');
    setSuggestingIds(prev => { const s = new Set(prev); s.delete(id); return s; });
    if (result.ok) {
      showToast('AI 매칭 제안 생성 완료');
      loadSuggestions();
    } else {
      showToast('AI 매칭 실패');
    }
  };

  const handleBulkSuggest = async () => {
    if (selectedUnmappedIds.size === 0) return;
    setBulkSuggesting(true);
    const result = await fetchMutate('/api/sabangnet/mapping/ai-suggest-bulk', 'POST', {
      mall_product_ids: Array.from(selectedUnmappedIds),
    });
    setBulkSuggesting(false);
    if (result.ok) {
      showToast(`${result.data?.success || 0}건 AI 매칭 완료`);
      setSelectedUnmappedIds(new Set());
      loadSuggestions();
      loadUnmapped();
    }
  };

  const handleApprove = async (suggestionId: number) => {
    setApprovingIds(prev => new Set(prev).add(suggestionId));
    const result = await fetchMutate(`/api/sabangnet/mapping/approve/${suggestionId}`, 'POST');
    setApprovingIds(prev => { const s = new Set(prev); s.delete(suggestionId); return s; });
    if (result.ok) {
      showToast('매핑 승인 완료');
      loadSuggestions();
      loadUnmapped();
      loadDashboard();
    }
  };

  const handleBulkApprove = async () => {
    if (selectedSuggestionIds.size === 0) return;
    setBulkApproving(true);
    const result = await fetchMutate('/api/sabangnet/mapping/approve-bulk', 'POST', {
      suggestion_ids: Array.from(selectedSuggestionIds),
    });
    setBulkApproving(false);
    if (result.ok) {
      showToast(`${result.data?.success || 0}건 일괄 승인 완료`);
      setSelectedSuggestionIds(new Set());
      loadSuggestions();
      loadUnmapped();
      loadDashboard();
    }
  };

  const handleReject = async (suggestionId: number) => {
    const result = await fetchMutate(`/api/sabangnet/mapping/reject/${suggestionId}`, 'POST');
    if (result.ok) {
      showToast('매핑 제안 거부됨');
      loadSuggestions();
    }
  };

  const handleSaveProduct = async () => {
    if (editingProduct) {
      const result = await fetchMutate(`/api/sabangnet/mapping/products/${editingProduct.id}`, 'PUT', productForm);
      if (result.ok) showToast('상품 수정 완료');
    } else {
      const result = await fetchMutate('/api/sabangnet/mapping/products', 'POST', productForm);
      if (result.ok) showToast('상품 등록 완료');
    }
    setShowProductModal(false);
    setEditingProduct(null);
    loadProducts();
  };

  const handleSaveConfig = async () => {
    setSavingConfig(true);
    const result = await fetchMutate('/api/sabangnet/mapping/config', 'PUT', config);
    setSavingConfig(false);
    if (result.ok) showToast('설정 저장 완료');
  };

  const handleInitSample = async () => {
    const result = await fetchMutate('/api/sabangnet/mapping/init-sample-products', 'POST');
    if (result.ok) {
      showToast('샘플 상품 등록 완료');
      loadProducts();
    }
  };

  const openProductModal = (product?: Product) => {
    if (product) {
      setEditingProduct(product);
      setProductForm({
        sabangnet_product_code: product.sabangnet_product_code,
        product_name: product.product_name,
        category: product.category || '',
        is_set: product.is_set,
        set_components: product.set_components || [],
      });
    } else {
      setEditingProduct(null);
      setProductForm({
        sabangnet_product_code: '',
        product_name: '',
        category: '',
        is_set: false,
        set_components: [],
      });
    }
    setShowProductModal(true);
  };

  // ── Filtered Data ──
  const filteredUnmapped = useMemo(() => {
    return unmapped.filter(item => {
      const mallOk = unmappedMallFilter === '전체' || item.mall_name === unmappedMallFilter;
      const searchOk = !unmappedSearch ||
        item.mall_product_name.toLowerCase().includes(unmappedSearch.toLowerCase()) ||
        (item.mall_product_code || '').toLowerCase().includes(unmappedSearch.toLowerCase());
      return mallOk && searchOk;
    });
  }, [unmapped, unmappedMallFilter, unmappedSearch]);

  const filteredSuggestions = useMemo(() => {
    return suggestions.filter(s => {
      const statusOk = suggestionStatusFilter === '전체' || s.status === suggestionStatusFilter;
      const mallOk = suggestionMallFilter === '전체' || s.mall_product?.mall_name === suggestionMallFilter;
      return statusOk && mallOk;
    });
  }, [suggestions, suggestionStatusFilter, suggestionMallFilter]);

  const filteredProducts = useMemo(() => {
    return products.filter(p => {
      const catOk = productCategoryFilter === '전체' || p.category === productCategoryFilter;
      const searchOk = !productSearch ||
        p.product_name.toLowerCase().includes(productSearch.toLowerCase()) ||
        p.sabangnet_product_code.toLowerCase().includes(productSearch.toLowerCase());
      return catOk && searchOk;
    });
  }, [products, productSearch, productCategoryFilter]);

  // ── Loading / Auth ──
  if (authLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50/30 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (!user) return null;

  // ─────────────────────────────────────────────
  // Render: Unmapped Tab
  // ─────────────────────────────────────────────
  const renderUnmappedTab = () => {
    const allSelected = filteredUnmapped.length > 0 &&
      filteredUnmapped.every(item => selectedUnmappedIds.has(item.id));

    const toggleAll = () => {
      if (allSelected) {
        setSelectedUnmappedIds(new Set());
      } else {
        setSelectedUnmappedIds(new Set(filteredUnmapped.map(i => i.id)));
      }
    };

    const toggleOne = (id: number) => {
      setSelectedUnmappedIds(prev => {
        const s = new Set(prev);
        if (s.has(id)) s.delete(id); else s.add(id);
        return s;
      });
    };

    return (
      <div className="space-y-4">
        {/* Action bar */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={handleCollect}
              disabled={collecting}
              className="flex items-center gap-2 bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-60 rounded-lg px-4 py-2 text-sm font-semibold transition-colors"
            >
              {collecting ? (
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
              )}
              {collecting ? '수집 중...' : '미매핑 수집'}
            </button>

            {selectedUnmappedIds.size > 0 && (
              <button
                onClick={handleBulkSuggest}
                disabled={bulkSuggesting}
                className="flex items-center gap-2 bg-violet-500 text-white hover:bg-violet-600 disabled:opacity-60 rounded-lg px-4 py-2 text-sm font-semibold transition-colors"
              >
                {bulkSuggesting ? (
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                )}
                {bulkSuggesting ? 'AI 매칭 중...' : `AI 매칭 요청 (${selectedUnmappedIds.size}건)`}
              </button>
            )}

            <div className="flex-1" />

            {/* Filters */}
            <select
              value={unmappedMallFilter}
              onChange={e => setUnmappedMallFilter(e.target.value)}
              className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-300"
            >
              {MALL_OPTIONS.map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>

            <input
              type="text"
              placeholder="상품명 / 상품코드 검색"
              value={unmappedSearch}
              onChange={e => setUnmappedSearch(e.target.value)}
              className="border border-slate-200 rounded-lg px-3 py-2 text-sm w-52 focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
          </div>
        </div>

        {/* Table */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-4 py-3 text-left w-10">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      className="rounded border-slate-300 text-blue-500 focus:ring-blue-300"
                    />
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">쇼핑몰</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">상품코드</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">상품명</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">옵션</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">수집일시</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">액션</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredUnmapped.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center text-slate-400 text-sm">
                      미매핑 상품이 없습니다
                    </td>
                  </tr>
                ) : (
                  filteredUnmapped.map(item => {
                    const mallColor = getMallColor(item.mall_name);
                    const isSuggesting = suggestingIds.has(item.id);
                    return (
                      <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            checked={selectedUnmappedIds.has(item.id)}
                            onChange={() => toggleOne(item.id)}
                            className="rounded border-slate-300 text-blue-500 focus:ring-blue-300"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <span className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${mallColor.bg} ${mallColor.text} ${mallColor.border}`}>
                            {item.mall_name}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-500">
                          {item.mall_product_code || '-'}
                        </td>
                        <td className="px-4 py-3 text-slate-800 font-medium max-w-xs">
                          <span className="line-clamp-2">{item.mall_product_name}</span>
                        </td>
                        <td className="px-4 py-3 text-slate-500 text-xs">
                          {item.mall_option_name || '-'}
                        </td>
                        <td className="px-4 py-3 text-slate-400 text-xs whitespace-nowrap">
                          {formatDate(item.created_at)}
                        </td>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => handleAiSuggest(item.id)}
                            disabled={isSuggesting}
                            className="flex items-center gap-1.5 bg-violet-50 text-violet-700 border border-violet-200 hover:bg-violet-100 disabled:opacity-60 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap"
                          >
                            {isSuggesting ? (
                              <span className="w-3 h-3 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
                            ) : (
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                              </svg>
                            )}
                            AI 매칭
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          {filteredUnmapped.length > 0 && (
            <div className="px-4 py-3 border-t border-slate-100 bg-slate-50 text-xs text-slate-500">
              총 {filteredUnmapped.length}건
              {selectedUnmappedIds.size > 0 && ` · ${selectedUnmappedIds.size}건 선택됨`}
            </div>
          )}
        </div>
      </div>
    );
  };

  // ─────────────────────────────────────────────
  // Render: Suggestions Tab
  // ─────────────────────────────────────────────
  const renderSuggestionsTab = () => {
    const pendingFiltered = filteredSuggestions.filter(s => s.status === 'pending');

    const toggleSuggestion = (id: number) => {
      setSelectedSuggestionIds(prev => {
        const s = new Set(prev);
        if (s.has(id)) s.delete(id); else s.add(id);
        return s;
      });
    };

    const allSelected = pendingFiltered.length > 0 &&
      pendingFiltered.every(s => selectedSuggestionIds.has(s.id));

    const toggleAllSuggestions = () => {
      if (allSelected) {
        setSelectedSuggestionIds(new Set());
      } else {
        setSelectedSuggestionIds(new Set(pendingFiltered.map(s => s.id)));
      }
    };

    const getConfidenceColor = (c: number) => {
      if (c >= 0.8) return 'bg-emerald-500';
      if (c >= 0.5) return 'bg-amber-500';
      return 'bg-red-500';
    };

    return (
      <div className="space-y-4">
        {/* Filter bar */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4">
          <div className="flex flex-wrap items-center gap-3">
            {/* Bulk approve */}
            {selectedSuggestionIds.size > 0 && (
              <button
                onClick={handleBulkApprove}
                disabled={bulkApproving}
                className="flex items-center gap-2 bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-60 rounded-lg px-4 py-2 text-sm font-semibold transition-colors"
              >
                {bulkApproving ? (
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                )}
                {bulkApproving ? '처리 중...' : `일괄 승인 (${selectedSuggestionIds.size}건)`}
              </button>
            )}

            {pendingFiltered.length > 0 && (
              <button
                onClick={toggleAllSuggestions}
                className="text-sm text-slate-500 hover:text-slate-700 underline"
              >
                {allSelected ? '전체 해제' : `대기 ${pendingFiltered.length}건 전체 선택`}
              </button>
            )}

            <div className="flex-1" />

            <select
              value={suggestionStatusFilter}
              onChange={e => setSuggestionStatusFilter(e.target.value)}
              className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-300"
            >
              {['전체', 'pending', 'approved', 'rejected', 'auto_approved'].map(s => (
                <option key={s} value={s}>
                  {s === '전체' ? '전체 상태' : (SUGGESTION_STATUS[s]?.label || s)}
                </option>
              ))}
            </select>

            <select
              value={suggestionMallFilter}
              onChange={e => setSuggestionMallFilter(e.target.value)}
              className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-300"
            >
              {MALL_OPTIONS.map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Cards */}
        <div className="space-y-3">
          {filteredSuggestions.length === 0 ? (
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-12 text-center text-slate-400 text-sm">
              매칭 제안이 없습니다
            </div>
          ) : (
            filteredSuggestions.map(suggestion => {
              const statusStyle = getSuggestionStatusColor(suggestion.status);
              const mallProduct = suggestion.mall_product;
              const product = suggestion.suggested_product;
              const mallColor = mallProduct ? getMallColor(mallProduct.mall_name) : DEFAULT_BADGE;
              const confidencePct = Math.round(suggestion.confidence * 100);
              const isApproving = approvingIds.has(suggestion.id);
              const isPending = suggestion.status === 'pending';

              return (
                <div key={suggestion.id} className={`bg-white rounded-2xl shadow-sm border border-slate-200 p-5 ${isPending ? 'hover:border-blue-200' : 'opacity-80'} transition-colors`}>
                  <div className="flex items-start gap-3">
                    {/* Checkbox (pending only) */}
                    <div className="pt-1">
                      {isPending ? (
                        <input
                          type="checkbox"
                          checked={selectedSuggestionIds.has(suggestion.id)}
                          onChange={() => toggleSuggestion(suggestion.id)}
                          className="rounded border-slate-300 text-blue-500 focus:ring-blue-300"
                        />
                      ) : (
                        <div className="w-4 h-4" />
                      )}
                    </div>

                    {/* Main content */}
                    <div className="flex-1 min-w-0">
                      {/* Match row */}
                      <div className="flex items-start gap-4">
                        {/* Mall product */}
                        <div className="flex-1 min-w-0 bg-slate-50 rounded-xl p-3.5">
                          <div className="flex items-center gap-2 mb-2">
                            {mallProduct && (
                              <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${mallColor.bg} ${mallColor.text} ${mallColor.border}`}>
                                {mallProduct.mall_name}
                              </span>
                            )}
                            <span className="text-xs text-slate-400 font-mono">{mallProduct?.mall_product_code || '-'}</span>
                          </div>
                          <p className="text-sm font-semibold text-slate-800 leading-snug">{mallProduct?.mall_product_name || '-'}</p>
                          {mallProduct?.mall_option_name && (
                            <p className="text-xs text-slate-500 mt-1">{mallProduct.mall_option_name}</p>
                          )}
                        </div>

                        {/* Arrow + confidence */}
                        <div className="flex flex-col items-center gap-1.5 pt-3 shrink-0">
                          <svg className="w-5 h-5 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                          </svg>
                          <span className={`text-xs font-bold px-2 py-0.5 rounded-full text-white ${getConfidenceColor(suggestion.confidence)}`}>
                            {confidencePct}%
                          </span>
                          <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${getConfidenceColor(suggestion.confidence)}`}
                              style={{ width: `${confidencePct}%` }}
                            />
                          </div>
                        </div>

                        {/* Our product */}
                        <div className="flex-1 min-w-0 bg-blue-50 rounded-xl p-3.5">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="px-2 py-0.5 rounded-full text-xs font-semibold border bg-blue-100 text-blue-700 border-blue-200">
                              자사 상품
                            </span>
                            <span className="text-xs text-slate-400 font-mono">{product?.sabangnet_product_code || '-'}</span>
                          </div>
                          <p className="text-sm font-semibold text-slate-800 leading-snug">{product?.product_name || '-'}</p>
                          {product?.category && (
                            <p className="text-xs text-slate-500 mt-1">{product.category}</p>
                          )}
                        </div>
                      </div>

                      {/* Match reason */}
                      {suggestion.match_reason && (
                        <div className="mt-3 px-3 py-2 bg-amber-50 border border-amber-100 rounded-lg">
                          <p className="text-xs text-amber-800 leading-relaxed">
                            <span className="font-semibold">매칭 근거: </span>
                            {suggestion.match_reason}
                          </p>
                        </div>
                      )}

                      {/* Footer */}
                      <div className="flex items-center justify-between mt-3">
                        <div className="flex items-center gap-2">
                          <span className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${statusStyle.bg} ${statusStyle.text} ${statusStyle.border}`}>
                            {statusStyle.label}
                          </span>
                          <span className="text-xs text-slate-400">{formatDate(suggestion.created_at)}</span>
                          {suggestion.reviewed_at && (
                            <span className="text-xs text-slate-400">검토: {formatDate(suggestion.reviewed_at)}</span>
                          )}
                        </div>

                        {isPending && (
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleReject(suggestion.id)}
                              className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
                            >
                              거부
                            </button>
                            <button
                              onClick={() => handleApprove(suggestion.id)}
                              disabled={isApproving}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-60 transition-colors"
                            >
                              {isApproving ? (
                                <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                              ) : null}
                              승인
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {filteredSuggestions.length > 0 && (
          <div className="text-xs text-slate-400 text-right">
            총 {filteredSuggestions.length}건
            {selectedSuggestionIds.size > 0 && ` · ${selectedSuggestionIds.size}건 선택됨`}
          </div>
        )}
      </div>
    );
  };

  // ─────────────────────────────────────────────
  // Render: Products Tab
  // ─────────────────────────────────────────────
  const renderProductsTab = () => (
    <div className="space-y-4">
      {/* Action bar */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => openProductModal()}
            className="flex items-center gap-2 bg-blue-500 text-white hover:bg-blue-600 rounded-lg px-4 py-2 text-sm font-semibold transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            상품 등록
          </button>

          <button
            onClick={handleInitSample}
            className="flex items-center gap-2 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-lg px-4 py-2 text-sm font-semibold transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            샘플 데이터 초기화
          </button>

          <div className="flex-1" />

          <input
            type="text"
            placeholder="상품명 / 코드 검색"
            value={productSearch}
            onChange={e => setProductSearch(e.target.value)}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm w-52 focus:outline-none focus:ring-2 focus:ring-blue-300"
          />

          <select
            value={productCategoryFilter}
            onChange={e => setProductCategoryFilter(e.target.value)}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-300"
          >
            {PRODUCT_CATEGORIES.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">상품코드</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">상품명</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">카테고리</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">세트</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">매핑수</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">상태</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">액션</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredProducts.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-slate-400 text-sm">
                    등록된 상품이 없습니다
                  </td>
                </tr>
              ) : (
                filteredProducts.map(product => (
                  <tr key={product.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">{product.sabangnet_product_code}</td>
                    <td className="px-4 py-3">
                      <span className="text-slate-800 font-medium">{product.product_name}</span>
                      {product.is_set && product.set_components && product.set_components.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {product.set_components.map((comp, i) => (
                            <span key={i} className="px-1.5 py-0.5 rounded text-xs bg-slate-100 text-slate-500 font-mono">
                              {comp.product_code} x{comp.qty}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="px-2.5 py-1 rounded-full text-xs font-semibold border bg-slate-50 text-slate-600 border-slate-200">
                        {product.category || '-'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {product.is_set ? (
                        <span className="flex items-center gap-1 text-xs text-violet-600 font-semibold">
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                          </svg>
                          세트
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400">단품</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${product.mapped_count > 0 ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-50 text-slate-500 border-slate-200'}`}>
                        {product.mapped_count}개
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${product.is_active ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-600 border-red-200'}`}>
                        {product.is_active ? '활성' : '비활성'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => openProductModal(product)}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
                      >
                        수정
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {filteredProducts.length > 0 && (
          <div className="px-4 py-3 border-t border-slate-100 bg-slate-50 text-xs text-slate-500">
            총 {filteredProducts.length}건
          </div>
        )}
      </div>
    </div>
  );

  // ─────────────────────────────────────────────
  // Render: Dashboard Tab
  // ─────────────────────────────────────────────
  const renderDashboardTab = () => (
    <div className="space-y-5">
      {/* Stats cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total products */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">총 자사 상품</p>
              <p className="text-3xl font-bold text-slate-800 mt-1">{dashboard.total_products.toLocaleString()}</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
            </div>
          </div>
        </div>

        {/* Total mall products */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">쇼핑몰 상품</p>
              <p className="text-3xl font-bold text-slate-800 mt-1">{dashboard.total_mall_products.toLocaleString()}</p>
              <p className="text-xs text-slate-400 mt-1">매핑됨 {dashboard.mapped_count} / 미매핑 {dashboard.unmapped_count}</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-violet-50 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-violet-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
            </div>
          </div>
        </div>

        {/* Mapping rate */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
          <div className="flex items-start justify-between mb-3">
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">매핑률</p>
              <p className="text-3xl font-bold text-slate-800 mt-1">{dashboard.mapping_rate.toFixed(1)}%</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
          </div>
          <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-400 rounded-full transition-all"
              style={{ width: `${Math.min(dashboard.mapping_rate, 100)}%` }}
            />
          </div>
        </div>

        {/* Pending suggestions */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">대기 제안</p>
              <p className="text-3xl font-bold text-slate-800 mt-1">{dashboard.pending_suggestions.toLocaleString()}</p>
              <p className="text-xs text-slate-400 mt-1">오늘 처리 {dashboard.today_processed}건</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>
        </div>
      </div>

      {/* By mall */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
        <h3 className="text-sm font-bold text-slate-700 mb-4">쇼핑몰별 매핑 현황</h3>
        <div className="space-y-3">
          {dashboard.by_mall.map(mall => {
            const mallColor = getMallColor(mall.mall_name);
            return (
              <div key={mall.mall_name}>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${mallColor.bg} ${mallColor.text} ${mallColor.border}`}>
                      {mall.mall_name}
                    </span>
                    <span className="text-xs text-slate-400">
                      {mall.mapped} / {mall.total}
                    </span>
                  </div>
                  <span className="text-xs font-semibold text-slate-600">{mall.rate.toFixed(1)}%</span>
                </div>
                <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${mall.rate >= 80 ? 'bg-emerald-400' : mall.rate >= 50 ? 'bg-amber-400' : 'bg-red-400'}`}
                    style={{ width: `${Math.min(mall.rate, 100)}%` }}
                  />
                </div>
              </div>
            );
          })}

          {dashboard.by_mall.length === 0 && (
            <p className="text-sm text-slate-400 text-center py-4">데이터가 없습니다</p>
          )}
        </div>
      </div>

      {/* Logs */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100">
          <h3 className="text-sm font-bold text-slate-700">최근 작업 이력</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">시간</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">액션</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">쇼핑몰</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">처리</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">결과</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-400 text-sm">
                    작업 이력이 없습니다
                  </td>
                </tr>
              ) : (
                logs.map(log => (
                  <tr key={log.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 text-xs text-slate-400 whitespace-nowrap">{formatDate(log.created_at)}</td>
                    <td className="px-4 py-3">
                      <span className="px-2.5 py-1 rounded-full text-xs font-semibold border bg-slate-50 text-slate-600 border-slate-200">
                        {ACTION_LABELS[log.action] || log.action}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">{log.mall_name || '-'}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">{log.items_processed}건</td>
                    <td className="px-4 py-3">
                      {log.error_message ? (
                        <span className="text-xs text-red-500">{log.error_message}</span>
                      ) : (
                        <span className="text-xs text-emerald-600">
                          성공 {log.items_success} / 실패 {log.items_failed}
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  // ─────────────────────────────────────────────
  // Render: Settings Tab
  // ─────────────────────────────────────────────
  const renderSettingsTab = () => (
    <div className="max-w-2xl space-y-5">
      {/* Operation mode */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
        <h3 className="text-sm font-bold text-slate-700 mb-4">운영 모드</h3>
        <div className="space-y-3">
          {[
            {
              value: 'semi_auto',
              label: '반자동',
              desc: 'AI 매칭 제안을 확인 후 수동 승인합니다',
            },
            {
              value: 'auto',
              label: '자동',
              desc: '신뢰도 기준 이상의 매칭을 자동 승인합니다',
            },
          ].map(opt => (
            <label
              key={opt.value}
              className={`flex items-start gap-3 p-4 rounded-xl border-2 cursor-pointer transition-colors ${
                config.operation_mode === opt.value
                  ? 'border-blue-400 bg-blue-50'
                  : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              <input
                type="radio"
                name="operation_mode"
                value={opt.value}
                checked={config.operation_mode === opt.value}
                onChange={() => setConfig(prev => ({ ...prev, operation_mode: opt.value as 'semi_auto' | 'auto' }))}
                className="mt-0.5 text-blue-500 focus:ring-blue-300"
              />
              <div>
                <p className="text-sm font-semibold text-slate-800">{opt.label}</p>
                <p className="text-xs text-slate-500 mt-0.5">{opt.desc}</p>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Auto-approve threshold */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
        <h3 className="text-sm font-bold text-slate-700 mb-4">자동 승인 기준 신뢰도</h3>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500">최소 신뢰도</span>
            <span className="text-lg font-bold text-blue-600">
              {(config.auto_approve_threshold * 100).toFixed(0)}%
            </span>
          </div>
          <input
            type="range"
            min={0.5}
            max={1.0}
            step={0.05}
            value={config.auto_approve_threshold}
            onChange={e => setConfig(prev => ({ ...prev, auto_approve_threshold: parseFloat(e.target.value) }))}
            className="w-full h-2 bg-slate-200 rounded-full appearance-none cursor-pointer accent-blue-500"
          />
          <div className="flex justify-between text-xs text-slate-400">
            <span>50%</span>
            <span>75%</span>
            <span>100%</span>
          </div>
          <p className="text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-2">
            신뢰도 {(config.auto_approve_threshold * 100).toFixed(0)}% 이상인 AI 매칭 제안을 자동으로 승인합니다.
            자동 모드에서만 적용됩니다.
          </p>
        </div>
      </div>

      {/* API Key */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
        <h3 className="text-sm font-bold text-slate-700 mb-4">사방넷 API 키</h3>
        <input
          type="text"
          placeholder="사방넷 API 키를 입력하세요"
          value={config.sabangnet_api_key}
          onChange={e => setConfig(prev => ({ ...prev, sabangnet_api_key: e.target.value }))}
          className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
        />
        <p className="text-xs text-slate-400 mt-2">사방넷 관리자 페이지에서 발급된 API 키를 입력합니다.</p>
      </div>

      {/* Save button */}
      <button
        onClick={handleSaveConfig}
        disabled={savingConfig}
        className="flex items-center gap-2 bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-60 rounded-lg px-6 py-2.5 text-sm font-semibold transition-colors"
      >
        {savingConfig ? (
          <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
        ) : (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
          </svg>
        )}
        {savingConfig ? '저장 중...' : '설정 저장'}
      </button>
    </div>
  );

  // ─────────────────────────────────────────────
  // Render: Product Modal
  // ─────────────────────────────────────────────
  const renderProductModal = () => {
    const addComponent = () => {
      setProductForm(prev => ({
        ...prev,
        set_components: [...prev.set_components, { product_code: '', qty: 1 }],
      }));
    };

    const removeComponent = (index: number) => {
      setProductForm(prev => ({
        ...prev,
        set_components: prev.set_components.filter((_, i) => i !== index),
      }));
    };

    const updateComponent = (index: number, field: 'product_code' | 'qty', value: string | number) => {
      setProductForm(prev => ({
        ...prev,
        set_components: prev.set_components.map((comp, i) =>
          i === index ? { ...comp, [field]: value } : comp
        ),
      }));
    };

    return (
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
            <h2 className="text-base font-bold text-slate-800">
              {editingProduct ? '상품 수정' : '상품 등록'}
            </h2>
            <button
              onClick={() => { setShowProductModal(false); setEditingProduct(null); }}
              className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="px-6 py-5 space-y-4">
            {/* Product code */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">상품코드</label>
              <input
                type="text"
                placeholder="ND-XXX-001"
                value={productForm.sabangnet_product_code}
                onChange={e => setProductForm(prev => ({ ...prev, sabangnet_product_code: e.target.value }))}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
            </div>

            {/* Product name */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">상품명</label>
              <input
                type="text"
                placeholder="상품명을 입력하세요"
                value={productForm.product_name}
                onChange={e => setProductForm(prev => ({ ...prev, product_name: e.target.value }))}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
            </div>

            {/* Category */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">카테고리</label>
              <select
                value={productForm.category}
                onChange={e => setProductForm(prev => ({ ...prev, category: e.target.value }))}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-300"
              >
                <option value="">카테고리 선택</option>
                {PRODUCT_CATEGORIES.filter(c => c !== '전체').map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>

            {/* Is set toggle */}
            <div>
              <label className="flex items-center gap-3 cursor-pointer">
                <div
                  onClick={() => setProductForm(prev => ({
                    ...prev,
                    is_set: !prev.is_set,
                    set_components: !prev.is_set ? prev.set_components : [],
                  }))}
                  className={`relative w-11 h-6 rounded-full transition-colors cursor-pointer ${productForm.is_set ? 'bg-blue-500' : 'bg-slate-200'}`}
                >
                  <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${productForm.is_set ? 'translate-x-5' : 'translate-x-0.5'}`} />
                </div>
                <span className="text-sm font-semibold text-slate-700">세트 상품</span>
              </label>
            </div>

            {/* Set components */}
            {productForm.is_set && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-semibold text-slate-600">구성 상품</label>
                  <button
                    onClick={addComponent}
                    className="flex items-center gap-1 text-xs text-blue-500 hover:text-blue-600 font-semibold"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    구성 추가
                  </button>
                </div>
                <div className="space-y-2">
                  {productForm.set_components.map((comp, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input
                        type="text"
                        placeholder="상품코드"
                        value={comp.product_code}
                        onChange={e => updateComponent(i, 'product_code', e.target.value)}
                        className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 font-mono"
                      />
                      <input
                        type="number"
                        min={1}
                        value={comp.qty}
                        onChange={e => updateComponent(i, 'qty', parseInt(e.target.value) || 1)}
                        className="w-20 border border-slate-200 rounded-lg px-3 py-2 text-sm text-center focus:outline-none focus:ring-2 focus:ring-blue-300"
                      />
                      <span className="text-xs text-slate-400">개</span>
                      <button
                        onClick={() => removeComponent(i)}
                        className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-50 text-slate-300 hover:text-red-400 transition-colors"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                  {productForm.set_components.length === 0 && (
                    <p className="text-xs text-slate-400 text-center py-2">구성 상품을 추가하세요</p>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-100">
            <button
              onClick={() => { setShowProductModal(false); setEditingProduct(null); }}
              className="px-4 py-2 rounded-lg text-sm font-semibold border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
            >
              취소
            </button>
            <button
              onClick={handleSaveProduct}
              disabled={!productForm.sabangnet_product_code || !productForm.product_name}
              className="px-4 py-2 rounded-lg text-sm font-semibold bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-60 transition-colors"
            >
              {editingProduct ? '수정 저장' : '등록'}
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ─────────────────────────────────────────────
  // Main Render
  // ─────────────────────────────────────────────
  const pendingSuggestionsCount = suggestions.filter(s => s.status === 'pending').length;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50/30">
      <Navigation />

      <main className="max-w-[1400px] mx-auto px-4 py-6">
        {/* Page header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900">매핑 자동화</h1>
          <p className="text-sm text-slate-500 mt-1">사방넷 상품 매핑을 AI로 자동화합니다</p>
        </div>

        {/* Tab navigation */}
        <div className="flex gap-1 mb-6 bg-white rounded-xl p-1 shadow-sm border border-slate-200 overflow-x-auto">
          {[
            { key: 'unmapped', label: '미매핑 상품', count: filteredUnmapped.length },
            { key: 'suggestions', label: 'AI 매칭 제안', count: pendingSuggestionsCount },
            { key: 'products', label: '상품 관리', count: products.length },
            { key: 'dashboard', label: '대시보드' },
            { key: 'settings', label: '설정' },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as TabType)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all whitespace-nowrap ${
                activeTab === tab.key
                  ? 'bg-blue-500 text-white shadow-sm'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {tab.label}
              {'count' in tab && tab.count !== undefined && (
                <span className={`px-1.5 py-0.5 rounded-full text-xs ${
                  activeTab === tab.key ? 'bg-blue-400 text-white' : 'bg-slate-200 text-slate-600'
                }`}>
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {activeTab === 'unmapped' && renderUnmappedTab()}
        {activeTab === 'suggestions' && renderSuggestionsTab()}
        {activeTab === 'products' && renderProductsTab()}
        {activeTab === 'dashboard' && renderDashboardTab()}
        {activeTab === 'settings' && renderSettingsTab()}
      </main>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 bg-slate-900 text-white px-5 py-3 rounded-xl shadow-lg text-sm z-50 animate-fade-in">
          {toast}
        </div>
      )}

      {/* Product modal */}
      {showProductModal && renderProductModal()}
    </div>
  );
}
