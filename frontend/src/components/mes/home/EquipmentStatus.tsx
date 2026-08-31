'use client';

import { EmptyState, Pill, SectionTitle } from '@/lib/mes/ui';
import type { DashboardResp, EquipmentStatusItem } from './types';

const STATE_LABEL: Record<string, string> = { running: '가동중', idle: '대기', down: '고장', off: '미사용' };

/** 설비 상태 요약 + 설비 칩 목록 */
export function EquipmentStatus({ summary, items }: { summary: DashboardResp['equipment'] | null; items: EquipmentStatusItem[] }) {
  return (
    <div className="bg-bg-1 border border-border-primary rounded-xl p-4">
      <SectionTitle right={summary && (
        <div className="flex gap-1.5">
          <Pill tone="success" size="sm">가동 {summary.running}</Pill>
          <Pill tone="muted" size="sm">대기 {summary.idle}</Pill>
          <Pill tone="danger" size="sm">고장 {summary.down}</Pill>
        </div>
      )}>설비 상태</SectionTitle>
      {items.length === 0 ? <EmptyState title="설비 데이터가 없습니다" /> : (
        <div className="flex flex-wrap gap-2 max-h-56 overflow-y-auto">
          {items.map((it) => (
            <span key={it.equipment.id} className="inline-flex items-center gap-1.5 rounded-full border border-border-primary bg-bg-0 px-2.5 py-1.5 text-xs">
              <span className={`w-2 h-2 rounded-full ${it.state === 'running' ? 'bg-success animate-pulse' : it.state === 'down' ? 'bg-danger' : 'bg-text-quaternary'}`} />
              <span className="font-semibold text-text-primary">{it.equipment.name}</span>
              <span className="text-text-tertiary">{STATE_LABEL[it.state] || it.state}</span>
              {it.open_events > 0 && <span className="text-danger font-bold">이벤트{it.open_events}</span>}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
