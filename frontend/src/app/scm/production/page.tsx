'use client';

import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Navigation } from '@/components/layout/Navigation';

// ─────────────────────────────────────────────────────────────────────────────
// API helpers
// ─────────────────────────────────────────────────────────────────────────────
const API_BASE = '';
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
  } catch { return defaultValue; }
};
const postApi = async <T,>(path: string, body: unknown, defaultValue: T): Promise<T> => {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error();
    return await res.json();
  } catch { return defaultValue; }
};
const putApi = async <T,>(path: string, body: unknown, defaultValue: T): Promise<T> => {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error();
    return await res.json();
  } catch { return defaultValue; }
};
const deleteApi = async (path: string): Promise<boolean> => {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    return res.ok;
  } catch { return false; }
};

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
type PlanStatus = '초안' | '확정' | '진행중' | '완료';
type ViewMode = 'daily' | 'weekly';
type AlertLevel = 'urgent' | 'warning' | 'ok';

interface ProductionPlan {
  id: string;
  plan_date: string;
  product_name: string;
  product_code: string;
  planned_qty: number;
  avg_hourly_rate: number;
  required_hours: number;
  required_manpower: number;
  order_plan_qty: number;
  safety_stock_deficit: number;
  ai_recommended_qty: number | null;
  status: PlanStatus;
  notes: string;
}

interface AIRecommendation {
  recommended_qty: number;
  safety_stock_deficit: number;
  order_plan_qty: number;
  avg_hourly_rate: number;
  required_hours: number;
  required_manpower: number;
  explanation: string;
}

interface AlertItem {
  id: string;
  level: AlertLevel;
  title: string;
  description: string;
  product_name: string;
  due_date?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants & Sample Data
// ─────────────────────────────────────────────────────────────────────────────
const STATUS_CONFIG: Record<PlanStatus, { bg: string; text: string; dot: string }> = {
  '초안':  { bg: 'bg-gray-100',    text: 'text-gray-700',    dot: 'bg-gray-400' },
  '확정':  { bg: 'bg-blue-100',    text: 'text-blue-700',    dot: 'bg-blue-500' },
  '진행중': { bg: 'bg-amber-100',   text: 'text-amber-700',   dot: 'bg-amber-500' },
  '완료':  { bg: 'bg-emerald-100', text: 'text-emerald-700', dot: 'bg-emerald-500' },
};

const STATUS_OPTIONS: PlanStatus[] = ['초안', '확정', '진행중', '완료'];

const PRODUCT_CATALOG = [
  { name: '수제 비누', code: 'SB-001' },
  { name: '천연 샴푸', code: 'NS-002' },
  { name: '아로마 오일', code: 'AO-003' },
  { name: '핸드크림', code: 'HC-004' },
  { name: '바디로션', code: 'BL-005' },
  { name: '페이스 미스트', code: 'FM-006' },
  { name: '립밤', code: 'LB-007' },
  { name: '선크림 SPF50+', code: 'SC-008' },
  { name: '클렌징 폼', code: 'CF-009' },
  { name: '수분 세럼', code: 'SS-010' },
];

const formatDate = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const getWeekDates = (baseDate: Date): { start: string; end: string } => {
  const d = new Date(baseDate);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d.setDate(diff));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { start: formatDate(monday), end: formatDate(sunday) };
};

const getDatesInRange = (start: string, end: string): string[] => {
  const dates: string[] = [];
  const current = new Date(start);
  const last = new Date(end);
  while (current <= last) {
    dates.push(formatDate(current));
    current.setDate(current.getDate() + 1);
  }
  return dates;
};

const generateSamplePlans = (): ProductionPlan[] => {
  const today = new Date();
  const week = getWeekDates(today);
  const dates = getDatesInRange(week.start, week.end);

  const plans: ProductionPlan[] = [
    {
      id: 'PP-001', plan_date: dates[0] || week.start, product_name: '수제 비누', product_code: 'SB-001',
      planned_qty: 500, avg_hourly_rate: 60, required_hours: 8.33, required_manpower: 2,
      order_plan_qty: 400, safety_stock_deficit: 150, ai_recommended_qty: 550,
      status: '확정', notes: '생산1팀 배정',
    },
    {
      id: 'PP-002', plan_date: dates[0] || week.start, product_name: '천연 샴푸', product_code: 'NS-002',
      planned_qty: 300, avg_hourly_rate: 45, required_hours: 6.67, required_manpower: 1,
      order_plan_qty: 250, safety_stock_deficit: 80, ai_recommended_qty: 330,
      status: '초안', notes: '',
    },
    {
      id: 'PP-003', plan_date: dates[1] || week.start, product_name: '아로마 오일', product_code: 'AO-003',
      planned_qty: 200, avg_hourly_rate: 30, required_hours: 6.67, required_manpower: 1,
      order_plan_qty: 180, safety_stock_deficit: 50, ai_recommended_qty: 230,
      status: '진행중', notes: '생산2팀 배정',
    },
    {
      id: 'PP-004', plan_date: dates[2] || week.start, product_name: '핸드크림', product_code: 'HC-004',
      planned_qty: 800, avg_hourly_rate: 80, required_hours: 10, required_manpower: 2,
      order_plan_qty: 700, safety_stock_deficit: 200, ai_recommended_qty: 900,
      status: '초안', notes: '원자재 입고 확인 필요',
    },
    {
      id: 'PP-005', plan_date: dates[2] || week.start, product_name: '바디로션', product_code: 'BL-005',
      planned_qty: 400, avg_hourly_rate: 50, required_hours: 8, required_manpower: 1,
      order_plan_qty: 350, safety_stock_deficit: 100, ai_recommended_qty: 450,
      status: '확정', notes: '',
    },
    {
      id: 'PP-006', plan_date: dates[3] || week.start, product_name: '페이스 미스트', product_code: 'FM-006',
      planned_qty: 600, avg_hourly_rate: 70, required_hours: 8.57, required_manpower: 2,
      order_plan_qty: 500, safety_stock_deficit: 120, ai_recommended_qty: null,
      status: '초안', notes: '봄 시즌 프로모션',
    },
    {
      id: 'PP-007', plan_date: dates[4] || week.start, product_name: '립밤', product_code: 'LB-007',
      planned_qty: 1000, avg_hourly_rate: 120, required_hours: 8.33, required_manpower: 2,
      order_plan_qty: 900, safety_stock_deficit: 0, ai_recommended_qty: 900,
      status: '완료', notes: '생산1팀 완료',
    },
    {
      id: 'PP-008', plan_date: dates[5] || week.start, product_name: '선크림 SPF50+', product_code: 'SC-008',
      planned_qty: 350, avg_hourly_rate: 40, required_hours: 8.75, required_manpower: 2,
      order_plan_qty: 300, safety_stock_deficit: 80, ai_recommended_qty: 380,
      status: '초안', notes: '여름 대비 선 생산',
    },
  ];
  return plans;
};

const generateSampleAlerts = (): AlertItem[] => [
  {
    id: 'A-001', level: 'urgent',
    title: '긴급 생산 필요', description: '핸드크림 안전재고 부족 (부족분: 200개). 3/18 주문 납기 임박.',
    product_name: '핸드크림', due_date: '2026-03-18',
  },
  {
    id: 'A-002', level: 'urgent',
    title: '납기 임박 주문', description: '수제 비누 400개 주문 (3/17 납기). 현 재고 부족.',
    product_name: '수제 비누', due_date: '2026-03-17',
  },
  {
    id: 'A-003', level: 'warning',
    title: '안전재고 주의', description: '페이스 미스트 안전재고 하한선 근접 (현재고: 130개, 안전재고: 120개).',
    product_name: '페이스 미스트',
  },
  {
    id: 'A-004', level: 'warning',
    title: '주문 계획 확인', description: '아로마 오일 대량 주문 계획 접수 (180개, 3/22 납기).',
    product_name: '아로마 오일', due_date: '2026-03-22',
  },
  {
    id: 'A-005', level: 'ok',
    title: '재고 정상', description: '립밤 재고 충분 (현재고: 1,200개). 추가 생산 불필요.',
    product_name: '립밤',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// SVG Icons (inline for zero-dependency)
// ─────────────────────────────────────────────────────────────────────────────
const SparkleIcon = () => (
  <svg className="w-4 h-4 text-violet-500" fill="currentColor" viewBox="0 0 24 24">
    <path d="M12 2L13.09 8.26L18 6L15.74 10.91L22 12L15.74 13.09L18 18L13.09 15.74L12 22L10.91 15.74L6 18L8.26 13.09L2 12L8.26 10.91L6 6L10.91 8.26L12 2Z" />
  </svg>
);

const CalendarIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
  </svg>
);

const PlusIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.5v15m7.5-7.5h-15" />
  </svg>
);

const TrashIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
  </svg>
);

const ShareIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z" />
  </svg>
);

const CheckIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.5 12.75l6 6 9-13.5" />
  </svg>
);

const XIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
  </svg>
);

const ExclamationIcon = () => (
  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
    <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.168 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
  </svg>
);

const CopyIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
  </svg>
);

const LoadingSpinner = ({ size = 'w-4 h-4' }: { size?: string }) => (
  <svg className={`${size} animate-spin`} fill="none" viewBox="0 0 24 24">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
  </svg>
);

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────
export default function ProductionPlanPage() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();

  // ── State ──────────────────────────────────────────────────────────────────
  const [plans, setPlans] = useState<ProductionPlan[]>([]);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('weekly');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [editingCell, setEditingCell] = useState<{ id: string; field: string } | null>(null);
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareEmail, setShareEmail] = useState('');
  const [shareMethod, setShareMethod] = useState<'sms' | 'kakao' | 'email'>('email');
  const [shareSending, setShareSending] = useState(false);
  const [shareSuccess, setShareSuccess] = useState(false);
  const [copiedShare, setCopiedShare] = useState(false);
  const [aiLoadingIds, setAiLoadingIds] = useState<Set<string>>(new Set());
  const [aiRecommendations, setAiRecommendations] = useState<Record<string, AIRecommendation>>({});
  const [showAiPanel, setShowAiPanel] = useState<string | null>(null);
  const [bulkAiLoading, setBulkAiLoading] = useState(false);
  const [autocompleteOpen, setAutocompleteOpen] = useState<string | null>(null);
  const [autocompleteFilter, setAutocompleteFilter] = useState('');
  const [alertsExpanded, setAlertsExpanded] = useState(true);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const autocompleteRef = useRef<HTMLDivElement>(null);

  // ── Init dates ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const today = new Date();
    if (viewMode === 'weekly') {
      const w = getWeekDates(today);
      setStartDate(w.start);
      setEndDate(w.end);
    } else {
      const d = formatDate(today);
      setStartDate(d);
      setEndDate(d);
    }
  }, [viewMode]);

  // ── Fetch data ─────────────────────────────────────────────────────────────
  const fetchPlans = useCallback(async () => {
    if (!startDate || !endDate) return;
    setLoading(true);
    try {
      const data = await fetchSafe<ProductionPlan[]>(
        `/api/scm/production-plans-v2?start_date=${startDate}&end_date=${endDate}`,
        []
      );
      if (data.length > 0) {
        setPlans(data);
      } else {
        setPlans(generateSamplePlans());
      }
    } catch {
      setPlans(generateSamplePlans());
    }
    setAlerts(generateSampleAlerts());
    setLoading(false);
  }, [startDate, endDate]);

  useEffect(() => {
    fetchPlans();
  }, [fetchPlans]);

  // ── Auth redirect ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!authLoading && !user) router.push('/login');
  }, [authLoading, user, router]);

  // ── Click outside autocomplete ─────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (autocompleteRef.current && !autocompleteRef.current.contains(e.target as Node)) {
        setAutocompleteOpen(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── Calculations ───────────────────────────────────────────────────────────
  const recalculate = useCallback((plan: ProductionPlan): ProductionPlan => {
    const rate = plan.avg_hourly_rate || 1;
    const hours = plan.planned_qty / rate;
    return {
      ...plan,
      required_hours: Math.round(hours * 100) / 100,
      required_manpower: Math.ceil(hours / 8),
    };
  }, []);

  const updatePlan = useCallback((id: string, updates: Partial<ProductionPlan>) => {
    setPlans(prev => prev.map(p => {
      if (p.id !== id) return p;
      const updated = { ...p, ...updates };
      if ('planned_qty' in updates || 'avg_hourly_rate' in updates) {
        return recalculate(updated);
      }
      return updated;
    }));
  }, [recalculate]);

  const savePlan = useCallback(async (plan: ProductionPlan) => {
    if (plan.id.startsWith('NEW-')) {
      const result = await postApi<ProductionPlan>('/api/scm/production-plans-v2', plan, plan);
      if (result.id && result.id !== plan.id) {
        setPlans(prev => prev.map(p => p.id === plan.id ? result : p));
      }
    } else {
      await putApi(`/api/scm/production-plans-v2/${plan.id}`, plan, plan);
    }
  }, []);

  const deletePlan = useCallback(async (id: string) => {
    await deleteApi(`/api/scm/production-plans-v2/${id}`);
    setPlans(prev => prev.filter(p => p.id !== id));
    setDeleteConfirm(null);
  }, []);

  const addNewPlan = useCallback(() => {
    const newId = `NEW-${Date.now()}`;
    const newPlan: ProductionPlan = {
      id: newId,
      plan_date: startDate,
      product_name: '',
      product_code: '',
      planned_qty: 0,
      avg_hourly_rate: 0,
      required_hours: 0,
      required_manpower: 0,
      order_plan_qty: 0,
      safety_stock_deficit: 0,
      ai_recommended_qty: null,
      status: '초안',
      notes: '',
    };
    setPlans(prev => [...prev, newPlan]);
    setEditingCell({ id: newId, field: 'product_name' });
  }, [startDate]);

  // ── AI Recommendation ─────────────────────────────────────────────────────
  const fetchAiRecommendation = useCallback(async (plan: ProductionPlan) => {
    setAiLoadingIds(prev => new Set(prev).add(plan.id));
    try {
      const rec = await postApi<AIRecommendation>(
        '/api/scm/production-plans-v2/ai-recommend',
        { product_name: plan.product_name, plan_date: plan.plan_date },
        {
          recommended_qty: Math.round((plan.order_plan_qty + plan.safety_stock_deficit) * 1.1),
          safety_stock_deficit: plan.safety_stock_deficit,
          order_plan_qty: plan.order_plan_qty,
          avg_hourly_rate: plan.avg_hourly_rate || 50,
          required_hours: 0,
          required_manpower: 0,
          explanation: '',
        }
      );
      if (!rec.explanation) {
        rec.required_hours = Math.round((rec.recommended_qty / (rec.avg_hourly_rate || 1)) * 100) / 100;
        rec.required_manpower = Math.ceil(rec.required_hours / 8);
        rec.explanation = `안전재고 부족분: ${rec.safety_stock_deficit.toLocaleString('ko-KR')}개, 주문계획 수량: ${rec.order_plan_qty.toLocaleString('ko-KR')}개 → 추천: ${rec.recommended_qty.toLocaleString('ko-KR')}개\n과거 평균 시간당 생산량: ${rec.avg_hourly_rate.toLocaleString('ko-KR')}개/시 → 필요시간: ${rec.required_hours}시간, 필요인력: ${rec.required_manpower}명`;
      }
      setAiRecommendations(prev => ({ ...prev, [plan.id]: rec }));
      setShowAiPanel(plan.id);
    } catch {
      // silent fail
    }
    setAiLoadingIds(prev => {
      const next = new Set(prev);
      next.delete(plan.id);
      return next;
    });
  }, []);

  const acceptAiRecommendation = useCallback((planId: string) => {
    const rec = aiRecommendations[planId];
    if (!rec) return;
    updatePlan(planId, {
      planned_qty: rec.recommended_qty,
      avg_hourly_rate: rec.avg_hourly_rate,
      ai_recommended_qty: rec.recommended_qty,
    });
    setShowAiPanel(null);
  }, [aiRecommendations, updatePlan]);

  const bulkAiRecommend = useCallback(async () => {
    const eligible = plans.filter(p => p.product_name && (p.status === '초안' || p.status === '확정'));
    if (eligible.length === 0) return;
    setBulkAiLoading(true);
    for (const plan of eligible) {
      await fetchAiRecommendation(plan);
    }
    setBulkAiLoading(false);
  }, [plans, fetchAiRecommendation]);

  // ── Share ──────────────────────────────────────────────────────────────────
  const generateShareText = useMemo(() => {
    const lines: string[] = [
      `[생산 계획] ${startDate} ~ ${endDate}`,
      '─'.repeat(40),
    ];
    plans.forEach(p => {
      lines.push(`${p.plan_date} | ${p.product_name} (${p.product_code})`);
      lines.push(`  계획: ${p.planned_qty.toLocaleString('ko-KR')}개 | 필요시간: ${p.required_hours}h | 인력: ${p.required_manpower}명 | 상태: ${p.status}`);
      if (p.notes) lines.push(`  비고: ${p.notes}`);
    });
    lines.push('─'.repeat(40));
    const totalQty = plans.reduce((s, p) => s + p.planned_qty, 0);
    const totalHours = plans.reduce((s, p) => s + p.required_hours, 0);
    const totalManpower = Math.max(...plans.map(p => p.required_manpower), 0);
    lines.push(`합계: ${totalQty.toLocaleString('ko-KR')}개 / ${Math.round(totalHours * 100) / 100}시간 / 최대 ${totalManpower}명`);
    return lines.join('\n');
  }, [plans, startDate, endDate]);

  const handleShare = useCallback(async () => {
    setShareSending(true);
    try {
      await postApi('/api/scm/production-plans-v2/share', {
        method: shareMethod,
        email: shareMethod === 'email' ? shareEmail : undefined,
        start_date: startDate,
        end_date: endDate,
        plans: plans.map(p => ({
          plan_date: p.plan_date,
          product_name: p.product_name,
          planned_qty: p.planned_qty,
          status: p.status,
        })),
        summary_text: generateShareText,
      }, { success: true });
      setShareSuccess(true);
      setTimeout(() => setShareSuccess(false), 3000);
    } catch {
      // silent
    }
    setShareSending(false);
  }, [shareMethod, shareEmail, startDate, endDate, plans, generateShareText]);

  const copyShareText = useCallback(() => {
    navigator.clipboard.writeText(generateShareText).then(() => {
      setCopiedShare(true);
      setTimeout(() => setCopiedShare(false), 2000);
    });
  }, [generateShareText]);

  // ── Summary cards ──────────────────────────────────────────────────────────
  const summary = useMemo(() => {
    const totalQty = plans.reduce((s, p) => s + p.planned_qty, 0);
    const totalHours = plans.reduce((s, p) => s + p.required_hours, 0);
    const maxManpower = plans.reduce((s, p) => s + p.required_manpower, 0);
    const pendingAi = plans.filter(p => p.ai_recommended_qty === null && p.product_name).length;
    return { totalQty, totalHours: Math.round(totalHours * 100) / 100, maxManpower, pendingAi };
  }, [plans]);

  // ── Sorted plans ───────────────────────────────────────────────────────────
  const sortedPlans = useMemo(() => {
    return [...plans].sort((a, b) => {
      if (a.plan_date !== b.plan_date) return a.plan_date.localeCompare(b.plan_date);
      return a.product_name.localeCompare(b.product_name);
    });
  }, [plans]);

  // ── Date navigation ────────────────────────────────────────────────────────
  const navigateDate = useCallback((direction: -1 | 1) => {
    const s = new Date(startDate);
    const e = new Date(endDate);
    if (viewMode === 'weekly') {
      s.setDate(s.getDate() + direction * 7);
      e.setDate(e.getDate() + direction * 7);
    } else {
      s.setDate(s.getDate() + direction);
      e.setDate(e.getDate() + direction);
    }
    setStartDate(formatDate(s));
    setEndDate(formatDate(e));
  }, [startDate, endDate, viewMode]);

  const goToToday = useCallback(() => {
    const today = new Date();
    if (viewMode === 'weekly') {
      const w = getWeekDates(today);
      setStartDate(w.start);
      setEndDate(w.end);
    } else {
      const d = formatDate(today);
      setStartDate(d);
      setEndDate(d);
    }
  }, [viewMode]);

  // ── Filtered autocomplete products ─────────────────────────────────────────
  const filteredProducts = useMemo(() => {
    if (!autocompleteFilter) return PRODUCT_CATALOG;
    return PRODUCT_CATALOG.filter(p =>
      p.name.includes(autocompleteFilter) || p.code.toLowerCase().includes(autocompleteFilter.toLowerCase())
    );
  }, [autocompleteFilter]);

  // ── Render ─────────────────────────────────────────────────────────────────
  if (authLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <LoadingSpinner size="w-8 h-8" />
      </div>
    );
  }

  const alertCounts = {
    urgent: alerts.filter(a => a.level === 'urgent').length,
    warning: alerts.filter(a => a.level === 'warning').length,
    ok: alerts.filter(a => a.level === 'ok').length,
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />
      <main className="md:ml-56 min-h-screen">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-6 space-y-6">

          {/* ── Page Header ──────────────────────────────────────────────── */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">생산 계획</h1>
              <p className="text-sm text-gray-500 mt-1">일별/주별 생산 계획 수립 및 AI 추천 기반 최적화</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowShareModal(true)}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                <ShareIcon /> 공유
              </button>
              <button
                onClick={bulkAiRecommend}
                disabled={bulkAiLoading}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-violet-700 bg-violet-50 border border-violet-200 rounded-lg hover:bg-violet-100 transition-colors disabled:opacity-50"
              >
                {bulkAiLoading ? <LoadingSpinner /> : <SparkleIcon />}
                AI 일괄 추천
              </button>
              <button
                onClick={addNewPlan}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
              >
                <PlusIcon /> 계획 추가
              </button>
            </div>
          </div>

          {/* ── Alert Section ────────────────────────────────────────────── */}
          {alerts.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <button
                onClick={() => setAlertsExpanded(!alertsExpanded)}
                className="w-full flex items-center justify-between px-5 py-3 hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <ExclamationIcon />
                  <span className="font-semibold text-gray-800 text-sm">알림</span>
                  <div className="flex items-center gap-2">
                    {alertCounts.urgent > 0 && (
                      <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium bg-red-100 text-red-700 rounded-full">
                        긴급 {alertCounts.urgent}
                      </span>
                    )}
                    {alertCounts.warning > 0 && (
                      <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-700 rounded-full">
                        주의 {alertCounts.warning}
                      </span>
                    )}
                    {alertCounts.ok > 0 && (
                      <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium bg-emerald-100 text-emerald-700 rounded-full">
                        정상 {alertCounts.ok}
                      </span>
                    )}
                  </div>
                </div>
                <svg
                  className={`w-5 h-5 text-gray-400 transition-transform ${alertsExpanded ? 'rotate-180' : ''}`}
                  fill="none" stroke="currentColor" viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {alertsExpanded && (
                <div className="px-5 pb-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {alerts.map(alert => {
                    const colorMap = {
                      urgent: 'border-red-200 bg-red-50',
                      warning: 'border-amber-200 bg-amber-50',
                      ok: 'border-emerald-200 bg-emerald-50',
                    };
                    const textMap = {
                      urgent: 'text-red-800',
                      warning: 'text-amber-800',
                      ok: 'text-emerald-800',
                    };
                    const dotMap = {
                      urgent: 'bg-red-500',
                      warning: 'bg-amber-500',
                      ok: 'bg-emerald-500',
                    };
                    return (
                      <div
                        key={alert.id}
                        className={`rounded-lg border p-3 ${colorMap[alert.level]}`}
                      >
                        <div className="flex items-start gap-2">
                          <span className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${dotMap[alert.level]}`} />
                          <div className="min-w-0">
                            <p className={`text-sm font-semibold ${textMap[alert.level]}`}>{alert.title}</p>
                            <p className={`text-xs mt-0.5 ${textMap[alert.level]} opacity-80`}>{alert.description}</p>
                            {alert.due_date && (
                              <p className={`text-xs mt-1 font-medium ${textMap[alert.level]}`}>납기: {alert.due_date}</p>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── Summary Cards ────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">총 계획 생산량</p>
              <p className="text-2xl font-bold text-gray-900 mt-2">{summary.totalQty.toLocaleString('ko-KR')}<span className="text-sm font-normal text-gray-400 ml-1">개</span></p>
              <p className="text-xs text-gray-400 mt-1">{plans.length}개 품목</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">총 필요 시간</p>
              <p className="text-2xl font-bold text-gray-900 mt-2">{summary.totalHours.toLocaleString('ko-KR')}<span className="text-sm font-normal text-gray-400 ml-1">시간</span></p>
              <p className="text-xs text-gray-400 mt-1">{Math.round(summary.totalHours / 8 * 10) / 10}일 (8h/일 기준)</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">총 필요 인력</p>
              <p className="text-2xl font-bold text-gray-900 mt-2">{summary.maxManpower}<span className="text-sm font-normal text-gray-400 ml-1">명</span></p>
              <p className="text-xs text-gray-400 mt-1">전 품목 합산</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">AI 추천 대기</p>
              <p className="text-2xl font-bold text-violet-600 mt-2">{summary.pendingAi}<span className="text-sm font-normal text-gray-400 ml-1">건</span></p>
              <p className="text-xs text-gray-400 mt-1">추천 미생성 품목</p>
            </div>
          </div>

          {/* ── Date Selector & View Toggle ──────────────────────────────── */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-5 py-3">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <CalendarIcon />
                <button
                  onClick={() => navigateDate(-1)}
                  className="p-1.5 rounded-md hover:bg-gray-100 transition-colors"
                  title="이전"
                >
                  <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    value={startDate}
                    onChange={e => setStartDate(e.target.value)}
                    className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  />
                  {viewMode === 'weekly' && (
                    <>
                      <span className="text-gray-400 text-sm">~</span>
                      <input
                        type="date"
                        value={endDate}
                        onChange={e => setEndDate(e.target.value)}
                        className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                      />
                    </>
                  )}
                </div>
                <button
                  onClick={() => navigateDate(1)}
                  className="p-1.5 rounded-md hover:bg-gray-100 transition-colors"
                  title="다음"
                >
                  <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
                <button
                  onClick={goToToday}
                  className="text-xs font-medium text-blue-600 hover:text-blue-800 px-2 py-1 rounded hover:bg-blue-50 transition-colors"
                >
                  오늘
                </button>
              </div>
              <div className="flex items-center bg-gray-100 rounded-lg p-0.5">
                <button
                  onClick={() => setViewMode('daily')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    viewMode === 'daily' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  일별
                </button>
                <button
                  onClick={() => setViewMode('weekly')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    viewMode === 'weekly' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  주별
                </button>
              </div>
            </div>
          </div>

          {/* ── Production Plan Table ────────────────────────────────────── */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="px-3 py-3 text-left font-semibold text-gray-600 text-xs whitespace-nowrap">계획일</th>
                    <th className="px-3 py-3 text-left font-semibold text-gray-600 text-xs whitespace-nowrap">품명</th>
                    <th className="px-3 py-3 text-left font-semibold text-gray-600 text-xs whitespace-nowrap">품목코드</th>
                    <th className="px-3 py-3 text-right font-semibold text-gray-600 text-xs whitespace-nowrap">계획 생산량</th>
                    <th className="px-3 py-3 text-right font-semibold text-gray-600 text-xs whitespace-nowrap bg-blue-50/50">시간당 생산량</th>
                    <th className="px-3 py-3 text-right font-semibold text-gray-600 text-xs whitespace-nowrap bg-blue-50/50">필요 시간</th>
                    <th className="px-3 py-3 text-right font-semibold text-gray-600 text-xs whitespace-nowrap bg-blue-50/50">필요 인력</th>
                    <th className="px-3 py-3 text-right font-semibold text-gray-600 text-xs whitespace-nowrap bg-gray-100/80">주문계획 수량</th>
                    <th className="px-3 py-3 text-right font-semibold text-gray-600 text-xs whitespace-nowrap bg-gray-100/80">안전재고 부족분</th>
                    <th className="px-3 py-3 text-right font-semibold text-gray-600 text-xs whitespace-nowrap">
                      <span className="inline-flex items-center gap-1"><SparkleIcon /> AI 추천량</span>
                    </th>
                    <th className="px-3 py-3 text-center font-semibold text-gray-600 text-xs whitespace-nowrap">상태</th>
                    <th className="px-3 py-3 text-left font-semibold text-gray-600 text-xs whitespace-nowrap">비고</th>
                    <th className="px-3 py-3 text-center font-semibold text-gray-600 text-xs whitespace-nowrap">액션</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {loading ? (
                    <tr>
                      <td colSpan={13} className="px-4 py-16 text-center">
                        <div className="flex flex-col items-center gap-2">
                          <LoadingSpinner size="w-6 h-6" />
                          <span className="text-sm text-gray-400">데이터를 불러오는 중...</span>
                        </div>
                      </td>
                    </tr>
                  ) : sortedPlans.length === 0 ? (
                    <tr>
                      <td colSpan={13} className="px-4 py-16 text-center">
                        <div className="flex flex-col items-center gap-2">
                          <CalendarIcon />
                          <p className="text-sm text-gray-500">해당 기간에 생산 계획이 없습니다.</p>
                          <button
                            onClick={addNewPlan}
                            className="mt-2 inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 font-medium"
                          >
                            <PlusIcon /> 새 계획 추가
                          </button>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    sortedPlans.map((plan) => {
                      const isEditing = (field: string) =>
                        editingCell?.id === plan.id && editingCell?.field === field;
                      const statusCfg = STATUS_CONFIG[plan.status];

                      return (
                        <tr key={plan.id} className="hover:bg-gray-50/50 transition-colors group">
                          {/* 계획일 */}
                          <td className="px-3 py-2.5 whitespace-nowrap">
                            {isEditing('plan_date') ? (
                              <input
                                type="date"
                                value={plan.plan_date}
                                onChange={e => updatePlan(plan.id, { plan_date: e.target.value })}
                                onBlur={() => { setEditingCell(null); savePlan(plan); }}
                                autoFocus
                                className="w-32 text-sm border border-blue-400 rounded px-2 py-1 focus:ring-2 focus:ring-blue-500 outline-none"
                              />
                            ) : (
                              <button
                                onClick={() => setEditingCell({ id: plan.id, field: 'plan_date' })}
                                className="text-sm text-gray-700 hover:text-blue-600 font-medium"
                              >
                                {plan.plan_date}
                              </button>
                            )}
                          </td>

                          {/* 품명 (with autocomplete) */}
                          <td className="px-3 py-2.5 whitespace-nowrap relative" ref={autocompleteOpen === plan.id ? autocompleteRef as React.RefObject<HTMLTableCellElement> : undefined}>
                            {isEditing('product_name') ? (
                              <div className="relative">
                                <input
                                  type="text"
                                  value={plan.product_name}
                                  onChange={e => {
                                    updatePlan(plan.id, { product_name: e.target.value });
                                    setAutocompleteFilter(e.target.value);
                                    setAutocompleteOpen(plan.id);
                                  }}
                                  onFocus={() => {
                                    setAutocompleteFilter(plan.product_name);
                                    setAutocompleteOpen(plan.id);
                                  }}
                                  onBlur={() => {
                                    setTimeout(() => {
                                      setEditingCell(null);
                                      setAutocompleteOpen(null);
                                      savePlan(plan);
                                    }, 200);
                                  }}
                                  placeholder="제품명 입력..."
                                  autoFocus
                                  className="w-36 text-sm border border-blue-400 rounded px-2 py-1 focus:ring-2 focus:ring-blue-500 outline-none"
                                />
                                {autocompleteOpen === plan.id && filteredProducts.length > 0 && (
                                  <div className="absolute z-50 top-full left-0 mt-1 w-56 bg-white rounded-lg shadow-lg border border-gray-200 max-h-48 overflow-y-auto">
                                    {filteredProducts.map(product => (
                                      <button
                                        key={product.code}
                                        onMouseDown={e => {
                                          e.preventDefault();
                                          updatePlan(plan.id, {
                                            product_name: product.name,
                                            product_code: product.code,
                                          });
                                          setAutocompleteOpen(null);
                                          setEditingCell(null);
                                        }}
                                        className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 flex items-center justify-between"
                                      >
                                        <span className="font-medium text-gray-800">{product.name}</span>
                                        <span className="text-xs text-gray-400">{product.code}</span>
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <button
                                onClick={() => setEditingCell({ id: plan.id, field: 'product_name' })}
                                className="text-sm text-gray-800 hover:text-blue-600 font-medium"
                              >
                                {plan.product_name || <span className="text-gray-300 italic">미입력</span>}
                              </button>
                            )}
                          </td>

                          {/* 품목코드 */}
                          <td className="px-3 py-2.5 whitespace-nowrap">
                            <span className="text-xs text-gray-500 font-mono bg-gray-50 px-1.5 py-0.5 rounded">
                              {plan.product_code || '-'}
                            </span>
                          </td>

                          {/* 계획 생산량 */}
                          <td className="px-3 py-2.5 text-right whitespace-nowrap">
                            {isEditing('planned_qty') ? (
                              <input
                                type="number"
                                value={plan.planned_qty || ''}
                                onChange={e => updatePlan(plan.id, { planned_qty: Number(e.target.value) || 0 })}
                                onBlur={() => { setEditingCell(null); savePlan(plan); }}
                                onKeyDown={e => { if (e.key === 'Enter') { setEditingCell(null); savePlan(plan); } }}
                                autoFocus
                                className="w-24 text-sm text-right border border-blue-400 rounded px-2 py-1 focus:ring-2 focus:ring-blue-500 outline-none"
                              />
                            ) : (
                              <button
                                onClick={() => setEditingCell({ id: plan.id, field: 'planned_qty' })}
                                className="text-sm font-semibold text-gray-900 hover:text-blue-600"
                              >
                                {plan.planned_qty.toLocaleString('ko-KR')}
                              </button>
                            )}
                          </td>

                          {/* 시간당 생산량 (auto-filled, light blue bg) */}
                          <td className="px-3 py-2.5 text-right whitespace-nowrap bg-blue-50/30">
                            {isEditing('avg_hourly_rate') ? (
                              <input
                                type="number"
                                value={plan.avg_hourly_rate || ''}
                                onChange={e => updatePlan(plan.id, { avg_hourly_rate: Number(e.target.value) || 0 })}
                                onBlur={() => { setEditingCell(null); savePlan(plan); }}
                                onKeyDown={e => { if (e.key === 'Enter') { setEditingCell(null); savePlan(plan); } }}
                                autoFocus
                                className="w-20 text-sm text-right border border-blue-400 rounded px-2 py-1 focus:ring-2 focus:ring-blue-500 outline-none"
                              />
                            ) : (
                              <button
                                onClick={() => setEditingCell({ id: plan.id, field: 'avg_hourly_rate' })}
                                className="text-sm text-gray-600 hover:text-blue-600"
                              >
                                {plan.avg_hourly_rate.toLocaleString('ko-KR')}<span className="text-xs text-gray-400">개/시</span>
                              </button>
                            )}
                          </td>

                          {/* 필요 시간 (auto-calculated) */}
                          <td className="px-3 py-2.5 text-right whitespace-nowrap bg-blue-50/30">
                            <span className="text-sm text-gray-600">
                              {plan.required_hours.toLocaleString('ko-KR')}<span className="text-xs text-gray-400">h</span>
                            </span>
                          </td>

                          {/* 필요 인력 (auto-calculated) */}
                          <td className="px-3 py-2.5 text-right whitespace-nowrap bg-blue-50/30">
                            <span className="text-sm text-gray-600">
                              {plan.required_manpower.toLocaleString('ko-KR')}<span className="text-xs text-gray-400">명</span>
                            </span>
                          </td>

                          {/* 주문계획 수량 (read-only) */}
                          <td className="px-3 py-2.5 text-right whitespace-nowrap bg-gray-50/50">
                            <span className="text-sm text-gray-500">{plan.order_plan_qty.toLocaleString('ko-KR')}</span>
                          </td>

                          {/* 안전재고 부족분 (read-only) */}
                          <td className="px-3 py-2.5 text-right whitespace-nowrap bg-gray-50/50">
                            <span className={`text-sm ${plan.safety_stock_deficit > 0 ? 'text-red-600 font-semibold' : 'text-gray-500'}`}>
                              {plan.safety_stock_deficit > 0 ? `-${plan.safety_stock_deficit.toLocaleString('ko-KR')}` : '0'}
                            </span>
                          </td>

                          {/* AI 추천량 */}
                          <td className="px-3 py-2.5 text-right whitespace-nowrap">
                            <div className="flex items-center justify-end gap-1.5">
                              {plan.ai_recommended_qty !== null ? (
                                <span className="inline-flex items-center gap-1 text-sm text-violet-700 font-semibold bg-violet-50 px-2 py-0.5 rounded-md">
                                  <SparkleIcon />
                                  {plan.ai_recommended_qty.toLocaleString('ko-KR')}
                                </span>
                              ) : (
                                <button
                                  onClick={() => fetchAiRecommendation(plan)}
                                  disabled={aiLoadingIds.has(plan.id) || !plan.product_name}
                                  className="inline-flex items-center gap-1 text-xs text-violet-600 hover:text-violet-800 bg-violet-50 hover:bg-violet-100 px-2 py-1 rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                  {aiLoadingIds.has(plan.id) ? <LoadingSpinner /> : <SparkleIcon />}
                                  AI 추천
                                </button>
                              )}
                            </div>
                          </td>

                          {/* 상태 */}
                          <td className="px-3 py-2.5 text-center whitespace-nowrap">
                            {isEditing('status') ? (
                              <select
                                value={plan.status}
                                onChange={e => {
                                  updatePlan(plan.id, { status: e.target.value as PlanStatus });
                                  setEditingCell(null);
                                  savePlan({ ...plan, status: e.target.value as PlanStatus });
                                }}
                                onBlur={() => setEditingCell(null)}
                                autoFocus
                                className="text-xs border border-blue-400 rounded px-2 py-1 focus:ring-2 focus:ring-blue-500 outline-none"
                              >
                                {STATUS_OPTIONS.map(s => (
                                  <option key={s} value={s}>{s}</option>
                                ))}
                              </select>
                            ) : (
                              <button
                                onClick={() => setEditingCell({ id: plan.id, field: 'status' })}
                                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${statusCfg.bg} ${statusCfg.text}`}
                              >
                                <span className={`w-1.5 h-1.5 rounded-full ${statusCfg.dot}`} />
                                {plan.status}
                              </button>
                            )}
                          </td>

                          {/* 비고 */}
                          <td className="px-3 py-2.5 whitespace-nowrap max-w-[200px]">
                            {isEditing('notes') ? (
                              <input
                                type="text"
                                value={plan.notes}
                                onChange={e => updatePlan(plan.id, { notes: e.target.value })}
                                onBlur={() => { setEditingCell(null); savePlan(plan); }}
                                onKeyDown={e => { if (e.key === 'Enter') { setEditingCell(null); savePlan(plan); } }}
                                autoFocus
                                className="w-40 text-sm border border-blue-400 rounded px-2 py-1 focus:ring-2 focus:ring-blue-500 outline-none"
                              />
                            ) : (
                              <button
                                onClick={() => setEditingCell({ id: plan.id, field: 'notes' })}
                                className="text-sm text-gray-500 hover:text-blue-600 truncate block max-w-[180px]"
                                title={plan.notes}
                              >
                                {plan.notes || <span className="text-gray-300 italic">-</span>}
                              </button>
                            )}
                          </td>

                          {/* 액션 */}
                          <td className="px-3 py-2.5 text-center whitespace-nowrap">
                            <div className="flex items-center justify-center gap-1">
                              {/* AI recommendation detail button */}
                              {aiRecommendations[plan.id] && (
                                <button
                                  onClick={() => setShowAiPanel(showAiPanel === plan.id ? null : plan.id)}
                                  className="p-1.5 rounded-md hover:bg-violet-100 text-violet-500 transition-colors"
                                  title="AI 추천 상세"
                                >
                                  <SparkleIcon />
                                </button>
                              )}
                              {/* Delete */}
                              {deleteConfirm === plan.id ? (
                                <div className="flex items-center gap-1">
                                  <button
                                    onClick={() => deletePlan(plan.id)}
                                    className="p-1 rounded bg-red-100 text-red-600 hover:bg-red-200 transition-colors"
                                    title="삭제 확인"
                                  >
                                    <CheckIcon />
                                  </button>
                                  <button
                                    onClick={() => setDeleteConfirm(null)}
                                    className="p-1 rounded bg-gray-100 text-gray-500 hover:bg-gray-200 transition-colors"
                                    title="취소"
                                  >
                                    <XIcon />
                                  </button>
                                </div>
                              ) : (
                                <button
                                  onClick={() => setDeleteConfirm(plan.id)}
                                  className="p-1.5 rounded-md hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                                  title="삭제"
                                >
                                  <TrashIcon />
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

            {/* Add row button at bottom */}
            {!loading && (
              <div className="border-t border-gray-100 px-4 py-3">
                <button
                  onClick={addNewPlan}
                  className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-blue-600 font-medium transition-colors"
                >
                  <PlusIcon /> 행 추가
                </button>
              </div>
            )}
          </div>

          {/* ── AI Recommendation Panel (below table, slides open) ────────── */}
          {showAiPanel && aiRecommendations[showAiPanel] && (() => {
            const rec = aiRecommendations[showAiPanel];
            const planForPanel = plans.find(p => p.id === showAiPanel);
            return (
              <div className="bg-gradient-to-r from-violet-50 to-purple-50 rounded-xl border border-violet-200 shadow-sm p-5 animate-in slide-in-from-top">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-violet-100 flex items-center justify-center">
                      <SparkleIcon />
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900 text-sm">AI 추천 분석</h3>
                      <p className="text-xs text-gray-500">{planForPanel?.product_name} ({planForPanel?.plan_date})</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setShowAiPanel(null)}
                    className="p-1 rounded-md hover:bg-violet-100 text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    <XIcon />
                  </button>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
                  <div className="bg-white/80 rounded-lg p-3">
                    <p className="text-xs text-gray-500">추천 생산량</p>
                    <p className="text-lg font-bold text-violet-700">{rec.recommended_qty.toLocaleString('ko-KR')}<span className="text-xs font-normal text-gray-400">개</span></p>
                  </div>
                  <div className="bg-white/80 rounded-lg p-3">
                    <p className="text-xs text-gray-500">안전재고 부족분</p>
                    <p className="text-lg font-bold text-red-600">{rec.safety_stock_deficit.toLocaleString('ko-KR')}<span className="text-xs font-normal text-gray-400">개</span></p>
                  </div>
                  <div className="bg-white/80 rounded-lg p-3">
                    <p className="text-xs text-gray-500">주문계획 수량</p>
                    <p className="text-lg font-bold text-blue-600">{rec.order_plan_qty.toLocaleString('ko-KR')}<span className="text-xs font-normal text-gray-400">개</span></p>
                  </div>
                  <div className="bg-white/80 rounded-lg p-3">
                    <p className="text-xs text-gray-500">평균 시간당 생산량</p>
                    <p className="text-lg font-bold text-gray-800">{rec.avg_hourly_rate.toLocaleString('ko-KR')}<span className="text-xs font-normal text-gray-400">개/시</span></p>
                  </div>
                  <div className="bg-white/80 rounded-lg p-3">
                    <p className="text-xs text-gray-500">필요 시간</p>
                    <p className="text-lg font-bold text-gray-800">{rec.required_hours}<span className="text-xs font-normal text-gray-400">h</span></p>
                  </div>
                  <div className="bg-white/80 rounded-lg p-3">
                    <p className="text-xs text-gray-500">필요 인력</p>
                    <p className="text-lg font-bold text-gray-800">{rec.required_manpower}<span className="text-xs font-normal text-gray-400">명</span></p>
                  </div>
                </div>

                <div className="bg-white/60 rounded-lg p-3 mb-4">
                  <p className="text-xs font-medium text-gray-500 mb-1">AI 분석 설명</p>
                  <p className="text-sm text-gray-700 whitespace-pre-line">{rec.explanation}</p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => acceptAiRecommendation(showAiPanel)}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-violet-600 rounded-lg hover:bg-violet-700 transition-colors shadow-sm"
                  >
                    <CheckIcon /> 추천 적용
                  </button>
                  <button
                    onClick={() => setShowAiPanel(null)}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    수동 입력 유지
                  </button>
                </div>
              </div>
            );
          })()}

          {/* ── Share Modal ──────────────────────────────────────────────── */}
          {showShareModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              {/* Backdrop */}
              <div
                className="absolute inset-0 bg-black/40 backdrop-blur-sm"
                onClick={() => { setShowShareModal(false); setShareSuccess(false); }}
              />
              {/* Modal */}
              <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                  <h2 className="text-lg font-bold text-gray-900">생산 계획 공유</h2>
                  <button
                    onClick={() => { setShowShareModal(false); setShareSuccess(false); }}
                    className="p-1.5 rounded-md hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    <XIcon />
                  </button>
                </div>

                <div className="px-6 py-5 space-y-5">
                  {/* Share method */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">공유 방식</label>
                    <div className="grid grid-cols-3 gap-2">
                      {([
                        { key: 'sms' as const, label: 'SMS', icon: '💬' },
                        { key: 'kakao' as const, label: '카카오톡', icon: '💛' },
                        { key: 'email' as const, label: '이메일', icon: '📧' },
                      ]).map(m => (
                        <button
                          key={m.key}
                          onClick={() => setShareMethod(m.key)}
                          className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-medium transition-colors ${
                            shareMethod === m.key
                              ? 'border-blue-500 bg-blue-50 text-blue-700'
                              : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                          }`}
                        >
                          <span>{m.icon}</span> {m.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Email input */}
                  {shareMethod === 'email' && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1.5">받는 사람 이메일</label>
                      <input
                        type="email"
                        value={shareEmail}
                        onChange={e => setShareEmail(e.target.value)}
                        placeholder="example@company.com"
                        className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                      />
                    </div>
                  )}

                  {/* Preview */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="block text-sm font-medium text-gray-700">공유 내용 미리보기</label>
                      <button
                        onClick={copyShareText}
                        className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium"
                      >
                        <CopyIcon />
                        {copiedShare ? '복사됨!' : '복사'}
                      </button>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-3 max-h-48 overflow-y-auto">
                      <pre className="text-xs text-gray-700 whitespace-pre-wrap font-mono leading-relaxed">
                        {generateShareText}
                      </pre>
                    </div>
                  </div>

                  {shareSuccess && (
                    <div className="flex items-center gap-2 bg-emerald-50 text-emerald-700 rounded-lg p-3 text-sm">
                      <CheckIcon />
                      <span>공유가 완료되었습니다.</span>
                    </div>
                  )}
                </div>

                <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex justify-end gap-2">
                  <button
                    onClick={() => { setShowShareModal(false); setShareSuccess(false); }}
                    className="px-4 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    닫기
                  </button>
                  <button
                    onClick={handleShare}
                    disabled={shareSending || (shareMethod === 'email' && !shareEmail)}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {shareSending ? <LoadingSpinner /> : <ShareIcon />}
                    {shareSending ? '전송 중...' : '전송하기'}
                  </button>
                </div>
              </div>
            </div>
          )}

        </div>
      </main>
    </div>
  );
}
