'use client';

import { useMemo } from 'react';
import { C, EmptyState, WO_STATUS, fmt, hhmm } from '@/lib/mes/ui';
import type { TimelineEquipment } from './types';

const START_MIN = 6 * 60; // 06:00
const END_MIN = 24 * 60; // 24:00
const SPAN = END_MIN - START_MIN;
const HOURS = Array.from({ length: 19 }, (_, i) => 6 + i); // 06..24

function minutesOf(iso: string): number {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}
function pct(min: number): number {
  return Math.max(0, Math.min(100, ((min - START_MIN) / SPAN) * 100));
}

const STATUS_BAR: Record<string, string> = {
  planned: 'bg-text-quaternary/60', released: 'bg-info/70', in_progress: 'bg-brand', paused: 'bg-warning', done: 'bg-success', cancelled: 'bg-danger/60',
};

export function TimelineView({ equipment, date, onSelect }: { equipment: TimelineEquipment[]; date: string; onSelect: (id: number) => void }) {
  const isToday = date === new Date().toISOString().slice(0, 10);
  const nowPct = useMemo(() => {
    const now = new Date();
    return pct(now.getHours() * 60 + now.getMinutes());
  }, []);

  const groups = useMemo(() => {
    const m = new Map<string, TimelineEquipment[]>();
    for (const eq of equipment) {
      const key = eq.id === 0 ? '미배정' : (eq.floor || '기타');
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(eq);
    }
    const order = ['1F', '2F', '3F', '기타', '미배정'];
    return Array.from(m.entries()).sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
  }, [equipment]);

  if (equipment.length === 0) return <EmptyState title="설비 타임라인 데이터가 없습니다" sub="날짜를 변경해보세요" />;

  return (
    <div className={`${C.card} overflow-x-auto`}>
      <div className="min-w-[1100px]">
        {/* 시간축 헤더 */}
        <div className="flex sticky top-0 z-10 bg-bg-1 border-b border-border-primary">
          <div className="w-40 shrink-0 px-3 py-2 text-xs font-semibold text-text-tertiary">설비</div>
          <div className="flex-1 relative h-8">
            {HOURS.map((h) => (
              <div key={h} className="absolute top-0 h-full text-[10px] text-text-quaternary border-l border-border-primary px-1" style={{ left: `${pct(h * 60)}%` }}>{h}</div>
            ))}
          </div>
        </div>
        {groups.map(([floor, eqs]) => (
          <div key={floor}>
            <div className="px-3 py-1 text-[11px] font-bold text-text-tertiary bg-bg-inset/50">{floor}</div>
            {eqs.map((eq) => (
              <div key={eq.id} className="flex border-b border-bg-inset">
                <div className="w-40 shrink-0 px-3 py-2 text-xs text-text-secondary truncate flex items-center">{eq.name}</div>
                <div className="flex-1 relative h-12">
                  {HOURS.map((h) => <div key={h} className="absolute top-0 h-full border-l border-bg-inset" style={{ left: `${pct(h * 60)}%` }} />)}
                  {isToday && <div className="absolute top-0 h-full border-l-2 border-danger z-10" style={{ left: `${nowPct}%` }} />}
                  {eq.orders.map((o) => {
                    const unstarted = !o.start_at;
                    let left: number, width: number;
                    if (unstarted) {
                      left = pct(9 * 60);
                      width = pct(10 * 60) - pct(9 * 60);
                    } else {
                      const s = minutesOf(o.start_at!);
                      const e = o.end_at ? minutesOf(o.end_at) : (isToday ? new Date().getHours() * 60 + new Date().getMinutes() : s + 60);
                      left = pct(s);
                      width = Math.max(pct(e) - pct(s), 0.8);
                    }
                    return (
                      <button
                        key={o.id}
                        onClick={() => onSelect(o.id)}
                        title={`${o.wo_no} ${o.item_name} ${fmt(o.plan_qty)} (${o.progress_pct ?? 0}%)`}
                        className={`absolute top-1.5 h-9 rounded-md text-left px-1.5 overflow-hidden text-[10px] font-semibold text-white/90 hover:ring-2 hover:ring-white/50 transition-all ${unstarted ? 'border-2 border-dashed border-text-quaternary bg-bg-inset text-text-tertiary' : STATUS_BAR[o.status] || 'bg-text-quaternary'}`}
                        style={{ left: `${left}%`, width: `${width}%` }}
                      >
                        {!unstarted && (
                          <div className="absolute inset-y-0 left-0 bg-black/25" style={{ width: `${o.progress_pct ?? 0}%` }} />
                        )}
                        <span className="relative whitespace-nowrap">{unstarted ? `미시작 · ${o.wo_no}` : `${o.wo_no}`}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3 px-3 py-2 text-[11px] text-text-tertiary flex-wrap">
        {Object.entries(WO_STATUS).map(([k, v]) => (
          <span key={k} className="inline-flex items-center gap-1"><span className={`w-2.5 h-2.5 rounded ${STATUS_BAR[k]}`} />{v.label}</span>
        ))}
        <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded border-2 border-dashed border-text-quaternary" />미시작(계획)</span>
      </div>
    </div>
  );
}
