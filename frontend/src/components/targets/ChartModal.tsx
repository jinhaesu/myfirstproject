'use client';

import { useState, useMemo, useEffect } from 'react';
import {
  LineChart, Line, BarChart, Bar, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';

interface ChartModalProps {
  isOpen: boolean;
  onClose: () => void;
  data: {
    title: string;
    kpi_type: string;
    grid_data: string[][];
    year?: number;
    month?: number;
    manager?: string;
  };
  type: 'target' | 'sales';
}

interface TargetEntryData {
  grid_data: string[][];
  title: string;
  year: number;
  manager: string;
  kpi_type: string;
}

interface PreviousPeriodData {
  grid_data: string[][];
  title: string;
  year: number;
  month?: number;
}

const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899'];

function parseNumber(value: string | number | undefined | null): number {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return value;
  const cleaned = String(value).replace(/[^\d.-]/g, '');
  return parseFloat(cleaned) || 0;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';

function getAuthHeaders(): HeadersInit {
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

export function ChartModal({ isOpen, onClose, data, type }: ChartModalProps) {
  const [chartType, setChartType] = useState<'bar' | 'line' | 'area'>('bar');
  const [selectedRows, setSelectedRows] = useState<number[]>([0]);
  const [showComparison, setShowComparison] = useState(false);
  const [showCumulative, setShowCumulative] = useState(false);
  const [showTargetComparison, setShowTargetComparison] = useState(false);
  const [previousData, setPreviousData] = useState<PreviousPeriodData | null>(null);
  const [targetData, setTargetData] = useState<TargetEntryData | null>(null);
  const [loadingPrevious, setLoadingPrevious] = useState(false);
  const [loadingTarget, setLoadingTarget] = useState(false);

  // 전년도/전월 데이터 가져오기
  useEffect(() => {
    if (!showComparison || !data.year) {
      setPreviousData(null);
      return;
    }

    const fetchPreviousData = async () => {
      setLoadingPrevious(true);
      try {
        let url: string;
        let prevYear = data.year!;
        let prevMonth = data.month;

        if (type === 'target') {
          // 목표 리스트: 전년도 데이터
          prevYear = data.year! - 1;
          url = `${API_BASE}/api/targets?year=${prevYear}`;
        } else {
          // 매출 현황: 전월 데이터
          if (data.month === 1) {
            prevYear = data.year! - 1;
            prevMonth = 12;
          } else {
            prevMonth = data.month! - 1;
          }
          url = `${API_BASE}/api/targets/sales/list?year=${prevYear}&month=${prevMonth}`;
        }

        const res = await fetch(url, {
          headers: getAuthHeaders(),
        });

        if (res.ok) {
          const items = await res.json();
          console.log('[ChartModal] Fetched items:', items);
          console.log('[ChartModal] Looking for title:', data.title, 'kpi_type:', data.kpi_type);

          // 같은 title과 kpi_type인 항목 찾기 (먼저 title로 매칭, 없으면 kpi_type으로)
          let matchingItem = items.find((item: { title: string; kpi_type: string }) =>
            item.title === data.title && item.kpi_type === data.kpi_type
          );
          console.log('[ChartModal] Match by title+kpi_type:', matchingItem ? matchingItem.title : 'NOT FOUND');

          // title이 정확히 일치하지 않으면 kpi_type만으로 매칭
          if (!matchingItem) {
            matchingItem = items.find((item: { kpi_type: string }) => item.kpi_type === data.kpi_type);
            console.log('[ChartModal] Fallback match by kpi_type:', matchingItem ? matchingItem.title : 'NOT FOUND');
          }
          if (matchingItem) {
            setPreviousData({
              grid_data: matchingItem.grid_data,
              title: matchingItem.title,
              year: prevYear,
              month: prevMonth,
            });
          } else {
            setPreviousData(null);
          }
        } else {
          console.log('[ChartModal] Failed to fetch, status:', res.status);
          setPreviousData(null);
        }
      } catch (error) {
        console.error('Failed to fetch previous data:', error);
        setPreviousData(null);
      } finally {
        setLoadingPrevious(false);
      }
    };

    fetchPreviousData();
  }, [showComparison, data.year, data.month, data.kpi_type, type]);

  // 목표 데이터 가져오기 (매출 현황에서만 사용 - 해당 책임자의 실제 목표 입력값)
  useEffect(() => {
    if (!showTargetComparison || type !== 'sales' || !data.year || !data.manager) {
      setTargetData(null);
      return;
    }

    const fetchTargetData = async () => {
      setLoadingTarget(true);
      try {
        // 해당 년도의 목표 데이터 조회
        const url = `${API_BASE}/api/targets?year=${data.year}`;
        const res = await fetch(url, {
          headers: getAuthHeaders(),
        });

        if (res.ok) {
          const targets = await res.json();
          // 같은 manager + 같은 kpi_type인 목표 데이터 찾기
          const matchingTarget = targets.find(
            (t: TargetEntryData) => t.manager === data.manager && t.kpi_type === data.kpi_type
          );

          if (matchingTarget) {
            setTargetData(matchingTarget);
          } else {
            setTargetData(null);
          }
        } else {
          setTargetData(null);
        }
      } catch (error) {
        console.error('Failed to fetch target data:', error);
        setTargetData(null);
      } finally {
        setLoadingTarget(false);
      }
    };

    fetchTargetData();
  }, [showTargetComparison, data.year, data.manager, data.kpi_type, type]);

  // 비교 라벨 생성
  const comparisonLabel = useMemo(() => {
    if (type === 'target') {
      return `${data.year! - 1}년`;
    } else {
      if (data.month === 1) {
        return `${data.year! - 1}년 12월`;
      }
      return `${data.year}년 ${data.month! - 1}월`;
    }
  }, [type, data.year, data.month]);

  const currentLabel = useMemo(() => {
    if (type === 'target') {
      return `${data.year}년`;
    } else {
      return `${data.year}년 ${data.month}월`;
    }
  }, [type, data.year, data.month]);

  // 차트 데이터 생성 (현재 데이터 + 비교 데이터 + 목표 데이터)
  const chartData = useMemo(() => {
    const labels = type === 'target'
      ? ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월']
      : Array.from({ length: data.grid_data[0]?.length - 1 || 0 }, (_, i) => `${i + 1}일`);

    let cumulativeCurrent = 0;
    let cumulativePrevious = 0;
    let cumulativeTarget = 0;

    // 목표 데이터에서 월 목표를 일 목표로 변환
    const getDailyTargetValue = (): number => {
      if (!targetData || !data.month) return 0;

      // 해당 월의 일수 계산
      const year = data.year || new Date().getFullYear();
      const daysInMonth = new Date(year, data.month, 0).getDate();

      // 선택된 행과 매칭되는 목표 행들의 월 목표 합산
      let monthlyTargetTotal = 0;
      selectedRows.forEach((rowIndex) => {
        const currentRowName = data.grid_data[rowIndex]?.[0];
        // 목표 grid_data에서 같은 기준(행 이름)의 행 찾기
        const targetRow = targetData.grid_data.find(row => row[0] === currentRowName);
        if (targetRow) {
          // 해당 월의 목표값 (월 인덱스: 1월=1, 2월=2, ...)
          const monthlyValue = parseNumber(targetRow[data.month!]);
          monthlyTargetTotal += monthlyValue;
        }
      });

      // 월 목표를 일수로 나눠서 일일 목표 계산
      return monthlyTargetTotal / daysInMonth;
    };

    const dailyTarget = getDailyTargetValue();

    return labels.map((label, i) => {
      // 선택된 모든 행의 해당 열 값을 합산 (현재 데이터)
      let currentTotal = 0;
      selectedRows.forEach((rowIndex) => {
        const row = data.grid_data[rowIndex];
        if (row && row[i + 1] !== undefined) {
          currentTotal += parseNumber(row[i + 1]);
        }
      });

      // 누계 모드일 경우 누적 합산
      if (showCumulative) {
        cumulativeCurrent += currentTotal;
        currentTotal = cumulativeCurrent;
      }

      const displayLabel = showCumulative ? `${currentLabel} 누계` : currentLabel;
      const result: { name: string; [key: string]: string | number } = {
        name: label,
        [displayLabel]: currentTotal,
      };

      // 비교 데이터가 있으면 추가
      if (showComparison && previousData) {
        let prevTotal = 0;
        // 이전 데이터에서 동일한 행 이름을 찾아서 합산
        selectedRows.forEach((rowIndex) => {
          const currentRowName = data.grid_data[rowIndex]?.[0];
          // 이전 데이터에서 같은 이름의 행 찾기
          const prevRow = previousData.grid_data.find(row => row[0] === currentRowName);
          if (prevRow && prevRow[i + 1] !== undefined) {
            prevTotal += parseNumber(prevRow[i + 1]);
          }
        });

        // 누계 모드일 경우 누적 합산
        if (showCumulative) {
          cumulativePrevious += prevTotal;
          prevTotal = cumulativePrevious;
        }

        const compDisplayLabel = showCumulative ? `${comparisonLabel} 누계` : comparisonLabel;
        result[compDisplayLabel] = prevTotal;
      }

      // 목표 데이터 추가 (매출 현황에서만 - 해당 책임자의 실제 목표 입력값 기반)
      if (showTargetComparison && targetData && type === 'sales') {
        let targetValue = dailyTarget;

        // 누계 모드일 경우 누적 합산
        if (showCumulative) {
          cumulativeTarget += dailyTarget;
          targetValue = cumulativeTarget;
        }

        const targetLabel = showCumulative ? '목표 누계' : '목표';
        result[targetLabel] = Math.round(targetValue);
      }

      return result;
    });
  }, [data.grid_data, data.month, data.year, selectedRows, type, showComparison, showCumulative, showTargetComparison, previousData, targetData, currentLabel, comparisonLabel]);

  const rowNames = useMemo(() => {
    return data.grid_data.map((row, i) => ({
      index: i,
      name: row[0] || `항목 ${i + 1}`,
    }));
  }, [data.grid_data]);

  const toggleRow = (index: number) => {
    setSelectedRows((prev) =>
      prev.includes(index)
        ? prev.filter((i) => i !== index)
        : [...prev, index]
    );
  };

  const selectAll = () => {
    setSelectedRows(rowNames.map((_, i) => i));
  };

  const clearAll = () => {
    setSelectedRows([]);
  };

  // 선택된 항목명 표시
  const selectedNames = useMemo(() => {
    return selectedRows.map(i => data.grid_data[i]?.[0] || `항목 ${i + 1}`).join(', ');
  }, [selectedRows, data.grid_data]);

  if (!isOpen) return null;

  const renderChart = () => {
    const commonProps = {
      data: chartData,
      margin: { top: 5, right: 30, left: 20, bottom: 5 },
    };

    const renderElements = () => {
      const elements = [];
      const displayLabel = showCumulative ? `${currentLabel} 누계` : currentLabel;
      const compDisplayLabel = showCumulative ? `${comparisonLabel} 누계` : comparisonLabel;
      const targetLabel = showCumulative ? '목표 누계' : '목표';

      if (chartType === 'bar') {
        elements.push(
          <Bar key="current" dataKey={displayLabel} fill={COLORS[0]} name={displayLabel} />
        );
        if (showComparison && previousData) {
          elements.push(
            <Bar key="previous" dataKey={compDisplayLabel} fill={COLORS[1]} name={compDisplayLabel} />
          );
        }
        if (showTargetComparison && targetData && type === 'sales') {
          elements.push(
            <Bar key="target" dataKey={targetLabel} fill="#F97316" name={targetLabel} />
          );
        }
      } else if (chartType === 'line') {
        elements.push(
          <Line key="current" type="monotone" dataKey={displayLabel} stroke={COLORS[0]} strokeWidth={2} name={displayLabel} />
        );
        if (showComparison && previousData) {
          elements.push(
            <Line key="previous" type="monotone" dataKey={compDisplayLabel} stroke={COLORS[1]} strokeWidth={2} strokeDasharray="5 5" name={compDisplayLabel} />
          );
        }
        if (showTargetComparison && targetData && type === 'sales') {
          elements.push(
            <Line key="target" type="monotone" dataKey={targetLabel} stroke="#F97316" strokeWidth={2} strokeDasharray="3 3" name={targetLabel} />
          );
        }
      } else {
        elements.push(
          <Area key="current" type="monotone" dataKey={displayLabel} stroke={COLORS[0]} fill={COLORS[0]} fillOpacity={0.3} name={displayLabel} />
        );
        if (showComparison && previousData) {
          elements.push(
            <Area key="previous" type="monotone" dataKey={compDisplayLabel} stroke={COLORS[1]} fill={COLORS[1]} fillOpacity={0.2} name={compDisplayLabel} />
          );
        }
        if (showTargetComparison && targetData && type === 'sales') {
          elements.push(
            <Area key="target" type="monotone" dataKey={targetLabel} stroke="#F97316" fill="#F97316" fillOpacity={0.15} name={targetLabel} />
          );
        }
      }

      return elements;
    };

    const ChartComponent = chartType === 'bar' ? BarChart : chartType === 'line' ? LineChart : AreaChart;

    return (
      <ResponsiveContainer width="100%" height={400}>
        <ChartComponent {...commonProps}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="name" />
          <YAxis tickFormatter={(value) => new Intl.NumberFormat('ko-KR', { notation: 'compact' }).format(value)} />
          <Tooltip
            formatter={(value: number, name: string) => [new Intl.NumberFormat('ko-KR').format(value), name]}
          />
          <Legend />
          {renderElements()}
        </ChartComponent>
      </ResponsiveContainer>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* 헤더 */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-800">
            {data.title} - 그래프
          </h2>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 본문 */}
        <div className="flex-1 overflow-auto p-6">
          {/* 차트 타입 선택 & 비교 옵션 */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-4">
              <span className="text-sm font-medium text-slate-600">차트 유형:</span>
              <div className="flex gap-2">
                {[
                  { value: 'bar', label: '막대' },
                  { value: 'line', label: '선' },
                  { value: 'area', label: '영역' },
                ].map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setChartType(option.value as 'bar' | 'line' | 'area')}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      chartType === option.value
                        ? 'bg-blue-500 text-white'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 옵션 체크박스들 */}
            <div className="flex items-center gap-4">
              {/* 누계 체크박스 */}
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showCumulative}
                  onChange={(e) => setShowCumulative(e.target.checked)}
                  className="w-4 h-4 text-orange-600 rounded border-slate-300 focus:ring-orange-500"
                />
                <span className="text-sm font-medium text-slate-600">누계</span>
              </label>

              {/* 그래프 비교하기 체크박스 */}
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showComparison}
                  onChange={(e) => setShowComparison(e.target.checked)}
                  className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                />
                <span className="text-sm font-medium text-slate-600">
                  {type === 'target' ? '전년도 비교' : '전월 비교'}
                </span>
                {loadingPrevious && (
                  <svg className="w-4 h-4 animate-spin text-blue-500" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                )}
              </label>

              {/* 목표 값 보기 체크박스 (매출 현황에서만) */}
              {type === 'sales' && (
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showTargetComparison}
                    onChange={(e) => setShowTargetComparison(e.target.checked)}
                    className="w-4 h-4 text-orange-600 rounded border-slate-300 focus:ring-orange-500"
                  />
                  <span className="text-sm font-medium text-slate-600">목표 값 보기</span>
                  {loadingTarget && (
                    <svg className="w-4 h-4 animate-spin text-orange-500" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  )}
                </label>
              )}
            </div>
          </div>

          {/* 비교 데이터 상태 표시 */}
          {showComparison && !loadingPrevious && (
            <div className={`mb-4 px-4 py-2 rounded-lg text-sm ${
              previousData
                ? 'bg-green-50 text-green-700'
                : 'bg-amber-50 text-amber-700'
            }`}>
              {previousData ? (
                <>
                  <span className="font-medium">{comparisonLabel}</span> 데이터와 비교 중
                  <span className="text-xs ml-2">({previousData.title})</span>
                </>
              ) : (
                <>
                  <span className="font-medium">{comparisonLabel}</span>에 동일한 KPI 유형({data.kpi_type})의 데이터가 없습니다
                </>
              )}
            </div>
          )}

          {/* 목표 데이터 상태 표시 */}
          {showTargetComparison && type === 'sales' && !loadingTarget && (
            <div className={`mb-4 px-4 py-2 rounded-lg text-sm ${
              targetData
                ? 'bg-orange-50 text-orange-700'
                : 'bg-amber-50 text-amber-700'
            }`}>
              {targetData ? (
                <>
                  <span className="font-medium">{data.manager}</span>님의 {data.year}년 목표 데이터와 비교 중
                  <span className="text-xs ml-2">({targetData.title})</span>
                </>
              ) : (
                <>
                  <span className="font-medium">{data.manager}</span>님의 {data.year}년 <span className="font-medium">{data.kpi_type}</span> 목표 데이터가 없습니다
                </>
              )}
            </div>
          )}

          {/* 항목 선택 */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-slate-600">
                표시할 항목 선택 (여러 개 선택 시 합계로 표시):
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={selectAll}
                  className="text-xs text-blue-600 hover:text-blue-700"
                >
                  전체 선택
                </button>
                <span className="text-slate-300">|</span>
                <button
                  type="button"
                  onClick={clearAll}
                  className="text-xs text-slate-500 hover:text-slate-700"
                >
                  선택 해제
                </button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {rowNames.map((row) => (
                <button
                  key={row.index}
                  type="button"
                  onClick={() => toggleRow(row.index)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    selectedRows.includes(row.index)
                      ? 'bg-blue-500 text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {row.name}
                </button>
              ))}
            </div>
            {selectedRows.length > 1 && (
              <p className="mt-2 text-xs text-slate-500">
                선택된 항목: {selectedNames}
              </p>
            )}
          </div>

          {/* 차트 */}
          <div className="bg-slate-50 rounded-xl p-4">
            {selectedRows.length > 0 ? (
              renderChart()
            ) : (
              <div className="h-[400px] flex items-center justify-center text-slate-500">
                표시할 항목을 선택해주세요
              </div>
            )}
          </div>

          {/* 범례 설명 */}
          {(showComparison && previousData) || showCumulative || (showTargetComparison && targetData) ? (
            <div className="mt-4 flex flex-wrap items-center gap-6 text-sm text-slate-600">
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded" style={{ backgroundColor: COLORS[0] }} />
                <span>{showCumulative ? `${currentLabel} 누계` : currentLabel} (현재)</span>
              </div>
              {showComparison && previousData && (
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 rounded" style={{ backgroundColor: COLORS[1] }} />
                  <span>{showCumulative ? `${comparisonLabel} 누계` : comparisonLabel} (비교)</span>
                </div>
              )}
              {showTargetComparison && targetData && type === 'sales' && (
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 rounded" style={{ backgroundColor: '#F97316' }} />
                  <span>{showCumulative ? '목표 누계' : '목표'}</span>
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
