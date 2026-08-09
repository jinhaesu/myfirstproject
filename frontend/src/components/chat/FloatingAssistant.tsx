'use client';

import { useEffect, useRef, useState } from 'react';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { useChat } from '@/hooks/useChat';
import { useAuth } from '@/contexts/AuthContext';

const SUGGESTIONS = [
  '이번 달 매출과 매입액을 비교해줘',
  '전분기 대비 이번 분기 생산량 추이는?',
  '채널별 공헌이익 상위 5개를 그래프로',
  '원재료 매입단가가 가장 많이 오른 품목은?',
];

/**
 * 전사 통합 AI 비서 — 우측 하단 플로팅 채팅.
 * 매출·구매/원가·물류·생산·재고 전체 데이터를 Opus 5.0으로 분석한다.
 * 그래프/CSV/Word 다운로드·긴 답변 접기열기는 ChatMessage에서 그대로 상속.
 */
export function FloatingAssistant() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [showBubble, setShowBubble] = useState(true);
  const { messages, isLoading, error, sendMessage, clearMessages } = useChat({ omni: true });
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, open, isLoading]);

  // 방문 시 기본 안내 말풍선 — 12초 후 자동 사라짐
  useEffect(() => {
    if (!showBubble) return;
    const t = setTimeout(() => setShowBubble(false), 12000);
    return () => clearTimeout(t);
  }, [showBubble]);

  if (!user) return null; // 로그인 사용자에게만 노출

  return (
    <>
      {/* 플로팅 버튼 + 기본 안내 말풍선 */}
      {!open && (
        <div className="fixed bottom-6 right-6 z-[60] flex items-end gap-2.5">
          {showBubble && (
            <div className="relative mb-1 max-w-[260px]">
              <div className="rounded-2xl rounded-br-sm bg-bg-1 border border-border-primary shadow-[0px_8px_28px_rgba(0,0,0,0.35)] px-3.5 py-2.5">
                <button onClick={() => setShowBubble(false)} className="absolute -top-2 -left-2 w-5 h-5 rounded-full bg-bg-inset border border-border-primary text-text-tertiary hover:text-text-primary flex items-center justify-center text-xs" aria-label="닫기">×</button>
                <p className="text-[13px] leading-snug text-text-secondary">AI에게 복합적으로 궁금한 <b className="text-text-primary">데이터 분석</b>을 물어보세요.</p>
              </div>
              {/* 꼬리 */}
              <div className="absolute -bottom-1.5 right-3 w-3 h-3 bg-bg-1 border-b border-r border-border-primary rotate-45" />
            </div>
          )}
          <button
            onClick={() => { setOpen(true); setShowBubble(false); }}
            aria-label="전사 AI 비서 열기"
            className="w-16 h-16 rounded-full bg-gradient-to-br from-brand to-brand-hover text-white shadow-[0px_8px_28px_rgba(0,0,0,0.4)] flex items-center justify-center hover:scale-105 active:scale-95 transition-transform shrink-0"
          >
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            <span className="absolute -top-1 -right-1 px-1.5 py-0.5 rounded-full bg-success text-[9px] font-bold text-white shadow">AI</span>
          </button>
        </div>
      )}

      {/* 채팅 패널 */}
      {open && (
        <div className="fixed bottom-6 right-6 z-[60] w-[min(440px,calc(100vw-2rem))] h-[min(680px,calc(100vh-3rem))] flex flex-col bg-bg-1 border border-border-primary rounded-2xl shadow-[0px_16px_48px_rgba(0,0,0,0.5)] overflow-hidden">
          {/* 헤더 */}
          <div className="flex items-center justify-between p-3.5 border-b border-border-primary bg-bg-0">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 bg-gradient-to-br from-brand to-brand-hover rounded-full flex items-center justify-center">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <div>
                <h2 className="text-sm font-bold text-text-primary">전사 AI 비서</h2>
                <p className="text-[10px] text-text-tertiary">매출·구매·물류·생산·재고 통합 · Opus 5.0</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {messages.length > 0 && (
                <button onClick={clearMessages} title="초기화" className="p-2 text-text-tertiary hover:text-danger hover:bg-danger/10 rounded-lg transition-colors">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              )}
              <button onClick={() => setOpen(false)} title="닫기" className="p-2 text-text-tertiary hover:text-text-primary hover:bg-bg-inset rounded-lg transition-colors">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* 에러 */}
          {error && (
            <div className="mx-3 mt-2 p-2.5 bg-danger/10 border border-danger/30 rounded-lg text-xs text-danger">{error}</div>
          )}

          {/* 메시지 */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center px-2">
                <div className="w-16 h-16 bg-brand/15 rounded-full flex items-center justify-center mb-4">
                  <svg className="w-8 h-8 text-link" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                </div>
                <h3 className="text-sm font-bold text-text-secondary mb-1.5">무엇이든 물어보세요</h3>
                <p className="text-xs text-text-tertiary mb-4">매출·구매·물류·생산·재고 데이터를 묶어 분석합니다</p>
                <div className="space-y-1.5 w-full">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => sendMessage(s)}
                      className="w-full text-left px-3 py-2 bg-bg-0 hover:bg-bg-inset border border-border-primary rounded-lg text-xs text-text-secondary transition-colors"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((msg) => <ChatMessage key={msg.id} message={msg} />)
            )}

            {isLoading && (
              <div className="flex justify-start">
                <div className="bg-bg-1 border border-border-primary rounded-2xl p-3">
                  <div className="flex items-center gap-2.5">
                    <div className="flex space-x-1">
                      <div className="w-2 h-2 bg-brand rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                      <div className="w-2 h-2 bg-brand rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                      <div className="w-2 h-2 bg-brand rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                    <span className="text-xs text-text-tertiary">전체 데이터를 분석 중입니다...</span>
                  </div>
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>

          <ChatInput onSend={sendMessage} disabled={isLoading} placeholder="전사 데이터에 대해 질문하세요..." />
        </div>
      )}
    </>
  );
}
