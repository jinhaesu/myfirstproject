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

export function ChartModal({ isOpen, onClose, data, type }: ChartModalProps) {
  const [chartType, setChartType] = useState<'bar' | 'line' | 'area'>('bar');
  const [selectedRows, setSelectedRows] = useState<number[]>([0]);

  const chartData = useMemo(() => {
    const labels = type === 'target'
      ? ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월']
      : Array.from({ length: data.grid_data[0]?.length - 1 || 0 }, (_, i) => `${i + 1}일`);

    return labels.map((label, i) => {
      const point: Record<string, string | number> = { name: label };
      selectedRows.forEach((rowIndex) => {
        const row = data.grid_data[rowIndex];
        if (row) {
          const rowName = row[0] || `항목 ${rowIndex + 1}`;
          const value = parseFloat(row[i + 1] || '0') || 0;
          point[rowName] = value;
        }
      });
      return point;
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

  if (!isOpen) return null;

  const renderChart = () => {
    const commonProps = {
      data: chartData,
      margin: { top: 5, right: 30, left: 20, bottom: 5 },
    };

    const lines = selectedRows.map((rowIndex, i) => {
      const rowName = data.grid_data[rowIndex]?.[0] || `항목 ${rowIndex + 1}`;
      const color = COLORS[i % COLORS.length];

      if (chartType === 'bar') {
        return <Bar key={rowName} dataKey={rowName} fill={color} />;
      } else if (chartType === 'line') {
        return <Line key={rowName} type="monotone" dataKey={rowName} stroke={color} strokeWidth={2} />;
      } else {
        return <Area key={rowName} type="monotone" dataKey={rowName} stroke={color} fill={color} fillOpacity={0.3} />;
      }
    });

    const ChartComponent = chartType === 'bar' ? BarChart : chartType === 'line' ? LineChart : AreaChart;

    return (
      <ResponsiveContainer width="100%" height={400}>
        <ChartComponent {...commonProps}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="name" />
          <YAxis />
          <Tooltip />
          <Legend />
          {lines}
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
            <span className="text-sm font-medium text-slate-600 mb-2 block">표시할 항목:</span>
            <div className="flex flex-wrap gap-2">
              {rowNames.map((row) => (
                <button
                  key={row.index}
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
