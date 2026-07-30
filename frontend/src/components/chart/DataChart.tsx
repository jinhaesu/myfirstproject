'use client';

import { useMemo, useState, useCallback } from 'react';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
  ComposedChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
  Brush,
} from 'recharts';

interface DataChartProps {
  columns: string[];
  rows: Record<string, unknown>[];
}

type ChartType = 'bar' | 'line' | 'area' | 'pie' | 'composed';

// Linear-inspired colorblind-safe palette
const COLORS = [
  '#5E6AD2', '#4EA7FC', '#00B8CC', '#27A644', '#F0BF00',
  '#FC7840', '#EB5757', '#7070FF', '#828FFF', '#68CC58',
];

const GRADIENT_PAIRS = [
  { start: '#5E6AD2', end: '#828FFF' },
  { start: '#4EA7FC', end: '#00B8CC' },
  { start: '#27A644', end: '#68CC58' },
  { start: '#F0BF00', end: '#FC7840' },
];

// Custom dark tooltip
const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-bg-secondary border border-border-secondary rounded-xl px-4 py-3 shadow-[0px_7px_32px_rgba(0,0,0,0.5)]">
      <p className="text-text-tertiary text-xs mb-2 font-medium">{label}</p>
      {payload.map((entry: any, i: number) => (
        <div key={i} className="flex items-center gap-2 py-0.5">
          <div
            className="w-2.5 h-2.5 rounded-full"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-text-secondary text-sm">{entry.name}:</span>
          <span className="text-text-primary text-sm font-semibold">
            {typeof entry.value === 'number'
              ? entry.value.toLocaleString('ko-KR', { maximumFractionDigits: 2 })
              : entry.value}
          </span>
        </div>
      ))}
    </div>
  );
};

// Custom legend
const CustomLegend = ({ payload }: any) => {
  if (!payload?.length) return null;
  return (
    <div className="flex flex-wrap justify-center gap-4 mt-3">
      {payload.map((entry: any, i: number) => (
        <div key={i} className="flex items-center gap-1.5">
          <div
            className="w-2.5 h-2.5 rounded-full"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-text-tertiary text-xs font-medium">{entry.value}</span>
        </div>
      ))}
    </div>
  );
};

// Summary stats card
function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="bg-bg-2 border border-border-primary rounded-xl px-4 py-3 flex-1 min-w-[120px]">
      <p className="text-text-quaternary text-[11px] font-medium uppercase tracking-wider">{label}</p>
      <p className="text-text-primary text-lg font-semibold mt-0.5" style={{ color }}>{value}</p>
    </div>
  );
}

export function DataChart({ columns, rows }: DataChartProps) {
  const [chartType, setChartType] = useState<ChartType>('bar');
  const [selectedXAxis, setSelectedXAxis] = useState<string>(columns[0] || '');
  const [selectedYAxes, setSelectedYAxes] = useState<string[]>([]);
  const [showStats, setShowStats] = useState(true);

  const numericColumns = useMemo(() => {
    if (rows.length === 0) return [];
    return columns.filter(col => {
      const value = rows[0][col];
      return typeof value === 'number' || !isNaN(Number(value));
    });
  }, [columns, rows]);

  // Initialize Y axes
  useMemo(() => {
    if (selectedYAxes.length === 0 && numericColumns.length > 0) {
      setSelectedYAxes([numericColumns[0]]);
    }
  }, [numericColumns, selectedYAxes.length]);

  const toggleYAxis = useCallback((col: string) => {
    setSelectedYAxes(prev => {
      if (prev.includes(col)) {
        return prev.length > 1 ? prev.filter(c => c !== col) : prev;
      }
      return [...prev, col].slice(0, 4); // max 4 Y axes
    });
  }, []);

  // Chart data with number conversion
  const chartData = useMemo(() => {
    const maxRows = chartType === 'pie' ? 12 : 50;
    return rows.slice(0, maxRows).map((row, index) => {
      const item: Record<string, unknown> = { index };
      columns.forEach(col => {
        const value = row[col];
        if (typeof value === 'number') item[col] = value;
        else if (!isNaN(Number(value)) && value !== '') item[col] = Number(value);
        else item[col] = value;
      });
      return item;
    });
  }, [rows, columns, chartType]);

  // Stats
  const stats = useMemo(() => {
    if (selectedYAxes.length === 0) return null;
    const col = selectedYAxes[0];
    const values = chartData.map(r => Number(r[col]) || 0);
    if (values.length === 0) return null;
    const sum = values.reduce((a, b) => a + b, 0);
    const avg = sum / values.length;
    const max = Math.max(...values);
    const min = Math.min(...values);
    return { sum, avg, max, min };
  }, [chartData, selectedYAxes]);

  // Pie data
  const pieData = useMemo(() => {
    if (!selectedXAxis || selectedYAxes.length === 0) return [];
    return chartData.map((item, index) => ({
      name: String(item[selectedXAxis] || `항목 ${index + 1}`),
      value: Number(item[selectedYAxes[0]]) || 0,
    }));
  }, [chartData, selectedXAxis, selectedYAxes]);

  // Average for reference line
  const avgValue = stats?.avg || 0;

  if (rows.length === 0 || numericColumns.length === 0) {
    return (
      <div className="text-center text-text-tertiary py-12 bg-bg-1 rounded-2xl border border-border-primary">
        <svg className="w-12 h-12 mx-auto mb-3 text-border-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
        <p className="text-sm">
          {rows.length === 0 ? '차트를 표시할 데이터가 없습니다' : '숫자형 데이터가 없어 차트를 표시할 수 없습니다'}
        </p>
      </div>
    );
  }

  const chartTypes: { type: ChartType; label: string; icon: string }[] = [
    { type: 'bar', label: '막대', icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' },
    { type: 'line', label: '선', icon: 'M7 12l3-3 3 3 4-4' },
    { type: 'area', label: '영역', icon: 'M13 7h8m0 0v8m0-8l-8 8-4-4-6 6' },
    { type: 'composed', label: '복합', icon: 'M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z' },
    { type: 'pie', label: '원', icon: 'M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z' },
  ];

  const commonAxisProps = {
    tick: { fontSize: 11, fill: 'var(--color-text-tertiary)' },
    axisLine: { stroke: 'var(--color-border-primary)' },
    tickLine: { stroke: 'var(--color-border-primary)' },
  };

  const gridProps = {
    strokeDasharray: '3 3',
    stroke: 'var(--color-bg-secondary)',
    vertical: false,
  };

  return (
    <div className="space-y-4">
      {/* Stats Summary */}
      {showStats && stats && (
        <div className="flex gap-3 flex-wrap">
          <StatCard label="합계" value={stats.sum.toLocaleString('ko-KR', { maximumFractionDigits: 0 })} color="var(--color-brand-bg)" />
          <StatCard label="평균" value={stats.avg.toLocaleString('ko-KR', { maximumFractionDigits: 1 })} color="var(--color-info)" />
          <StatCard label="최대" value={stats.max.toLocaleString('ko-KR', { maximumFractionDigits: 1 })} color="var(--color-success)" />
          <StatCard label="최소" value={stats.min.toLocaleString('ko-KR', { maximumFractionDigits: 1 })} color="var(--color-orange)" />
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Chart type */}
        <div className="flex gap-0.5 bg-bg-2 border border-border-primary p-1 rounded-xl">
          {chartTypes.map(({ type, label, icon }) => (
            <button
              key={type}
              onClick={() => setChartType(type)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all ${
                chartType === type
                  ? 'bg-brand text-white shadow-[0px_1px_3px_rgba(0,0,0,0.3)]'
                  : 'text-text-tertiary hover:text-text-primary hover:bg-white/5'
              }`}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={icon} />
              </svg>
              {label}
            </button>
          ))}
        </div>

        {/* X axis */}
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-text-quaternary font-medium uppercase">X</span>
          <select
            value={selectedXAxis}
            onChange={(e) => setSelectedXAxis(e.target.value)}
            className="text-xs bg-bg-2 border border-border-primary text-text-secondary rounded-lg px-2 py-1.5 focus:outline-none focus:border-brand"
          >
            {columns.map(col => <option key={col} value={col}>{col}</option>)}
          </select>
        </div>

        {/* Y axes (multi-select) */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] text-text-quaternary font-medium uppercase">Y</span>
          {numericColumns.map((col, i) => (
            <button
              key={col}
              onClick={() => toggleYAxis(col)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-all ${
                selectedYAxes.includes(col)
                  ? 'border-transparent text-white font-medium'
                  : 'border-border-primary text-text-quaternary hover:text-text-tertiary hover:border-border-secondary'
              }`}
              style={selectedYAxes.includes(col) ? { backgroundColor: COLORS[selectedYAxes.indexOf(col) % COLORS.length] } : {}}
            >
              {col}
            </button>
          ))}
        </div>

        {/* Toggle stats */}
        <button
          onClick={() => setShowStats(!showStats)}
          className={`text-xs px-2 py-1 rounded-lg transition-colors ${
            showStats ? 'text-link bg-brand/10' : 'text-text-quaternary hover:text-text-tertiary'
          }`}
        >
          통계
        </button>
      </div>

      {/* Chart */}
      <div className="bg-bg-1 border border-border-primary rounded-2xl p-4">
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            {chartType === 'bar' ? (
              <BarChart data={chartData} barCategoryGap="20%">
                <defs>
                  {selectedYAxes.map((_, i) => (
                    <linearGradient key={i} id={`barGrad${i}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={GRADIENT_PAIRS[i % GRADIENT_PAIRS.length].start} stopOpacity={1} />
                      <stop offset="100%" stopColor={GRADIENT_PAIRS[i % GRADIENT_PAIRS.length].start} stopOpacity={0.6} />
                    </linearGradient>
                  ))}
                </defs>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey={selectedXAxis} {...commonAxisProps} tickFormatter={(v) => String(v).slice(0, 12)} />
                <YAxis {...commonAxisProps} tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : v} />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                <Legend content={<CustomLegend />} />
                {selectedYAxes.length === 1 && <ReferenceLine y={avgValue} stroke="var(--color-brand-bg)" strokeDasharray="4 4" strokeOpacity={0.5} label={{ value: `평균 ${avgValue.toFixed(0)}`, position: 'right', fill: 'var(--color-brand-bg)', fontSize: 10 }} />}
                {selectedYAxes.map((col, i) => (
                  <Bar key={col} dataKey={col} fill={`url(#barGrad${i})`} radius={[6, 6, 0, 0]} animationDuration={800} />
                ))}
                {chartData.length > 20 && <Brush dataKey={selectedXAxis} height={20} stroke="var(--color-border-primary)" fill="var(--color-bg-level-1)" travellerWidth={8} />}
              </BarChart>
            ) : chartType === 'line' ? (
              <LineChart data={chartData}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey={selectedXAxis} {...commonAxisProps} tickFormatter={(v) => String(v).slice(0, 12)} />
                <YAxis {...commonAxisProps} tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : v} />
                <Tooltip content={<CustomTooltip />} />
                <Legend content={<CustomLegend />} />
                {selectedYAxes.length === 1 && <ReferenceLine y={avgValue} stroke="var(--color-brand-bg)" strokeDasharray="4 4" strokeOpacity={0.5} />}
                {selectedYAxes.map((col, i) => (
                  <Line key={col} type="monotone" dataKey={col} stroke={COLORS[i % COLORS.length]} strokeWidth={2.5}
                    dot={{ fill: 'var(--color-bg-level-1)', stroke: COLORS[i % COLORS.length], strokeWidth: 2, r: 3 }}
                    activeDot={{ r: 6, fill: COLORS[i % COLORS.length], stroke: 'var(--color-bg-level-1)', strokeWidth: 2 }}
                    animationDuration={1000} />
                ))}
                {chartData.length > 20 && <Brush dataKey={selectedXAxis} height={20} stroke="var(--color-border-primary)" fill="var(--color-bg-level-1)" />}
              </LineChart>
            ) : chartType === 'area' ? (
              <AreaChart data={chartData}>
                <defs>
                  {selectedYAxes.map((_, i) => (
                    <linearGradient key={i} id={`areaGrad${i}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={COLORS[i % COLORS.length]} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={COLORS[i % COLORS.length]} stopOpacity={0} />
                    </linearGradient>
                  ))}
                </defs>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey={selectedXAxis} {...commonAxisProps} tickFormatter={(v) => String(v).slice(0, 12)} />
                <YAxis {...commonAxisProps} tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : v} />
                <Tooltip content={<CustomTooltip />} />
                <Legend content={<CustomLegend />} />
                {selectedYAxes.map((col, i) => (
                  <Area key={col} type="monotone" dataKey={col} stroke={COLORS[i % COLORS.length]} strokeWidth={2}
                    fill={`url(#areaGrad${i})`} animationDuration={1000} />
                ))}
                {chartData.length > 20 && <Brush dataKey={selectedXAxis} height={20} stroke="var(--color-border-primary)" fill="var(--color-bg-level-1)" />}
              </AreaChart>
            ) : chartType === 'composed' ? (
              <ComposedChart data={chartData}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey={selectedXAxis} {...commonAxisProps} tickFormatter={(v) => String(v).slice(0, 12)} />
                <YAxis {...commonAxisProps} tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : v} />
                <Tooltip content={<CustomTooltip />} />
                <Legend content={<CustomLegend />} />
                {selectedYAxes.map((col, i) => {
                  if (i === 0) return <Bar key={col} dataKey={col} fill={COLORS[i]} radius={[4, 4, 0, 0]} opacity={0.8} animationDuration={800} />;
                  if (i === 1) return <Line key={col} type="monotone" dataKey={col} stroke={COLORS[i]} strokeWidth={2.5} dot={{ fill: 'var(--color-bg-level-1)', stroke: COLORS[i], strokeWidth: 2, r: 3 }} />;
                  return <Scatter key={col} dataKey={col} fill={COLORS[i]} />;
                })}
              </ComposedChart>
            ) : (
              <PieChart>
                <defs>
                  {pieData.map((_, i) => (
                    <linearGradient key={i} id={`pieGrad${i}`} x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0%" stopColor={COLORS[i % COLORS.length]} stopOpacity={1} />
                      <stop offset="100%" stopColor={COLORS[i % COLORS.length]} stopOpacity={0.7} />
                    </linearGradient>
                  ))}
                </defs>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={110}
                  paddingAngle={2}
                  dataKey="value"
                  label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                  animationBegin={0}
                  animationDuration={800}
                >
                  {pieData.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={`url(#pieGrad${index})`} stroke="var(--color-bg-level-1)" strokeWidth={2} />
                  ))}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
                <Legend content={<CustomLegend />} />
              </PieChart>
            )}
          </ResponsiveContainer>
        </div>
      </div>

      {rows.length > (chartType === 'pie' ? 12 : 50) && (
        <p className="text-[11px] text-text-quaternary text-center">
          * 차트는 처음 {chartType === 'pie' ? 12 : 50}개 행을 표시합니다. 스크롤 브러시로 탐색하세요.
        </p>
      )}
    </div>
  );
}
