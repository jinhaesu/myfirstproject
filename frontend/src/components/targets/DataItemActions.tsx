'use client';

import { useState } from 'react';
import { ChartModal } from './ChartModal';
import { AIModal } from './AIModal';
import { ChartBarIcon, DownloadIcon, EditIcon, FileTextIcon, LightbulbIcon, TrashIcon } from '@/components/nd/icons';

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
          className="p-2 text-text-quaternary hover:text-link hover:bg-brand/10 rounded-lg transition-colors"
          title="그래프 보기"
        >
          <ChartBarIcon className="w-5 h-5" />
        </button>

        {/* AI 요약 */}
        <button
          onClick={() => setShowAISummary(true)}
          className="p-2 text-text-quaternary hover:text-brand hover:bg-brand/10 rounded-lg transition-colors"
          title="AI 요약"
        >
          <FileTextIcon className="w-5 h-5" />
        </button>

        {/* AI 조언 */}
        <button
          onClick={() => setShowAIAdvice(true)}
          className="p-2 text-text-quaternary hover:text-success hover:bg-success/10 rounded-lg transition-colors"
          title="AI 조언"
        >
          <LightbulbIcon className="w-5 h-5" />
        </button>

        {/* CSV 다운로드 */}
        <button
          onClick={handleDownloadCSV}
          className="p-2 text-text-quaternary hover:text-orange hover:bg-orange/10 rounded-lg transition-colors"
          title="CSV 다운로드"
        >
          <DownloadIcon className="w-5 h-5" />
        </button>

        {/* 수정 */}
        <button
          onClick={onEdit}
          className="p-2 text-text-quaternary hover:text-text-secondary hover:bg-bg-secondary rounded-lg transition-colors"
          title="수정"
        >
          <EditIcon className="w-5 h-5" />
        </button>

        {/* 삭제 */}
        <button
          onClick={onDelete}
          className="p-2 text-text-quaternary hover:text-danger hover:bg-danger/10 rounded-lg transition-colors"
          title="삭제"
        >
          <TrashIcon className="w-5 h-5" />
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
