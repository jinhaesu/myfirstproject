'use client';

import { useEffect, useMemo, useState } from 'react';
import { mesGet, type EquipmentEvent } from '@/lib/mes/api';
import { C, PeriodBar, Pill, EmptyState, downloadCSV, presetRange, won } from '@/lib/mes/ui';
import { EVENT_TONE, EVENT_TYPES } from './_shared';

export default function HistoryTab({ reloadKey }: { reloadKey: number }) {
  const [range, setRange] = useState(presetRange('thisMonth'));
  const [typeFilter, setTypeFilter] = useState('전체');
  const [items, setItems] = useState<EquipmentEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async (r = range) => {
    setLoading(true);
    const res = await mesGet<{ items: EquipmentEvent[] }>(`/equipment-events?start=${r.start}&end=${r.end}`, { items: [] });
    setItems(res.items || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, [reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => items
    .filter((e) => typeFilter === '전체' || e.event_type === typeFilter)
    .sort((a, b) => (a.event_date < b.event_date ? 1 : -1)), [items, typeFilter]);

  const exportCsv = () => {
    downloadCSV(`설비이력_${range.start}_${range.end}.csv`,
      ['일자', '설비', '유형', '내용', '부품', '비용', '담당', '정지분', '상태'],
      filtered.map((e) => [e.event_date, e.equipment_name || '', e.event_type, e.description || '', e.part_name || '', e.cost ?? '', e.done_by || '', e.downtime_minutes ?? '', e.status === 'open' ? '진행중' : '마감']));
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <PeriodBar range={range} setRange={setRange} onApply={load} />
        <select className={C.select} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="전체">전체 유형</option>
          {EVENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <div className="flex-1" />
        <button onClick={exportCsv} className={`${C.btn} ${C.btnGhost}`}>CSV 다운로드</button>
      </div>
      <div className={`${C.card} overflow-x-auto`}>
        <table className="w-full">
          <thead>
            <tr>
              <th className={C.th}>일자</th><th className={C.th}>설비</th><th className={C.th}>유형</th><th className={C.th}>내용</th>
              <th className={C.th}>부품</th><th className={C.th}>비용</th><th className={C.th}>담당</th><th className={C.th}>정지(분)</th><th className={C.th}>상태</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((e) => (
              <tr key={e.id}>
                <td className={C.td}>{e.event_date}</td>
                <td className={C.td}>{e.equipment_name || '-'}</td>
                <td className={C.td}><Pill tone={EVENT_TONE[e.event_type] || 'muted'}>{e.event_type}</Pill></td>
                <td className={C.td}>{e.description || '-'}</td>
                <td className={C.td}>{e.part_name || '-'}</td>
                <td className={C.tdNum}>{e.cost != null ? won(e.cost) : '-'}</td>
                <td className={C.td}>{e.done_by || '-'}</td>
                <td className={C.tdNum}>{e.downtime_minutes ?? '-'}</td>
                <td className={C.td}><Pill tone={e.status === 'open' ? 'warning' : 'success'}>{e.status === 'open' ? '진행중' : '마감'}</Pill></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && filtered.length === 0 && <EmptyState title="이력이 없습니다" />}
      </div>
    </div>
  );
}
