'use client';
import { NdDonutList, NdKey, ndAlpha, ndArea, ndAxis, ndBar, ndColor, ndFmt, ndGrid, ndLine, ndMargin, ndPie, ndPieRows, ndRefLabel, ndRefLine, ndScale, ndSlotAt, ndTooltip, type NdMark, type NdSlot } from '@/components/nd/NdChart';

import { useMemo, useState, useCallback } from 'react';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  AreaChart,
  Area,
  ComposedChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Brush,
} from 'recharts';

interface DataChartProps {
  columns: string[];
  rows: Record<string, unknown>[];
}

type ChartType = 'bar' | 'line' | 'area' | 'pie' | 'composed';

// Summary stats card
function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="bg-bg-2 border border-border-primary rounded-xl px-4 py-3 flex-1 min-w-[120px]">
      <p className="text-text-quaternary text-[11px] font-medium">{label}</p>
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
  const avgLabel = avgValue.toLocaleString('ko-KR', { maximumFractionDigits: 1 });

  // 그래프(널담 그래프 부품)
  // 계열 색: 숫자 열이 여섯 이하면 열마다 번호를 고정한다(고르는 순서가 바뀌어도 같은 색). 그보다 많으면 고른 순서대로 1~4번
  const slotOf = (col: string): NdSlot =>
    ndSlotAt(Math.max(0, numericColumns.length <= 6 ? numericColumns.indexOf(col) : selectedYAxes.indexOf(col)));
  // 표식: 막대는 네모, 선·영역은 선. 복합은 첫째 막대 · 둘째 선 · 나머지 점
  const markOf = (col: string): NdMark => {
    if (chartType === 'bar') return 'rect';
    if (chartType !== 'composed') return 'line';
    const i = selectedYAxes.indexOf(col);
    return i === 0 ? 'rect' : i === 1 ? 'line' : 'dot';
  };
  const yValues = chartData.flatMap((r) => selectedYAxes.map((c) => Number(r[c]))).filter((v) => isFinite(v));
  const yScale = ndScale(Math.max(0, ...yValues), ndFmt.axisNumBy, Math.min(0, ...yValues), { fraction: yValues.some((v) => !Number.isInteger(v)) });
  const tip = (kind: 'bar' | 'line') => ndTooltip({ kind, value: ndFmt.num, mark: (it) => markOf(String(it.dataKey ?? '')) });
  // 도넛 행: 큰 것부터, 여섯째부터는 「기타」로 묶인다
  const pieRows = ndPieRows([...pieData].sort((a, b) => b.value - a.value));

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
              className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors ${
                chartType === type
                  ? 'bg-brand text-on-brand shadow-nd-s'
                  : 'text-text-tertiary hover:text-text-primary hover:bg-bg-secondary'
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
              className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border transition-colors ${
                selectedYAxes.includes(col)
                  ? 'text-text-primary font-medium'
                  : 'border-border-primary text-text-quaternary hover:text-text-tertiary hover:border-border-secondary'
              }`}
              // 이 단추들이 그래프의 범례다: 옅은 바탕 + 같은 색 테두리 + 본문색 글자 + 그래프와 같은 표식(원 그래프는 조각 색이 행마다라 중립색)
              style={selectedYAxes.includes(col) ? (() => { const c = chartType === 'pie' ? 'context' : slotOf(col); return { backgroundColor: ndAlpha(c, 22), borderColor: ndColor(c) }; })() : {}}
            >
              {selectedYAxes.includes(col) && chartType !== 'pie' && <NdKey slot={slotOf(col)} mark={markOf(col)} />}
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
        {chartType === 'pie' ? (
          <div className="flex flex-col gap-4">
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pieRows} dataKey="value" nameKey="name" {...ndPie()} />
                  <Tooltip {...ndTooltip({ kind: 'none', value: ndFmt.num })} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <NdDonutList rows={pieRows} value={(pct, row) => `${ndFmt.num(row.value)} · ${ndFmt.pctOf(0)(pct)}`} />
          </div>
        ) : (
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            {chartType === 'bar' ? (
              <BarChart data={chartData} margin={ndMargin}>
                <CartesianGrid {...ndGrid} />
                <XAxis dataKey={selectedXAxis} {...ndAxis.x} tickFormatter={(v) => String(v).slice(0, 12)} />
                <YAxis {...ndAxis.y} {...yScale} />
                <Tooltip {...tip('bar')} />
                {selectedYAxes.map((col) => (
                  <Bar key={col} dataKey={col} {...ndBar(slotOf(col))} />
                ))}
                {selectedYAxes.length === 1 && <ReferenceLine y={avgValue} {...ndRefLine()} label={ndRefLabel(`평균 ${avgLabel}`)} />}
                {chartData.length > 20 && <Brush dataKey={selectedXAxis} height={20} travellerWidth={8} />}
              </BarChart>
            ) : chartType === 'line' ? (
              <LineChart data={chartData} margin={ndMargin}>
                <CartesianGrid {...ndGrid} />
                <XAxis dataKey={selectedXAxis} {...ndAxis.x} tickFormatter={(v) => String(v).slice(0, 12)} />
                <YAxis {...ndAxis.y} {...yScale} />
                <Tooltip {...tip('line')} />
                {selectedYAxes.map((col) => (
                  <Line key={col} dataKey={col} {...ndLine(slotOf(col))} />
                ))}
                {selectedYAxes.length === 1 && <ReferenceLine y={avgValue} {...ndRefLine()} label={ndRefLabel(`평균 ${avgLabel}`)} />}
                {chartData.length > 20 && <Brush dataKey={selectedXAxis} height={20} travellerWidth={8} />}
              </LineChart>
            ) : chartType === 'area' ? (
              <AreaChart data={chartData} margin={ndMargin}>
                <CartesianGrid {...ndGrid} />
                <XAxis dataKey={selectedXAxis} {...ndAxis.x} tickFormatter={(v) => String(v).slice(0, 12)} />
                <YAxis {...ndAxis.y} {...yScale} />
                <Tooltip {...tip('line')} />
                {selectedYAxes.map((col) => (
                  <Area key={col} dataKey={col} {...ndArea(slotOf(col))} />
                ))}
                {chartData.length > 20 && <Brush dataKey={selectedXAxis} height={20} travellerWidth={8} />}
              </AreaChart>
            ) : (
              <ComposedChart data={chartData} margin={ndMargin}>
                <CartesianGrid {...ndGrid} />
                <XAxis dataKey={selectedXAxis} {...ndAxis.x} tickFormatter={(v) => String(v).slice(0, 12)} />
                <YAxis {...ndAxis.y} {...yScale} />
                <Tooltip {...tip('bar')} />
                {selectedYAxes.map((col, i) => {
                  if (i === 0) return <Bar key={col} dataKey={col} {...ndBar(slotOf(col))} />;
                  if (i === 1) return <Line key={col} dataKey={col} {...ndLine(slotOf(col))} />;
                  return <Scatter key={col} dataKey={col} fill={ndColor(slotOf(col))} />;
                })}
              </ComposedChart>
            )}
          </ResponsiveContainer>
        </div>
        )}
      </div>

      {rows.length > (chartType === 'pie' ? 12 : 50) && (
        <p className="text-[11px] text-text-quaternary text-center">
          * 차트는 처음 {chartType === 'pie' ? 12 : 50}개 행을 표시합니다. 스크롤 브러시로 탐색하세요.
        </p>
      )}
    </div>
  );
}
