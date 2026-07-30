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
  const [error, setError] = useState<string>('');

  useEffect(() => {
    if (isOpen) {
      fetchAIResponse();
    }
    return () => {
      setResponse('');
      setError('');
    };
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
    setError('');

    const endpoint = mode === 'summary' ? '/api/ai/summary' : '/api/ai/advice';

    try {
      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          prompt: '',
          data_title: `${data.title} (${data.year || ''}${data.month ? `년 ${data.month}월` : '년'})`,
          data_type: data.kpi_type,
          data: data.grid_data,
        }),
      });

      if (res.ok) {
        const result = await res.json();
        setResponse(result.content);
      } else {
        const errorData = await res.json();
        setError(errorData.detail || 'AI 응답 생성에 실패했습니다.');
      }
    } catch (err) {
      console.error('AI response failed:', err);
      setError('서버 연결에 실패했습니다. 다시 시도해주세요.');
    }

    setIsLoading(false);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-bg-1 rounded-2xl shadow-[0px_7px_32px_rgba(0,0,0,0.35)] w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        {/* 헤더 */}
        <div className="px-6 py-4 border-b border-border-primary flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
              mode === 'summary' ? 'bg-brand/15' : 'bg-success/15'
            }`}>
              {mode === 'summary' ? (
                <svg className="w-6 h-6 text-link" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              ) : (
                <svg className="w-6 h-6 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
              )}
            </div>
            <div>
              <h2 className="text-lg font-semibold text-text-primary">
                {mode === 'summary' ? 'AI 요약' : 'AI 조언'}
              </h2>
              <p className="text-sm text-text-tertiary">{data.title}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-text-quaternary hover:text-text-secondary transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 본문 */}
        <div className="flex-1 overflow-auto p-6">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="w-10 h-10 border-4 border-brand border-t-transparent rounded-full animate-spin mb-4" />
              <p className="text-text-tertiary">AI가 분석 중입니다...</p>
            </div>
          ) : error ? (
            <div className="p-4 bg-danger/10 border border-danger/30 rounded-xl text-danger">
              {error}
            </div>
          ) : (
            <div className="prose prose-slate max-w-none">
              <div className="whitespace-pre-wrap text-text-secondary leading-relaxed">
                {response}
              </div>
            </div>
          )}
        </div>

        {/* 푸터 */}
        <div className="px-6 py-4 border-t border-border-primary flex items-center justify-between">
          <button
            onClick={fetchAIResponse}
            disabled={isLoading}
            className="flex items-center gap-2 px-4 py-2 text-link hover:bg-brand/10 rounded-lg transition-colors disabled:opacity-50"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            다시 분석
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-bg-2 text-text-secondary rounded-lg hover:bg-white/5 transition-colors"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
