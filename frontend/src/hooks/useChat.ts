'use client';

import { useState, useCallback } from 'react';
import { api } from '@/lib/api';
import { generateId } from '@/lib/utils';
import type { Message } from '@/types';

export function useChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendMessage = useCallback(
    async (question: string) => {
      if (!question.trim()) return;

      setIsLoading(true);
      setError(null);

      // 사용자 메시지 추가
      const userMessage: Message = {
        id: generateId(),
        role: 'user',
        content: question,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, userMessage]);

      try {
        const response = await api.chat({ question });

        // 응답 유효성 검사
        const explanation = response.explanation || '결과를 가져왔습니다.';
        const columns = response.columns || [];
        const rows = response.rows || [];

        // AI 응답 추가
        const assistantMessage: Message = {
          id: generateId(),
          role: 'assistant',
          content: explanation,
          sql: response.sql,
          columns: columns,
          rows: rows,
          row_count: response.row_count ?? rows.length,
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, assistantMessage]);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : '오류가 발생했습니다';
        setError(errorMessage);

        // 에러 메시지 추가
        const errorMsg: Message = {
          id: generateId(),
          role: 'assistant',
          content: `죄송합니다. 요청 처리 중 문제가 발생했습니다.\n\n${errorMessage}\n\n다른 방식으로 질문을 시도해보세요.`,
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, errorMsg]);
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  return {
    messages,
    isLoading,
    error,
    sendMessage,
    clearMessages,
  };
}
