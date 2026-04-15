'use client';

import { useState, useEffect } from 'react';
import { ExcelGrid } from '@/components/grid/ExcelGrid';

interface TargetModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: {
    department: string;
    year: number;
    title: string;
    manager: string;
    kpi_type: string;
    grid_data: string[][];
  }) => void;
  initialData?: {
    department: string;
    year: number;
    title: string;
    manager: string;
    kpi_type: string;
    grid_data: string[][];
  } | null;
}

const years = Array.from({ length: 13 }, (_, i) => 2018 + i);
const kpiTypes = ['매출', '광고선전비', '공헌이익', '판매량'];
const monthColumns = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'];

export function TargetModal({ isOpen, onClose, onSave, initialData }: TargetModalProps) {
  const [department, setDepartment] = useState('');
  const [year, setYear] = useState(new Date().getFullYear());
  const [title, setTitle] = useState('');
  const [manager, setManager] = useState('');
  const [kpiType, setKpiType] = useState('매출');
  const [gridData, setGridData] = useState<string[][]>([['', '', '', '', '', '', '', '', '', '', '', '', '']]);
  const [initialized, setInitialized] = useState(false);

  // 모달이 열릴 때만 초기화 (한 번만)
  useEffect(() => {
    if (isOpen && !initialized) {
      if (initialData) {
        setDepartment(initialData.department);
        setYear(initialData.year);
        setTitle(initialData.title);
        setManager(initialData.manager);
        setKpiType(initialData.kpi_type);
        // 기존 데이터를 깊은 복사로 보존
        setGridData(initialData.grid_data.length > 0
          ? initialData.grid_data.map(row => [...row])
          : [['', '', '', '', '', '', '', '', '', '', '', '', '']]);
      } else {
        setDepartment('');
        setYear(new Date().getFullYear());
        setTitle('');
        setManager('');
        setKpiType('매출');
        setGridData([['', '', '', '', '', '', '', '', '', '', '', '', '']]);
      }
      setInitialized(true);
    }

    // 모달이 닫히면 초기화 플래그 리셋
    if (!isOpen) {
      setInitialized(false);
    }
  }, [isOpen, initialData, initialized]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      department,
      year,
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
      <div className="relative bg-[#0F1011] rounded-2xl shadow-[0px_7px_32px_rgba(0,0,0,0.35)] w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* 헤더 */}
        <div className="px-6 py-4 border-b border-[#23252A] flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[#F7F8F8]">
            {initialData ? '목표 수정' : '새 목표 기입'}
          </h2>
          <button
            onClick={onClose}
            className="p-2 text-[#62666D] hover:text-[#D0D6E0] transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 폼 */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-auto p-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div>
              <label className="block text-sm font-medium text-[#D0D6E0] mb-1">부서</label>
              <input
                type="text"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                className="w-full px-3 py-2 border border-[#23252A] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="영업부"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#D0D6E0] mb-1">기준 년도</label>
              <select
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                className="w-full px-3 py-2 border border-[#23252A] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {years.map((y) => (
                  <option key={y} value={y}>{y}년</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-[#D0D6E0] mb-1">제목</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-3 py-2 border border-[#23252A] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="2024년 매출 목표"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#D0D6E0] mb-1">책임자</label>
              <input
                type="text"
                value={manager}
                onChange={(e) => setManager(e.target.value)}
                className="w-full px-3 py-2 border border-[#23252A] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="홍길동"
                required
              />
            </div>
          </div>

          <div className="mb-6">
            <label className="block text-sm font-medium text-[#D0D6E0] mb-1">KPI 구분</label>
            <div className="flex flex-wrap gap-2">
              {kpiTypes.map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setKpiType(type)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    kpiType === type
                      ? 'bg-[#5E6AD2] text-white'
                      : 'bg-[#141516] text-[#D0D6E0] hover:bg-[#141516]/7'
                  }`}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>

          <div className="mb-6">
            <label className="block text-sm font-medium text-[#D0D6E0] mb-2">
              월별 데이터 입력 (1월 ~ 12월)
            </label>
            <ExcelGrid
              columns={monthColumns}
              data={gridData}
              onChange={setGridData}
              allowAddRow={true}
              firstColumnEditable={true}
            />
          </div>
        </form>

        {/* 푸터 */}
        <div className="px-6 py-4 border-t border-[#23252A] flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-[#8A8F98] hover:bg-[#141516]/5 rounded-lg transition-colors"
          >
            취소
          </button>
          <button
            onClick={handleSubmit}
            className="px-4 py-2 bg-[#5E6AD2] text-white rounded-lg hover:bg-[#828FFF] transition-colors"
          >
            저장
          </button>
        </div>
      </div>
    </div>
  );
}
