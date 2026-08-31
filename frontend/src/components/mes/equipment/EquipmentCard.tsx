'use client';

import { Pill } from '@/lib/mes/ui';
import type { EquipStatusRow } from './types';
import { STATE_LABEL, STATE_TONE } from './_shared';

export default function EquipmentCard({ row, onClick }: { row: EquipStatusRow; onClick: () => void }) {
  const runningItem = row.current_run?.item_name || row.current_order?.item_name;
  const isOff = row.state === 'off';
  return (
    <button
      onClick={onClick}
      className={`text-left rounded-xl border p-3 transition-colors hover:border-brand bg-bg-1 ${isOff ? 'border-dashed border-border-primary opacity-70' : 'border-border-primary'}`}
    >
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div className="min-w-0">
          <div className="text-sm font-bold text-text-primary truncate">{row.equipment.name}</div>
          <div className="text-[11px] text-text-quaternary truncate">{row.equipment.eq_type || '설비'} · {row.equipment.process_name || '공정 미지정'}</div>
        </div>
        <span className="inline-flex items-center gap-1 whitespace-nowrap">
          {row.state === 'running' && <span className="w-1.5 h-1.5 rounded-full bg-brand animate-pulse" />}
          <Pill tone={STATE_TONE[row.state] || 'muted'}>{STATE_LABEL[row.state] || row.state}</Pill>
        </span>
      </div>
      <div className="text-xs text-text-secondary truncate mb-1.5">{runningItem ? `진행: ${runningItem}` : '진행 품목 없음'}</div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-text-tertiary">
        <span>오늘 실행 {row.today_runs}건</span>
        {row.today_fail > 0 && <span className="text-danger font-semibold">부적합 {row.today_fail}</span>}
        {row.last_temp != null && <span className="tabular-nums">{row.last_temp}℃</span>}
        {row.open_events > 0 && <span className="text-warning font-semibold">미결이벤트 {row.open_events}</span>}
      </div>
    </button>
  );
}
