'use client';

import { useState, useEffect, useCallback } from 'react';
import { TargetModal } from './TargetModal';
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

interface TargetListSectionProps {
  selectedYear: number;
  setSelectedYear: (year: number) => void;
  selectedMonth: number | null;
  setSelectedMonth: (month: number | null) => void;
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
}: TargetListSectionProps) {
  const [targets, setTargets] = useState<Target[]>([]);
  const [summary, setSummary] = useState<TargetSummary | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTarget, setEditingTarget] = useState<Target | null>(null);

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

  useEffect(() => {
    fetchTargets();
    fetchSummary();
  }, [fetchTargets, fetchSummary]);

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

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat('ko-KR').format(num);
  };

  return (
    <section className="mb-8">
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        {/* 헤더 */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-800">목표 리스트</h2>
          <button
            onClick={() => {
              setEditingTarget(null);
              setIsModalOpen(true);
            }}
            className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
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
                value={selectedYear}
                onChange={(e) => setSelectedYear(Number(e.target.value))}
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
                value={selectedMonth ?? ''}
                onChange={(e) => setSelectedMonth(e.target.value ? Number(e.target.value) : null)}
                className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
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
              <div className="bg-white p-4 rounded-xl border border-slate-200">
                <p className="text-sm text-slate-500 mb-1">총 목표 매출</p>
                <p className="text-xl font-bold text-blue-600">
                  {summary.total_sales > 0 ? `${formatNumber(summary.total_sales)}원` : '없음'}
                </p>
              </div>
              <div className="bg-white p-4 rounded-xl border border-slate-200">
                <p className="text-sm text-slate-500 mb-1">총 판매량</p>
                <p className="text-xl font-bold text-emerald-600">
                  {summary.total_quantity > 0 ? formatNumber(summary.total_quantity) : '없음'}
                </p>
              </div>
              <div className="bg-white p-4 rounded-xl border border-slate-200">
                <p className="text-sm text-slate-500 mb-1">공헌이익액</p>
                <p className="text-xl font-bold text-purple-600">
                  {summary.total_contribution > 0 ? `${formatNumber(summary.total_contribution)}원` : '없음'}
                </p>
              </div>
              <div className="bg-white p-4 rounded-xl border border-slate-200">
                <p className="text-sm text-slate-500 mb-1">광고선전비 합계</p>
                <p className="text-xl font-bold text-orange-600">
                  {summary.total_advertising > 0 ? `${formatNumber(summary.total_advertising)}원` : '없음'}
                </p>
              </div>
            </div>
          ) : (
            <p className="text-slate-500">데이터 로딩 중...</p>
          )}
        </div>

        {/* 리스트 */}
        <div className="divide-y divide-slate-100">
          {isLoading ? (
            <div className="px-6 py-8 text-center text-slate-500">
              <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
              로딩 중...
            </div>
          ) : targets.length === 0 ? (
            <div className="px-6 py-8 text-center text-slate-500">
              등록된 목표 데이터가 없습니다.
            </div>
          ) : (
            targets.map((target) => (
              <div key={target.id} className="px-6 py-4 flex items-center justify-between hover:bg-slate-50">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs font-medium rounded">
                      {target.kpi_type}
                    </span>
                    <span className="text-sm text-slate-500">{target.department}</span>
                  </div>
                  <h3 className="font-medium text-slate-800">{target.title}</h3>
                  <p className="text-sm text-slate-500">
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
    </section>
  );
}
