'use client';

import { useState, useEffect, useCallback } from 'react';
import { SalesModal } from './SalesModal';
import { DataItemActions } from './DataItemActions';

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

interface SalesStatusSectionProps {
  selectedYear: number;
  selectedMonth: number;
}

const years = Array.from({ length: 13 }, (_, i) => 2018 + i);
const months = Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: `${i + 1}월` }));

export function SalesStatusSection({ selectedYear, selectedMonth }: SalesStatusSectionProps) {
  const [year, setYear] = useState(selectedYear);
  const [month, setMonth] = useState(selectedMonth);
  const [sales, setSales] = useState<Sale[]>([]);
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSale, setEditingSale] = useState<Sale | null>(null);

  const getAuthHeaders = () => {
    const token = localStorage.getItem('token');
    return {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
  };

  const fetchSales = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/targets/sales/list?year=${year}&month=${month}`, {
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        setSales(data);
      }
    } catch (error) {
      console.error('Failed to fetch sales:', error);
    }
    setIsLoading(false);
  }, [year, month]);

  const fetchComparison = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/targets/sales/comparison?year=${year}&month=${month}`, {
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        setComparison(data);
      }
    } catch (error) {
      console.error('Failed to fetch comparison:', error);
    }
  }, [year, month]);

  useEffect(() => {
    fetchSales();
    fetchComparison();
  }, [fetchSales, fetchComparison]);

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
          </div>

          {/* 비교 데이터 표시 */}
          {comparison && (
            <>
              {/* 현재 합계 */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                <div className="bg-white p-4 rounded-xl border border-slate-200">
                  <p className="text-sm text-slate-500 mb-1">매출 합계</p>
                  <p className="text-xl font-bold text-blue-600">
                    {comparison.current.total_sales > 0 ? `${formatNumber(comparison.current.total_sales)}원` : '없음'}
                  </p>
                </div>
                <div className="bg-white p-4 rounded-xl border border-slate-200">
                  <p className="text-sm text-slate-500 mb-1">판매수량 합계</p>
                  <p className="text-xl font-bold text-emerald-600">
                    {comparison.current.total_quantity > 0 ? formatNumber(comparison.current.total_quantity) : '없음'}
                  </p>
                </div>
                <div className="bg-white p-4 rounded-xl border border-slate-200">
                  <p className="text-sm text-slate-500 mb-1">마케팅비</p>
                  <p className="text-xl font-bold text-orange-600">
                    {comparison.current.total_marketing > 0 ? `${formatNumber(comparison.current.total_marketing)}원` : '없음'}
                  </p>
                </div>
                <div className="bg-white p-4 rounded-xl border border-slate-200">
                  <p className="text-sm text-slate-500 mb-1">공헌이익 합계</p>
                  <p className="text-xl font-bold text-purple-600">
                    {comparison.current.total_contribution > 0 ? `${formatNumber(comparison.current.total_contribution)}원` : '없음'}
                  </p>
                </div>
              </div>

              {/* 목표 대비 & 전월 대비 */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-white p-4 rounded-xl border border-slate-200">
                  <h4 className="text-sm font-semibold text-slate-700 mb-3">목표 대비 달성률</h4>
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
            </>
          )}
        </div>

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
