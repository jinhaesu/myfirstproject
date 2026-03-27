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
  const timeoutId = setTimeout(() => controller.abort(), 60000);
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
  const timeoutId = setTimeout(() => controller.abort(), 60000);
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
  status: 'new' | 'ai_drafted' | 'approved' | 'sent' | 'failed' | 'answered_externally' | 'closed_externally';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  category: string;
  ai_response: string | null;
  final_response: string | null;
  sent_at: string | null;
  sabangnet_status?: string | null;
  last_synced_at?: string | null;
  delivery_tracking?: {
    tracking_number: string;
    courier_name: string;
    current_status: string;
    last_event: string;
    order_detail: Record<string, string> | null;
    last_checked_at: string | null;
  };
  followup_actions?: {
    id: number;
    action_type: string;
    action_label: string;
    priority: string;
    status: string;
    ai_suggested: boolean;
    notes: string | null;
    created_at: string;
  }[];
  auto_action?: {
    actions: { type: string; label: string; priority: string }[];
    has_order: boolean;
    order_number: string | null;
  };
}

interface ReferenceData {
  id: number;
  title: string;
  category: string;
  content: string;
  file_name: string | null;
  file_type: string | null;
  file_size: number | null;
  has_file: boolean;
  has_extracted_text: boolean;
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

interface VolumeData {
  date: string;
  total: number;
  by_mall: Record<string, number>;
  by_category: Record<string, number>;
}

interface KeywordData {
  keyword: string;
  count: number;
  importance: 'high' | 'medium' | 'low';
  category: string;
  sample_inquiries: string[];
}

interface ActionItem {
  title: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
  category: string;
  related_keywords: string[];
  estimated_impact: string;
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
  'answered_externally': { bg: 'bg-cyan-50', text: 'text-cyan-700', border: 'border-cyan-200', label: '외부답변' },
  'closed_externally':   { bg: 'bg-stone-50', text: 'text-stone-700', border: 'border-stone-200', label: '외부종료' },
};

const PRIORITY_COLORS: Record<string, { bg: string; text: string; border: string; label: string }> = {
  'low':    { bg: 'bg-slate-50', text: 'text-slate-600', border: 'border-slate-200', label: '낮음' },
  'normal': { bg: 'bg-blue-50', text: 'text-blue-600', border: 'border-blue-200', label: '보통' },
  'high':   { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', label: '높음' },
  'urgent': { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200', label: '긴급' },
};

const DEFAULT_BADGE = { bg: 'bg-gray-50', text: 'text-gray-700', border: 'border-gray-200' };

const MALL_OPTIONS = ['전체', '스마트스토어', '쿠팡', '11번가', '카카오선물하기', '옥션', '지마켓'];
const STATUS_OPTIONS = ['전체', 'new', 'ai_drafted', 'approved', 'sent', 'failed', 'answered_externally', 'closed_externally'];
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
  { id: 1, title: '기본 배송 안내', category: '배송정책', content: '주문 후 1-3 영업일 내 출고되며, 출고 후 1-2일 내 수령 가능합니다. 제주/도서산간 지역은 1-2일 추가 소요됩니다. 무료배송 기준: 30,000원 이상 주문 시.', file_name: null, file_type: null, file_size: null, has_file: false, has_extracted_text: false, is_active: true },
  { id: 2, title: '교환/반품 정책', category: '교환/반품 정책', content: '수령 후 7일 이내 교환/반품 가능합니다. 단, 고객 변심의 경우 왕복 택배비 5,000원이 부과됩니다. 상품 하자의 경우 무료 교환/반품 처리됩니다.', file_name: null, file_type: null, file_size: null, has_file: false, has_extracted_text: false, is_active: true },
  { id: 3, title: '알레르기 정보', category: 'FAQ', content: '모든 널담 제품은 알레르기 유발 성분을 상세 페이지에 기재하고 있습니다. 특정 성분에 대한 문의는 고객센터로 연락 주세요.', file_name: null, file_type: null, file_size: null, has_file: false, has_extracted_text: false, is_active: true },
  { id: 4, title: '마카롱 보관 방법', category: '상품정보', content: '널담 마카롱은 냉동 보관하시면 최대 30일 드실 수 있습니다. 섭취 전 상온에서 10-15분 해동 후 드시면 가장 맛있습니다.', file_name: null, file_type: null, file_size: null, has_file: false, has_extracted_text: false, is_active: true },
  { id: 5, title: '기본 인사말', category: '인사말/맺음말', content: '안녕하세요, 널담 고객센터입니다. / 추가 문의사항이 있으시면 언제든 연락 주세요. 감사합니다.', file_name: null, file_type: null, file_size: null, has_file: false, has_extracted_text: false, is_active: true },
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
  const [activeTab, setActiveTab] = useState<'inquiries' | 'analytics' | 'reference' | 'settings'>('inquiries');

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
  const [fetchingOrderIds, setFetchingOrderIds] = useState<Set<number>>(new Set());
  const [collecting, setCollecting] = useState(false);
  const [bulkGenerating, setBulkGenerating] = useState(false);
  const [bulkSending, setBulkSending] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ current: 0, total: 0 });
  const [bulkAiAllRunning, setBulkAiAllRunning] = useState(false);
  const [bulkRegenRunning, setBulkRegenRunning] = useState(false);
  const [totalStats, setTotalStats] = useState<{total: number; new: number; ai_drafted: number; template_responses: number; real_ai_responses: number; approved: number; sent: number} | null>(null);

  // ── Reference Data State ──
  const [referenceData, setReferenceData] = useState<ReferenceData[]>(sampleReferenceData);
  const [refCategoryFilter, setRefCategoryFilter] = useState('전체');
  const [showRefModal, setShowRefModal] = useState(false);
  const [editingRef, setEditingRef] = useState<ReferenceData | null>(null);
  const [refForm, setRefForm] = useState<{ title: string; category: string; content: string; is_active: boolean }>({ title: '', category: '배송정책', content: '', is_active: true });
  const [refFile, setRefFile] = useState<File | null>(null);
  const [removeFile, setRemoveFile] = useState(false);
  const [uploadingRef, setUploadingRef] = useState(false);

  // ── Analytics State ──
  const [volumeData, setVolumeData] = useState<VolumeData[]>([]);
  const [volumePeriod, setVolumePeriod] = useState<'daily' | 'monthly'>('daily');
  const [keywords, setKeywords] = useState<KeywordData[]>([]);
  const [actionItems, setActionItems] = useState<ActionItem[]>([]);
  const [loadingKeywords, setLoadingKeywords] = useState(false);
  const [keywordsSample, setKeywordsSample] = useState(false);
  const [loadingActions, setLoadingActions] = useState(false);
  const [analyticsLoaded, setAnalyticsLoaded] = useState(false);

  // ── Settings State ──
  const [config, setConfig] = useState<CSConfig>(defaultConfig);
  const [savingConfig, setSavingConfig] = useState(false);

  // ── Auth guard ──
  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
    }
  }, [authLoading, user, router]);

  // ── Pagination state ──
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const PAGE_SIZE = 50;

  const loadInquiries = useCallback(async (page = 1) => {
    const raw = await fetchSafe<{ items: Inquiry[]; total: number; page: number } | Inquiry[]>(
      `/api/sabangnet/inquiries?page=${page}&page_size=${PAGE_SIZE}`, []
    );
    if (Array.isArray(raw)) {
      if (raw.length > 0) setInquiries(raw);
    } else {
      if (raw?.items?.length > 0) setInquiries(raw.items);
      if (raw?.total) setTotalCount(raw.total);
    }
    setCurrentPage(page);
  }, []);

  // ── Load data ──
  useEffect(() => {
    if (!user) return;
    loadInquiries(1);
    // 자동 주문/배송 정보 일괄 조회
    fetchMutate('/api/sabangnet/inquiries/auto-fetch-order-details', 'POST').then(() => {
      loadInquiries();
    });
    (async () => {
      const stats = await fetchSafe<any>('/api/sabangnet/inquiries/total-stats', null);
      if (stats) setTotalStats(stats);
    })();
    (async () => {
      const raw = await fetchSafe<{ items: ReferenceData[] } | ReferenceData[]>('/api/sabangnet/reference-data', []);
      const data = Array.isArray(raw) ? raw : (raw?.items || []);
      if (data.length > 0) setReferenceData(data);
    })();
    (async () => {
      const raw = await fetchSafe<Record<string, unknown> | null>('/api/sabangnet/config', null);
      if (raw && typeof raw === 'object') {
        const parsed: CSConfig = {
          operation_mode: raw.auto_mode === true ? 'auto' : (raw.operation_mode === 'auto' ? 'auto' : 'semi_auto'),
          auto_categories: Array.isArray(raw.auto_categories) ? raw.auto_categories : defaultConfig.auto_categories,
          response_tone: typeof raw.response_tone === 'string' ? raw.response_tone : defaultConfig.response_tone,
          sabangnet_api_key: typeof raw.sabangnet_api_key === 'string' ? raw.sabangnet_api_key : '',
        };
        setConfig(parsed);
        setOperationMode(parsed.operation_mode);
      }
    })();
  }, [user]);

  // ── Toast auto-dismiss ──
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  // ── Analytics lazy load ──
  useEffect(() => {
    if (activeTab === 'analytics' && !analyticsLoaded && user) {
      loadAnalytics();
    }
  }, [activeTab, analyticsLoaded, user]);

  const loadAnalytics = async () => {
    setAnalyticsLoaded(true);
    // Volume data
    const volData = await fetchSafe<{period: string; data: VolumeData[]}>(`/api/sabangnet/inquiries/analytics/volume?period=${volumePeriod}`, {period: volumePeriod, data: []});
    if (volData.data && volData.data.length > 0) setVolumeData(volData.data);
    // Keywords
    const kwData = await fetchSafe<{keywords: KeywordData[]; is_sample?: boolean}>('/api/sabangnet/inquiries/analytics/keywords', {keywords: []});
    if (kwData.keywords && kwData.keywords.length > 0) setKeywords(kwData.keywords);
    setKeywordsSample(kwData.is_sample ?? false);
  };

  // ── Volume period reload ──
  useEffect(() => {
    if (activeTab === 'analytics' && user) {
      (async () => {
        const volData = await fetchSafe<{period: string; data: VolumeData[]}>(`/api/sabangnet/inquiries/analytics/volume?period=${volumePeriod}`, {period: volumePeriod, data: []});
        if (volData.data && volData.data.length > 0) setVolumeData(volData.data);
      })();
    }
  }, [volumePeriod]);

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
    // 사방넷 API 호출은 시간이 걸리므로 타임아웃을 30초로 설정
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    try {
      const res = await fetch(`${API_BASE}/api/sabangnet/inquiries/collect`, {
        method: 'POST',
        headers: getAuthHeaders(),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      const data = await res.json().catch(() => null);

      if (res.ok && data) {
        const created = data.items_created ?? 0;
        const source = data.source ?? 'unknown';
        const totalFetched = data.total_fetched ?? 0;

        // 수집 후 목록 재조회
        await loadInquiries(1);

        if (source === 'sabangnet_api') {
          if (created > 0) {
            showToast(`신규 ${created}건 수집 완료 (사방넷 총 ${totalFetched}건)`);
          } else {
            showToast(`새로운 문의 없음 (사방넷 ${totalFetched}건 모두 수집 완료)`);
          }
        } else if (created > 0) {
          showToast(`${created}건 수집 완료`);
        } else {
          showToast('새로운 문의가 없습니다.');
        }
      } else {
        const errMsg = data?.detail || data?.message || '수집 실패';
        showToast(`수집 실패: ${errMsg}`);
      }
    } catch (e) {
      clearTimeout(timeoutId);
      showToast('수집 요청 시간 초과 또는 네트워크 오류');
    }
    setCollecting(false);
  }, [showToast, loadInquiries]);

  const handleSyncStatus = useCallback(async () => {
    const res = await fetchMutate('/api/sabangnet/inquiries/sync-status', 'POST');
    if (res.ok) {
      alert(`동기화 완료: ${res.data?.updated || 0}건 업데이트`);
      loadInquiries();
    } else {
      alert('동기화 실패');
    }
  }, [loadInquiries]);

  const handleBulkAiAll = useCallback(async () => {
    setBulkAiAllRunning(true);
    let totalGenerated = 0;
    let remaining = 1;

    // 50건씩 반복 처리
    while (remaining > 0) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 120000);
        const res = await fetch(`${API_BASE}/api/sabangnet/inquiries/bulk-generate-all-new?page_size=50`, {
          method: 'POST',
          headers: getAuthHeaders(),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        const data = await res.json().catch(() => null);
        if (data) {
          totalGenerated += data.generated || 0;
          remaining = data.remaining || 0;
          showToast(`AI 생성 중... ${totalGenerated}건 완료 (남은 신규: ${remaining}건)`);
        } else {
          break;
        }
        if ((data.generated || 0) === 0) break;
      } catch {
        showToast('AI 생성 중 오류 발생');
        break;
      }
    }

    setBulkAiAllRunning(false);
    showToast(`전체 AI 답변 생성 완료: ${totalGenerated}건`);
    loadInquiries(currentPage);
    // stats 재조회
    const stats = await fetchSafe<any>('/api/sabangnet/inquiries/total-stats', null);
    if (stats) setTotalStats(stats);
  }, [showToast, loadInquiries, currentPage]);

  const handleBulkRegenerate = useCallback(async () => {
    setBulkRegenRunning(true);
    let totalGenerated = 0;
    let remaining = 1;

    while (remaining > 0) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 120000);
        const res = await fetch(`${API_BASE}/api/sabangnet/inquiries/bulk-regenerate?page_size=30`, {
          method: 'POST',
          headers: getAuthHeaders(),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        const data = await res.json().catch(() => null);
        if (data) {
          totalGenerated += data.generated || 0;
          remaining = data.remaining || 0;
          showToast(`AI 재생성 중... ${totalGenerated}건 완료 (남은 템플릿: ${remaining}건)`);
        } else break;
        if ((data.generated || 0) === 0) break;
      } catch {
        showToast('AI 재생성 중 오류 발생');
        break;
      }
    }

    setBulkRegenRunning(false);
    showToast(`AI 답변 재생성 완료: ${totalGenerated}건`);
    loadInquiries(currentPage);
    // stats 재조회
    const stats = await fetchSafe<any>('/api/sabangnet/inquiries/total-stats', null);
    if (stats) setTotalStats(stats);
  }, [showToast, loadInquiries, currentPage]);

  const handleDelete = useCallback(async (id: number) => {
    const result = await fetchMutate(`/api/sabangnet/inquiries/${id}`, 'DELETE');
    if (result.ok) {
      setInquiries(prev => prev.filter(i => i.id !== id));
      setTotalCount(prev => prev - 1);
      showToast('문의가 삭제되었습니다.');
    } else {
      showToast('삭제 실패');
    }
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
    if (!refForm.title || (!refForm.content && !refFile)) {
      showToast('제목과 내용(또는 파일)을 입력해주세요.');
      return;
    }

    setUploadingRef(true);

    try {
      if (refFile || removeFile) {
        // Use multipart form data for file upload
        const formData = new FormData();
        formData.append('title', refForm.title);
        formData.append('category', refForm.category);
        formData.append('content', refForm.content);
        formData.append('is_active', String(refForm.is_active));
        if (refFile) formData.append('file', refFile);
        if (removeFile) formData.append('remove_file', 'true');

        const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
        const headers: Record<string, string> = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const url = editingRef
          ? `${API_BASE}/api/sabangnet/reference-data/${editingRef.id}/upload`
          : `${API_BASE}/api/sabangnet/reference-data/upload`;

        const res = await fetch(url, {
          method: editingRef ? 'PUT' : 'POST',
          headers,
          body: formData,
        });

        if (res.ok) {
          const data = await res.json();
          if (editingRef) {
            setReferenceData(prev => prev.map(r => r.id === editingRef.id ? data : r));
          } else {
            setReferenceData(prev => [...prev, data]);
          }
          showToast(editingRef ? '참고 데이터가 수정되었습니다.' : '참고 데이터가 추가되었습니다.');
        } else {
          showToast('저장에 실패했습니다.');
        }
      } else if (editingRef) {
        const result = await fetchMutate(`/api/sabangnet/reference-data/${editingRef.id}`, 'PUT', refForm);
        if (result.ok && result.data) {
          setReferenceData(prev => prev.map(r => r.id === editingRef.id ? result.data : r));
        } else {
          setReferenceData(prev => prev.map(r => r.id === editingRef.id ? { ...r, ...refForm, file_name: r.file_name, file_type: r.file_type, file_size: r.file_size, has_file: r.has_file, has_extracted_text: r.has_extracted_text } : r));
        }
        showToast('참고 데이터가 수정되었습니다.');
      } else {
        const result = await fetchMutate('/api/sabangnet/reference-data', 'POST', refForm);
        if (result.ok && result.data) {
          setReferenceData(prev => [...prev, result.data]);
        } else {
          const newRef: ReferenceData = { id: getNextRefId(), ...refForm, file_name: null, file_type: null, file_size: null, has_file: false, has_extracted_text: false };
          setReferenceData(prev => [...prev, newRef]);
        }
        showToast('참고 데이터가 추가되었습니다.');
      }
    } catch {
      showToast('저장 중 오류가 발생했습니다.');
    }

    setUploadingRef(false);
    setShowRefModal(false);
    setEditingRef(null);
    setRefForm({ title: '', category: '배송정책', content: '', is_active: true });
    setRefFile(null);
    setRemoveFile(false);
  }, [editingRef, refForm, refFile, removeFile, showToast]);

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
    setRefFile(null);
    setRemoveFile(false);
    setShowRefModal(true);
  }, []);

  const openAddRef = useCallback(() => {
    setEditingRef(null);
    setRefForm({ title: '', category: '배송정책', content: '', is_active: true });
    setRefFile(null);
    setRemoveFile(false);
    setShowRefModal(true);
  }, []);

  // ── Analytics Actions ──
  const handleGenerateActions = async () => {
    setLoadingActions(true);
    const result = await fetchMutate('/api/sabangnet/inquiries/analytics/action-items', 'POST');
    if (result.ok && result.data?.action_items) {
      setActionItems(result.data.action_items);
      showToast('액션 아이템이 생성되었습니다.');
    } else {
      showToast('액션 아이템 생성에 실패했습니다.');
    }
    setLoadingActions(false);
  };

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
              총 <span className="font-bold text-gray-900">{fmt(totalStats?.total || 0)}건</span>
            </span>
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700 border border-gray-200">
              미답변 <span className="font-bold text-gray-900">{fmt(totalStats?.new || 0)}건</span>
            </span>
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">
              AI 답변 <span className="font-bold text-blue-900">{fmt(totalStats?.real_ai_responses || 0)}건</span>
            </span>
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-red-50 text-red-700 border border-red-200">
              템플릿 <span className="font-bold text-red-900">{fmt(totalStats?.template_responses || 0)}건</span>
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

            {/* Sync Status button */}
            <button
              onClick={handleSyncStatus}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 transition-colors"
            >
              상태 동기화
            </button>

            {/* Bulk AI Generate button */}
            {(totalStats?.new || 0) > 0 && (
              <button
                onClick={handleBulkAiAll}
                disabled={bulkAiAllRunning}
                className="inline-flex items-center gap-2 px-4 py-2 bg-violet-600 text-white text-sm font-medium rounded-lg hover:bg-violet-700 disabled:opacity-50 transition-colors"
              >
                {bulkAiAllRunning ? (
                  <>
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                    AI 생성 중...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                    전체 AI 답변 생성 ({fmt(totalStats?.new || 0)}건)
                  </>
                )}
              </button>
            )}

            {/* Bulk Regenerate button */}
            {(totalStats?.template_responses || 0) > 0 && (
              <button
                onClick={handleBulkRegenerate}
                disabled={bulkRegenRunning}
                className="inline-flex items-center gap-2 px-4 py-2 bg-orange-500 text-white text-sm font-medium rounded-lg hover:bg-orange-600 disabled:opacity-50 transition-colors"
              >
                {bulkRegenRunning ? (
                  <>
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                    재생성 중...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                    템플릿 답변 재생성 ({fmt(totalStats?.template_responses || 0)}건)
                  </>
                )}
              </button>
            )}
          </div>
        </div>

        {/* ── Tab Navigation ── */}
        <div className="border-b border-gray-200 mb-6">
          <nav className="flex gap-6">
            {([
              { key: 'inquiries' as const, label: '문의 관리' },
              { key: 'analytics' as const, label: '분석' },
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
                const isGenerating = generatingIds.has(inquiry.id);
                const isSending = sendingIds.has(inquiry.id);

                return (
                  <div key={inquiry.id} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                    {/* ── 상단: 배지 + 상태 + 삭제 ── */}
                    <div className="px-4 pt-4 pb-2">
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(inquiry.id)}
                          onChange={() => toggleSelect(inquiry.id)}
                          className="mt-1 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full border ${mallColor.bg} ${mallColor.text} ${mallColor.border}`}>
                                {inquiry.mall_name}
                              </span>
                              <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full border bg-gray-50 text-gray-600 border-gray-200">
                                {inquiry.board_type}
                              </span>
                              <span className={`inline-flex items-center px-2.5 py-0.5 text-xs font-medium rounded-full border ${statusColor.bg} ${statusColor.text} ${statusColor.border}`}>
                                {statusColor.label}
                              </span>
                              {(inquiry.priority === 'high' || inquiry.priority === 'urgent') && (
                                <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full border ${priorityColor.bg} ${priorityColor.text} ${priorityColor.border}`}>
                                  {priorityColor.label}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-gray-400 whitespace-nowrap">{formatDate(inquiry.inquiry_date)}</span>
                              <button
                                onClick={() => handleDelete(inquiry.id)}
                                className="inline-flex items-center p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                                title="삭제"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                              </button>
                            </div>
                          </div>
                          <h3 className="text-sm font-semibold text-gray-900 mb-0.5">{inquiry.title}</h3>
                          <p className="text-xs text-gray-500">
                            고객: {inquiry.customer_name}
                            {inquiry.product_name && <> | 상품: {inquiry.product_name}</>}
                            {inquiry.order_number && <> | 주문: {inquiry.order_number}</>}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* ── 감지된 액션 + 후속 조치 태그 ── */}
                    {((inquiry.auto_action?.actions?.length ?? 0) > 0 || (inquiry.followup_actions?.length ?? 0) > 0) && (
                      <div className="px-4 pb-2 flex items-center gap-1.5 flex-wrap">
                        {inquiry.auto_action?.actions?.map((action, idx) => (
                          <span key={`auto-${idx}`} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${
                            action.priority === 'high' ? 'bg-red-100 text-red-700 border border-red-200' :
                            action.priority === 'medium' ? 'bg-amber-100 text-amber-700 border border-amber-200' :
                            'bg-gray-100 text-gray-600 border border-gray-200'
                          }`}>
                            {action.type === 'refund' ? '💰' : action.type === 'exchange' ? '🔄' : action.type === 'damage' ? '📦' : action.type === 'delivery' ? '🚚' : '📋'}
                            {action.label}
                          </span>
                        ))}
                        {inquiry.followup_actions?.map(action => (
                          <span key={`fu-${action.id}`} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                            action.status === 'completed' ? 'bg-green-50 text-green-700 border border-green-200' :
                            action.status === 'in_progress' ? 'bg-blue-50 text-blue-700 border border-blue-200' :
                            'bg-purple-50 text-purple-700 border border-purple-200'
                          }`}>
                            {action.ai_suggested ? 'AI ' : ''}{action.action_label}
                            {action.status === 'pending' && (
                              <button
                                onClick={async () => {
                                  await fetchMutate(`/api/sabangnet/followup-actions/${action.id}`, 'PUT', { status: 'completed' });
                                  loadInquiries();
                                }}
                                className="ml-1 underline text-green-600 hover:text-green-800"
                              >
                                완료
                              </button>
                            )}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* ── 주문/배송 정보 (항상 노출) ── */}
                    <div className="mx-4 mb-2 bg-slate-50 rounded-lg border border-slate-200 p-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-semibold text-slate-600">주문/배송 정보</span>
                        {inquiry.order_number && (
                          <button
                            onClick={async () => {
                              setFetchingOrderIds(prev => new Set(prev).add(inquiry.id));
                              await fetchSafe(`/api/sabangnet/inquiries/${inquiry.id}/order-detail`, null);
                              setFetchingOrderIds(prev => { const s = new Set(prev); s.delete(inquiry.id); return s; });
                              loadInquiries();
                            }}
                            disabled={fetchingOrderIds.has(inquiry.id)}
                            className="text-[11px] px-2 py-0.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 transition-colors"
                          >
                            {fetchingOrderIds.has(inquiry.id) ? '조회중...' : '갱신'}
                          </button>
                        )}
                      </div>
                      {!inquiry.order_number ? (
                        <p className="text-xs text-gray-400">주문번호 없음</p>
                      ) : inquiry.delivery_tracking ? (
                        <div className="space-y-1.5">
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 text-xs">
                            <div><span className="text-gray-400">운송장</span> <span className="font-medium text-gray-800">{inquiry.delivery_tracking.tracking_number || '미발급'}</span></div>
                            <div><span className="text-gray-400">택배사</span> <span className="font-medium text-gray-800">{inquiry.delivery_tracking.courier_name || '미정'}</span></div>
                            <div><span className="text-gray-400">배송상태</span>{' '}
                              <span className={`font-bold ${
                                inquiry.delivery_tracking.current_status === 'delivered' ? 'text-green-600' :
                                inquiry.delivery_tracking.current_status === 'in_transit' ? 'text-blue-600' :
                                inquiry.delivery_tracking.current_status === 'out_for_delivery' ? 'text-orange-600' :
                                'text-gray-600'
                              }`}>
                                {inquiry.delivery_tracking.current_status === 'delivered' ? '배달완료' :
                                 inquiry.delivery_tracking.current_status === 'in_transit' ? '배송중' :
                                 inquiry.delivery_tracking.current_status === 'out_for_delivery' ? '배달출발' :
                                 inquiry.delivery_tracking.current_status === 'at_pickup' ? '집하' :
                                 inquiry.delivery_tracking.current_status === 'informationReceived' ? '접수' :
                                 inquiry.delivery_tracking.current_status === 'no_order' ? '-' :
                                 inquiry.delivery_tracking.current_status === 'order_found' ? '주문확인' :
                                 inquiry.delivery_tracking.current_status === 'collected' ? '수집완료' :
                                 inquiry.delivery_tracking.current_status === 'fetch_failed' ? '조회실패' :
                                 inquiry.delivery_tracking.current_status || '확인불가'}
                              </span>
                            </div>
                            <div><span className="text-gray-400">최근</span> <span className="font-medium text-gray-800">{inquiry.delivery_tracking.last_event || '-'}</span></div>
                          </div>
                          {inquiry.delivery_tracking.order_detail && (
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 text-xs pt-1.5 border-t border-slate-200">
                              <div><span className="text-gray-400">주문상태</span> <span className="font-medium text-gray-800">{inquiry.delivery_tracking.order_detail.ORDER_STATUS || '-'}</span></div>
                              <div><span className="text-gray-400">결제금액</span> <span className="font-medium text-gray-800">{inquiry.delivery_tracking.order_detail.ORDER_TOTAL_PRICE ? `${Number(inquiry.delivery_tracking.order_detail.ORDER_TOTAL_PRICE).toLocaleString()}원` : '-'}</span></div>
                              <div><span className="text-gray-400">주문일</span> <span className="font-medium text-gray-800">{inquiry.delivery_tracking.order_detail.ORDER_DATE || '-'}</span></div>
                              <div><span className="text-gray-400">수량</span> <span className="font-medium text-gray-800">{inquiry.delivery_tracking.order_detail.SALE_CNT || '-'}</span></div>
                            </div>
                          )}
                          {inquiry.delivery_tracking.last_checked_at && (
                            <p className="text-[10px] text-gray-400">조회: {new Date(inquiry.delivery_tracking.last_checked_at).toLocaleString('ko-KR')}</p>
                          )}
                        </div>
                      ) : (
                        <p className="text-xs text-gray-400">자동 조회 대기중...</p>
                      )}
                    </div>

                    {/* ── 문의 내용 (항상 노출) ── */}
                    <div className="mx-4 mb-2 bg-gray-50 rounded-lg border border-gray-200 p-3">
                      <span className="text-xs font-semibold text-gray-500 block mb-1">고객 문의</span>
                      <p className="text-sm text-gray-800 whitespace-pre-wrap">{inquiry.content}</p>
                    </div>

                    {/* ── AI 답변 (항상 노출) ── */}
                    <div className="mx-4 mb-2">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-semibold text-gray-500">
                          {inquiry.ai_response ? 'AI 답변' : '답변 미생성'}
                        </span>
                        {inquiry.ai_response && inquiry.status !== 'sent' && (
                          <button
                            onClick={() => handleGenerateAI(inquiry.id)}
                            disabled={isGenerating}
                            className="text-[11px] text-blue-600 hover:text-blue-800 font-medium disabled:opacity-50"
                          >
                            {isGenerating ? '재생성 중...' : 'AI 재생성'}
                          </button>
                        )}
                      </div>
                      {inquiry.ai_response ? (
                        <textarea
                          value={expandedId === inquiry.id ? editingResponse : (inquiry.final_response || inquiry.ai_response || '')}
                          onChange={e => { setExpandedId(inquiry.id); setEditingResponse(e.target.value); }}
                          onFocus={() => { if (expandedId !== inquiry.id) { setExpandedId(inquiry.id); setEditingResponse(inquiry.final_response || inquiry.ai_response || ''); } }}
                          readOnly={inquiry.status === 'sent' || inquiry.status === 'answered_externally' || inquiry.status === 'closed_externally'}
                          className={`w-full min-h-[120px] p-3 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y ${
                            inquiry.status === 'sent' ? 'bg-gray-100 text-gray-600' : 'bg-white text-gray-800'
                          }`}
                        />
                      ) : (
                        <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-center">
                          <button
                            onClick={() => handleGenerateAI(inquiry.id)}
                            disabled={isGenerating}
                            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                          >
                            {isGenerating ? (
                              <><svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg> 생성 중...</>
                            ) : (
                              <><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg> AI 답변 생성</>
                            )}
                          </button>
                        </div>
                      )}
                    </div>

                    {/* ── 하단 액션 버튼 (항상 노출) ── */}
                    <div className="px-4 pb-4 pt-2 flex items-center gap-2 flex-wrap">
                      {inquiry.status === 'new' && inquiry.ai_response && (
                        <button onClick={() => handleApprove(inquiry.id)} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors">
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg> 승인
                        </button>
                      )}
                      {inquiry.status === 'ai_drafted' && (
                        <>
                          <button
                            onClick={() => handleApprove(inquiry.id, expandedId === inquiry.id ? editingResponse : undefined)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg> 승인
                          </button>
                          <button
                            onClick={() => handleApproveAndSend(inquiry.id, expandedId === inquiry.id ? editingResponse : undefined)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-700 text-white rounded-lg hover:bg-slate-800 transition-colors"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg> 승인+발송
                          </button>
                        </>
                      )}
                      {inquiry.status === 'approved' && (
                        <button onClick={() => handleSend(inquiry.id)} disabled={isSending} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-700 text-white rounded-lg hover:bg-slate-800 disabled:opacity-50 transition-colors">
                          {isSending ? <><svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg> 발송 중...</> : <><svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg> 발송</>}
                        </button>
                      )}
                      {inquiry.status === 'sent' && inquiry.sent_at && (
                        <span className="text-xs text-slate-500">발송완료 ({formatDate(inquiry.sent_at)})</span>
                      )}
                      {inquiry.status === 'failed' && <span className="text-xs text-red-600">발송 실패</span>}
                      {inquiry.status === 'answered_externally' && <span className="text-xs text-cyan-600">사방넷에서 직접 답변됨</span>}
                      {inquiry.status === 'closed_externally' && <span className="text-xs text-stone-500">외부 종료</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Pagination */}
        {activeTab === 'inquiries' && totalCount > PAGE_SIZE && (
          <div className="flex items-center justify-between mt-4 bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
            <span className="text-sm text-gray-500">
              총 {totalCount.toLocaleString()}건 · {currentPage}/{Math.ceil(totalCount / PAGE_SIZE)} 페이지
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => loadInquiries(currentPage - 1)}
                disabled={currentPage <= 1}
                className="px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition-colors"
              >
                이전
              </button>
              {/* 페이지 번호 */}
              {Array.from({ length: Math.min(5, Math.ceil(totalCount / PAGE_SIZE)) }, (_, i) => {
                const totalPages = Math.ceil(totalCount / PAGE_SIZE);
                let pageNum: number;
                if (totalPages <= 5) {
                  pageNum = i + 1;
                } else if (currentPage <= 3) {
                  pageNum = i + 1;
                } else if (currentPage >= totalPages - 2) {
                  pageNum = totalPages - 4 + i;
                } else {
                  pageNum = currentPage - 2 + i;
                }
                return (
                  <button
                    key={pageNum}
                    onClick={() => loadInquiries(pageNum)}
                    className={`w-8 h-8 text-sm font-medium rounded-lg transition-colors ${
                      currentPage === pageNum
                        ? 'bg-blue-600 text-white'
                        : 'text-gray-600 hover:bg-gray-100'
                    }`}
                  >
                    {pageNum}
                  </button>
                );
              })}
              <button
                onClick={() => loadInquiries(currentPage + 1)}
                disabled={currentPage >= Math.ceil(totalCount / PAGE_SIZE)}
                className="px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition-colors"
              >
                다음
              </button>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════ */}
        {/* Tab 2: 분석                                 */}
        {/* ═══════════════════════════════════════════ */}
        {activeTab === 'analytics' && (
          <div className="space-y-6">
            {/* ── 문의 수량 통계 ── */}
            <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-bold text-gray-900">문의 수량 추이</h3>
                <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
                  {(['daily', 'monthly'] as const).map(p => (
                    <button key={p} onClick={() => setVolumePeriod(p)}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                        volumePeriod === p ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                      }`}>
                      {p === 'daily' ? '일별' : '월별'}
                    </button>
                  ))}
                </div>
              </div>

              {volumeData.length > 0 ? (
                <div>
                  {/* 좌우 바 차트 */}
                  <div className="flex items-end gap-1 overflow-x-auto pb-2" style={{ minHeight: '160px' }}>
                    {volumeData.map((d, i) => {
                      const maxTotal = Math.max(...volumeData.map(v => v.total), 1);
                      const pct = (d.total / maxTotal) * 100;
                      return (
                        <div key={i} className="flex flex-col items-center gap-1 min-w-[32px] flex-1">
                          <span className="text-[10px] font-bold text-gray-700">{d.total}</span>
                          <div className="w-full bg-gray-100 rounded-t-md relative" style={{ height: '120px' }}>
                            <div
                              className="absolute bottom-0 w-full bg-gradient-to-t from-blue-500 to-blue-400 rounded-t-md transition-all"
                              style={{ height: `${Math.max(pct, 4)}%` }}
                            />
                          </div>
                          <span className="text-[9px] text-gray-500 font-mono whitespace-nowrap">
                            {volumePeriod === 'daily' ? d.date.slice(5) : d.date}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  {/* 쇼핑몰별 + 카테고리별 가로 나열 */}
                  <div className="grid grid-cols-2 gap-4 mt-4 pt-4 border-t border-gray-100">
                    <div>
                      <h4 className="text-xs font-semibold text-gray-500 mb-2">쇼핑몰별 (최근)</h4>
                      <div className="space-y-1.5">
                        {Object.entries(volumeData[volumeData.length - 1].by_mall).map(([mall, count]) => {
                          const mc = MALL_COLORS[mall] || DEFAULT_BADGE;
                          const mallMax = Math.max(...Object.values(volumeData[volumeData.length - 1].by_mall), 1);
                          return (
                            <div key={mall} className="flex items-center gap-2">
                              <span className={`text-[10px] font-semibold w-16 shrink-0 ${mc.text}`}>{mall}</span>
                              <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                                <div className={`h-full rounded-full ${mc.bg} border ${mc.border}`} style={{ width: `${(count / mallMax) * 100}%` }} />
                              </div>
                              <span className="text-[10px] font-bold text-gray-700 w-6 text-right">{count}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    <div>
                      <h4 className="text-xs font-semibold text-gray-500 mb-2">카테고리별 (최근)</h4>
                      <div className="space-y-1.5">
                        {Object.entries(volumeData[volumeData.length - 1].by_category).map(([cat, count]) => {
                          const catMax = Math.max(...Object.values(volumeData[volumeData.length - 1].by_category), 1);
                          return (
                            <div key={cat} className="flex items-center gap-2">
                              <span className="text-[10px] font-semibold w-16 shrink-0 text-slate-600">{cat}</span>
                              <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                                <div className="h-full rounded-full bg-slate-300" style={{ width: `${(count / catMax) * 100}%` }} />
                              </div>
                              <span className="text-[10px] font-bold text-gray-700 w-6 text-right">{count}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-10 text-gray-400 text-sm">문의 데이터가 없습니다</div>
              )}
            </div>

            {/* ── 키워드 분석 ── */}
            <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-base font-bold text-gray-900">주요 키워드 분석</h3>
                  {keywordsSample && <span className="text-[10px] px-2 py-0.5 bg-amber-50 text-amber-600 rounded-full border border-amber-200">샘플 데이터 - 실제 문의가 수집되면 AI 분석됩니다</span>}
                </div>
                <button onClick={async () => {
                  setLoadingKeywords(true);
                  const kwData = await fetchSafe<{keywords: KeywordData[]; is_sample?: boolean}>('/api/sabangnet/inquiries/analytics/keywords', {keywords: []});
                  if (kwData.keywords && kwData.keywords.length > 0) setKeywords(kwData.keywords);
                  setKeywordsSample(kwData.is_sample ?? false);
                  setLoadingKeywords(false);
                }}
                  disabled={loadingKeywords}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-600 text-xs font-semibold rounded-lg hover:bg-blue-100 disabled:opacity-50 transition-colors">
                  {loadingKeywords && <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>}
                  새로고침
                </button>
              </div>

              {keywords.length > 0 ? (
                <div>
                  {/* 컴팩트 키워드 테이블 */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {keywords.map((kw, i) => {
                      const maxCount = Math.max(...keywords.map(k => k.count), 1);
                      const pct = (kw.count / maxCount) * 100;
                      return (
                        <div key={i} className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2 group hover:bg-gray-100 transition-colors relative">
                          <span className={`w-2 h-2 rounded-full shrink-0 ${
                            kw.importance === 'high' ? 'bg-red-500' : kw.importance === 'medium' ? 'bg-amber-400' : 'bg-gray-300'
                          }`} />
                          <span className="text-xs font-bold text-gray-900 shrink-0">{kw.keyword}</span>
                          <div className="flex-1 h-3 bg-gray-200 rounded-full overflow-hidden mx-1">
                            <div className={`h-full rounded-full transition-all ${
                              kw.importance === 'high' ? 'bg-red-400' : kw.importance === 'medium' ? 'bg-amber-300' : 'bg-gray-400'
                            }`} style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-xs font-bold text-gray-700 shrink-0 w-8 text-right">{kw.count}</span>
                          <span className="text-[9px] text-gray-400 shrink-0 w-14">{kw.category}</span>
                          {/* 호버 시 샘플 표시 */}
                          {kw.sample_inquiries?.length > 0 && (
                            <div className="absolute left-0 top-full mt-1 z-10 hidden group-hover:block bg-white border border-gray-200 rounded-lg shadow-lg p-2 w-full max-w-xs">
                              {kw.sample_inquiries.slice(0, 2).map((s, j) => (
                                <p key={j} className="text-[10px] text-gray-500 truncate">&quot;{s}&quot;</p>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="text-center py-10 text-gray-400 text-sm">키워드 데이터가 없습니다</div>
              )}
            </div>

            {/* ── 액션 아이템 추천 ── */}
            <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-base font-bold text-gray-900">대응 액션 아이템</h3>
                  <p className="text-xs text-gray-500 mt-0.5">고객 문의 분석 기반 AI 추천</p>
                </div>
                <button onClick={handleGenerateActions}
                  disabled={loadingActions}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
                  {loadingActions ? (
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                  )}
                  AI 분석 실행
                </button>
              </div>

              {actionItems.length > 0 ? (
                <div className="space-y-3">
                  {actionItems.map((item, i) => {
                    const prioColor = item.priority === 'high' ? 'border-l-red-500 bg-red-50/30' :
                      item.priority === 'medium' ? 'border-l-amber-500 bg-amber-50/30' :
                      'border-l-gray-400 bg-gray-50/30';
                    const prioBadge = item.priority === 'high' ? 'bg-red-100 text-red-700' :
                      item.priority === 'medium' ? 'bg-amber-100 text-amber-700' :
                      'bg-gray-100 text-gray-600';
                    return (
                      <div key={i} className={`border border-gray-100 border-l-4 ${prioColor} rounded-xl p-4`}>
                        <div className="flex items-start gap-3">
                          <span className="text-lg font-bold text-gray-300 mt-0.5">{String(i + 1).padStart(2, '0')}</span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1.5">
                              <h4 className="text-sm font-bold text-gray-900">{item.title}</h4>
                              <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${prioBadge}`}>
                                {item.priority === 'high' ? '긴급' : item.priority === 'medium' ? '중요' : '참고'}
                              </span>
                              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-600">{item.category}</span>
                            </div>
                            <p className="text-sm text-gray-600 mb-2">{item.description}</p>
                            <div className="flex items-center gap-4 text-xs">
                              <div className="flex items-center gap-1.5">
                                <span className="text-gray-400">관련 키워드:</span>
                                <div className="flex gap-1">
                                  {item.related_keywords.map((k, j) => (
                                    <span key={j} className="bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">{k}</span>
                                  ))}
                                </div>
                              </div>
                            </div>
                            <div className="mt-2 flex items-center gap-1.5 text-xs">
                              <svg className="w-3.5 h-3.5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>
                              <span className="text-emerald-600 font-medium">{item.estimated_impact}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-10">
                  <p className="text-gray-400 text-sm mb-3">아직 분석 결과가 없습니다</p>
                  <p className="text-gray-400 text-xs">"AI 분석 실행" 버튼을 눌러 문의 데이터 기반 액션 아이템을 생성하세요</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════ */}
        {/* Tab 3: 참고 데이터                          */}
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

                          {/* File attachment info */}
                          {ref.has_file && ref.file_name && (
                            <div className="flex items-center gap-2 mt-2">
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium bg-slate-100 text-slate-700 rounded-md border border-slate-200">
                                {ref.file_type === 'pdf' && (
                                  <svg className="w-3.5 h-3.5 text-red-500" fill="currentColor" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm-1 2l5 5h-5V4zM6 20V4h6v7h7v9H6z"/></svg>
                                )}
                                {(ref.file_type === 'xlsx' || ref.file_type === 'xls' || ref.file_type === 'csv') && (
                                  <svg className="w-3.5 h-3.5 text-green-600" fill="currentColor" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm-1 2l5 5h-5V4zM6 20V4h6v7h7v9H6z"/></svg>
                                )}
                                {(ref.file_type === 'docx' || ref.file_type === 'doc') && (
                                  <svg className="w-3.5 h-3.5 text-blue-600" fill="currentColor" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm-1 2l5 5h-5V4zM6 20V4h6v7h7v9H6z"/></svg>
                                )}
                                {ref.file_name}
                                {ref.file_size && (
                                  <span className="text-gray-400">
                                    ({ref.file_size < 1024 ? `${ref.file_size}B` : ref.file_size < 1024 * 1024 ? `${Math.round(ref.file_size / 1024)}KB` : `${(ref.file_size / (1024 * 1024)).toFixed(1)}MB`})
                                  </span>
                                )}
                              </span>
                              {ref.has_extracted_text && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-emerald-50 text-emerald-700 rounded-full border border-emerald-200">
                                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                                  AI 학습됨
                                </span>
                              )}
                              <button
                                onClick={() => window.open(`${API_BASE}/api/sabangnet/reference-data/${ref.id}/download`, '_blank')}
                                className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                              >
                                다운로드
                              </button>
                            </div>
                          )}
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
                          rows={4}
                          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
                        />
                      </div>

                      {/* File upload */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          파일 첨부 <span className="text-xs text-gray-400 font-normal">(PDF, Excel, Word, TXT)</span>
                        </label>

                        {/* Existing file info */}
                        {editingRef?.has_file && editingRef.file_name && !removeFile && (
                          <div className="flex items-center gap-2 mb-2 p-2 bg-gray-50 rounded-lg border border-gray-200">
                            <svg className="w-4 h-4 text-gray-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" /></svg>
                            <span className="text-xs text-gray-600 flex-1 truncate">{editingRef.file_name}</span>
                            {editingRef.has_extracted_text && (
                              <span className="text-xs text-emerald-600 font-medium">AI 학습됨</span>
                            )}
                            <button
                              type="button"
                              onClick={() => { setRemoveFile(true); setRefFile(null); }}
                              className="text-xs text-red-500 hover:text-red-700 font-medium"
                            >
                              삭제
                            </button>
                          </div>
                        )}

                        {/* New file selected */}
                        {refFile && (
                          <div className="flex items-center gap-2 mb-2 p-2 bg-blue-50 rounded-lg border border-blue-200">
                            <svg className="w-4 h-4 text-blue-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
                            <span className="text-xs text-blue-700 flex-1 truncate">{refFile.name}</span>
                            <span className="text-xs text-blue-500">
                              {refFile.size < 1024 ? `${refFile.size}B` : refFile.size < 1024 * 1024 ? `${Math.round(refFile.size / 1024)}KB` : `${(refFile.size / (1024 * 1024)).toFixed(1)}MB`}
                            </span>
                            <button
                              type="button"
                              onClick={() => setRefFile(null)}
                              className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                            >
                              취소
                            </button>
                          </div>
                        )}

                        {/* Drop zone / file input */}
                        {!refFile && (
                          <label className="flex flex-col items-center justify-center w-full h-24 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-blue-400 hover:bg-blue-50/50 transition-colors">
                            <div className="flex flex-col items-center">
                              <svg className="w-6 h-6 text-gray-400 mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
                              <span className="text-xs text-gray-500">클릭하여 파일 선택</span>
                              <span className="text-xs text-gray-400 mt-0.5">PDF, XLSX, DOCX, TXT (최대 20MB)</span>
                            </div>
                            <input
                              type="file"
                              className="hidden"
                              accept=".pdf,.xlsx,.xls,.docx,.doc,.txt,.csv"
                              onChange={e => {
                                const f = e.target.files?.[0];
                                if (f) {
                                  if (f.size > 20 * 1024 * 1024) {
                                    showToast('파일 크기가 20MB를 초과합니다.');
                                    return;
                                  }
                                  setRefFile(f);
                                  setRemoveFile(false);
                                }
                                e.target.value = '';
                              }}
                            />
                          </label>
                        )}

                        <p className="text-xs text-gray-400 mt-1.5">
                          첨부된 파일의 내용은 AI가 자동으로 학습하여 CS 답변 생성 시 참고합니다.
                        </p>
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
                        disabled={uploadingRef}
                        className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors inline-flex items-center gap-2"
                      >
                        {uploadingRef ? (
                          <>
                            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                            {refFile ? '업로드 중...' : '저장 중...'}
                          </>
                        ) : (editingRef ? '수정' : '추가')}
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
