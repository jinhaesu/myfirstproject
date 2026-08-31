'use client';

// 오늘 점검 탭 — GET /checklists/today 응답의 템플릿별 오늘 상태를 카드 그리드로 표시.
// 응답 스키마가 설계서에 명시되지 않아 { date, items:[{template_id, code, name, category, cycle, status, entry_id}], done, due }
// 형태로 가정하고, 필드가 달라도 방어적으로 읽는다(assumption, 하단 보고 참고).
import { useEffect, useState, useCallback } from 'react';
import { mesGet } from '@/lib/mes/api';
import { C, StatusPill, APPROVAL_STATUS, ProgressBar, EmptyState, StatCard } from '@/lib/mes/ui';
import EntryDrawer from './EntryDrawer';

interface TodayItem {
  template_id?: number; id?: number; code?: string; template_code?: string; name?: string; template_name?: string;
  category?: string; cycle?: string; status?: string; entry_id?: number | null;
}
interface TodayResp { date?: string; items: TodayItem[]; done?: number; due?: number }

const cycleLabel: Record<string, string> = { daily: '매일', weekly: '주간', monthly: '월간', asneeded: '수시' };

export default function TodayTab() {
  const [data, setData] = useState<TodayResp>({ items: [] });
  const [loading, setLoading] = useState(true);
  const [drawer, setDrawer] = useState<{ open: boolean; entryId?: number | null; templateId?: number | null; date?: string | null }>({ open: false });

  const load = useCallback(async () => {
    setLoading(true);
    const r = await mesGet<TodayResp>('/checklists/today', { items: [] });
    setData(r || { items: [] });
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const items = data.items || [];
  const done = data.done ?? items.filter((i) => i.status === 'approved').length;
  const due = data.due ?? items.length;

  const open = (it: TodayItem) => {
    const tid = it.template_id ?? it.id ?? null;
    if (it.entry_id) setDrawer({ open: true, entryId: it.entry_id });
    else setDrawer({ open: true, templateId: tid, date: data.date });
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="오늘 대상" value={`${due}건`} />
        <StatCard label="작성 완료" value={`${done}건`} tone="text-success" />
        <div className="col-span-2 md:col-span-2 flex flex-col justify-center">
          <div className="text-[11px] text-text-tertiary mb-1">진행률 {due ? Math.round((done / due) * 100) : 0}%</div>
          <ProgressBar value={due ? (done / due) * 100 : 0} tone="success" />
        </div>
      </div>

      {loading ? (
        <div className="py-14 text-center text-text-tertiary text-sm">불러오는 중…</div>
      ) : items.length === 0 ? (
        <EmptyState title="오늘 점검할 양식이 없습니다" sub="템플릿 탭에서 점검 주기를 확인하세요" />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {items.map((it, i) => {
            const status = it.status || 'missing';
            const code = it.code || it.template_code || '';
            const name = it.name || it.template_name || '';
            const cycle = it.cycle ? cycleLabel[it.cycle] || it.cycle : null;
            return (
              <div key={i} className={`${C.cardPad} flex flex-col gap-2`}>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono text-text-tertiary">{code}</span>
                  {cycle && <span className="text-[11px] px-2 py-0.5 rounded-full bg-bg-inset text-text-tertiary">{cycle}</span>}
                </div>
                <div className="text-sm font-bold text-text-primary flex-1">{name}</div>
                {it.category && <div className="text-[11px] text-text-quaternary">{it.category}</div>}
                <div className="flex items-center justify-between mt-1">
                  {status === 'missing' ? (
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-bg-inset text-text-tertiary">미작성</span>
                  ) : (
                    <StatusPill status={status} map={APPROVAL_STATUS} />
                  )}
                  {status === 'approved' ? (
                    <span className="text-success text-lg">✓</span>
                  ) : status === 'missing' ? (
                    <button className={`${C.btn} ${C.btnPrimary} px-3 py-1.5`} onClick={() => open(it)}>작성</button>
                  ) : status === 'draft' ? (
                    <button className={`${C.btn} ${C.btnGhost} px-3 py-1.5`} onClick={() => open(it)}>이어쓰기</button>
                  ) : (
                    <button className={`${C.btn} ${C.btnGhost} px-3 py-1.5`} onClick={() => open(it)}>검토·승인 대기</button>
                  )}
                </div>
              </div>
            );
          })}
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
