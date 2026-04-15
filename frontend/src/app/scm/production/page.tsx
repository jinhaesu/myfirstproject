'use client';

import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Navigation } from '@/components/layout/Navigation';

// ─────────────────────────────────────────────────────────────────────────────
// API helpers (with 5s timeout via AbortController)
// ─────────────────────────────────────────────────────────────────────────────
const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';

const getAuthHeaders = (): Record<string, string> => {
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
};

const withTimeout = (ms: number): { signal: AbortSignal; clear: () => void } => {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, clear: () => clearTimeout(id) };
};

const fetchSafe = async <T,>(path: string, defaultValue: T): Promise<T> => {
  const { signal, clear } = withTimeout(5000);
  try {
    const res = await fetch(`${API_BASE}${path}`, { headers: getAuthHeaders(), signal });
    clear();
    if (!res.ok) throw new Error();
    return await res.json();
  } catch {
    clear();
    return defaultValue;
  }
};

const postApi = async <T,>(path: string, body: unknown, defaultValue: T): Promise<T> => {
  const { signal, clear } = withTimeout(5000);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(body),
      signal,
    });
    clear();
    if (!res.ok) throw new Error();
    return await res.json();
  } catch {
    clear();
    return defaultValue;
  }
};

const putApi = async <T,>(path: string, body: unknown, defaultValue: T): Promise<T> => {
  const { signal, clear } = withTimeout(5000);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(body),
      signal,
    });
    clear();
    if (!res.ok) throw new Error();
    return await res.json();
  } catch {
    clear();
    return defaultValue;
  }
};

const deleteApi = async (path: string): Promise<boolean> => {
  const { signal, clear } = withTimeout(5000);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
      signal,
    });
    clear();
    return res.ok;
  } catch {
    clear();
    return false;
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
type ViewMode = 'daily' | 'weekly';
type AlertLevel = 'urgent' | 'warning' | 'ok';
type ShiftType = '주간' | '야간';

interface ProductionPlan {
  id: string;
  date: string;           // 날짜
  manager: string;        // 담당자
  location: string;       // 생산 위치
  category: string;       // 품목류
  product_name: string;   // 품목명
  quantity: number;        // 생산량
  total_hours: number;     // 생산 투여 총 시간
  unit_price: number;      // 생산 단가
  total_value: number;     // 총 생산액 (auto: quantity x unit_price)
  deduction: number;       // 공제액
  cost: number;            // 원가
  total_cost: number;      // 원가 총액
  shift_type: string;      // 주간/야간 생산 구분
  _dirty?: boolean;
  _isNew?: boolean;
}

interface AlertItem {
  id: string;
  level: AlertLevel;
  title: string;
  description: string;
  product_name: string;
  due_date?: string;
}

interface ProductMaster {
  id: number;
  product_name: string;
  product_code: string;
  product_category: string;
  default_location: string;
  default_unit_price: number;
  default_cost: number;
  avg_hourly_rate: number;
  safety_stock: number;
}

interface AiRecommendationResult {
  plan_id: string;
  product_name: string;
  recommended_qty: number;
  explanation: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants & Helpers
// ─────────────────────────────────────────────────────────────────────────────
const MANAGERS = ['권선희', '김수현', '이동규', '박지영', '최민호'];
const LOCATIONS = ['1층', '2층', '3층'];
const CATEGORIES = ['마카롱', '케이크', '쿠키', '비누', '캔들'];
const SHIFT_TYPES: ShiftType[] = ['주간', '야간'];

const PRODUCTS: { name: string; category: string }[] = [
  { name: '널담 마카롱 복숭아 요거트 [50g]', category: '마카롱' },
  { name: '널담 마카롱 녹차브라우니 [50g]', category: '마카롱' },
  { name: '널담 마카롱 초코바닐라 [50g]', category: '마카롱' },
  { name: '널담 마카롱 얼그레이 [50g]', category: '마카롱' },
  { name: '생크림 케이크 딸기 [1호]', category: '케이크' },
  { name: '생크림 케이크 초코 [1호]', category: '케이크' },
  { name: '버터쿠키 오리지널 [200g]', category: '쿠키' },
  { name: '버터쿠키 아몬드 [200g]', category: '쿠키' },
  { name: '천연 수제비누 라벤더 [100g]', category: '비누' },
  { name: '천연 수제비누 로즈마리 [100g]', category: '비누' },
  { name: '소이캔들 바닐라 [220g]', category: '캔들' },
  { name: '소이캔들 시나몬 [220g]', category: '캔들' },
];

const COLUMN_HEADERS = [
  '날짜', '담당자', '생산 위치', '품목류', '품목명', '생산량',
  '생산 투여 총 시간', '생산 단가', '총 생산액', '공제액',
  '원가', '원가 총액', '주간/야간',
];

const COLUMN_KEYS: (keyof ProductionPlan)[] = [
  'date', 'manager', 'location', 'category', 'product_name', 'quantity',
  'total_hours', 'unit_price', 'total_value', 'deduction',
  'cost', 'total_cost', 'shift_type',
];

const NUMBER_FIELDS = new Set<string>([
  'quantity', 'total_hours', 'unit_price', 'total_value', 'deduction', 'cost', 'total_cost',
]);
const RIGHT_ALIGN_FIELDS = NUMBER_FIELDS;

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

const fmtNum = (n: number): string => n.toLocaleString('ko-KR');
const fmtNumDec = (n: number, dec = 1): string => n.toLocaleString('ko-KR', { minimumFractionDigits: dec, maximumFractionDigits: dec });

// ─────────────────────────────────────────────────────────────────────────────
// Sample data generators
// ─────────────────────────────────────────────────────────────────────────────
const generateSamplePlans = (startDate: string): ProductionPlan[] => {
  const base = new Date(startDate);
  const plans: ProductionPlan[] = [];
  const sampleRows = [
    { manager: '권선희', location: '2층', product: PRODUCTS[0], qty: 10220, hours: 57.5, unitPrice: 1200, deduction: 981120, cost: 290.1, shift: '주간' },
    { manager: '김수현', location: '1층', product: PRODUCTS[1], qty: 8500, hours: 42.0, unitPrice: 1200, deduction: 816000, cost: 285.3, shift: '주간' },
    { manager: '이동규', location: '3층', product: PRODUCTS[4], qty: 320, hours: 16.0, unitPrice: 15000, deduction: 384000, cost: 5200.0, shift: '야간' },
    { manager: '박지영', location: '2층', product: PRODUCTS[6], qty: 5000, hours: 25.0, unitPrice: 800, deduction: 320000, cost: 195.5, shift: '주간' },
    { manager: '최민호', location: '1층', product: PRODUCTS[8], qty: 1500, hours: 30.0, unitPrice: 3500, deduction: 420000, cost: 980.0, shift: '야간' },
    { manager: '권선희', location: '2층', product: PRODUCTS[2], qty: 9800, hours: 55.0, unitPrice: 1200, deduction: 940800, cost: 288.0, shift: '주간' },
    { manager: '김수현', location: '3층', product: PRODUCTS[10], qty: 600, hours: 12.0, unitPrice: 8500, deduction: 408000, cost: 3200.0, shift: '주간' },
    { manager: '이동규', location: '1층', product: PRODUCTS[7], qty: 4200, hours: 21.0, unitPrice: 900, deduction: 302400, cost: 210.5, shift: '야간' },
  ];

  sampleRows.forEach((row, i) => {
    const d = new Date(base);
    d.setDate(d.getDate() + Math.floor(i / 2));
    const totalValue = row.qty * row.unitPrice;
    const totalCost = Math.round(row.cost * row.qty);
    plans.push({
      id: `PP-${String(i + 1).padStart(3, '0')}`,
      date: formatDate(d),
      manager: row.manager,
      location: row.location,
      category: row.product.category,
      product_name: row.product.name,
      quantity: row.qty,
      total_hours: row.hours,
      unit_price: row.unitPrice,
      total_value: totalValue,
      deduction: row.deduction,
      cost: row.cost,
      total_cost: totalCost,
      shift_type: row.shift,
      _dirty: false,
      _isNew: false,
    });
  });
  return plans;
};

const generateSampleAlerts = (): AlertItem[] => [
  {
    id: 'A-001', level: 'urgent',
    title: '긴급 생산 필요',
    description: '널담 마카롱 복숭아 요거트 안전재고 부족 (부족분: 2,000개). 납기 임박.',
    product_name: '널담 마카롱 복숭아 요거트 [50g]', due_date: '2026-03-18',
  },
  {
    id: 'A-002', level: 'urgent',
    title: '납기 임박 주문',
    description: '생크림 케이크 딸기 150개 주문 (3/17 납기). 현 재고 부족.',
    product_name: '생크림 케이크 딸기 [1호]', due_date: '2026-03-17',
  },
  {
    id: 'A-003', level: 'warning',
    title: '안전재고 주의',
    description: '버터쿠키 오리지널 안전재고 하한선 근접 (현재고: 1,300개, 안전재고: 1,200개).',
    product_name: '버터쿠키 오리지널 [200g]',
  },
  {
    id: 'A-004', level: 'ok',
    title: '재고 정상',
    description: '소이캔들 바닐라 재고 충분 (현재고: 800개). 추가 생산 불필요.',
    product_name: '소이캔들 바닐라 [220g]',
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

const DownloadIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
  </svg>
);

const SaveIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z" />
  </svg>
);

const LoadingSpinner = ({ size = 'w-4 h-4' }: { size?: string }) => (
  <svg className={`${size} animate-spin`} fill="none" viewBox="0 0 24 24">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
  </svg>
);

// ─────────────────────────────────────────────────────────────────────────────
// Toast Component
// ─────────────────────────────────────────────────────────────────────────────
interface ToastMessage {
  id: number;
  text: string;
  type: 'success' | 'info' | 'error';
}

function ToastContainer({ toasts, onRemove }: { toasts: ToastMessage[]; onRemove: (id: number) => void }) {
  return (
    <div className="fixed bottom-6 right-6 z-[9999] flex flex-col gap-2">
      {toasts.map(t => (
        <div
          key={t.id}
          className={`flex items-center gap-3 px-5 py-3 rounded-lg shadow-[0px_7px_32px_rgba(0,0,0,0.35)] text-sm font-medium transition-all animate-slide-up
            ${t.type === 'success' ? 'bg-[#27A644] text-white' : ''}
            ${t.type === 'info' ? 'bg-[#5E6AD2] text-white' : ''}
            ${t.type === 'error' ? 'bg-[#EB5757] text-white' : ''}
          `}
        >
          <span>{t.text}</span>
          <button onClick={() => onRemove(t.id)} className="ml-2 opacity-70 hover:opacity-100">
            <XIcon />
          </button>
        </div>
      ))}
    </div>
  );
}

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
  const [alertsExpanded, setAlertsExpanded] = useState(true);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [bulkAiLoading, setBulkAiLoading] = useState(false);
  const [bulkAiProgress, setBulkAiProgress] = useState({ current: 0, total: 0 });
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [savingBulk, setSavingBulk] = useState(false);
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [productCatalog, setProductCatalog] = useState<ProductMaster[]>([]);
  const [productAutocomplete, setProductAutocomplete] = useState<{ planId: string; query: string; visible: boolean }>({ planId: '', query: '', visible: false });
  const [autoFilledPlans, setAutoFilledPlans] = useState<Set<string>>(new Set());
  const [aiRecommendations, setAiRecommendations] = useState<AiRecommendationResult[]>([]);
  const [aiExplanationsExpanded, setAiExplanationsExpanded] = useState(false);

  const tableContainerRef = useRef<HTMLDivElement>(null);
  const toastIdRef = useRef(0);
  const autocompleteRef = useRef<HTMLDivElement>(null);

  // ── Toast helper ──────────────────────────────────────────────────────────
  const addToast = useCallback((text: string, type: ToastMessage['type'] = 'info') => {
    const id = ++toastIdRef.current;
    setToasts(prev => [...prev, { id, text, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4000);
  }, []);

  const removeToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

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
        setPlans(data.map(p => ({ ...p, total_value: p.quantity * p.unit_price, _dirty: false, _isNew: false })));
      } else {
        setPlans(generateSamplePlans(startDate));
      }
    } catch {
      setPlans(generateSamplePlans(startDate));
    }
    setAlerts(generateSampleAlerts());
    setLoading(false);
  }, [startDate, endDate]);

  useEffect(() => {
    fetchPlans();
  }, [fetchPlans]);

  // ── Fetch product catalog ─────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const catalog = await fetchSafe<ProductMaster[]>('/api/scm/products?active_only=true', []);
      setProductCatalog(catalog);
    })();
  }, []);

  // ── Auth redirect ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!authLoading && !user) router.push('/login');
  }, [authLoading, user, router]);

  // ── Clipboard: Ctrl+C / Ctrl+V ─────────────────────────────────────────────
  useEffect(() => {
    const container = tableContainerRef.current;
    if (!container) return;

    const handlePaste = (e: ClipboardEvent) => {
      const text = e.clipboardData?.getData('text/plain');
      if (!text) return;

      const rows = text.split('\n').filter(r => r.trim().length > 0);
      const newPlans: ProductionPlan[] = [];

      for (const row of rows) {
        const cols = row.split('\t');
        if (cols.length < 5) continue; // skip rows with too few columns

        const qty = parseFloat(cols[5]) || 0;
        const unitPrice = parseFloat(cols[7]) || 0;

        const plan: ProductionPlan = {
          id: `NEW-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          date: cols[0]?.trim() || startDate,
          manager: cols[1]?.trim() || '',
          location: cols[2]?.trim() || '',
          category: cols[3]?.trim() || '',
          product_name: cols[4]?.trim() || '',
          quantity: qty,
          total_hours: parseFloat(cols[6]) || 0,
          unit_price: unitPrice,
          total_value: qty * unitPrice,
          deduction: parseFloat(cols[9]) || 0,
          cost: parseFloat(cols[10]) || 0,
          total_cost: parseFloat(cols[11]) || 0,
          shift_type: cols[12]?.trim() || '주간',
          _dirty: true,
          _isNew: true,
        };
        newPlans.push(plan);
      }

      if (newPlans.length > 0) {
        e.preventDefault();
        setPlans(prev => [...prev, ...newPlans]);
        addToast(`${newPlans.length}행이 붙여넣어졌습니다`, 'success');
      }
    };

    const handleCopy = (e: ClipboardEvent) => {
      // If user is editing a cell input, let the browser handle it
      const active = document.activeElement;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'SELECT' || active.tagName === 'TEXTAREA')) {
        return;
      }

      const rowsToCopy = selectedRows.size > 0
        ? plans.filter(p => selectedRows.has(p.id))
        : plans;

      if (rowsToCopy.length === 0) return;

      const tsv = rowsToCopy.map(p =>
        [p.date, p.manager, p.location, p.category, p.product_name,
          p.quantity, p.total_hours, p.unit_price, p.total_value,
          p.deduction, p.cost, p.total_cost, p.shift_type].join('\t')
      ).join('\n');

      e.preventDefault();
      e.clipboardData?.setData('text/plain', tsv);
      addToast(`${rowsToCopy.length}행이 복사되었습니다`, 'info');
    };

    container.addEventListener('paste', handlePaste);
    container.addEventListener('copy', handleCopy);
    return () => {
      container.removeEventListener('paste', handlePaste);
      container.removeEventListener('copy', handleCopy);
    };
  }, [plans, startDate, addToast, selectedRows]);

  // ── Calculations ───────────────────────────────────────────────────────────
  const updatePlan = useCallback((id: string, updates: Partial<ProductionPlan>) => {
    setPlans(prev => prev.map(p => {
      if (p.id !== id) return p;
      const updated = { ...p, ...updates, _dirty: true };
      // Auto-calculate total_value
      const qty = 'quantity' in updates ? (updates.quantity ?? p.quantity) : p.quantity;
      const price = 'unit_price' in updates ? (updates.unit_price ?? p.unit_price) : p.unit_price;
      updated.total_value = qty * price;
      updated.quantity = qty;
      updated.unit_price = price;
      return updated;
    }));
  }, []);

  // ── Product auto-fill from catalog ────────────────────────────────────────
  const handleProductSelect = useCallback((planId: string, selectedProduct: ProductMaster) => {
    updatePlan(planId, {
      product_name: selectedProduct.product_name,
      category: selectedProduct.product_category,
      location: selectedProduct.default_location,
      unit_price: selectedProduct.default_unit_price,
      cost: selectedProduct.default_cost,
    });
    setAutoFilledPlans(prev => new Set(prev).add(planId));
    setProductAutocomplete({ planId: '', query: '', visible: false });
    setEditingCell(null);
  }, [updatePlan]);

  const filteredProducts = useMemo(() => {
    if (!productAutocomplete.visible || !productAutocomplete.query) return [];
    const q = productAutocomplete.query.toLowerCase();
    return productCatalog.filter(p =>
      p.product_name.toLowerCase().includes(q) ||
      p.product_category.toLowerCase().includes(q) ||
      p.product_code.toLowerCase().includes(q)
    ).slice(0, 8);
  }, [productAutocomplete, productCatalog]);

  const addNewPlan = useCallback(() => {
    const newId = `NEW-${Date.now()}`;
    const newPlan: ProductionPlan = {
      id: newId,
      date: startDate,
      manager: '',
      location: '',
      category: '',
      product_name: '',
      quantity: 0,
      total_hours: 0,
      unit_price: 0,
      total_value: 0,
      deduction: 0,
      cost: 0,
      total_cost: 0,
      shift_type: '주간',
      _dirty: true,
      _isNew: true,
    };
    setPlans(prev => [...prev, newPlan]);
    setEditingCell({ id: newId, field: 'date' });
  }, [startDate]);

  const deletePlan = useCallback(async (id: string) => {
    if (!id.startsWith('NEW-')) {
      await deleteApi(`/api/scm/production-plans-v2/${id}`);
    }
    setPlans(prev => prev.filter(p => p.id !== id));
    setDeleteConfirm(null);
    addToast('행이 삭제되었습니다', 'info');
  }, [addToast]);

  // ── Save dirty rows (bulk) ────────────────────────────────────────────────
  const saveDirtyPlans = useCallback(async () => {
    const dirty = plans.filter(p => p._dirty);
    if (dirty.length === 0) {
      addToast('변경된 항목이 없습니다', 'info');
      return;
    }
    setSavingBulk(true);
    try {
      const payload = dirty.map(p => {
        const { _dirty, _isNew, ...rest } = p;
        return rest;
      });
      await postApi('/api/scm/production-plans-v2/bulk', { plans: payload }, { success: true });
      setPlans(prev => prev.map(p => ({ ...p, _dirty: false, _isNew: false })));
      addToast(`${dirty.length}개 항목이 저장되었습니다`, 'success');
    } catch {
      addToast('저장 중 오류가 발생했습니다', 'error');
    }
    setSavingBulk(false);
  }, [plans, addToast]);

  // ── AI Bulk Recommendation ────────────────────────────────────────────────
  const bulkAiRecommend = useCallback(async () => {
    const eligible = plans.filter(p => p.product_name);
    if (eligible.length === 0) {
      addToast('추천 대상 품목이 없습니다', 'info');
      return;
    }

    setBulkAiLoading(true);
    setBulkAiProgress({ current: 0, total: eligible.length });
    const recommendations: AiRecommendationResult[] = [];

    let completed = 0;
    for (const plan of eligible) {
      try {
        const rec = await postApi<{ recommended_qty: number; explanation?: string }>(
          '/api/scm/production-plans-v2/ai-recommend',
          { product_name: plan.product_name, date: plan.date },
          { recommended_qty: 0 }
        );

        let recommendedQty = rec.recommended_qty;
        let explanation = rec.explanation || '';

        if (!recommendedQty || recommendedQty === 0) {
          // Fallback: recommended qty = max(safety_stock_deficit, order_plan_qty) * 1.1
          recommendedQty = Math.round(plan.quantity * 1.1);

          // Find product in catalog for local explanation
          const catalogProduct = productCatalog.find(p => p.product_name === plan.product_name);
          const avgHourlyRate = catalogProduct?.avg_hourly_rate || (plan.total_hours > 0 ? Math.round(plan.quantity / plan.total_hours) : 0);
          const safetyStock = catalogProduct?.safety_stock || 0;
          const requiredHours = avgHourlyRate > 0 ? (recommendedQty / avgHourlyRate).toFixed(1) : '?';

          explanation = `[AI 추천 분석 - ${plan.product_name}]\n\n` +
            `1. 주문 계획 기반 수요: ${fmtNum(plan.quantity)}개\n` +
            `2. 안전재고 기반: 기준 ${fmtNum(safetyStock)}개\n` +
            `3. 추천 생산량: ${fmtNum(recommendedQty)}개\n` +
            `4. 시간당 생산량: ${avgHourlyRate}개/시 (생산 결과 누적)\n` +
            `5. 필요 시간: ${requiredHours}시간`;
        }

        // Auto-apply the recommendation to quantity
        setPlans(prev => prev.map(p => {
          if (p.id !== plan.id) return p;
          const updated = { ...p, quantity: recommendedQty, _dirty: true };
          updated.total_value = updated.quantity * updated.unit_price;
          return updated;
        }));

        recommendations.push({
          plan_id: plan.id,
          product_name: plan.product_name,
          recommended_qty: recommendedQty,
          explanation,
        });
      } catch {
        // silent continue
      }

      completed++;
      setBulkAiProgress({ current: completed, total: eligible.length });
    }

    setAiRecommendations(recommendations);
    setAiExplanationsExpanded(true);
    setBulkAiLoading(false);
    addToast(`AI 추천 완료: ${eligible.length}개 품목에 추천이 적용되었습니다`, 'success');
  }, [plans, addToast, productCatalog]);

  // ── Export CSV ─────────────────────────────────────────────────────────────
  const exportCsv = useCallback(() => {
    const header = COLUMN_HEADERS.join(',');
    const rows = plans.map(p =>
      [p.date, p.manager, p.location, p.category, `"${p.product_name}"`,
        p.quantity, p.total_hours, p.unit_price, p.total_value,
        p.deduction, p.cost, p.total_cost, p.shift_type].join(',')
    );
    const csv = '\uFEFF' + [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `생산계획_${startDate}_${endDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    addToast('CSV 파일이 다운로드되었습니다', 'success');
  }, [plans, startDate, endDate, addToast]);

  // ── Share ──────────────────────────────────────────────────────────────────
  const handleShare = useCallback(async () => {
    setShareSending(true);
    try {
      await postApi('/api/scm/production-plans-v2/share', {
        method: shareMethod,
        recipient: shareEmail,
        start_date: startDate,
        end_date: endDate,
      }, { success: true });
      setShareSuccess(true);
      setTimeout(() => {
        setShowShareModal(false);
        setShareSuccess(false);
        setShareEmail('');
      }, 1500);
    } catch {
      addToast('공유 중 오류가 발생했습니다', 'error');
    }
    setShareSending(false);
  }, [shareMethod, shareEmail, startDate, endDate, addToast]);

  // ── Date navigation ───────────────────────────────────────────────────────
  const navigateDate = useCallback((direction: -1 | 1) => {
    const base = new Date(startDate);
    if (viewMode === 'weekly') {
      base.setDate(base.getDate() + direction * 7);
      const w = getWeekDates(base);
      setStartDate(w.start);
      setEndDate(w.end);
    } else {
      base.setDate(base.getDate() + direction);
      const d = formatDate(base);
      setStartDate(d);
      setEndDate(d);
    }
  }, [startDate, viewMode]);

  // ── Summary calculations ──────────────────────────────────────────────────
  const summary = useMemo(() => {
    const totalQty = plans.reduce((s, p) => s + (p.quantity || 0), 0);
    const totalValue = plans.reduce((s, p) => s + (p.total_value || 0), 0);
    const totalHours = plans.reduce((s, p) => s + (p.total_hours || 0), 0);
    const aiPending = plans.filter(p => p.product_name && !p._dirty).length;
    return { totalQty, totalValue, totalHours, aiPending };
  }, [plans]);

  // ── Totals row ─────────────────────────────────────────────────────────────
  const totals = useMemo(() => ({
    quantity: plans.reduce((s, p) => s + (p.quantity || 0), 0),
    total_hours: plans.reduce((s, p) => s + (p.total_hours || 0), 0),
    unit_price: 0,
    total_value: plans.reduce((s, p) => s + (p.total_value || 0), 0),
    deduction: plans.reduce((s, p) => s + (p.deduction || 0), 0),
    cost: 0,
    total_cost: plans.reduce((s, p) => s + (p.total_cost || 0), 0),
  }), [plans]);

  const dirtyCount = useMemo(() => plans.filter(p => p._dirty).length, [plans]);

  // ── Render cell editor ────────────────────────────────────────────────────
  const renderEditableCell = (plan: ProductionPlan, field: keyof ProductionPlan, rowIdx: number) => {
    const isEditing = editingCell?.id === plan.id && editingCell?.field === field;
    const value = plan[field];
    const isNumber = NUMBER_FIELDS.has(field);
    const isRightAlign = RIGHT_ALIGN_FIELDS.has(field);
    const isAutoCalc = field === 'total_value';

    // Display value
    const displayValue = (() => {
      if (value === undefined || value === null || value === '') return '';
      if (field === 'total_value') return fmtNum(plan.quantity * plan.unit_price);
      if (isNumber && typeof value === 'number') {
        if (field === 'total_hours' || field === 'cost') return fmtNumDec(value);
        return fmtNum(value);
      }
      return String(value);
    })();

    if (isAutoCalc) {
      return (
        <td
          key={field}
          className={`px-2 py-1.5 border border-[#23252A] bg-[#08090A] text-right text-sm tabular-nums select-none`}
        >
          {displayValue}
        </td>
      );
    }

    if (isEditing) {
      // shift_type uses a select
      if (field === 'shift_type') {
        return (
          <td key={field} className="px-1 py-0.5 border border-[#5E6AD2]/50 bg-[#5E6AD2]/10">
            <select
              autoFocus
              className="w-full bg-transparent text-sm outline-none"
              value={String(value)}
              onChange={e => {
                updatePlan(plan.id, { [field]: e.target.value });
                setEditingCell(null);
              }}
              onBlur={() => setEditingCell(null)}
              onKeyDown={e => { if (e.key === 'Escape') setEditingCell(null); }}
            >
              {SHIFT_TYPES.map(st => <option key={st} value={st}>{st}</option>)}
            </select>
          </td>
        );
      }

      if (field === 'date') {
        return (
          <td key={field} className="px-1 py-0.5 border border-[#5E6AD2]/50 bg-[#5E6AD2]/10">
            <input
              type="date"
              autoFocus
              className="w-full bg-transparent text-sm outline-none"
              value={String(value)}
              onChange={e => updatePlan(plan.id, { [field]: e.target.value })}
              onBlur={() => setEditingCell(null)}
              onKeyDown={e => {
                if (e.key === 'Escape') setEditingCell(null);
                if (e.key === 'Enter') setEditingCell(null);
              }}
            />
          </td>
        );
      }

      // Special case: product_name with autocomplete
      if (field === 'product_name') {
        return (
          <td key={field} className="px-1 py-0.5 border border-[#5E6AD2]/50 bg-[#5E6AD2]/10 relative">
            <input
              type="text"
              autoFocus
              className="w-full bg-transparent text-sm outline-none"
              value={String(value ?? '')}
              onChange={e => {
                const val = e.target.value;
                updatePlan(plan.id, { product_name: val });
                setProductAutocomplete({ planId: plan.id, query: val, visible: val.length > 0 });
              }}
              onBlur={() => {
                // Delay to allow dropdown click
                setTimeout(() => {
                  setEditingCell(null);
                  setProductAutocomplete({ planId: '', query: '', visible: false });
                }, 200);
              }}
              onKeyDown={e => {
                if (e.key === 'Escape') {
                  setEditingCell(null);
                  setProductAutocomplete({ planId: '', query: '', visible: false });
                }
                if (e.key === 'Enter') {
                  setEditingCell(null);
                  setProductAutocomplete({ planId: '', query: '', visible: false });
                }
                if (e.key === 'Tab') {
                  e.preventDefault();
                  setProductAutocomplete({ planId: '', query: '', visible: false });
                  const currentIdx = COLUMN_KEYS.indexOf(field);
                  const nextIdx = e.shiftKey ? currentIdx - 1 : currentIdx + 1;
                  if (nextIdx >= 0 && nextIdx < COLUMN_KEYS.length) {
                    const nextField = COLUMN_KEYS[nextIdx];
                    if (nextField !== 'total_value') {
                      setEditingCell({ id: plan.id, field: nextField });
                    } else {
                      const skipIdx = e.shiftKey ? nextIdx - 1 : nextIdx + 1;
                      if (skipIdx >= 0 && skipIdx < COLUMN_KEYS.length) {
                        setEditingCell({ id: plan.id, field: COLUMN_KEYS[skipIdx] });
                      } else {
                        setEditingCell(null);
                      }
                    }
                  } else {
                    setEditingCell(null);
                  }
                }
              }}
            />
            {/* Autocomplete dropdown */}
            {productAutocomplete.visible && productAutocomplete.planId === plan.id && filteredProducts.length > 0 && (
              <div
                ref={autocompleteRef}
                className="absolute top-full left-0 z-50 w-[360px] mt-1 bg-[#0F1011] border border-[#23252A] rounded-lg shadow-[0px_7px_32px_rgba(0,0,0,0.35)] max-h-[240px] overflow-y-auto"
              >
                {filteredProducts.map(product => (
                  <button
                    key={product.id}
                    type="button"
                    className="w-full text-left px-3 py-2 hover:bg-[#5E6AD2]/10 transition-colors border-b border-[#23252A] last:border-b-0"
                    onMouseDown={e => {
                      e.preventDefault();
                      handleProductSelect(plan.id, product);
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-[#F7F8F8] truncate">{product.product_name}</span>
                      <span className="text-xs text-[#62666D] ml-2 shrink-0">{product.product_code}</span>
                    </div>
                    <div className="flex items-center gap-3 mt-0.5">
                      <span className="text-xs text-[#8A8F98]">{product.product_category}</span>
                      <span className="text-xs text-[#62666D]">|</span>
                      <span className="text-xs text-[#8A8F98]">{product.avg_hourly_rate}개/시</span>
                      <span className="text-xs text-[#62666D]">|</span>
                      <span className="text-xs text-[#8A8F98]">단가 {fmtNum(product.default_unit_price)}원</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </td>
        );
      }

      return (
        <td key={field} className="px-1 py-0.5 border border-[#5E6AD2]/50 bg-[#5E6AD2]/10">
          <input
            type={isNumber ? 'number' : 'text'}
            autoFocus
            className={`w-full bg-transparent text-sm outline-none ${isRightAlign ? 'text-right' : ''}`}
            value={isNumber ? (value === 0 ? '' : Number(value) || '') : String(value ?? '')}
            step={field === 'total_hours' || field === 'cost' ? '0.1' : '1'}
            onChange={e => {
              const val = isNumber ? (parseFloat(e.target.value) || 0) : e.target.value;
              updatePlan(plan.id, { [field]: val } as Partial<ProductionPlan>);
            }}
            onBlur={() => setEditingCell(null)}
            onKeyDown={e => {
              if (e.key === 'Escape') setEditingCell(null);
              if (e.key === 'Enter') {
                setEditingCell(null);
              }
              if (e.key === 'Tab') {
                e.preventDefault();
                const currentIdx = COLUMN_KEYS.indexOf(field);
                const nextIdx = e.shiftKey ? currentIdx - 1 : currentIdx + 1;
                if (nextIdx >= 0 && nextIdx < COLUMN_KEYS.length) {
                  const nextField = COLUMN_KEYS[nextIdx];
                  if (nextField !== 'total_value') {
                    setEditingCell({ id: plan.id, field: nextField });
                  } else {
                    // Skip total_value (auto-calc), go to next
                    const skipIdx = e.shiftKey ? nextIdx - 1 : nextIdx + 1;
                    if (skipIdx >= 0 && skipIdx < COLUMN_KEYS.length) {
                      setEditingCell({ id: plan.id, field: COLUMN_KEYS[skipIdx] });
                    } else {
                      setEditingCell(null);
                    }
                  }
                } else {
                  setEditingCell(null);
                }
              }
            }}
          />
        </td>
      );
    }

    // Non-editing display
    return (
      <td
        key={field}
        className={`px-2 py-1.5 border border-[#23252A] text-sm cursor-pointer hover:bg-[#5E6AD2]/10 transition-colors truncate max-w-[200px]
          ${isRightAlign ? 'text-right tabular-nums' : ''}
          ${plan._dirty ? 'bg-[#F0BF00]/10/40' : ''}
        `}
        title={String(displayValue)}
        onClick={() => setEditingCell({ id: plan.id, field })}
      >
        <span className="flex items-center gap-1">
          {displayValue || <span className="text-[#62666D]">-</span>}
          {field === 'product_name' && autoFilledPlans.has(plan.id) && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-[#27A644]/15 text-[#27A644] shrink-0" title="품목 관리에서 자동 입력됨">
              자동
            </span>
          )}
        </span>
      </td>
    );
  };

  // ── Auth guard ─────────────────────────────────────────────────────────────
  if (authLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#08090A]">
        <LoadingSpinner size="w-8 h-8" />
      </div>
    );
  }

  // ── Alerts section ─────────────────────────────────────────────────────────
  const urgentAlerts = alerts.filter(a => a.level === 'urgent');
  const warningAlerts = alerts.filter(a => a.level === 'warning');

  return (
    <div className="min-h-screen bg-[#08090A]">
      <Navigation />

      {/* Toast notifications */}
      <ToastContainer toasts={toasts} onRemove={removeToast} />

      <main className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* ── Page Header ─────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-[#F7F8F8]">생산 계획</h1>
            <p className="text-sm text-[#8A8F98] mt-1">생산일보 RAW-DATA 기반 생산 계획 관리</p>
          </div>
          <div className="flex items-center gap-2">
            {/* AI 일괄 추천 */}
            <button
              onClick={bulkAiRecommend}
              disabled={bulkAiLoading}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-violet-500 to-purple-600 text-white text-sm font-medium shadow-[0px_1px_3px_rgba(0,0,0,0.2)] hover:from-violet-600 hover:to-purple-700 disabled:opacity-60 disabled:cursor-not-allowed transition-all"
            >
              {bulkAiLoading ? (
                <>
                  <LoadingSpinner />
                  <span>AI 분석 중... ({bulkAiProgress.current}/{bulkAiProgress.total})</span>
                </>
              ) : (
                <>
                  <SparkleIcon />
                  <span>AI 일괄 추천</span>
                </>
              )}
            </button>

            {/* 저장 */}
            <button
              onClick={saveDirtyPlans}
              disabled={savingBulk || dirtyCount === 0}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#5E6AD2] text-white text-sm font-medium shadow-[0px_1px_3px_rgba(0,0,0,0.2)] hover:bg-[#828FFF] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {savingBulk ? <LoadingSpinner /> : <SaveIcon />}
              <span>저장{dirtyCount > 0 ? ` (${dirtyCount})` : ''}</span>
            </button>

            {/* 계획 추가 */}
            <button
              onClick={addNewPlan}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#27A644] text-white text-sm font-medium shadow-[0px_1px_3px_rgba(0,0,0,0.2)] hover:bg-[#1E8A3A] transition-colors"
            >
              <PlusIcon />
              <span>계획 추가</span>
            </button>

            {/* Export CSV */}
            <button
              onClick={exportCsv}
              className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[#23252A] bg-[#0F1011] text-[#D0D6E0] text-sm font-medium hover:bg-[#141516]/5 transition-colors"
            >
              <DownloadIcon />
              <span>CSV</span>
            </button>

            {/* 공유 */}
            <button
              onClick={() => setShowShareModal(true)}
              className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[#23252A] bg-[#0F1011] text-[#D0D6E0] text-sm font-medium hover:bg-[#141516]/5 transition-colors"
            >
              <ShareIcon />
              <span>공유</span>
            </button>
          </div>
        </div>

        {/* ── Alerts ──────────────────────────────────────────────────────── */}
        {(urgentAlerts.length > 0 || warningAlerts.length > 0) && (
          <div className="mb-4">
            <button
              onClick={() => setAlertsExpanded(!alertsExpanded)}
              className="flex items-center gap-2 text-sm font-medium text-[#D0D6E0] mb-2 hover:text-[#F7F8F8]"
            >
              <ExclamationIcon />
              <span>알림 ({urgentAlerts.length + warningAlerts.length}건)</span>
              <svg className={`w-4 h-4 transition-transform ${alertsExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {alertsExpanded && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {[...urgentAlerts, ...warningAlerts].map(alert => (
                  <div
                    key={alert.id}
                    className={`flex items-start gap-3 p-3 rounded-lg border ${
                      alert.level === 'urgent'
                        ? 'bg-[#EB5757]/10 border-[#EB5757]/30'
                        : 'bg-[#F0BF00]/10 border-[#F0BF00]/30'
                    }`}
                  >
                    <div className={`mt-0.5 ${alert.level === 'urgent' ? 'text-[#EB5757]' : 'text-amber-500'}`}>
                      <ExclamationIcon />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-semibold ${alert.level === 'urgent' ? 'text-[#EB5757]' : 'text-amber-800'}`}>
                        {alert.title}
                      </p>
                      <p className={`text-xs mt-0.5 ${alert.level === 'urgent' ? 'text-[#EB5757]' : 'text-[#F0BF00]'}`}>
                        {alert.description}
                      </p>
                      {alert.due_date && (
                        <p className="text-xs text-[#8A8F98] mt-1">납기: {alert.due_date}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Summary Cards ───────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-[#0F1011] rounded-xl border border-[#23252A] p-4 shadow-[0px_1px_3px_rgba(0,0,0,0.2)]">
            <p className="text-xs text-[#8A8F98] font-medium uppercase tracking-wide">총 생산량</p>
            <p className="text-2xl font-bold text-[#F7F8F8] mt-1">{fmtNum(summary.totalQty)}</p>
            <p className="text-xs text-[#62666D] mt-1">{plans.length}개 품목</p>
          </div>
          <div className="bg-[#0F1011] rounded-xl border border-[#23252A] p-4 shadow-[0px_1px_3px_rgba(0,0,0,0.2)]">
            <p className="text-xs text-[#8A8F98] font-medium uppercase tracking-wide">총 생산액</p>
            <p className="text-2xl font-bold text-[#7070FF] mt-1">{fmtNum(summary.totalValue)}</p>
            <p className="text-xs text-[#62666D] mt-1">원</p>
          </div>
          <div className="bg-[#0F1011] rounded-xl border border-[#23252A] p-4 shadow-[0px_1px_3px_rgba(0,0,0,0.2)]">
            <p className="text-xs text-[#8A8F98] font-medium uppercase tracking-wide">총 투여 시간</p>
            <p className="text-2xl font-bold text-[#27A644] mt-1">{fmtNumDec(summary.totalHours)}</p>
            <p className="text-xs text-[#62666D] mt-1">시간</p>
          </div>
          <div className="bg-[#0F1011] rounded-xl border border-[#23252A] p-4 shadow-[0px_1px_3px_rgba(0,0,0,0.2)]">
            <p className="text-xs text-[#8A8F98] font-medium uppercase tracking-wide">AI 추천 대기</p>
            <p className="text-2xl font-bold text-violet-600 mt-1">{summary.aiPending}</p>
            <p className="text-xs text-[#62666D] mt-1">품목</p>
          </div>
        </div>

        {/* ── Date Selector ───────────────────────────────────────────────── */}
        <div className="flex items-center justify-between mb-4 bg-[#0F1011] rounded-xl border border-[#23252A] px-4 py-3 shadow-[0px_1px_3px_rgba(0,0,0,0.2)]">
          <div className="flex items-center gap-3">
            <CalendarIcon />
            <button
              onClick={() => navigateDate(-1)}
              className="p-1 rounded hover:bg-[#141516]/5 text-[#8A8F98]"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                className="text-sm border border-[#23252A] rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-blue-500 focus:border-[#5E6AD2] outline-none"
              />
              {viewMode === 'weekly' && (
                <>
                  <span className="text-[#62666D]">~</span>
                  <input
                    type="date"
                    value={endDate}
                    onChange={e => setEndDate(e.target.value)}
                    className="text-sm border border-[#23252A] rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-blue-500 focus:border-[#5E6AD2] outline-none"
                  />
                </>
              )}
            </div>
            <button
              onClick={() => navigateDate(1)}
              className="p-1 rounded hover:bg-[#141516]/5 text-[#8A8F98]"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
          <div className="flex items-center gap-1 bg-[#141516] rounded-lg p-1">
            <button
              onClick={() => setViewMode('daily')}
              className={`px-3 py-1.5 text-sm rounded-md font-medium transition-colors ${
                viewMode === 'daily' ? 'bg-[#0F1011] text-[#F7F8F8] shadow-[0px_1px_3px_rgba(0,0,0,0.2)]' : 'text-[#8A8F98] hover:text-[#D0D6E0]'
              }`}
            >
              일간
            </button>
            <button
              onClick={() => setViewMode('weekly')}
              className={`px-3 py-1.5 text-sm rounded-md font-medium transition-colors ${
                viewMode === 'weekly' ? 'bg-[#0F1011] text-[#F7F8F8] shadow-[0px_1px_3px_rgba(0,0,0,0.2)]' : 'text-[#8A8F98] hover:text-[#D0D6E0]'
              }`}
            >
              주간
            </button>
          </div>
        </div>

        {/* ── Clipboard hint ──────────────────────────────────────────────── */}
        <div className="flex items-center gap-2 mb-2 text-xs text-[#62666D]">
          <span>Ctrl+V: 엑셀에서 붙여넣기</span>
          <span className="text-[#62666D]">|</span>
          <span>Ctrl+C: 선택 행 복사</span>
          <span className="text-[#62666D]">|</span>
          <span>셀 클릭: 편집</span>
          <span className="text-[#62666D]">|</span>
          <span>Tab: 다음 셀</span>
        </div>

        {/* ── Main Table ──────────────────────────────────────────────────── */}
        <div
          ref={tableContainerRef}
          tabIndex={0}
          className="bg-[#0F1011] rounded-xl border border-[#23252A] shadow-[0px_1px_3px_rgba(0,0,0,0.2)] overflow-auto focus:outline-none focus:ring-2 focus:ring-blue-300"
          style={{ maxHeight: 'calc(100vh - 420px)' }}
        >
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <LoadingSpinner size="w-8 h-8" />
              <span className="ml-3 text-[#8A8F98]">데이터를 불러오는 중...</span>
            </div>
          ) : (
            <table className="w-full border-collapse text-sm">
              {/* Sticky header */}
              <thead className="sticky top-0 z-10">
                <tr className="bg-[#141516] border-b-2 border-[#23252A]">
                  <th className="px-2 py-2.5 border border-[#23252A] text-center text-xs font-semibold text-[#8A8F98] w-8 bg-[#141516]">
                    <input
                      type="checkbox"
                      checked={selectedRows.size === plans.length && plans.length > 0}
                      onChange={e => {
                        if (e.target.checked) {
                          setSelectedRows(new Set(plans.map(p => p.id)));
                        } else {
                          setSelectedRows(new Set());
                        }
                      }}
                      className="rounded border-[#23252A]"
                    />
                  </th>
                  <th className="px-2 py-2.5 border border-[#23252A] text-center text-xs font-semibold text-[#8A8F98] w-10 bg-[#141516]">
                    No
                  </th>
                  {COLUMN_HEADERS.map((header, i) => (
                    <th
                      key={i}
                      className={`px-2 py-2.5 border border-[#23252A] text-xs font-semibold text-[#8A8F98] whitespace-nowrap bg-[#141516] ${
                        NUMBER_FIELDS.has(COLUMN_KEYS[i]) ? 'text-right' : 'text-center'
                      }`}
                    >
                      {header}
                    </th>
                  ))}
                  <th className="px-2 py-2.5 border border-[#23252A] text-center text-xs font-semibold text-[#8A8F98] w-16 bg-[#141516]">
                    삭제
                  </th>
                </tr>
              </thead>
              <tbody>
                {plans.length === 0 ? (
                  <tr>
                    <td colSpan={COLUMN_KEYS.length + 3} className="text-center py-16 text-[#62666D]">
                      <p className="text-lg mb-2">데이터가 없습니다</p>
                      <p className="text-sm">위의 &quot;계획 추가&quot; 버튼을 클릭하거나 엑셀에서 Ctrl+V로 붙여넣으세요</p>
                    </td>
                  </tr>
                ) : (
                  <>
                    {plans.map((plan, rowIdx) => (
                      <tr
                        key={plan.id}
                        className={`hover:bg-[#5E6AD2]/10/40 transition-colors ${
                          plan._dirty ? 'bg-[#F0BF00]/10/20' : rowIdx % 2 === 0 ? 'bg-[#0F1011]' : 'bg-[#08090A]/50'
                        } ${selectedRows.has(plan.id) ? '!bg-[#5E6AD2]/10' : ''}`}
                      >
                        {/* Checkbox */}
                        <td className="px-2 py-1.5 border border-[#23252A] text-center">
                          <input
                            type="checkbox"
                            checked={selectedRows.has(plan.id)}
                            onChange={e => {
                              setSelectedRows(prev => {
                                const next = new Set(prev);
                                if (e.target.checked) next.add(plan.id);
                                else next.delete(plan.id);
                                return next;
                              });
                            }}
                            className="rounded border-[#23252A]"
                          />
                        </td>
                        {/* Row number */}
                        <td className="px-2 py-1.5 border border-[#23252A] text-center text-xs text-[#62666D] tabular-nums">
                          {rowIdx + 1}
                        </td>
                        {/* Data cells */}
                        {COLUMN_KEYS.map(field => renderEditableCell(plan, field, rowIdx))}
                        {/* Delete button */}
                        <td className="px-2 py-1.5 border border-[#23252A] text-center">
                          {deleteConfirm === plan.id ? (
                            <div className="flex items-center gap-1 justify-center">
                              <button
                                onClick={() => deletePlan(plan.id)}
                                className="text-[#EB5757] hover:text-[#EB5757] text-xs font-medium"
                              >
                                확인
                              </button>
                              <button
                                onClick={() => setDeleteConfirm(null)}
                                className="text-[#62666D] hover:text-[#D0D6E0] text-xs"
                              >
                                취소
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setDeleteConfirm(plan.id)}
                              className="text-[#62666D] hover:text-[#EB5757] transition-colors p-1 rounded hover:bg-[#EB5757]/10"
                            >
                              <TrashIcon />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}

                    {/* ── Totals Row ──────────────────────────────────────── */}
                    <tr className="bg-[#141516] border-t-2 border-[#23252A] font-semibold sticky bottom-0">
                      <td className="px-2 py-2 border border-[#23252A]"></td>
                      <td className="px-2 py-2 border border-[#23252A]"></td>
                      {/* date */}
                      <td className="px-2 py-2 border border-[#23252A] text-center text-xs text-[#8A8F98]">합계</td>
                      {/* manager */}
                      <td className="px-2 py-2 border border-[#23252A]"></td>
                      {/* location */}
                      <td className="px-2 py-2 border border-[#23252A]"></td>
                      {/* category */}
                      <td className="px-2 py-2 border border-[#23252A]"></td>
                      {/* product_name */}
                      <td className="px-2 py-2 border border-[#23252A] text-xs text-[#8A8F98] text-center">{plans.length}개 품목</td>
                      {/* quantity */}
                      <td className="px-2 py-2 border border-[#23252A] text-right text-xs text-[#F7F8F8] tabular-nums">
                        {fmtNum(totals.quantity)}
                      </td>
                      {/* total_hours */}
                      <td className="px-2 py-2 border border-[#23252A] text-right text-xs text-[#F7F8F8] tabular-nums">
                        {fmtNumDec(totals.total_hours)}
                      </td>
                      {/* unit_price */}
                      <td className="px-2 py-2 border border-[#23252A]"></td>
                      {/* total_value */}
                      <td className="px-2 py-2 border border-[#23252A] text-right text-xs text-[#F7F8F8] tabular-nums">
                        {fmtNum(totals.total_value)}
                      </td>
                      {/* deduction */}
                      <td className="px-2 py-2 border border-[#23252A] text-right text-xs text-[#F7F8F8] tabular-nums">
                        {fmtNum(totals.deduction)}
                      </td>
                      {/* cost */}
                      <td className="px-2 py-2 border border-[#23252A]"></td>
                      {/* total_cost */}
                      <td className="px-2 py-2 border border-[#23252A] text-right text-xs text-[#F7F8F8] tabular-nums">
                        {fmtNum(totals.total_cost)}
                      </td>
                      {/* shift_type */}
                      <td className="px-2 py-2 border border-[#23252A]"></td>
                      {/* delete */}
                      <td className="px-2 py-2 border border-[#23252A]"></td>
                    </tr>
                  </>
                )}
              </tbody>
            </table>
          )}
        </div>

        {/* ── Bottom bar ──────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between mt-3 text-xs text-[#8A8F98]">
          <span>{plans.length}행 {dirtyCount > 0 && `(${dirtyCount}개 변경됨)`}</span>
          <span>{startDate} ~ {endDate}</span>
        </div>

        {/* ── AI Recommendation Explanations ─────────────────────────────── */}
        {aiRecommendations.length > 0 && (
          <div className="mt-4 bg-[#0F1011] rounded-xl border border-violet-200 shadow-[0px_1px_3px_rgba(0,0,0,0.2)] overflow-hidden">
            <button
              onClick={() => setAiExplanationsExpanded(!aiExplanationsExpanded)}
              className="w-full flex items-center justify-between px-5 py-3 bg-gradient-to-r from-violet-50 to-purple-50 hover:from-violet-100 hover:to-purple-100 transition-colors"
            >
              <div className="flex items-center gap-2">
                <SparkleIcon />
                <span className="text-sm font-semibold text-violet-800">AI 추천 분석 결과</span>
                <span className="text-xs text-violet-500 bg-violet-100 px-2 py-0.5 rounded-full">{aiRecommendations.length}건</span>
              </div>
              <svg className={`w-4 h-4 text-violet-500 transition-transform ${aiExplanationsExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {aiExplanationsExpanded && (
              <div className="divide-y divide-[#23252A] max-h-[400px] overflow-y-auto">
                {aiRecommendations.map((rec, idx) => (
                  <div key={rec.plan_id} className="px-5 py-3 hover:bg-[#141516]/5/50 transition-colors">
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono text-[#62666D]">{idx + 1}.</span>
                        <span className="text-sm font-semibold text-[#F7F8F8]">{rec.product_name}</span>
                      </div>
                      <span className="text-sm font-bold text-violet-600">추천: {fmtNum(rec.recommended_qty)}개</span>
                    </div>
                    <pre className="text-xs text-[#8A8F98] whitespace-pre-wrap bg-[#08090A] rounded-lg p-3 font-mono leading-relaxed border border-[#23252A]">
                      {rec.explanation}
                    </pre>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      {/* ── Share Modal ──────────────────────────────────────────────────── */}
      {showShareModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-[#0F1011] rounded-2xl shadow-[0px_7px_32px_rgba(0,0,0,0.35)] w-full max-w-md mx-4 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-[#F7F8F8]">생산 계획 공유</h3>
              <button onClick={() => { setShowShareModal(false); setShareSuccess(false); setShareEmail(''); }} className="text-[#62666D] hover:text-[#D0D6E0]">
                <XIcon />
              </button>
            </div>

            {shareSuccess ? (
              <div className="text-center py-8">
                <div className="w-12 h-12 bg-[#27A644]/15 rounded-full flex items-center justify-center mx-auto mb-3">
                  <svg className="w-6 h-6 text-[#27A644]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                </div>
                <p className="text-[#D0D6E0] font-medium">공유가 완료되었습니다</p>
              </div>
            ) : (
              <>
                <div className="mb-4">
                  <label className="block text-sm font-medium text-[#D0D6E0] mb-1.5">공유 방법</label>
                  <div className="flex gap-2">
                    {(['email', 'sms', 'kakao'] as const).map(method => (
                      <button
                        key={method}
                        onClick={() => setShareMethod(method)}
                        className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${
                          shareMethod === method
                            ? 'border-[#5E6AD2] bg-[#5E6AD2]/10 text-[#828FFF]'
                            : 'border-[#23252A] text-[#8A8F98] hover:bg-[#141516]/5'
                        }`}
                      >
                        {method === 'email' ? '이메일' : method === 'sms' ? 'SMS' : '카카오톡'}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="mb-6">
                  <label className="block text-sm font-medium text-[#D0D6E0] mb-1.5">
                    {shareMethod === 'email' ? '이메일 주소' : shareMethod === 'sms' ? '전화번호' : '카카오톡 ID'}
                  </label>
                  <input
                    type={shareMethod === 'email' ? 'email' : 'text'}
                    value={shareEmail}
                    onChange={e => setShareEmail(e.target.value)}
                    placeholder={shareMethod === 'email' ? 'example@company.com' : shareMethod === 'sms' ? '010-1234-5678' : '카카오톡 ID'}
                    className="w-full border border-[#23252A] rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-[#5E6AD2] outline-none"
                  />
                </div>
                <button
                  onClick={handleShare}
                  disabled={!shareEmail || shareSending}
                  className="w-full py-2.5 rounded-lg bg-[#5E6AD2] text-white text-sm font-medium hover:bg-[#828FFF] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-colors"
                >
                  {shareSending ? <LoadingSpinner /> : <ShareIcon />}
                  <span>{shareSending ? '전송 중...' : '공유하기'}</span>
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── CSS animation for toasts ─────────────────────────────────────── */}
      <style jsx global>{`
        @keyframes slide-up {
          from { opacity: 0; transform: translateY(16px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-slide-up {
          animation: slide-up 0.25s ease-out;
        }
      `}</style>
    </div>
  );
}
