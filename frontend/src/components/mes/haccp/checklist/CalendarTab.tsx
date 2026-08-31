'use client';

// 달력 탭 — GET /checklists/calendar?month= 히트맵. 셀 클릭 시 entry 존재하면 목록 조회로 id를 찾아 열람, 없으면 새 작성.
import { useEffect, useState, useCallback } from 'react';
import { mesGet, mesGetRaw, ChecklistEntry } from '@/lib/mes/api';
import { C, StatCard, EmptyState, monthISO, todayISO, pct } from '@/lib/mes/ui';
import EntryDrawer from './EntryDrawer';

interface CalTemplate { id: number; code: string; name: string; cycle: string }
interface CalResp { templates: CalTemplate[]; days: Record<string, Record<string, string>>; completion_rate: number }

const CELL_TONE: Record<string, string> = {
  approved: 'bg-success/70',
  submitted: 'bg-info/60',
  reviewed: 'bg-purple/60',
  draft: 'bg-warning/60',
  missing: 'bg-danger/20',
  'n/a': 'bg-transparent',
};

function daysInMonth(month: string) {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

export default function CalendarTab() {
  const [month, setMonth] = useState(monthISO());
  const [data, setData] = useState<CalResp>({ templates: [], days: {}, completion_rate: 0 });
  const [loading, setLoading] = useState(true);
  const [drawer, setDrawer] = useState<{ open: boolean; entryId?: number | null; templateId?: number | null; date?: string | null }>({ open: false });

  const load = useCallback(async () => {
    setLoading(true);
    const r = await mesGet<CalResp>(`/checklists/calendar?month=${month}`, { templates: [], days: {}, completion_rate: 0 });
    setData(r);
    setLoading(false);
  }, [month]);
  useEffect(() => { load(); }, [load]);

  const shiftMonth = (n: number) => {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(y, m - 1 + n, 1);
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };

  const nDays = daysInMonth(month);
  const today = todayISO();

  const openCell = async (templateId: number, day: number) => {
    const dateStr = `${month}-${String(day).padStart(2, '0')}`;
    const status = data.days[dateStr]?.[String(templateId)];
    if (!status || status === 'missing' || status === 'n/a') {
      setDrawer({ open: true, templateId, date: dateStr });
      return;
    }
    const r = await mesGetRaw<{ items: ChecklistEntry[] }>(`/checklists?start=${dateStr}&end=${dateStr}&template_id=${templateId}`);
    const found = r.data?.items?.[0];
    if (found) setDrawer({ open: true, entryId: found.id });
    else setDrawer({ open: true, templateId, date: dateStr });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button className={`${C.btn} ${C.btnGhost}`} onClick={() => shiftMonth(-1)}>◀</button>
          <div className="text-sm font-bold text-text-primary w-24 text-center">{month}</div>
          <button className={`${C.btn} ${C.btnGhost}`} onClick={() => shiftMonth(1)}>▶</button>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-[11px] text-text-tertiary">
            <span className="flex items-center gap-1"><span className={`w-3 h-3 rounded ${CELL_TONE.approved}`} />승인</span>
            <span className="flex items-center gap-1"><span className={`w-3 h-3 rounded ${CELL_TONE.submitted}`} />상신/검토</span>
            <span className="flex items-center gap-1"><span className={`w-3 h-3 rounded ${CELL_TONE.draft}`} />작성중</span>
            <span className="flex items-center gap-1"><span className={`w-3 h-3 rounded ${CELL_TONE.missing}`} />미작성</span>
          </div>
          <StatCard label="완료율" value={pct(data.completion_rate)} />
        </div>
      </div>

      {loading ? (
        <div className="py-14 text-center text-text-tertiary text-sm">불러오는 중…</div>
      ) : data.templates.length === 0 ? (
        <EmptyState title="템플릿이 없습니다" />
      ) : (
        <div className="overflow-x-auto">
          <table className="border-collapse">
            <thead>
              <tr>
                <th className={`${C.th} sticky left-0 bg-bg-1 z-10`} style={{ minWidth: 180 }}>양식</th>
                {Array.from({ length: nDays }, (_, i) => i + 1).map((d) => {
                  const dateStr = `${month}-${String(d).padStart(2, '0')}`;
                  const dow = new Date(`${dateStr}T00:00:00`).getDay();
                  const isWeekend = dow === 0 || dow === 6;
                  const isToday = dateStr === today;
                  return (
                    <th key={d} className={`${C.th} text-center ${isWeekend ? 'text-danger' : ''} ${isToday ? 'bg-brand/10' : ''}`} style={{ minWidth: 28, padding: '4px 2px' }}>{d}</th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {data.templates.map((t) => (
                <tr key={t.id}>
                  <td className={`${C.td} sticky left-0 bg-bg-1 z-10`}>
                    <span className="font-mono text-[10px] text-text-quaternary mr-1">{t.code}</span>{t.name}
                  </td>
                  {Array.from({ length: nDays }, (_, i) => i + 1).map((d) => {
                    const dateStr = `${month}-${String(d).padStart(2, '0')}`;
                    const status = data.days[dateStr]?.[String(t.id)] || 'n/a';
                    const isToday = dateStr === today;
                    return (
                      <td key={d} className={`border-b border-bg-inset p-0.5 text-center ${isToday ? 'ring-1 ring-brand' : ''}`}>
                        <button title={`${dateStr} ${status}`} onClick={() => openCell(t.id, d)} className={`w-6 h-6 rounded ${CELL_TONE[status] || CELL_TONE['n/a']} hover:opacity-70`} />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <EntryDrawer
        open={drawer.open}
        onClose={() => setDrawer({ open: false })}
        entryId={drawer.entryId}
        initTemplateId={drawer.templateId}
        initCheckDate={drawer.date}
        onSaved={load}
      />
    </div>
  );
}
