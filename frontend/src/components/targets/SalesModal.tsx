'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { ExcelGrid } from '@/components/grid/ExcelGrid';

interface SalesModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: {
    year: number;
    month: number;
    title: string;
    manager: string;
    kpi_type: string;
    grid_data: string[][];
  }) => void;
  initialData?: {
    year: number;
    month: number;
    title: string;
    manager: string;
    kpi_type: string;
    grid_data: string[][];
  } | null;
  defaultYear: number;
  defaultMonth: number;
}

const years = Array.from({ length: 13 }, (_, i) => 2018 + i);
const months = Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: `${i + 1}월` }));
const kpiTypes = ['매출', '광고선전비', '공헌이익', '판매량'];

// 해당 년월의 일수 계산
function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

export function SalesModal({
  isOpen,
  onClose,
  onSave,
  initialData,
  defaultYear,
  defaultMonth
}: SalesModalProps) {
  const [year, setYear] = useState(defaultYear);
  const [month, setMonth] = useState(defaultMonth);
  const [title, setTitle] = useState('');
  const [manager, setManager] = useState('');
  const [kpiType, setKpiType] = useState('매출');
  const [gridData, setGridData] = useState<string[][]>([]);
  const [initialized, setInitialized] = useState(false);

  // 해당 월의 일수에 맞는 열 생성
  const dayColumns = useMemo(() => {
    const days = getDaysInMonth(year, month);
    return Array.from({ length: days }, (_, i) => `${i + 1}일`);
  }, [year, month]);

  const createEmptyRow = useCallback((y: number, m: number) => {
    const days = getDaysInMonth(y, m);
    return Array(days + 1).fill('');
  }, []);

  // 모달이 열릴 때만 초기화 (한 번만)
  useEffect(() => {
    if (isOpen && !initialized) {
      if (initialData) {
        setYear(initialData.year);
        setMonth(initialData.month);
        setTitle(initialData.title);
        setManager(initialData.manager);
        setKpiType(initialData.kpi_type);
        // 기존 데이터를 깊은 복사로 보존
        setGridData(initialData.grid_data.length > 0
          ? initialData.grid_data.map(row => [...row])
          : [createEmptyRow(initialData.year, initialData.month)]);
      } else {
        setYear(defaultYear);
        setMonth(defaultMonth);
        setTitle('');
        setManager('');
        setKpiType('매출');
        setGridData([createEmptyRow(defaultYear, defaultMonth)]);
      }
      setInitialized(true);
    }

    // 모달이 닫히면 초기화 플래그 리셋
    if (!isOpen) {
      setInitialized(false);
    }
  }, [isOpen, initialData, initialized, defaultYear, defaultMonth, createEmptyRow]);

  // 년월 변경 시 그리드 데이터 조정 (초기화 후에만)
  useEffect(() => {
    if (!initialized) return;

    const days = getDaysInMonth(year, month);
    setGridData((prevData) => {
      if (prevData.length === 0) return [createEmptyRow(year, month)];

      return prevData.map((row) => {
        const currentLength = row.length;
        const targetLength = days + 1; // 첫 열(기준) + 일수

        if (currentLength < targetLength) {
          // 열 추가
          return [...row, ...Array(targetLength - currentLength).fill('')];
        } else if (currentLength > targetLength) {
          // 열 줄이기
          return row.slice(0, targetLength);
        }
        return row;
      });
    });
  }, [year, month, initialized, createEmptyRow]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      year,
      month,
      title,
      manager,
      kpi_type: kpiType,
      grid_data: gridData,
    });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-bg-1 rounded-2xl shadow-[0px_7px_32px_rgba(0,0,0,0.35)] w-full max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* 헤더 */}
        <div className="px-6 py-4 border-b border-border-primary flex items-center justify-between">
          <h2 className="text-lg font-semibold text-text-primary">
            {initialData ? '매출 현황 수정' : '새 매출 현황 기입'}
          </h2>
          <button
            onClick={onClose}
            className="p-2 text-text-quaternary hover:text-text-secondary transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 폼 */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-auto p-6">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">기준 년도</label>
              <select
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                className="w-full px-3 py-2 border border-border-primary rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-success"
              >
                {years.map((y) => (
                  <option key={y} value={y}>{y}년</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">월</label>
              <select
                value={month}
                onChange={(e) => setMonth(Number(e.target.value))}
                className="w-full px-3 py-2 border border-border-primary rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-success"
              >
                {months.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">제목</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-3 py-2 border border-border-primary rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-success"
                placeholder="1월 매출 현황"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">책임자</label>
              <input
                type="text"
                value={manager}
                onChange={(e) => setManager(e.target.value)}
                className="w-full px-3 py-2 border border-border-primary rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-success"
                placeholder="홍길동"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">KPI 구분</label>
              <select
                value={kpiType}
                onChange={(e) => setKpiType(e.target.value)}
                className="w-full px-3 py-2 border border-border-primary rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-success"
              >
                {kpiTypes.map((type) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="mb-6">
            <label className="block text-sm font-medium text-text-secondary mb-2">
              일별 데이터 입력 ({year}년 {month}월 - {dayColumns.length}일)
            </label>
            <ExcelGrid
              columns={dayColumns}
              data={gridData}
              onChange={setGridData}
              allowAddRow={true}
              firstColumnEditable={true}
            />
          </div>
        </form>

        {/* 푸터 */}
        <div className="px-6 py-4 border-t border-border-primary flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-text-tertiary hover:bg-white/5 rounded-lg transition-colors"
          >
            취소
          </button>
          <button
            onClick={handleSubmit}
            className="px-4 py-2 bg-success text-white rounded-lg hover:bg-success transition-colors"
          >
            저장
          </button>
        </div>
      </div>
    </div>
  );
}
