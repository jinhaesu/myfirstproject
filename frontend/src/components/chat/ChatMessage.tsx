'use client';

import { useState } from 'react';
import { DataTable } from '../table/DataTable';
import { DataChart } from '../chart/DataChart';
import type { Message } from '@/types';

interface ChatMessageProps {
  message: Message;
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === 'user';
  const [showChart, setShowChart] = useState(false);
  const [copiedSql, setCopiedSql] = useState(false);

  const handleCopySql = () => {
    if (message.sql) {
      navigator.clipboard.writeText(message.sql);
      setCopiedSql(true);
      setTimeout(() => setCopiedSql(false), 2000);
    }
  };

  const handleDownloadCsv = () => {
    if (!message.columns || !message.rows) return;

    const headers = message.columns.join(',');
    const rows = message.rows.map(row =>
      message.columns!.map(col => {
        const value = row[col];
        if (value === null || value === undefined) return '';
        if (typeof value === 'string' && value.includes(',')) {
          return `"${value.replace(/"/g, '""')}"`;
        }
        return String(value);
      }).join(',')
    ).join('\n');

    const csv = `${headers}\n${rows}`;
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `data_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-4xl rounded-2xl p-4 ${
          isUser
            ? 'bg-gradient-to-r from-blue-500 to-indigo-600 text-white shadow-lg'
            : 'bg-white border border-slate-200 shadow-md'
        }`}
      >
        {/* 메시지 내용 */}
        <p className={`whitespace-pre-wrap leading-relaxed ${isUser ? '' : 'text-slate-700'}`}>
          {message.content}
        </p>

        {/* SQL 쿼리 (AI 응답일 때만) */}
        {!isUser && message.sql && (
          <div className="mt-4">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-semibold text-slate-500 flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                </svg>
                실행된 SQL
              </h4>
              <button
                onClick={handleCopySql}
                className="text-xs px-2 py-1 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors flex items-center gap-1"
              >
                {copiedSql ? (
                  <>
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    복사됨
                  </>
                ) : (
                  <>
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    복사
                  </>
                )}
              </button>
            </div>
            <pre className="bg-slate-900 text-green-400 p-4 rounded-xl text-sm overflow-x-auto font-mono">
              {message.sql}
            </pre>
          </div>
        )}

        {/* 결과 테이블 (AI 응답일 때만) */}
        {!isUser && message.columns && message.rows && message.rows.length > 0 && (
          <div className="mt-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-semibold text-slate-500 flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                결과 ({message.row_count}행)
              </h4>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowChart(!showChart)}
                  className={`text-xs px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1 ${
                    showChart
                      ? 'bg-indigo-100 text-indigo-700'
                      : 'text-slate-500 hover:text-indigo-600 hover:bg-indigo-50'
                  }`}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                  {showChart ? '테이블 보기' : '차트 보기'}
                </button>
                <button
                  onClick={handleDownloadCsv}
                  className="text-xs px-3 py-1.5 text-slate-500 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors flex items-center gap-1"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  CSV 다운로드
                </button>
              </div>
            </div>

            {showChart ? (
              <div className="border border-slate-200 rounded-xl overflow-hidden bg-white p-4">
                <DataChart columns={message.columns} rows={message.rows} />
              </div>
            ) : (
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <DataTable columns={message.columns} rows={message.rows} />
              </div>
            )}
          </div>
        )}

        {/* 타임스탬프 */}
        <p
          className={`text-xs mt-3 flex items-center gap-1 ${
            isUser ? 'text-blue-200' : 'text-slate-400'
          }`}
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {message.timestamp.toLocaleTimeString('ko-KR')}
        </p>
      </div>
    </div>
  );
}
