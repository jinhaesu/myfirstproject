'use client';

import { useState, useEffect, useCallback } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
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
      <div className="bg-[#0F1011] rounded-2xl shadow-[0px_1px_3px_rgba(0,0,0,0.2)] border border-[#23252A] overflow-hidden">
        {/* 헤더 */}
        <div className="px-6 py-4 border-b border-[#23252A] flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[#F7F8F8]">목표 리스트</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setEditingTarget(null);
                setIsModalOpen(true);
              }}
              className="flex items-center gap-2 px-4 py-2 bg-[#5E6AD2] text-white rounded-lg hover:bg-[#828FFF] transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
              기입하기
            </button>
            <button
              onClick={() => setIsUploadModalOpen(true)}
              className="flex items-center gap-2 px-4 py-2 bg-[#27A644] text-white rounded-lg hover:bg-[#27A644] transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              엑셀 업로드
            </button>
          </div>
        </div>

        {/* 년도/월 선택 & 합계 */}
        <div className="px-6 py-4 bg-[#08090A] border-b border-[#23252A]">
          <div className="flex flex-wrap items-center gap-4 mb-4">
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-[#8A8F98]">기준 년도:</label>
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(Number(e.target.value))}
                className="px-3 py-2 border border-[#23252A] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {years.map((y) => (
                  <option key={y} value={y}>{y}년</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-[#8A8F98]">월:</label>
              <select
                value={selectedMonth ?? ''}
                onChange={(e) => setSelectedMonth(e.target.value ? Number(e.target.value) : null)}
                className="px-3 py-2 border border-[#23252A] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
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
              <div className="bg-[#0F1011] p-4 rounded-xl border border-[#23252A]">
                <p className="text-sm text-[#8A8F98] mb-1">
                  총 목표 매출 <span className="text-xs text-[#62666D]">({excludeVat ? '부가세 별도' : '부가세 합계'})</span>
                </p>
                <p className="text-xl font-bold text-[#7070FF]">
                  {summary.total_sales > 0 ? `${formatNumber(summary.total_sales)}원` : '없음'}
                </p>
              </div>
              <div className="bg-[#0F1011] p-4 rounded-xl border border-[#23252A]">
                <p className="text-sm text-[#8A8F98] mb-1">총 판매량</p>
                <p className="text-xl font-bold text-[#27A644]">
                  {summary.total_quantity > 0 ? formatNumber(summary.total_quantity, false) : '없음'}
                </p>
              </div>
              <div className="bg-[#0F1011] p-4 rounded-xl border border-[#23252A]">
                <p className="text-sm text-[#8A8F98] mb-1">
                  공헌이익액 <span className="text-xs text-[#62666D]">({excludeVat ? '부가세 별도' : '부가세 합계'})</span>
                </p>
                <p className="text-xl font-bold text-[#7070FF]">
                  {summary.total_contribution > 0 ? `${formatNumber(summary.total_contribution)}원` : '없음'}
                </p>
              </div>
              <div className="bg-[#0F1011] p-4 rounded-xl border border-[#23252A]">
                <p className="text-sm text-[#8A8F98] mb-1">
                  광고선전비 합계 <span className="text-xs text-[#62666D]">({excludeVat ? '부가세 별도' : '부가세 합계'})</span>
                </p>
                <p className="text-xl font-bold text-[#FC7840]">
                  {summary.total_advertising > 0 ? `${formatNumber(summary.total_advertising)}원` : '없음'}
                </p>
              </div>
            </div>
          ) : (
            <p className="text-[#8A8F98]">데이터 로딩 중...</p>
          )}

          {/* 차트 토글 체크박스 */}
          <div className="flex items-center gap-6 mt-4 pt-4 border-t border-[#23252A]">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showManagerChart}
                  onChange={(e) => setShowManagerChart(e.target.checked)}
                  className="w-4 h-4 text-[#7070FF] rounded border-[#23252A] focus:ring-blue-500"
                />
                <span className="text-sm font-medium text-[#D0D6E0]">책임자별 목표 지표</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showCriteriaChart}
                  onChange={(e) => setShowCriteriaChart(e.target.checked)}
                  className="w-4 h-4 text-[#7070FF] rounded border-[#23252A] focus:ring-blue-500"
                />
                <span className="text-sm font-medium text-[#D0D6E0]">기준별 목표 지표</span>
              </label>
            </div>
        </div>

        {/* 차트 영역 */}
        {(showManagerChart || showCriteriaChart) && (
          <div className="px-6 py-4 border-b border-[#23252A]">
            <div className={`grid gap-6 ${showManagerChart && showCriteriaChart ? 'md:grid-cols-2' : 'grid-cols-1'}`}>
              {/* 책임자별 차트 */}
              {showManagerChart && managerChartData.length > 0 && (
                <div className="bg-[#0F1011] p-4 rounded-xl border border-[#23252A]">
                  <h3 className="text-sm font-semibold text-[#D0D6E0] mb-4">책임자별 목표 지표</h3>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={managerChartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} tickFormatter={(value) => {
                        if (value >= 100000000) return `${(value / 100000000).toFixed(0)}억`;
                        if (value >= 10000) return `${(value / 10000).toFixed(0)}만`;
                        return value.toString();
                      }} />
                      <Tooltip formatter={(value: number) => formatNumber(value)} />
                      <Legend />
                      <Bar dataKey="매출" fill="#5E6AD2" />
                      <Bar dataKey="판매량" fill="#10b981" />
                      <Bar dataKey="공헌이익" fill="#8b5cf6" />
                      <Bar dataKey="광고선전비" fill="#f97316" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* 기준별 차트 */}
              {showCriteriaChart && criteriaChartData.length > 0 && (
                <div className="bg-[#0F1011] p-4 rounded-xl border border-[#23252A]">
                  <h3 className="text-sm font-semibold text-[#D0D6E0] mb-4">기준별 목표 지표</h3>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={criteriaChartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} tickFormatter={(value) => {
                        if (value >= 100000000) return `${(value / 100000000).toFixed(0)}억`;
                        if (value >= 10000) return `${(value / 10000).toFixed(0)}만`;
                        return value.toString();
                      }} />
                      <Tooltip formatter={(value: number) => formatNumber(value)} />
                      <Legend />
                      <Bar dataKey="매출" fill="#5E6AD2" />
                      <Bar dataKey="판매량" fill="#10b981" />
                      <Bar dataKey="공헌이익" fill="#8b5cf6" />
                      <Bar dataKey="광고선전비" fill="#f97316" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 리스트 */}
        <div className="divide-y divide-[#23252A]">
          {isLoading ? (
            <div className="px-6 py-8 text-center text-[#8A8F98]">
              <div className="w-8 h-8 border-4 border-[#5E6AD2] border-t-transparent rounded-full animate-spin mx-auto mb-2" />
              로딩 중...
            </div>
          ) : targets.length === 0 ? (
            <div className="px-6 py-8 text-center text-[#8A8F98]">
              등록된 목표 데이터가 없습니다.
            </div>
          ) : (
            targets.map((target) => (
              <div key={target.id} className="px-6 py-4 flex items-center justify-between hover:bg-[#141516]/5">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="px-2 py-0.5 bg-[#5E6AD2]/15 text-[#828FFF] text-xs font-medium rounded">
                      {target.kpi_type}
                    </span>
                    <span className="text-sm text-[#8A8F98]">{target.department}</span>
                  </div>
                  <h3 className="font-medium text-[#F7F8F8]">{target.title}</h3>
                  <p className="text-sm text-[#8A8F98]">
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
