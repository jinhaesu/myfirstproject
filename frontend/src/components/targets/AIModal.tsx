'use client';

import { useState, useEffect } from 'react';
import { FileTextIcon, LightbulbIcon, RefreshIcon, XIcon } from '@/components/nd/icons';

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
      <div className="relative bg-bg-1 rounded-2xl shadow-nd-f w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        {/* 헤더 */}
        <div className="px-6 py-4 border-b border-border-primary flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
              mode === 'summary' ? 'bg-brand/15' : 'bg-success/15'
            }`}>
              {mode === 'summary' ? (
                <FileTextIcon className="w-6 h-6 text-link" />
              ) : (
                <LightbulbIcon className="w-6 h-6 text-success" />
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
            <XIcon className="w-5 h-5" />
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
            <RefreshIcon className="w-4 h-4" />
            다시 분석
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-bg-2 text-text-secondary rounded-lg hover:bg-bg-secondary transition-colors"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
