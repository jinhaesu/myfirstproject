'use client';

import { useState, useEffect, useCallback } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { ndAxis, ndBar, ndBarsHeight, ndFit, ndFmt, ndGrid, ndGridVertical, ndLegend, ndMargin, ndMarginH, ndScale, ndTextWidth, ndTooltip, type NdSlot } from '@/components/nd/NdChart';
import { TargetModal } from './TargetModal';
import { ExcelUploadModal } from './ExcelUploadModal';
import { DataItemActions } from './DataItemActions';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

interface Target {
  id: string;
  department: string;
  year: number;
  title: string;
  manager: string;
  kpi_type: string;
  grid_data: string[][];
  created_at: string;
}

interface TargetSummary {
  total_sales: number;
  total_quantity: number;
  total_contribution: number;
  total_advertising: number;
}

interface ChartData {
  name: string;
  매출: number;
  판매량: number;
  공헌이익: number;
  광고선전비: number;
}

interface TargetListSectionProps {
  selectedYear: number;
  setSelectedYear: (year: number) => void;
  selectedMonth: number | null;
  setSelectedMonth: (month: number | null) => void;
  excludeVat?: boolean;
}

const years = Array.from({ length: 13 }, (_, i) => 2018 + i);
const months = [
  { value: null, label: '선택안함 (연간)' },
  ...Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: `${i + 1}월` })),
];

// 목표 지표의 계열 색(순서 고정). 현황 화면(SalesStatusSection)의 매출·판매량과 같은 번호를 쓴다
const TARGET_SERIES: { key: keyof ChartData & string; slot: NdSlot }[] = [
  { key: '매출', slot: 1 },
  { key: '판매량', slot: 2 },
  { key: '공헌이익', slot: 3 },
  { key: '광고선전비', slot: 4 },
];

// 세로축 너비: 음수·긴 눈금 글자(「-2,000만」)가 왼쪽에서 잘리지 않게 가장 긴 눈금 글자에 맞춘다(기본 52px 보다 좁히지는 않는다).
// 글자 폭 어림값은 Pretendard 기준이라, 더 넓은 글꼴에서도 들어가게 13% 여유를 둔다
const fitY = <T extends { ticks: number[]; tickFormatter: (v: any) => string }>(s: T) => ({ ...s, width: Math.max(52, ...s.ticks.map((t) => Math.ceil(ndTextWidth(s.tickFormatter(t)) * 1.13) + 10)) });
// 가로 막대의 항목 축. 이름을 자르는 폭은 Pretendard 기준 어림값이라 한글이 더 넓은 글꼴에서는 몇 px 넘친다 → 축을 10% 넓게 잡는다
const categoryAxis = (width = 96) => ({ ...ndAxis.categoryOf(Math.ceil(width * 1.1)), tickFormatter: (v: any) => ndFit(String(v ?? ''), width - 12, 12) });

// 책임자·기준 항목 막대. 항목이 일곱을 넘거나 이름이 여섯 자를 넘으면 가로 막대로 그린다(이름을 자르지 않으려고)
function TargetBars({ rows, value }: { rows: ChartData[]; value: (v: any) => string }) {
  const nums = rows.flatMap((r) => TARGET_SERIES.map((s) => Number(r[s.key]) || 0));
  const top = Math.max(0, ...nums);
  const low = Math.min(0, ...nums);
  const horizontal = rows.length > 7 || rows.some((r) => Array.from(r.name || '').length > 6);
  const bars = TARGET_SERIES.map((s) => (
    <Bar key={s.key} dataKey={s.key} {...ndBar(s.slot, { horizontal, max: horizontal ? 12 : 24 })} />
  ));
  if (horizontal) {
    return (
      <ResponsiveContainer width="100%" height={ndBarsHeight(rows.length, TARGET_SERIES.length * 14 + 12)}>
        <BarChart layout="vertical" data={rows} margin={ndMarginH} barGap={2}>
          <CartesianGrid {...ndGridVertical} />
          <XAxis type="number" {...ndAxis.value} {...ndScale(top, ndFmt.axisNumBy, low)} />
          <YAxis type="category" dataKey="name" {...categoryAxis(112)} />
          <Tooltip {...ndTooltip({ kind: 'bar', value })} />
          <Legend {...ndLegend()} />
          {bars}
        </BarChart>
      </ResponsiveContainer>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={rows} margin={ndMargin} barGap={2}>
        <CartesianGrid {...ndGrid} />
        <XAxis dataKey="name" {...ndAxis.band} />
        <YAxis {...ndAxis.y} {...fitY(ndScale(top, ndFmt.axisNumBy, low))} />
        <Tooltip {...ndTooltip({ kind: 'bar', value })} />
        <Legend {...ndLegend()} />
        {bars}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function TargetListSection({
  selectedYear,
  setSelectedYear,
  selectedMonth,
  setSelectedMonth,
  excludeVat = false,
}: TargetListSectionProps) {
  const [targets, setTargets] = useState<Target[]>([]);
  const [summary, setSummary] = useState<TargetSummary | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [editingTarget, setEditingTarget] = useState<Target | null>(null);

  // 차트 관련 상태
  const [showManagerChart, setShowManagerChart] = useState(false);
  const [showCriteriaChart, setShowCriteriaChart] = useState(false);
  const [managerChartData, setManagerChartData] = useState<ChartData[]>([]);
  const [criteriaChartData, setCriteriaChartData] = useState<ChartData[]>([]);

  const getAuthHeaders = () => {
    const token = localStorage.getItem('token');
    return {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
  };

  const fetchTargets = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/targets/?year=${selectedYear}`, {
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        setTargets(data);
      }
    } catch (error) {
      console.error('Failed to fetch targets:', error);
    }
    setIsLoading(false);
  }, [selectedYear]);

  const fetchSummary = useCallback(async () => {
    try {
      const monthParam = selectedMonth ? `&month=${selectedMonth}` : '';
      const res = await fetch(`${API_BASE}/api/targets/summary?year=${selectedYear}${monthParam}`, {
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        setSummary(data);
      }
    } catch (error) {
      console.error('Failed to fetch summary:', error);
    }
  }, [selectedYear, selectedMonth]);

  const fetchManagerChartData = useCallback(async () => {
    if (!showManagerChart) return;
    try {
      const monthParam = selectedMonth ? `&month=${selectedMonth}` : '';
      const res = await fetch(`${API_BASE}/api/targets/chart/by-manager?year=${selectedYear}${monthParam}`, {
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        // API 응답을 차트 데이터 형식으로 변환
        const chartData: ChartData[] = Object.entries(data.by_manager || {}).map(([manager, values]: [string, any]) => ({
          name: manager,
          매출: values.매출 || 0,
          판매량: values.판매량 || 0,
          공헌이익: values.공헌이익 || 0,
          광고선전비: values.광고선전비 || 0,
        }));
        setManagerChartData(chartData);
      }
    } catch (error) {
      console.error('Failed to fetch manager chart data:', error);
    }
  }, [selectedYear, selectedMonth, showManagerChart]);

  const fetchCriteriaChartData = useCallback(async () => {
    if (!showCriteriaChart) return;
    try {
      const monthParam = selectedMonth ? `&month=${selectedMonth}` : '';
      const res = await fetch(`${API_BASE}/api/targets/chart/by-criteria?year=${selectedYear}${monthParam}`, {
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        // API 응답을 차트 데이터 형식으로 변환
        const chartData: ChartData[] = Object.entries(data.by_criteria || {}).map(([criteria, values]: [string, any]) => ({
          name: criteria,
          매출: values.매출 || 0,
          판매량: values.판매량 || 0,
          공헌이익: values.공헌이익 || 0,
          광고선전비: values.광고선전비 || 0,
        }));
        setCriteriaChartData(chartData);
      }
    } catch (error) {
      console.error('Failed to fetch criteria chart data:', error);
    }
  }, [selectedYear, selectedMonth, showCriteriaChart]);

  useEffect(() => {
    fetchTargets();
    fetchSummary();
  }, [fetchTargets, fetchSummary]);

  useEffect(() => {
    fetchManagerChartData();
  }, [fetchManagerChartData]);

  useEffect(() => {
    fetchCriteriaChartData();
  }, [fetchCriteriaChartData]);

  const handleSave = async (data: Omit<Target, 'id' | 'created_at'>) => {
    try {
      const url = editingTarget
        ? `${API_BASE}/api/targets/${editingTarget.id}`
        : `${API_BASE}/api/targets/`;
      const method = editingTarget ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: getAuthHeaders(),
        body: JSON.stringify(data),
      });

      if (res.ok) {
        setIsModalOpen(false);
        setEditingTarget(null);
        fetchTargets();
        fetchSummary();
      }
    } catch (error) {
      console.error('Failed to save target:', error);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('정말 삭제하시겠습니까?')) return;

    try {
      const res = await fetch(`${API_BASE}/api/targets/${id}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        fetchTargets();
        fetchSummary();
      }
    } catch (error) {
      console.error('Failed to delete target:', error);
    }
  };

  const handleEdit = (target: Target) => {
    setEditingTarget(target);
    setIsModalOpen(true);
  };

  const formatNumber = (num: number, applyVat: boolean = true) => {
    const value = applyVat && excludeVat ? Math.round(num / 1.1) : num;
    return new Intl.NumberFormat('ko-KR').format(value);
  };

  return (
    <section className="mb-8">
      <div className="bg-bg-1 rounded-2xl shadow-nd-s border border-border-primary overflow-hidden">
        {/* 헤더 */}
        <div className="px-6 py-4 border-b border-border-primary flex items-center justify-between">
          <h2 className="text-lg font-semibold text-text-primary">목표 리스트</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setEditingTarget(null);
                setIsModalOpen(true);
              }}
              className="flex items-center gap-2 px-4 py-2 bg-brand text-on-brand rounded-lg hover:bg-accent transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
              기입하기
            </button>
            <button
              onClick={() => setIsUploadModalOpen(true)}
              className="flex items-center gap-2 px-4 py-2 bg-success text-on-brand rounded-lg hover:bg-success transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              엑셀 업로드
            </button>
          </div>
        </div>

        {/* 년도/월 선택 & 합계 */}
        <div className="px-6 py-4 bg-bg-0 border-b border-border-primary">
          <div className="flex flex-wrap items-center gap-4 mb-4">
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-text-tertiary">기준 년도:</label>
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(Number(e.target.value))}
                className="px-3 py-2 border border-border-primary rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand"
              >
                {years.map((y) => (
                  <option key={y} value={y}>{y}년</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-text-tertiary">월:</label>
              <select
                value={selectedMonth ?? ''}
                onChange={(e) => setSelectedMonth(e.target.value ? Number(e.target.value) : null)}
                className="px-3 py-2 border border-border-primary rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand"
              >
                {months.map((m) => (
                  <option key={m.value ?? 'null'} value={m.value ?? ''}>{m.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* 합계 표시 */}
          {summary ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-bg-1 p-4 rounded-xl border border-border-primary">
                <p className="text-sm text-text-tertiary mb-1">
                  총 목표 매출 <span className="text-xs text-text-quaternary">({excludeVat ? '부가세 별도' : '부가세 합계'})</span>
                </p>
                <p className="text-xl font-semibold text-link">
                  {summary.total_sales > 0 ? `${formatNumber(summary.total_sales)}원` : '없음'}
                </p>
              </div>
              <div className="bg-bg-1 p-4 rounded-xl border border-border-primary">
                <p className="text-sm text-text-tertiary mb-1">총 판매량</p>
                <p className="text-xl font-semibold text-success">
                  {summary.total_quantity > 0 ? formatNumber(summary.total_quantity, false) : '없음'}
                </p>
              </div>
              <div className="bg-bg-1 p-4 rounded-xl border border-border-primary">
                <p className="text-sm text-text-tertiary mb-1">
                  공헌이익액 <span className="text-xs text-text-quaternary">({excludeVat ? '부가세 별도' : '부가세 합계'})</span>
                </p>
                <p className="text-xl font-semibold text-link">
                  {summary.total_contribution > 0 ? `${formatNumber(summary.total_contribution)}원` : '없음'}
                </p>
              </div>
              <div className="bg-bg-1 p-4 rounded-xl border border-border-primary">
                <p className="text-sm text-text-tertiary mb-1">
                  광고선전비 합계 <span className="text-xs text-text-quaternary">({excludeVat ? '부가세 별도' : '부가세 합계'})</span>
                </p>
                <p className="text-xl font-semibold text-orange">
                  {summary.total_advertising > 0 ? `${formatNumber(summary.total_advertising)}원` : '없음'}
                </p>
              </div>
            </div>
          ) : (
            <p className="text-text-tertiary">데이터 로딩 중...</p>
          )}

          {/* 차트 토글 체크박스 */}
          <div className="flex items-center gap-6 mt-4 pt-4 border-t border-border-primary">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showManagerChart}
                  onChange={(e) => setShowManagerChart(e.target.checked)}
                  className="w-4 h-4 text-link rounded border-border-primary focus:ring-brand"
                />
                <span className="text-sm font-medium text-text-secondary">책임자별 목표 지표</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showCriteriaChart}
                  onChange={(e) => setShowCriteriaChart(e.target.checked)}
                  className="w-4 h-4 text-link rounded border-border-primary focus:ring-brand"
                />
                <span className="text-sm font-medium text-text-secondary">기준별 목표 지표</span>
              </label>
            </div>
        </div>

        {/* 차트 영역 */}
        {(showManagerChart || showCriteriaChart) && (
          <div className="px-6 py-4 border-b border-border-primary">
            <div className={`grid gap-6 ${showManagerChart && showCriteriaChart ? 'md:grid-cols-2' : 'grid-cols-1'}`}>
              {/* 책임자별 차트 */}
              {showManagerChart && managerChartData.length > 0 && (
                <div className="bg-bg-1 p-4 rounded-xl border border-border-primary">
                  <h3 className="text-sm font-semibold text-text-secondary mb-4">책임자별 목표 지표</h3>
                  <TargetBars rows={managerChartData} value={(value) => formatNumber(value)} />
                </div>
              )}

              {/* 기준별 차트 */}
              {showCriteriaChart && criteriaChartData.length > 0 && (
                <div className="bg-bg-1 p-4 rounded-xl border border-border-primary">
                  <h3 className="text-sm font-semibold text-text-secondary mb-4">기준별 목표 지표</h3>
                  <TargetBars rows={criteriaChartData} value={(value) => formatNumber(value)} />
                </div>
              )}
            </div>
          </div>
        )}

        {/* 리스트 */}
        <div className="divide-y divide-border-primary">
          {isLoading ? (
            <div className="px-6 py-8 text-center text-text-tertiary">
              <div className="w-8 h-8 border-4 border-brand border-t-transparent rounded-full animate-spin mx-auto mb-2" />
              로딩 중...
            </div>
          ) : targets.length === 0 ? (
            <div className="px-6 py-8 text-center text-text-tertiary">
              등록된 목표 데이터가 없습니다.
            </div>
          ) : (
            targets.map((target) => (
              <div key={target.id} className="px-6 py-4 flex items-center justify-between hover:bg-bg-secondary">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="px-2 py-0.5 bg-brand/15 text-accent text-xs font-medium rounded">
                      {target.kpi_type}
                    </span>
                    <span className="text-sm text-text-tertiary">{target.department}</span>
                  </div>
                  <h3 className="font-medium text-text-primary">{target.title}</h3>
                  <p className="text-sm text-text-tertiary">
                    {target.year}년 | 담당: {target.manager}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <DataItemActions
                    data={target}
                    type="target"
                    onEdit={() => handleEdit(target)}
                    onDelete={() => handleDelete(target.id)}
                  />
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* 모달 */}
      {isModalOpen && (
        <TargetModal
          isOpen={isModalOpen}
          onClose={() => {
            setIsModalOpen(false);
            setEditingTarget(null);
          }}
          onSave={handleSave}
          initialData={editingTarget}
        />
      )}

      {/* 엑셀 업로드 모달 */}
      {isUploadModalOpen && (
        <ExcelUploadModal
          isOpen={isUploadModalOpen}
          onClose={() => setIsUploadModalOpen(false)}
          onSuccess={() => {
            fetchTargets();
            fetchSummary();
          }}
          defaultYear={selectedYear}
        />
      )}
    </section>
  );
}
