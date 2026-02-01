'use client';

import { useState, useEffect } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

interface AIModalProps {
  isOpen: boolean;
  onClose: () => void;
  data: {
    title: string;
    kpi_type: string;
    grid_data: string[][];
    year?: number;
    month?: number;
  };
  mode: 'summary' | 'advice';
}

export function AIModal({ isOpen, onClose, data, mode }: AIModalProps) {
  const [response, setResponse] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      fetchAIResponse();
    }
  }, [isOpen]);

  const getAuthHeaders = () => {
    const token = localStorage.getItem('token');
    return {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
  };

  const fetchAIResponse = async () => {
    setIsLoading(true);
    setResponse('');

    const prompt = mode === 'summary'
      ? `다음 데이터를 분석하여 핵심 요약을 제공해주세요:
제목: ${data.title}
KPI 유형: ${data.kpi_type}
기간: ${data.year || ''}${data.month ? `년 ${data.month}월` : '년'}

데이터:
${data.grid_data.map(row => row.join(', ')).join('\n')}

요약 시 다음을 포함해주세요:
1. 전체적인 추세
2. 주요 수치
3. 특이점

한글로 작성해주세요.`
      : `다음 데이터를 분석하여 개선 조언을 제공해주세요:
제목: ${data.title}
KPI 유형: ${data.kpi_type}
기간: ${data.year || ''}${data.month ? `년 ${data.month}월` : '년'}

데이터:
${data.grid_data.map(row => row.join(', ')).join('\n')}

조언 시 다음을 포함해주세요:
1. 현재 상태 분석
2. 문제점 파악
3. 구체적인 개선 방안
4. 실행 가능한 액션 아이템

한글로 작성해주세요.`;

    try {
      const res = await fetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          message: prompt,
          table_id: null,
          dataset_id: null,
        }),
      });

      if (res.ok) {
        const reader = res.body?.getReader();
        const decoder = new TextDecoder();

        if (reader) {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value);
            const lines = chunk.split('\n').filter(line => line.startsWith('data: '));

            for (const line of lines) {
              const jsonStr = line.replace('data: ', '');
              if (jsonStr === '[DONE]') continue;

              try {
                const parsed = JSON.parse(jsonStr);
                if (parsed.message) {
                  setResponse(prev => prev + parsed.message);
                }
              } catch {
                // JSON 파싱 실패 시 무시
              }
            }
          }
        }
      }
    } catch (error) {
      console.error('AI response failed:', error);
      setResponse('AI 응답을 가져오는데 실패했습니다. 다시 시도해주세요.');
    }

    setIsLoading(false);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        {/* 헤더 */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
              mode === 'summary' ? 'bg-purple-100' : 'bg-emerald-100'
            }`}>
              {mode === 'summary' ? (
                <svg className="w-6 h-6 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              ) : (
                <svg className="w-6 h-6 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
              )}
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-800">
                {mode === 'summary' ? 'AI 요약' : 'AI 조언'}
              </h2>
              <p className="text-sm text-slate-500">{data.title}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 본문 */}
        <div className="flex-1 overflow-auto p-6">
          {isLoading && !response ? (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4" />
              <p className="text-slate-500">AI가 분석 중입니다...</p>
            </div>
          ) : (
            <div className="prose prose-slate max-w-none">
              <div className="whitespace-pre-wrap text-slate-700 leading-relaxed">
                {response || 'AI 응답을 기다리는 중...'}
              </div>
            </div>
          )}
        </div>

        {/* 푸터 */}
        <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-between">
          <button
            onClick={fetchAIResponse}
            disabled={isLoading}
            className="flex items-center gap-2 px-4 py-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors disabled:opacity-50"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            다시 분석
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-colors"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
