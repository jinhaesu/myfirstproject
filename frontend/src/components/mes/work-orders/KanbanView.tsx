'use client';

import type { WorkOrder } from '@/lib/mes/api';
import { C, ProgressBar, Pill, WO_STATUS, fmt } from '@/lib/mes/ui';
import { PRIORITY_COLOR, STATUS_ORDER, type WoAction } from './types';

const NEXT_ACTION: Partial<Record<WorkOrder['status'], { action: WoAction; label: string; tone: string }[]>> = {
  released: [{ action: 'start', label: '시작', tone: `${C.btn} ${C.btnPrimary}` }, { action: 'cancel', label: '취소', tone: `${C.btn} ${C.btnGhost}` }],
  in_progress: [{ action: 'pause', label: '일시정지', tone: `${C.btn} ${C.btnWarn}` }, { action: 'finish', label: '종료', tone: `${C.btn} ${C.btnSuccess}` }],
  paused: [{ action: 'resume', label: '재개', tone: `${C.btn} ${C.btnPrimary}` }, { action: 'finish', label: '종료', tone: `${C.btn} ${C.btnSuccess}` }],
  planned: [{ action: 'cancel', label: '취소', tone: `${C.btn} ${C.btnGhost}` }],
};

export function KanbanView({ orders, onSelect, onAction }: {
  orders: WorkOrder[];
  onSelect: (id: number) => void;
  onAction: (id: number, action: WoAction) => void;
}) {
  const byStatus = (s: string) => orders.filter((o) => o.status === s);
  return (
    <div className="grid grid-cols-6 gap-3 overflow-x-auto">
      {STATUS_ORDER.map((s) => {
        const list = byStatus(s);
        const meta = WO_STATUS[s];
        return (
          <div key={s} className="min-w-[220px] flex flex-col">
            <div className="flex items-center justify-between mb-2 px-1">
              <Pill tone={meta.tone} size="sm">{meta.label}</Pill>
              <span className="text-xs text-text-tertiary tabular-nums">{list.length}건</span>
            </div>
            <div className="flex flex-col gap-2 min-h-[80px]">
              {list.map((o) => (
                <div key={o.id} className={`${C.card} p-3 cursor-pointer hover:border-brand transition-colors`} onClick={() => onSelect(o.id)}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] font-semibold text-text-tertiary">{o.wo_no}</span>
                    <span className="inline-flex items-center gap-1 text-[11px] text-text-tertiary"><span className={`w-1.5 h-1.5 rounded-full ${PRIORITY_COLOR[o.priority] || 'bg-text-quaternary'}`} />{o.priority}</span>
                  </div>
                  <div className="text-sm font-semibold text-text-primary truncate mb-0.5" title={o.item_name}>{o.item_name}</div>
                  <div className="text-xs text-text-tertiary mb-2 truncate">{o.equipment_name || '미배정'} · {fmt(o.plan_qty)}{o.unit}</div>
                  <ProgressBar value={o.progress_pct || 0} tone={o.status === 'done' ? 'success' : o.status === 'paused' ? 'warning' : 'brand'} height="h-1.5" />
                  {(NEXT_ACTION[o.status] || []).length > 0 && (
                    <div className="flex gap-1.5 mt-2" onClick={(e) => e.stopPropagation()}>
                      {(NEXT_ACTION[o.status] || []).map((a) => (
                        <button key={a.action} className={`${a.tone} !px-2 !py-1 text-xs flex-1`} onClick={() => onAction(o.id, a.action)}>{a.label}</button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {list.length === 0 && <div className="text-xs text-text-quaternary text-center py-4 border border-dashed border-border-primary rounded-lg">-</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
