import type { TableInfo, TableSchema, ChatRequest, ChatResponse } from '@/types';

const API_BASE = '/api';

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
  const timeoutId = setTimeout(() => controller.abort(), 120000);

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
    // 401 에러시 로그아웃 처리
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

  // 채팅 (자연어 질문)
  chat: (request: ChatRequest): Promise<ChatResponse> => {
    return fetchAPI<ChatResponse>('/chat', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  },
};

// ═══ Analytics (성과 대시보드) API ═══
export const analyticsApi = {
  // 계정 개요
  getAccountOverview: (datePreset = 'last_7d') =>
    fetchAPI<{ overview: Record<string, unknown>; campaigns: unknown[] }>(
      `/analytics/account-overview?date_preset=${datePreset}`
    ),

  // 자동 관리 룰
  getRules: () => fetchAPI<unknown[]>('/analytics/rules'),
  createRule: (data: Record<string, unknown>) =>
    fetchAPI<unknown>('/analytics/rules', { method: 'POST', body: JSON.stringify(data) }),
  updateRule: (id: string, data: Record<string, unknown>) =>
    fetchAPI<unknown>(`/analytics/rules/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteRule: (id: string) =>
    fetchAPI<unknown>(`/analytics/rules/${id}`, { method: 'DELETE' }),
  executeRules: () =>
    fetchAPI<{ executed: number; logs: unknown[] }>('/analytics/rules/execute', { method: 'POST' }),
  getRuleLogs: (limit = 50) =>
    fetchAPI<unknown[]>(`/analytics/rules/logs?limit=${limit}`),
  aiRecommendRules: (overview: Record<string, unknown>, campaigns: unknown[]) =>
    fetchAPI<{ recommendations: unknown[] }>('/analytics/rules/ai-recommend', {
      method: 'POST',
      body: JSON.stringify({ overview, campaigns }),
    }),

  // 스케줄 리포트
  getSchedules: () => fetchAPI<unknown[]>('/analytics/schedules'),
  createSchedule: (data: Record<string, unknown>) =>
    fetchAPI<unknown>('/analytics/schedules', { method: 'POST', body: JSON.stringify(data) }),
  updateSchedule: (id: string, data: Record<string, unknown>) =>
    fetchAPI<unknown>(`/analytics/schedules/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteSchedule: (id: string) =>
    fetchAPI<unknown>(`/analytics/schedules/${id}`, { method: 'DELETE' }),
};

// ═══ Market Analysis (시장 분석) API ═══
export const marketAnalysisApi = {
  getKeywords: () => fetchAPI<unknown[]>('/market-analysis/keywords'),
  createKeyword: (data: { keyword: string; category?: string }) =>
    fetchAPI<unknown>('/market-analysis/keywords', { method: 'POST', body: JSON.stringify(data) }),
  updateKeyword: (id: string, data: Record<string, unknown>) =>
    fetchAPI<unknown>(`/market-analysis/keywords/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteKeyword: (id: string) =>
    fetchAPI<unknown>(`/market-analysis/keywords/${id}`, { method: 'DELETE' }),
  collectMetrics: (id: string) =>
    fetchAPI<unknown>(`/market-analysis/keywords/${id}/collect`, { method: 'POST' }),
  getMetrics: (id: string, platform?: string, days = 30) => {
    const params = new URLSearchParams({ days: String(days) });
    if (platform) params.set('platform', platform);
    return fetchAPI<unknown[]>(`/market-analysis/keywords/${id}/metrics?${params}`);
  },
  getSentiment: (id: string, platform?: string, days = 30) => {
    const params = new URLSearchParams({ days: String(days) });
    if (platform) params.set('platform', platform);
    return fetchAPI<unknown[]>(`/market-analysis/keywords/${id}/sentiment?${params}`);
  },
  compare: (keywordIds: string[], platform?: string, days = 30) => {
    const params = new URLSearchParams({ keyword_ids: keywordIds.join(','), days: String(days) });
    if (platform) params.set('platform', platform);
    return fetchAPI<unknown>(`/market-analysis/compare?${params}`);
  },
};

// ═══ Campaign Planner (캠페인 기획) API ═══
export const campaignPlannerApi = {
  generatePlan: (data: Record<string, unknown>) =>
    fetchAPI<unknown>('/campaign-planner/generate-plan', {
      method: 'POST', body: JSON.stringify(data),
    }),
  generateCreative: (planId: string) =>
    fetchAPI<unknown>(`/campaign-planner/plans/${planId}/generate-creative`, { method: 'POST' }),
  createDraft: (planId: string) =>
    fetchAPI<unknown>(`/campaign-planner/plans/${planId}/create-draft`, { method: 'POST' }),
  getPlans: () => fetchAPI<unknown[]>('/campaign-planner/plans'),
  getPlan: (id: string) => fetchAPI<unknown>(`/campaign-planner/plans/${id}`),
  deletePlan: (id: string) =>
    fetchAPI<unknown>(`/campaign-planner/plans/${id}`, { method: 'DELETE' }),
};
