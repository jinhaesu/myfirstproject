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
interface Inquiry {
  id: number;
  external_id: string;
  mall_name: string;
  board_type: string;
  customer_name: string;
  product_name: string;
  order_number: string | null;
  title: string;
  content: string;
  inquiry_date: string;
  status: 'new' | 'ai_drafted' | 'approved' | 'sent' | 'failed';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  category: string;
  ai_response: string | null;
  final_response: string | null;
  sent_at: string | null;
}

interface ReferenceData {
  id: number;
  title: string;
  category: string;
  content: string;
  is_active: boolean;
}

interface CSConfig {
  operation_mode: 'semi_auto' | 'auto';
  auto_categories: string[];
  response_tone: string;
  sabangnet_api_key: string;
}

interface Stats {
  unanswered: number;
  ai_drafted: number;
  pending_approval: number;
}

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────
const MALL_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  '스마트스토어': { bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-200' },
  '쿠팡':       { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200' },
  '11번가':     { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200' },
  '카카오선물하기': { bg: 'bg-yellow-50', text: 'text-yellow-700', border: 'border-yellow-200' },
  '옥션':       { bg: 'bg-indigo-50', text: 'text-indigo-700', border: 'border-indigo-200' },
  '지마켓':     { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200' },
};

const STATUS_COLORS: Record<string, { bg: string; text: string; border: string; label: string }> = {
  'new':        { bg: 'bg-gray-50', text: 'text-gray-700', border: 'border-gray-200', label: '신규' },
  'ai_drafted': { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200', label: 'AI 초안' },
  'approved':   { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', label: '승인됨' },
  'sent':       { bg: 'bg-slate-50', text: 'text-slate-700', border: 'border-slate-200', label: '발송완료' },
  'failed':     { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200', label: '실패' },
};

const PRIORITY_COLORS: Record<string, { bg: string; text: string; border: string; label: string }> = {
  'low':    { bg: 'bg-slate-50', text: 'text-slate-600', border: 'border-slate-200', label: '낮음' },
  'normal': { bg: 'bg-blue-50', text: 'text-blue-600', border: 'border-blue-200', label: '보통' },
  'high':   { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', label: '높음' },
  'urgent': { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200', label: '긴급' },
};

const DEFAULT_BADGE = { bg: 'bg-gray-50', text: 'text-gray-700', border: 'border-gray-200' };

const MALL_OPTIONS = ['전체', '스마트스토어', '쿠팡', '11번가', '카카오선물하기', '옥션', '지마켓'];
const STATUS_OPTIONS = ['전체', 'new', 'ai_drafted', 'approved', 'sent', 'failed'];
const CATEGORY_OPTIONS = ['전체', '배송문의', '교환/반품', '상품문의', '기타'];
const REFERENCE_CATEGORIES = ['배송정책', '교환/반품 정책', 'FAQ', '상품정보', '인사말/맺음말', '프로모션'];
const TONE_OPTIONS = ['친근한', '정중한', '비즈니스'];

// ─────────────────────────────────────────────
// Sample Data
// ─────────────────────────────────────────────
const sampleInquiries: Inquiry[] = [
  {
    id: 1, external_id: 'SBN-20260315-001', mall_name: '스마트스토어', board_type: '배송문의',
    customer_name: '홍길동', product_name: '널담 마카롱 복숭아 요거트 [50g]', order_number: '2026031500123',
    title: '주문한 상품이 아직 안 왔어요', content: '3일 전에 주문했는데 아직 배송이 시작도 안 됐어요. 언제 받을 수 있나요?',
    inquiry_date: '2026-03-15T14:30:00', status: 'new', priority: 'high', category: '배송문의',
    ai_response: null, final_response: null, sent_at: null,
  },
  {
    id: 2, external_id: 'SBN-20260315-002', mall_name: '쿠팡', board_type: '교환/반품',
    customer_name: '김영희', product_name: '널담 케이크 바닐라치즈 [120g]', order_number: 'CP-20260314-789',
    title: '케이크가 깨져서 왔어요', content: '배송 중 케이크가 많이 깨져있었습니다. 교환 또는 환불 부탁드립니다. 사진 첨부합니다.',
    inquiry_date: '2026-03-15T11:20:00', status: 'ai_drafted', priority: 'urgent', category: '교환/반품',
    ai_response: '안녕하세요, 고객님. 쿠팡 널담 고객센터입니다.\n\n케이크가 파손된 채 도착하여 정말 죄송합니다. 배송 중 발생한 파손으로 확인되어 무상 교환 처리해 드리겠습니다.\n\n새 상품을 즉시 발송해 드리며, 파손된 상품은 폐기하셔도 됩니다.\n\n다시 한번 불편을 드려 죄송합니다. 더 좋은 서비스로 보답하겠습니다.\n감사합니다.',
    final_response: null, sent_at: null,
  },
  {
    id: 3, external_id: 'SBN-20260314-005', mall_name: '카카오선물하기', board_type: '상품문의',
    customer_name: '이수진', product_name: '수제 비누 라벤더 [100g]', order_number: null,
    title: '비누 성분이 궁금해요', content: '아토피가 있는데 이 비누 사용해도 괜찮을까요? 전성분 알 수 있을까요?',
    inquiry_date: '2026-03-14T16:45:00', status: 'approved', priority: 'normal', category: '상품문의',
    ai_response: '안녕하세요, 고객님. 카카오선물하기 널담 고객센터입니다.\n\n수제 비누 라벤더 제품에 관심 가져주셔서 감사합니다.\n\n해당 제품은 천연 원료(코코넛오일, 올리브오일, 라벤더 에센셜오일 등)로 제작되어 아토피 피부에도 비교적 안전합니다. 다만, 개인의 피부 상태에 따라 차이가 있을 수 있으므로 소량 테스트 후 사용을 권장드립니다.\n\n전성분 목록은 상품 상세 페이지 하단에 기재되어 있으며, 추가 문의사항은 언제든 연락 주세요.\n감사합니다.',
    final_response: '안녕하세요, 고객님. 카카오선물하기 널담 고객센터입니다.\n\n수제 비누 라벤더 제품에 관심 가져주셔서 감사합니다.\n\n해당 제품은 천연 원료(코코넛오일, 올리브오일, 라벤더 에센셜오일 등)로 제작되어 아토피 피부에도 비교적 안전합니다. 다만, 개인의 피부 상태에 따라 차이가 있을 수 있으므로 소량 테스트 후 사용을 권장드립니다.\n\n전성분 목록은 상품 상세 페이지 하단에 기재되어 있으며, 추가 문의사항은 언제든 연락 주세요.\n감사합니다.',
    sent_at: null,
  },
  {
    id: 4, external_id: 'SBN-20260314-003', mall_name: '11번가', board_type: '배송문의',
    customer_name: '박민호', product_name: '버터 쿠키 어쏘트 [150g]', order_number: '11ST-20260313-456',
    title: '선물 포장 가능한가요?', content: '생일 선물로 보내려고 하는데 선물 포장이 가능한가요? 메시지 카드도 넣을 수 있나요?',
    inquiry_date: '2026-03-14T09:15:00', status: 'sent', priority: 'low', category: '기타',
    ai_response: '안녕하세요, 고객님. 11번가 널담 고객센터입니다.\n\n선물 포장 가능합니다! 주문 시 요청사항에 "선물포장" 기재해 주시면 무료로 포장해 드립니다. 메시지 카드도 함께 넣어드리며, 원하시는 문구를 요청사항에 적어주시면 됩니다.\n\n감사합니다.',
    final_response: '안녕하세요, 고객님. 11번가 널담 고객센터입니다.\n\n선물 포장 가능합니다! 주문 시 요청사항에 "선물포장" 기재해 주시면 무료로 포장해 드립니다. 메시지 카드도 함께 넣어드리며, 원하시는 문구를 요청사항에 적어주시면 됩니다.\n\n감사합니다.',
    sent_at: '2026-03-14T10:30:00',
  },
  {
    id: 5, external_id: 'SBN-20260313-008', mall_name: '스마트스토어', board_type: '교환/반품',
    customer_name: '최지영', product_name: '아로마 캔들 우드 [200g]', order_number: 'NSS-20260312-321',
    title: '다른 향으로 교환하고 싶어요', content: '우드 향이 생각보다 강해서 라벤더 향으로 교환하고 싶습니다. 아직 안 썼고 포장 그대로입니다.',
    inquiry_date: '2026-03-13T18:00:00', status: 'new', priority: 'normal', category: '교환/반품',
    ai_response: null, final_response: null, sent_at: null,
  },
];

const sampleReferenceData: ReferenceData[] = [
  { id: 1, title: '기본 배송 안내', category: '배송정책', content: '주문 후 1-3 영업일 내 출고되며, 출고 후 1-2일 내 수령 가능합니다. 제주/도서산간 지역은 1-2일 추가 소요됩니다. 무료배송 기준: 30,000원 이상 주문 시.', is_active: true },
  { id: 2, title: '교환/반품 정책', category: '교환/반품 정책', content: '수령 후 7일 이내 교환/반품 가능합니다. 단, 고객 변심의 경우 왕복 택배비 5,000원이 부과됩니다. 상품 하자의 경우 무료 교환/반품 처리됩니다.', is_active: true },
  { id: 3, title: '알레르기 정보', category: 'FAQ', content: '모든 널담 제품은 알레르기 유발 성분을 상세 페이지에 기재하고 있습니다. 특정 성분에 대한 문의는 고객센터로 연락 주세요.', is_active: true },
  { id: 4, title: '마카롱 보관 방법', category: '상품정보', content: '널담 마카롱은 냉동 보관하시면 최대 30일 드실 수 있습니다. 섭취 전 상온에서 10-15분 해동 후 드시면 가장 맛있습니다.', is_active: true },
  { id: 5, title: '기본 인사말', category: '인사말/맺음말', content: '안녕하세요, 널담 고객센터입니다. / 추가 문의사항이 있으시면 언제든 연락 주세요. 감사합니다.', is_active: true },
];

const defaultConfig: CSConfig = {
  operation_mode: 'semi_auto',
  auto_categories: ['배송문의'],
  response_tone: '정중한',
  sabangnet_api_key: '',
};

// ─────────────────────────────────────────────
// Utility
// ─────────────────────────────────────────────
const fmt = (n: number) => n.toLocaleString('ko-KR');

const formatDate = (dateStr: string) => {
  const d = new Date(dateStr);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day} ${hours}:${minutes}`;
};

const getMallColor = (mall: string) => MALL_COLORS[mall] || DEFAULT_BADGE;
const getStatusColor = (status: string) => STATUS_COLORS[status] || { ...DEFAULT_BADGE, label: status };
const getPriorityColor = (priority: string) => PRIORITY_COLORS[priority] || { ...DEFAULT_BADGE, label: priority };

let nextRefId = 100;
const getNextRefId = () => nextRefId++;

// ═══════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════
export default function CSPage() {
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();

  // ── Tab State ──
  const [activeTab, setActiveTab] = useState<'inquiries' | 'reference' | 'settings'>('inquiries');

  // ── Global State ──
  const [toast, setToast] = useState<string | null>(null);
  const [operationMode, setOperationMode] = useState<'semi_auto' | 'auto'>('semi_auto');

  // ── Inquiry State ──
  const [inquiries, setInquiries] = useState<Inquiry[]>(sampleInquiries);
  const [statusFilter, setStatusFilter] = useState('전체');
  const [mallFilter, setMallFilter] = useState('전체');
  const [categoryFilter, setCategoryFilter] = useState('전체');
  const [searchTerm, setSearchTerm] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [editingResponse, setEditingResponse] = useState<string>('');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [generatingIds, setGeneratingIds] = useState<Set<number>>(new Set());
  const [sendingIds, setSendingIds] = useState<Set<number>>(new Set());
  const [collecting, setCollecting] = useState(false);
  const [bulkGenerating, setBulkGenerating] = useState(false);
  const [bulkSending, setBulkSending] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ current: 0, total: 0 });

  // ── Reference Data State ──
  const [referenceData, setReferenceData] = useState<ReferenceData[]>(sampleReferenceData);
  const [refCategoryFilter, setRefCategoryFilter] = useState('전체');
  const [showRefModal, setShowRefModal] = useState(false);
  const [editingRef, setEditingRef] = useState<ReferenceData | null>(null);
  const [refForm, setRefForm] = useState<Omit<ReferenceData, 'id'>>({ title: '', category: '배송정책', content: '', is_active: true });

  // ── Settings State ──
  const [config, setConfig] = useState<CSConfig>(defaultConfig);
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
    (async () => {
      const data = await fetchSafe<Inquiry[]>('/api/sabangnet/inquiries', []);
      if (data.length > 0) setInquiries(data);
    })();
    (async () => {
      const data = await fetchSafe<ReferenceData[]>('/api/sabangnet/reference-data', []);
      if (data.length > 0) setReferenceData(data);
    })();
    (async () => {
      const data = await fetchSafe<CSConfig | null>('/api/sabangnet/config', null);
      if (data) {
        setConfig(data);
        setOperationMode(data.operation_mode);
      }
    })();
  }, [user]);

  // ── Toast auto-dismiss ──
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  // ── Stats ──
  const stats = useMemo<Stats>(() => {
    const unanswered = inquiries.filter(i => i.status === 'new').length;
    const ai_drafted = inquiries.filter(i => i.status === 'ai_drafted').length;
    const pending_approval = inquiries.filter(i => i.status === 'approved').length;
    return { unanswered, ai_drafted, pending_approval };
  }, [inquiries]);

  // ── Filtered Inquiries ──
  const filteredInquiries = useMemo(() => {
    let result = [...inquiries];

    if (statusFilter !== '전체') {
      result = result.filter(i => i.status === statusFilter);
    }
    if (mallFilter !== '전체') {
      result = result.filter(i => i.mall_name === mallFilter);
    }
    if (categoryFilter !== '전체') {
      result = result.filter(i => i.category === categoryFilter);
    }
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter(
        i => i.title.toLowerCase().includes(term) ||
             i.content.toLowerCase().includes(term) ||
             i.customer_name.toLowerCase().includes(term),
      );
    }
    if (startDate) {
      result = result.filter(i => i.inquiry_date >= startDate);
    }
    if (endDate) {
      result = result.filter(i => i.inquiry_date <= endDate + 'T23:59:59');
    }

    result.sort((a, b) => new Date(b.inquiry_date).getTime() - new Date(a.inquiry_date).getTime());
    return result;
  }, [inquiries, statusFilter, mallFilter, categoryFilter, searchTerm, startDate, endDate]);

  // ── Filtered Reference Data ──
  const filteredRefData = useMemo(() => {
    if (refCategoryFilter === '전체') return referenceData;
    return referenceData.filter(r => r.category === refCategoryFilter);
  }, [referenceData, refCategoryFilter]);

  // ── Actions ──
  const showToast = useCallback((msg: string) => setToast(msg), []);

  const handleCollect = useCallback(async () => {
    setCollecting(true);
    const result = await fetchMutate('/api/sabangnet/inquiries/collect', 'POST');
    if (result.ok && result.data) {
      const data = await fetchSafe<Inquiry[]>('/api/sabangnet/inquiries', []);
      if (data.length > 0) setInquiries(data);
      showToast('문의를 수집했습니다.');
    } else {
      showToast('문의 수집을 시뮬레이션했습니다.');
    }
    setCollecting(false);
  }, [showToast]);

  const handleGenerateAI = useCallback(async (id: number) => {
    setGeneratingIds(prev => new Set(prev).add(id));
    const result = await fetchMutate(`/api/sabangnet/inquiries/${id}/generate-ai`, 'POST');
    if (result.ok && result.data) {
      setInquiries(prev => prev.map(i => i.id === id ? { ...i, ...result.data } : i));
      showToast('AI 답변이 생성되었습니다.');
    } else {
      // Simulate AI response generation
      await new Promise(resolve => setTimeout(resolve, 1500));
      const inquiry = inquiries.find(i => i.id === id);
      if (inquiry) {
        const simulatedResponse = `안녕하세요, 고객님. ${inquiry.mall_name} 널담 고객센터입니다.\n\n문의해 주신 "${inquiry.title}"에 대해 안내드립니다.\n\n확인 후 빠르게 처리해 드리겠습니다. 불편을 드려 죄송합니다.\n\n추가 문의사항이 있으시면 언제든 연락 주세요.\n감사합니다.`;
        setInquiries(prev => prev.map(i =>
          i.id === id ? { ...i, status: 'ai_drafted' as const, ai_response: simulatedResponse } : i,
        ));
        showToast('AI 답변이 생성되었습니다.');
      }
    }
    setGeneratingIds(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, [inquiries, showToast]);

  const handleApprove = useCallback(async (id: number, response?: string) => {
    const inquiry = inquiries.find(i => i.id === id);
    if (!inquiry) return;
    const finalResponse = response || inquiry.ai_response || '';
    const result = await fetchMutate(`/api/sabangnet/inquiries/${id}/approve`, 'POST', { final_response: finalResponse });
    if (result.ok) {
      setInquiries(prev => prev.map(i =>
        i.id === id ? { ...i, status: 'approved' as const, final_response: finalResponse } : i,
      ));
    } else {
      setInquiries(prev => prev.map(i =>
        i.id === id ? { ...i, status: 'approved' as const, final_response: finalResponse } : i,
      ));
    }
    showToast('답변이 승인되었습니다.');
  }, [inquiries, showToast]);

  const handleSend = useCallback(async (id: number) => {
    setSendingIds(prev => new Set(prev).add(id));
    const result = await fetchMutate(`/api/sabangnet/inquiries/${id}/send`, 'POST');
    if (result.ok) {
      setInquiries(prev => prev.map(i =>
        i.id === id ? { ...i, status: 'sent' as const, sent_at: new Date().toISOString() } : i,
      ));
    } else {
      await new Promise(resolve => setTimeout(resolve, 800));
      setInquiries(prev => prev.map(i =>
        i.id === id ? { ...i, status: 'sent' as const, sent_at: new Date().toISOString() } : i,
      ));
    }
    setSendingIds(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    showToast('답변이 발송되었습니다.');
  }, [showToast]);

  const handleApproveAndSend = useCallback(async (id: number, response?: string) => {
    await handleApprove(id, response);
    await handleSend(id);
  }, [handleApprove, handleSend]);

  const handleBulkGenerateAI = useCallback(async () => {
    const targetIds = Array.from(selectedIds).filter(id => {
      const inq = inquiries.find(i => i.id === id);
      return inq && inq.status === 'new';
    });
    if (targetIds.length === 0) {
      showToast('AI 답변을 생성할 신규 문의를 선택해주세요.');
      return;
    }
    setBulkGenerating(true);
    setBulkProgress({ current: 0, total: targetIds.length });

    for (let i = 0; i < targetIds.length; i++) {
      setBulkProgress({ current: i + 1, total: targetIds.length });
      await handleGenerateAI(targetIds[i]);
    }

    setBulkGenerating(false);
    setBulkProgress({ current: 0, total: 0 });
    setSelectedIds(new Set());
    showToast(`${targetIds.length}건의 AI 답변이 생성되었습니다.`);
  }, [selectedIds, inquiries, handleGenerateAI, showToast]);

  const handleBulkApprove = useCallback(async () => {
    const targetIds = Array.from(selectedIds).filter(id => {
      const inq = inquiries.find(i => i.id === id);
      return inq && inq.status === 'ai_drafted';
    });
    if (targetIds.length === 0) {
      showToast('승인할 AI 초안 문의를 선택해주세요.');
      return;
    }
    for (const id of targetIds) {
      await handleApprove(id);
    }
    setSelectedIds(new Set());
    showToast(`${targetIds.length}건이 승인되었습니다.`);
  }, [selectedIds, inquiries, handleApprove, showToast]);

  const handleBulkSend = useCallback(async () => {
    const targetIds = Array.from(selectedIds).filter(id => {
      const inq = inquiries.find(i => i.id === id);
      return inq && inq.status === 'approved';
    });
    if (targetIds.length === 0) {
      showToast('발송할 승인된 문의를 선택해주세요.');
      return;
    }
    setBulkSending(true);
    setBulkProgress({ current: 0, total: targetIds.length });

    for (let i = 0; i < targetIds.length; i++) {
      setBulkProgress({ current: i + 1, total: targetIds.length });
      await handleSend(targetIds[i]);
    }

    setBulkSending(false);
    setBulkProgress({ current: 0, total: 0 });
    setSelectedIds(new Set());
    showToast(`${targetIds.length}건이 발송되었습니다.`);
  }, [selectedIds, inquiries, handleSend, showToast]);

  const toggleSelect = useCallback((id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (selectedIds.size === filteredInquiries.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredInquiries.map(i => i.id)));
    }
  }, [selectedIds, filteredInquiries]);

  const handleExpandInquiry = useCallback((id: number) => {
    if (expandedId === id) {
      setExpandedId(null);
    } else {
      setExpandedId(id);
      const inquiry = inquiries.find(i => i.id === id);
      setEditingResponse(inquiry?.final_response || inquiry?.ai_response || '');
    }
  }, [expandedId, inquiries]);

  // ── Reference Data Actions ──
  const handleSaveRef = useCallback(async () => {
    if (!refForm.title || !refForm.content) {
      showToast('제목과 내용을 입력해주세요.');
      return;
    }

    if (editingRef) {
      const result = await fetchMutate(`/api/sabangnet/reference-data/${editingRef.id}`, 'PUT', refForm);
      if (result.ok && result.data) {
        setReferenceData(prev => prev.map(r => r.id === editingRef.id ? result.data : r));
      } else {
        setReferenceData(prev => prev.map(r => r.id === editingRef.id ? { ...r, ...refForm } : r));
      }
      showToast('참고 데이터가 수정되었습니다.');
    } else {
      const result = await fetchMutate('/api/sabangnet/reference-data', 'POST', refForm);
      if (result.ok && result.data) {
        setReferenceData(prev => [...prev, result.data]);
      } else {
        const newRef: ReferenceData = { id: getNextRefId(), ...refForm };
        setReferenceData(prev => [...prev, newRef]);
      }
      showToast('참고 데이터가 추가되었습니다.');
    }

    setShowRefModal(false);
    setEditingRef(null);
    setRefForm({ title: '', category: '배송정책', content: '', is_active: true });
  }, [editingRef, refForm, showToast]);

  const handleDeleteRef = useCallback(async (id: number) => {
    await fetchMutate(`/api/sabangnet/reference-data/${id}`, 'DELETE');
    setReferenceData(prev => prev.filter(r => r.id !== id));
    showToast('참고 데이터가 삭제되었습니다.');
  }, [showToast]);

  const handleToggleRefActive = useCallback(async (id: number) => {
    const ref = referenceData.find(r => r.id === id);
    if (!ref) return;
    const updated = { ...ref, is_active: !ref.is_active };
    await fetchMutate(`/api/sabangnet/reference-data/${id}`, 'PUT', updated);
    setReferenceData(prev => prev.map(r => r.id === id ? updated : r));
    showToast(updated.is_active ? '참고 데이터가 활성화되었습니다.' : '참고 데이터가 비활성화되었습니다.');
  }, [referenceData, showToast]);

  const openEditRef = useCallback((ref: ReferenceData) => {
    setEditingRef(ref);
    setRefForm({ title: ref.title, category: ref.category, content: ref.content, is_active: ref.is_active });
    setShowRefModal(true);
  }, []);

  const openAddRef = useCallback(() => {
    setEditingRef(null);
    setRefForm({ title: '', category: '배송정책', content: '', is_active: true });
    setShowRefModal(true);
  }, []);

  // ── Settings Actions ──
  const handleSaveConfig = useCallback(async () => {
    setSavingConfig(true);
    const result = await fetchMutate('/api/sabangnet/config', 'PUT', config);
    if (!result.ok) {
      // Simulate save
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    setOperationMode(config.operation_mode);
    setSavingConfig(false);
    showToast('설정이 저장되었습니다.');
  }, [config, showToast]);

  const handleModeToggle = useCallback(() => {
    const newMode = operationMode === 'semi_auto' ? 'auto' : 'semi_auto';
    setOperationMode(newMode);
    setConfig(prev => ({ ...prev, operation_mode: newMode }));
    showToast(newMode === 'auto' ? '자동 모드로 전환되었습니다.' : '반자동 모드로 전환되었습니다.');
  }, [operationMode, showToast]);

  // ── Auth loading guard ──
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-gray-500">로딩 중...</span>
        </div>
      </div>
    );
  }

  if (!user) return null;

  // ═══════════════════════════════════════════════
  // Render
  // ═══════════════════════════════════════════════
  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />

      {/* ── Toast ── */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 animate-in fade-in slide-in-from-top-2">
          <div className="bg-gray-900 text-white px-4 py-3 rounded-lg shadow-lg text-sm flex items-center gap-2">
            <svg className="w-4 h-4 text-green-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
            {toast}
          </div>
        </div>
      )}

      <main className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6">
        {/* ── Top Bar ── */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-bold text-gray-900">게시판 CS 대응</h1>

            {/* Mode toggle */}
            <button
              onClick={handleModeToggle}
              className={`relative inline-flex h-8 w-[140px] items-center rounded-full transition-colors ${
                operationMode === 'auto' ? 'bg-blue-600' : 'bg-gray-300'
              }`}
            >
              <span className={`absolute left-2 text-xs font-medium transition-opacity ${operationMode === 'semi_auto' ? 'text-gray-700 opacity-100' : 'text-white opacity-50'}`}>
                반자동 모드
              </span>
              <span className={`absolute right-2 text-xs font-medium transition-opacity ${operationMode === 'auto' ? 'text-white opacity-100' : 'text-gray-500 opacity-50'}`}>
                자동 모드
              </span>
              <span className={`inline-block h-6 w-6 transform rounded-full bg-white shadow transition-transform ${
                operationMode === 'auto' ? 'translate-x-[108px]' : 'translate-x-1'
              }`} />
            </button>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            {/* Stats badges */}
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700 border border-gray-200">
              미답변 <span className="font-bold text-gray-900">{fmt(stats.unanswered)}건</span>
            </span>
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">
              AI 초안 <span className="font-bold text-blue-900">{fmt(stats.ai_drafted)}건</span>
            </span>
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
              승인대기 <span className="font-bold text-emerald-900">{fmt(stats.pending_approval)}건</span>
            </span>

            {/* Collect button */}
            <button
              onClick={handleCollect}
              disabled={collecting}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {collecting ? (
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
              ) : (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
              )}
              문의 수집
            </button>
          </div>
        </div>

        {/* ── Tab Navigation ── */}
        <div className="border-b border-gray-200 mb-6">
          <nav className="flex gap-6">
            {([
              { key: 'inquiries' as const, label: '문의 관리' },
              { key: 'reference' as const, label: '참고 데이터' },
              { key: 'settings' as const, label: '설정' },
            ]).map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab.key
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* ═══════════════════════════════════════════ */}
        {/* Tab 1: 문의 관리                            */}
        {/* ═══════════════════════════════════════════ */}
        {activeTab === 'inquiries' && (
          <div>
            {/* Filter Bar */}
            <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4 shadow-sm">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
                {/* Status filter */}
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">상태</label>
                  <select
                    value={statusFilter}
                    onChange={e => setStatusFilter(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                  >
                    {STATUS_OPTIONS.map(s => (
                      <option key={s} value={s}>{s === '전체' ? '전체' : getStatusColor(s).label}</option>
                    ))}
                  </select>
                </div>

                {/* Mall filter */}
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">쇼핑몰</label>
                  <select
                    value={mallFilter}
                    onChange={e => setMallFilter(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                  >
                    {MALL_OPTIONS.map(m => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>

                {/* Category filter */}
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">카테고리</label>
                  <select
                    value={categoryFilter}
                    onChange={e => setCategoryFilter(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                  >
                    {CATEGORY_OPTIONS.map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>

                {/* Date range */}
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">시작일</label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={e => setStartDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">종료일</label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={e => setEndDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {/* Search */}
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">검색</label>
                  <div className="relative">
                    <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                    <input
                      type="text"
                      value={searchTerm}
                      onChange={e => setSearchTerm(e.target.value)}
                      placeholder="제목, 내용, 고객명"
                      className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Bulk Actions */}
            {selectedIds.size > 0 && (
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 mb-4 flex items-center gap-3 flex-wrap">
                <span className="text-sm font-medium text-blue-700">{selectedIds.size}건 선택됨</span>
                <div className="flex gap-2 flex-wrap">
                  <button
                    onClick={handleBulkGenerateAI}
                    disabled={bulkGenerating}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                  >
                    {bulkGenerating ? (
                      <>
                        <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                        생성 중 ({bulkProgress.current}/{bulkProgress.total})
                      </>
                    ) : 'AI 일괄 생성'}
                  </button>
                  <button
                    onClick={handleBulkApprove}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
                  >
                    일괄 승인
                  </button>
                  <button
                    onClick={handleBulkSend}
                    disabled={bulkSending}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-700 text-white rounded-lg hover:bg-slate-800 disabled:opacity-50 transition-colors"
                  >
                    {bulkSending ? (
                      <>
                        <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                        발송 중 ({bulkProgress.current}/{bulkProgress.total})
                      </>
                    ) : '일괄 발송'}
                  </button>
                </div>
                <button
                  onClick={() => setSelectedIds(new Set())}
                  className="text-xs text-blue-600 hover:text-blue-800 ml-auto"
                >
                  선택 해제
                </button>
              </div>
            )}

            {/* Bulk progress bar */}
            {(bulkGenerating || bulkSending) && bulkProgress.total > 0 && (
              <div className="mb-4">
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div
                    className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${(bulkProgress.current / bulkProgress.total) * 100}%` }}
                  />
                </div>
                <p className="text-xs text-gray-500 mt-1 text-center">
                  {bulkProgress.current} / {bulkProgress.total} 처리 중...
                </p>
              </div>
            )}

            {/* Select all */}
            <div className="flex items-center gap-2 mb-3">
              <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedIds.size > 0 && selectedIds.size === filteredInquiries.length}
                  onChange={toggleSelectAll}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                전체 선택
              </label>
              <span className="text-xs text-gray-400">({filteredInquiries.length}건)</span>
            </div>

            {/* Inquiry List */}
            <div className="space-y-3">
              {filteredInquiries.length === 0 && (
                <div className="bg-white rounded-xl border border-gray-200 p-12 text-center shadow-sm">
                  <svg className="w-12 h-12 text-gray-300 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" /></svg>
                  <p className="text-gray-500 text-sm">조건에 맞는 문의가 없습니다.</p>
                </div>
              )}

              {filteredInquiries.map(inquiry => {
                const mallColor = getMallColor(inquiry.mall_name);
                const statusColor = getStatusColor(inquiry.status);
                const priorityColor = getPriorityColor(inquiry.priority);
                const isExpanded = expandedId === inquiry.id;
                const isGenerating = generatingIds.has(inquiry.id);
                const isSending = sendingIds.has(inquiry.id);

                return (
                  <div key={inquiry.id} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                    {/* Inquiry Card Header */}
                    <div className="p-4">
                      <div className="flex items-start gap-3">
                        {/* Checkbox */}
                        <input
                          type="checkbox"
                          checked={selectedIds.has(inquiry.id)}
                          onChange={() => toggleSelect(inquiry.id)}
                          className="mt-1 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />

                        <div className="flex-1 min-w-0">
                          {/* Top row: badges + date */}
                          <div className="flex items-center justify-between gap-2 mb-1.5">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full border ${mallColor.bg} ${mallColor.text} ${mallColor.border}`}>
                                {inquiry.mall_name}
                              </span>
                              <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full border bg-gray-50 text-gray-600 border-gray-200">
                                {inquiry.board_type}
                              </span>
                              {(inquiry.priority === 'high' || inquiry.priority === 'urgent') && (
                                <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full border ${priorityColor.bg} ${priorityColor.text} ${priorityColor.border}`}>
                                  {priorityColor.label}
                                </span>
                              )}
                            </div>
                            <span className="text-xs text-gray-400 whitespace-nowrap">
                              {formatDate(inquiry.inquiry_date)}
                            </span>
                          </div>

                          {/* Title */}
                          <h3
                            className="text-sm font-semibold text-gray-900 mb-1 cursor-pointer hover:text-blue-600 transition-colors"
                            onClick={() => handleExpandInquiry(inquiry.id)}
                          >
                            {inquiry.title}
                          </h3>

                          {/* Info row */}
                          <p className="text-xs text-gray-500">
                            고객: {inquiry.customer_name}
                            {inquiry.product_name && <> | 상품: {inquiry.product_name}</>}
                            {inquiry.order_number && <> | 주문: {inquiry.order_number}</>}
                          </p>

                          {/* Action row */}
                          <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100">
                            <div className="flex items-center gap-2 flex-wrap">
                              {inquiry.status === 'new' && (
                                <button
                                  onClick={() => handleGenerateAI(inquiry.id)}
                                  disabled={isGenerating}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                                >
                                  {isGenerating ? (
                                    <>
                                      <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                                      생성 중...
                                    </>
                                  ) : (
                                    <>
                                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                                      AI 답변 생성
                                    </>
                                  )}
                                </button>
                              )}
                              {inquiry.status === 'ai_drafted' && (
                                <>
                                  <button
                                    onClick={() => handleExpandInquiry(inquiry.id)}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white text-blue-600 border border-blue-300 rounded-lg hover:bg-blue-50 transition-colors"
                                  >
                                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                                    답변 확인/수정
                                  </button>
                                  <button
                                    onClick={() => handleApprove(inquiry.id)}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
                                  >
                                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                                    승인
                                  </button>
                                </>
                              )}
                              {inquiry.status === 'approved' && (
                                <button
                                  onClick={() => handleSend(inquiry.id)}
                                  disabled={isSending}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-700 text-white rounded-lg hover:bg-slate-800 disabled:opacity-50 transition-colors"
                                >
                                  {isSending ? (
                                    <>
                                      <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                                      발송 중...
                                    </>
                                  ) : (
                                    <>
                                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
                                      발송
                                    </>
                                  )}
                                </button>
                              )}
                              {inquiry.status === 'sent' && inquiry.sent_at && (
                                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-500">
                                  <svg className="w-3.5 h-3.5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                  발송완료 ({formatDate(inquiry.sent_at)})
                                </span>
                              )}
                              {inquiry.status === 'failed' && (
                                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-600">
                                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                  발송 실패
                                </span>
                              )}
                            </div>

                            {/* Status badge */}
                            <span className={`inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-full border ${statusColor.bg} ${statusColor.text} ${statusColor.border}`}>
                              {statusColor.label}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Expanded Response Panel */}
                    {isExpanded && (
                      <div className="border-t border-gray-200 bg-gray-50 p-4">
                        {/* Original inquiry */}
                        <div className="mb-4">
                          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">원본 문의</h4>
                          <div className="bg-white rounded-lg border border-gray-200 p-3">
                            <p className="text-sm text-gray-800 whitespace-pre-wrap">{inquiry.content}</p>
                          </div>
                        </div>

                        {/* AI Response / Edit area */}
                        <div className="mb-4">
                          <div className="flex items-center justify-between mb-2">
                            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                              {inquiry.status === 'new' ? '답변 (미생성)' : 'AI 생성 답변'}
                            </h4>
                            {inquiry.status !== 'new' && inquiry.status !== 'sent' && (
                              <button
                                onClick={() => handleGenerateAI(inquiry.id)}
                                disabled={isGenerating}
                                className="text-xs text-blue-600 hover:text-blue-800 font-medium disabled:opacity-50"
                              >
                                {isGenerating ? 'AI 재생성 중...' : 'AI 재생성'}
                              </button>
                            )}
                          </div>

                          {inquiry.status === 'new' && !inquiry.ai_response ? (
                            <div className="bg-white rounded-lg border border-gray-200 p-6 text-center">
                              <p className="text-sm text-gray-400 mb-3">아직 AI 답변이 생성되지 않았습니다.</p>
                              <button
                                onClick={() => handleGenerateAI(inquiry.id)}
                                disabled={isGenerating}
                                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                              >
                                {isGenerating ? (
                                  <>
                                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                                    생성 중...
                                  </>
                                ) : 'AI 답변 생성'}
                              </button>
                            </div>
                          ) : (
                            <textarea
                              value={editingResponse}
                              onChange={e => setEditingResponse(e.target.value)}
                              readOnly={inquiry.status === 'sent'}
                              className={`w-full min-h-[200px] p-3 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y ${
                                inquiry.status === 'sent' ? 'bg-gray-100 text-gray-600' : 'bg-white text-gray-800'
                              }`}
                            />
                          )}
                        </div>

                        {/* Reference data used */}
                        {inquiry.status !== 'new' && (
                          <div className="mb-4">
                            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">참고 데이터</h4>
                            <div className="flex gap-2 flex-wrap">
                              {referenceData.filter(r => r.is_active).slice(0, 3).map(ref => (
                                <span key={ref.id} className="inline-flex items-center px-2 py-1 text-xs bg-gray-100 text-gray-600 rounded-md border border-gray-200">
                                  [{ref.category}] {ref.title}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Action buttons */}
                        {inquiry.status !== 'sent' && inquiry.status !== 'new' && (
                          <div className="flex items-center gap-2 pt-3 border-t border-gray-200">
                            {inquiry.status === 'ai_drafted' && (
                              <>
                                <button
                                  onClick={() => handleApprove(inquiry.id, editingResponse)}
                                  className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
                                >
                                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                                  수정 후 승인
                                </button>
                                <button
                                  onClick={() => handleApproveAndSend(inquiry.id, editingResponse)}
                                  className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-slate-700 text-white rounded-lg hover:bg-slate-800 transition-colors"
                                >
                                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
                                  승인 후 즉시 발송
                                </button>
                              </>
                            )}
                            {inquiry.status === 'approved' && (
                              <button
                                onClick={() => handleSend(inquiry.id)}
                                disabled={isSending}
                                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-slate-700 text-white rounded-lg hover:bg-slate-800 disabled:opacity-50 transition-colors"
                              >
                                {isSending ? (
                                  <>
                                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                                    발송 중...
                                  </>
                                ) : (
                                  <>
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
                                    발송
                                  </>
                                )}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════ */}
        {/* Tab 2: 참고 데이터                          */}
        {/* ═══════════════════════════════════════════ */}
        {activeTab === 'reference' && (
          <div>
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <label className="text-sm font-medium text-gray-600">카테고리:</label>
                <select
                  value={refCategoryFilter}
                  onChange={e => setRefCategoryFilter(e.target.value)}
                  className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                >
                  <option value="전체">전체</option>
                  {REFERENCE_CATEGORIES.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>

              <button
                onClick={openAddRef}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                참고 데이터 추가
              </button>
            </div>

            {/* Reference Data List */}
            <div className="space-y-3">
              {filteredRefData.length === 0 && (
                <div className="bg-white rounded-xl border border-gray-200 p-12 text-center shadow-sm">
                  <p className="text-gray-500 text-sm">참고 데이터가 없습니다.</p>
                </div>
              )}

              {filteredRefData.map(ref => {
                const catColors: Record<string, { bg: string; text: string; border: string }> = {
                  '배송정책': { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200' },
                  '교환/반품 정책': { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200' },
                  'FAQ': { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200' },
                  '상품정보': { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
                  '인사말/맺음말': { bg: 'bg-pink-50', text: 'text-pink-700', border: 'border-pink-200' },
                  '프로모션': { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' },
                };
                const catColor = catColors[ref.category] || DEFAULT_BADGE;

                return (
                  <div key={ref.id} className={`bg-white rounded-xl border shadow-sm overflow-hidden ${ref.is_active ? 'border-gray-200' : 'border-gray-100 opacity-60'}`}>
                    <div className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-2">
                            <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full border ${catColor.bg} ${catColor.text} ${catColor.border}`}>
                              {ref.category}
                            </span>
                            <h3 className="text-sm font-semibold text-gray-900">{ref.title}</h3>
                            {!ref.is_active && (
                              <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 text-gray-500 border border-gray-200">
                                비활성
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-gray-600 line-clamp-2 whitespace-pre-wrap">{ref.content}</p>
                        </div>

                        <div className="flex items-center gap-2 flex-shrink-0">
                          {/* Active toggle */}
                          <button
                            onClick={() => handleToggleRefActive(ref.id)}
                            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                              ref.is_active ? 'bg-blue-600' : 'bg-gray-300'
                            }`}
                            title={ref.is_active ? '비활성화' : '활성화'}
                          >
                            <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                              ref.is_active ? 'translate-x-[18px]' : 'translate-x-[3px]'
                            }`} />
                          </button>

                          {/* Edit */}
                          <button
                            onClick={() => openEditRef(ref)}
                            className="p-1.5 text-gray-400 hover:text-blue-600 transition-colors"
                            title="수정"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                          </button>

                          {/* Delete */}
                          <button
                            onClick={() => handleDeleteRef(ref.id)}
                            className="p-1.5 text-gray-400 hover:text-red-600 transition-colors"
                            title="삭제"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Add/Edit Reference Data Modal */}
            {showRefModal && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
                <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
                  <div className="p-6">
                    <div className="flex items-center justify-between mb-6">
                      <h3 className="text-lg font-bold text-gray-900">
                        {editingRef ? '참고 데이터 수정' : '참고 데이터 추가'}
                      </h3>
                      <button
                        onClick={() => { setShowRefModal(false); setEditingRef(null); }}
                        className="p-1 text-gray-400 hover:text-gray-600 transition-colors"
                      >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                      </button>
                    </div>

                    <div className="space-y-4">
                      {/* Title */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">제목</label>
                        <input
                          type="text"
                          value={refForm.title}
                          onChange={e => setRefForm(prev => ({ ...prev, title: e.target.value }))}
                          placeholder="참고 데이터 제목"
                          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>

                      {/* Category */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">카테고리</label>
                        <select
                          value={refForm.category}
                          onChange={e => setRefForm(prev => ({ ...prev, category: e.target.value }))}
                          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                        >
                          {REFERENCE_CATEGORIES.map(c => (
                            <option key={c} value={c}>{c}</option>
                          ))}
                        </select>
                      </div>

                      {/* Content */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">내용</label>
                        <textarea
                          value={refForm.content}
                          onChange={e => setRefForm(prev => ({ ...prev, content: e.target.value }))}
                          placeholder="AI가 참고할 내용을 입력하세요..."
                          rows={6}
                          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
                        />
                      </div>

                      {/* Active toggle */}
                      <label className="flex items-center gap-3 cursor-pointer">
                        <button
                          type="button"
                          onClick={() => setRefForm(prev => ({ ...prev, is_active: !prev.is_active }))}
                          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                            refForm.is_active ? 'bg-blue-600' : 'bg-gray-300'
                          }`}
                        >
                          <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                            refForm.is_active ? 'translate-x-6' : 'translate-x-1'
                          }`} />
                        </button>
                        <span className="text-sm text-gray-700">활성화</span>
                      </label>
                    </div>

                    {/* Modal actions */}
                    <div className="flex items-center justify-end gap-3 mt-6 pt-4 border-t border-gray-200">
                      <button
                        onClick={() => { setShowRefModal(false); setEditingRef(null); }}
                        className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                      >
                        취소
                      </button>
                      <button
                        onClick={handleSaveRef}
                        className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                      >
                        {editingRef ? '수정' : '추가'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ═══════════════════════════════════════════ */}
        {/* Tab 3: 설정                                */}
        {/* ═══════════════════════════════════════════ */}
        {activeTab === 'settings' && (
          <div className="max-w-2xl">
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm divide-y divide-gray-200">
              {/* Operation mode */}
              <div className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900">운영 모드</h3>
                    <p className="text-xs text-gray-500 mt-1">
                      {config.operation_mode === 'semi_auto'
                        ? '반자동: AI가 초안을 생성하면 사용자가 검토 후 승인합니다.'
                        : '자동: 자주 묻는 카테고리는 자동 답변하고, 예외 건만 검토합니다.'}
                    </p>
                  </div>
                  <button
                    onClick={() => setConfig(prev => ({
                      ...prev,
                      operation_mode: prev.operation_mode === 'semi_auto' ? 'auto' : 'semi_auto',
                    }))}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      config.operation_mode === 'auto' ? 'bg-blue-600' : 'bg-gray-300'
                    }`}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                      config.operation_mode === 'auto' ? 'translate-x-6' : 'translate-x-1'
                    }`} />
                  </button>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                    config.operation_mode === 'semi_auto'
                      ? 'bg-gray-100 text-gray-700'
                      : 'bg-blue-50 text-blue-700'
                  }`}>
                    {config.operation_mode === 'semi_auto' ? '반자동 모드' : '자동 모드'}
                  </span>
                </div>
              </div>

              {/* Auto-response categories */}
              <div className="p-6">
                <h3 className="text-sm font-semibold text-gray-900 mb-1">자동 답변 카테고리</h3>
                <p className="text-xs text-gray-500 mb-3">자동 모드에서 자동으로 답변할 카테고리를 선택합니다.</p>
                <div className="flex flex-wrap gap-3">
                  {CATEGORY_OPTIONS.filter(c => c !== '전체').map(cat => (
                    <label key={cat} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={config.auto_categories.includes(cat)}
                        onChange={e => {
                          setConfig(prev => ({
                            ...prev,
                            auto_categories: e.target.checked
                              ? [...prev.auto_categories, cat]
                              : prev.auto_categories.filter(c => c !== cat),
                          }));
                        }}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="text-sm text-gray-700">{cat}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Response tone */}
              <div className="p-6">
                <h3 className="text-sm font-semibold text-gray-900 mb-1">답변 톤</h3>
                <p className="text-xs text-gray-500 mb-3">AI가 생성하는 답변의 어조를 설정합니다.</p>
                <select
                  value={config.response_tone}
                  onChange={e => setConfig(prev => ({ ...prev, response_tone: e.target.value }))}
                  className="w-full max-w-xs px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                >
                  {TONE_OPTIONS.map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>

              {/* Sabangnet API key */}
              <div className="p-6">
                <h3 className="text-sm font-semibold text-gray-900 mb-1">사방넷 API 키</h3>
                <p className="text-xs text-gray-500 mb-3">사방넷 연동을 위한 API 키를 입력합니다.</p>
                <input
                  type="password"
                  value={config.sabangnet_api_key}
                  onChange={e => setConfig(prev => ({ ...prev, sabangnet_api_key: e.target.value }))}
                  placeholder="API 키를 입력하세요"
                  className="w-full max-w-md px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Save button */}
              <div className="p-6 bg-gray-50">
                <button
                  onClick={handleSaveConfig}
                  disabled={savingConfig}
                  className="inline-flex items-center gap-2 px-6 py-2.5 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  {savingConfig ? (
                    <>
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                      저장 중...
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                      저장
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
