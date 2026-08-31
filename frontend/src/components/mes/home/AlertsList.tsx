'use client';

import Link from 'next/link';
import { EmptyState, SectionTitle } from '@/lib/mes/ui';
import type { DashboardResp } from './types';

/** 알림 리스트 — level별 색, 클릭 시 href 이동 */
export function AlertsList({ alerts }: { alerts: DashboardResp['alerts'] }) {
  return (
    <div className="bg-bg-1 border border-border-primary rounded-xl p-4">
      <SectionTitle>알림</SectionTitle>
      {(!alerts || alerts.length === 0) ? (
        <EmptyState title="알림이 없습니다" sub="오늘은 조치가 필요한 항목이 없습니다" />
      ) : (
        <div className="flex flex-col gap-2">
          {alerts.map((a, i) => {
            const body = (
              <div className={`flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-sm font-semibold transition-colors ${a.level === 'danger' ? 'border-danger/30 bg-danger/10 text-danger hover:bg-danger/15' : 'border-warning/30 bg-warning/10 text-warning hover:bg-warning/15'}`}>
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${a.level === 'danger' ? 'bg-danger' : 'bg-warning'}`} />
                <span className="flex-1">{a.text}</span>
                {a.href && <span className="text-xs opacity-70">이동 →</span>}
              </div>
            );
            return a.href ? <Link key={i} href={a.href}>{body}</Link> : <div key={i}>{body}</div>;
          })}
        </div>
      )}
    </div>
  );
}
