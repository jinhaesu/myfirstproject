'use client';

import { useState, useMemo } from 'react';
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
  };
  type: 'target' | 'sales';
}

const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899'];

function parseNumber(value: string | number | undefined | null): number {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return value;
  const cleaned = String(value).replace(/[^\d.-]/g, '');
  return parseFloat(cleaned) || 0;
}

export function ChartModal({ isOpen, onClose, data, type }: ChartModalProps) {
  const [chartType, setChartType] = useState<'bar' | 'line' | 'area'>('bar');
  const [selectedRows, setSelectedRows] = useState<number[]>([0]);

  // 합계 데이터 생성 (선택된 모든 항목의 합)
  const chartData = useMemo(() => {
    const labels = type === 'target'
      ? ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월']
      : Array.from({ length: data.grid_data[0]?.length - 1 || 0 }, (_, i) => `${i + 1}일`);

    return labels.map((label, i) => {
      // 선택된 모든 행의 해당 열 값을 합산
      let total = 0;
      selectedRows.forEach((rowIndex) => {
        const row = data.grid_data[rowIndex];
        if (row && row[i + 1] !== undefined) {
          total += parseNumber(row[i + 1]);
        }
      });

      return {
        name: label,
        합계: total,
      };
    });
  }, [data.grid_data, selectedRows, type]);

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

    const color = COLORS[0];

    const renderElement = () => {
      if (chartType === 'bar') {
        return <Bar dataKey="합계" fill={color} name={selectedRows.length > 1 ? '선택 항목 합계' : selectedNames} />;
      } else if (chartType === 'line') {
        return <Line type="monotone" dataKey="합계" stroke={color} strokeWidth={2} name={selectedRows.length > 1 ? '선택 항목 합계' : selectedNames} />;
      } else {
        return <Area type="monotone" dataKey="합계" stroke={color} fill={color} fillOpacity={0.3} name={selectedRows.length > 1 ? '선택 항목 합계' : selectedNames} />;
      }
    };

    const ChartComponent = chartType === 'bar' ? BarChart : chartType === 'line' ? LineChart : AreaChart;

    return (
      <ResponsiveContainer width="100%" height={400}>
        <ChartComponent {...commonProps}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="name" />
          <YAxis tickFormatter={(value) => new Intl.NumberFormat('ko-KR', { notation: 'compact' }).format(value)} />
          <Tooltip
            formatter={(value: number) => [new Intl.NumberFormat('ko-KR').format(value), selectedRows.length > 1 ? '합계' : selectedNames]}
          />
          <Legend />
          {renderElement()}
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
          {/* 차트 타입 선택 */}
          <div className="flex items-center gap-4 mb-6">
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
        </div>
      </div>
    </div>
  );
}
