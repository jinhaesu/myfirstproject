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
interface VoiceCall {
  id: number;
  call_id: string;
  phone_number: string;
  direction: 'inbound' | 'outbound';
  started_at: string | null;
  ended_at: string | null;
  duration_seconds: number;
  status: 'ringing' | 'in_progress' | 'completed' | 'failed' | 'missed';
  transcript: string | null;
  ai_summary: string | null;
  customer_name: string | null;
  order_number: string | null;
  order_info: Record<string, unknown> | null;
  category: string | null;
  sentiment: 'positive' | 'neutral' | 'negative' | null;
  action_items: Array<{ title: string; description: string; priority: string; status: string }> | null;
  resolved: boolean;
  notes: string | null;
  created_at: string | null;
  updated_at: string | null;
}

interface VoiceManual {
  id: number;
  title: string;
  category: string | null;
  content: string;
  scenario_type: string | null;
  sample_dialogue: string | null;
  priority_order: number;
  is_active: boolean;
  created_at: string | null;
}

interface PhoneNumber {
  id: number;
  phone_number: string;
  label: string | null;
  provider: string;
  provider_id: string | null;
  is_active: boolean;
  total_calls: number;
  created_at: string | null;
}

interface VoiceDashboard {
  total_calls: number;
  today_calls: number;
  avg_duration: number;
  unresolved_count: number;
  by_sentiment: Record<string, number>;
  by_category: Record<string, number>;
}

interface VoiceConfig {
  vapi_api_key: string;
  elevenlabs_api_key: string;
  voice_id: string;
  greeting_message: string;
  system_prompt: string;
  auto_order_lookup: boolean;
}

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────
const CALL_STATUS: Record<string, { bg: string; text: string; border: string; label: string }> = {
  'completed':   { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', label: '완료' },
  'in_progress': { bg: 'bg-blue-50',    text: 'text-blue-700',    border: 'border-blue-200',    label: '통화중' },
  'missed':      { bg: 'bg-red-50',     text: 'text-red-700',     border: 'border-red-200',     label: '부재중' },
  'failed':      { bg: 'bg-gray-50',    text: 'text-gray-700',    border: 'border-gray-200',    label: '실패' },
  'ringing':     { bg: 'bg-amber-50',   text: 'text-amber-700',   border: 'border-amber-200',   label: '수신중' },
};

const SENTIMENT_BADGE: Record<string, { bg: string; text: string; icon: string }> = {
  'positive': { bg: 'bg-emerald-50 text-emerald-700', text: '긍정', icon: '😊' },
  'neutral':  { bg: 'bg-slate-50 text-slate-600',     text: '중립', icon: '😐' },
  'negative': { bg: 'bg-red-50 text-red-700',         text: '부정', icon: '😟' },
};

const MANUAL_CATEGORIES = ['전체', '인사말', '배송', '교환/반품', '상품문의', '에스컬레이션', '기타'];
const CALL_CATEGORIES   = ['전체', '배송문의', '교환/반품', '상품문의', '기타'];
const CALL_STATUS_FILTERS = ['전체', 'completed', 'missed', 'in_progress', 'failed', 'ringing'];

const DEFAULT_BADGE = { bg: 'bg-gray-50', text: 'text-gray-700', border: 'border-gray-200' };

// ─────────────────────────────────────────────
// Sample Data
// ─────────────────────────────────────────────
const sampleCalls: VoiceCall[] = [
  {
    id: 1,
    call_id: 'vapi-call-001',
    phone_number: '010-1234-5678',
    direction: 'inbound',
    started_at: '2026-03-22T10:15:00',
    ended_at: '2026-03-22T10:20:32',
    duration_seconds: 332,
    status: 'completed',
    transcript:
      '고객: 안녕하세요, 저 어제 마카롱 주문했는데요, 배송이 언제 되나요?\nAI: 안녕하세요! 주문해 주셔서 감사합니다. 주문번호를 알려주시면 바로 확인해 드리겠습니다.\n고객: 주문번호는 2026032200123이에요.\nAI: 확인해 드리겠습니다. 고객님의 주문은 오늘 출고 예정이며, 내일 오후 중으로 도착 예정입니다.\n고객: 아 감사합니다!\nAI: 더 궁금한 점 있으시면 언제든지 연락 주세요. 감사합니다!',
    ai_summary: '배송 일정 문의. 주문번호 2026032200123, 오늘 출고 예정이며 내일 도착 예정으로 안내 완료.',
    customer_name: '홍길동',
    order_number: '2026032200123',
    order_info: { product: '널담 마카롱 복숭아 요거트 [50g]', qty: 2, amount: 18000, status: '출고준비중' },
    category: '배송문의',
    sentiment: 'positive',
    action_items: [
      { title: '배송 추적 링크 발송', description: '고객에게 SMS로 배송 추적 링크 발송', priority: 'low', status: 'pending' },
    ],
    resolved: true,
    notes: null,
    created_at: '2026-03-22T10:15:00',
    updated_at: '2026-03-22T10:21:00',
  },
  {
    id: 2,
    call_id: 'vapi-call-002',
    phone_number: '010-9876-5432',
    direction: 'inbound',
    started_at: '2026-03-22T11:30:00',
    ended_at: '2026-03-22T11:34:45',
    duration_seconds: 285,
    status: 'completed',
    transcript:
      '고객: 저 케이크 받았는데 완전 깨져서 왔어요. 어떻게 해야 하나요?\nAI: 정말 죄송합니다, 고객님. 불편을 드려 대단히 죄송합니다. 교환 또는 환불 처리해 드리겠습니다. 어떤 방법을 원하시나요?\n고객: 교환해 주세요. 빨리 받고 싶어요.\nAI: 네, 교환 처리해 드리겠습니다. 파손 상품 사진을 고객센터 이메일로 보내주시면 즉시 재발송 처리해 드리겠습니다.\n고객: 이메일이 어떻게 되나요?\nAI: cs@nuldam.com으로 보내주시면 됩니다. 추가 택배비는 발생하지 않습니다.\n고객: 알겠습니다. 감사합니다.',
    ai_summary: '케이크 파손 접수. 교환 요청 처리 완료. cs@nuldam.com으로 파손 사진 발송 안내.',
    customer_name: '김영희',
    order_number: 'CP-20260321-789',
    order_info: { product: '널담 케이크 바닐라치즈 [120g]', qty: 1, amount: 32000, status: '배송완료' },
    category: '교환/반품',
    sentiment: 'negative',
    action_items: [
      { title: '파손 사진 확인', description: '이메일로 파손 사진 수신 후 교환 발송 처리', priority: 'high', status: 'pending' },
      { title: '교환 발송', description: '파손 확인 후 동일 상품 재발송', priority: 'high', status: 'pending' },
    ],
    resolved: false,
    notes: '배송 중 파손 건. 사진 수신 후 즉시 재발송 필요.',
    created_at: '2026-03-22T11:30:00',
    updated_at: '2026-03-22T11:35:00',
  },
  {
    id: 3,
    call_id: 'vapi-call-003',
    phone_number: '010-5555-1234',
    direction: 'inbound',
    started_at: '2026-03-22T14:00:00',
    ended_at: null,
    duration_seconds: 180,
    status: 'missed',
    transcript: null,
    ai_summary: null,
    customer_name: null,
    order_number: null,
    order_info: null,
    category: '기타',
    sentiment: 'neutral',
    action_items: null,
    resolved: false,
    notes: null,
    created_at: '2026-03-22T14:00:00',
    updated_at: '2026-03-22T14:00:00',
  },
];

const sampleManuals: VoiceManual[] = [
  {
    id: 1,
    title: '기본 인사말',
    category: '인사말',
    content: '전화를 수신하면 "안녕하세요, 널담 고객센터입니다. 무엇을 도와드릴까요?"라고 인사합니다. 고객이 먼저 말할 때까지 기다립니다.',
    scenario_type: '인바운드_시작',
    sample_dialogue: '고객: (전화 연결)\nAI: 안녕하세요, 널담 고객센터입니다. 무엇을 도와드릴까요?\n고객: 배송 문의를 하고 싶은데요.',
    priority_order: 1,
    is_active: true,
    created_at: '2026-03-01T00:00:00',
  },
  {
    id: 2,
    title: '배송 일정 안내',
    category: '배송',
    content: '주문 후 1~3 영업일 이내 출고, 출고 후 1~2일 내 수령 가능. 주문번호를 받아 시스템에서 확인 후 정확한 일정 안내.',
    scenario_type: '배송문의',
    sample_dialogue: '고객: 주문한 상품이 언제 오나요?\nAI: 주문번호를 알려주시면 바로 확인해 드리겠습니다.\n고객: 2026032200123이요.\nAI: 확인해 보니 오늘 출고 예정이며 내일 중으로 도착 예정입니다.',
    priority_order: 2,
    is_active: true,
    created_at: '2026-03-01T00:00:00',
  },
  {
    id: 3,
    title: '교환/반품 처리 안내',
    category: '교환/반품',
    content: '수령 후 7일 이내 교환/반품 가능. 상품 하자는 무료, 고객 변심은 왕복 배송비 5,000원 부과. 파손 시 사진 이메일(cs@nuldam.com) 요청.',
    scenario_type: '교환반품',
    sample_dialogue: '고객: 상품이 파손되어 왔어요.\nAI: 정말 죄송합니다. 파손 사진을 cs@nuldam.com으로 보내주시면 즉시 교환 처리해 드리겠습니다.',
    priority_order: 3,
    is_active: true,
    created_at: '2026-03-01T00:00:00',
  },
  {
    id: 4,
    title: '상품 성분/알레르기 문의',
    category: '상품문의',
    content: '전성분 정보는 상품 상세 페이지 하단에서 확인 가능. 아토피 등 민감성 피부의 경우 소량 테스트 권장. 특정 성분 유무는 고객센터 이메일로 문의 안내.',
    scenario_type: '상품문의',
    sample_dialogue: '고객: 이 비누 아토피 있어도 써도 돼요?\nAI: 저희 제품은 천연 원료로 제작되어 민감성 피부에도 비교적 안전합니다. 다만 소량 패치 테스트를 먼저 권장드립니다.',
    priority_order: 4,
    is_active: true,
    created_at: '2026-03-01T00:00:00',
  },
  {
    id: 5,
    title: '에스컬레이션 절차',
    category: '에스컬레이션',
    content: '고객이 담당자 연결을 강하게 요청하거나 법적 언급, 욕설 등이 있을 경우 즉시 담당자에게 연결. 담당자 연결 전 고객의 이름과 연락처, 문의 내용을 미리 기록.',
    scenario_type: '에스컬레이션',
    sample_dialogue: '고객: 담당자 바꿔주세요!\nAI: 네, 알겠습니다. 담당자를 연결해 드리겠습니다. 잠시만 기다려 주세요.',
    priority_order: 5,
    is_active: true,
    created_at: '2026-03-01T00:00:00',
  },
];

const samplePhoneNumbers: PhoneNumber[] = [
  {
    id: 1,
    phone_number: '02-1234-5678',
    label: '대표 번호',
    provider: 'vapi',
    provider_id: 'vapi-num-abc123',
    is_active: true,
    total_calls: 3,
    created_at: '2026-03-01T00:00:00',
  },
  {
    id: 2,
    phone_number: '1588-9999',
    label: '고객센터 전용',
    provider: 'twilio',
    provider_id: 'twilio-num-xyz789',
    is_active: false,
    total_calls: 0,
    created_at: '2026-03-10T00:00:00',
  },
];

// ─────────────────────────────────────────────
// Utility
// ─────────────────────────────────────────────
const formatDate = (dateStr: string) => {
  const d = new Date(dateStr);
  const month  = String(d.getMonth() + 1).padStart(2, '0');
  const day    = String(d.getDate()).padStart(2, '0');
  const hours  = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day} ${hours}:${minutes}`;
};

const formatDuration = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}분 ${s}초` : `${s}초`;
};

const getCallStatus = (status: string) => CALL_STATUS[status] || { ...DEFAULT_BADGE, label: status };

let nextManualId = 100;
const getNextManualId = () => nextManualId++;

let nextPhoneId = 200;
const getNextPhoneId = () => nextPhoneId++;

// ═══════════════════════════════════════════════
// Transcript Renderer
// ═══════════════════════════════════════════════
const renderTranscript = (transcript: string) => {
  const lines = transcript.split('\n').filter(l => l.trim());
  return (
    <div className="space-y-3 py-3">
      {lines.map((line, i) => {
        const isCustomer = line.startsWith('고객:');
        const content = line.replace(/^(고객|AI):\s*/, '');
        return (
          <div key={i} className={`flex ${isCustomer ? 'justify-start' : 'justify-end'}`}>
            <div
              className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm ${
                isCustomer
                  ? 'bg-slate-100 text-slate-800 rounded-tl-sm'
                  : 'bg-blue-500 text-white rounded-tr-sm'
              }`}
            >
              <p className={`text-xs font-semibold mb-1 ${isCustomer ? 'text-slate-500' : 'text-blue-100'}`}>
                {isCustomer ? '고객' : 'AI 상담원'}
              </p>
              {content}
            </div>
          </div>
        );
      })}
    </div>
  );
};

// ═══════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════
export default function VoiceCsPage() {
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();

  // ── Tab ──
  const [activeTab, setActiveTab] = useState<'calls' | 'manuals' | 'phones' | 'settings'>('calls');
  const [toast, setToast] = useState<string | null>(null);

  // ── Calls tab ──
  const [calls, setCalls] = useState<VoiceCall[]>(sampleCalls);
  const [callStatusFilter, setCallStatusFilter] = useState('전체');
  const [callCategoryFilter, setCallCategoryFilter] = useState('전체');
  const [callSearch, setCallSearch] = useState('');
  const [expandedCallId, setExpandedCallId] = useState<number | null>(null);
  const [summarizingIds, setSummarizingIds] = useState<Set<number>>(new Set());
  const [expandedTranscriptIds, setExpandedTranscriptIds] = useState<Set<number>>(new Set());

  // ── Manuals tab ──
  const [manuals, setManuals] = useState<VoiceManual[]>(sampleManuals);
  const [manualCategoryFilter, setManualCategoryFilter] = useState('전체');
  const [showManualModal, setShowManualModal] = useState(false);
  const [editingManual, setEditingManual] = useState<VoiceManual | null>(null);
  const [manualForm, setManualForm] = useState({
    title: '', category: '인사말', content: '', scenario_type: '', sample_dialogue: '', priority_order: 0,
  });
  const [savingManual, setSavingManual] = useState(false);
  const [expandedManualIds, setExpandedManualIds] = useState<Set<number>>(new Set());

  // ── Phone numbers tab ──
  const [phoneNumbers, setPhoneNumbers] = useState<PhoneNumber[]>(samplePhoneNumbers);
  const [showPhoneModal, setShowPhoneModal] = useState(false);
  const [phoneForm, setPhoneForm] = useState({ phone_number: '', label: '', provider: 'vapi' });
  const [savingPhone, setSavingPhone] = useState(false);

  // ── Settings tab ──
  const [config, setConfig] = useState<VoiceConfig>({
    vapi_api_key: '',
    elevenlabs_api_key: '',
    voice_id: '',
    greeting_message: '안녕하세요, 널담 고객센터입니다. 무엇을 도와드릴까요?',
    system_prompt: '당신은 널담(Nuldam) 식품 브랜드의 친절한 CS 상담원입니다. 고객의 문의에 정중하고 명확하게 답변하세요.',
    auto_order_lookup: true,
  });
  const [savingConfig, setSavingConfig] = useState(false);

  // ── Dashboard ──
  const [dashboard, setDashboard] = useState<VoiceDashboard>({
    total_calls: 3,
    today_calls: 3,
    avg_duration: 250,
    unresolved_count: 2,
    by_sentiment: { positive: 1, neutral: 1, negative: 1 },
    by_category: { '배송문의': 1, '교환/반품': 1, '기타': 1 },
  });

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
      const raw = await fetchSafe<VoiceCall[] | { items: VoiceCall[] }>('/api/sabangnet/voice-cs/calls', []);
      const data = Array.isArray(raw) ? raw : (raw as { items: VoiceCall[] })?.items || [];
      if (data.length > 0) setCalls(data);
    })();
    (async () => {
      const raw = await fetchSafe<VoiceDashboard | null>('/api/sabangnet/voice-cs/dashboard', null);
      if (raw) setDashboard(raw);
    })();
    (async () => {
      const raw = await fetchSafe<VoiceManual[] | { items: VoiceManual[] }>('/api/sabangnet/voice-cs/manuals', []);
      const data = Array.isArray(raw) ? raw : (raw as { items: VoiceManual[] })?.items || [];
      if (data.length > 0) setManuals(data);
    })();
    (async () => {
      const raw = await fetchSafe<PhoneNumber[] | { items: PhoneNumber[] }>('/api/sabangnet/voice-cs/phone-numbers', []);
      const data = Array.isArray(raw) ? raw : (raw as { items: PhoneNumber[] })?.items || [];
      if (data.length > 0) setPhoneNumbers(data);
    })();
    (async () => {
      const raw = await fetchSafe<VoiceConfig | null>('/api/sabangnet/voice-cs/config', null);
      if (raw) setConfig(raw);
    })();
  }, [user]);

  // ── Toast auto-dismiss ──
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  // ── Filtered Calls ──
  const filteredCalls = useMemo(() => {
    let result = [...calls];
    if (callStatusFilter !== '전체') result = result.filter(c => c.status === callStatusFilter);
    if (callCategoryFilter !== '전체') result = result.filter(c => c.category === callCategoryFilter);
    if (callSearch) {
      const term = callSearch.toLowerCase();
      result = result.filter(
        c =>
          c.phone_number.includes(term) ||
          (c.customer_name && c.customer_name.toLowerCase().includes(term)) ||
          (c.ai_summary && c.ai_summary.toLowerCase().includes(term)) ||
          (c.order_number && c.order_number.toLowerCase().includes(term)),
      );
    }
    return result;
  }, [calls, callStatusFilter, callCategoryFilter, callSearch]);

  // ── Filtered Manuals ──
  const filteredManuals = useMemo(() => {
    if (manualCategoryFilter === '전체') return manuals;
    return manuals.filter(m => m.category === manualCategoryFilter);
  }, [manuals, manualCategoryFilter]);

  // ── Handlers: Calls ──
  const handleSummarize = async (callId: number) => {
    setSummarizingIds(prev => new Set(prev).add(callId));
    const res = await fetchMutate(`/api/sabangnet/voice-cs/calls/${callId}/summarize`, 'POST');
    if (res.ok && res.data) {
      const updated = res.data as VoiceCall;
      setCalls(prev => prev.map(c => (c.id === callId ? { ...c, ai_summary: updated.ai_summary ?? c.ai_summary } : c)));
      setToast('AI 요약이 재생성되었습니다.');
    } else {
      setToast('AI 요약 생성에 실패했습니다.');
    }
    setSummarizingIds(prev => {
      const next = new Set(prev);
      next.delete(callId);
      return next;
    });
  };

  const handleToggleResolved = async (call: VoiceCall) => {
    const updated = { ...call, resolved: !call.resolved };
    setCalls(prev => prev.map(c => (c.id === call.id ? updated : c)));
    await fetchMutate(`/api/sabangnet/voice-cs/calls/${call.id}/action-items`, 'PUT', { resolved: updated.resolved });
    setToast(updated.resolved ? '해결 완료로 변경했습니다.' : '미해결로 변경했습니다.');
  };

  const handleToggleActionItem = async (call: VoiceCall, index: number) => {
    if (!call.action_items) return;
    const newItems = call.action_items.map((item, i) =>
      i === index ? { ...item, status: item.status === 'done' ? 'pending' : 'done' } : item,
    );
    setCalls(prev => prev.map(c => (c.id === call.id ? { ...c, action_items: newItems } : c)));
    await fetchMutate(`/api/sabangnet/voice-cs/calls/${call.id}/action-items`, 'PUT', { action_items: newItems });
  };

  // ── Handlers: Manuals ──
  const openManualModal = (manual?: VoiceManual) => {
    if (manual) {
      setEditingManual(manual);
      setManualForm({
        title: manual.title,
        category: manual.category ?? '인사말',
        content: manual.content,
        scenario_type: manual.scenario_type ?? '',
        sample_dialogue: manual.sample_dialogue ?? '',
        priority_order: manual.priority_order,
      });
    } else {
      setEditingManual(null);
      setManualForm({ title: '', category: '인사말', content: '', scenario_type: '', sample_dialogue: '', priority_order: 0 });
    }
    setShowManualModal(true);
  };

  const handleSaveManual = async () => {
    if (!manualForm.title.trim() || !manualForm.content.trim()) {
      setToast('제목과 내용을 입력해주세요.');
      return;
    }
    setSavingManual(true);
    if (editingManual) {
      const res = await fetchMutate(`/api/sabangnet/voice-cs/manuals/${editingManual.id}`, 'PUT', manualForm);
      if (res.ok) {
        setManuals(prev =>
          prev.map(m => (m.id === editingManual.id ? { ...editingManual, ...manualForm, category: manualForm.category } : m)),
        );
        setToast('매뉴얼이 수정되었습니다.');
      } else {
        setManuals(prev =>
          prev.map(m => (m.id === editingManual.id ? { ...editingManual, ...manualForm, category: manualForm.category } : m)),
        );
        setToast('매뉴얼이 수정되었습니다.');
      }
    } else {
      const res = await fetchMutate('/api/sabangnet/voice-cs/manuals', 'POST', manualForm);
      const newManual: VoiceManual = {
        id: (res.ok && res.data && (res.data as VoiceManual).id) ? (res.data as VoiceManual).id : getNextManualId(),
        ...manualForm,
        category: manualForm.category,
        scenario_type: manualForm.scenario_type || null,
        sample_dialogue: manualForm.sample_dialogue || null,
        is_active: true,
        created_at: new Date().toISOString(),
      };
      setManuals(prev => [...prev, newManual]);
      setToast('매뉴얼이 등록되었습니다.');
    }
    setSavingManual(false);
    setShowManualModal(false);
  };

  const handleDeleteManual = async (id: number) => {
    setManuals(prev => prev.filter(m => m.id !== id));
    await fetchMutate(`/api/sabangnet/voice-cs/manuals/${id}`, 'DELETE');
    setToast('매뉴얼이 삭제되었습니다.');
  };

  const handleToggleManualActive = async (manual: VoiceManual) => {
    const updated = { ...manual, is_active: !manual.is_active };
    setManuals(prev => prev.map(m => (m.id === manual.id ? updated : m)));
    await fetchMutate(`/api/sabangnet/voice-cs/manuals/${manual.id}`, 'PUT', { is_active: updated.is_active });
    setToast(updated.is_active ? '매뉴얼이 활성화되었습니다.' : '매뉴얼이 비활성화되었습니다.');
  };

  // ── Handlers: Phone Numbers ──
  const handleSavePhone = async () => {
    if (!phoneForm.phone_number.trim()) {
      setToast('전화번호를 입력해주세요.');
      return;
    }
    setSavingPhone(true);
    const res = await fetchMutate('/api/sabangnet/voice-cs/phone-numbers', 'POST', phoneForm);
    const newPhone: PhoneNumber = {
      id: (res.ok && res.data && (res.data as PhoneNumber).id) ? (res.data as PhoneNumber).id : getNextPhoneId(),
      phone_number: phoneForm.phone_number,
      label: phoneForm.label || null,
      provider: phoneForm.provider,
      provider_id: null,
      is_active: true,
      total_calls: 0,
      created_at: new Date().toISOString(),
    };
    setPhoneNumbers(prev => [...prev, newPhone]);
    setToast('전화번호가 등록되었습니다.');
    setSavingPhone(false);
    setShowPhoneModal(false);
    setPhoneForm({ phone_number: '', label: '', provider: 'vapi' });
  };

  const handleDeletePhone = async (id: number) => {
    setPhoneNumbers(prev => prev.filter(p => p.id !== id));
    await fetchMutate(`/api/sabangnet/voice-cs/phone-numbers/${id}`, 'DELETE');
    setToast('전화번호가 삭제되었습니다.');
  };

  const handleTogglePhone = async (phone: PhoneNumber) => {
    const updated = { ...phone, is_active: !phone.is_active };
    setPhoneNumbers(prev => prev.map(p => (p.id === phone.id ? updated : p)));
    await fetchMutate(`/api/sabangnet/voice-cs/phone-numbers/${phone.id}/toggle`, 'PUT');
    setToast(updated.is_active ? '번호가 활성화되었습니다.' : '번호가 비활성화되었습니다.');
  };

  // ── Handlers: Config ──
  const handleSaveConfig = async () => {
    setSavingConfig(true);
    const res = await fetchMutate('/api/sabangnet/voice-cs/config', 'PUT', config);
    setToast(res.ok ? '설정이 저장되었습니다.' : '설정 저장에 실패했습니다.');
    setSavingConfig(false);
  };

  // ── Auth loading ──
  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) return null;

  // ═══════════════════════════════════════════════
  // Render
  // ═══════════════════════════════════════════════
  return (
    <div className="min-h-screen bg-slate-50">
      <Navigation />

      {/* ── Toast ── */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-slate-800 text-white text-sm px-4 py-3 rounded-xl shadow-lg animate-fade-in">
          {toast}
        </div>
      )}

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        {/* ── Page Header ── */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 bg-violet-100 rounded-xl flex items-center justify-center">
              <svg className="w-5 h-5 text-violet-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
                />
              </svg>
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">AI 음성 전화 CS</h1>
              <p className="text-sm text-slate-500 mt-0.5">AI가 전화 상담을 자동 처리하고 분석합니다</p>
            </div>
          </div>
        </div>

        {/* ── Tabs ── */}
        <div className="flex gap-1 mb-6 bg-white rounded-xl p-1 shadow-sm border border-slate-200 w-fit">
          {(
            [
              { id: 'calls',    label: '통화 내역' },
              { id: 'manuals',  label: '응대 매뉴얼' },
              { id: 'phones',   label: '전화번호 관리' },
              { id: 'settings', label: '설정' },
            ] as const
          ).map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-5 py-2 text-sm font-medium rounded-lg transition-all ${
                activeTab === tab.id
                  ? 'bg-violet-600 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* ════════════════════════════════════════
            TAB 1: 통화 내역
        ════════════════════════════════════════ */}
        {activeTab === 'calls' && (
          <div className="space-y-6">
            {/* Dashboard Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
                <p className="text-xs text-slate-500 font-medium mb-1">총 통화</p>
                <p className="text-2xl font-bold text-slate-900">{dashboard.total_calls.toLocaleString()}</p>
              </div>
              <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
                <p className="text-xs text-slate-500 font-medium mb-1">오늘 통화</p>
                <p className="text-2xl font-bold text-slate-900">{dashboard.today_calls.toLocaleString()}</p>
              </div>
              <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
                <p className="text-xs text-slate-500 font-medium mb-1">평균 통화시간</p>
                <p className="text-2xl font-bold text-slate-900">
                  {Math.floor(dashboard.avg_duration / 60)}분 {dashboard.avg_duration % 60}초
                </p>
              </div>
              <div className="bg-white rounded-xl p-4 border border-red-100 shadow-sm bg-red-50">
                <p className="text-xs text-red-500 font-medium mb-1">미해결 건</p>
                <p className="text-2xl font-bold text-red-600">{dashboard.unresolved_count.toLocaleString()}</p>
              </div>
            </div>

            {/* Filters */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
              <div className="flex flex-wrap gap-3">
                {/* Status filter */}
                <div className="flex gap-1 flex-wrap">
                  {CALL_STATUS_FILTERS.map(s => (
                    <button
                      key={s}
                      onClick={() => setCallStatusFilter(s)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-all ${
                        callStatusFilter === s
                          ? 'bg-violet-600 text-white border-violet-600'
                          : 'bg-white text-slate-600 border-slate-200 hover:border-violet-300'
                      }`}
                    >
                      {s === '전체' ? '전체' : (CALL_STATUS[s]?.label ?? s)}
                    </button>
                  ))}
                </div>

                {/* Category filter */}
                <select
                  value={callCategoryFilter}
                  onChange={e => setCallCategoryFilter(e.target.value)}
                  className="px-3 py-1.5 text-xs border border-slate-200 rounded-lg text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-violet-500"
                >
                  {CALL_CATEGORIES.map(c => <option key={c}>{c}</option>)}
                </select>

                {/* Search */}
                <input
                  type="text"
                  value={callSearch}
                  onChange={e => setCallSearch(e.target.value)}
                  placeholder="전화번호, 고객명, 요약 검색..."
                  className="flex-1 min-w-[180px] px-3 py-1.5 text-xs border border-slate-200 rounded-lg text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
              </div>
            </div>

            {/* Call List */}
            <div className="space-y-3">
              {filteredCalls.length === 0 ? (
                <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-slate-400 text-sm">
                  조건에 맞는 통화 내역이 없습니다.
                </div>
              ) : (
                filteredCalls.map(call => {
                  const statusInfo = getCallStatus(call.status);
                  const sentiment = call.sentiment ? SENTIMENT_BADGE[call.sentiment] : null;
                  const isExpanded = expandedCallId === call.id;
                  const isTranscriptExpanded = expandedTranscriptIds.has(call.id);
                  const isSummarizing = summarizingIds.has(call.id);

                  return (
                    <div
                      key={call.id}
                      className={`bg-white rounded-xl border shadow-sm transition-all ${
                        call.resolved ? 'border-slate-200' : 'border-orange-200'
                      }`}
                    >
                      {/* Call Card Header */}
                      <div
                        className="p-4 cursor-pointer"
                        onClick={() => setExpandedCallId(isExpanded ? null : call.id)}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-center gap-3 min-w-0">
                            {/* Direction icon */}
                            <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
                              call.direction === 'inbound' ? 'bg-blue-50' : 'bg-emerald-50'
                            }`}>
                              <svg
                                className={`w-4 h-4 ${call.direction === 'inbound' ? 'text-blue-500' : 'text-emerald-500'}`}
                                fill="none" viewBox="0 0 24 24" stroke="currentColor"
                              >
                                {call.direction === 'inbound' ? (
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                    d="M16 3h5m0 0v5m0-5l-6 6M5 3a2 2 0 00-2 2v1c0 8.284 6.716 15 15 15h1a2 2 0 002-2v-3.28a1 1 0 00-.684-.948l-4.493-1.498a1 1 0 00-1.21.502l-1.13 2.257a11.042 11.042 0 01-5.516-5.517l2.257-1.128a1 1 0 00.502-1.21L9.228 3.683A1 1 0 008.279 3H5z"
                                  />
                                ) : (
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                    d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
                                  />
                                )}
                              </svg>
                            </div>

                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-semibold text-slate-900 text-sm">{call.phone_number}</span>
                                {call.customer_name && (
                                  <span className="text-slate-500 text-xs">({call.customer_name})</span>
                                )}
                                <span className="text-xs text-slate-400">
                                  {call.direction === 'inbound' ? '수신' : '발신'}
                                </span>
                              </div>
                              <div className="flex items-center gap-2 mt-1 flex-wrap">
                                {/* Status badge */}
                                <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border ${statusInfo.bg} ${statusInfo.text} ${statusInfo.border}`}>
                                  {statusInfo.label}
                                </span>
                                {/* Sentiment badge */}
                                {sentiment && (
                                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium ${sentiment.bg}`}>
                                    <span>{sentiment.icon}</span>
                                    <span>{sentiment.text}</span>
                                  </span>
                                )}
                                {/* Category badge */}
                                {call.category && (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-violet-50 text-violet-700 border border-violet-200">
                                    {call.category}
                                  </span>
                                )}
                                {/* Resolved badge */}
                                {call.resolved && (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                                    해결됨
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="flex flex-col items-end gap-1 flex-shrink-0">
                            <span className="text-xs text-slate-400">
                              {call.started_at ? formatDate(call.started_at) : '-'}
                            </span>
                            <span className="text-xs text-slate-500 font-medium">
                              {formatDuration(call.duration_seconds)}
                            </span>
                            {call.order_number && (
                              <span className="text-xs text-violet-600 font-mono">#{call.order_number}</span>
                            )}
                          </div>
                        </div>

                        {/* AI Summary */}
                        {call.ai_summary && (
                          <div className="mt-3 px-3 py-2 bg-blue-50 rounded-lg">
                            <p className="text-xs text-blue-500 font-semibold mb-0.5">AI 요약</p>
                            <p className="text-xs text-blue-800 leading-relaxed">{call.ai_summary}</p>
                          </div>
                        )}

                        {/* Expand indicator */}
                        <div className="flex justify-center mt-2">
                          <svg
                            className={`w-4 h-4 text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                            fill="none" viewBox="0 0 24 24" stroke="currentColor"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </div>
                      </div>

                      {/* Expanded Section */}
                      {isExpanded && (
                        <div className="border-t border-slate-100 px-4 pb-4 space-y-4">
                          {/* Transcript */}
                          {call.transcript ? (
                            <div>
                              <div className="flex items-center justify-between mt-4 mb-2">
                                <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">전체 대화 내역</p>
                                <button
                                  onClick={() =>
                                    setExpandedTranscriptIds(prev => {
                                      const next = new Set(prev);
                                      if (next.has(call.id)) next.delete(call.id);
                                      else next.add(call.id);
                                      return next;
                                    })
                                  }
                                  className="text-xs text-violet-600 hover:underline"
                                >
                                  {isTranscriptExpanded ? '접기' : '펼치기'}
                                </button>
                              </div>
                              {isTranscriptExpanded && (
                                <div className="bg-slate-50 rounded-xl px-4 max-h-80 overflow-y-auto">
                                  {renderTranscript(call.transcript)}
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="mt-4 text-xs text-slate-400 italic">대화 내역 없음 (부재중 또는 녹취 실패)</div>
                          )}

                          {/* Order Info */}
                          {call.order_info && (
                            <div>
                              <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">주문 정보</p>
                              <div className="bg-amber-50 rounded-lg p-3 text-xs space-y-1">
                                {Object.entries(call.order_info).map(([k, v]) => (
                                  <div key={k} className="flex gap-2">
                                    <span className="text-amber-600 font-medium min-w-[60px]">{k}</span>
                                    <span className="text-amber-900">{String(v)}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Action Items */}
                          {call.action_items && call.action_items.length > 0 && (
                            <div>
                              <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">액션 아이템</p>
                              <div className="space-y-2">
                                {call.action_items.map((item, idx) => (
                                  <div
                                    key={idx}
                                    className={`flex items-start gap-3 p-3 rounded-lg border ${
                                      item.status === 'done'
                                        ? 'bg-emerald-50 border-emerald-200'
                                        : item.priority === 'high'
                                        ? 'bg-red-50 border-red-200'
                                        : 'bg-white border-slate-200'
                                    }`}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={item.status === 'done'}
                                      onChange={() => handleToggleActionItem(call, idx)}
                                      className="mt-0.5 w-4 h-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                                    />
                                    <div className="min-w-0">
                                      <p className={`text-xs font-semibold ${item.status === 'done' ? 'line-through text-slate-400' : 'text-slate-800'}`}>
                                        {item.title}
                                      </p>
                                      <p className="text-xs text-slate-500 mt-0.5">{item.description}</p>
                                    </div>
                                    <span className={`text-xs px-2 py-0.5 rounded-md font-medium flex-shrink-0 ${
                                      item.priority === 'high' ? 'bg-red-100 text-red-700' :
                                      item.priority === 'medium' ? 'bg-amber-100 text-amber-700' :
                                      'bg-slate-100 text-slate-600'
                                    }`}>
                                      {item.priority === 'high' ? '높음' : item.priority === 'medium' ? '중간' : '낮음'}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Notes */}
                          {call.notes && (
                            <div>
                              <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1">메모</p>
                              <p className="text-xs text-slate-700 bg-slate-50 rounded-lg p-3">{call.notes}</p>
                            </div>
                          )}

                          {/* Footer Buttons */}
                          <div className="flex items-center gap-3 pt-2">
                            <button
                              onClick={() => handleSummarize(call.id)}
                              disabled={isSummarizing || !call.transcript}
                              className="flex items-center gap-2 px-4 py-2 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                              {isSummarizing ? (
                                <>
                                  <div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" />
                                  요약 생성 중...
                                </>
                              ) : (
                                'AI 요약 재생성'
                              )}
                            </button>
                            <button
                              onClick={() => handleToggleResolved(call)}
                              className={`px-4 py-2 text-xs font-medium rounded-lg border transition-colors ${
                                call.resolved
                                  ? 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                                  : 'bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-700'
                              }`}
                            >
                              {call.resolved ? '미해결로 변경' : '해결 완료'}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* ════════════════════════════════════════
            TAB 2: 응대 매뉴얼
        ════════════════════════════════════════ */}
        {activeTab === 'manuals' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div className="flex gap-2 flex-wrap">
                {MANUAL_CATEGORIES.map(cat => (
                  <button
                    key={cat}
                    onClick={() => setManualCategoryFilter(cat)}
                    className={`px-4 py-2 text-sm font-medium rounded-lg border transition-all ${
                      manualCategoryFilter === cat
                        ? 'bg-violet-600 text-white border-violet-600'
                        : 'bg-white text-slate-600 border-slate-200 hover:border-violet-300'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
              <button
                onClick={() => openManualModal()}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors shadow-sm"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                매뉴얼 추가
              </button>
            </div>

            <div className="space-y-3">
              {filteredManuals.length === 0 ? (
                <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-slate-400 text-sm">
                  등록된 매뉴얼이 없습니다.
                </div>
              ) : (
                filteredManuals.map(manual => {
                  const isDialogueExpanded = expandedManualIds.has(manual.id);
                  return (
                    <div
                      key={manual.id}
                      className={`bg-white rounded-xl border shadow-sm transition-all ${
                        manual.is_active ? 'border-slate-200' : 'border-slate-100 opacity-60'
                      }`}
                    >
                      <div className="p-4">
                        {/* Header */}
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-center gap-2 flex-wrap min-w-0">
                            <span className="font-semibold text-slate-900 text-sm">{manual.title}</span>
                            {manual.category && (
                              <span className="px-2 py-0.5 text-xs rounded-md font-medium bg-violet-50 text-violet-700 border border-violet-200">
                                {manual.category}
                              </span>
                            )}
                            {manual.scenario_type && (
                              <span className="px-2 py-0.5 text-xs rounded-md font-medium bg-slate-100 text-slate-600">
                                {manual.scenario_type}
                              </span>
                            )}
                            {!manual.is_active && (
                              <span className="px-2 py-0.5 text-xs rounded-md font-medium bg-gray-100 text-gray-500">
                                비활성
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            {/* Active toggle */}
                            <button
                              onClick={() => handleToggleManualActive(manual)}
                              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                                manual.is_active ? 'bg-violet-600' : 'bg-slate-200'
                              }`}
                            >
                              <span
                                className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                                  manual.is_active ? 'translate-x-4' : 'translate-x-0.5'
                                }`}
                              />
                            </button>
                            <button
                              onClick={() => openManualModal(manual)}
                              className="p-1.5 text-slate-400 hover:text-violet-600 hover:bg-violet-50 rounded-lg transition-colors"
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                  d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                                />
                              </svg>
                            </button>
                            <button
                              onClick={() => handleDeleteManual(manual.id)}
                              className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                                />
                              </svg>
                            </button>
                          </div>
                        </div>

                        {/* Content (3-line clamp) */}
                        <p className="mt-3 text-sm text-slate-700 leading-relaxed line-clamp-3">{manual.content}</p>

                        {/* Sample Dialogue toggle */}
                        {manual.sample_dialogue && (
                          <div className="mt-3">
                            <button
                              onClick={() =>
                                setExpandedManualIds(prev => {
                                  const next = new Set(prev);
                                  if (next.has(manual.id)) next.delete(manual.id);
                                  else next.add(manual.id);
                                  return next;
                                })
                              }
                              className="flex items-center gap-1 text-xs text-violet-600 hover:text-violet-700 font-medium"
                            >
                              <svg
                                className={`w-3.5 h-3.5 transition-transform ${isDialogueExpanded ? 'rotate-90' : ''}`}
                                fill="none" viewBox="0 0 24 24" stroke="currentColor"
                              >
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                              </svg>
                              예시 대화 {isDialogueExpanded ? '접기' : '보기'}
                            </button>
                            {isDialogueExpanded && (
                              <div className="mt-2 bg-slate-50 rounded-lg p-3">
                                <pre className="text-xs text-slate-700 whitespace-pre-wrap font-sans leading-relaxed">
                                  {manual.sample_dialogue}
                                </pre>
                              </div>
                            )}
                          </div>
                        )}

                        <div className="mt-3 flex items-center gap-2">
                          <span className="text-xs text-slate-400">표시 순서: {manual.priority_order}</span>
                          {manual.created_at && (
                            <span className="text-xs text-slate-400">· {formatDate(manual.created_at)}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* ════════════════════════════════════════
            TAB 3: 전화번호 관리
        ════════════════════════════════════════ */}
        {activeTab === 'phones' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-700">등록된 전화번호 {phoneNumbers.length}개</h2>
              <button
                onClick={() => setShowPhoneModal(true)}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors shadow-sm"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                번호 등록
              </button>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {phoneNumbers.length === 0 ? (
                <div className="col-span-2 bg-white rounded-xl border border-slate-200 p-12 text-center text-slate-400 text-sm">
                  등록된 전화번호가 없습니다.
                </div>
              ) : (
                phoneNumbers.map(phone => (
                  <div
                    key={phone.id}
                    className={`bg-white rounded-xl border shadow-sm p-5 transition-all ${
                      phone.is_active ? 'border-slate-200' : 'border-slate-100 opacity-60'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xl font-bold text-slate-900 font-mono">{phone.phone_number}</p>
                        {phone.label && <p className="text-sm text-slate-500 mt-0.5">{phone.label}</p>}
                        <div className="flex items-center gap-2 mt-2">
                          <span className={`text-xs px-2 py-0.5 rounded-md font-medium ${
                            phone.provider === 'vapi'
                              ? 'bg-violet-50 text-violet-700 border border-violet-200'
                              : 'bg-red-50 text-red-700 border border-red-200'
                          }`}>
                            {phone.provider.toUpperCase()}
                          </span>
                          <span className="text-xs text-slate-400">총 {phone.total_calls}회 통화</span>
                        </div>
                        {phone.created_at && (
                          <p className="text-xs text-slate-400 mt-1">등록일: {formatDate(phone.created_at)}</p>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-3">
                        {/* Active toggle */}
                        <button
                          onClick={() => handleTogglePhone(phone)}
                          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                            phone.is_active ? 'bg-violet-600' : 'bg-slate-200'
                          }`}
                        >
                          <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                              phone.is_active ? 'translate-x-6' : 'translate-x-1'
                            }`}
                          />
                        </button>
                        <p className="text-xs text-slate-400">{phone.is_active ? '활성' : '비활성'}</p>
                        <button
                          onClick={() => handleDeletePhone(phone.id)}
                          className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                            />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* ════════════════════════════════════════
            TAB 4: 설정
        ════════════════════════════════════════ */}
        {activeTab === 'settings' && (
          <div className="max-w-2xl space-y-6">
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm divide-y divide-slate-100">
              {/* Vapi API Key */}
              <div className="p-5">
                <label className="block text-sm font-semibold text-slate-800 mb-1">Vapi API 키</label>
                <p className="text-xs text-slate-500 mb-3">AI 음성 전화 서비스에 사용되는 Vapi API 키를 입력하세요.</p>
                <input
                  type="password"
                  value={config.vapi_api_key}
                  onChange={e => setConfig(prev => ({ ...prev, vapi_api_key: e.target.value }))}
                  placeholder="vapi_..."
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg text-slate-700 font-mono placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
              </div>

              {/* ElevenLabs API Key */}
              <div className="p-5">
                <label className="block text-sm font-semibold text-slate-800 mb-1">ElevenLabs API 키</label>
                <p className="text-xs text-slate-500 mb-3">자연스러운 AI 음성 합성을 위한 ElevenLabs API 키를 입력하세요.</p>
                <input
                  type="password"
                  value={config.elevenlabs_api_key}
                  onChange={e => setConfig(prev => ({ ...prev, elevenlabs_api_key: e.target.value }))}
                  placeholder="sk_..."
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg text-slate-700 font-mono placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
              </div>

              {/* Voice ID */}
              <div className="p-5">
                <label className="block text-sm font-semibold text-slate-800 mb-1">음성 ID (Voice ID)</label>
                <p className="text-xs text-slate-500 mb-3">
                  ElevenLabs에서 사용할 음성의 ID를 입력하세요.
                  <a
                    href="https://elevenlabs.io/voice-library"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-1 text-violet-600 hover:underline"
                  >
                    음성 라이브러리 보기
                  </a>
                </p>
                <input
                  type="text"
                  value={config.voice_id}
                  onChange={e => setConfig(prev => ({ ...prev, voice_id: e.target.value }))}
                  placeholder="예) 21m00Tcm4TlvDq8ikWAM"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg text-slate-700 font-mono placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
              </div>

              {/* Greeting Message */}
              <div className="p-5">
                <label className="block text-sm font-semibold text-slate-800 mb-1">인사말 메시지</label>
                <p className="text-xs text-slate-500 mb-3">전화를 수신했을 때 AI가 처음 말하는 문구입니다.</p>
                <textarea
                  value={config.greeting_message}
                  onChange={e => setConfig(prev => ({ ...prev, greeting_message: e.target.value }))}
                  rows={2}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500 resize-none"
                />
              </div>

              {/* System Prompt */}
              <div className="p-5">
                <label className="block text-sm font-semibold text-slate-800 mb-1">시스템 프롬프트</label>
                <p className="text-xs text-slate-500 mb-3">
                  AI 상담원의 역할, 말투, 처리 방식을 지시하는 프롬프트입니다. 구체적으로 작성할수록 대응 품질이 높아집니다.
                </p>
                <textarea
                  value={config.system_prompt}
                  onChange={e => setConfig(prev => ({ ...prev, system_prompt: e.target.value }))}
                  rows={6}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500 resize-y"
                />
              </div>

              {/* Auto Order Lookup */}
              <div className="p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-slate-800">자동 주문 조회</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      전화 수신 시 발신 번호로 사방넷 주문을 자동으로 검색하여 상담원에게 제공합니다.
                    </p>
                  </div>
                  <button
                    onClick={() => setConfig(prev => ({ ...prev, auto_order_lookup: !prev.auto_order_lookup }))}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 ${
                      config.auto_order_lookup ? 'bg-violet-600' : 'bg-slate-200'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                        config.auto_order_lookup ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>
              </div>
            </div>

            {/* Save Button */}
            <div className="flex justify-end">
              <button
                onClick={handleSaveConfig}
                disabled={savingConfig}
                className="flex items-center gap-2 px-6 py-2.5 text-sm font-medium bg-violet-600 text-white rounded-lg hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
              >
                {savingConfig ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    저장 중...
                  </>
                ) : (
                  '설정 저장'
                )}
              </button>
            </div>
          </div>
        )}
      </main>

      {/* ════════════════════════════════════════
          MODAL: 매뉴얼 등록/수정
      ════════════════════════════════════════ */}
      {showManualModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={() => setShowManualModal(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-slate-100 px-6 py-4 rounded-t-2xl">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-bold text-slate-900">
                  {editingManual ? '매뉴얼 수정' : '매뉴얼 추가'}
                </h2>
                <button
                  onClick={() => setShowManualModal(false)}
                  className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="p-6 space-y-4">
              {/* Title */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">제목 *</label>
                <input
                  type="text"
                  value={manualForm.title}
                  onChange={e => setManualForm(prev => ({ ...prev, title: e.target.value }))}
                  placeholder="매뉴얼 제목"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
              </div>

              {/* Category */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">카테고리</label>
                <select
                  value={manualForm.category}
                  onChange={e => setManualForm(prev => ({ ...prev, category: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-violet-500"
                >
                  {MANUAL_CATEGORIES.filter(c => c !== '전체').map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>

              {/* Content */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">내용 *</label>
                <textarea
                  value={manualForm.content}
                  onChange={e => setManualForm(prev => ({ ...prev, content: e.target.value }))}
                  placeholder="응대 매뉴얼 내용을 입력하세요."
                  rows={5}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500 resize-y"
                />
              </div>

              {/* Scenario Type */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">시나리오 유형</label>
                <input
                  type="text"
                  value={manualForm.scenario_type}
                  onChange={e => setManualForm(prev => ({ ...prev, scenario_type: e.target.value }))}
                  placeholder="예) 인바운드_시작, 배송문의, 교환반품"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
              </div>

              {/* Sample Dialogue */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">예시 대화</label>
                <textarea
                  value={manualForm.sample_dialogue}
                  onChange={e => setManualForm(prev => ({ ...prev, sample_dialogue: e.target.value }))}
                  placeholder={'고객: ...\nAI: ...'}
                  rows={4}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500 resize-y font-mono"
                />
              </div>

              {/* Priority Order */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">표시 순서</label>
                <input
                  type="number"
                  value={manualForm.priority_order}
                  onChange={e => setManualForm(prev => ({ ...prev, priority_order: Number(e.target.value) }))}
                  min={0}
                  className="w-24 px-3 py-2 text-sm border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
              </div>
            </div>

            <div className="sticky bottom-0 bg-white border-t border-slate-100 px-6 py-4 rounded-b-2xl flex justify-end gap-3">
              <button
                onClick={() => setShowManualModal(false)}
                className="px-4 py-2 text-sm font-medium text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors"
              >
                취소
              </button>
              <button
                onClick={handleSaveManual}
                disabled={savingManual}
                className="flex items-center gap-2 px-5 py-2 text-sm font-medium bg-violet-600 text-white rounded-lg hover:bg-violet-700 disabled:opacity-50 transition-colors"
              >
                {savingManual ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    저장 중...
                  </>
                ) : (
                  editingManual ? '수정 완료' : '등록'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════
          MODAL: 전화번호 등록
      ════════════════════════════════════════ */}
      {showPhoneModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={() => setShowPhoneModal(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="border-b border-slate-100 px-6 py-4">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-bold text-slate-900">전화번호 등록</h2>
                <button
                  onClick={() => setShowPhoneModal(false)}
                  className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="p-6 space-y-4">
              {/* Phone Number */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">전화번호 *</label>
                <input
                  type="tel"
                  value={phoneForm.phone_number}
                  onChange={e => setPhoneForm(prev => ({ ...prev, phone_number: e.target.value }))}
                  placeholder="02-1234-5678"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500 font-mono"
                />
              </div>

              {/* Label */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">라벨</label>
                <input
                  type="text"
                  value={phoneForm.label}
                  onChange={e => setPhoneForm(prev => ({ ...prev, label: e.target.value }))}
                  placeholder="예) 대표 번호, 고객센터 전용"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
              </div>

              {/* Provider */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">서비스 제공자</label>
                <select
                  value={phoneForm.provider}
                  onChange={e => setPhoneForm(prev => ({ ...prev, provider: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-violet-500"
                >
                  <option value="vapi">Vapi</option>
                  <option value="twilio">Twilio</option>
                </select>
              </div>
            </div>

            <div className="border-t border-slate-100 px-6 py-4 flex justify-end gap-3">
              <button
                onClick={() => setShowPhoneModal(false)}
                className="px-4 py-2 text-sm font-medium text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors"
              >
                취소
              </button>
              <button
                onClick={handleSavePhone}
                disabled={savingPhone}
                className="flex items-center gap-2 px-5 py-2 text-sm font-medium bg-violet-600 text-white rounded-lg hover:bg-violet-700 disabled:opacity-50 transition-colors"
              >
                {savingPhone ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    등록 중...
                  </>
                ) : (
                  '등록'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
