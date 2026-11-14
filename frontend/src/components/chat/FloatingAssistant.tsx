'use client';

import { useEffect, useRef, useState } from 'react';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { useChat } from '@/hooks/useChat';
import { useAuth } from '@/contexts/AuthContext';
import { ChatIcon, TrashIcon, XIcon } from '@/components/nd/icons';

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
  const { messages, isLoading, error, sendMessage, clearMessages } = useChat({ omni: true });
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, open, isLoading]);

  if (!user) return null; // 로그인 사용자에게만 노출
  // 안내 말풍선은 채팅이 닫혀 있는 동안 상시 노출 (자동 사라짐 없음)
  const showBubble = !open;

  return (
    <>
      {/* 플로팅 버튼 + 기본 안내 말풍선 */}
      {!open && (
        <div className="fixed bottom-6 right-6 z-[60] flex items-end gap-2.5">
          {showBubble && (
            <div className="relative mb-1 max-w-[260px]">
              <button
                onClick={() => setOpen(true)}
                className="block text-left rounded-2xl rounded-br-sm bg-bg-1 border border-border-primary shadow-nd-f px-3.5 py-2.5 hover:border-border-secondary transition-colors"
              >
                <p className="text-[13px] leading-snug text-text-secondary">매출·구매·재고 데이터를 묶어서 물어볼 수 있습니다.</p>
              </button>
              {/* 꼬리 */}
              <div className="absolute -bottom-1.5 right-3 w-3 h-3 bg-bg-1 border-b border-r border-border-primary rotate-45 pointer-events-none" />
            </div>
          )}
          <button
            onClick={() => setOpen(true)}
            aria-label="전사 AI 비서 열기"
            className="nd-press relative w-12 h-12 rounded-full bg-bg-1 border border-border-secondary text-text-secondary hover:text-text-primary hover:bg-bg-secondary shadow-nd-f flex items-center justify-center shrink-0"
          >
            <ChatIcon className="w-5 h-5" />
          </button>
        </div>
      )}

      {/* 채팅 패널 */}
      {open && (
        <div className="fixed bottom-6 right-6 z-[60] w-[min(440px,calc(100vw-2rem))] h-[min(680px,calc(100vh-3rem))] flex flex-col bg-bg-1 border border-border-primary rounded-2xl shadow-nd-f overflow-hidden">
          {/* 헤더 */}
          <div className="flex items-center justify-between p-3.5 border-b border-border-primary bg-bg-0">
            <div className="flex items-center gap-2.5">
              <div>
                <h2 className="text-sm font-medium text-text-primary">전사 AI 비서</h2>
                <p className="text-[10px] text-text-tertiary">매출·구매·물류·생산·재고 통합 · Opus 5.0</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {messages.length > 0 && (
                <button onClick={clearMessages} title="초기화" className="p-2 text-text-tertiary hover:text-danger hover:bg-danger/10 rounded-lg transition-colors">
                  <TrashIcon className="w-4 h-4" />
                </button>
              )}
              <button onClick={() => setOpen(false)} title="닫기" className="p-2 text-text-tertiary hover:text-text-primary hover:bg-bg-inset rounded-lg transition-colors">
                <XIcon className="w-4 h-4" />
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
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/icons3d/empty.png" alt="" width={72} height={72} className="nd-icon3d w-[72px] h-[72px] mb-3" />
                <h3 className="text-sm font-medium text-text-primary mb-1.5">질문을 입력하세요</h3>
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
                      <div className="w-2 h-2 bg-brand rounded-full animate-pulse" style={{ animationDelay: '0ms' }} />
                      <div className="w-2 h-2 bg-brand rounded-full animate-pulse" style={{ animationDelay: '150ms' }} />
                      <div className="w-2 h-2 bg-brand rounded-full animate-pulse" style={{ animationDelay: '300ms' }} />
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
