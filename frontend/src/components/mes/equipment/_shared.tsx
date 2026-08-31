'use client';

import type { Tone } from '@/lib/mes/ui';

export const EVENT_TYPES = ['고장', '수리', '부품교체', '점검', '청소소독'];
export const EVENT_TONE: Record<string, Tone> = {
  고장: 'danger', 수리: 'warning', 부품교체: 'info', 점검: 'success', 청소소독: 'muted',
};
export const STATE_LABEL: Record<string, string> = { running: '가동중', idle: '대기', down: '고장', off: '미사용' };
export const STATE_TONE: Record<string, Tone> = { running: 'brand', idle: 'muted', down: 'danger', off: 'muted' };
