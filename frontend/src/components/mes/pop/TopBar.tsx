'use client';

import { useEffect, useState } from 'react';
import { C } from '@/lib/mes/ui';

/** POP 상단 바 — 날짜 선택·새로고침 · 전체화면 토글 · 실시간 시계 */
export function TopBar({
  date, onDate, onRefresh, fullscreen, onToggleFullscreen,
}: {
  date: string;
  onDate: (d: string) => void;
  onRefresh: () => void;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
}) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const clock = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-bold text-text-primary whitespace-nowrap">POP 현장단말</h1>
        <input type="date" value={date} onChange={(e) => onDate(e.target.value)} className={`${C.input} min-h-[44px]`} />
        <button onClick={onRefresh} className={`${C.btn} ${C.btnGhost} min-h-[44px]`} title="새로고침">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
          새로고침
        </button>
      </div>
      <div className="flex items-center gap-3">
        <div className="text-2xl font-bold tabular-nums text-text-primary bg-bg-1 border border-border-primary rounded-xl px-4 py-1.5">{clock}</div>
        <button onClick={onToggleFullscreen} className={`${C.btn} ${fullscreen ? C.btnWarn : C.btnPrimary} min-h-[44px]`}>
          {fullscreen ? '전체화면 종료' : '전체화면'}
        </button>
      </div>
    </div>
  );
}
