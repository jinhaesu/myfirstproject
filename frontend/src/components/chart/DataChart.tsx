'use client';

import { useMemo, useState } from 'react';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

interface DataChartProps {
  columns: string[];
  rows: Record<string, unknown>[];
}

type ChartType = 'bar' | 'line' | 'pie';

const COLORS = [
  '#3B82F6', '#8B5CF6', '#EC4899', '#F59E0B', '#10B981',
  '#6366F1', '#F97316', '#14B8A6', '#EF4444', '#84CC16'
];

export function DataChart({ columns, rows }: DataChartProps) {
  const [chartType, setChartType] = useState<ChartType>('bar');
  const [selectedXAxis, setSelectedXAxis] = useState<string>(columns[0] || '');
  const [selectedYAxis, setSelectedYAxis] = useState<string>('');

  // 숫자형 컬럼 찾기
  const numericColumns = useMemo(() => {
    if (rows.length === 0) return [];
    return columns.filter(col => {
      const value = rows[0][col];
      return typeof value === 'number' || !isNaN(Number(value));
    });
  }, [columns, rows]);

  // 비숫자형 컬럼 찾기 (라벨용)
  const labelColumns = useMemo(() => {
    if (rows.length === 0) return columns;
    return columns.filter(col => {
      const value = rows[0][col];
      return typeof value === 'string' || typeof value !== 'number';
    });
  }, [columns, rows]);

  // 초기 Y축 설정
  useMemo(() => {
    if (!selectedYAxis && numericColumns.length > 0) {
      setSelectedYAxis(numericColumns[0]);
    }
  }, [numericColumns, selectedYAxis]);

  // 차트 데이터 변환
  const chartData = useMemo(() => {
    return rows.slice(0, 20).map((row, index) => {
      const item: Record<string, unknown> = { index };
      columns.forEach(col => {
        const value = row[col];
        if (typeof value === 'number') {
          item[col] = value;
        } else if (!isNaN(Number(value))) {
          item[col] = Number(value);
        } else {
          item[col] = value;
        }
      });
      return item;
    });
  }, [rows, columns]);

  // 파이 차트용 데이터
  const pieData = useMemo(() => {
    if (!selectedXAxis || !selectedYAxis) return [];
    return chartData.map((item, index) => ({
      name: String(item[selectedXAxis] || `항목 ${index + 1}`),
      value: Number(item[selectedYAxis]) || 0,
    }));
  }, [chartData, selectedXAxis, selectedYAxis]);

  if (rows.length === 0) {
    return (
      <div className="text-center text-slate-500 py-8">
        차트를 표시할 데이터가 없습니다
      </div>
    );
  }

  if (numericColumns.length === 0) {
    return (
      <div className="text-center text-slate-500 py-8">
        숫자형 데이터가 없어 차트를 표시할 수 없습니다
      </div>
    );
  }

  return (
    <div>
      {/* 차트 컨트롤 */}
      <div className="flex flex-wrap gap-4 mb-4">
        {/* 차트 타입 선택 */}
        <div className="flex gap-1 bg-slate-100 p-1 rounded-lg">
          {[
            { type: 'bar' as ChartType, label: '막대', icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' },
            { type: 'line' as ChartType, label: '선', icon: 'M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z' },
            { type: 'pie' as ChartType, label: '원', icon: 'M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z' },
          ].map(({ type, label, icon }) => (
            <button
              key={type}
              onClick={() => setChartType(type)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium flex items-center gap-1 transition-colors ${
                chartType === type
                  ? 'bg-white text-blue-600 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={icon} />
              </svg>
              {label}
            </button>
          ))}
        </div>

        {/* X축 선택 */}
        <div className="flex items-center gap-2">
          <label className="text-sm text-slate-600">X축:</label>
          <select
            value={selectedXAxis}
            onChange={(e) => setSelectedXAxis(e.target.value)}
            className="text-sm border border-slate-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {columns.map(col => (
              <option key={col} value={col}>{col}</option>
            ))}
          </select>
        </div>

        {/* Y축 선택 */}
        <div className="flex items-center gap-2">
          <label className="text-sm text-slate-600">Y축:</label>
          <select
            value={selectedYAxis}
            onChange={(e) => setSelectedYAxis(e.target.value)}
            className="text-sm border border-slate-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {numericColumns.map(col => (
              <option key={col} value={col}>{col}</option>
            ))}
          </select>
        </div>
      </div>

      {/* 차트 */}
      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          {chartType === 'bar' ? (
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
              <XAxis
                dataKey={selectedXAxis}
                tick={{ fontSize: 12, fill: '#64748B' }}
                tickFormatter={(value) => String(value).slice(0, 10)}
              />
              <YAxis tick={{ fontSize: 12, fill: '#64748B' }} />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'white',
                  border: '1px solid #E2E8F0',
                  borderRadius: '8px',
                  boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                }}
              />
              <Legend />
              <Bar dataKey={selectedYAxis} fill="#3B82F6" radius={[4, 4, 0, 0]} />
            </BarChart>
          ) : chartType === 'line' ? (
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
              <XAxis
                dataKey={selectedXAxis}
                tick={{ fontSize: 12, fill: '#64748B' }}
                tickFormatter={(value) => String(value).slice(0, 10)}
              />
              <YAxis tick={{ fontSize: 12, fill: '#64748B' }} />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'white',
                  border: '1px solid #E2E8F0',
                  borderRadius: '8px',
                  boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                }}
              />
              <Legend />
              <Line
                type="monotone"
                dataKey={selectedYAxis}
                stroke="#3B82F6"
                strokeWidth={2}
                dot={{ fill: '#3B82F6', strokeWidth: 2 }}
                activeDot={{ r: 6 }}
              />
            </LineChart>
          ) : (
            <PieChart>
              <Pie
                data={pieData}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                outerRadius={120}
                fill="#8884d8"
                dataKey="value"
              >
                {pieData.map((_, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  backgroundColor: 'white',
                  border: '1px solid #E2E8F0',
                  borderRadius: '8px',
                  boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                }}
              />
              <Legend />
            </PieChart>
          )}
        </ResponsiveContainer>
      </div>

      {rows.length > 20 && (
        <p className="text-xs text-slate-400 mt-2 text-center">
          * 차트는 처음 20개 행만 표시됩니다
        </p>
      )}
    </div>
  );
}
