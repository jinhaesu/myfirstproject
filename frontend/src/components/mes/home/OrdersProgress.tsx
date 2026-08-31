'use client';

import { SectionTitle } from '@/lib/mes/ui';
import type { DashboardResp } from './types';

/** 작업지시 진행 바 — planned/in_progress/done 스택 바 */
export function OrdersProgress({ orders }: { orders: DashboardResp['orders'] | null }) {
  const total = orders ? Math.max(1, orders.total) : 1;
  const segs = orders ? [
    { label: '계획', value: orders.planned, cls: 'bg-bg-inset' },
    { label: '진행중', value: orders.in_progress, cls: 'bg-brand' },
    { label: '완료', value: orders.done, cls: 'bg-success' },
    { label: '취소', value: orders.cancelled, cls: 'bg-danger/50' },
  ] : [];
  return (
    <div className="bg-bg-1 border border-border-primary rounded-xl p-4">
      <SectionTitle>작업지시 진행 현황</SectionTitle>
      <div className="w-full h-6 rounded-full overflow-hidden flex bg-bg-inset">
        {segs.map((s) => s.value > 0 && (
          <div key={s.label} className={s.cls} style={{ width: `${(s.value / total) * 100}%` }} title={`${s.label} ${s.value}`} />
        ))}
      </div>
      <div className="flex flex-wrap gap-4 mt-3 text-xs text-text-secondary">
        {segs.map((s) => (
          <span key={s.label} className="inline-flex items-center gap-1.5"><span className={`w-2.5 h-2.5 rounded-full ${s.cls}`} />{s.label} {s.value}</span>
        ))}
      </div>
    </div>
  );
}
