'use client';

import { useState, useCallback } from 'react';
import { api } from '@/lib/api';
import { generateId } from '@/lib/utils';
import type { Message } from '@/types';

export function useChat(tableId: string, datasetId?: string) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendMessage = useCallback(
    async (question: string) => {
      if (!tableId || !question.trim()) return;

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
        const response = await api.chat({
          question,
          table_id: tableId,
          dataset_id: datasetId,
        });

        // AI 응답 추가
        const assistantMessage: Message = {
          id: generateId(),
          role: 'assistant',
          content: response.explanation,
          sql: response.sql,
          columns: response.columns,
          rows: response.rows,
          row_count: response.row_count,
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
          content: `오류: ${errorMessage}`,
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, errorMsg]);
      } finally {
        setIsLoading(false);
      }
    },
    [tableId, datasetId]
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
