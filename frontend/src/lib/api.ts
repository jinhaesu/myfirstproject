import type { TableInfo, TableSchema, ChatRequest, ChatResponse } from '@/types';

const API_BASE = '/api';
const BACKEND_DIRECT = process.env.NEXT_PUBLIC_API_URL || '';

function getAuthHeaders(): HeadersInit {
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

async function fetchAPI<T>(
  endpoint: string,
  options?: RequestInit
): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 300000);

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${endpoint}`, {
      headers: getAuthHeaders(),
      signal: controller.signal,
      ...options,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('요청 시간이 초과되었습니다. 다시 시도해주세요.');
    }
    throw new Error('서버에 연결할 수 없습니다. 네트워크를 확인해주세요.');
  }
  clearTimeout(timeoutId);

  if (!response.ok) {
    if (response.status === 401) {
      if (typeof window !== 'undefined') {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.href = '/login';
      }
    }
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || `API Error: ${response.status}`);
  }

  return response.json();
}

/**
 * Vercel 프록시를 우회하여 백엔드에 직접 요청 (타임아웃 없는 긴 요청용)
 */
async function fetchBackendDirect<T>(
  endpoint: string,
  options?: RequestInit
): Promise<T> {
  const baseUrl = BACKEND_DIRECT || API_BASE;
  const url = BACKEND_DIRECT ? `${baseUrl}/api${endpoint}` : `${API_BASE}${endpoint}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 300000);

  let response: Response;
  try {
    response = await fetch(url, {
      headers: getAuthHeaders(),
      signal: controller.signal,
      ...options,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('요청 시간이 초과되었습니다. 다시 시도해주세요.');
    }
    throw new Error('서버에 연결할 수 없습니다. 네트워크를 확인해주세요.');
  }
  clearTimeout(timeoutId);

  if (!response.ok) {
    if (response.status === 401) {
      if (typeof window !== 'undefined') {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.href = '/login';
      }
    }
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

  // 채팅 (자연어 질문) — 백엔드 직접 호출로 Vercel 프록시 타임아웃 우회
  chat: (request: ChatRequest): Promise<ChatResponse> => {
    return fetchBackendDirect<ChatResponse>('/chat', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  },

  // 전사 통합 AI 비서 (Opus 5.0) — 매출·구매/원가·생산·물류·재고 전체
  chatOmni: (request: ChatRequest): Promise<ChatResponse> => {
    return fetchBackendDirect<ChatResponse>('/chat/omni', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  },
};
