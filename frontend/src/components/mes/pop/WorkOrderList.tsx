'use client';

import { C, StatusPill, WO_STATUS, ProgressBar, EmptyState, fmt, hhmm } from '@/lib/mes/ui';
import type { WorkOrder } from '@/lib/mes/api';

/** 오늘 작업지시 목록(포장·작업지시 탭) — 선택 시 상단 액션이 활성화됨 */
export function WorkOrderList({ rows, loading, selectedId, onSelect }: { rows: WorkOrder[]; loading: boolean; selectedId: number | null; onSelect: (id: number) => void }) {
  if (loading) return <div className="py-10 text-center text-text-tertiary text-sm">불러오는 중…</div>;
  if (rows.length === 0) return <EmptyState title="오늘 작업지시가 없습니다" sub="작업지시 화면에서 등록하세요" />;
  return (
    <div className="flex flex-col gap-2">
      {rows.map((wo) => {
        const sel = wo.id === selectedId;
        return (
          <button key={wo.id} onClick={() => onSelect(wo.id)}
            className={`text-left rounded-xl border-2 p-3.5 transition-colors ${sel ? 'border-brand bg-brand/5' : 'border-border-primary bg-bg-0 hover:border-border-secondary'}`}>
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-xs font-mono text-text-tertiary">{wo.wo_no}</span>
                <span className="text-base font-bold text-text-primary truncate">{wo.item_name}</span>
              </div>
              <StatusPill status={wo.status} map={WO_STATUS} size="md" />
            </div>
            <div className="flex items-center gap-3 text-xs text-text-tertiary mb-2">
              <span>{wo.equipment_name || '설비 미배정'}</span>
              <span>계획 {fmt(wo.plan_qty)}{wo.unit}</span>
              <span>생산 {fmt(wo.prod_qty)} / 양품 {fmt(wo.good_qty)} / 불량 {fmt(wo.defect_qty)}</span>
              {wo.start_at && <span>시작 {hhmm(wo.start_at)}</span>}
            </div>
            <ProgressBar value={(wo.progress_pct || 0) * (Math.abs(wo.progress_pct || 0) <= 1.5 ? 100 : 1)} tone={wo.status === 'done' ? 'success' : 'brand'} />
          </button>
        );
      })}
    </div>
  );
}
