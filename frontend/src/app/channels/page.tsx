'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Navigation } from '@/components/layout/Navigation';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell
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
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();

  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [channelSummary, setChannelSummary] = useState<ChannelSummary[]>([]);
  const [dailySummary, setDailySummary] = useState<DailySummary | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(null);
  const [chartMode, setChartMode] = useState<'daily' | 'cumulative'>('cumulative');
  const [viewMode, setViewMode] = useState<'chart' | 'table'>('chart');
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncingChannelId, setSyncingChannelId] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

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
      const [channelRes, dailyRes] = await Promise.all([
        fetch(`${API_BASE}/api/channels/sales/by-channel?year=${year}&month=${month}`, {
          headers: getAuthHeaders(),
        }),
        fetch(`${API_BASE}/api/channels/sales/summary?year=${year}&month=${month}`, {
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
    } catch (error) {
      console.error('Failed to fetch summary:', error);
    }
    setIsLoading(false);
  }, [year, month]);

  // 채널명 → API 동기화 엔드포인트 매핑 (연동 구현된 채널만)
  const SYNC_ENDPOINTS: Record<string, string> = {
    '스마트스토어': '/api/smartstore/sync',
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
        body: JSON.stringify({ year, month, channel_id: channel.id }),
      });
      const data = await res.json();
      if (res.ok) {
        const debugInfo = data.debug ? ` (주문 ${data.debug.raw_orders_count}건, 집계 ${data.debug.daily_sales_count}일)` : '';
        setSyncResult({ type: 'success', message: `[${channel.name}] ${data.message}${debugInfo}` });
        fetchSummary();
      } else {
        setSyncResult({ type: 'error', message: `[${channel.name}] ${data.detail || '동기화 실패'}` });
      }
    } catch (err) {
      setSyncResult({ type: 'error', message: `[${channel.name}] 동기화 중 오류가 발생했습니다` });
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
          body: JSON.stringify({ year, month, channel_id: channel.id }),
        });
        const data = await res.json();
        if (res.ok) {
          results.push(channel.name);
        } else {
          errors.push(`${channel.name}: ${data.detail || '실패'}`);
        }
      } catch {
        errors.push(`${channel.name}: 오류 발생`);
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

  // 채널별 파이차트 데이터
  const pieChartData = channelSummary
    .filter(c => c.gross_sales > 0)
    .sort((a, b) => b.gross_sales - a.gross_sales)
    .map((c, i) => ({
      name: c.channel_name,
      value: c.gross_sales,
      color: COLORS[i % COLORS.length],
    }));

  // 일별 차트 데이터
  const dailyChartData = dailySummary?.daily.map(d => ({
    day: `${d.day}일`,
    매출: chartMode === 'cumulative' ? d.cumulative_gross : d.gross_sales,
    주문: d.order_count,
  })) || [];

  // 카테고리별 합계
  const categoryTotals = channelSummary.reduce((acc, c) => {
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
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-slate-600">년도:</label>
              <select
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {years.map((y) => (
                  <option key={y} value={y}>{y}년</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-slate-600">월:</label>
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
          </div>

          {/* 총합계 카드 */}
          {dailySummary && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
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
              </div>
            </div>
            {isLoading ? (
              <div className="h-64 flex items-center justify-center">
                <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : dailyChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                {chartMode === 'cumulative' ? (
                  <LineChart data={dailyChartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                    <YAxis tickFormatter={(value) => formatCurrency(value)} tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(value: number) => [`${formatNumber(value)}원`, '매출']} />
                    <Legend />
                    <Line type="monotone" dataKey="매출" stroke="#3B82F6" strokeWidth={2} dot={false} />
                  </LineChart>
                ) : (
                  <BarChart data={dailyChartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                    <YAxis tickFormatter={(value) => formatCurrency(value)} tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(value: number) => [`${formatNumber(value)}원`, '매출']} />
                    <Legend />
                    <Bar dataKey="매출" fill="#3B82F6" />
                  </BarChart>
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
    </main>
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
