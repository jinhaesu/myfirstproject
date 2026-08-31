'use client';

import { useEffect, useState } from 'react';
import { mesGet, mesSend, type ProcessRun, type EquipmentEvent } from '@/lib/mes/api';
import { C, Drawer, Pill, JudgePill, ConfirmButton, EmptyState, won, hhmm } from '@/lib/mes/ui';
import type { EquipStatusRow } from './types';
import { EVENT_TONE, STATE_LABEL, STATE_TONE } from './_shared';

export default function EquipmentDrawer({
  row, date, onClose, onOpenEventModal, reloadKey,
}: {
  row: EquipStatusRow | null; date: string; onClose: () => void; onOpenEventModal: (equipmentId: number) => void; reloadKey: number;
}) {
  const [runs, setRuns] = useState<ProcessRun[]>([]);
  const [events, setEvents] = useState<EquipmentEvent[]>([]);
  const [loading, setLoading] = useState(false);

  const equipmentId = row?.equipment.id ?? null;

  useEffect(() => {
    if (!equipmentId) return;
    setLoading(true);
    Promise.all([
      mesGet<{ items: ProcessRun[] }>(`/runs?date=${date}&equipment_id=${equipmentId}`, { items: [] }),
      mesGet<{ items: EquipmentEvent[] }>(`/equipment-events?equipment_id=${equipmentId}`, { items: [] }),
    ]).then(([r, e]) => {
      setRuns(r.items || []);
      setEvents((e.items || []).sort((a, b) => (a.event_date < b.event_date ? 1 : -1)));
      setLoading(false);
    });
  }, [equipmentId, date, reloadKey]);

  const closeEvent = async (id: number) => {
    await mesSend(`/equipment-events/${id}/close`, 'POST');
    if (equipmentId) {
      const e = await mesGet<{ items: EquipmentEvent[] }>(`/equipment-events?equipment_id=${equipmentId}`, { items: [] });
      setEvents((e.items || []).sort((a, b) => (a.event_date < b.event_date ? 1 : -1)));
    }
  };
  const deleteEvent = async (id: number) => {
    await mesSend(`/equipment-events/${id}`, 'DELETE');
    if (equipmentId) {
      const e = await mesGet<{ items: EquipmentEvent[] }>(`/equipment-events?equipment_id=${equipmentId}`, { items: [] });
      setEvents((e.items || []).sort((a, b) => (a.event_date < b.event_date ? 1 : -1)));
    }
  };

  if (!row) return null;
  const eq = row.equipment;

  return (
    <Drawer open={!!row} onClose={onClose} title={eq.name}>
      <div className="flex items-center gap-2 mb-4">
        <Pill tone={STATE_TONE[row.state] || 'muted'}>{STATE_LABEL[row.state] || row.state}</Pill>
        <span className="text-xs text-text-tertiary">{eq.code} · {eq.floor || '-'} · {eq.process_name || '공정 미지정'}</span>
      </div>

      <div className={`${C.cardPad} mb-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm`}>
        <div><span className="text-text-tertiary">메이커</span> <span className="text-text-primary">{eq.maker || '-'}</span></div>
        <div><span className="text-text-tertiary">모델</span> <span className="text-text-primary">{eq.model || '-'}</span></div>
        <div><span className="text-text-tertiary">규격</span> <span className="text-text-primary">{eq.spec || '-'}</span></div>
        <div><span className="text-text-tertiary">PLC</span> <span className="text-text-primary">{eq.plc_yn ? '사용' : '미사용'}</span></div>
        <div><span className="text-text-tertiary">구매일</span> <span className="text-text-primary">{eq.purchase_date || '-'}</span></div>
        <div><span className="text-text-tertiary">구매금액</span> <span className="text-text-primary">{eq.purchase_amount != null ? won(eq.purchase_amount) : '-'}</span></div>
      </div>

      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-bold text-text-primary">오늘 실행 ({date})</div>
      </div>
      <div className={`${C.card} overflow-x-auto mb-5`}>
        <table className="w-full">
          <thead><tr><th className={C.th}>시작</th><th className={C.th}>종료</th><th className={C.th}>품명</th><th className={C.th}>측정값</th><th className={C.th}>판정</th></tr></thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id}>
                <td className={C.td}>{hhmm(r.start_at)}</td>
                <td className={C.td}>{hhmm(r.end_at)}</td>
                <td className={C.td}>{r.item_name || '-'}</td>
                <td className={C.td}>{r.measured_value ?? '-'}</td>
                <td className={C.td}><JudgePill j={r.judgment} size="sm" /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && runs.length === 0 && <EmptyState title="오늘 실행 이력이 없습니다" sub="" />}
      </div>

      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-bold text-text-primary">이력 타임라인</div>
        <button onClick={() => onOpenEventModal(eq.id)} className={`${C.btn} ${C.btnPrimary} px-2.5 py-1.5 text-xs`}>+ 이력 등록</button>
      </div>
      <div className="flex flex-col gap-3">
        {events.map((ev) => (
          <div key={ev.id} className="relative pl-4 border-l-2 border-border-primary">
            <div className="absolute -left-[5px] top-1 w-2 h-2 rounded-full bg-brand" />
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="text-xs font-semibold text-text-primary">{ev.event_date}</span>
              <Pill tone={EVENT_TONE[ev.event_type] || 'muted'}>{ev.event_type}</Pill>
              <Pill tone={ev.status === 'open' ? 'warning' : 'success'}>{ev.status === 'open' ? '진행중' : '마감'}</Pill>
            </div>
            {ev.description && <div className="text-sm text-text-secondary mb-1">{ev.description}</div>}
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-text-quaternary">
              {ev.part_name && <span>부품 {ev.part_name}</span>}
              {ev.cost != null && <span>비용 {won(ev.cost)}</span>}
              {ev.done_by && <span>담당 {ev.done_by}</span>}
              {ev.downtime_minutes != null && <span>정지 {ev.downtime_minutes}분</span>}
            </div>
            <div className="flex gap-1.5 mt-1.5">
              {ev.status === 'open' && <ConfirmButton onConfirm={() => closeEvent(ev.id)} className={`${C.btn} ${C.btnGhost} px-2 py-1 text-[11px]`}>마감</ConfirmButton>}
              <ConfirmButton onConfirm={() => deleteEvent(ev.id)} className={`${C.btn} ${C.btnGhost} px-2 py-1 text-[11px] text-danger`}>삭제</ConfirmButton>
            </div>
          </div>
        ))}
        {!loading && events.length === 0 && <EmptyState title="등록된 이력이 없습니다" sub="" />}
      </div>
    </Drawer>
  );
}
