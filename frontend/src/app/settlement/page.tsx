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
        fetchApi(`/api/settlement/monthly?year=${year}&month=${month}`),
        fetchApi(`/api/settlement/yearly-summary?year=${year}`),
        fetchApi(`/api/settlement/comparison?year=${year}&month=${month}`),
      ]);
      setRecords(Array.isArray(monthlyData) ? monthlyData : monthlyData.records || []);
      setYearlySummary(yearlyData);
      setComparisons(Array.isArray(compData) ? compData : compData.comparisons || []);
    } catch (err: any) {
      setToast({ type: 'error', message: `데이터 로드 실패: ${err.message}` });
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
  const [configs, setConfigs] = useState<RpaConfig[]>([]);
  const [logs, setLogs] = useState<CollectionLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [collectingChannelId, setCollectingChannelId] = useState<string | null>(null);
  const [collectingAll, setCollectingAll] = useState(false);
  const [year] = useState(new Date().getFullYear());
  const [month] = useState(new Date().getMonth() + 1);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  const fetchConfigs = useCallback(async () => {
    try {
      const data = await fetchApi('/api/settlement/rpa-configs');
      setConfigs(Array.isArray(data) ? data : data.configs || []);
    } catch (err: any) {
      setToast({ type: 'error', message: `RPA 설정 로드 실패: ${err.message}` });
    }
  }, [setToast]);

  const fetchLogs = useCallback(async () => {
    try {
      const data = await fetchApi(`/api/settlement/collection-logs?limit=20`);
      setLogs(Array.isArray(data) ? data : data.logs || []);
    } catch {
      // silently fail for polling
    }
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
    if (collectingChannelId || collectingAll) {
      pollingRef.current = setInterval(fetchLogs, 3000);
    } else {
      if (pollingRef.current) clearInterval(pollingRef.current);
    }
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [collectingChannelId, collectingAll, fetchLogs]);

  const handleCollect = async (config: RpaConfig) => {
    setCollectingChannelId(config.channel_id);
    try {
      await fetchApi('/api/settlement/rpa-collect', {
        method: 'POST',
        body: JSON.stringify({
          channel_id: config.channel_id,
          year,
          month,
        }),
      });
      setToast({ type: 'success', message: `[${config.channel_name}] 수집 시작됨` });
      await fetchLogs();
    } catch (err: any) {
      setToast({ type: 'error', message: `수집 실패: ${err.message}` });
    } finally {
      setCollectingChannelId(null);
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

  // Map latest log per channel for quick status lookup
  const latestLogByChannel = useMemo(() => {
    const map: Record<string, CollectionLog> = {};
    logs.forEach((log) => {
      if (!map[log.channel_id] || new Date(log.started_at) > new Date(map[log.channel_id].started_at)) {
        map[log.channel_id] = log;
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

  const enabledConfigs = configs.filter((c) => c.is_enabled);
  const disabledConfigs = configs.filter((c) => !c.is_enabled);

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
          disabled={collectingAll || enabledConfigs.length === 0}
          className="px-5 py-2.5 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50 flex items-center gap-2"
        >
          {collectingAll ? (
            <>
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              수집 중...
            </>
          ) : (
            <>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
              전체 수집
            </>
          )}
        </button>
      </div>

      {/* Progress indicator */}
      {(collectingChannelId || collectingAll) && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-center gap-3">
          <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-blue-700">데이터 수집이 진행 중입니다. 로그를 자동으로 갱신합니다...</span>
        </div>
      )}

      {/* Enabled Channels Grid */}
      <div>
        <h4 className="text-md font-semibold text-slate-700 mb-3">활성 채널 ({enabledConfigs.length}개)</h4>
        {enabledConfigs.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8 text-center text-slate-400">
            활성화된 RPA 채널이 없습니다. RPA 설정 탭에서 채널을 활성화하세요.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {enabledConfigs.map((config) => {
              const latestLog = latestLogByChannel[config.channel_id];
              const isCollecting = collectingChannelId === config.channel_id;
              return (
                <div key={config.channel_id} className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <span
                        className="inline-block px-2 py-0.5 text-xs rounded-full font-medium mb-1"
                        style={{
                          backgroundColor: `${CATEGORY_COLORS[config.category] || '#6B7280'}20`,
                          color: CATEGORY_COLORS[config.category] || '#6B7280',
                        }}
                      >
                        {config.category}
                      </span>
                      <h5 className="font-semibold text-slate-800">{config.channel_name}</h5>
                    </div>
                    {latestLog && getStatusBadge(latestLog.status)}
                  </div>
                  <div className="text-xs text-slate-500 space-y-1 mb-3">
                    <p>수집 방식: {config.download_type || '-'}</p>
                    <p>자동 수집일: 매월 {config.auto_collect_day}일</p>
                    {config.last_collected_at && (
                      <p>마지막 수집: {new Date(config.last_collected_at).toLocaleString('ko-KR')}</p>
                    )}
                    {latestLog?.settlement_amount != null && (
                      <p className="text-emerald-600 font-medium">수집 금액: {fmtWon(latestLog.settlement_amount)}</p>
                    )}
                    {latestLog?.error_message && (
                      <p className="text-red-500 truncate" title={latestLog.error_message}>오류: {latestLog.error_message}</p>
                    )}
                  </div>
                  <button
                    onClick={() => handleCollect(config)}
                    disabled={isCollecting}
                    className="w-full px-3 py-2 text-sm bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {isCollecting ? (
                      <>
                        <div className="w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                        수집 중...
                      </>
                    ) : (
                      '수집 실행'
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Disabled Channels */}
      {disabledConfigs.length > 0 && (
        <div>
          <h4 className="text-md font-semibold text-slate-500 mb-3">비활성 채널 ({disabledConfigs.length}개)</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {disabledConfigs.map((config) => (
              <div key={config.channel_id} className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 opacity-60">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <span className="inline-block px-2 py-0.5 text-xs rounded-full font-medium bg-slate-100 text-slate-500 mb-1">
                      {config.category}
                    </span>
                    <h5 className="font-semibold text-slate-600">{config.channel_name}</h5>
                  </div>
                  <span className="px-2 py-0.5 text-xs bg-slate-100 text-slate-500 rounded-full">비활성</span>
                </div>
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
                <tr>
                  <td colSpan={6} className="text-center py-8 text-slate-400">수집 로그가 없습니다</td>
                </tr>
              ) : (
                logs.slice(0, 10).map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2 font-medium text-slate-700">{log.channel_name}</td>
                    <td className="px-4 py-2 text-slate-600">{log.year}년 {log.month}월</td>
                    <td className="px-4 py-2 text-center">{getStatusBadge(log.status)}</td>
                    <td className="px-4 py-2 text-slate-600">{new Date(log.started_at).toLocaleString('ko-KR')}</td>
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

function RpaSettingsTab({ setToast }: { setToast: (t: { type: 'success' | 'error'; message: string } | null) => void }) {
  const [configs, setConfigs] = useState<RpaConfig[]>([]);
  const [defaults, setDefaults] = useState<RpaDefault[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [editingConfig, setEditingConfig] = useState<RpaConfig | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [testingChannelId, setTestingChannelId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [configData, defaultData] = await Promise.all([
        fetchApi('/api/settlement/rpa-configs'),
        fetchApi('/api/settlement/rpa-defaults').catch(() => []),
      ]);
      setConfigs(Array.isArray(configData) ? configData : configData.configs || []);
      setDefaults(Array.isArray(defaultData) ? defaultData : defaultData.defaults || []);
    } catch (err: any) {
      setToast({ type: 'error', message: `RPA 설정 로드 실패: ${err.message}` });
    } finally {
      setIsLoading(false);
    }
  }, [setToast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleToggle = async (config: RpaConfig) => {
    try {
      await fetchApi('/api/settlement/rpa-config', {
        method: 'POST',
        body: JSON.stringify({ ...config, is_enabled: !config.is_enabled }),
      });
      setToast({ type: 'success', message: `${config.channel_name} ${config.is_enabled ? '비활성화' : '활성화'} 완료` });
      fetchData();
    } catch (err: any) {
      setToast({ type: 'error', message: `변경 실패: ${err.message}` });
    }
  };

  const handleTest = async (config: RpaConfig) => {
    setTestingChannelId(config.channel_id);
    try {
      const result = await fetchApi('/api/settlement/rpa-test', {
        method: 'POST',
        body: JSON.stringify({ channel_id: config.channel_id }),
      });
      setToast({ type: 'success', message: `[${config.channel_name}] 연결 테스트 성공: ${result.message || '정상'}` });
    } catch (err: any) {
      setToast({ type: 'error', message: `[${config.channel_name}] 연결 테스트 실패: ${err.message}` });
    } finally {
      setTestingChannelId(null);
    }
  };

  const handleEdit = (config: RpaConfig) => {
    setEditingConfig({ ...config });
    setShowEditModal(true);
  };

  const handleSaveConfig = async (updatedConfig: RpaConfig) => {
    try {
      await fetchApi('/api/settlement/rpa-config', {
        method: 'POST',
        body: JSON.stringify(updatedConfig),
      });
      setToast({ type: 'success', message: `${updatedConfig.channel_name} 설정 저장 완료` });
      setShowEditModal(false);
      setEditingConfig(null);
      fetchData();
    } catch (err: any) {
      setToast({ type: 'error', message: `저장 실패: ${err.message}` });
    }
  };

  // Group configs by category
  const groupedConfigs = useMemo(() => {
    const map: Record<string, RpaConfig[]> = {};
    configs.forEach((c) => {
      const cat = c.category || '기타';
      if (!map[cat]) map[cat] = [];
      map[cat].push(c);
    });
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
  }, [configs]);

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
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
            <li><strong>CSS Selectors (선택)</strong> — 기본 셀렉터로 로그인/데이터 추출이 안 될 때만 커스터마이징</li>
          </ol>
          <p className="mt-2 text-amber-600">각 채널의 &quot;편집&quot; 버튼을 눌러 설정하세요. 설정 후 &quot;연결 테스트&quot;로 로그인이 되는지 확인할 수 있습니다.</p>
        </div>
      </div>

      {/* 채널별 참고 URL 가이드 */}
      <details className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <summary className="px-5 py-3 cursor-pointer text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors">
          채널별 셀러 어드민 URL 참고 (클릭해서 펼치기)
        </summary>
        <div className="px-5 py-3 border-t border-slate-100 text-xs text-slate-600 space-y-2">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {[
              { ch: '스마트스토어', url: 'https://sell.smartstore.naver.com/', note: '정산관리 → 정산내역' },
              { ch: '쿠팡 WING', url: 'https://wing.coupang.com/', note: '정산관리 → 정산내역 조회' },
              { ch: '쿠팡 로켓', url: 'https://supplier.coupang.com/', note: '정산관리 → 매출현황' },
              { ch: '11번가', url: 'https://soffice.11st.co.kr/', note: '정산관리 → 정산내역' },
              { ch: '지마켓/옥션', url: 'https://www.esmplus.com/', note: 'ESM+ → 정산관리' },
              { ch: '카카오선물하기', url: 'https://gift-biz.kakao.com/', note: '파트너 어드민 → 정산' },
              { ch: '카카오톡스토어', url: 'https://store-sell.kakao.com/', note: '판매자센터 → 정산관리' },
              { ch: '카카오스타일', url: 'https://partner.kakaostyle.com/', note: '파트너센터 → 정산' },
              { ch: '올리브영', url: 'https://global.oliveyoung.com/ (글로벌) / 별도 파트너센터', note: '정산관리' },
              { ch: '마켓컬리', url: 'https://partners.kurly.com/', note: '파트너센터 → 정산' },
              { ch: '롯데온', url: 'https://partner.lotteon.com/', note: '셀러오피스 → 정산' },
              { ch: '롯데 홈쇼핑', url: 'https://partner.lotteimall.com/', note: '협력사 시스템 → 정산' },
              { ch: 'GS 샵', url: 'https://partner.gsshop.com/', note: '파트너센터 → 정산' },
              { ch: 'CJ온스타일', url: 'https://partner.cjonstyle.com/', note: '파트너센터 → 정산' },
              { ch: '에이블리', url: 'https://partners.a-bly.com/', note: '셀러센터 → 정산관리' },
              { ch: '토스', url: 'https://seller.toss.im/', note: '토스 셀러센터 → 정산' },
            ].map(({ ch, url, note }) => (
              <div key={ch} className="flex items-start gap-2 bg-slate-50 rounded-lg p-2">
                <span className="font-medium text-slate-800 min-w-[90px]">{ch}</span>
                <div>
                  <span className="text-blue-600 break-all">{url}</span>
                  <span className="text-slate-400 ml-1">→ {note}</span>
                </div>
              </div>
            ))}
          </div>
          <p className="text-slate-400 mt-2">* 위 URL은 참고용이며, 실제 URL은 채널별로 다를 수 있습니다. 직접 확인 후 입력하세요.</p>
          <p className="text-slate-400">* 복지몰, 대형마트, 편의점, B2B 채널은 별도 파트너 시스템이 있거나 수동 입력(엑셀 업로드)을 권장합니다.</p>
        </div>
      </details>

      {configs.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-12 text-center">
          <p className="text-slate-500 mb-3">아직 등록된 RPA 설정이 없습니다.</p>
          <p className="text-sm text-slate-400 mb-4">백엔드가 배포되면 채널 목록이 자동으로 표시됩니다.<br/>또는 &quot;RPA 수집&quot; 탭에서 개별 채널 수집을 시도하면 자동 생성됩니다.</p>
        </div>
      ) : (
        groupedConfigs.map(([category, items]) => (
          <div key={category} className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <div
              className="px-4 py-3 border-b border-slate-200 flex items-center gap-2"
              style={{ backgroundColor: `${CATEGORY_COLORS[category] || '#6B7280'}10` }}
            >
              <span
                className="inline-block w-3 h-3 rounded-full"
                style={{ backgroundColor: CATEGORY_COLORS[category] || '#6B7280' }}
              />
              <h4 className="font-semibold text-slate-800">{category}</h4>
              <span className="text-sm text-slate-500">({items.length})</span>
            </div>
            <div className="divide-y divide-slate-100">
              {items.map((config) => {
                const isTesting = testingChannelId === config.channel_id;
                const defaultInfo = defaults.find((d) => d.channel_name === config.channel_name);
                return (
                  <div key={config.channel_id} className="p-4 flex flex-wrap items-center gap-4">
                    <div className="flex-1 min-w-[200px]">
                      <h5 className="font-medium text-slate-800">{config.channel_name}</h5>
                      <div className="text-xs text-slate-500 mt-1 space-y-0.5">
                        <p>로그인 URL: {config.login_url || defaultInfo?.login_url || <span className="text-slate-400">미설정</span>}</p>
                        <p>정산 URL: {config.settlement_url || defaultInfo?.settlement_url || <span className="text-slate-400">미설정</span>}</p>
                        <p>수집 방식: {config.download_type || defaultInfo?.download_type || '-'}</p>
                        <p>자동 수집일: 매월 {config.auto_collect_day}일</p>
                        {config.login_id && <p>로그인 ID: {config.login_id}</p>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {/* Enable/Disable Toggle */}
                      <button
                        onClick={() => handleToggle(config)}
                        className={`relative w-12 h-6 rounded-full transition-colors ${config.is_enabled ? 'bg-emerald-500' : 'bg-slate-300'}`}
                      >
                        <span
                          className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${config.is_enabled ? 'left-6' : 'left-0.5'}`}
                        />
                      </button>
                      <button
                        onClick={() => handleTest(config)}
                        disabled={isTesting}
                        className="px-3 py-1.5 text-xs bg-amber-50 text-amber-600 rounded-lg hover:bg-amber-100 transition-colors disabled:opacity-50"
                      >
                        {isTesting ? '테스트 중...' : '연결 테스트'}
                      </button>
                      <button
                        onClick={() => handleEdit(config)}
                        className="px-3 py-1.5 text-xs bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors"
                      >
                        편집
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}

      {/* Edit Modal */}
      {showEditModal && editingConfig && (
        <RpaConfigEditModal
          config={editingConfig}
          onClose={() => { setShowEditModal(false); setEditingConfig(null); }}
          onSave={handleSaveConfig}
        />
      )}
    </div>
  );
}

// ─── RPA Config Edit Modal ───

function RpaConfigEditModal({
  config,
  onClose,
  onSave,
}: {
  config: RpaConfig;
  onClose: () => void;
  onSave: (c: RpaConfig) => void;
}) {
  const [form, setForm] = useState<RpaConfig>({ ...config });
  const [saving, setSaving] = useState(false);
  const [selectorsText, setSelectorsText] = useState(
    config.selectors ? JSON.stringify(config.selectors, null, 2) : '{}'
  );

  const updateField = (field: keyof RpaConfig, value: any) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const selectors = JSON.parse(selectorsText);
      onSave({ ...form, selectors });
    } catch {
      alert('Selectors JSON 형식이 올바르지 않습니다.');
    }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-6 border-b border-slate-200">
          <h3 className="text-lg font-semibold text-slate-800">{form.channel_name} RPA 설정</h3>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* 설정 안내 */}
          <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-xs text-blue-700 space-y-1">
            <p className="font-semibold">설정 방법:</p>
            <p>1. 해당 채널의 셀러 어드민에 웹브라우저로 직접 로그인해 보세요.</p>
            <p>2. 로그인 페이지 URL을 &quot;로그인 URL&quot;에 붙여넣으세요.</p>
            <p>3. 로그인 후 정산/결산 내역 페이지로 이동한 뒤 그 URL을 &quot;정산 페이지 URL&quot;에 붙여넣으세요.</p>
            <p>4. 사용하시는 ID/비밀번호를 입력하세요.</p>
            <p>5. 저장 후 &quot;연결 테스트&quot;로 정상 동작을 확인하세요.</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">로그인 URL <span className="text-red-500">*</span></label>
            <input
              type="url"
              value={form.login_url}
              onChange={(e) => updateField('login_url', e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="예: https://sell.smartstore.naver.com/"
            />
            <p className="text-xs text-slate-400 mt-1">셀러 어드민(파트너센터) 로그인 페이지 주소</p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">로그인 ID</label>
              <input
                type="text"
                value={form.login_id}
                onChange={(e) => updateField('login_id', e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">로그인 비밀번호</label>
              <input
                type="password"
                value={form.login_password}
                onChange={(e) => updateField('login_password', e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">정산 페이지 URL <span className="text-red-500">*</span></label>
            <input
              type="url"
              value={form.settlement_url}
              onChange={(e) => updateField('settlement_url', e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="예: https://sell.smartstore.naver.com/#/settlement/list"
            />
            <p className="text-xs text-slate-400 mt-1">로그인 후 정산/결산 내역을 확인하는 페이지의 URL</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">CSS Selectors (JSON) — 선택사항</label>
            <textarea
              value={selectorsText}
              onChange={(e) => setSelectorsText(e.target.value)}
              rows={4}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder='기본 셀렉터로 동작하지 않을 때만 입력&#10;예: {"login_id_sel": "input#userId", "login_pw_sel": "input#password", "submit_sel": "button.login-btn"}'
            />
            <p className="text-xs text-slate-400 mt-1">기본 셀렉터로 로그인이 안 될 때만 커스터마이징하세요. 비워두면 자동 탐지합니다.</p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">다운로드 방식</label>
              <select
                value={form.download_type}
                onChange={(e) => updateField('download_type', e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">선택</option>
                <option value="scraping">웹 스크래핑</option>
                <option value="excel_download">엑셀 다운로드</option>
                <option value="api">API</option>
                <option value="csv_download">CSV 다운로드</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">자동 수집일</label>
              <input
                type="number"
                min={1}
                max={28}
                value={form.auto_collect_day}
                onChange={(e) => updateField('auto_collect_day', Number(e.target.value))}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
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
    try {
      const data = await fetchApi('/api/settlement/reports');
      setReports(Array.isArray(data) ? data : data.reports || []);
    } catch (err: any) {
      setToast({ type: 'error', message: `리포트 목록 로드 실패: ${err.message}` });
    } finally {
      setIsLoading(false);
    }
  }, [setToast]);

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
    try {
      const params = new URLSearchParams();
      if (filterChannel) params.set('channel_name', filterChannel);
      if (filterStatus) params.set('status', filterStatus);
      params.set('limit', '100');
      const data = await fetchApi(`/api/settlement/collection-logs?${params.toString()}`);
      setLogs(Array.isArray(data) ? data : data.logs || []);
    } catch (err: any) {
      setToast({ type: 'error', message: `로그 로드 실패: ${err.message}` });
    } finally {
      setIsLoading(false);
    }
  }, [filterChannel, filterStatus, setToast]);

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
