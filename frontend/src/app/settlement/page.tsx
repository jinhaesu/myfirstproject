'use client';

import { Suspense, useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Navigation } from '@/components/layout/Navigation';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line
} from 'recharts';

// ─────────────────────────────────────────────
// Constants & Types
// ─────────────────────────────────────────────

const API_BASE = ''; // Next.js rewrite proxy를 통해 /api/* → 백엔드로 전달

// ─────────────────────────────────────────────
// 전체 36개 채널 목록 (프론트엔드 하드코딩 — 백엔드 없이도 UI 동작)
// ─────────────────────────────────────────────
const ALL_CHANNELS = [
  { name: '카페24', category: '오픈마켓', type: 'api', loginUrl: 'https://eclogin.cafe24.com/Shop/', settlementUrl: '', note: '카페24 어드민 → 정산관리' },
  { name: '스마트스토어', category: '오픈마켓', type: 'rpa', loginUrl: 'https://sell.smartstore.naver.com/', settlementUrl: 'https://sell.smartstore.naver.com/#/settlement/list', note: '스마트스토어 센터 → 정산관리 → 정산내역' },
  { name: '쿠팡 WING', category: '오픈마켓', type: 'rpa', loginUrl: 'https://wing.coupang.com/login', settlementUrl: 'https://wing.coupang.com/settlement/list', note: 'WING → 정산관리 → 정산내역 조회' },
  { name: '쿠팡 로켓', category: '오픈마켓', type: 'rpa', loginUrl: 'https://supplier.coupang.com/login', settlementUrl: 'https://supplier.coupang.com/ecp/settlement/salelist', note: 'Supplier Hub → 정산관리' },
  { name: '11번가', category: '오픈마켓', type: 'rpa', loginUrl: 'https://soffice.11st.co.kr/login', settlementUrl: '', note: '셀러오피스 → 정산관리' },
  { name: '지마켓', category: '오픈마켓', type: 'rpa', loginUrl: 'https://www.esmplus.com/Member/SignIn/LogOn', settlementUrl: '', note: 'ESM+ → 정산관리' },
  { name: '옥션', category: '오픈마켓', type: 'rpa', loginUrl: 'https://www.esmplus.com/Member/SignIn/LogOn', settlementUrl: '', note: 'ESM+ → 정산관리' },
  { name: '에이블리', category: '오픈마켓', type: 'rpa', loginUrl: 'https://partners.a-bly.com/login', settlementUrl: '', note: '셀러센터 → 정산관리' },
  { name: '알리익스프레스', category: '오픈마켓', type: 'rpa', loginUrl: 'https://seller.aliexpress.com/', settlementUrl: '', note: '셀러센터 → 정산' },
  { name: '카카오선물하기', category: '소셜커머스', type: 'rpa', loginUrl: 'https://gift-biz.kakao.com/login', settlementUrl: '', note: '파트너 어드민 → 정산' },
  { name: '카카오톡스토어', category: '소셜커머스', type: 'rpa', loginUrl: 'https://store-sell.kakao.com/login', settlementUrl: '', note: '판매자센터 → 정산관리' },
  { name: '카카오스타일', category: '소셜커머스', type: 'rpa', loginUrl: 'https://partner.kakaostyle.com/login', settlementUrl: '', note: '파트너센터 → 정산' },
  { name: '토스', category: '소셜커머스', type: 'rpa', loginUrl: 'https://seller.toss.im/login', settlementUrl: '', note: '토스 셀러센터 → 정산' },
  { name: '올리브영', category: '버티컬', type: 'rpa', loginUrl: '', settlementUrl: '', note: '파트너센터 → 정산관리' },
  { name: '올웨이즈', category: '버티컬', type: 'rpa', loginUrl: '', settlementUrl: '', note: '파트너센터 → 정산' },
  { name: '마켓컬리', category: '버티컬', type: 'rpa', loginUrl: 'https://partners.kurly.com/login', settlementUrl: '', note: '파트너센터 → 정산' },
  { name: '비마트', category: '버티컬', type: 'rpa', loginUrl: 'https://self.baemin.com/login', settlementUrl: 'https://self.baemin.com/settlement', note: '배민셀프서비스 → 정산관리' },
  { name: '롯데 홈쇼핑', category: '홈쇼핑', type: 'rpa', loginUrl: '', settlementUrl: '', note: '협력사 시스템 → 정산' },
  { name: 'GS 샵', category: '홈쇼핑', type: 'rpa', loginUrl: '', settlementUrl: '', note: '파트너센터 → 정산' },
  { name: 'NS MALL', category: '홈쇼핑', type: 'rpa', loginUrl: '', settlementUrl: '', note: '파트너센터 → 정산' },
  { name: '신세계 TV 쇼핑', category: '홈쇼핑', type: 'rpa', loginUrl: '', settlementUrl: '', note: '파트너센터 → 정산' },
  { name: 'CJ온스타일', category: '홈쇼핑', type: 'rpa', loginUrl: '', settlementUrl: '', note: '파트너센터 → 정산' },
  { name: '롯데온', category: '백화점', type: 'rpa', loginUrl: '', settlementUrl: '', note: '셀러오피스 → 정산' },
  { name: '이지웰', category: '복지몰', type: 'rpa', loginUrl: 'https://partner.ezwel.com/login', settlementUrl: 'https://partner.ezwel.com/settlement', note: '파트너센터 → 정산관리' },
  { name: '삼성카드쇼핑', category: '복지몰', type: 'rpa', loginUrl: 'https://partner.samsungcard.com/login', settlementUrl: 'https://partner.samsungcard.com/settlement', note: '파트너센터 → 정산관리' },
  { name: '농협몰', category: '복지몰', type: 'rpa', loginUrl: 'https://partner.nonghyupmall.com/login', settlementUrl: 'https://partner.nonghyupmall.com/settlement', note: '파트너센터 → 정산관리' },
  { name: '베네피아', category: '복지몰', type: 'rpa', loginUrl: 'https://partner.benepia.co.kr/login', settlementUrl: 'https://partner.benepia.co.kr/settlement', note: '파트너센터 → 정산관리' },
  { name: '홈플러스', category: '대형마트', type: 'rpa', loginUrl: 'https://partner.homeplus.co.kr/login', settlementUrl: 'https://partner.homeplus.co.kr/settlement', note: '파트너센터 → 정산관리' },
  { name: '메가마트', category: '대형마트', type: 'rpa', loginUrl: 'https://partner.megamart.com/login', settlementUrl: 'https://partner.megamart.com/settlement', note: '파트너센터 → 정산관리' },
  { name: '이마트', category: '대형마트', type: 'rpa', loginUrl: 'https://partner.emart.com/login', settlementUrl: 'https://partner.emart.com/settlement', note: '파트너센터 → 정산관리' },
  { name: 'GS25', category: '편의점', type: 'rpa', loginUrl: 'https://partner.gs25.com/login', settlementUrl: 'https://partner.gs25.com/settlement', note: '파트너센터 → 정산관리' },
  { name: 'CU', category: '편의점', type: 'rpa', loginUrl: 'https://partner.cu.co.kr/login', settlementUrl: 'https://partner.cu.co.kr/settlement', note: '파트너센터 → 정산관리' },
  { name: '삼성웰스토리', category: 'B2B', type: 'rpa', loginUrl: 'https://partner.welstory.com/login', settlementUrl: 'https://partner.welstory.com/settlement', note: '파트너센터 → 정산관리' },
  { name: 'CJ프레시웨이', category: 'B2B', type: 'rpa', loginUrl: 'https://partner.cjfreshway.com/login', settlementUrl: 'https://partner.cjfreshway.com/settlement', note: '파트너센터 → 정산관리' },
  { name: '아워홈', category: 'B2B', type: 'rpa', loginUrl: 'https://partner.ourhome.co.kr/login', settlementUrl: 'https://partner.ourhome.co.kr/settlement', note: '파트너센터 → 정산관리' },
];

// 카테고리별 그룹핑
const CHANNELS_BY_CATEGORY = ALL_CHANNELS.reduce((acc, ch) => {
  if (!acc[ch.category]) acc[ch.category] = [];
  acc[ch.category].push(ch);
  return acc;
}, {} as Record<string, typeof ALL_CHANNELS>);

const COLORS = [
  '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899',
  '#06B6D4', '#84CC16', '#F97316', '#6366F1', '#14B8A6', '#A855F7',
];

const CATEGORY_COLORS: Record<string, string> = {
  '오픈마켓': '#3B82F6',
  '소셜커머스': '#10B981',
  '버티컬': '#F59E0B',
  '홈쇼핑': '#EF4444',
  '백화점': '#8B5CF6',
  '복지몰': '#EC4899',
  '대형마트': '#06B6D4',
  '편의점': '#84CC16',
  'B2B': '#F97316',
  '기타': '#6B7280',
};

const years = Array.from({ length: 10 }, (_, i) => new Date().getFullYear() - 5 + i);
const months = Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: `${i + 1}월` }));

type TabKey = 'dashboard' | 'rpa-collect' | 'rpa-settings' | 'reports' | 'logs';

interface SettlementRecord {
  id: number;
  channel_id: string;
  channel_name: string;
  category: string;
  year: number;
  month: number;
  gross_sales: number;
  net_sales: number;
  settlement_amount: number;
  commission: number;
  order_count: number;
  is_confirmed: boolean;
  source: string;
  created_at: string;
  updated_at: string;
}

interface YearlySummary {
  year: number;
  monthly: {
    month: number;
    gross_sales: number;
    net_sales: number;
    settlement_amount: number;
    commission: number;
    order_count: number;
    channel_count: number;
  }[];
}

interface ComparisonRecord {
  channel_id: string;
  channel_name: string;
  category: string;
  current_gross_sales: number;
  current_settlement_amount: number;
  previous_gross_sales: number;
  previous_settlement_amount: number;
  gross_change_pct: number | null;
  settlement_change_pct: number | null;
}

interface RpaConfig {
  id: number;
  channel_id: string;
  channel_name: string;
  category: string;
  login_url: string;
  login_id: string;
  login_password: string;
  settlement_url: string;
  selectors: Record<string, string>;
  download_type: string;
  auto_collect_day: number;
  is_enabled: boolean;
  last_collected_at: string | null;
}

interface RpaDefault {
  channel_name: string;
  category: string;
  login_url: string;
  settlement_url: string;
  download_type: string;
}

interface CollectionLog {
  id: number;
  channel_id: string;
  channel_name: string;
  year: number;
  month: number;
  collection_method: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  settlement_amount: number | null;
  error_message: string | null;
}

interface ReportConfig {
  id: number;
  name: string;
  recipients: string[];
  schedule_day: number;
  schedule_time: string;
  auto_send: boolean;
  last_sent_at: string | null;
  created_at: string;
}

// ─────────────────────────────────────────────
// Helper: API fetch
// ─────────────────────────────────────────────

const getAuthHeaders = (): Record<string, string> => {
  const token = localStorage.getItem('token');
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
};

const fetchApi = async (path: string, options: RequestInit = {}) => {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...getAuthHeaders(),
      ...options.headers,
    },
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.detail || `API error: ${res.status}`);
  }
  return res.json();
};

/** API 호출 실패 시 기본값 반환 (UI가 깨지지 않도록) */
const fetchSafe = async <T,>(path: string, defaultValue: T, options: RequestInit = {}): Promise<T> => {
  try {
    return await fetchApi(path, options);
  } catch {
    return defaultValue;
  }
};

const fetchApiBlob = async (path: string, options: RequestInit = {}) => {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...getAuthHeaders(),
      ...options.headers,
    },
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.blob();
};

// ─────────────────────────────────────────────
// Formatting helpers
// ─────────────────────────────────────────────

const fmt = (n: number | null | undefined) =>
  n != null ? n.toLocaleString('ko-KR') : '-';

const fmtWon = (n: number | null | undefined) =>
  n != null ? `${n.toLocaleString('ko-KR')}원` : '-';

const fmtPct = (n: number | null | undefined) => {
  if (n == null) return '-';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(1)}%`;
};

const pctColor = (n: number | null | undefined) => {
  if (n == null) return 'text-slate-500';
  if (n > 0) return 'text-emerald-600';
  if (n < 0) return 'text-red-600';
  return 'text-slate-500';
};

// ─────────────────────────────────────────────
// Main Page Component
// ─────────────────────────────────────────────

export default function SettlementPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center">
          <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <SettlementPageContent />
    </Suspense>
  );
}

function SettlementPageContent() {
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();

  // ─── Global State ───
  const [activeTab, setActiveTab] = useState<TabKey>('dashboard');
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Auth guard
  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
    }
  }, [user, authLoading, router]);

  // Toast auto-dismiss
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 5000);
      return () => clearTimeout(t);
    }
  }, [toast]);

  if (authLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) return null;

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'dashboard', label: '결산 현황' },
    { key: 'rpa-collect', label: 'RPA 수집' },
    { key: 'rpa-settings', label: 'RPA 설정' },
    { key: 'reports', label: '리포트' },
    { key: 'logs', label: '수집 로그' },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
      <Navigation />

      <main className="max-w-7xl mx-auto px-4 py-6">
        {/* Page Title */}
        <div className="mb-6">
          <h2 className="text-2xl font-bold text-slate-800">월별 결산 매출 확인</h2>
          <p className="text-slate-500 mt-1">월별 결산 데이터 관리, RPA 자동 수집, 리포트 생성</p>
        </div>

        {/* Toast Notification */}
        {toast && (
          <div
            className={`mb-4 px-4 py-3 rounded-lg flex items-center justify-between ${
              toast.type === 'success'
                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                : 'bg-red-50 text-red-700 border border-red-200'
            }`}
          >
            <span className="text-sm">{toast.message}</span>
            <button onClick={() => setToast(null)} className="ml-4 text-lg leading-none">&times;</button>
          </div>
        )}

        {/* Tab Navigation */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 mb-6">
          <div className="flex overflow-x-auto border-b border-slate-200">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`px-6 py-3 text-sm font-medium whitespace-nowrap transition-colors border-b-2 ${
                  activeTab === tab.key
                    ? 'border-blue-500 text-blue-600 bg-blue-50/50'
                    : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Tab Content */}
        {activeTab === 'dashboard' && <DashboardTab setToast={setToast} />}
        {activeTab === 'rpa-collect' && <RpaCollectTab setToast={setToast} />}
        {activeTab === 'rpa-settings' && <RpaSettingsTab setToast={setToast} />}
        {activeTab === 'reports' && <ReportsTab setToast={setToast} />}
        {activeTab === 'logs' && <LogsTab setToast={setToast} />}
      </main>
    </div>
  );
}

// ═══════════════════════════════════════════════
// TAB 1: Dashboard (결산 현황)
// ═══════════════════════════════════════════════

function DashboardTab({ setToast }: { setToast: (t: { type: 'success' | 'error'; message: string } | null) => void }) {
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [records, setRecords] = useState<SettlementRecord[]>([]);
  const [yearlySummary, setYearlySummary] = useState<YearlySummary | null>(null);
  const [comparisons, setComparisons] = useState<ComparisonRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showManualModal, setShowManualModal] = useState(false);
  const [editingRecord, setEditingRecord] = useState<SettlementRecord | null>(null);
  const [sortField, setSortField] = useState<string>('gross_sales');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  // Fetch all dashboard data
  const fetchDashboardData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [monthlyData, yearlyData, compData] = await Promise.all([
        fetchSafe(`/api/settlement/monthly?year=${year}&month=${month}`, []),
        fetchSafe(`/api/settlement/yearly-summary?year=${year}`, null),
        fetchSafe(`/api/settlement/comparison?year=${year}&month=${month}`, []),
      ]);
      setRecords(Array.isArray(monthlyData) ? monthlyData : []);
      setYearlySummary(yearlyData);
      setComparisons(Array.isArray(compData) ? compData : []);
    } catch (err: any) {
      // 에러가 나도 빈 데이터로 UI를 보여줌
      setRecords([]);
      setYearlySummary(null);
      setComparisons([]);
    } finally {
      setIsLoading(false);
    }
  }, [year, month, setToast]);

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  // Summary calculations
  const summary = useMemo(() => {
    const totalGross = records.reduce((s, r) => s + (r.gross_sales || 0), 0);
    const totalSettlement = records.reduce((s, r) => s + (r.settlement_amount || 0), 0);
    const totalCommission = records.reduce((s, r) => s + (r.commission || 0), 0);
    const channelCount = new Set(records.map((r) => r.channel_id)).size;
    return { totalGross, totalSettlement, totalCommission, channelCount };
  }, [records]);

  // Category breakdown for pie chart
  const categoryData = useMemo(() => {
    const map: Record<string, number> = {};
    records.forEach((r) => {
      const cat = r.category || '기타';
      map[cat] = (map[cat] || 0) + (r.gross_sales || 0);
    });
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  }, [records]);

  // Monthly trend for bar chart
  const monthlyTrend = useMemo(() => {
    if (!yearlySummary?.monthly) return [];
    return yearlySummary.monthly.map((m) => ({
      name: `${m.month}월`,
      총매출: m.gross_sales,
      정산금액: m.settlement_amount,
      수수료: m.commission,
    }));
  }, [yearlySummary]);

  // Sorted records
  const sortedRecords = useMemo(() => {
    const merged = records.map((r) => {
      const comp = comparisons.find((c) => c.channel_id === r.channel_id);
      return { ...r, gross_change_pct: comp?.gross_change_pct ?? null, settlement_change_pct: comp?.settlement_change_pct ?? null };
    });
    return [...merged].sort((a, b) => {
      const av = (a as any)[sortField] ?? 0;
      const bv = (b as any)[sortField] ?? 0;
      return sortDir === 'asc' ? av - bv : bv - av;
    });
  }, [records, comparisons, sortField, sortDir]);

  const toggleSort = (field: string) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  const sortIcon = (field: string) => {
    if (sortField !== field) return ' ↕';
    return sortDir === 'asc' ? ' ↑' : ' ↓';
  };

  // Actions
  const handleConfirm = async (id: number) => {
    try {
      await fetchApi(`/api/settlement/confirm/${id}`, { method: 'POST' });
      setToast({ type: 'success', message: '결산 확정 완료' });
      fetchDashboardData();
    } catch (err: any) {
      setToast({ type: 'error', message: `확정 실패: ${err.message}` });
    }
  };

  const handleFinalizeAll = async () => {
    if (!confirm(`${year}년 ${month}월 전체 결산을 확정하시겠습니까?`)) return;
    try {
      await fetchApi('/api/settlement/finalize', {
        method: 'POST',
        body: JSON.stringify({ year, month }),
      });
      setToast({ type: 'success', message: `${year}년 ${month}월 전체 결산 확정 완료` });
      fetchDashboardData();
    } catch (err: any) {
      setToast({ type: 'error', message: `전체 확정 실패: ${err.message}` });
    }
  };

  const handleExcelDownload = async () => {
    try {
      const blob = await fetchApiBlob(`/api/settlement/download-excel?year=${year}&month=${month}`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `settlement_${year}_${String(month).padStart(2, '0')}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      setToast({ type: 'success', message: '엑셀 다운로드 완료' });
    } catch (err: any) {
      setToast({ type: 'error', message: `다운로드 실패: ${err.message}` });
    }
  };

  const handleExcelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('year', String(year));
      formData.append('month', String(month));
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_BASE}/api/settlement/upload-excel`, {
        method: 'POST',
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: formData,
      });
      if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
      setToast({ type: 'success', message: '엑셀 업로드 완료' });
      fetchDashboardData();
    } catch (err: any) {
      setToast({ type: 'error', message: `업로드 실패: ${err.message}` });
    }
    e.target.value = '';
  };

  const handleOpenManual = (record?: SettlementRecord) => {
    setEditingRecord(record || null);
    setShowManualModal(true);
  };

  return (
    <div className="space-y-6">
      {/* Year/Month selector + action buttons */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-slate-600">연도</label>
            <select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              {years.map((y) => (
                <option key={y} value={y}>{y}년</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-slate-600">월</label>
            <select
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              {months.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>
          <div className="flex-1" />
          <button
            onClick={() => handleOpenManual()}
            className="px-4 py-2 text-sm bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition-colors"
          >
            + 수동 입력
          </button>
          <label className="px-4 py-2 text-sm bg-violet-500 text-white rounded-lg hover:bg-violet-600 transition-colors cursor-pointer">
            엑셀 업로드
            <input type="file" accept=".xlsx,.xls,.csv" onChange={handleExcelUpload} className="hidden" />
          </label>
          <button
            onClick={handleExcelDownload}
            className="px-4 py-2 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
          >
            엑셀 다운로드
          </button>
          <button
            onClick={handleFinalizeAll}
            className="px-4 py-2 text-sm bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors"
          >
            전체 확정
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20">
          <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <SummaryCard label="총매출" value={fmtWon(summary.totalGross)} color="blue" icon={
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            } />
            <SummaryCard label="정산금액" value={fmtWon(summary.totalSettlement)} color="emerald" icon={
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" /></svg>
            } />
            <SummaryCard label="수수료" value={fmtWon(summary.totalCommission)} color="amber" icon={
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
            } />
            <SummaryCard label="채널 수" value={`${summary.channelCount}개`} color="violet" icon={
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
            } />
          </div>

          {/* Charts Row */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Monthly Trend Bar Chart */}
            <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-slate-200 p-6">
              <h3 className="text-lg font-semibold text-slate-800 mb-4">{year}년 월별 추이</h3>
              {monthlyTrend.length > 0 ? (
                <ResponsiveContainer width="100%" height={320}>
                  <BarChart data={monthlyTrend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `${(v / 1000000).toFixed(0)}M`} />
                    <Tooltip formatter={(value: number) => fmtWon(value)} />
                    <Legend />
                    <Bar dataKey="총매출" fill="#3B82F6" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="정산금액" fill="#10B981" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[320px] flex items-center justify-center text-slate-400">데이터가 없습니다</div>
              )}
            </div>

            {/* Category Pie Chart */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
              <h3 className="text-lg font-semibold text-slate-800 mb-4">카테고리별 매출</h3>
              {categoryData.length > 0 ? (
                <ResponsiveContainer width="100%" height={320}>
                  <PieChart>
                    <Pie
                      data={categoryData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={100}
                      dataKey="value"
                      label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                      labelLine={false}
                    >
                      {categoryData.map((entry, idx) => (
                        <Cell key={entry.name} fill={CATEGORY_COLORS[entry.name] || COLORS[idx % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value: number) => fmtWon(value)} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[320px] flex items-center justify-center text-slate-400">데이터가 없습니다</div>
              )}
            </div>
          </div>

          {/* Data Table */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="p-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-800">
                {year}년 {month}월 채널별 결산 내역
              </h3>
              <span className="text-sm text-slate-500">{sortedRecords.length}개 채널</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium text-slate-600">카테고리</th>
                    <th className="text-left px-4 py-3 font-medium text-slate-600">채널명</th>
                    <th className="text-right px-4 py-3 font-medium text-slate-600 cursor-pointer select-none" onClick={() => toggleSort('gross_sales')}>
                      총매출{sortIcon('gross_sales')}
                    </th>
                    <th className="text-right px-4 py-3 font-medium text-slate-600 cursor-pointer select-none" onClick={() => toggleSort('net_sales')}>
                      순매출{sortIcon('net_sales')}
                    </th>
                    <th className="text-right px-4 py-3 font-medium text-slate-600 cursor-pointer select-none" onClick={() => toggleSort('settlement_amount')}>
                      정산금액{sortIcon('settlement_amount')}
                    </th>
                    <th className="text-right px-4 py-3 font-medium text-slate-600 cursor-pointer select-none" onClick={() => toggleSort('commission')}>
                      수수료{sortIcon('commission')}
                    </th>
                    <th className="text-right px-4 py-3 font-medium text-slate-600 cursor-pointer select-none" onClick={() => toggleSort('order_count')}>
                      주문건수{sortIcon('order_count')}
                    </th>
                    <th className="text-center px-4 py-3 font-medium text-slate-600">전월 대비</th>
                    <th className="text-center px-4 py-3 font-medium text-slate-600">상태</th>
                    <th className="text-center px-4 py-3 font-medium text-slate-600">소스</th>
                    <th className="text-center px-4 py-3 font-medium text-slate-600">작업</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sortedRecords.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="text-center py-12 text-slate-400">
                        {year}년 {month}월 결산 데이터가 없습니다. 수동 입력 또는 RPA 수집을 진행하세요.
                      </td>
                    </tr>
                  ) : (
                    sortedRecords.map((r) => (
                      <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-4 py-3">
                          <span
                            className="inline-block px-2 py-0.5 text-xs rounded-full font-medium"
                            style={{
                              backgroundColor: `${CATEGORY_COLORS[r.category] || '#6B7280'}20`,
                              color: CATEGORY_COLORS[r.category] || '#6B7280',
                            }}
                          >
                            {r.category || '기타'}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-medium text-slate-800">{r.channel_name}</td>
                        <td className="px-4 py-3 text-right font-mono text-slate-700">{fmt(r.gross_sales)}</td>
                        <td className="px-4 py-3 text-right font-mono text-slate-700">{fmt(r.net_sales)}</td>
                        <td className="px-4 py-3 text-right font-mono text-slate-700">{fmt(r.settlement_amount)}</td>
                        <td className="px-4 py-3 text-right font-mono text-slate-700">{fmt(r.commission)}</td>
                        <td className="px-4 py-3 text-right font-mono text-slate-700">{fmt(r.order_count)}</td>
                        <td className="px-4 py-3 text-center">
                          <span className={`text-xs font-medium ${pctColor(r.gross_change_pct)}`}>
                            {fmtPct(r.gross_change_pct)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          {r.is_confirmed ? (
                            <span className="inline-block px-2 py-0.5 text-xs bg-emerald-100 text-emerald-700 rounded-full font-medium">확정</span>
                          ) : (
                            <span className="inline-block px-2 py-0.5 text-xs bg-amber-100 text-amber-700 rounded-full font-medium">미확정</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className="inline-block px-2 py-0.5 text-xs bg-slate-100 text-slate-600 rounded-full">
                            {r.source || '-'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              onClick={() => handleOpenManual(r)}
                              className="p-1 text-blue-500 hover:bg-blue-50 rounded transition-colors"
                              title="수정"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                            </button>
                            {!r.is_confirmed && (
                              <button
                                onClick={() => handleConfirm(r.id)}
                                className="p-1 text-emerald-500 hover:bg-emerald-50 rounded transition-colors"
                                title="확정"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {/* Table Footer with totals */}
            {sortedRecords.length > 0 && (
              <div className="bg-slate-50 border-t border-slate-200 px-4 py-3">
                <div className="flex flex-wrap gap-6 text-sm">
                  <span className="text-slate-600">합계:</span>
                  <span className="font-medium text-slate-800">총매출 {fmtWon(summary.totalGross)}</span>
                  <span className="font-medium text-slate-800">정산금액 {fmtWon(summary.totalSettlement)}</span>
                  <span className="font-medium text-slate-800">수수료 {fmtWon(summary.totalCommission)}</span>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* Manual Input Modal */}
      {showManualModal && (
        <ManualInputModal
          year={year}
          month={month}
          record={editingRecord}
          onClose={() => { setShowManualModal(false); setEditingRecord(null); }}
          onSaved={() => {
            setShowManualModal(false);
            setEditingRecord(null);
            setToast({ type: 'success', message: '결산 데이터 저장 완료' });
            fetchDashboardData();
          }}
          setToast={setToast}
        />
      )}
    </div>
  );
}

// ─── Summary Card Component ───

function SummaryCard({ label, value, color, icon }: { label: string; value: string; color: string; icon: React.ReactNode }) {
  const colorMap: Record<string, string> = {
    blue: 'from-blue-500 to-blue-600',
    emerald: 'from-emerald-500 to-emerald-600',
    amber: 'from-amber-500 to-amber-600',
    violet: 'from-violet-500 to-violet-600',
  };
  const bgMap: Record<string, string> = {
    blue: 'bg-blue-50',
    emerald: 'bg-emerald-50',
    amber: 'bg-amber-50',
    violet: 'bg-violet-50',
  };
  const textMap: Record<string, string> = {
    blue: 'text-blue-600',
    emerald: 'text-emerald-600',
    amber: 'text-amber-600',
    violet: 'text-violet-600',
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-slate-500 mb-1">{label}</p>
          <p className="text-xl font-bold text-slate-800">{value}</p>
        </div>
        <div className={`w-12 h-12 rounded-xl ${bgMap[color]} flex items-center justify-center ${textMap[color]}`}>
          {icon}
        </div>
      </div>
    </div>
  );
}

// ─── Manual Input Modal ───

function ManualInputModal({
  year,
  month,
  record,
  onClose,
  onSaved,
  setToast,
}: {
  year: number;
  month: number;
  record: SettlementRecord | null;
  onClose: () => void;
  onSaved: () => void;
  setToast: (t: { type: 'success' | 'error'; message: string } | null) => void;
}) {
  const [form, setForm] = useState({
    channel_id: record?.channel_id || '',
    channel_name: record?.channel_name || '',
    category: record?.category || '',
    gross_sales: record?.gross_sales ?? 0,
    net_sales: record?.net_sales ?? 0,
    settlement_amount: record?.settlement_amount ?? 0,
    commission: record?.commission ?? 0,
    order_count: record?.order_count ?? 0,
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await fetchApi('/api/settlement/upsert', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          year,
          month,
          source: 'manual',
          id: record?.id,
        }),
      });
      onSaved();
    } catch (err: any) {
      setToast({ type: 'error', message: `저장 실패: ${err.message}` });
    } finally {
      setSaving(false);
    }
  };

  const updateField = (field: string, value: string | number) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-6 border-b border-slate-200">
          <h3 className="text-lg font-semibold text-slate-800">
            {record ? '결산 데이터 수정' : '결산 데이터 수동 입력'}
          </h3>
          <p className="text-sm text-slate-500 mt-1">{year}년 {month}월</p>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">채널 ID</label>
              <input
                type="text"
                value={form.channel_id}
                onChange={(e) => updateField('channel_id', e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                required
                disabled={!!record}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">채널명</label>
              <input
                type="text"
                value={form.channel_name}
                onChange={(e) => updateField('channel_name', e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                required
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">카테고리</label>
            <select
              value={form.category}
              onChange={(e) => updateField('category', e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">선택</option>
              {Object.keys(CATEGORY_COLORS).map((cat) => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">총매출</label>
              <input
                type="number"
                value={form.gross_sales}
                onChange={(e) => updateField('gross_sales', Number(e.target.value))}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">순매출</label>
              <input
                type="number"
                value={form.net_sales}
                onChange={(e) => updateField('net_sales', Number(e.target.value))}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">정산금액</label>
              <input
                type="number"
                value={form.settlement_amount}
                onChange={(e) => updateField('settlement_amount', Number(e.target.value))}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">수수료</label>
              <input
                type="number"
                value={form.commission}
                onChange={(e) => updateField('commission', Number(e.target.value))}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">주문건수</label>
            <input
              type="number"
              value={form.order_count}
              onChange={(e) => updateField('order_count', Number(e.target.value))}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50"
            >
              {saving ? '저장 중...' : '저장'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
// TAB 2: RPA Collection (RPA 수집)
// ═══════════════════════════════════════════════

function RpaCollectTab({ setToast }: { setToast: (t: { type: 'success' | 'error'; message: string } | null) => void }) {
  const [savedConfigs, setSavedConfigs] = useState<Record<string, SavedRpaConfig>>({});
  const [logs, setLogs] = useState<CollectionLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [collectingChannel, setCollectingChannel] = useState<string | null>(null);
  const [collectingAll, setCollectingAll] = useState(false);
  const [year] = useState(new Date().getFullYear());
  const [month] = useState(new Date().getMonth() + 1);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  // RPA 가능한 채널만 필터
  const rpaChannels = useMemo(() => ALL_CHANNELS.filter((ch) => ch.type !== 'manual'), []);

  const fetchConfigs = useCallback(async () => {
    const data = await fetchSafe('/api/settlement/rpa-configs', []);
    const map: Record<string, SavedRpaConfig> = {};
    if (Array.isArray(data)) {
      data.forEach((c: any) => { if (c.channel_name) map[c.channel_name] = c; });
    }
    setSavedConfigs(map);
  }, []);

  const fetchLogs = useCallback(async () => {
    const data = await fetchSafe(`/api/settlement/collection-logs?limit=20`, []);
    setLogs(Array.isArray(data) ? data : []);
  }, []);

  useEffect(() => {
    const init = async () => {
      setIsLoading(true);
      await Promise.all([fetchConfigs(), fetchLogs()]);
      setIsLoading(false);
    };
    init();
  }, [fetchConfigs, fetchLogs]);

  // Polling for real-time status
  useEffect(() => {
    if (collectingChannel || collectingAll) {
      pollingRef.current = setInterval(fetchLogs, 3000);
    } else {
      if (pollingRef.current) clearInterval(pollingRef.current);
    }
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [collectingChannel, collectingAll, fetchLogs]);

  const handleCollect = async (channelName: string) => {
    const saved = savedConfigs[channelName];
    if (!saved?.login_id) {
      setToast({ type: 'error', message: `${channelName}: 먼저 RPA 설정 탭에서 로그인 정보를 입력하세요` });
      return;
    }
    setCollectingChannel(channelName);
    try {
      await fetchApi('/api/settlement/rpa-collect', {
        method: 'POST',
        body: JSON.stringify({ channel_name: channelName, year, month }),
      });
      setToast({ type: 'success', message: `[${channelName}] 수집 시작됨` });
      await fetchLogs();
    } catch (err: any) {
      setToast({ type: 'error', message: `수집 실패: ${err.message}` });
    } finally {
      setCollectingChannel(null);
    }
  };

  const handleCollectAll = async () => {
    if (!confirm('모든 활성 채널의 결산 데이터를 수집하시겠습니까?')) return;
    setCollectingAll(true);
    try {
      await fetchApi('/api/settlement/rpa-collect-all', {
        method: 'POST',
        body: JSON.stringify({ year, month }),
      });
      setToast({ type: 'success', message: '전체 수집 시작됨' });
      await fetchLogs();
    } catch (err: any) {
      setToast({ type: 'error', message: `전체 수집 실패: ${err.message}` });
    } finally {
      setCollectingAll(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'success':
      case 'completed':
        return <span className="px-2 py-0.5 text-xs bg-emerald-100 text-emerald-700 rounded-full font-medium">성공</span>;
      case 'running':
      case 'in_progress':
        return <span className="px-2 py-0.5 text-xs bg-blue-100 text-blue-700 rounded-full font-medium animate-pulse">수집 중</span>;
      case 'failed':
      case 'error':
        return <span className="px-2 py-0.5 text-xs bg-red-100 text-red-700 rounded-full font-medium">실패</span>;
      case 'pending':
        return <span className="px-2 py-0.5 text-xs bg-amber-100 text-amber-700 rounded-full font-medium">대기</span>;
      default:
        return <span className="px-2 py-0.5 text-xs bg-slate-100 text-slate-600 rounded-full">{status}</span>;
    }
  };

  // Map latest log per channel
  const latestLogByChannel = useMemo(() => {
    const map: Record<string, CollectionLog> = {};
    logs.forEach((log) => {
      if (!map[log.channel_name] || new Date(log.started_at) > new Date(map[log.channel_name].started_at)) {
        map[log.channel_name] = log;
      }
    });
    return map;
  }, [logs]);

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const configuredChannels = rpaChannels.filter((ch) => savedConfigs[ch.name]?.login_id);
  const unconfiguredChannels = rpaChannels.filter((ch) => !savedConfigs[ch.name]?.login_id);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold text-slate-800">RPA 자동 수집</h3>
          <p className="text-sm text-slate-500">{year}년 {month}월 결산 데이터를 자동으로 수집합니다</p>
        </div>
        <button
          onClick={handleCollectAll}
          disabled={collectingAll || configuredChannels.length === 0}
          className="px-5 py-2.5 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50 flex items-center gap-2"
        >
          {collectingAll ? (
            <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> 수집 중...</>
          ) : (
            <>전체 수집 ({configuredChannels.length}개 채널)</>
          )}
        </button>
      </div>

      {/* Progress */}
      {(collectingChannel || collectingAll) && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-center gap-3">
          <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-blue-700">데이터 수집이 진행 중입니다...</span>
        </div>
      )}

      {/* 수집 가능 채널 */}
      <div>
        <h4 className="text-md font-semibold text-slate-700 mb-3">수집 가능 ({configuredChannels.length}개 채널 — 로그인 정보 설정됨)</h4>
        {configuredChannels.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8 text-center text-slate-400">
            <p>설정된 채널이 없습니다.</p>
            <p className="text-sm mt-1">&quot;RPA 설정&quot; 탭에서 채널별 로그인 정보를 먼저 입력하세요.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {configuredChannels.map((ch) => {
              const latestLog = latestLogByChannel[ch.name];
              const isCollecting = collectingChannel === ch.name;
              return (
                <div key={ch.name} className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <span className="inline-block px-2 py-0.5 text-xs rounded-full font-medium mb-1" style={{ backgroundColor: `${CATEGORY_COLORS[ch.category] || '#6B7280'}20`, color: CATEGORY_COLORS[ch.category] || '#6B7280' }}>
                        {ch.category}
                      </span>
                      <h5 className="font-semibold text-slate-800">{ch.name}</h5>
                    </div>
                    {latestLog && getStatusBadge(latestLog.status)}
                  </div>
                  <div className="text-xs text-slate-500 space-y-1 mb-3">
                    <p>ID: {savedConfigs[ch.name]?.login_id}</p>
                    {latestLog?.settlement_amount != null && (
                      <p className="text-emerald-600 font-medium">수집 금액: {fmtWon(latestLog.settlement_amount)}</p>
                    )}
                    {latestLog?.error_message && (
                      <p className="text-red-500 truncate" title={latestLog.error_message}>오류: {latestLog.error_message}</p>
                    )}
                  </div>
                  <button
                    onClick={() => handleCollect(ch.name)}
                    disabled={isCollecting}
                    className="w-full px-3 py-2 text-sm bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {isCollecting ? (<><div className="w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" /> 수집 중...</>) : '수집 실행'}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 미설정 채널 */}
      {unconfiguredChannels.length > 0 && (
        <div>
          <h4 className="text-md font-semibold text-slate-400 mb-3">미설정 ({unconfiguredChannels.length}개 — RPA 설정 탭에서 로그인 정보 입력 필요)</h4>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {unconfiguredChannels.map((ch) => (
              <div key={ch.name} className="bg-white rounded-lg border border-slate-200 p-3 opacity-50">
                <span className="text-xs text-slate-400">{ch.category}</span>
                <p className="font-medium text-slate-500 text-sm">{ch.name}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Logs */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-4 border-b border-slate-200">
          <h4 className="text-md font-semibold text-slate-800">최근 수집 로그</h4>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-2 font-medium text-slate-600">채널</th>
                <th className="text-left px-4 py-2 font-medium text-slate-600">연월</th>
                <th className="text-center px-4 py-2 font-medium text-slate-600">상태</th>
                <th className="text-left px-4 py-2 font-medium text-slate-600">시작 시간</th>
                <th className="text-right px-4 py-2 font-medium text-slate-600">정산금액</th>
                <th className="text-left px-4 py-2 font-medium text-slate-600">오류</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {logs.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-8 text-slate-400">수집 로그가 없습니다</td></tr>
              ) : (
                logs.slice(0, 10).map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2 font-medium text-slate-700">{log.channel_name}</td>
                    <td className="px-4 py-2 text-slate-600">{log.year}년 {log.month}월</td>
                    <td className="px-4 py-2 text-center">{getStatusBadge(log.status)}</td>
                    <td className="px-4 py-2 text-slate-600">{log.started_at ? new Date(log.started_at).toLocaleString('ko-KR') : '-'}</td>
                    <td className="px-4 py-2 text-right font-mono text-slate-700">{log.settlement_amount != null ? fmtWon(log.settlement_amount) : '-'}</td>
                    <td className="px-4 py-2 text-red-500 text-xs max-w-[200px] truncate" title={log.error_message || ''}>{log.error_message || '-'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
// TAB 3: RPA Settings (RPA 설정)
// ═══════════════════════════════════════════════

interface SavedRpaConfig {
  channel_id?: string;
  channel_name: string;
  login_url?: string;
  login_id?: string;
  has_password?: boolean;
  login_password?: string;
  settlement_url?: string;
  selectors?: Record<string, string>;
  download_type?: string;
  auto_collect_day?: number;
  is_enabled?: boolean;
}

function RpaSettingsTab({ setToast }: { setToast: (t: { type: 'success' | 'error'; message: string } | null) => void }) {
  const [savedConfigs, setSavedConfigs] = useState<Record<string, SavedRpaConfig>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [editingChannel, setEditingChannel] = useState<typeof ALL_CHANNELS[0] | null>(null);
  const [editForm, setEditForm] = useState<SavedRpaConfig | null>(null);
  const [testingChannel, setTestingChannel] = useState<string | null>(null);
  const [savingChannel, setSavingChannel] = useState<string | null>(null);
  const [collectTestingChannel, setCollectTestingChannel] = useState<string | null>(null);
  const [collectTestingAll, setCollectTestingAll] = useState(false);
  const [collectTestResults, setCollectTestResults] = useState<Record<string, { success: boolean; message: string; data?: any }>>({});
  const [testYear] = useState(new Date().getFullYear());
  const [testMonth] = useState(new Date().getMonth() + 1);

  // 저장된 RPA 설정 로드 (실패해도 OK — 빈 상태로 시작)
  const fetchData = useCallback(async () => {
    setIsLoading(true);
    const data = await fetchSafe('/api/settlement/rpa-configs', []);
    const configMap: Record<string, SavedRpaConfig> = {};
    if (Array.isArray(data)) {
      data.forEach((c: any) => { if (c.channel_name) configMap[c.channel_name] = c; });
    }
    setSavedConfigs(configMap);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleEdit = (channel: typeof ALL_CHANNELS[0]) => {
    const saved = savedConfigs[channel.name] || {};
    setEditingChannel(channel);
    setEditForm({
      channel_name: channel.name,
      login_url: saved.login_url || channel.loginUrl || '',
      login_id: saved.login_id || '',
      login_password: '',
      settlement_url: saved.settlement_url || channel.settlementUrl || '',
      selectors: saved.selectors || {},
      download_type: saved.download_type || 'scrape',
      auto_collect_day: saved.auto_collect_day || 5,
      is_enabled: saved.is_enabled ?? true,
    });
  };

  const handleSave = async () => {
    if (!editForm || !editingChannel) return;
    setSavingChannel(editingChannel.name);
    try {
      const payload: Record<string, any> = {
        channel_id: editingChannel.name,
        ...editForm,
        channel_name: editingChannel.name,
      };
      // 비밀번호가 빈 값이면 전송하지 않아 기존 값 유지
      if (!payload.login_password) {
        delete payload.login_password;
      }
      await fetchApi('/api/settlement/rpa-config', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setToast({ type: 'success', message: `${editingChannel.name} 설정 저장 완료` });
      setEditingChannel(null);
      setEditForm(null);
      fetchData();
    } catch (err: any) {
      setToast({ type: 'error', message: `저장 실패: ${err.message}` });
    } finally {
      setSavingChannel(null);
    }
  };

  const handleTest = async (channelName: string) => {
    const saved = savedConfigs[channelName];
    if (!saved?.login_id) {
      setToast({ type: 'error', message: `${channelName}: 먼저 로그인 정보를 설정하세요` });
      return;
    }
    setTestingChannel(channelName);
    try {
      const result = await fetchApi('/api/settlement/rpa-test', {
        method: 'POST',
        body: JSON.stringify({ channel_name: channelName, login_url: saved.login_url, login_id: saved.login_id, login_password: saved.login_password || '' }),
      });
      setToast({ type: result.success ? 'success' : 'error', message: `[${channelName}] ${result.message || '테스트 완료'}` });
    } catch (err: any) {
      setToast({ type: 'error', message: `[${channelName}] 연결 테스트 실패: ${err.message}` });
    } finally {
      setTestingChannel(null);
    }
  };

  const handleCollectTest = async (channelName: string) => {
    const saved = savedConfigs[channelName];
    if (!saved?.login_id) {
      setToast({ type: 'error', message: `${channelName}: 먼저 로그인 정보를 설정하세요` });
      return;
    }
    setCollectTestingChannel(channelName);
    try {
      const result = await fetchApi('/api/settlement/rpa-collect-test', {
        method: 'POST',
        body: JSON.stringify({ channel_name: channelName, year: testYear, month: testMonth }),
      });
      setCollectTestResults((prev) => ({ ...prev, [channelName]: result }));
      setToast({
        type: result.success ? 'success' : 'error',
        message: `[${channelName}] 수집 테스트: ${result.message || (result.success ? '성공' : '실패')}${result.data?.settlement_amount ? ` (정산금액: ${Number(result.data.settlement_amount).toLocaleString()}원)` : ''}`,
      });
    } catch (err: any) {
      setCollectTestResults((prev) => ({ ...prev, [channelName]: { success: false, message: err.message } }));
      setToast({ type: 'error', message: `[${channelName}] 수집 테스트 실패: ${err.message}` });
    } finally {
      setCollectTestingChannel(null);
    }
  };

  const handleCollectTestAll = async () => {
    const configuredChannels = ALL_CHANNELS.filter((ch) => savedConfigs[ch.name]?.login_id);
    if (configuredChannels.length === 0) {
      setToast({ type: 'error', message: '설정된 채널이 없습니다. 먼저 채널별 로그인 정보를 입력하세요.' });
      return;
    }
    setCollectTestingAll(true);
    setCollectTestResults({});
    try {
      const result = await fetchApi('/api/settlement/rpa-collect-test-all', {
        method: 'POST',
        body: JSON.stringify({ year: testYear, month: testMonth }),
      });
      const resultMap: Record<string, any> = {};
      if (result.results) {
        result.results.forEach((r: any) => {
          resultMap[r.channel_name] = r;
        });
      }
      setCollectTestResults(resultMap);
      setToast({
        type: result.success_count > 0 ? 'success' : 'error',
        message: `전체 수집 테스트 완료: ${result.success_count}/${result.total} 성공`,
      });
    } catch (err: any) {
      setToast({ type: 'error', message: `전체 수집 테스트 실패: ${err.message}` });
    } finally {
      setCollectTestingAll(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 수집 테스트 영역 */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
          <div>
            <h3 className="text-lg font-semibold text-slate-800">수집 테스트</h3>
            <p className="text-sm text-slate-500">{testYear}년 {testMonth}월 기준 — 데이터를 저장하지 않고 수집 가능 여부만 확인합니다</p>
          </div>
          <button
            onClick={handleCollectTestAll}
            disabled={collectTestingAll || collectTestingChannel !== null}
            className="px-5 py-2.5 bg-violet-500 text-white rounded-lg hover:bg-violet-600 transition-colors disabled:opacity-50 flex items-center gap-2 font-medium"
          >
            {collectTestingAll ? (
              <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> 전체 테스트 중...</>
            ) : (
              <>전체 수집 테스트</>
            )}
          </button>
        </div>

        {/* 전체 수집 테스트 결과 요약 */}
        {Object.keys(collectTestResults).length > 0 && (
          <div className="bg-slate-50 rounded-lg p-4">
            <div className="flex items-center gap-4 mb-3">
              <span className="text-sm font-medium text-slate-700">테스트 결과:</span>
              <span className="px-2 py-0.5 text-xs bg-emerald-100 text-emerald-700 rounded-full font-medium">
                성공 {Object.values(collectTestResults).filter((r) => r.success).length}
              </span>
              <span className="px-2 py-0.5 text-xs bg-red-100 text-red-700 rounded-full font-medium">
                실패 {Object.values(collectTestResults).filter((r) => !r.success).length}
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
              {Object.entries(collectTestResults).map(([name, result]) => (
                <div key={name} className={`px-3 py-2 rounded-lg text-xs flex items-center justify-between ${result.success ? 'bg-emerald-50 border border-emerald-200' : 'bg-red-50 border border-red-200'}`}>
                  <span className={`font-medium ${result.success ? 'text-emerald-700' : 'text-red-700'}`}>{name}</span>
                  <span className={result.success ? 'text-emerald-600' : 'text-red-500'}>
                    {result.success ? (result.data?.settlement_amount ? `${Number(result.data.settlement_amount).toLocaleString()}원` : '성공') : '실패'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 사용 가이드 */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
        <h4 className="text-sm font-bold text-amber-800 mb-2">RPA 설정 가이드</h4>
        <div className="text-xs text-amber-700 space-y-1.5">
          <p>RPA가 실제로 동작하려면, 각 채널마다 아래 정보를 직접 입력해야 합니다:</p>
          <ol className="list-decimal ml-4 space-y-1">
            <li><strong>로그인 URL</strong> — 각 채널 셀러 어드민(파트너센터) 로그인 페이지 주소</li>
            <li><strong>로그인 ID / 비밀번호</strong> — 해당 채널에 등록된 판매자 계정 정보</li>
            <li><strong>정산 페이지 URL</strong> — 로그인 후 정산/결산 내역을 확인하는 페이지 주소</li>
            <li><strong>다운로드 방식</strong> — 해당 채널에서 정산 데이터를 가져오는 방법 (웹 스크래핑 / 엑셀 다운로드)</li>
          </ol>
          <p className="mt-2 text-amber-600">각 채널의 <strong>&quot;편집&quot;</strong> 버튼을 눌러 설정하세요. 설정 후 <strong>&quot;연결 테스트&quot;</strong>로 로그인이 되는지, <strong>&quot;수집 테스트&quot;</strong>로 데이터 수집이 되는지 확인할 수 있습니다.</p>
        </div>
      </div>

      {/* 전체 36개 채널 — 카테고리별 그룹 */}
      {Object.entries(CHANNELS_BY_CATEGORY).map(([category, channels]) => (
        <div key={category} className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div
            className="px-4 py-3 border-b border-slate-200 flex items-center gap-2"
            style={{ backgroundColor: `${CATEGORY_COLORS[category] || '#6B7280'}10` }}
          >
            <span className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: CATEGORY_COLORS[category] || '#6B7280' }} />
            <h4 className="font-semibold text-slate-800">{category}</h4>
            <span className="text-sm text-slate-500">({channels.length}개 채널)</span>
          </div>
          <div className="divide-y divide-slate-100">
            {channels.map((ch) => {
              const saved = savedConfigs[ch.name];
              const isConfigured = !!(saved?.login_id);
              const isTesting = testingChannel === ch.name;

              return (
                <div key={ch.name} className="p-4 flex flex-wrap items-center gap-4">
                  {/* 채널 정보 */}
                  <div className="flex-1 min-w-[250px]">
                    <div className="flex items-center gap-2">
                      <h5 className="font-medium text-slate-800">{ch.name}</h5>
                      {isConfigured ? (
                        <span className="px-2 py-0.5 text-[10px] font-medium bg-emerald-100 text-emerald-700 rounded-full">설정완료</span>
                      ) : (
                        <span className="px-2 py-0.5 text-[10px] font-medium bg-red-100 text-red-600 rounded-full">미설정</span>
                      )}
                      <span className="px-2 py-0.5 text-[10px] font-medium bg-blue-50 text-blue-600 rounded-full">{ch.type.toUpperCase()}</span>
                      {collectTestResults[ch.name] && (
                        <span className={`px-2 py-0.5 text-[10px] font-medium rounded-full ${collectTestResults[ch.name].success ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                          {collectTestResults[ch.name].success ? '수집OK' : '수집실패'}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-500 mt-1">
                      <p>로그인: {saved?.login_url || ch.loginUrl || <span className="text-red-400">URL 미설정</span>}
                        {saved?.login_id && <span className="text-emerald-600 ml-1">(ID: {saved.login_id})</span>}
                      </p>
                      <p>정산: {saved?.settlement_url || ch.settlementUrl || <span className="text-red-400">URL 미설정</span>}</p>
                      <p className="text-slate-400">{ch.note}</p>
                    </div>
                  </div>

                  {/* 액션 버튼 */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleTest(ch.name)}
                      disabled={isTesting || !isConfigured}
                      className="px-3 py-1.5 text-xs bg-amber-50 text-amber-600 rounded-lg hover:bg-amber-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      title={!isConfigured ? '먼저 편집에서 로그인 정보를 설정하세요' : ''}
                    >
                      {isTesting ? '테스트 중...' : '연결 테스트'}
                    </button>
                    <button
                      onClick={() => handleCollectTest(ch.name)}
                      disabled={collectTestingChannel === ch.name || !isConfigured || collectTestingAll}
                      className={`px-3 py-1.5 text-xs rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed font-medium ${
                        collectTestResults[ch.name]?.success
                          ? 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100'
                          : collectTestResults[ch.name] && !collectTestResults[ch.name].success
                          ? 'bg-red-50 text-red-600 hover:bg-red-100'
                          : 'bg-violet-50 text-violet-600 hover:bg-violet-100'
                      }`}
                      title={!isConfigured ? '먼저 편집에서 로그인 정보를 설정하세요' : collectTestResults[ch.name]?.message || ''}
                    >
                      {collectTestingChannel === ch.name ? '수집 테스트 중...' : collectTestResults[ch.name]?.success ? '수집 성공' : collectTestResults[ch.name] ? '수집 실패' : '수집 테스트'}
                    </button>
                    <button
                      onClick={() => handleEdit(ch)}
                      className="px-3 py-1.5 text-xs bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors font-medium"
                    >
                      편집
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* 편집 모달 */}
      {editingChannel && editForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => { setEditingChannel(null); setEditForm(null); }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="p-6 border-b border-slate-200">
              <h3 className="text-lg font-semibold text-slate-800">{editingChannel.name} RPA 설정</h3>
              <p className="text-xs text-slate-500 mt-1">{editingChannel.note}</p>
            </div>
            <div className="p-6 space-y-4">
              {/* 설정 안내 */}
              <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-xs text-blue-700 space-y-1">
                <p className="font-semibold">설정 방법:</p>
                <p>1. 해당 채널의 셀러 어드민에 웹브라우저로 직접 로그인해 보세요.</p>
                <p>2. 로그인 페이지 URL을 아래 &quot;로그인 URL&quot;에 붙여넣으세요.</p>
                <p>3. 로그인 후 정산/결산 내역 페이지로 이동한 뒤 그 URL을 &quot;정산 페이지 URL&quot;에 붙여넣으세요.</p>
                <p>4. 사용하시는 ID/비밀번호를 입력하세요.</p>
                <p>5. 저장 후 &quot;연결 테스트&quot;로 정상 동작을 확인하세요.</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">로그인 URL <span className="text-red-500">*</span></label>
                <input
                  type="url"
                  value={editForm.login_url || ''}
                  onChange={(e) => setEditForm({ ...editForm, login_url: e.target.value })}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder={editingChannel.loginUrl || 'https://...'}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">로그인 ID <span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    value={editForm.login_id || ''}
                    onChange={(e) => setEditForm({ ...editForm, login_id: e.target.value })}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="셀러 계정 ID"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">로그인 비밀번호 <span className="text-red-500">*</span></label>
                  <input
                    type="password"
                    value={editForm.login_password || ''}
                    onChange={(e) => setEditForm({ ...editForm, login_password: e.target.value })}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder={savedConfigs[editingChannel.name]?.has_password ? '(저장됨 — 변경 시 입력)' : '비밀번호'}
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">정산 페이지 URL <span className="text-red-500">*</span></label>
                <input
                  type="url"
                  value={editForm.settlement_url || ''}
                  onChange={(e) => setEditForm({ ...editForm, settlement_url: e.target.value })}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder={editingChannel.settlementUrl || '정산 내역 페이지 URL'}
                />
                <p className="text-xs text-slate-400 mt-1">로그인 후 정산/결산 내역을 확인하는 페이지의 URL</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">다운로드 방식</label>
                  <select
                    value={editForm.download_type || 'scrape'}
                    onChange={(e) => setEditForm({ ...editForm, download_type: e.target.value })}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="scrape">웹 스크래핑 (테이블 읽기)</option>
                    <option value="excel_download">엑셀 다운로드</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">자동 수집일 (매월)</label>
                  <input
                    type="number"
                    min={1}
                    max={28}
                    value={editForm.auto_collect_day || 5}
                    onChange={(e) => setEditForm({ ...editForm, auto_collect_day: Number(e.target.value) })}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
                <button
                  onClick={() => { setEditingChannel(null); setEditForm(null); }}
                  className="px-4 py-2 text-sm text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors"
                >
                  취소
                </button>
                <button
                  onClick={handleSave}
                  disabled={savingChannel === editingChannel.name}
                  className="px-4 py-2 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50"
                >
                  {savingChannel === editingChannel.name ? '저장 중...' : '저장'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════
// TAB 4: Reports (리포트)
// ═══════════════════════════════════════════════

function ReportsTab({ setToast }: { setToast: (t: { type: 'success' | 'error'; message: string } | null) => void }) {
  const [reports, setReports] = useState<ReportConfig[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [sendingReportId, setSendingReportId] = useState<number | null>(null);
  const [deletingReportId, setDeletingReportId] = useState<number | null>(null);

  // Create form state
  const [newReport, setNewReport] = useState({
    name: '',
    recipients: '',
    schedule_day: 5,
    schedule_time: '09:00',
    auto_send: true,
  });

  const fetchReports = useCallback(async () => {
    const data = await fetchSafe('/api/settlement/reports', []);
    setReports(Array.isArray(data) ? data : []);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  const handleCreateReport = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await fetchApi('/api/settlement/reports', {
        method: 'POST',
        body: JSON.stringify({
          ...newReport,
          recipients: newReport.recipients.split(',').map((s) => s.trim()).filter(Boolean),
        }),
      });
      setToast({ type: 'success', message: '리포트 생성 완료' });
      setShowCreateForm(false);
      setNewReport({ name: '', recipients: '', schedule_day: 5, schedule_time: '09:00', auto_send: true });
      fetchReports();
    } catch (err: any) {
      setToast({ type: 'error', message: `리포트 생성 실패: ${err.message}` });
    }
  };

  const handleSendNow = async (reportId: number) => {
    setSendingReportId(reportId);
    try {
      await fetchApi('/api/settlement/reports/send-now', {
        method: 'POST',
        body: JSON.stringify({ report_id: reportId }),
      });
      setToast({ type: 'success', message: '리포트 발송 완료' });
      fetchReports();
    } catch (err: any) {
      setToast({ type: 'error', message: `발송 실패: ${err.message}` });
    } finally {
      setSendingReportId(null);
    }
  };

  const handleDelete = async (reportId: number) => {
    if (!confirm('이 리포트를 삭제하시겠습니까?')) return;
    setDeletingReportId(reportId);
    try {
      await fetchApi(`/api/settlement/reports/${reportId}`, { method: 'DELETE' });
      setToast({ type: 'success', message: '리포트 삭제 완료' });
      fetchReports();
    } catch (err: any) {
      setToast({ type: 'error', message: `삭제 실패: ${err.message}` });
    } finally {
      setDeletingReportId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold text-slate-800">결산 리포트 관리</h3>
          <p className="text-sm text-slate-500">자동/수동 결산 리포트를 설정하고 발송합니다</p>
        </div>
        <button
          onClick={() => setShowCreateForm(!showCreateForm)}
          className="px-4 py-2 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
        >
          {showCreateForm ? '취소' : '+ 새 리포트'}
        </button>
      </div>

      {/* Create Form */}
      {showCreateForm && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <h4 className="text-md font-semibold text-slate-800 mb-4">새 리포트 만들기</h4>
          <form onSubmit={handleCreateReport} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">리포트 이름</label>
              <input
                type="text"
                value={newReport.name}
                onChange={(e) => setNewReport((p) => ({ ...p, name: e.target.value }))}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="예: 월간 결산 리포트"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">수신자 이메일 (쉼표로 구분)</label>
              <input
                type="text"
                value={newReport.recipients}
                onChange={(e) => setNewReport((p) => ({ ...p, recipients: e.target.value }))}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="user1@example.com, user2@example.com"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">발송일 (매월)</label>
                <input
                  type="number"
                  min={1}
                  max={28}
                  value={newReport.schedule_day}
                  onChange={(e) => setNewReport((p) => ({ ...p, schedule_day: Number(e.target.value) }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">발송 시간</label>
                <input
                  type="time"
                  value={newReport.schedule_time}
                  onChange={(e) => setNewReport((p) => ({ ...p, schedule_time: e.target.value }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="auto_send"
                checked={newReport.auto_send}
                onChange={(e) => setNewReport((p) => ({ ...p, auto_send: e.target.checked }))}
                className="w-4 h-4 text-blue-600 border-slate-300 rounded focus:ring-blue-500"
              />
              <label htmlFor="auto_send" className="text-sm text-slate-700">자동 발송 활성화</label>
            </div>
            <div className="flex justify-end">
              <button
                type="submit"
                className="px-5 py-2 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
              >
                리포트 생성
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Reports List */}
      {reports.length === 0 && !showCreateForm ? (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-12 text-center text-slate-400">
          등록된 리포트가 없습니다. 새 리포트를 만들어보세요.
        </div>
      ) : (
        <div className="space-y-4">
          {reports.map((report) => (
            <div key={report.id} className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex-1 min-w-[200px]">
                  <div className="flex items-center gap-2 mb-2">
                    <h4 className="font-semibold text-slate-800">{report.name}</h4>
                    {report.auto_send ? (
                      <span className="px-2 py-0.5 text-xs bg-emerald-100 text-emerald-700 rounded-full font-medium">자동</span>
                    ) : (
                      <span className="px-2 py-0.5 text-xs bg-slate-100 text-slate-500 rounded-full">수동</span>
                    )}
                  </div>
                  <div className="text-sm text-slate-500 space-y-1">
                    <p>
                      <span className="font-medium text-slate-600">수신자:</span>{' '}
                      {report.recipients.join(', ')}
                    </p>
                    <p>
                      <span className="font-medium text-slate-600">발송 일정:</span>{' '}
                      매월 {report.schedule_day}일 {report.schedule_time}
                    </p>
                    {report.last_sent_at && (
                      <p>
                        <span className="font-medium text-slate-600">마지막 발송:</span>{' '}
                        {new Date(report.last_sent_at).toLocaleString('ko-KR')}
                      </p>
                    )}
                    <p className="text-xs text-slate-400">
                      생성일: {new Date(report.created_at).toLocaleDateString('ko-KR')}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleSendNow(report.id)}
                    disabled={sendingReportId === report.id}
                    className="px-4 py-2 text-sm bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition-colors disabled:opacity-50"
                  >
                    {sendingReportId === report.id ? '발송 중...' : '즉시 발송'}
                  </button>
                  <button
                    onClick={() => handleDelete(report.id)}
                    disabled={deletingReportId === report.id}
                    className="px-4 py-2 text-sm bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-colors disabled:opacity-50"
                  >
                    {deletingReportId === report.id ? '삭제 중...' : '삭제'}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════
// TAB 5: Collection Logs (수집 로그)
// ═══════════════════════════════════════════════

function LogsTab({ setToast }: { setToast: (t: { type: 'success' | 'error'; message: string } | null) => void }) {
  const [logs, setLogs] = useState<CollectionLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filterChannel, setFilterChannel] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const autoRefreshRef = useRef<NodeJS.Timeout | null>(null);

  const fetchLogs = useCallback(async () => {
    const params = new URLSearchParams();
    if (filterChannel) params.set('channel_name', filterChannel);
    if (filterStatus) params.set('status', filterStatus);
    params.set('limit', '100');
    const data = await fetchSafe(`/api/settlement/collection-logs?${params.toString()}`, []);
    setLogs(Array.isArray(data) ? data : []);
    setIsLoading(false);
  }, [filterChannel, filterStatus]);

  useEffect(() => {
    setIsLoading(true);
    fetchLogs();
  }, [fetchLogs]);

  // Auto-refresh every 10 seconds
  useEffect(() => {
    autoRefreshRef.current = setInterval(fetchLogs, 10000);
    return () => {
      if (autoRefreshRef.current) clearInterval(autoRefreshRef.current);
    };
  }, [fetchLogs]);

  // Get unique channel names for filter
  const channelNames = useMemo(() => {
    const set = new Set(logs.map((l) => l.channel_name));
    return Array.from(set).sort();
  }, [logs]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'success':
      case 'completed':
        return <span className="px-2 py-0.5 text-xs bg-emerald-100 text-emerald-700 rounded-full font-medium">성공</span>;
      case 'running':
      case 'in_progress':
        return <span className="px-2 py-0.5 text-xs bg-blue-100 text-blue-700 rounded-full font-medium animate-pulse">수집 중</span>;
      case 'failed':
      case 'error':
        return <span className="px-2 py-0.5 text-xs bg-red-100 text-red-700 rounded-full font-medium">실패</span>;
      case 'pending':
        return <span className="px-2 py-0.5 text-xs bg-amber-100 text-amber-700 rounded-full font-medium">대기</span>;
      default:
        return <span className="px-2 py-0.5 text-xs bg-slate-100 text-slate-600 rounded-full">{status}</span>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-slate-600">채널</label>
            <select
              value={filterChannel}
              onChange={(e) => setFilterChannel(e.target.value)}
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">전체</option>
              {channelNames.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-slate-600">상태</label>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">전체</option>
              <option value="success">성공</option>
              <option value="running">수집 중</option>
              <option value="failed">실패</option>
              <option value="pending">대기</option>
            </select>
          </div>
          <div className="flex-1" />
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
            10초마다 자동 갱신
          </div>
          <button
            onClick={() => { setIsLoading(true); fetchLogs(); }}
            className="px-3 py-2 text-sm bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200 transition-colors"
          >
            새로고침
          </button>
        </div>
      </div>

      {/* Logs Table */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        {isLoading ? (
          <div className="flex justify-center py-16">
            <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">채널</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">연월</th>
                  <th className="text-center px-4 py-3 font-medium text-slate-600">수집 방식</th>
                  <th className="text-center px-4 py-3 font-medium text-slate-600">상태</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">시작 시간</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">완료 시간</th>
                  <th className="text-right px-4 py-3 font-medium text-slate-600">정산금액</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">에러 메시지</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {logs.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-center py-12 text-slate-400">
                      수집 로그가 없습니다
                    </td>
                  </tr>
                ) : (
                  logs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3 font-medium text-slate-700">{log.channel_name}</td>
                      <td className="px-4 py-3 text-slate-600">{log.year}년 {log.month}월</td>
                      <td className="px-4 py-3 text-center">
                        <span className="inline-block px-2 py-0.5 text-xs bg-slate-100 text-slate-600 rounded-full">
                          {log.collection_method || '-'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">{getStatusBadge(log.status)}</td>
                      <td className="px-4 py-3 text-slate-600 text-xs">
                        {new Date(log.started_at).toLocaleString('ko-KR')}
                      </td>
                      <td className="px-4 py-3 text-slate-600 text-xs">
                        {log.completed_at ? new Date(log.completed_at).toLocaleString('ko-KR') : '-'}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-slate-700">
                        {log.settlement_amount != null ? fmtWon(log.settlement_amount) : '-'}
                      </td>
                      <td className="px-4 py-3">
                        {log.error_message ? (
                          <span
                            className="text-xs text-red-500 block max-w-[250px] truncate cursor-help"
                            title={log.error_message}
                          >
                            {log.error_message}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-400">-</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
        {/* Footer */}
        {logs.length > 0 && (
          <div className="bg-slate-50 border-t border-slate-200 px-4 py-2 text-xs text-slate-500">
            총 {logs.length}건의 로그
          </div>
        )}
      </div>
    </div>
  );
}
