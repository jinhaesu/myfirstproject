'use client';

import { useEffect, useRef } from 'react';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { useChat } from '@/hooks/useChat';

interface ChatContainerProps {
  tableId: string;
  datasetId?: string;
}

export function ChatContainer({ tableId, datasetId }: ChatContainerProps) {
  const { messages, isLoading, sendMessage, clearMessages } = useChat(tableId, datasetId);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 새 메시지가 추가되면 스크롤
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className="flex flex-col h-full bg-gray-50 rounded-lg shadow">
      {/* 헤더 */}
      <div className="flex items-center justify-between p-4 border-b bg-white rounded-t-lg">
        <div>
          <h2 className="text-lg font-semibold">데이터 분석 채팅</h2>
          <p className="text-sm text-gray-500">
            테이블: <span className="font-medium text-blue-600">{tableId}</span>
          </p>
        </div>
        {messages.length > 0 && (
          <button
            onClick={clearMessages}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            대화 초기화
          </button>
        )}
      </div>

      {/* 메시지 영역 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 ? (
          <div className="text-center text-gray-500 py-12">
            <p className="text-lg mb-2">데이터에 대해 질문하세요</p>
            <p className="text-sm">예: &quot;지난달 매출 상위 10개 제품은?&quot;</p>
            <p className="text-sm">&quot;카테고리별 평균 가격을 알려줘&quot;</p>
          </div>
        ) : (
          messages.map((msg) => <ChatMessage key={msg.id} message={msg} />)
        )}

        {/* 로딩 인디케이터 */}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
              <div className="flex items-center gap-2">
                <div className="animate-spin h-4 w-4 border-2 border-blue-600 border-t-transparent rounded-full" />
                <span className="text-gray-600">분석 중...</span>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* 입력 영역 */}
      <ChatInput
        onSend={sendMessage}
        disabled={isLoading || !tableId}
        placeholder={
          !tableId
            ? '먼저 테이블을 선택하세요'
            : '데이터에 대해 질문하세요...'
        }
      />
    </div>
  );
}
