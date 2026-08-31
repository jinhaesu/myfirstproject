'use client';

import { useMemo, useState } from 'react';
import type { WorkOrder } from '@/lib/mes/api';
import { C, ProgressBar, StatusPill, WO_STATUS, EmptyState, fmt, hhmm } from '@/lib/mes/ui';
import { PRIORITY_COLOR } from './types';

type SortKey = 'order_date' | 'wo_no' | 'item_name' | 'plan_qty' | 'prod_qty' | 'good_qty' | 'defect_qty' | 'progress_pct' | 'priority' | 'start_at' | 'end_at';

function initials(name: string): string {
  const t = (name || '').trim();
  if (!t) return '?';
  return t.slice(0, 2);
}

export function ListView({ orders, onSelect, selected, onToggleSelect, onToggleAll }: {
  orders: WorkOrder[];
  onSelect: (id: number) => void;
  selected: Set<number>;
  onToggleSelect: (id: number) => void;
  onToggleAll: (ids: number[]) => void;
}) {
  const [sortKey, setSortKey] = useState<SortKey>('order_date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const sorted = useMemo(() => {
    const arr = [...orders];
    arr.sort((a, b) => {
      const av = a[sortKey as keyof WorkOrder] as any;
      const bv = b[sortKey as keyof WorkOrder] as any;
      if (av === bv) return 0;
      if (av === undefined || av === null) return 1;
      if (bv === undefined || bv === null) return -1;
      const cmp = av > bv ? 1 : -1;
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [orders, sortKey, sortDir]);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(k); setSortDir('asc'); }
  };

  if (orders.length === 0) return <EmptyState title="작업지시가 없습니다" sub="조회 조건을 변경하거나 새 작업지시를 등록해보세요" />;

  const allChecked = orders.length > 0 && orders.every((o) => selected.has(o.id));

  const Th = ({ k, children, num }: { k: SortKey; children: React.ReactNode; num?: boolean }) => (
    <th className={`${C.th} ${num ? 'text-right' : ''} cursor-pointer select-none hover:text-text-secondary`} onClick={() => toggleSort(k)}>
      <span className="inline-flex items-center gap-1">{children}{sortKey === k && <span className="text-accent">{sortDir === 'asc' ? '▲' : '▼'}</span>}</span>
    </th>
  );

  return (
    <div className={`${C.card} overflow-x-auto`}>
      <table className="w-full border-collapse min-w-[1300px]">
        <thead>
          <tr>
            <th className={C.th}><input type="checkbox" checked={allChecked} onChange={() => onToggleAll(orders.map((o) => o.id))} /></th>
            <Th k="wo_no">지시번호</Th>
            <Th k="order_date">지시일</Th>
            <Th k="item_name">품명</Th>
            <th className={C.th}>공정</th>
            <th className={C.th}>설비</th>
            <Th k="plan_qty" num>계획</Th>
            <Th k="prod_qty" num>생산</Th>
            <Th k="good_qty" num>양품</Th>
            <Th k="defect_qty" num>불량</Th>
            <Th k="progress_pct">진행률</Th>
            <Th k="priority">우선순위</Th>
            <th className={C.th}>상태</th>
            <th className={C.th}>작업자</th>
            <Th k="start_at">시작</Th>
            <Th k="end_at">종료</Th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((o) => {
            const defectRate = o.prod_qty ? ((o.defect_qty || 0) / o.prod_qty) * 100 : 0;
            return (
              <tr key={o.id} className="hover:bg-bg-inset/60 cursor-pointer" onClick={() => onSelect(o.id)}>
                <td className={C.td} onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" checked={selected.has(o.id)} onChange={() => onToggleSelect(o.id)} />
                </td>
                <td className={`${C.td} font-semibold text-text-primary`}>{o.wo_no}</td>
                <td className={C.td}>{o.order_date}</td>
                <td className={C.td}>
                  <div className="flex items-center gap-1.5">
                    <span className="text-text-primary">{o.item_name}</span>
                    {o.family_code && <span className="text-[10px] px-1.5 py-0.5 rounded bg-bg-inset text-text-tertiary whitespace-nowrap">{o.family_code}</span>}
                  </div>
                </td>
                <td className={C.td}>{o.process_name || '-'}</td>
                <td className={C.td}>{o.equipment_name || '미배정'}</td>
                <td className={C.tdNum}>{fmt(o.plan_qty)}</td>
                <td className={C.tdNum}>{fmt(o.prod_qty)}</td>
                <td className={C.tdNum}>{fmt(o.good_qty)}</td>
                <td className={`${C.tdNum} ${defectRate > 5 ? 'text-danger' : ''}`}>{fmt(o.defect_qty)}</td>
                <td className={C.td}>
                  <div className="flex items-center gap-2 min-w-[110px]">
                    <ProgressBar value={o.progress_pct || 0} tone={o.status === 'done' ? 'success' : o.status === 'paused' ? 'warning' : 'brand'} />
                    <span className="text-xs tabular-nums text-text-tertiary w-9 text-right">{fmt(o.progress_pct)}%</span>
                  </div>
                </td>
                <td className={C.td}>
                  <span className="inline-flex items-center gap-1"><span className={`w-2 h-2 rounded-full ${PRIORITY_COLOR[o.priority] || 'bg-text-quaternary'}`} />{o.priority}</span>
                </td>
                <td className={C.td}><StatusPill status={o.status} map={WO_STATUS} /></td>
                <td className={C.td}>
                  <div className="flex -space-x-1.5">
                    {(o.workers || []).slice(0, 4).map((w) => (
                      <span key={w.id} title={w.name} className="w-6 h-6 rounded-full bg-brand/20 text-accent text-[10px] font-bold flex items-center justify-center border border-bg-1">{initials(w.name)}</span>
                    ))}
                    {(o.workers || []).length > 4 && <span className="w-6 h-6 rounded-full bg-bg-inset text-text-tertiary text-[10px] font-bold flex items-center justify-center border border-bg-1">+{(o.workers || []).length - 4}</span>}
                  </div>
                </td>
                <td className={C.td}>{hhmm(o.start_at)}</td>
                <td className={C.td}>{hhmm(o.end_at)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
