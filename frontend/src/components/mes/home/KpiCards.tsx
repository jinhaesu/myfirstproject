'use client';

import { StatCard, fmt } from '@/lib/mes/ui';
import type { DashboardResp } from './types';

/** MES 홈 KPI 6종 */
export function KpiCards({ d }: { d: DashboardResp | null }) {
  const achievement = d ? d.orders.achievement * (Math.abs(d.orders.achievement) <= 1.5 ? 100 : 1) : 0;
  const ccpRate = d ? d.runs.pass_rate * (Math.abs(d.runs.pass_rate) <= 1.5 ? 100 : 1) : 0;
  const checklistRate = d ? d.checklists.rate * (Math.abs(d.checklists.rate) <= 1.5 ? 100 : 1) : 0;
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-5">
      <StatCard label="오늘 작업지시" value={d ? fmt(d.orders.total) : '-'} sub={d ? `계획 ${fmt(d.orders.plan_qty)}` : undefined} />
      <StatCard label="진행중" value={d ? fmt(d.orders.in_progress) : '-'} tone="text-brand" />
      <StatCard label="완료·달성률" value={d ? `${fmt(d.orders.done)}건` : '-'} sub={d ? `달성률 ${achievement.toFixed(1)}%` : undefined} tone="text-success" />
      <StatCard label="CCP 적합률" value={d ? `${ccpRate.toFixed(1)}%` : '-'} sub={d ? `${fmt(d.runs.pass)}/${fmt(d.runs.total)}건` : undefined} tone={ccpRate >= 95 ? 'text-success' : ccpRate >= 80 ? 'text-warning' : 'text-danger'} />
      <StatCard label="미조치 이탈" value={d ? fmt(d.deviations_open) : '-'} tone={d && d.deviations_open > 0 ? 'text-danger' : 'text-success'} />
      <StatCard label="선행점검 완료율" value={d ? `${checklistRate.toFixed(1)}%` : '-'} sub={d ? `${fmt(d.checklists.done)}/${fmt(d.checklists.due)}건` : undefined} />
    </div>
  );
}
