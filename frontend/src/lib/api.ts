import type { TableInfo, TableSchema, ChatRequest, ChatResponse } from '@/types';

const API_BASE = '/api';

async function fetchAPI<T>(
  endpoint: string,
  options?: RequestInit
): Promise<T> {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    headers: {
      'Content-Type': 'application/json',
    },
    ...options,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || `API Error: ${response.status}`);
  }

  return response.json();
}

export const api = {
  // 테이블 목록 조회
  getTables: (datasetId?: string): Promise<TableInfo> => {
    const params = datasetId ? `?dataset_id=${datasetId}` : '';
    return fetchAPI<TableInfo>(`/tables${params}`);
  },

  // 테이블 스키마 조회
  getTableSchema: (tableId: string, datasetId?: string): Promise<TableSchema> => {
    const params = datasetId ? `?dataset_id=${datasetId}` : '';
    return fetchAPI<TableSchema>(`/tables/${tableId}/schema${params}`);
  },

  // 채팅 (자연어 질문)
  chat: (request: ChatRequest): Promise<ChatResponse> => {
    return fetchAPI<ChatResponse>('/chat', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  },
};
