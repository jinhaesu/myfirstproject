'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { SalesModal } from './SalesModal';
import { DataItemActions } from './DataItemActions';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

interface Sale {
  id: string;
  year: number;
  month: number;
  title: string;
  manager: string;
  kpi_type: string;
  grid_data: string[][];
  created_at: string;
}

interface Comparison {
  target: {
    total_sales: number;
    total_quantity: number;
    total_contribution: number;
    total_advertising: number;
  };
  current: {
    total_sales: number;
    total_quantity: number;
    total_marketing: number;
    total_contribution: number;
  };
  previous: {
    total_sales: number;
    total_quantity: number;
    total_marketing: number;
    total_contribution: number;
    has_data: boolean;
  };
  vs_target: {
    sales_rate: number | null;
    quantity_rate: number | null;
    contribution_rate: number | null;
    marketing_rate: number | null;
  };
  vs_previous: {
    sales_change: number | null;
    quantity_change: number | null;
    contribution_change: number | null;
    marketing_change: number | null;
    has_data: boolean;
  };
}

interface RealtimeIndicator {
  target_day: number;
  days_in_month: number;
  daily_target: {
    total_sales: number;
    total_quantity: number;
    total_contribution: number;
    total_advertising: number;
  };
  current: {
    total_sales: number;
    total_quantity: number;
    total_marketing: number;
    total_contribution: number;
  };
  achievement_rate: {
    sales_rate: number | null;
    quantity_rate: number | null;
    contribution_rate: number | null;
    marketing_rate: number | null;
  };
}

interface DailyChartData {
  days_in_month: number;
  target_day: number;
  daily: {
    sales: number[];
    quantity: number[];
    contribution: number[];
    marketing: number[];
  };
  cumulative: {
    sales: number[];
    quantity: number[];
    contribution: number[];
    marketing: number[];
  };
}

interface DailyTargetData {
  days_in_month: number;
  monthly_target: {
    total_sales: number;
    total_quantity: number;
    total_contribution: number;
    total_advertising: number;
  };
  daily_target: {
    sales: number;
    quantity: number;
    contribution: number;
    advertising: number;
  };
  daily: {
    sales: number[];
    quantity: number[];
    contribution: number[];
    advertising: number[];
  };
  cumulative: {
    sales: number[];
    quantity: number[];
    contribution: number[];
    advertising: number[];
  };
}

interface SalesChartData {
  name: string;
  매출: number;
  판매량: number;
  공헌이익: number;
  마케팅비: number;
}

interface SalesStatusSectionProps {
  selectedYear: number;
  selectedMonth: number;
  excludeVat?: boolean;
}

const years = Array.from({ length: 13 }, (_, i) => 2018 + i);
const months = Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: `${i + 1}월` }));

export function SalesStatusSection({ selectedYear, selectedMonth, excludeVat = false }: SalesStatusSectionProps) {
  const [year, setYear] = useState(selectedYear);
  const [month, setMonth] = useState(selectedMonth);
  const [sales, setSales] = useState<Sale[]>([]);
  const [allSales, setAllSales] = useState<Sale[]>([]);
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [realtime, setRealtime] = useState<RealtimeIndicator | null>(null);
  const [dailyChart, setDailyChart] = useState<DailyChartData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSale, setEditingSale] = useState<Sale | null>(null);
  const [selectedManager, setSelectedManager] = useState<string>('all');
  const [chartMode, setChartMode] = useState<'daily' | 'cumulative'>('cumulative');
  const [showRealtimeChart, setShowRealtimeChart] = useState(false);
  const [showTargetLine, setShowTargetLine] = useState(false);
  const [dailyTargetData, setDailyTargetData] = useState<DailyTargetData | null>(null);

  // 책임자별/기준별 차트 상태
  const [showManagerChart, setShowManagerChart] = useState(false);
  const [showCriteriaChart, setShowCriteriaChart] = useState(false);
  const [managerChartData, setManagerChartData] = useState<SalesChartData[]>([]);
  const [criteriaChartData, setCriteriaChartData] = useState<SalesChartData[]>([]);

  const managers = useMemo(() => {
    const managerSet = new Set(allSales.map((sale) => sale.manager));
    return Array.from(managerSet).sort();
  }, [allSales]);

  const getAuthHeaders = () => {
    const token = localStorage.getItem('token');
    return {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
  };

  // 부가세 계산 (부가세 별도 시 /1.1)
  const applyVat = useCallback((value: number) => {
    return excludeVat ? Math.round(value / 1.1) : value;
  }, [excludeVat]);

  const fetchSales = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/targets/sales/list?year=${year}&month=${month}`, {
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        setAllSales(data);
        if (selectedManager === 'all') {
          setSales(data);
        } else {
          setSales(data.filter((sale: Sale) => sale.manager === selectedManager));
        }
      }
    } catch (error) {
      console.error('Failed to fetch sales:', error);
    }
    setIsLoading(false);
  }, [year, month, selectedManager]);

  const fetchComparison = useCallback(async () => {
    try {
      let url = `${API_BASE}/api/targets/sales/comparison?year=${year}&month=${month}`;
      if (selectedManager && selectedManager !== 'all') {
        url += `&manager=${encodeURIComponent(selectedManager)}`;
      }
      const res = await fetch(url, {
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        setComparison(data);
      }
    } catch (error) {
      console.error('Failed to fetch comparison:', error);
    }
  }, [year, month, selectedManager]);

  const fetchRealtime = useCallback(async () => {
    try {
      let url = `${API_BASE}/api/targets/sales/realtime?year=${year}&month=${month}`;
      if (selectedManager && selectedManager !== 'all') {
        url += `&manager=${encodeURIComponent(selectedManager)}`;
      }
      const res = await fetch(url, {
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        setRealtime(data);
      }
    } catch (error) {
      console.error('Failed to fetch realtime:', error);
    }
  }, [year, month, selectedManager]);

  const fetchDailyChart = useCallback(async () => {
    try {
      let url = `${API_BASE}/api/targets/sales/daily-chart?year=${year}&month=${month}`;
      if (selectedManager && selectedManager !== 'all') {
        url += `&manager=${encodeURIComponent(selectedManager)}`;
      }
      const res = await fetch(url, {
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        setDailyChart(data);
      }
    } catch (error) {
      console.error('Failed to fetch daily chart:', error);
    }
  }, [year, month, selectedManager]);

  const fetchDailyTargetData = useCallback(async () => {
    try {
      let url = `${API_BASE}/api/targets/sales/daily-target?year=${year}&month=${month}`;
      if (selectedManager && selectedManager !== 'all') {
        url += `&manager=${encodeURIComponent(selectedManager)}`;
      }
      const res = await fetch(url, {
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        setDailyTargetData(data);
      }
    } catch (error) {
      console.error('Failed to fetch daily target data:', error);
    }
  }, [year, month, selectedManager]);

  const fetchManagerChartData = useCallback(async () => {
    if (!showManagerChart) return;
    try {
      const res = await fetch(`${API_BASE}/api/targets/sales/chart/by-manager?year=${year}&month=${month}`, {
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        const chartData: SalesChartData[] = Object.entries(data.by_manager || {}).map(([manager, values]: [string, any]) => ({
          name: manager,
          매출: values.매출 || 0,
          판매량: values.판매량 || 0,
          공헌이익: values.공헌이익 || 0,
          마케팅비: values.마케팅비 || 0,
        }));
        setManagerChartData(chartData);
      }
    } catch (error) {
      console.error('Failed to fetch manager chart data:', error);
    }
  }, [year, month, showManagerChart]);

  const fetchCriteriaChartData = useCallback(async () => {
    if (!showCriteriaChart) return;
    try {
      const res = await fetch(`${API_BASE}/api/targets/sales/chart/by-criteria?year=${year}&month=${month}`, {
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        const chartData: SalesChartData[] = Object.entries(data.by_criteria || {}).map(([criteria, values]: [string, any]) => ({
          name: criteria,
          매출: values.매출 || 0,
          판매량: values.판매량 || 0,
          공헌이익: values.공헌이익 || 0,
          마케팅비: values.마케팅비 || 0,
        }));
        setCriteriaChartData(chartData);
      }
    } catch (error) {
      console.error('Failed to fetch criteria chart data:', error);
    }
  }, [year, month, showCriteriaChart]);

  useEffect(() => {
    fetchSales();
    fetchComparison();
    fetchRealtime();
    fetchDailyChart();
    fetchDailyTargetData();
  }, [fetchSales, fetchComparison, fetchRealtime, fetchDailyChart, fetchDailyTargetData]);

  useEffect(() => {
    fetchManagerChartData();
  }, [fetchManagerChartData]);

  useEffect(() => {
    fetchCriteriaChartData();
  }, [fetchCriteriaChartData]);

  const handleSave = async (data: Omit<Sale, 'id' | 'created_at'>) => {
    try {
      const url = editingSale
        ? `${API_BASE}/api/targets/sales/${editingSale.id}`
        : `${API_BASE}/api/targets/sales`;
      const method = editingSale ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: getAuthHeaders(),
        body: JSON.stringify(data),
      });

      if (res.ok) {
        setIsModalOpen(false);
        setEditingSale(null);
        fetchSales();
        fetchComparison();
        fetchRealtime();
        fetchDailyChart();
      }
    } catch (error) {
      console.error('Failed to save sale:', error);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('정말 삭제하시겠습니까?')) return;

    try {
      const res = await fetch(`${API_BASE}/api/targets/sales/${id}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        fetchSales();
        fetchComparison();
        fetchRealtime();
        fetchDailyChart();
      }
    } catch (error) {
      console.error('Failed to delete sale:', error);
    }
  };

  const handleEdit = (sale: Sale) => {
    setEditingSale(sale);
    setIsModalOpen(true);
  };

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat('ko-KR').format(applyVat(num));
  };

  const formatNumberRaw = (num: number) => {
    return new Intl.NumberFormat('ko-KR').format(num);
  };

  const renderRate = (rate: number | null, isPositiveGood: boolean = true) => {
    if (rate === null) return <span className="text-slate-400">-</span>;
    const isGood = isPositiveGood ? rate >= 100 : rate <= 100;
    return (
      <span className={isGood ? 'text-emerald-600' : 'text-red-500'}>
        {rate.toFixed(1)}%
      </span>
    );
  };

  const renderChange = (change: number | null) => {
    if (change === null) return <span className="text-slate-400">-</span>;
    const isPositive = change >= 0;
    return (
      <span className={isPositive ? 'text-emerald-600' : 'text-red-500'}>
        {isPositive ? '+' : ''}{change.toFixed(1)}%
      </span>
    );
  };

  // 차트 데이터 생성 (목표 값 포함)
  const chartData = useMemo(() => {
    if (!dailyChart) return [];
    const salesData = chartMode === 'cumulative' ? dailyChart.cumulative : dailyChart.daily;
    const targetData = dailyTargetData ? (chartMode === 'cumulative' ? dailyTargetData.cumulative : dailyTargetData.daily) : null;

    return Array.from({ length: dailyChart.days_in_month }, (_, i) => {
      const item: { day: string; 매출: number; 목표?: number } = {
        day: `${i + 1}일`,
        매출: applyVat(salesData.sales[i] || 0),
      };
      if (showTargetLine && targetData) {
        item.목표 = applyVat(targetData.sales[i] || 0);
      }
      return item;
    });
  }, [dailyChart, dailyTargetData, chartMode, applyVat, showTargetLine]);

  return (
    <section className="mb-8">
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        {/* 헤더 */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-800">매출 현황 및 실시간</h2>
          <button
            onClick={() => {
              setEditingSale(null);
              setIsModalOpen(true);
            }}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
            기입하기
          </button>
        </div>

        {/* 년도/월 선택 & 합계 */}
        <div className="px-6 py-4 bg-slate-50 border-b border-slate-200">
          <div className="flex flex-wrap items-center gap-4 mb-4">
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-slate-600">기준 년도:</label>
              <select
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
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
                className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                {months.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-slate-600">책임자:</label>
              <select
                value={selectedManager}
                onChange={(e) => setSelectedManager(e.target.value)}
                className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                <option value="all">전체</option>
                {managers.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
          </div>

          {/* 비교 데이터 표시 */}
          {comparison && (
            <>
              {/* 현재 합계 */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                <div className="bg-white p-4 rounded-xl border border-slate-200">
                  <p className="text-sm text-slate-500 mb-1">
                    매출 합계 <span className="text-xs text-slate-400">({excludeVat ? '부가세 별도' : '부가세 합계'})</span>
                  </p>
                  <p className="text-xl font-bold text-blue-600">
                    {comparison.current.total_sales > 0 ? `${formatNumber(comparison.current.total_sales)}원` : '없음'}
                  </p>
                </div>
                <div className="bg-white p-4 rounded-xl border border-slate-200">
                  <p className="text-sm text-slate-500 mb-1">판매수량 합계</p>
                  <p className="text-xl font-bold text-emerald-600">
                    {comparison.current.total_quantity > 0 ? formatNumberRaw(comparison.current.total_quantity) : '없음'}
                  </p>
                </div>
                <div className="bg-white p-4 rounded-xl border border-slate-200">
                  <p className="text-sm text-slate-500 mb-1">
                    마케팅비 <span className="text-xs text-slate-400">({excludeVat ? '부가세 별도' : '부가세 합계'})</span>
                  </p>
                  <p className="text-xl font-bold text-orange-600">
                    {comparison.current.total_marketing > 0 ? `${formatNumber(comparison.current.total_marketing)}원` : '없음'}
                  </p>
                </div>
                <div className="bg-white p-4 rounded-xl border border-slate-200">
                  <p className="text-sm text-slate-500 mb-1">
                    공헌이익 합계 <span className="text-xs text-slate-400">({excludeVat ? '부가세 별도' : '부가세 합계'})</span>
                  </p>
                  <p className="text-xl font-bold text-purple-600">
                    {comparison.current.total_contribution > 0 ? `${formatNumber(comparison.current.total_contribution)}원` : '없음'}
                  </p>
                </div>
              </div>

              {/* 목표 대비 & 전월 대비 */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-white p-4 rounded-xl border border-slate-200">
                  <h4 className="text-sm font-semibold text-slate-700 mb-3">
                    월간 목표 대비 달성률
                    {selectedManager !== 'all' && (
                      <span className="text-xs text-blue-500 ml-2">({selectedManager} 기준)</span>
                    )}
                  </h4>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-xs text-slate-500">매출</p>
                      <p className="text-lg font-bold">{renderRate(comparison.vs_target.sales_rate)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">판매량</p>
                      <p className="text-lg font-bold">{renderRate(comparison.vs_target.quantity_rate)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">공헌이익</p>
                      <p className="text-lg font-bold">{renderRate(comparison.vs_target.contribution_rate)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">마케팅비</p>
                      <p className="text-lg font-bold">{renderRate(comparison.vs_target.marketing_rate, false)}</p>
                    </div>
                  </div>
                </div>
                <div className="bg-white p-4 rounded-xl border border-slate-200">
                  <h4 className="text-sm font-semibold text-slate-700 mb-3">
                    전월 대비 변화
                    <span className="font-normal text-slate-400 ml-1">
                      ({month === 1 ? year - 1 : year}년 {month === 1 ? 12 : month - 1}월 대비)
                    </span>
                  </h4>
                  {comparison.vs_previous.has_data ? (
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <p className="text-xs text-slate-500">매출</p>
                        <p className="text-lg font-bold">{renderChange(comparison.vs_previous.sales_change)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500">판매량</p>
                        <p className="text-lg font-bold">{renderChange(comparison.vs_previous.quantity_change)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500">공헌이익</p>
                        <p className="text-lg font-bold">{renderChange(comparison.vs_previous.contribution_change)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500">마케팅비</p>
                        <p className="text-lg font-bold">{renderChange(comparison.vs_previous.marketing_change)}</p>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-4 text-slate-500 text-sm">
                      전월 데이터 입력 필요
                    </div>
                  )}
                </div>
              </div>

              {/* 차트 토글 체크박스 */}
              <div className="flex items-center gap-6 mt-4 pt-4 border-t border-slate-200">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showManagerChart}
                    onChange={(e) => setShowManagerChart(e.target.checked)}
                    className="w-4 h-4 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500"
                  />
                  <span className="text-sm font-medium text-slate-700">책임자별 현황 지표</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showCriteriaChart}
                    onChange={(e) => setShowCriteriaChart(e.target.checked)}
                    className="w-4 h-4 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500"
                  />
                  <span className="text-sm font-medium text-slate-700">기준별 현황 지표</span>
                </label>
              </div>
            </>
          )}
        </div>

        {/* 책임자별/기준별 차트 영역 */}
        {(showManagerChart || showCriteriaChart) && (
          <div className="px-6 py-4 border-b border-slate-200">
            <div className={`grid gap-6 ${showManagerChart && showCriteriaChart ? 'md:grid-cols-2' : 'grid-cols-1'}`}>
              {/* 책임자별 차트 */}
              {showManagerChart && managerChartData.length > 0 && (
                <div className="bg-white p-4 rounded-xl border border-slate-200">
                  <h3 className="text-sm font-semibold text-slate-700 mb-4">책임자별 현황 지표</h3>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={managerChartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} tickFormatter={(value) => {
                        if (value >= 100000000) return `${(value / 100000000).toFixed(0)}억`;
                        if (value >= 10000) return `${(value / 10000).toFixed(0)}만`;
                        return value.toString();
                      }} />
                      <Tooltip formatter={(value: number) => new Intl.NumberFormat('ko-KR').format(applyVat(value))} />
                      <Legend />
                      <Bar dataKey="매출" fill="#3b82f6" />
                      <Bar dataKey="판매량" fill="#10b981" />
                      <Bar dataKey="공헌이익" fill="#8b5cf6" />
                      <Bar dataKey="마케팅비" fill="#f97316" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* 기준별 차트 */}
              {showCriteriaChart && criteriaChartData.length > 0 && (
                <div className="bg-white p-4 rounded-xl border border-slate-200">
                  <h3 className="text-sm font-semibold text-slate-700 mb-4">기준별 현황 지표</h3>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={criteriaChartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} tickFormatter={(value) => {
                        if (value >= 100000000) return `${(value / 100000000).toFixed(0)}억`;
                        if (value >= 10000) return `${(value / 10000).toFixed(0)}만`;
                        return value.toString();
                      }} />
                      <Tooltip formatter={(value: number) => new Intl.NumberFormat('ko-KR').format(applyVat(value))} />
                      <Legend />
                      <Bar dataKey="매출" fill="#3b82f6" />
                      <Bar dataKey="판매량" fill="#10b981" />
                      <Bar dataKey="공헌이익" fill="#8b5cf6" />
                      <Bar dataKey="마케팅비" fill="#f97316" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 실시간 지표 섹션 */}
        {realtime && (
          <div className="px-6 py-4 bg-gradient-to-r from-blue-50 to-indigo-50 border-b border-slate-200">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-md font-semibold text-slate-800 flex items-center gap-2">
                <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
                실시간 지표
                <span className="text-xs font-normal text-slate-500">
                  ({realtime.target_day}일/{realtime.days_in_month}일 기준)
                </span>
                {selectedManager !== 'all' && (
                  <span className="text-xs text-blue-500">({selectedManager})</span>
                )}
              </h3>
              <button
                onClick={() => setShowRealtimeChart(!showRealtimeChart)}
                className="flex items-center gap-1 px-3 py-1.5 text-sm bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
                {showRealtimeChart ? '그래프 숨기기' : '그래프 보기'}
              </button>
            </div>

            {/* 당일 기준 목표 대비 달성률 */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
              <div className="bg-white p-4 rounded-xl border border-blue-100 shadow-sm">
                <p className="text-sm text-slate-500 mb-1">
                  당일 기준 매출 목표 <span className="text-xs text-slate-400">({excludeVat ? '부가세 별도' : '부가세 합계'})</span>
                </p>
                <p className="text-lg font-bold text-slate-700">
                  {formatNumber(realtime.daily_target.total_sales)}원
                </p>
                <p className="text-xs text-slate-400 mt-1">
                  실적: {formatNumber(realtime.current.total_sales)}원
                </p>
              </div>
              <div className="bg-white p-4 rounded-xl border border-blue-100 shadow-sm">
                <p className="text-sm text-slate-500 mb-1">당일 기준 매출 달성률</p>
                <p className="text-2xl font-bold">{renderRate(realtime.achievement_rate.sales_rate)}</p>
              </div>
              <div className="bg-white p-4 rounded-xl border border-blue-100 shadow-sm">
                <p className="text-sm text-slate-500 mb-1">당일 기준 판매량 목표</p>
                <p className="text-lg font-bold text-slate-700">
                  {formatNumberRaw(realtime.daily_target.total_quantity)}
                </p>
                <p className="text-xs text-slate-400 mt-1">
                  실적: {formatNumberRaw(realtime.current.total_quantity)}
                </p>
              </div>
              <div className="bg-white p-4 rounded-xl border border-blue-100 shadow-sm">
                <p className="text-sm text-slate-500 mb-1">당일 기준 판매량 달성률</p>
                <p className="text-2xl font-bold">{renderRate(realtime.achievement_rate.quantity_rate)}</p>
              </div>
            </div>

            {/* 실시간 그래프 */}
            {showRealtimeChart && dailyChart && (
              <div className="bg-white p-4 rounded-xl border border-slate-200">
                <div className="flex items-center justify-between mb-4">
                  <h4 className="text-sm font-semibold text-slate-700">일별 매출 추이</h4>
                  <div className="flex items-center gap-3">
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
                    <label className="flex items-center gap-1.5 cursor-pointer ml-2 pl-2 border-l border-slate-200">
                      <input
                        type="checkbox"
                        checked={showTargetLine}
                        onChange={(e) => setShowTargetLine(e.target.checked)}
                        className="w-4 h-4 text-orange-500 rounded border-slate-300 focus:ring-orange-500"
                      />
                      <span className="text-sm text-slate-600">목표 값 표시</span>
                    </label>
                  </div>
                </div>
                <ResponsiveContainer width="100%" height={300}>
                  {chartMode === 'cumulative' ? (
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="day" tick={{ fontSize: 12 }} />
                      <YAxis
                        tickFormatter={(value) => new Intl.NumberFormat('ko-KR', { notation: 'compact' }).format(value)}
                        tick={{ fontSize: 12 }}
                      />
                      <Tooltip
                        formatter={(value: number, name: string) => [`${new Intl.NumberFormat('ko-KR').format(value)}원`, name]}
                      />
                      <Legend />
                      <Line type="monotone" dataKey="매출" stroke="#3B82F6" strokeWidth={2} dot={false} />
                      {showTargetLine && (
                        <Line type="monotone" dataKey="목표" stroke="#F97316" strokeWidth={2} strokeDasharray="5 5" dot={false} />
                      )}
                    </LineChart>
                  ) : (
                    <BarChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="day" tick={{ fontSize: 12 }} />
                      <YAxis
                        tickFormatter={(value) => new Intl.NumberFormat('ko-KR', { notation: 'compact' }).format(value)}
                        tick={{ fontSize: 12 }}
                      />
                      <Tooltip
                        formatter={(value: number, name: string) => [`${new Intl.NumberFormat('ko-KR').format(value)}원`, name]}
                      />
                      <Legend />
                      <Bar dataKey="매출" fill="#3B82F6" />
                      {showTargetLine && (
                        <Bar dataKey="목표" fill="#F97316" />
                      )}
                    </BarChart>
                  )}
                </ResponsiveContainer>
              </div>
            )}
          </div>
        )}

        {/* 리스트 */}
        <div className="divide-y divide-slate-100">
          {isLoading ? (
            <div className="px-6 py-8 text-center text-slate-500">
              <div className="w-8 h-8 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
              로딩 중...
            </div>
          ) : sales.length === 0 ? (
            <div className="px-6 py-8 text-center text-slate-500">
              등록된 매출 현황 데이터가 없습니다.
            </div>
          ) : (
            sales.map((sale) => (
              <div key={sale.id} className="px-6 py-4 flex items-center justify-between hover:bg-slate-50">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 text-xs font-medium rounded">
                      {sale.kpi_type}
                    </span>
                    <span className="text-sm text-slate-500">{sale.year}년 {sale.month}월</span>
                  </div>
                  <h3 className="font-medium text-slate-800">{sale.title}</h3>
                  <p className="text-sm text-slate-500">담당: {sale.manager}</p>
                </div>
                <div className="flex items-center gap-2">
                  <DataItemActions
                    data={sale}
                    type="sales"
                    onEdit={() => handleEdit(sale)}
                    onDelete={() => handleDelete(sale.id)}
                  />
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* 모달 */}
      {isModalOpen && (
        <SalesModal
          isOpen={isModalOpen}
          onClose={() => {
            setIsModalOpen(false);
            setEditingSale(null);
          }}
          onSave={handleSave}
          initialData={editingSale}
          defaultYear={year}
          defaultMonth={month}
        />
      )}
    </section>
  );
}
