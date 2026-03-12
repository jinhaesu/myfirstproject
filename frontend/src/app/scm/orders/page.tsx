'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Navigation } from '@/components/layout/Navigation';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts';

// ─────────────────────────────────────────────
// API Helper
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
  } catch {
    return defaultValue;
  }
};

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

type OrderStatus = '신규접수' | '확인완료' | '배송준비' | '배송중' | '배송완료' | '취소' | '반품';
type TabKey = '전체' | '신규접수' | '확인완료' | '배송준비' | '배송중' | '배송완료' | '취소/반품';

interface Order {
  id: string;
  orderNumber: string;
  orderDate: string;
  channel: string;
  customerName: string;
  productName: string;
  quantity: number;
  paymentAmount: number;
  status: OrderStatus;
  phone: string;
  address: string;
  trackingNumber?: string;
  memo?: string;
}

interface DailyOrderTrend {
  date: string;
  orders: number;
  revenue: number;
}

interface ChannelRatio {
  name: string;
  value: number;
}

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────

const CHANNELS = ['스마트스토어', '쿠팡', '11번가', '지마켓', '옥션', '카페24', '카카오선물하기', '에이블리'];

const STATUS_LIST: OrderStatus[] = ['신규접수', '확인완료', '배송준비', '배송중', '배송완료', '취소', '반품'];

const TAB_LIST: TabKey[] = ['전체', '신규접수', '확인완료', '배송준비', '배송중', '배송완료', '취소/반품'];

const STATUS_COLORS: Record<OrderStatus, string> = {
  '신규접수': 'bg-blue-100 text-blue-700',
  '확인완료': 'bg-indigo-100 text-indigo-700',
  '배송준비': 'bg-amber-100 text-amber-700',
  '배송중': 'bg-emerald-100 text-emerald-700',
  '배송완료': 'bg-slate-100 text-slate-600',
  '취소': 'bg-red-100 text-red-700',
  '반품': 'bg-orange-100 text-orange-700',
};

const STATUS_NEXT: Partial<Record<OrderStatus, OrderStatus>> = {
  '신규접수': '확인완료',
  '확인완료': '배송준비',
  '배송준비': '배송중',
  '배송중': '배송완료',
};

const CHART_COLORS = [
  '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6',
  '#EC4899', '#06B6D4', '#84CC16',
];

const PRODUCTS = [
  '프리미엄 콜라겐 세트', '비타민C 1000mg 60정', '히알루론산 앰플 50ml',
  '유기농 그래놀라 500g', '프로폴리스 스프레이', '저분자 피쉬 콜라겐',
  '멀티비타민 미네랄 90정', '오메가3 EPA/DHA 60캡슐', '루테인 지아잔틴',
  '마그네슘 400mg', '프로바이오틱스 유산균', '밀크씨슬 간건강',
  '코엔자임Q10 100mg', '아르기닌 파워 스틱', '글루코사민 관절건강',
];

const CUSTOMER_NAMES = [
  '김민준', '이서연', '박도윤', '정하은', '최준서',
  '강지유', '조시우', '윤수아', '임예준', '한지호',
  '배수빈', '유하린', '신민서', '오지원', '서다은',
  '황준혁', '문채원', '양서준', '권나은', '홍태민',
];

// ─────────────────────────────────────────────
// Sample Data Generator
// ─────────────────────────────────────────────

function generateSampleOrders(): Order[] {
  const orders: Order[] = [];
  const now = new Date();
  const statuses: OrderStatus[] = ['신규접수', '확인완료', '배송준비', '배송중', '배송완료', '취소', '반품'];
  const statusWeights = [15, 12, 10, 20, 35, 5, 3]; // weighted distribution

  for (let i = 0; i < 120; i++) {
    const daysAgo = Math.floor(Math.random() * 30);
    const hoursAgo = Math.floor(Math.random() * 24);
    const date = new Date(now);
    date.setDate(date.getDate() - daysAgo);
    date.setHours(hoursAgo, Math.floor(Math.random() * 60), 0, 0);

    // weighted random status
    const totalWeight = statusWeights.reduce((a, b) => a + b, 0);
    let rand = Math.random() * totalWeight;
    let statusIdx = 0;
    for (let j = 0; j < statusWeights.length; j++) {
      rand -= statusWeights[j];
      if (rand <= 0) { statusIdx = j; break; }
    }

    const qty = Math.floor(Math.random() * 5) + 1;
    const basePrice = Math.floor(Math.random() * 80 + 10) * 1000;

    orders.push({
      id: `ORD-${String(10000 + i).slice(1)}`,
      orderNumber: `ND${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(10000 + i).slice(1)}`,
      orderDate: date.toISOString(),
      channel: CHANNELS[Math.floor(Math.random() * CHANNELS.length)],
      customerName: CUSTOMER_NAMES[Math.floor(Math.random() * CUSTOMER_NAMES.length)],
      productName: PRODUCTS[Math.floor(Math.random() * PRODUCTS.length)],
      quantity: qty,
      paymentAmount: basePrice * qty,
      status: statuses[statusIdx],
      phone: `010-${String(Math.floor(Math.random() * 9000) + 1000)}-${String(Math.floor(Math.random() * 9000) + 1000)}`,
      address: '서울특별시 강남구 테헤란로 123',
      trackingNumber: statuses[statusIdx] === '배송중' || statuses[statusIdx] === '배송완료'
        ? `CJ${String(Math.floor(Math.random() * 9000000000) + 1000000000)}`
        : undefined,
      memo: i % 7 === 0 ? '선물포장 요청' : i % 11 === 0 ? '부재시 경비실' : undefined,
    });
  }

  return orders.sort((a, b) => new Date(b.orderDate).getTime() - new Date(a.orderDate).getTime());
}

function generateDailyTrends(): DailyOrderTrend[] {
  const trends: DailyOrderTrend[] = [];
  const now = new Date();
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    trends.push({
      date: `${d.getMonth() + 1}/${d.getDate()}`,
      orders: Math.floor(Math.random() * 30) + 10,
      revenue: Math.floor(Math.random() * 5000000) + 1000000,
    });
  }
  return trends;
}

function generateChannelRatios(): ChannelRatio[] {
  const base = CHANNELS.map(name => ({
    name,
    value: Math.floor(Math.random() * 100) + 20,
  }));
  const total = base.reduce((s, c) => s + c.value, 0);
  return base.map(c => ({ ...c, value: Math.round((c.value / total) * 100) }));
}

// ─────────────────────────────────────────────
// Utility
// ─────────────────────────────────────────────

function formatCurrency(n: number): string {
  return n.toLocaleString('ko-KR') + '원';
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function getToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function downloadCSV(orders: Order[], filename: string) {
  const header = '주문번호,주문일시,채널,고객명,상품명,수량,결제금액,주문상태\n';
  const rows = orders.map(o =>
    `${o.orderNumber},${formatDate(o.orderDate)},${o.channel},${o.customerName},${o.productName},${o.quantity},${o.paymentAmount},${o.status}`
  ).join('\n');
  const BOM = '\uFEFF';
  const blob = new Blob([BOM + header + rows], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────

export default function OrdersPage() {
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();

  // ── Data state ──
  const [orders, setOrders] = useState<Order[]>([]);
  const [dailyTrends, setDailyTrends] = useState<DailyOrderTrend[]>([]);
  const [channelRatios, setChannelRatios] = useState<ChannelRatio[]>([]);
  const [isDataLoading, setIsDataLoading] = useState(true);

  // ── Filter state ──
  const [filterYear, setFilterYear] = useState<number>(new Date().getFullYear());
  const [filterMonth, setFilterMonth] = useState<number>(new Date().getMonth() + 1);
  const [filterDay, setFilterDay] = useState<number | null>(null);
  const [filterChannel, setFilterChannel] = useState<string>('전체');
  const [filterStatus, setFilterStatus] = useState<string>('전체');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // ── Tab state ──
  const [activeTab, setActiveTab] = useState<TabKey>('전체');

  // ── UI state ──
  const [showCharts, setShowCharts] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState<string>('');
  const [currentPage, setCurrentPage] = useState(1);
  const [sortField, setSortField] = useState<'orderDate' | 'paymentAmount'>('orderDate');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const ITEMS_PER_PAGE = 15;

  // ── Add Modal state ──
  const [newOrder, setNewOrder] = useState({
    channel: '스마트스토어',
    customerName: '',
    productName: '',
    quantity: 1,
    paymentAmount: 0,
    phone: '',
    address: '',
    memo: '',
  });

  // ── Auth guard ──
  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
    }
  }, [user, authLoading, router]);

  // ── Load data ──
  const loadData = useCallback(async () => {
    setIsDataLoading(true);

    const sampleOrders = generateSampleOrders();
    const sampleTrends = generateDailyTrends();
    const sampleRatios = generateChannelRatios();

    const [apiOrders, apiTrends, apiRatios] = await Promise.all([
      fetchSafe<Order[]>('/api/scm/orders', sampleOrders),
      fetchSafe<DailyOrderTrend[]>('/api/scm/orders/trends', sampleTrends),
      fetchSafe<ChannelRatio[]>('/api/scm/orders/channel-ratios', sampleRatios),
    ]);

    setOrders(apiOrders);
    setDailyTrends(apiTrends);
    setChannelRatios(apiRatios);
    setIsDataLoading(false);
  }, []);

  useEffect(() => {
    if (user) loadData();
  }, [user, loadData]);

  // ── Computed: filtered orders ──
  const filteredOrders = useMemo(() => {
    let result = [...orders];

    // Filter by date
    result = result.filter(o => {
      const d = new Date(o.orderDate);
      if (d.getFullYear() !== filterYear) return false;
      if (d.getMonth() + 1 !== filterMonth) return false;
      if (filterDay !== null && d.getDate() !== filterDay) return false;
      return true;
    });

    // Filter by channel
    if (filterChannel !== '전체') {
      result = result.filter(o => o.channel === filterChannel);
    }

    // Filter by status dropdown
    if (filterStatus !== '전체') {
      result = result.filter(o => o.status === filterStatus);
    }

    // Filter by tab
    if (activeTab !== '전체') {
      if (activeTab === '취소/반품') {
        result = result.filter(o => o.status === '취소' || o.status === '반품');
      } else {
        result = result.filter(o => o.status === activeTab);
      }
    }

    // Search
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter(o =>
        o.orderNumber.toLowerCase().includes(q) ||
        o.customerName.toLowerCase().includes(q) ||
        o.productName.toLowerCase().includes(q)
      );
    }

    // Sort
    result.sort((a, b) => {
      let cmp = 0;
      if (sortField === 'orderDate') {
        cmp = new Date(a.orderDate).getTime() - new Date(b.orderDate).getTime();
      } else {
        cmp = a.paymentAmount - b.paymentAmount;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return result;
  }, [orders, filterYear, filterMonth, filterDay, filterChannel, filterStatus, activeTab, searchQuery, sortField, sortDir]);

  // ── Summary statistics ──
  const summary = useMemo(() => {
    const today = getToday();
    const todayOrders = orders.filter(o => o.orderDate.startsWith(today));
    const todayCount = todayOrders.length;
    const todayRevenue = todayOrders.reduce((s, o) => s + o.paymentAmount, 0);
    const pending = orders.filter(o => o.status === '신규접수' || o.status === '확인완료').length;
    const shipping = orders.filter(o => o.status === '배송중').length;
    return { todayCount, pending, shipping, todayRevenue };
  }, [orders]);

  // ── Tab counts ──
  const tabCounts = useMemo(() => {
    const counts: Record<TabKey, number> = {
      '전체': orders.length,
      '신규접수': orders.filter(o => o.status === '신규접수').length,
      '확인완료': orders.filter(o => o.status === '확인완료').length,
      '배송준비': orders.filter(o => o.status === '배송준비').length,
      '배송중': orders.filter(o => o.status === '배송중').length,
      '배송완료': orders.filter(o => o.status === '배송완료').length,
      '취소/반품': orders.filter(o => o.status === '취소' || o.status === '반품').length,
    };
    return counts;
  }, [orders]);

  // ── Pagination ──
  const totalPages = Math.max(1, Math.ceil(filteredOrders.length / ITEMS_PER_PAGE));
  const paginatedOrders = filteredOrders.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [activeTab, filterChannel, filterStatus, filterYear, filterMonth, filterDay, searchQuery]);

  // ── Days in month ──
  const daysInMonth = useMemo(() => {
    return new Date(filterYear, filterMonth, 0).getDate();
  }, [filterYear, filterMonth]);

  // ── Handlers ──

  const handleStatusChange = useCallback((orderId: string, newStatus: OrderStatus) => {
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: newStatus } : o));
  }, []);

  const handleBulkStatusUpdate = useCallback(() => {
    if (!bulkAction || selectedIds.size === 0) return;
    setOrders(prev => prev.map(o =>
      selectedIds.has(o.id) ? { ...o, status: bulkAction as OrderStatus } : o
    ));
    setSelectedIds(new Set());
    setBulkAction('');
  }, [bulkAction, selectedIds]);

  const handleSelectAll = useCallback(() => {
    if (selectedIds.size === paginatedOrders.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(paginatedOrders.map(o => o.id)));
    }
  }, [paginatedOrders, selectedIds]);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleAddOrder = useCallback(() => {
    if (!newOrder.customerName || !newOrder.productName) return;
    const now = new Date();
    const id = `ORD-${Date.now()}`;
    const orderNumber = `ND${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(Date.now()).slice(-5)}`;
    const order: Order = {
      id,
      orderNumber,
      orderDate: now.toISOString(),
      channel: newOrder.channel,
      customerName: newOrder.customerName,
      productName: newOrder.productName,
      quantity: newOrder.quantity,
      paymentAmount: newOrder.paymentAmount,
      status: '신규접수',
      phone: newOrder.phone,
      address: newOrder.address,
      memo: newOrder.memo,
    };
    setOrders(prev => [order, ...prev]);
    setNewOrder({
      channel: '스마트스토어',
      customerName: '',
      productName: '',
      quantity: 1,
      paymentAmount: 0,
      phone: '',
      address: '',
      memo: '',
    });
    setShowAddModal(false);
  }, [newOrder]);

  const handleExcelDownload = useCallback(() => {
    const filename = `주문현황_${filterYear}${String(filterMonth).padStart(2, '0')}${filterDay ? String(filterDay).padStart(2, '0') : ''}.csv`;
    downloadCSV(filteredOrders, filename);
  }, [filteredOrders, filterYear, filterMonth, filterDay]);

  const handleSort = useCallback((field: 'orderDate' | 'paymentAmount') => {
    if (sortField === field) {
      setSortDir(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  }, [sortField]);

  // ── Custom Recharts tooltip ──
  const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white px-4 py-3 rounded-xl shadow-lg border border-slate-200">
          <p className="text-sm font-semibold text-slate-700 mb-1">{label}</p>
          {payload.map((entry, idx) => (
            <p key={idx} className="text-sm" style={{ color: entry.color }}>
              {entry.name}: {entry.name === '매출액' ? formatCurrency(entry.value) : entry.value.toLocaleString('ko-KR')}
            </p>
          ))}
        </div>
      );
    }
    return null;
  };

  const PieTooltip = ({ active, payload }: { active?: boolean; payload?: Array<{ name: string; value: number }> }) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white px-3 py-2 rounded-lg shadow-lg border border-slate-200">
          <p className="text-sm font-medium text-slate-700">{payload[0].name}: {payload[0].value}%</p>
        </div>
      );
    }
    return null;
  };

  // ── Loading / auth gate ──
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

  // ─────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
      <Navigation />

      <div className="max-w-[1400px] mx-auto px-4 py-6">

        {/* ── Page Header ── */}
        <div className="mb-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">주문현황</h1>
            <p className="text-slate-500 mt-1">실시간 주문 현황을 확인하고 관리하세요</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowCharts(!showCharts)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all border ${
                showCharts
                  ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              차트 {showCharts ? '숨기기' : '보기'}
            </button>
            <button
              onClick={handleExcelDownload}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-700 transition-all shadow-sm"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              엑셀 다운로드
            </button>
            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 transition-all shadow-sm"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              수동 주문 등록
            </button>
          </div>
        </div>

        {/* ── Summary Cards ── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {/* 오늘 주문건수 */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-slate-500">오늘 주문건수</span>
              <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center">
                <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
              </div>
            </div>
            <p className="text-3xl font-bold text-slate-800">{summary.todayCount.toLocaleString('ko-KR')}<span className="text-base font-medium text-slate-400 ml-1">건</span></p>
          </div>

          {/* 처리대기 */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-slate-500">처리대기</span>
              <div className="w-10 h-10 bg-amber-50 rounded-xl flex items-center justify-center">
                <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
            </div>
            <p className="text-3xl font-bold text-slate-800">{summary.pending.toLocaleString('ko-KR')}<span className="text-base font-medium text-slate-400 ml-1">건</span></p>
            <p className="text-xs text-amber-600 mt-1 font-medium">신규접수 + 확인완료</p>
          </div>

          {/* 배송중 */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-slate-500">배송중</span>
              <div className="w-10 h-10 bg-emerald-50 rounded-xl flex items-center justify-center">
                <svg className="w-5 h-5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0" />
                </svg>
              </div>
            </div>
            <p className="text-3xl font-bold text-slate-800">{summary.shipping.toLocaleString('ko-KR')}<span className="text-base font-medium text-slate-400 ml-1">건</span></p>
          </div>

          {/* 금일 매출액 */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-slate-500">금일 매출액</span>
              <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center">
                <svg className="w-5 h-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
            </div>
            <p className="text-2xl font-bold text-slate-800">{formatCurrency(summary.todayRevenue)}</p>
          </div>
        </div>

        {/* ── Charts Section (toggleable) ── */}
        {showCharts && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
            {/* 일별 주문추이 */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
              <h3 className="text-sm font-semibold text-slate-700 mb-4">일별 주문추이</h3>
              <div className="h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={dailyTrends}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                    <XAxis dataKey="date" tick={{ fontSize: 12, fill: '#64748B' }} />
                    <YAxis yAxisId="left" tick={{ fontSize: 12, fill: '#64748B' }} />
                    <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 12, fill: '#64748B' }} tickFormatter={(v: number) => `${(v / 10000).toFixed(0)}만`} />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line yAxisId="left" type="monotone" dataKey="orders" stroke="#3B82F6" strokeWidth={2} name="주문건수" dot={{ r: 3 }} activeDot={{ r: 5 }} />
                    <Line yAxisId="right" type="monotone" dataKey="revenue" stroke="#8B5CF6" strokeWidth={2} name="매출액" dot={{ r: 3 }} activeDot={{ r: 5 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* 채널별 주문비율 */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
              <h3 className="text-sm font-semibold text-slate-700 mb-4">채널별 주문비율</h3>
              <div className="h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={channelRatios}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={100}
                      paddingAngle={2}
                      dataKey="value"
                      nameKey="name"
                      label={({ name, value }: { name: string; value: number }) => `${name} ${value}%`}
                    >
                      {channelRatios.map((_, index) => (
                        <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip content={<PieTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )}

        {/* ── Filter Bar ── */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 mb-4">
          <div className="flex flex-wrap items-center gap-3">
            {/* Date selectors */}
            <div className="flex items-center gap-1.5">
              <label className="text-xs font-semibold text-slate-500">기간</label>
              <select
                value={filterYear}
                onChange={e => setFilterYear(Number(e.target.value))}
                className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-sm bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 2 + i).map(y => (
                  <option key={y} value={y}>{y}년</option>
                ))}
              </select>
              <select
                value={filterMonth}
                onChange={e => setFilterMonth(Number(e.target.value))}
                className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-sm bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                  <option key={m} value={m}>{m}월</option>
                ))}
              </select>
              <select
                value={filterDay ?? ''}
                onChange={e => setFilterDay(e.target.value ? Number(e.target.value) : null)}
                className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-sm bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="">전체일</option>
                {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(d => (
                  <option key={d} value={d}>{d}일</option>
                ))}
              </select>
            </div>

            {/* Divider */}
            <div className="hidden sm:block w-px h-6 bg-slate-200" />

            {/* Channel filter */}
            <div className="flex items-center gap-1.5">
              <label className="text-xs font-semibold text-slate-500">채널</label>
              <select
                value={filterChannel}
                onChange={e => setFilterChannel(e.target.value)}
                className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-sm bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="전체">전체 채널</option>
                {CHANNELS.map(ch => (
                  <option key={ch} value={ch}>{ch}</option>
                ))}
              </select>
            </div>

            <div className="hidden sm:block w-px h-6 bg-slate-200" />

            {/* Status filter */}
            <div className="flex items-center gap-1.5">
              <label className="text-xs font-semibold text-slate-500">상태</label>
              <select
                value={filterStatus}
                onChange={e => setFilterStatus(e.target.value)}
                className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-sm bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="전체">전체 상태</option>
                {STATUS_LIST.map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>

            <div className="hidden sm:block w-px h-6 bg-slate-200" />

            {/* Search */}
            <div className="flex items-center gap-1.5 flex-1 min-w-[200px]">
              <div className="relative flex-1">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="주문번호, 고객명, 상품명 검색..."
                  className="w-full pl-9 pr-3 py-1.5 rounded-lg border border-slate-200 text-sm bg-white text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </div>

            {/* Refresh button */}
            <button
              onClick={loadData}
              disabled={isDataLoading}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-50"
            >
              <svg className={`w-4 h-4 ${isDataLoading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              새로고침
            </button>
          </div>
        </div>

        {/* ── Tabs ── */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 mb-4">
          <div className="flex items-center overflow-x-auto border-b border-slate-100">
            {TAB_LIST.map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex items-center gap-1.5 px-5 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-all ${
                  activeTab === tab
                    ? 'border-blue-600 text-blue-700 bg-blue-50/50'
                    : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'
                }`}
              >
                {tab}
                <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                  activeTab === tab
                    ? 'bg-blue-100 text-blue-700'
                    : 'bg-slate-100 text-slate-500'
                }`}>
                  {tabCounts[tab]}
                </span>
              </button>
            ))}
          </div>

          {/* ── Bulk Actions Bar ── */}
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-3 px-5 py-3 bg-blue-50 border-b border-blue-100">
              <span className="text-sm font-medium text-blue-700">
                {selectedIds.size}건 선택됨
              </span>
              <select
                value={bulkAction}
                onChange={e => setBulkAction(e.target.value)}
                className="px-2.5 py-1.5 rounded-lg border border-blue-200 text-sm bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">일괄 상태 변경...</option>
                {STATUS_LIST.map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <button
                onClick={handleBulkStatusUpdate}
                disabled={!bulkAction}
                className="px-3 py-1.5 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                적용
              </button>
              <button
                onClick={() => setSelectedIds(new Set())}
                className="px-3 py-1.5 rounded-lg text-sm text-slate-600 hover:bg-blue-100 transition-colors"
              >
                선택 해제
              </button>
            </div>
          )}

          {/* ── Orders Table ── */}
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50/80">
                  <th className="px-4 py-3 text-left">
                    <input
                      type="checkbox"
                      checked={paginatedOrders.length > 0 && selectedIds.size === paginatedOrders.length}
                      onChange={handleSelectAll}
                      className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                    />
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">주문번호</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    <button onClick={() => handleSort('orderDate')} className="flex items-center gap-1 hover:text-slate-700">
                      주문일시
                      {sortField === 'orderDate' && (
                        <svg className={`w-3 h-3 ${sortDir === 'asc' ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      )}
                    </button>
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">채널</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">고객명</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">상품명</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wider">수량</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    <button onClick={() => handleSort('paymentAmount')} className="flex items-center gap-1 hover:text-slate-700 ml-auto">
                      결제금액
                      {sortField === 'paymentAmount' && (
                        <svg className={`w-3 h-3 ${sortDir === 'asc' ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      )}
                    </button>
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wider">주문상태</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wider">액션</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {isDataLoading ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-16 text-center">
                      <div className="flex flex-col items-center gap-3">
                        <div className="w-8 h-8 border-3 border-blue-500 border-t-transparent rounded-full animate-spin" />
                        <span className="text-sm text-slate-500">데이터를 불러오는 중...</span>
                      </div>
                    </td>
                  </tr>
                ) : paginatedOrders.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-16 text-center">
                      <div className="flex flex-col items-center gap-2">
                        <svg className="w-12 h-12 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                        </svg>
                        <p className="text-sm text-slate-500">해당 조건에 맞는 주문이 없습니다</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  paginatedOrders.map(order => (
                    <tr key={order.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(order.id)}
                          onChange={() => toggleSelect(order.id)}
                          className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm font-mono font-medium text-slate-700">{order.orderNumber}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm text-slate-600">{formatDate(order.orderDate)}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-slate-100 text-slate-700">
                          {order.channel}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm text-slate-700 font-medium">{order.customerName}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm text-slate-600 max-w-[180px] truncate block">{order.productName}</span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="text-sm text-slate-700">{order.quantity.toLocaleString('ko-KR')}</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="text-sm font-semibold text-slate-800">{formatCurrency(order.paymentAmount)}</span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${STATUS_COLORS[order.status]}`}>
                          {order.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          {STATUS_NEXT[order.status] && (
                            <button
                              onClick={() => handleStatusChange(order.id, STATUS_NEXT[order.status]!)}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 transition-colors"
                              title={`${STATUS_NEXT[order.status]}(으)로 변경`}
                            >
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                              </svg>
                              {STATUS_NEXT[order.status]}
                            </button>
                          )}
                          <button
                            onClick={() => { setSelectedOrder(order); setShowDetailModal(true); }}
                            className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium text-slate-600 bg-slate-50 hover:bg-slate-100 transition-colors"
                            title="상세보기"
                          >
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                            </svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* ── Pagination ── */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-5 py-3 border-t border-slate-100">
              <p className="text-sm text-slate-500">
                총 <span className="font-semibold text-slate-700">{filteredOrders.length.toLocaleString('ko-KR')}</span>건 중{' '}
                <span className="font-semibold text-slate-700">{((currentPage - 1) * ITEMS_PER_PAGE) + 1}</span>-
                <span className="font-semibold text-slate-700">{Math.min(currentPage * ITEMS_PER_PAGE, filteredOrders.length)}</span>
              </p>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setCurrentPage(1)}
                  disabled={currentPage === 1}
                  className="px-2.5 py-1.5 rounded-lg text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
                  </svg>
                </button>
                <button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="px-2.5 py-1.5 rounded-lg text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                  let page: number;
                  if (totalPages <= 7) {
                    page = i + 1;
                  } else if (currentPage <= 4) {
                    page = i + 1;
                  } else if (currentPage >= totalPages - 3) {
                    page = totalPages - 6 + i;
                  } else {
                    page = currentPage - 3 + i;
                  }
                  return (
                    <button
                      key={page}
                      onClick={() => setCurrentPage(page)}
                      className={`w-8 h-8 rounded-lg text-sm font-medium transition-colors ${
                        currentPage === page
                          ? 'bg-blue-600 text-white shadow-sm'
                          : 'text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      {page}
                    </button>
                  );
                })}
                <button
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="px-2.5 py-1.5 rounded-lg text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
                <button
                  onClick={() => setCurrentPage(totalPages)}
                  disabled={currentPage === totalPages}
                  className="px-2.5 py-1.5 rounded-lg text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Add Order Modal ── */}
      {showAddModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowAddModal(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <h2 className="text-lg font-bold text-slate-800">수동 주문 등록</h2>
              <button
                onClick={() => setShowAddModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Body */}
            <div className="px-6 py-4 space-y-4">
              {/* 채널 */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">판매채널</label>
                <select
                  value={newOrder.channel}
                  onChange={e => setNewOrder(p => ({ ...p, channel: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  {CHANNELS.map(ch => (
                    <option key={ch} value={ch}>{ch}</option>
                  ))}
                </select>
              </div>

              {/* 고객명 */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">고객명 <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={newOrder.customerName}
                  onChange={e => setNewOrder(p => ({ ...p, customerName: e.target.value }))}
                  placeholder="고객명을 입력하세요"
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              {/* 상품명 */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">상품명 <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={newOrder.productName}
                  onChange={e => setNewOrder(p => ({ ...p, productName: e.target.value }))}
                  placeholder="상품명을 입력하세요"
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              {/* 수량 / 금액 */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">수량</label>
                  <input
                    type="number"
                    min={1}
                    value={newOrder.quantity}
                    onChange={e => setNewOrder(p => ({ ...p, quantity: Math.max(1, parseInt(e.target.value) || 1) }))}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">결제금액 (원)</label>
                  <input
                    type="number"
                    min={0}
                    step={1000}
                    value={newOrder.paymentAmount}
                    onChange={e => setNewOrder(p => ({ ...p, paymentAmount: Math.max(0, parseInt(e.target.value) || 0) }))}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              </div>

              {/* 연락처 */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">연락처</label>
                <input
                  type="text"
                  value={newOrder.phone}
                  onChange={e => setNewOrder(p => ({ ...p, phone: e.target.value }))}
                  placeholder="010-0000-0000"
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              {/* 배송지 */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">배송지</label>
                <input
                  type="text"
                  value={newOrder.address}
                  onChange={e => setNewOrder(p => ({ ...p, address: e.target.value }))}
                  placeholder="배송 주소를 입력하세요"
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              {/* 메모 */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">메모</label>
                <textarea
                  value={newOrder.memo}
                  onChange={e => setNewOrder(p => ({ ...p, memo: e.target.value }))}
                  rows={2}
                  placeholder="주문 관련 메모"
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                />
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-slate-100">
              <button
                onClick={() => setShowAddModal(false)}
                className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100 transition-colors"
              >
                취소
              </button>
              <button
                onClick={handleAddOrder}
                disabled={!newOrder.customerName.trim() || !newOrder.productName.trim()}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm"
              >
                주문 등록
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Order Detail Modal ── */}
      {showDetailModal && selectedOrder && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowDetailModal(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <h2 className="text-lg font-bold text-slate-800">주문 상세</h2>
              <button
                onClick={() => setShowDetailModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Body */}
            <div className="px-6 py-4 space-y-4">
              {/* Status Badge */}
              <div className="flex items-center justify-between">
                <span className={`inline-flex items-center px-3 py-1.5 rounded-full text-sm font-semibold ${STATUS_COLORS[selectedOrder.status]}`}>
                  {selectedOrder.status}
                </span>
                {STATUS_NEXT[selectedOrder.status] && (
                  <button
                    onClick={() => {
                      handleStatusChange(selectedOrder.id, STATUS_NEXT[selectedOrder.status]!);
                      setSelectedOrder({ ...selectedOrder, status: STATUS_NEXT[selectedOrder.status]! });
                    }}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 transition-all"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                    </svg>
                    {STATUS_NEXT[selectedOrder.status]}(으)로 변경
                  </button>
                )}
              </div>

              {/* Order Info Grid */}
              <div className="bg-slate-50 rounded-xl p-4 space-y-3">
                <DetailRow label="주문번호" value={selectedOrder.orderNumber} mono />
                <DetailRow label="주문일시" value={formatDate(selectedOrder.orderDate)} />
                <DetailRow label="판매채널" value={selectedOrder.channel} />
                <DetailRow label="고객명" value={selectedOrder.customerName} />
                <DetailRow label="연락처" value={selectedOrder.phone} />
                <DetailRow label="배송지" value={selectedOrder.address} />
              </div>

              {/* Product Info */}
              <div className="bg-slate-50 rounded-xl p-4 space-y-3">
                <DetailRow label="상품명" value={selectedOrder.productName} />
                <DetailRow label="수량" value={`${selectedOrder.quantity.toLocaleString('ko-KR')}개`} />
                <DetailRow label="결제금액" value={formatCurrency(selectedOrder.paymentAmount)} highlight />
              </div>

              {/* Tracking / Memo */}
              {(selectedOrder.trackingNumber || selectedOrder.memo) && (
                <div className="bg-slate-50 rounded-xl p-4 space-y-3">
                  {selectedOrder.trackingNumber && (
                    <DetailRow label="운송장번호" value={selectedOrder.trackingNumber} mono />
                  )}
                  {selectedOrder.memo && (
                    <DetailRow label="메모" value={selectedOrder.memo} />
                  )}
                </div>
              )}

              {/* Status Change */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">상태 직접 변경</label>
                <div className="flex flex-wrap gap-2">
                  {STATUS_LIST.map(s => (
                    <button
                      key={s}
                      onClick={() => {
                        handleStatusChange(selectedOrder.id, s);
                        setSelectedOrder({ ...selectedOrder, status: s });
                      }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                        selectedOrder.status === s
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300 hover:text-blue-600'
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end px-6 py-4 border-t border-slate-100">
              <button
                onClick={() => setShowDetailModal(false)}
                className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100 transition-colors"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

// ─────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────

function DetailRow({
  label,
  value,
  mono = false,
  highlight = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-sm text-slate-500 shrink-0 w-20">{label}</span>
      <span className={`text-sm text-right ${mono ? 'font-mono' : ''} ${highlight ? 'font-bold text-blue-700 text-base' : 'text-slate-800 font-medium'}`}>
        {value}
      </span>
    </div>
  );
}
