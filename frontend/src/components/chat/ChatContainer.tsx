'use client';

import { useEffect, useRef } from 'react';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { useChat } from '@/hooks/useChat';

export function ChatContainer() {
  const { messages, isLoading, error, sendMessage, clearMessages } = useChat();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 새 메시지가 추가되면 스크롤
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className="flex flex-col h-full bg-[#0F1011] rounded-2xl shadow-[0px_7px_32px_rgba(0,0,0,0.35)] border border-[#23252A] overflow-hidden">
      {/* 헤더 */}
      <div className="flex items-center justify-between p-4 border-b border-[#23252A] bg-gradient-to-r from-[#08090A] to-[#08090A]">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-[#68CC58] to-[#27A644] rounded-full flex items-center justify-center shadow-[0px_3px_12px_rgba(0,0,0,0.2)]">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
          </div>
          <div>
            <h2 className="text-base font-bold text-[#F7F8F8]">AI 매출 분석</h2>
            <p className="text-xs text-[#8A8F98]">
              <span className="font-semibold text-[#7070FF]">채널별 매출 취합</span> 업로드 데이터 기반
            </p>
          </div>
        </div>
        {messages.length > 0 && (
          <button
            onClick={clearMessages}
            className="flex items-center gap-1 px-3 py-2 text-sm text-[#8A8F98] hover:text-[#EB5757] hover:bg-[#EB5757]/10 rounded-lg transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            초기화
          </button>
        )}
      </div>

      {/* 에러 배너 */}
      {error && (
        <div className="mx-4 mt-2 p-3 bg-[#EB5757]/10 border border-[#EB5757]/30 rounded-lg flex items-center gap-2 text-sm text-[#EB5757]">
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>{error}</span>
        </div>
      )}

      {/* 메시지 영역 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gradient-to-b from-[#08090A]/50 to-[#0F1011]">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-12">
            <div className="w-20 h-20 bg-gradient-to-br from-[#5E6AD2]/15 to-[#5E6AD2]/15 rounded-full flex items-center justify-center mb-6">
              <svg className="w-10 h-10 text-[#7070FF]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
            </div>
            <h3 className="text-lg font-bold text-[#D0D6E0] mb-2">매출 데이터에 대해 질문하세요</h3>
            <p className="text-sm text-[#8A8F98] mb-6">채널별 매출 취합에 업로드된 데이터를 AI가 분석해 답변합니다</p>
            <div className="space-y-2">
              <div className="px-4 py-2 bg-[#0F1011] rounded-full shadow-[0px_1px_3px_rgba(0,0,0,0.2)] border border-[#23252A] text-sm text-[#8A8F98]">
                &quot;올해 채널별 매출 순위를 보여줘&quot;
              </div>
              <div className="px-4 py-2 bg-[#0F1011] rounded-full shadow-[0px_1px_3px_rgba(0,0,0,0.2)] border border-[#23252A] text-sm text-[#8A8F98]">
                &quot;지난달 매출 상위 10개 품목은?&quot;
              </div>
              <div className="px-4 py-2 bg-[#0F1011] rounded-full shadow-[0px_1px_3px_rgba(0,0,0,0.2)] border border-[#23252A] text-sm text-[#8A8F98]">
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
            <div className="bg-[#0F1011] border border-[#23252A] rounded-2xl p-4 shadow-[0px_3px_12px_rgba(0,0,0,0.2)]">
              <div className="flex items-center gap-3">
                <div className="flex space-x-1">
                  <div className="w-2 h-2 bg-[#5E6AD2] rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <div className="w-2 h-2 bg-[#5E6AD2] rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <div className="w-2 h-2 bg-[#5E6AD2] rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
                <span className="text-sm text-[#8A8F98] font-medium">AI가 분석 중입니다...</span>
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
