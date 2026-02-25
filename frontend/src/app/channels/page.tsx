'use client';

import { Suspense, useEffect, useState, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Navigation } from '@/components/layout/Navigation';
import {
  BarChart, Bar, LineChart, Line, ComposedChart, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell
} from 'recharts';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

interface Channel {
  id: string;
  name: string;
  category: string;
  integration_type: string;
  is_active: boolean;
  last_synced_at: string | null;
}

interface ChannelSummary {
  channel_id: string;
  channel_name: string;
  gross_sales: number;
  net_sales: number;
  order_count: number;
  quantity: number;
  commission: number;
  data_count: number;
}

interface DailySummary {
  year: number;
  month: number;
  days_in_month: number;
  daily: {
    day: number;
    gross_sales: number;
    net_sales: number;
    order_count: number;
    quantity: number;
    cumulative_gross: number;
    cumulative_net: number;
  }[];
  total: {
    gross_sales: number;
    net_sales: number;
    order_count: number;
    quantity: number;
  };
}

interface ChannelDailySale {
  channel_id: string;
  channel_name: string;
  year: number;
  month: number;
  day: number;
  gross_sales: number;
  net_sales: number;
  order_count: number;
  quantity: number;
}


const years = Array.from({ length: 10 }, (_, i) => new Date().getFullYear() - 5 + i);
const months = Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: `${i + 1}월` }));

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

export default function ChannelsPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <ChannelsPageContent />
    </Suspense>
  );
}

function ChannelsPageContent() {
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [channelSummary, setChannelSummary] = useState<ChannelSummary[]>([]);
  const [dailySummary, setDailySummary] = useState<DailySummary | null>(null);
  const [channelDailyDetail, setChannelDailyDetail] = useState<ChannelDailySale[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(null);
  const [chartMode, setChartMode] = useState<'daily' | 'cumulative'>('cumulative');
  const [viewMode, setViewMode] = useState<'chart' | 'table'>('chart');
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncingChannelId, setSyncingChannelId] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [cafe24Connecting, setCafe24Connecting] = useState(false);

  // 쿠팡 설정 모달
  const [showCoupangSettings, setShowCoupangSettings] = useState(false);
  const [coupangWingStatus, setCoupangWingStatus] = useState<{configured: boolean; connected: boolean; message: string} | null>(null);
  const [coupangRocketStatus, setCoupangRocketStatus] = useState<{configured: boolean; connected: boolean; message: string; playwright_installed?: boolean} | null>(null);

  // 연동 채널 필터
  const [selectedSyncChannels, setSelectedSyncChannels] = useState<Set<string>>(new Set(['스마트스토어', '카페24']));
  // 목표 지표
  const [showTarget, setShowTarget] = useState(false);
  const [monthlyTarget, setMonthlyTarget] = useState<number | null>(null);
  // 차트 유형
  const [chartType, setChartType] = useState<'bar' | 'line'>('bar');

  // 카페24 OAuth 연동 완료 쿼리 파라미터 처리
  useEffect(() => {
    const cafe24Connected = searchParams.get('cafe24_connected');
    const cafe24Error = searchParams.get('cafe24_error');
    if (cafe24Connected === 'true') {
      setSyncResult({ type: 'success', message: '카페24 OAuth 연동이 완료되었습니다!' });
      router.replace('/channels');
    } else if (cafe24Error) {
      setSyncResult({ type: 'error', message: `카페24 연동 실패: ${cafe24Error}` });
      router.replace('/channels');
    }
  }, [searchParams, router]);

  const connectCafe24 = async () => {
    setCafe24Connecting(true);
    try {
      const res = await fetch(`${API_BASE}/api/cafe24/oauth/authorize`, {
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        window.location.href = data.authorize_url;
      } else {
        const data = await res.json();
        setSyncResult({ type: 'error', message: data.detail || '카페24 연동 URL 생성 실패' });
        setCafe24Connecting(false);
      }
    } catch (err: any) {
      setSyncResult({ type: 'error', message: `카페24 연동 실패: ${err?.message || '네트워크 오류'}` });
      setCafe24Connecting(false);
    }
  };

  const toggleSyncChannel = (channelName: string) => {
    setSelectedSyncChannels(prev => {
      const next = new Set(prev);
      if (next.has(channelName)) {
        next.delete(channelName);
      } else {
        next.add(channelName);
      }
      return next;
    });
  };

  // 동기화 날짜 범위 (기본: 현재 선택된 월의 1일 ~ 말일)
  const getDefaultDates = (y: number, m: number) => {
    const daysInMonth = new Date(y, m, 0).getDate();
    return {
      start: `${y}-${String(m).padStart(2, '0')}-01`,
      end: `${y}-${String(m).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`,
    };
  };
  const defaults = getDefaultDates(year, month);
  const [syncStartDate, setSyncStartDate] = useState(defaults.start);
  const [syncEndDate, setSyncEndDate] = useState(defaults.end);

  const getAuthHeaders = () => {
    const token = localStorage.getItem('token');
    return {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
  };

  const fetchChannels = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/channels`, {
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        setChannels(data);
      }
    } catch (error) {
      console.error('Failed to fetch channels:', error);
    }
  }, []);

  const initializeChannels = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/channels/initialize`, {
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        await fetchChannels();
      }
    } catch (error) {
      console.error('Failed to initialize channels:', error);
    }
  };

  const fetchSummary = useCallback(async () => {
    setIsLoading(true);
    try {
      const [channelRes, dailyRes, detailRes] = await Promise.all([
        fetch(`${API_BASE}/api/channels/sales/by-channel?year=${year}&month=${month}`, {
          headers: getAuthHeaders(),
        }),
        fetch(`${API_BASE}/api/channels/sales/summary?year=${year}&month=${month}`, {
          headers: getAuthHeaders(),
        }),
        fetch(`${API_BASE}/api/channels/sales/detail?year=${year}&month=${month}`, {
          headers: getAuthHeaders(),
        }),
      ]);

      if (channelRes.ok) {
        const data = await channelRes.json();
        setChannelSummary(data);
      }
      if (dailyRes.ok) {
        const data = await dailyRes.json();
        setDailySummary(data);
      }
      if (detailRes.ok) {
        const data = await detailRes.json();
        setChannelDailyDetail(data);
      }
    } catch (error) {
      console.error('Failed to fetch summary:', error);
    }
    setIsLoading(false);
  }, [year, month]);

  // 목표 지표 fetch - by-criteria API로 기준명별 매출 목표 가져오기
  const [targetByCriteria, setTargetByCriteria] = useState<Record<string, Record<string, number>>>({});

  const fetchTarget = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/targets/chart/by-criteria?year=${year}&month=${month}`, {
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        setTargetByCriteria(data.by_criteria || {});
      } else {
        setTargetByCriteria({});
        setMonthlyTarget(null);
      }
    } catch {
      setTargetByCriteria({});
      setMonthlyTarget(null);
    }
  }, [year, month]);

  useEffect(() => {
    if (showTarget) {
      fetchTarget();
    } else {
      setTargetByCriteria({});
      setMonthlyTarget(null);
    }
  }, [showTarget, fetchTarget]);

  // 선택된 채널에 해당하는 목표 매출 합산
  useEffect(() => {
    if (!showTarget) {
      setMonthlyTarget(null);
      return;
    }
    const criteriaNames = Object.keys(targetByCriteria);
    if (criteriaNames.length === 0) {
      setMonthlyTarget(null);
      return;
    }

    let total = 0;
    for (const [criteria, values] of Object.entries(targetByCriteria)) {
      // 선택된 채널명과 기준명 매칭 (정확 일치 또는 포함)
      const matches = Array.from(selectedSyncChannels).some(name =>
        criteria === name || criteria.includes(name) || name.includes(criteria)
      );
      if (matches) {
        total += values['매출'] || 0;
      }
    }
    setMonthlyTarget(total > 0 ? total : null);
  }, [targetByCriteria, selectedSyncChannels, showTarget]);

  // 채널명 → API 동기화 엔드포인트 매핑 (연동 구현된 채널만)
  const SYNC_ENDPOINTS: Record<string, string> = {
    '스마트스토어': '/api/smartstore/sync',
    '카페24': '/api/cafe24/sync',
    '쿠팡 WING': '/api/coupang-wing/sync',
    '쿠팡 로켓': '/api/coupang-rocket/sync',
  };

  const syncChannel = async (channel: Channel) => {
    const endpoint = SYNC_ENDPOINTS[channel.name];
    if (!endpoint) {
      setSyncResult({ type: 'error', message: `${channel.name}은 아직 API 연동이 준비되지 않았습니다` });
      return;
    }

    setSyncingChannelId(channel.id);
    setSyncResult(null);

    try {
      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ start_date: syncStartDate, end_date: syncEndDate, channel_id: channel.id }),
      });
      const data = await res.json();
      if (res.ok) {
        setSyncResult({
          type: 'success',
          message: `[${channel.name}] ${data.message} (${data.processed || 0}일, ${data.created || 0}건 저장)`,
        });
        fetchSummary();
      } else {
        setSyncResult({ type: 'error', message: `[${channel.name}] ${typeof data.detail === 'string' ? data.detail : '동기화 실패'}` });
      }
    } catch (err: any) {
      setSyncResult({ type: 'error', message: `[${channel.name}] ${err?.message || '네트워크 오류'}` });
    }
    setSyncingChannelId(null);
  };

  const syncAll = async () => {
    setIsSyncing(true);
    setSyncResult(null);
    const apiChannels = channels.filter(c => SYNC_ENDPOINTS[c.name]);
    if (apiChannels.length === 0) {
      setSyncResult({ type: 'error', message: 'API 연동된 채널이 없습니다' });
      setIsSyncing(false);
      return;
    }

    const results: string[] = [];
    const errors: string[] = [];

    for (const channel of apiChannels) {
      const endpoint = SYNC_ENDPOINTS[channel.name];
      try {
        const res = await fetch(`${API_BASE}${endpoint}`, {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({ start_date: syncStartDate, end_date: syncEndDate, channel_id: channel.id }),
        });
        const data = await res.json();
        if (res.ok) {
          results.push(`${channel.name}: ${data.processed || 0}일`);
        } else {
          errors.push(`${channel.name}: ${typeof data.detail === 'string' ? data.detail : '실패'}`);
        }
      } catch (err: any) {
        errors.push(`${channel.name}: ${err?.message || '네트워크 오류'}`);
      }
    }

    const message = [
      results.length > 0 ? `성공: ${results.join(', ')}` : '',
      errors.length > 0 ? `실패: ${errors.join(', ')}` : '',
    ].filter(Boolean).join(' / ');

    setSyncResult({
      type: errors.length === 0 ? 'success' : results.length > 0 ? 'success' : 'error',
      message,
    });
    fetchSummary();
    setIsSyncing(false);
  };

  // 년/월 변경 시 동기화 날짜 범위도 업데이트
  useEffect(() => {
    const d = getDefaultDates(year, month);
    setSyncStartDate(d.start);
    setSyncEndDate(d.end);
  }, [year, month]);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
    }
  }, [user, authLoading, router]);

  useEffect(() => {
    if (user) {
      fetchChannels();
    }
  }, [user, fetchChannels]);

  useEffect(() => {
    if (user && channels.length === 0) {
      // 채널이 없으면 초기화 시도
    }
  }, [user, channels]);

  useEffect(() => {
    if (user) {
      fetchSummary();
    }
  }, [user, fetchSummary]);

  // 쿠팡 채널 상태 조회
  const fetchCoupangStatus = useCallback(async () => {
    try {
      const [wingRes, rocketRes] = await Promise.all([
        fetch(`${API_BASE}/api/coupang-wing/status`, { headers: getAuthHeaders() }),
        fetch(`${API_BASE}/api/coupang-rocket/status`, { headers: getAuthHeaders() }),
      ]);
      if (wingRes.ok) {
        const data = await wingRes.json();
        setCoupangWingStatus(data);
      }
      if (rocketRes.ok) {
        const data = await rocketRes.json();
        setCoupangRocketStatus(data);
      }
    } catch (error) {
      console.error('Failed to fetch Coupang status:', error);
    }
  }, []);

  useEffect(() => {
    if (user) {
      fetchCoupangStatus();
    }
  }, [user, fetchCoupangStatus]);

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat('ko-KR').format(Math.round(num));
  };

  const formatCurrency = (num: number) => {
    if (num >= 100000000) {
      return `${(num / 100000000).toFixed(1)}억`;
    }
    if (num >= 10000) {
      return `${(num / 10000).toFixed(0)}만`;
    }
    return formatNumber(num);
  };

  // 연동 채널 필터 적용된 채널 서머리
  const syncChannelNames = Object.keys(SYNC_ENDPOINTS);
  const filteredChannelSummary = channelSummary.filter(c => {
    // 연동 채널이면 selectedSyncChannels에 포함되어야 표시
    if (syncChannelNames.includes(c.channel_name)) {
      return selectedSyncChannels.has(c.channel_name);
    }
    // 비연동 채널은 항상 표시
    return true;
  });

  // 채널별 파이차트 데이터
  const pieChartData = filteredChannelSummary
    .filter(c => c.gross_sales > 0)
    .sort((a, b) => b.gross_sales - a.gross_sales)
    .map((c, i) => ({
      name: c.channel_name,
      value: c.gross_sales,
      color: COLORS[i % COLORS.length],
    }));

  // 연동 채널 필터 적용된 일별 차트 데이터
  const dailyChartData = (() => {
    if (!dailySummary) return [];
    const daysInMonth = dailySummary.days_in_month;

    // 선택된 채널만 필터한 일별 집계
    const filteredDetail = channelDailyDetail.filter(d => {
      if (syncChannelNames.includes(d.channel_name)) {
        return selectedSyncChannels.has(d.channel_name);
      }
      return true;
    });

    // 일별 합산
    const dailyMap: Record<number, { gross_sales: number; order_count: number }> = {};
    for (let day = 1; day <= daysInMonth; day++) {
      dailyMap[day] = { gross_sales: 0, order_count: 0 };
    }
    for (const d of filteredDetail) {
      if (dailyMap[d.day]) {
        dailyMap[d.day].gross_sales += d.gross_sales || 0;
        dailyMap[d.day].order_count += d.order_count || 0;
      }
    }

    // 누계 계산 + 차트 데이터 생성
    let cumulative = 0;
    return Array.from({ length: daysInMonth }, (_, i) => {
      const day = i + 1;
      const dayData = dailyMap[day];
      cumulative += dayData.gross_sales;

      const entry: Record<string, string | number> = {
        day: `${day}일`,
        매출: chartMode === 'cumulative' ? cumulative : dayData.gross_sales,
        주문: dayData.order_count,
      };
      if (showTarget && monthlyTarget && daysInMonth > 0) {
        const dailyTarget = monthlyTarget / daysInMonth;
        entry['목표'] = Math.round(chartMode === 'cumulative' ? day * dailyTarget : dailyTarget);
      }
      return entry;
    });
  })();

  // 카테고리별 합계
  const categoryTotals = filteredChannelSummary.reduce((acc, c) => {
    const channel = channels.find(ch => ch.id === c.channel_id);
    const category = channel?.category || '기타';
    if (!acc[category]) {
      acc[category] = { gross_sales: 0, order_count: 0 };
    }
    acc[category].gross_sales += c.gross_sales;
    acc[category].order_count += c.order_count;
    return acc;
  }, {} as Record<string, { gross_sales: number; order_count: number }>);

  const categoryChartData = Object.entries(categoryTotals)
    .filter(([_, data]) => data.gross_sales > 0)
    .map(([category, data]) => ({
      name: category,
      매출: data.gross_sales,
      주문: data.order_count,
      color: CATEGORY_COLORS[category] || '#6B7280',
    }));

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

  if (!user) {
    return null;
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
      <Navigation />

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* 헤더 */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">채널별 매출 취합</h1>
            <p className="text-slate-500 mt-1">모든 판매 채널의 매출을 한눈에 확인하세요</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={syncAll}
              disabled={isSyncing}
              className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
            >
              {isSyncing ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  동기화 중...
                </>
              ) : (
                '전체 동기화'
              )}
            </button>
            {channels.length === 0 && (
              <button
                onClick={initializeChannels}
                className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
              >
                채널 초기화
              </button>
            )}
          </div>
        </div>

        {/* 동기화 결과 메시지 */}
        {syncResult && (
          <div className={`mb-4 p-4 rounded-xl flex items-center justify-between ${
            syncResult.type === 'success'
              ? 'bg-green-50 border border-green-200 text-green-700'
              : 'bg-red-50 border border-red-200 text-red-700'
          }`}>
            <span>{syncResult.message}</span>
            <button onClick={() => setSyncResult(null)} className="hover:opacity-70">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        {/* 필터 & 총합계 */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 mb-6">
          <div className="flex flex-wrap items-center gap-4 mb-6">
            {/* 대시보드 조회 기간 */}
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-slate-600">조회:</label>
              <select
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {years.map((y) => (
                  <option key={y} value={y}>{y}년</option>
                ))}
              </select>
              <select
                value={month}
                onChange={(e) => setMonth(Number(e.target.value))}
                className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {months.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>

            <div className="w-px h-8 bg-slate-200" />

            {/* 동기화 기간 */}
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-slate-600">동기화 기간:</label>
              <input
                type="date"
                value={syncStartDate}
                onChange={(e) => setSyncStartDate(e.target.value)}
                className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
              <span className="text-slate-400">~</span>
              <input
                type="date"
                value={syncEndDate}
                onChange={(e) => setSyncEndDate(e.target.value)}
                className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
          </div>

          {/* 연동 채널 필터 + 목표 지표 체크박스 */}
          <div className="flex flex-wrap items-center gap-4 mb-6 pt-2 border-t border-slate-100">
            <span className="text-sm font-medium text-slate-600">연동 채널:</span>
            {syncChannelNames.map(name => (
              <label key={name} className="flex items-center gap-1.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={selectedSyncChannels.has(name)}
                  onChange={() => toggleSyncChannel(name)}
                  className="w-4 h-4 rounded border-slate-300 text-blue-500 focus:ring-blue-500"
                />
                <span className="text-sm text-slate-700">{name}</span>
              </label>
            ))}

            <div className="w-px h-6 bg-slate-200" />

            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showTarget}
                onChange={() => setShowTarget(prev => !prev)}
                className="w-4 h-4 rounded border-slate-300 text-amber-500 focus:ring-amber-500"
              />
              <span className="text-sm text-slate-700">목표 지표</span>
            </label>
          </div>

          {/* 총합계 카드 */}
          {dailySummary && (
            <div className={`grid grid-cols-2 gap-4 ${showTarget && monthlyTarget ? 'md:grid-cols-5' : 'md:grid-cols-4'}`}>
              <div className="bg-gradient-to-br from-blue-50 to-blue-100 p-4 rounded-xl border border-blue-200">
                <p className="text-sm text-blue-600 mb-1">총 매출</p>
                <p className="text-2xl font-bold text-blue-700">
                  {formatCurrency(dailySummary.total.gross_sales)}원
                </p>
              </div>
              <div className="bg-gradient-to-br from-emerald-50 to-emerald-100 p-4 rounded-xl border border-emerald-200">
                <p className="text-sm text-emerald-600 mb-1">총 주문</p>
                <p className="text-2xl font-bold text-emerald-700">
                  {formatNumber(dailySummary.total.order_count)}건
                </p>
              </div>
              <div className="bg-gradient-to-br from-amber-50 to-amber-100 p-4 rounded-xl border border-amber-200">
                <p className="text-sm text-amber-600 mb-1">총 판매수량</p>
                <p className="text-2xl font-bold text-amber-700">
                  {formatNumber(dailySummary.total.quantity)}개
                </p>
              </div>
              <div className="bg-gradient-to-br from-purple-50 to-purple-100 p-4 rounded-xl border border-purple-200">
                <p className="text-sm text-purple-600 mb-1">활성 채널</p>
                <p className="text-2xl font-bold text-purple-700">
                  {channelSummary.length}개
                </p>
              </div>
              {showTarget && monthlyTarget !== null && (
                <div className="bg-gradient-to-br from-rose-50 to-rose-100 p-4 rounded-xl border border-rose-200">
                  <p className="text-sm text-rose-600 mb-1">월 목표 / 달성률</p>
                  <p className="text-2xl font-bold text-rose-700">
                    {formatCurrency(monthlyTarget)}원
                  </p>
                  <p className="text-sm text-rose-500 mt-1">
                    {dailySummary.total.gross_sales > 0
                      ? `${((dailySummary.total.gross_sales / monthlyTarget) * 100).toFixed(1)}%`
                      : '0%'}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 차트 영역 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* 일별 매출 추이 */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-slate-800">일별 매출 추이</h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setChartMode('daily')}
                  className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                    chartMode === 'daily'
                      ? 'bg-blue-500 text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  일계
                </button>
                <button
                  onClick={() => setChartMode('cumulative')}
                  className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                    chartMode === 'cumulative'
                      ? 'bg-blue-500 text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  누계
                </button>
                <div className="w-px h-6 bg-slate-200" />
                <button
                  onClick={() => setChartType('bar')}
                  className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                    chartType === 'bar'
                      ? 'bg-indigo-500 text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  막대
                </button>
                <button
                  onClick={() => setChartType('line')}
                  className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                    chartType === 'line'
                      ? 'bg-indigo-500 text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  선형
                </button>
              </div>
            </div>
            {isLoading ? (
              <div className="h-64 flex items-center justify-center">
                <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : dailyChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                {chartType === 'line' ? (
                  <LineChart data={dailyChartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                    <YAxis tickFormatter={(value) => formatCurrency(value)} tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(value: number, name: string) => [`${formatNumber(value)}원`, name]} />
                    <Legend />
                    <Line type="monotone" dataKey="매출" stroke="#3B82F6" strokeWidth={2} dot={false} />
                    {showTarget && monthlyTarget && (
                      <Line type="monotone" dataKey="목표" stroke="#F43F5E" strokeWidth={2} strokeDasharray="6 3" dot={false} />
                    )}
                  </LineChart>
                ) : (
                  <ComposedChart data={dailyChartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                    <YAxis tickFormatter={(value) => formatCurrency(value)} tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(value: number, name: string) => [`${formatNumber(value)}원`, name]} />
                    <Legend />
                    <Bar dataKey="매출" fill="#3B82F6" />
                    {showTarget && monthlyTarget && (
                      <Line type="monotone" dataKey="목표" stroke="#F43F5E" strokeWidth={2} strokeDasharray="6 3" dot={false} />
                    )}
                  </ComposedChart>
                )}
              </ResponsiveContainer>
            ) : (
              <div className="h-64 flex items-center justify-center text-slate-400">
                데이터가 없습니다
              </div>
            )}
          </div>

          {/* 채널별 매출 비중 */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
            <h3 className="text-lg font-semibold text-slate-800 mb-4">채널별 매출 비중</h3>
            {pieChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={pieChartData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={2}
                    dataKey="value"
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                    labelLine={false}
                  >
                    {pieChartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value: number) => [`${formatNumber(value)}원`, '매출']} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-64 flex items-center justify-center text-slate-400">
                데이터가 없습니다
              </div>
            )}
          </div>
        </div>

        {/* 카테고리별 매출 */}
        {categoryChartData.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 mb-6">
            <h3 className="text-lg font-semibold text-slate-800 mb-4">카테고리별 매출</h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={categoryChartData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" tickFormatter={(value) => formatCurrency(value)} tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="name" width={80} tick={{ fontSize: 12 }} />
                <Tooltip formatter={(value: number) => [`${formatNumber(value)}원`, '매출']} />
                <Bar dataKey="매출" fill="#3B82F6">
                  {categoryChartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* 채널 목록 & 데이터 입력 */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
            <h3 className="text-lg font-semibold text-slate-800">채널별 상세</h3>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setViewMode('chart')}
                className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                  viewMode === 'chart'
                    ? 'bg-blue-500 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                카드뷰
              </button>
              <button
                onClick={() => setViewMode('table')}
                className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                  viewMode === 'table'
                    ? 'bg-blue-500 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                테이블
              </button>
            </div>
          </div>

          {viewMode === 'chart' ? (
            <div className="p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {channels.map((channel) => {
                const summary = channelSummary.find(s => s.channel_id === channel.id);
                return (
                  <div
                    key={channel.id}
                    className="border border-slate-200 rounded-xl p-4 hover:shadow-md transition-shadow"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-medium text-slate-800">{channel.name}</h4>
                      <span
                        className="px-2 py-0.5 text-xs rounded-full"
                        style={{
                          backgroundColor: `${CATEGORY_COLORS[channel.category] || '#6B7280'}20`,
                          color: CATEGORY_COLORS[channel.category] || '#6B7280',
                        }}
                      >
                        {channel.category}
                      </span>
                    </div>
                    <div className="text-sm text-slate-500 mb-3">
                      {channel.integration_type === 'api' && '🔗 API 연동'}
                      {channel.integration_type === 'rpa' && '🤖 RPA 자동화'}
                      {channel.integration_type === 'manual' && '📤 수동 업로드'}
                      {SYNC_ENDPOINTS[channel.name] && (
                        <span className="ml-2 text-green-500 text-xs font-medium">연동완료</span>
                      )}
                    </div>
                    {summary ? (
                      <div className="space-y-1">
                        <div className="flex justify-between text-sm">
                          <span className="text-slate-500">매출</span>
                          <span className="font-medium text-blue-600">{formatCurrency(summary.gross_sales)}원</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-slate-500">주문</span>
                          <span className="font-medium text-emerald-600">{formatNumber(summary.order_count)}건</span>
                        </div>
                      </div>
                    ) : (
                      <div className="text-sm text-slate-400 text-center py-2">
                        데이터 없음
                      </div>
                    )}
                    <div className="flex gap-2 mt-3 pt-3 border-t border-slate-100">
                      {channel.name === '카페24' && !SYNC_ENDPOINTS[channel.name] ? null : channel.name === '카페24' ? (
                        <>
                          <button
                            onClick={connectCafe24}
                            disabled={cafe24Connecting}
                            className="flex-1 px-3 py-1.5 text-xs bg-orange-50 text-orange-700 rounded-lg hover:bg-orange-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                          >
                            {cafe24Connecting ? 'OAuth 연동 중...' : 'OAuth 연동'}
                          </button>
                          <button
                            onClick={() => syncChannel(channel)}
                            disabled={syncingChannelId === channel.id || isSyncing}
                            className="flex-1 px-3 py-1.5 text-xs bg-green-50 text-green-700 rounded-lg hover:bg-green-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-1"
                          >
                            {syncingChannelId === channel.id ? (
                              <>
                                <div className="w-3 h-3 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
                                동기화 중
                              </>
                            ) : (
                              '동기화'
                            )}
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => syncChannel(channel)}
                          disabled={syncingChannelId === channel.id || isSyncing}
                          className="flex-1 px-3 py-1.5 text-xs bg-green-50 text-green-700 rounded-lg hover:bg-green-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-1"
                        >
                          {syncingChannelId === channel.id ? (
                            <>
                              <div className="w-3 h-3 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
                              동기화 중
                            </>
                          ) : (
                            '동기화'
                          )}
                        </button>
                      )}
                      {(channel.name === '쿠팡 WING' || channel.name === '쿠팡 로켓') && (
                        <button
                          onClick={() => setShowCoupangSettings(true)}
                          className="flex-1 px-3 py-1.5 text-xs bg-amber-50 text-amber-700 rounded-lg hover:bg-amber-100 transition-colors"
                        >
                          설정
                        </button>
                      )}
                      <button
                        onClick={() => {
                          setSelectedChannel(channel);
                          setShowUploadModal(true);
                        }}
                        className="flex-1 px-3 py-1.5 text-xs bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 transition-colors"
                      >
                        수동입력
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-sm font-medium text-slate-600">채널</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-slate-600">카테고리</th>
                    <th className="px-4 py-3 text-right text-sm font-medium text-slate-600">매출</th>
                    <th className="px-4 py-3 text-right text-sm font-medium text-slate-600">주문수</th>
                    <th className="px-4 py-3 text-right text-sm font-medium text-slate-600">판매수량</th>
                    <th className="px-4 py-3 text-center text-sm font-medium text-slate-600">연동</th>
                    <th className="px-4 py-3 text-center text-sm font-medium text-slate-600">작업</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {channels.map((channel) => {
                    const summary = channelSummary.find(s => s.channel_id === channel.id);
                    return (
                      <tr key={channel.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 text-sm font-medium text-slate-800">{channel.name}</td>
                        <td className="px-4 py-3">
                          <span
                            className="px-2 py-0.5 text-xs rounded-full"
                            style={{
                              backgroundColor: `${CATEGORY_COLORS[channel.category] || '#6B7280'}20`,
                              color: CATEGORY_COLORS[channel.category] || '#6B7280',
                            }}
                          >
                            {channel.category}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-right font-medium text-blue-600">
                          {summary ? `${formatNumber(summary.gross_sales)}원` : '-'}
                        </td>
                        <td className="px-4 py-3 text-sm text-right text-slate-600">
                          {summary ? formatNumber(summary.order_count) : '-'}
                        </td>
                        <td className="px-4 py-3 text-sm text-right text-slate-600">
                          {summary ? formatNumber(summary.quantity) : '-'}
                        </td>
                        <td className="px-4 py-3 text-center text-sm">
                          {channel.integration_type === 'api' && '🔗'}
                          {channel.integration_type === 'rpa' && '🤖'}
                          {channel.integration_type === 'manual' && '📤'}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex items-center justify-center gap-2">
                            <button
                              onClick={() => syncChannel(channel)}
                              disabled={syncingChannelId === channel.id || isSyncing}
                              className="px-3 py-1 text-sm bg-green-100 text-green-700 rounded-lg hover:bg-green-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                              {syncingChannelId === channel.id ? '...' : '동기화'}
                            </button>
                            {(channel.name === '쿠팡 WING' || channel.name === '쿠팡 로켓') && (
                              <button
                                onClick={() => setShowCoupangSettings(true)}
                                className="px-3 py-1 text-sm bg-amber-100 text-amber-700 rounded-lg hover:bg-amber-200 transition-colors"
                              >
                                설정
                              </button>
                            )}
                            <button
                              onClick={() => {
                                setSelectedChannel(channel);
                                setShowUploadModal(true);
                              }}
                              className="px-3 py-1 text-sm bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 transition-colors"
                            >
                              수동입력
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* 업로드 모달 */}
      {showUploadModal && selectedChannel && (
        <UploadModal
          channel={selectedChannel}
          year={year}
          month={month}
          onClose={() => {
            setShowUploadModal(false);
            setSelectedChannel(null);
          }}
          onSuccess={() => {
            setShowUploadModal(false);
            setSelectedChannel(null);
            fetchSummary();
          }}
        />
      )}

      {/* 쿠팡 설정 모달 */}
      {showCoupangSettings && (
        <CoupangSettingsModal
          onClose={() => setShowCoupangSettings(false)}
          coupangWingStatus={coupangWingStatus}
          coupangRocketStatus={coupangRocketStatus}
          onStatusUpdate={() => fetchCoupangStatus()}
        />
      )}
    </main>
  );
}

// 쿠팡 설정 모달 컴포넌트
function CoupangSettingsModal({
  onClose,
  coupangWingStatus,
  coupangRocketStatus,
  onStatusUpdate,
}: {
  onClose: () => void;
  coupangWingStatus: { configured: boolean; connected: boolean; message: string } | null;
  coupangRocketStatus: { configured: boolean; connected: boolean; message: string; playwright_installed?: boolean } | null;
  onStatusUpdate: () => void;
}) {
  const [activeTab, setActiveTab] = useState<'wing' | 'rocket'>('wing');

  // 쿠팡 WING 폼
  const [wingVendorId, setWingVendorId] = useState('');
  const [wingAccessKey, setWingAccessKey] = useState('');
  const [wingSecretKey, setWingSecretKey] = useState('');
  const [wingSaving, setWingSaving] = useState(false);
  const [wingTesting, setWingTesting] = useState(false);
  const [wingMessage, setWingMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // 쿠팡 로켓 폼
  const [rocketLoginId, setRocketLoginId] = useState('');
  const [rocketLoginPassword, setRocketLoginPassword] = useState('');
  const [rocketSaving, setRocketSaving] = useState(false);
  const [rocketTesting, setRocketTesting] = useState(false);
  const [rocketMessage, setRocketMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const getAuthHeaders = () => {
    const token = localStorage.getItem('token');
    return {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
  };

  // 쿠팡 WING 저장
  const saveWingCredentials = async () => {
    if (!wingVendorId || !wingAccessKey || !wingSecretKey) {
      setWingMessage({ type: 'error', text: '모든 필드를 입력해주세요' });
      return;
    }
    setWingSaving(true);
    setWingMessage(null);
    try {
      const res = await fetch(`${API_BASE}/api/coupang-wing/credentials`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          vendor_id: wingVendorId,
          access_key: wingAccessKey,
          secret_key: wingSecretKey,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setWingMessage({ type: 'success', text: data.message || '저장되었습니다' });
        onStatusUpdate();
      } else {
        setWingMessage({ type: 'error', text: typeof data.detail === 'string' ? data.detail : '저장 실패' });
      }
    } catch (err: any) {
      setWingMessage({ type: 'error', text: err?.message || '네트워크 오류' });
    }
    setWingSaving(false);
  };

  // 쿠팡 WING 연결 테스트
  const testWingConnection = async () => {
    setWingTesting(true);
    setWingMessage(null);
    try {
      const res = await fetch(`${API_BASE}/api/coupang-wing/status`, {
        headers: getAuthHeaders(),
      });
      const data = await res.json();
      if (res.ok) {
        if (data.connected) {
          setWingMessage({ type: 'success', text: data.message || '연결 성공' });
        } else if (data.configured) {
          setWingMessage({ type: 'error', text: data.message || '인증 정보가 설정되었으나 연결에 실패했습니다' });
        } else {
          setWingMessage({ type: 'error', text: data.message || '인증 정보가 설정되지 않았습니다' });
        }
        onStatusUpdate();
      } else {
        setWingMessage({ type: 'error', text: '상태 조회 실패' });
      }
    } catch (err: any) {
      setWingMessage({ type: 'error', text: err?.message || '네트워크 오류' });
    }
    setWingTesting(false);
  };

  // 쿠팡 로켓 저장
  const saveRocketCredentials = async () => {
    if (!rocketLoginId || !rocketLoginPassword) {
      setRocketMessage({ type: 'error', text: '모든 필드를 입력해주세요' });
      return;
    }
    setRocketSaving(true);
    setRocketMessage(null);
    try {
      const res = await fetch(`${API_BASE}/api/coupang-rocket/credentials`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          login_id: rocketLoginId,
          login_password: rocketLoginPassword,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setRocketMessage({ type: 'success', text: data.message || '저장되었습니다' });
        onStatusUpdate();
      } else {
        setRocketMessage({ type: 'error', text: typeof data.detail === 'string' ? data.detail : '저장 실패' });
      }
    } catch (err: any) {
      setRocketMessage({ type: 'error', text: err?.message || '네트워크 오류' });
    }
    setRocketSaving(false);
  };

  // 쿠팡 로켓 연결 테스트
  const testRocketConnection = async () => {
    setRocketTesting(true);
    setRocketMessage(null);
    try {
      const res = await fetch(`${API_BASE}/api/coupang-rocket/status`, {
        headers: getAuthHeaders(),
      });
      const data = await res.json();
      if (res.ok) {
        if (data.connected) {
          setRocketMessage({ type: 'success', text: data.message || '연결 성공' });
        } else if (data.configured) {
          setRocketMessage({ type: 'error', text: data.message || '인증 정보가 설정되었으나 연결에 실패했습니다' });
        } else {
          setRocketMessage({ type: 'error', text: data.message || '인증 정보가 설정되지 않았습니다' });
        }
        onStatusUpdate();
      } else {
        setRocketMessage({ type: 'error', text: '상태 조회 실패' });
      }
    } catch (err: any) {
      setRocketMessage({ type: 'error', text: err?.message || '네트워크 오류' });
    }
    setRocketTesting(false);
  };

  const wingStatus = coupangWingStatus;
  const rocketStatus = coupangRocketStatus;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-hidden">
        {/* 헤더 */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-slate-800">쿠팡 채널 설정</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 탭 */}
        <div className="px-6 pt-4">
          <div className="flex gap-2">
            <button
              onClick={() => setActiveTab('wing')}
              className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${
                activeTab === 'wing'
                  ? 'bg-blue-500 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              쿠팡 WING
            </button>
            <button
              onClick={() => setActiveTab('rocket')}
              className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${
                activeTab === 'rocket'
                  ? 'bg-blue-500 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              쿠팡 로켓
            </button>
          </div>
        </div>

        {/* 탭 컨텐츠 */}
        <div className="p-6">
          {activeTab === 'wing' ? (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  업체코드 (Vendor ID)
                </label>
                <input
                  type="text"
                  value={wingVendorId}
                  onChange={(e) => setWingVendorId(e.target.value)}
                  placeholder="업체코드를 입력하세요"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Access Key
                </label>
                <input
                  type="text"
                  value={wingAccessKey}
                  onChange={(e) => setWingAccessKey(e.target.value)}
                  placeholder="Access Key를 입력하세요"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Secret Key
                </label>
                <input
                  type="password"
                  value={wingSecretKey}
                  onChange={(e) => setWingSecretKey(e.target.value)}
                  placeholder="Secret Key를 입력하세요"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* 상태 표시 */}
              <div className="flex items-center gap-2 text-sm">
                {wingStatus ? (
                  wingStatus.connected ? (
                    <>
                      <span className="w-2.5 h-2.5 rounded-full bg-green-500" />
                      <span className="text-green-700">연결됨</span>
                    </>
                  ) : wingStatus.configured ? (
                    <>
                      <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                      <span className="text-amber-700">설정됨 (미연결)</span>
                    </>
                  ) : (
                    <>
                      <span className="w-2.5 h-2.5 rounded-full bg-slate-300" />
                      <span className="text-slate-500">미설정</span>
                    </>
                  )
                ) : (
                  <>
                    <span className="w-2.5 h-2.5 rounded-full bg-slate-300" />
                    <span className="text-slate-500">상태 확인 중...</span>
                  </>
                )}
              </div>

              {/* 메시지 */}
              {wingMessage && (
                <div className={`p-3 text-sm rounded-lg ${
                  wingMessage.type === 'success'
                    ? 'bg-green-50 text-green-700 border border-green-200'
                    : 'bg-red-50 text-red-700 border border-red-200'
                }`}>
                  {wingMessage.text}
                </div>
              )}

              {/* 버튼 */}
              <div className="flex gap-3 pt-2">
                <button
                  onClick={testWingConnection}
                  disabled={wingTesting}
                  className="flex-1 px-4 py-2 text-sm bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                >
                  {wingTesting ? (
                    <>
                      <div className="w-4 h-4 border-2 border-slate-500 border-t-transparent rounded-full animate-spin" />
                      테스트 중...
                    </>
                  ) : (
                    '연결 테스트'
                  )}
                </button>
                <button
                  onClick={saveWingCredentials}
                  disabled={wingSaving}
                  className="flex-1 px-4 py-2 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                >
                  {wingSaving ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      저장 중...
                    </>
                  ) : (
                    '저장'
                  )}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  로그인 ID
                </label>
                <input
                  type="text"
                  value={rocketLoginId}
                  onChange={(e) => setRocketLoginId(e.target.value)}
                  placeholder="쿠팡 로그인 ID를 입력하세요"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  로그인 비밀번호
                </label>
                <input
                  type="password"
                  value={rocketLoginPassword}
                  onChange={(e) => setRocketLoginPassword(e.target.value)}
                  placeholder="로그인 비밀번호를 입력하세요"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* 상태 표시 */}
              <div className="flex items-center gap-2 text-sm">
                {rocketStatus ? (
                  rocketStatus.connected ? (
                    <>
                      <span className="w-2.5 h-2.5 rounded-full bg-green-500" />
                      <span className="text-green-700">연결됨</span>
                    </>
                  ) : rocketStatus.configured ? (
                    <>
                      <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                      <span className="text-amber-700">설정됨 (미연결)</span>
                    </>
                  ) : (
                    <>
                      <span className="w-2.5 h-2.5 rounded-full bg-slate-300" />
                      <span className="text-slate-500">미설정</span>
                    </>
                  )
                ) : (
                  <>
                    <span className="w-2.5 h-2.5 rounded-full bg-slate-300" />
                    <span className="text-slate-500">상태 확인 중...</span>
                  </>
                )}
                {rocketStatus && rocketStatus.playwright_installed === false && (
                  <span className="ml-2 text-xs text-red-500">(Playwright 미설치)</span>
                )}
              </div>

              {/* 메시지 */}
              {rocketMessage && (
                <div className={`p-3 text-sm rounded-lg ${
                  rocketMessage.type === 'success'
                    ? 'bg-green-50 text-green-700 border border-green-200'
                    : 'bg-red-50 text-red-700 border border-red-200'
                }`}>
                  {rocketMessage.text}
                </div>
              )}

              {/* 버튼 */}
              <div className="flex gap-3 pt-2">
                <button
                  onClick={testRocketConnection}
                  disabled={rocketTesting}
                  className="flex-1 px-4 py-2 text-sm bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                >
                  {rocketTesting ? (
                    <>
                      <div className="w-4 h-4 border-2 border-slate-500 border-t-transparent rounded-full animate-spin" />
                      테스트 중...
                    </>
                  ) : (
                    '연결 테스트'
                  )}
                </button>
                <button
                  onClick={saveRocketCredentials}
                  disabled={rocketSaving}
                  className="flex-1 px-4 py-2 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                >
                  {rocketSaving ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      저장 중...
                    </>
                  ) : (
                    '저장'
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// 업로드 모달 컴포넌트
function UploadModal({
  channel,
  year,
  month,
  onClose,
  onSuccess,
}: {
  channel: Channel;
  year: number;
  month: number;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manualData, setManualData] = useState<{ day: number; gross_sales: string; order_count: string }[]>([]);
  const [mode, setMode] = useState<'file' | 'manual'>('file');

  const daysInMonth = new Date(year, month, 0).getDate();

  useEffect(() => {
    // 수동 입력용 빈 데이터 초기화
    setManualData(
      Array.from({ length: daysInMonth }, (_, i) => ({
        day: i + 1,
        gross_sales: '',
        order_count: '',
      }))
    );
  }, [daysInMonth]);

  const handleFileUpload = async () => {
    if (!file) return;

    setIsUploading(true);
    setError(null);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('channel_id', channel.id);
    formData.append('channel_name', channel.name);
    formData.append('year', year.toString());
    formData.append('month', month.toString());

    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/channels/sales/upload`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
        body: formData,
      });

      if (res.ok) {
        onSuccess();
      } else {
        const data = await res.json();
        setError(data.detail || '업로드 실패');
      }
    } catch (err) {
      setError('업로드 중 오류가 발생했습니다');
    }
    setIsUploading(false);
  };

  const handleManualSubmit = async () => {
    const salesData = manualData
      .filter(d => d.gross_sales || d.order_count)
      .map(d => ({
        day: d.day,
        gross_sales: parseFloat(d.gross_sales) || 0,
        order_count: parseInt(d.order_count) || 0,
      }));

    if (salesData.length === 0) {
      setError('최소 하나의 데이터를 입력해주세요');
      return;
    }

    setIsUploading(true);
    setError(null);

    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/channels/sales/bulk`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          channel_id: channel.id,
          channel_name: channel.name,
          year,
          month,
          sales_data: salesData,
        }),
      });

      if (res.ok) {
        onSuccess();
      } else {
        const data = await res.json();
        setError(data.detail || '저장 실패');
      }
    } catch (err) {
      setError('저장 중 오류가 발생했습니다');
    }
    setIsUploading(false);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-slate-800">{channel.name} 매출 데이터 입력</h3>
            <p className="text-sm text-slate-500">{year}년 {month}월</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6">
          {/* 모드 선택 */}
          <div className="flex gap-2 mb-6">
            <button
              onClick={() => setMode('file')}
              className={`flex-1 py-2 rounded-lg transition-colors ${
                mode === 'file'
                  ? 'bg-blue-500 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              파일 업로드
            </button>
            <button
              onClick={() => setMode('manual')}
              className={`flex-1 py-2 rounded-lg transition-colors ${
                mode === 'manual'
                  ? 'bg-blue-500 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              수동 입력
            </button>
          </div>

          {mode === 'file' ? (
            <div className="space-y-4">
              <div className="border-2 border-dashed border-slate-200 rounded-xl p-8 text-center">
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                  className="hidden"
                  id="file-upload"
                />
                <label htmlFor="file-upload" className="cursor-pointer">
                  <div className="text-slate-400 mb-2">
                    <svg className="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                  </div>
                  <p className="text-slate-600 mb-1">Excel 또는 CSV 파일을 선택하세요</p>
                  <p className="text-sm text-slate-400">xlsx, xls, csv 지원</p>
                </label>
              </div>
              {file && (
                <div className="flex items-center gap-2 p-3 bg-blue-50 rounded-lg">
                  <svg className="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <span className="text-sm text-blue-700 flex-1">{file.name}</span>
                  <button onClick={() => setFile(null)} className="text-blue-500 hover:text-blue-700">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              )}
              <div className="text-sm text-slate-500 bg-slate-50 p-4 rounded-lg">
                <p className="font-medium mb-2">파일 형식 안내</p>
                <ul className="list-disc list-inside space-y-1">
                  <li>필수 컬럼: 날짜(또는 일), 매출</li>
                  <li>선택 컬럼: 주문수, 판매수량, 환불, 수수료</li>
                </ul>
              </div>
            </div>
          ) : (
            <div className="max-h-96 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left">일</th>
                    <th className="px-3 py-2 text-left">매출</th>
                    <th className="px-3 py-2 text-left">주문수</th>
                  </tr>
                </thead>
                <tbody>
                  {manualData.map((row, idx) => (
                    <tr key={row.day} className="border-b border-slate-100">
                      <td className="px-3 py-2 font-medium">{row.day}일</td>
                      <td className="px-3 py-1">
                        <input
                          type="number"
                          value={row.gross_sales}
                          onChange={(e) => {
                            const newData = [...manualData];
                            newData[idx].gross_sales = e.target.value;
                            setManualData(newData);
                          }}
                          placeholder="0"
                          className="w-full px-2 py-1 border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                      </td>
                      <td className="px-3 py-1">
                        <input
                          type="number"
                          value={row.order_count}
                          onChange={(e) => {
                            const newData = [...manualData];
                            newData[idx].order_count = e.target.value;
                            setManualData(newData);
                          }}
                          placeholder="0"
                          className="w-full px-2 py-1 border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {error && (
            <div className="mt-4 p-3 bg-red-50 text-red-600 text-sm rounded-lg">
              {error}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-slate-600 hover:text-slate-800"
          >
            취소
          </button>
          <button
            onClick={mode === 'file' ? handleFileUpload : handleManualSubmit}
            disabled={isUploading || (mode === 'file' && !file)}
            className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isUploading ? '처리 중...' : mode === 'file' ? '업로드' : '저장'}
          </button>
        </div>
      </div>
    </div>
  );
}
