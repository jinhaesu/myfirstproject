'use client';

import { useEffect, useRef } from 'react';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { useChat } from '@/hooks/useChat';
import { ChatIcon, RobotIcon, TrashIcon, WarningCircleIcon } from '@/components/nd/icons';

export function ChatContainer() {
  const { messages, isLoading, error, sendMessage, clearMessages } = useChat();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 새 메시지가 추가되면 스크롤
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className="flex flex-col h-full bg-bg-1 rounded-2xl shadow-nd-f border border-border-primary overflow-hidden">
      {/* 헤더 */}
      <div className="flex items-center justify-between p-4 border-b border-border-primary bg-bg-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-bg-2 border border-border-primary rounded-full flex items-center justify-center">
            <ChatIcon className="w-5 h-5 text-text-secondary" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-text-primary">AI 분류</h2>
            <p className="text-xs text-text-tertiary">
              <span className="font-semibold text-link">채널별 매출 취합</span> 업로드 데이터 기반
            </p>
          </div>
        </div>
        {messages.length > 0 && (
          <button
            onClick={clearMessages}
            className="flex items-center gap-1 px-3 py-2 text-sm text-text-tertiary hover:text-danger hover:bg-danger/10 rounded-lg transition-colors"
          >
            <TrashIcon className="w-4 h-4" />
            초기화
          </button>
        )}
      </div>

      {/* 에러 배너 */}
      {error && (
        <div className="mx-4 mt-2 p-3 bg-danger/10 border border-danger/30 rounded-lg flex items-center gap-2 text-sm text-danger">
          <WarningCircleIcon className="w-4 h-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* 메시지 영역 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-bg-0">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-12">
            <div className="w-20 h-20 bg-brand/15 rounded-full flex items-center justify-center mb-6">
              <RobotIcon className="w-10 h-10 text-link" />
            </div>
            <h3 className="text-lg font-semibold text-text-secondary mb-2">매출 데이터에 대해 질문하세요</h3>
            <p className="text-sm text-text-tertiary mb-6">채널별 매출 취합에 업로드된 데이터를 AI가 분석해 답변합니다</p>
            <div className="space-y-2">
              <div className="px-4 py-2 bg-bg-1 rounded-full shadow-nd-s border border-border-primary text-sm text-text-tertiary">
                &quot;올해 채널별 매출 순위를 보여줘&quot;
              </div>
              <div className="px-4 py-2 bg-bg-1 rounded-full shadow-nd-s border border-border-primary text-sm text-text-tertiary">
                &quot;지난달 매출 상위 10개 품목은?&quot;
              </div>
              <div className="px-4 py-2 bg-bg-1 rounded-full shadow-nd-s border border-border-primary text-sm text-text-tertiary">
                &quot;담당자별 이번 달 매출을 알려줘&quot;
              </div>
            </div>
          </div>
        ) : (
          messages.map((msg) => <ChatMessage key={msg.id} message={msg} />)
        )}

        {/* 로딩 인디케이터 */}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-bg-1 border border-border-primary rounded-2xl p-4 shadow-nd-f">
              <div className="flex items-center gap-3">
                <div className="flex space-x-1">
                  <div className="w-2 h-2 bg-brand rounded-full animate-pulse" style={{ animationDelay: '0ms' }} />
                  <div className="w-2 h-2 bg-brand rounded-full animate-pulse" style={{ animationDelay: '150ms' }} />
                  <div className="w-2 h-2 bg-brand rounded-full animate-pulse" style={{ animationDelay: '300ms' }} />
                </div>
                <span className="text-sm text-text-tertiary font-medium">AI가 분석 중입니다...</span>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* 입력 영역 */}
      <ChatInput
        onSend={sendMessage}
        disabled={isLoading}
        placeholder="매출 데이터에 대해 질문하세요..."
      />
    </div>
  );
}
