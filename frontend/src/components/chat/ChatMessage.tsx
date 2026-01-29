'use client';

import { DataTable } from '../table/DataTable';
import type { Message } from '@/types';

interface ChatMessageProps {
  message: Message;
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-4xl rounded-lg p-4 ${
          isUser
            ? 'bg-blue-600 text-white'
            : 'bg-white border border-gray-200 shadow-sm'
        }`}
      >
        {/* 메시지 내용 */}
        <p className={`whitespace-pre-wrap ${isUser ? '' : 'text-gray-800'}`}>
          {message.content}
        </p>

        {/* SQL 쿼리 (AI 응답일 때만) */}
        {!isUser && message.sql && (
          <div className="mt-4">
            <h4 className="text-sm font-medium text-gray-500 mb-2">실행된 SQL</h4>
            <pre className="code-block text-sm overflow-x-auto">
              {message.sql}
            </pre>
          </div>
        )}

        {/* 결과 테이블 (AI 응답일 때만) */}
        {!isUser && message.columns && message.rows && message.rows.length > 0 && (
          <div className="mt-4">
            <h4 className="text-sm font-medium text-gray-500 mb-2">
              결과 ({message.row_count}행)
            </h4>
            <div className="border rounded-lg overflow-hidden">
              <DataTable columns={message.columns} rows={message.rows} />
            </div>
          </div>
        )}

        {/* 타임스탬프 */}
        <p
          className={`text-xs mt-2 ${
            isUser ? 'text-blue-200' : 'text-gray-400'
          }`}
        >
          {message.timestamp.toLocaleTimeString('ko-KR')}
        </p>
      </div>
    </div>
  );
}
