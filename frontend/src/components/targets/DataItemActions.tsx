'use client';

import { useState } from 'react';
import { ChartModal } from './ChartModal';
import { AIModal } from './AIModal';

interface DataItemActionsProps {
  data: {
    id: string;
    title: string;
    kpi_type: string;
    grid_data: string[][];
    year?: number;
    month?: number;
    manager?: string;
  };
  type: 'target' | 'sales';
  onEdit: () => void;
  onDelete: () => void;
}

export function DataItemActions({ data, type, onEdit, onDelete }: DataItemActionsProps) {
  const [showChart, setShowChart] = useState(false);
  const [showAISummary, setShowAISummary] = useState(false);
  const [showAIAdvice, setShowAIAdvice] = useState(false);

  const handleDownloadCSV = () => {
    const headers = type === 'target'
      ? ['기준', '1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월']
      : ['기준', ...Array.from({ length: 31 }, (_, i) => `${i + 1}일`)];

    const csvContent = [
      headers.join(','),
      ...data.grid_data.map(row => row.map(cell => `"${cell || ''}"`).join(','))
    ].join('\n');

    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${data.title}_${data.year || ''}${data.month ? `_${data.month}월` : ''}.csv`;
    link.click();
  };

  return (
    <>
      <div className="flex items-center gap-1">
        {/* 그래프 */}
        <button
          onClick={() => setShowChart(true)}
          className="p-2 text-[#62666D] hover:text-[#7070FF] hover:bg-[#5E6AD2]/10 rounded-lg transition-colors"
          title="그래프 보기"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
        </button>

        {/* AI 요약 */}
        <button
          onClick={() => setShowAISummary(true)}
          className="p-2 text-[#62666D] hover:text-[#5E6AD2] hover:bg-[#5E6AD2]/10 rounded-lg transition-colors"
          title="AI 요약"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </button>

        {/* AI 조언 */}
        <button
          onClick={() => setShowAIAdvice(true)}
          className="p-2 text-[#62666D] hover:text-[#27A644] hover:bg-[#27A644]/10 rounded-lg transition-colors"
          title="AI 조언"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
        </button>

        {/* CSV 다운로드 */}
        <button
          onClick={handleDownloadCSV}
          className="p-2 text-[#62666D] hover:text-[#FC7840] hover:bg-[#FC7840]/10 rounded-lg transition-colors"
          title="CSV 다운로드"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
        </button>

        {/* 수정 */}
        <button
          onClick={onEdit}
          className="p-2 text-[#62666D] hover:text-[#D0D6E0] hover:bg-white/5/5 rounded-lg transition-colors"
          title="수정"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
        </button>

        {/* 삭제 */}
        <button
          onClick={onDelete}
          className="p-2 text-[#62666D] hover:text-[#EB5757] hover:bg-[#EB5757]/10 rounded-lg transition-colors"
          title="삭제"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </div>

      {/* 모달들 */}
      {showChart && (
        <ChartModal
          isOpen={showChart}
          onClose={() => setShowChart(false)}
          data={data}
          type={type}
        />
      )}
      {showAISummary && (
        <AIModal
          isOpen={showAISummary}
          onClose={() => setShowAISummary(false)}
          data={data}
          mode="summary"
        />
      )}
      {showAIAdvice && (
        <AIModal
          isOpen={showAIAdvice}
          onClose={() => setShowAIAdvice(false)}
          data={data}
          mode="advice"
        />
      )}
    </>
  );
}
