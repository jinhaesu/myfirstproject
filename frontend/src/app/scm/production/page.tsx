'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Navigation } from '@/components/layout/Navigation';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts';

// ─────────────────────────────────────────────
// API helper
// ─────────────────────────────────────────────
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

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────
type ProductionStatus = '계획' | '원자재준비' | '생산중' | '품질검사' | '완료' | '지연';
type Category = '스킨케어' | '메이크업' | '헤어케어' | '바디케어' | '기타';

interface ProductionPlan {
  id: string;
  productName: string;
  category: Category;
  plannedQty: number;
  producedQty: number;
  startDate: string;        // YYYY-MM-DD
  endDate: string;           // YYYY-MM-DD
  status: ProductionStatus;
  manager: string;
  memo: string;
}

type SortField = 'productName' | 'category' | 'plannedQty' | 'producedQty' | 'startDate' | 'endDate' | 'status' | 'manager';
type SortDirection = 'asc' | 'desc';

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────
const STATUS_OPTIONS: ProductionStatus[] = ['계획', '원자재준비', '생산중', '품질검사', '완료', '지연'];
const CATEGORY_OPTIONS: Category[] = ['스킨케어', '메이크업', '헤어케어', '바디케어', '기타'];

const STATUS_COLORS: Record<ProductionStatus, { bg: string; text: string; bar: string }> = {
  '계획':     { bg: 'bg-slate-100',  text: 'text-slate-700',  bar: '#94a3b8' },
  '원자재준비': { bg: 'bg-amber-100',  text: 'text-amber-700',  bar: '#f59e0b' },
  '생산중':   { bg: 'bg-blue-100',   text: 'text-blue-700',   bar: '#3b82f6' },
  '품질검사':  { bg: 'bg-purple-100', text: 'text-purple-700', bar: '#8b5cf6' },
  '완료':     { bg: 'bg-emerald-100', text: 'text-emerald-700', bar: '#10b981' },
  '지연':     { bg: 'bg-red-100',    text: 'text-red-700',    bar: '#ef4444' },
};

const CHART_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

// ─────────────────────────────────────────────
// Sample data generator
// ─────────────────────────────────────────────
const generateSampleData = (): ProductionPlan[] => [
  {
    id: 'PP-001',
    productName: '시카 리페어 크림 50ml',
    category: '스킨케어',
    plannedQty: 5000,
    producedQty: 5000,
    startDate: '2026-03-01',
    endDate: '2026-03-15',
    status: '완료',
    manager: '김민수',
    memo: '봄 시즌 리뉴얼 제품',
  },
  {
    id: 'PP-002',
    productName: '히알루론산 세럼 30ml',
    category: '스킨케어',
    plannedQty: 8000,
    producedQty: 6200,
    startDate: '2026-03-03',
    endDate: '2026-03-20',
    status: '생산중',
    manager: '이지은',
    memo: '스마트스토어 프로모션 대비',
  },
  {
    id: 'PP-003',
    productName: '톤업 선크림 SPF50+ 60ml',
    category: '스킨케어',
    plannedQty: 12000,
    producedQty: 3600,
    startDate: '2026-03-05',
    endDate: '2026-03-25',
    status: '생산중',
    manager: '박서연',
    memo: '여름 선제 생산',
  },
  {
    id: 'PP-004',
    productName: '벨벳 매트 립스틱 #로즈레드',
    category: '메이크업',
    plannedQty: 3000,
    producedQty: 3000,
    startDate: '2026-02-20',
    endDate: '2026-03-10',
    status: '완료',
    manager: '최유나',
    memo: '신규 색상 출시',
  },
  {
    id: 'PP-005',
    productName: '글로우 쿠션 파운데이션 15g',
    category: '메이크업',
    plannedQty: 6000,
    producedQty: 5400,
    startDate: '2026-03-01',
    endDate: '2026-03-18',
    status: '품질검사',
    manager: '최유나',
    memo: '리필 포함 세트 구성',
  },
  {
    id: 'PP-006',
    productName: '케라틴 실크 샴푸 500ml',
    category: '헤어케어',
    plannedQty: 10000,
    producedQty: 2000,
    startDate: '2026-03-10',
    endDate: '2026-03-28',
    status: '원자재준비',
    manager: '정하늘',
    memo: '원자재 도착 대기 중',
  },
  {
    id: 'PP-007',
    productName: '두피 스케일링 토닉 150ml',
    category: '헤어케어',
    plannedQty: 4000,
    producedQty: 0,
    startDate: '2026-03-15',
    endDate: '2026-03-30',
    status: '계획',
    manager: '정하늘',
    memo: '신규 라인업 추가',
  },
  {
    id: 'PP-008',
    productName: '시어버터 바디로션 300ml',
    category: '바디케어',
    plannedQty: 7000,
    producedQty: 7000,
    startDate: '2026-02-15',
    endDate: '2026-03-05',
    status: '완료',
    manager: '김민수',
    memo: '대용량 리뉴얼',
  },
  {
    id: 'PP-009',
    productName: '그린티 클렌징 오일 200ml',
    category: '스킨케어',
    plannedQty: 5000,
    producedQty: 1500,
    startDate: '2026-02-25',
    endDate: '2026-03-08',
    status: '지연',
    manager: '이지은',
    memo: '용기 납품 지연으로 일정 변경',
  },
  {
    id: 'PP-010',
    productName: '아이브로우 펜슬 세트',
    category: '메이크업',
    plannedQty: 4000,
    producedQty: 0,
    startDate: '2026-03-18',
    endDate: '2026-04-05',
    status: '계획',
    manager: '최유나',
    memo: '3색 세트 패키지',
  },
  {
    id: 'PP-011',
    productName: '코코넛 바디스크럽 250g',
    category: '바디케어',
    plannedQty: 3500,
    producedQty: 3500,
    startDate: '2026-02-10',
    endDate: '2026-03-01',
    status: '완료',
    manager: '박서연',
    memo: '리미티드 에디션',
  },
  {
    id: 'PP-012',
    productName: '레티놀 나이트 크림 40ml',
    category: '스킨케어',
    plannedQty: 6000,
    producedQty: 4800,
    startDate: '2026-03-02',
    endDate: '2026-03-16',
    status: '품질검사',
    manager: '김민수',
    memo: '안정성 테스트 진행 중',
  },
  {
    id: 'PP-013',
    productName: '딥 클렌징 폼 150ml',
    category: '스킨케어',
    plannedQty: 9000,
    producedQty: 2700,
    startDate: '2026-03-07',
    endDate: '2026-03-10',
    status: '지연',
    manager: '이지은',
    memo: '포장재 불량으로 재발주',
  },
  {
    id: 'PP-014',
    productName: '볼륨 마스카라 블랙',
    category: '메이크업',
    plannedQty: 5000,
    producedQty: 3000,
    startDate: '2026-03-08',
    endDate: '2026-03-22',
    status: '생산중',
    manager: '최유나',
    memo: '쿠팡 행사 대비 물량',
  },
];

// ─────────────────────────────────────────────
// Monthly summary data for chart
// ─────────────────────────────────────────────
const MONTHLY_CHART_DATA = [
  { month: '2025-10', 계획: 42000, 실적: 38500 },
  { month: '2025-11', 계획: 50000, 실적: 47200 },
  { month: '2025-12', 계획: 55000, 실적: 51000 },
  { month: '2026-01', 계획: 48000, 실적: 46800 },
  { month: '2026-02', 계획: 52000, 실적: 49500 },
  { month: '2026-03', 계획: 87500, 실적: 45200 },
];

// ─────────────────────────────────────────────
// Utility functions
// ─────────────────────────────────────────────
const formatNumber = (n: number): string => n.toLocaleString('ko-KR');

const formatDate = (d: string): string => {
  const date = new Date(d);
  return `${date.getMonth() + 1}/${date.getDate()}`;
};

const daysBetween = (a: string, b: string): number => {
  const msPerDay = 86400000;
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / msPerDay);
};

const progressPercent = (produced: number, planned: number): number => {
  if (planned === 0) return 0;
  return Math.min(100, Math.round((produced / planned) * 100));
};

const uuid = (): string => `PP-${Date.now().toString(36).toUpperCase()}`;

// ─────────────────────────────────────────────
// Excel download helper
// ─────────────────────────────────────────────
const downloadExcel = (plans: ProductionPlan[]) => {
  const BOM = '\uFEFF';
  const headers = ['ID', '상품명', '카테고리', '계획수량', '생산수량', '진행률(%)', '시작일', '완료예정일', '상태', '담당자', '메모'];
  const rows = plans.map(p => [
    p.id,
    p.productName,
    p.category,
    p.plannedQty,
    p.producedQty,
    progressPercent(p.producedQty, p.plannedQty),
    p.startDate,
    p.endDate,
    p.status,
    p.manager,
    p.memo,
  ]);
  const csv = [headers, ...rows].map(r => r.map(c => `"${c}"`).join(',')).join('\n');
  const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `생산계획_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
};

// ─────────────────────────────────────────────
// Custom Tooltip for Recharts
// ─────────────────────────────────────────────
const CustomBarTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="bg-white px-4 py-3 rounded-xl shadow-lg border border-slate-200 text-sm">
      <p className="font-semibold text-slate-800 mb-1">{label}</p>
      {payload.map((entry: any, i: number) => (
        <p key={i} style={{ color: entry.color }}>
          {entry.name}: {formatNumber(entry.value)}개
        </p>
      ))}
    </div>
  );
};

const CustomPieTooltip = ({ active, payload }: any) => {
  if (!active || !payload || !payload.length) return null;
  const d = payload[0];
  return (
    <div className="bg-white px-4 py-3 rounded-xl shadow-lg border border-slate-200 text-sm">
      <p className="font-semibold text-slate-800">{d.name}</p>
      <p style={{ color: d.payload.fill }}>{formatNumber(d.value)}개</p>
    </div>
  );
};

// ═══════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════
export default function ProductionPlanningPage() {
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();

  // ── State ──
  const [plans, setPlans] = useState<ProductionPlan[]>(generateSampleData);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);
  const [statusFilter, setStatusFilter] = useState<ProductionStatus | '전체'>('전체');
  const [sortField, setSortField] = useState<SortField>('startDate');
  const [sortDir, setSortDir] = useState<SortDirection>('asc');
  const [viewMode, setViewMode] = useState<'table' | 'timeline'>('table');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<ProductionPlan | null>(null);

  // Form state
  const emptyForm = {
    productName: '',
    category: '스킨케어' as Category,
    plannedQty: 0,
    startDate: '',
    endDate: '',
    manager: '',
    memo: '',
  };
  const [form, setForm] = useState(emptyForm);

  // ── Auth guard ──
  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
    }
  }, [user, authLoading, router]);

  // ── Derived data ──
  const filteredPlans = useMemo(() => {
    const yearMonth = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}`;
    let result = plans.filter(p => {
      const startYM = p.startDate.slice(0, 7);
      const endYM = p.endDate.slice(0, 7);
      return startYM <= yearMonth && endYM >= yearMonth;
    });
    if (statusFilter !== '전체') {
      result = result.filter(p => p.status === statusFilter);
    }
    return result;
  }, [plans, selectedYear, selectedMonth, statusFilter]);

  const sortedPlans = useMemo(() => {
    const sorted = [...filteredPlans].sort((a, b) => {
      let aVal: string | number = a[sortField];
      let bVal: string | number = b[sortField];
      if (typeof aVal === 'string') aVal = aVal.toLowerCase();
      if (typeof bVal === 'string') bVal = bVal.toLowerCase();
      if (aVal < bVal) return sortDir === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [filteredPlans, sortField, sortDir]);

  // ── Summary cards ──
  const summary = useMemo(() => {
    const total = filteredPlans.length;
    const inProgress = filteredPlans.filter(p => ['원자재준비', '생산중', '품질검사'].includes(p.status)).length;
    const completed = filteredPlans.filter(p => p.status === '완료').length;
    const delayed = filteredPlans.filter(p => p.status === '지연').length;
    const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;
    return { total, inProgress, completionRate, delayed };
  }, [filteredPlans]);

  // ── Category chart data ──
  const categoryChartData = useMemo(() => {
    const map: Record<string, number> = {};
    filteredPlans.forEach(p => {
      map[p.category] = (map[p.category] || 0) + p.plannedQty;
    });
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  }, [filteredPlans]);

  // ── Timeline calculations ──
  const timelineData = useMemo(() => {
    if (sortedPlans.length === 0) return { plans: sortedPlans, minDate: '', maxDate: '', totalDays: 0 };
    const allDates = sortedPlans.flatMap(p => [p.startDate, p.endDate]);
    const minDate = allDates.reduce((a, b) => (a < b ? a : b));
    const maxDate = allDates.reduce((a, b) => (a > b ? a : b));
    const totalDays = daysBetween(minDate, maxDate) + 1;
    return { plans: sortedPlans, minDate, maxDate, totalDays: Math.max(totalDays, 1) };
  }, [sortedPlans]);

  // ── Handlers ──
  const handleSort = useCallback((field: SortField) => {
    if (sortField === field) {
      setSortDir(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  }, [sortField]);

  const openAddModal = useCallback(() => {
    setEditingPlan(null);
    setForm(emptyForm);
    setModalOpen(true);
  }, []);

  const openEditModal = useCallback((plan: ProductionPlan) => {
    setEditingPlan(plan);
    setForm({
      productName: plan.productName,
      category: plan.category,
      plannedQty: plan.plannedQty,
      startDate: plan.startDate,
      endDate: plan.endDate,
      manager: plan.manager,
      memo: plan.memo,
    });
    setModalOpen(true);
  }, []);

  const closeModal = useCallback(() => {
    setModalOpen(false);
    setEditingPlan(null);
    setForm(emptyForm);
  }, []);

  const handleSubmit = useCallback(() => {
    if (!form.productName || !form.startDate || !form.endDate || !form.manager) return;

    if (editingPlan) {
      setPlans(prev =>
        prev.map(p =>
          p.id === editingPlan.id
            ? {
                ...p,
                productName: form.productName,
                category: form.category,
                plannedQty: form.plannedQty,
                startDate: form.startDate,
                endDate: form.endDate,
                manager: form.manager,
                memo: form.memo,
              }
            : p
        )
      );
    } else {
      const newPlan: ProductionPlan = {
        id: uuid(),
        productName: form.productName,
        category: form.category,
        plannedQty: form.plannedQty,
        producedQty: 0,
        startDate: form.startDate,
        endDate: form.endDate,
        status: '계획',
        manager: form.manager,
        memo: form.memo,
      };
      setPlans(prev => [...prev, newPlan]);
    }
    closeModal();
  }, [form, editingPlan, closeModal]);

  const handleDelete = useCallback((id: string) => {
    if (window.confirm('정말 삭제하시겠습니까?')) {
      setPlans(prev => prev.filter(p => p.id !== id));
    }
  }, []);

  // ── Sort indicator ──
  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <span className="text-slate-300 ml-1">&#x25B4;&#x25BE;</span>;
    return <span className="text-indigo-500 ml-1">{sortDir === 'asc' ? '▲' : '▼'}</span>;
  };

  // ── Auth loading / guard ──
  if (authLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-slate-600">로딩 중...</p>
        </div>
      </div>
    );
  }

  if (!user) return null;

  // ── Today string for timeline ──
  const todayStr = new Date().toISOString().slice(0, 10);

  // ═══════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════
  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
      <Navigation />

      <div className="max-w-7xl mx-auto px-4 py-6">

        {/* ── Page Header ── */}
        <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">생산계획</h1>
            <p className="text-slate-500 mt-1">생산 일정을 계획하고 진행 현황을 관리하세요</p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            {/* Year / Month selector */}
            <div className="flex items-center gap-2 bg-white px-3 py-2 rounded-xl border border-slate-200 shadow-sm">
              <select
                value={selectedYear}
                onChange={e => setSelectedYear(Number(e.target.value))}
                className="text-sm font-medium text-slate-700 bg-transparent outline-none cursor-pointer"
              >
                {[2024, 2025, 2026, 2027].map(y => (
                  <option key={y} value={y}>{y}년</option>
                ))}
              </select>
              <select
                value={selectedMonth}
                onChange={e => setSelectedMonth(Number(e.target.value))}
                className="text-sm font-medium text-slate-700 bg-transparent outline-none cursor-pointer"
              >
                {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                  <option key={m} value={m}>{m}월</option>
                ))}
              </select>
            </div>

            {/* Action buttons */}
            <button
              onClick={openAddModal}
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors shadow-sm"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              생산계획 추가
            </button>
            <button
              onClick={() => downloadExcel(sortedPlans)}
              className="flex items-center gap-2 bg-white hover:bg-slate-50 text-slate-700 px-4 py-2 rounded-xl text-sm font-medium border border-slate-200 transition-colors shadow-sm"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
              </svg>
              Excel 다운로드
            </button>
          </div>
        </div>

        {/* ── Summary Cards ── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {/* 이번달 계획건수 */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-slate-500">이번달 계획건수</span>
              <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
              </div>
            </div>
            <p className="text-3xl font-bold text-slate-800">{summary.total}<span className="text-lg font-medium text-slate-400 ml-1">건</span></p>
          </div>

          {/* 진행중 */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-slate-500">진행중</span>
              <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
            </div>
            <p className="text-3xl font-bold text-slate-800">{summary.inProgress}<span className="text-lg font-medium text-slate-400 ml-1">건</span></p>
          </div>

          {/* 완료율 */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-slate-500">완료율</span>
              <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
            </div>
            <p className="text-3xl font-bold text-slate-800">{summary.completionRate}<span className="text-lg font-medium text-slate-400 ml-1">%</span></p>
            <div className="mt-2 w-full bg-slate-100 rounded-full h-2">
              <div
                className="bg-emerald-500 h-2 rounded-full transition-all duration-500"
                style={{ width: `${summary.completionRate}%` }}
              />
            </div>
          </div>

          {/* 지연건수 */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-slate-500">지연건수</span>
              <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
            </div>
            <p className="text-3xl font-bold text-slate-800">{summary.delayed}<span className="text-lg font-medium text-slate-400 ml-1">건</span></p>
            {summary.delayed > 0 && (
              <p className="text-xs text-red-500 mt-1 font-medium">즉시 확인이 필요합니다</p>
            )}
          </div>
        </div>

        {/* ── View Toggle & Status Filter ── */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 mb-6">
          <div className="p-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-slate-800">생산계획 목록</h2>
              <span className="text-sm text-slate-400">({sortedPlans.length}건)</span>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              {/* Status filter */}
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setStatusFilter('전체')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    statusFilter === '전체'
                      ? 'bg-indigo-100 text-indigo-700'
                      : 'bg-slate-50 text-slate-500 hover:bg-slate-100'
                  }`}
                >
                  전체
                </button>
                {STATUS_OPTIONS.map(s => (
                  <button
                    key={s}
                    onClick={() => setStatusFilter(s)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      statusFilter === s
                        ? `${STATUS_COLORS[s].bg} ${STATUS_COLORS[s].text}`
                        : 'bg-slate-50 text-slate-500 hover:bg-slate-100'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
              {/* View toggle */}
              <div className="flex bg-slate-100 rounded-lg p-0.5">
                <button
                  onClick={() => setViewMode('table')}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    viewMode === 'table' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'
                  }`}
                >
                  테이블
                </button>
                <button
                  onClick={() => setViewMode('timeline')}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    viewMode === 'timeline' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'
                  }`}
                >
                  타임라인
                </button>
              </div>
            </div>
          </div>

          {/* ── Table View ── */}
          {viewMode === 'table' && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100">
                    {([
                      { field: 'productName' as SortField, label: '상품명' },
                      { field: 'category' as SortField, label: '카테고리' },
                      { field: 'plannedQty' as SortField, label: '계획수량' },
                      { field: 'producedQty' as SortField, label: '생산수량' },
                    ]).map(col => (
                      <th
                        key={col.field}
                        onClick={() => handleSort(col.field)}
                        className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider cursor-pointer hover:text-slate-700 select-none"
                      >
                        {col.label}<SortIcon field={col.field} />
                      </th>
                    ))}
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                      진행률
                    </th>
                    {([
                      { field: 'startDate' as SortField, label: '시작일' },
                      { field: 'endDate' as SortField, label: '완료예정일' },
                      { field: 'status' as SortField, label: '상태' },
                      { field: 'manager' as SortField, label: '담당자' },
                    ]).map(col => (
                      <th
                        key={col.field}
                        onClick={() => handleSort(col.field)}
                        className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider cursor-pointer hover:text-slate-700 select-none"
                      >
                        {col.label}<SortIcon field={col.field} />
                      </th>
                    ))}
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                      액션
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedPlans.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="text-center py-16 text-slate-400">
                        <div className="flex flex-col items-center gap-2">
                          <svg xmlns="http://www.w3.org/2000/svg" className="w-12 h-12 text-slate-200" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                          </svg>
                          <p className="text-sm">해당 기간에 등록된 생산계획이 없습니다.</p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    sortedPlans.map(plan => {
                      const progress = progressPercent(plan.producedQty, plan.plannedQty);
                      const sc = STATUS_COLORS[plan.status];
                      return (
                        <tr key={plan.id} className="border-b border-slate-50 hover:bg-slate-50/50 transition-colors">
                          <td className="px-4 py-3">
                            <div>
                              <p className="font-medium text-slate-800">{plan.productName}</p>
                              <p className="text-xs text-slate-400 mt-0.5">{plan.id}</p>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <span className="inline-block px-2.5 py-1 rounded-lg bg-slate-50 text-xs font-medium text-slate-600">
                              {plan.category}
                            </span>
                          </td>
                          <td className="px-4 py-3 font-medium text-slate-700 text-right tabular-nums">
                            {formatNumber(plan.plannedQty)}
                          </td>
                          <td className="px-4 py-3 font-medium text-slate-700 text-right tabular-nums">
                            {formatNumber(plan.producedQty)}
                          </td>
                          <td className="px-4 py-3 min-w-[120px]">
                            <div className="flex items-center gap-2">
                              <div className="flex-1 bg-slate-100 rounded-full h-2 overflow-hidden">
                                <div
                                  className="h-full rounded-full transition-all duration-500"
                                  style={{
                                    width: `${progress}%`,
                                    backgroundColor: sc.bar,
                                  }}
                                />
                              </div>
                              <span className="text-xs font-medium text-slate-500 w-9 text-right tabular-nums">{progress}%</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-slate-600 tabular-nums">{plan.startDate}</td>
                          <td className="px-4 py-3 text-slate-600 tabular-nums">{plan.endDate}</td>
                          <td className="px-4 py-3">
                            <span className={`inline-block px-2.5 py-1 rounded-lg text-xs font-semibold ${sc.bg} ${sc.text}`}>
                              {plan.status}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-slate-600">{plan.manager}</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => openEditModal(plan)}
                                className="p-1.5 rounded-lg hover:bg-blue-50 text-slate-400 hover:text-blue-600 transition-colors"
                                title="수정"
                              >
                                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                </svg>
                              </button>
                              <button
                                onClick={() => handleDelete(plan.id)}
                                className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-600 transition-colors"
                                title="삭제"
                              >
                                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Timeline View (Gantt-style) ── */}
          {viewMode === 'timeline' && (
            <div className="p-4">
              {sortedPlans.length === 0 ? (
                <div className="text-center py-16 text-slate-400">
                  <p className="text-sm">해당 기간에 등록된 생산계획이 없습니다.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  {/* Header: date labels */}
                  <div className="min-w-[900px]">
                    <div className="flex mb-2">
                      {/* Product name column */}
                      <div className="w-48 flex-shrink-0 px-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                        상품명
                      </div>
                      {/* Timeline header */}
                      <div className="flex-1 relative h-6">
                        {(() => {
                          const { minDate, totalDays } = timelineData;
                          if (totalDays <= 0) return null;
                          const markers: { date: string; offset: number }[] = [];
                          for (let i = 0; i <= totalDays; i += Math.max(1, Math.floor(totalDays / 10))) {
                            const d = new Date(minDate);
                            d.setDate(d.getDate() + i);
                            const ds = d.toISOString().slice(0, 10);
                            markers.push({ date: ds, offset: (i / totalDays) * 100 });
                          }
                          return markers.map((m, i) => (
                            <span
                              key={i}
                              className="absolute text-[10px] text-slate-400 -translate-x-1/2 whitespace-nowrap"
                              style={{ left: `${m.offset}%` }}
                            >
                              {formatDate(m.date)}
                            </span>
                          ));
                        })()}
                      </div>
                    </div>

                    {/* Timeline rows */}
                    {sortedPlans.map(plan => {
                      const { minDate, totalDays } = timelineData;
                      const startOffset = daysBetween(minDate, plan.startDate);
                      const duration = daysBetween(plan.startDate, plan.endDate) + 1;
                      const leftPct = (startOffset / totalDays) * 100;
                      const widthPct = (duration / totalDays) * 100;
                      const sc = STATUS_COLORS[plan.status];
                      const progress = progressPercent(plan.producedQty, plan.plannedQty);

                      return (
                        <div key={plan.id} className="flex items-center mb-1.5 group">
                          {/* Product name */}
                          <div className="w-48 flex-shrink-0 px-2">
                            <p className="text-xs font-medium text-slate-700 truncate" title={plan.productName}>
                              {plan.productName}
                            </p>
                            <p className="text-[10px] text-slate-400">{plan.manager}</p>
                          </div>
                          {/* Timeline bar */}
                          <div className="flex-1 relative h-8">
                            {/* Background track */}
                            <div className="absolute inset-0 bg-slate-50 rounded" />
                            {/* Bar background (full duration) */}
                            <div
                              className="absolute top-1 h-6 rounded-md opacity-30 transition-all"
                              style={{
                                left: `${leftPct}%`,
                                width: `${Math.max(widthPct, 1)}%`,
                                backgroundColor: sc.bar,
                              }}
                            />
                            {/* Bar progress fill */}
                            <div
                              className="absolute top-1 h-6 rounded-md transition-all"
                              style={{
                                left: `${leftPct}%`,
                                width: `${Math.max((widthPct * progress) / 100, 0.5)}%`,
                                backgroundColor: sc.bar,
                              }}
                            />
                            {/* Label on bar */}
                            <div
                              className="absolute top-1 h-6 flex items-center overflow-hidden pointer-events-none"
                              style={{
                                left: `${leftPct}%`,
                                width: `${Math.max(widthPct, 1)}%`,
                              }}
                            >
                              <span className="text-[10px] font-semibold text-white ml-1.5 drop-shadow-sm truncate">
                                {progress > 10 ? `${progress}%` : ''}
                              </span>
                            </div>
                            {/* Today line */}
                            {todayStr >= minDate && todayStr <= timelineData.maxDate && (
                              <div
                                className="absolute top-0 bottom-0 w-px bg-red-400 z-10"
                                style={{
                                  left: `${(daysBetween(minDate, todayStr) / totalDays) * 100}%`,
                                }}
                              >
                                <div className="absolute -top-1 -translate-x-1/2 w-2 h-2 bg-red-400 rounded-full" />
                              </div>
                            )}
                            {/* Hover tooltip */}
                            <div className="absolute -top-9 left-1/2 -translate-x-1/2 hidden group-hover:block bg-slate-800 text-white text-[10px] px-2 py-1 rounded whitespace-nowrap z-20">
                              {plan.startDate} ~ {plan.endDate} | {plan.status} | {progress}%
                            </div>
                          </div>
                          {/* Status badge */}
                          <div className="w-16 flex-shrink-0 pl-2">
                            <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${sc.bg} ${sc.text}`}>
                              {plan.status}
                            </span>
                          </div>
                        </div>
                      );
                    })}

                    {/* Today legend */}
                    <div className="flex items-center gap-2 mt-4 ml-48 text-xs text-slate-400">
                      <div className="w-3 h-3 bg-red-400 rounded-full" />
                      <span>오늘 ({todayStr})</span>
                      <span className="mx-2">|</span>
                      <div className="w-6 h-3 bg-blue-400 rounded opacity-30" />
                      <span>전체 기간</span>
                      <div className="w-6 h-3 bg-blue-400 rounded ml-1" />
                      <span>진행 완료분</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Charts Section ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* 월별 계획 vs 실적 */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
            <h3 className="text-base font-bold text-slate-800 mb-4">월별 계획 vs 실적</h3>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={MONTHLY_CHART_DATA} barGap={4}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis
                    dataKey="month"
                    tick={{ fill: '#64748b', fontSize: 12 }}
                    tickLine={false}
                    axisLine={{ stroke: '#e2e8f0' }}
                  />
                  <YAxis
                    tick={{ fill: '#64748b', fontSize: 12 }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}k`}
                  />
                  <Tooltip content={<CustomBarTooltip />} />
                  <Legend
                    iconType="circle"
                    iconSize={8}
                    wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
                  />
                  <Bar dataKey="계획" fill="#818cf8" radius={[4, 4, 0, 0]} barSize={28} />
                  <Bar dataKey="실적" fill="#34d399" radius={[4, 4, 0, 0]} barSize={28} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* 카테고리별 생산현황 */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
            <h3 className="text-base font-bold text-slate-800 mb-4">카테고리별 생산현황</h3>
            <div className="h-72">
              {categoryChartData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={categoryChartData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={100}
                      paddingAngle={3}
                      dataKey="value"
                      nameKey="name"
                      stroke="none"
                    >
                      {categoryChartData.map((_, i) => (
                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip content={<CustomPieTooltip />} />
                    <Legend
                      iconType="circle"
                      iconSize={8}
                      layout="vertical"
                      align="right"
                      verticalAlign="middle"
                      wrapperStyle={{ fontSize: 12 }}
                      formatter={(value: string) => (
                        <span className="text-slate-600">{value}</span>
                      )}
                    />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-full text-slate-400 text-sm">
                  데이터가 없습니다.
                </div>
              )}
            </div>
            {/* Category breakdown */}
            {categoryChartData.length > 0 && (
              <div className="mt-3 grid grid-cols-2 gap-2">
                {categoryChartData.map((item, i) => (
                  <div key={item.name} className="flex items-center justify-between px-3 py-2 bg-slate-50 rounded-lg">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }}
                      />
                      <span className="text-xs text-slate-600">{item.name}</span>
                    </div>
                    <span className="text-xs font-semibold text-slate-700">{formatNumber(item.value)}개</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Status Distribution Mini Cards ── */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 mb-6">
          <h3 className="text-base font-bold text-slate-800 mb-4">상태별 현황</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {STATUS_OPTIONS.map(status => {
              const count = filteredPlans.filter(p => p.status === status).length;
              const sc = STATUS_COLORS[status];
              return (
                <button
                  key={status}
                  onClick={() => setStatusFilter(statusFilter === status ? '전체' : status)}
                  className={`flex flex-col items-center gap-1 p-3 rounded-xl border-2 transition-all ${
                    statusFilter === status
                      ? 'border-indigo-300 bg-indigo-50'
                      : 'border-transparent bg-slate-50 hover:border-slate-200'
                  }`}
                >
                  <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${sc.bg} ${sc.text}`}>
                    {status}
                  </span>
                  <span className="text-xl font-bold text-slate-800">{count}</span>
                  <span className="text-[10px] text-slate-400">건</span>
                </button>
              );
            })}
          </div>
        </div>

      </div>

      {/* ═══════════════════════════════════════════════ */}
      {/* Add / Edit Modal                               */}
      {/* ═══════════════════════════════════════════════ */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={closeModal} />

          {/* Modal panel */}
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            {/* Header */}
            <div className="sticky top-0 bg-white border-b border-slate-100 px-6 py-4 rounded-t-2xl flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-800">
                {editingPlan ? '생산계획 수정' : '생산계획 추가'}
              </h3>
              <button
                onClick={closeModal}
                className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Body */}
            <div className="px-6 py-5 space-y-4">
              {/* 상품명 */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  상품명 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={form.productName}
                  onChange={e => setForm(prev => ({ ...prev, productName: e.target.value }))}
                  placeholder="상품명을 입력하세요"
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-shadow"
                />
              </div>

              {/* 카테고리 */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  카테고리 <span className="text-red-500">*</span>
                </label>
                <select
                  value={form.category}
                  onChange={e => setForm(prev => ({ ...prev, category: e.target.value as Category }))}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white transition-shadow"
                >
                  {CATEGORY_OPTIONS.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>

              {/* 계획수량 */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  계획수량 <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  min={0}
                  value={form.plannedQty || ''}
                  onChange={e => setForm(prev => ({ ...prev, plannedQty: Number(e.target.value) }))}
                  placeholder="0"
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-shadow tabular-nums"
                />
              </div>

              {/* 날짜 row */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">
                    시작일 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="date"
                    value={form.startDate}
                    onChange={e => setForm(prev => ({ ...prev, startDate: e.target.value }))}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-shadow"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">
                    완료예정일 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="date"
                    value={form.endDate}
                    onChange={e => setForm(prev => ({ ...prev, endDate: e.target.value }))}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-shadow"
                  />
                </div>
              </div>

              {/* 담당자 */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  담당자 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={form.manager}
                  onChange={e => setForm(prev => ({ ...prev, manager: e.target.value }))}
                  placeholder="담당자 이름"
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-shadow"
                />
              </div>

              {/* 메모 */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  메모
                </label>
                <textarea
                  value={form.memo}
                  onChange={e => setForm(prev => ({ ...prev, memo: e.target.value }))}
                  placeholder="생산 관련 메모를 입력하세요"
                  rows={3}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none transition-shadow"
                />
              </div>
            </div>

            {/* Footer */}
            <div className="sticky bottom-0 bg-white border-t border-slate-100 px-6 py-4 rounded-b-2xl flex items-center justify-end gap-3">
              <button
                onClick={closeModal}
                className="px-5 py-2.5 rounded-xl border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
              >
                취소
              </button>
              <button
                onClick={handleSubmit}
                disabled={!form.productName || !form.startDate || !form.endDate || !form.manager}
                className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors shadow-sm"
              >
                {editingPlan ? '수정 완료' : '등록하기'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
