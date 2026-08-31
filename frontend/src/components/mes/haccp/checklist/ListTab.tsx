'use client';

// 일지 목록 탭 — GET /checklists 기간·양식·상태 필터 + 다중선택 일괄 결재 + CSV.
import { useEffect, useState, useCallback, useMemo } from 'react';
import { mesGet, mesPost, ChecklistEntry, ChecklistTemplate } from '@/lib/mes/api';
import { C, PeriodBar, presetRange, StatusPill, APPROVAL_STATUS, Pill, EmptyState, Modal, useToast, downloadCSV, dt, todayISO } from '@/lib/mes/ui';
import EntryDrawer from './EntryDrawer';

const STATUS_TABS: { key: string; label: string }[] = [
  { key: '', label: '전체' },
  { key: 'draft', label: '작성중' },
  { key: 'submitted', label: '상신' },
  { key: 'reviewed', label: '검토완료' },
  { key: 'approved', label: '승인' },
  { key: 'rejected', label: '반려' },
];

export default function ListTab() {
  const { toast, show, node: toastNode } = useToast();
  const [range, setRange] = useState(presetRange('thisMonth'));
  const [templates, setTemplates] = useState<ChecklistTemplate[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [status, setStatus] = useState('');
  const [items, setItems] = useState<ChecklistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [drawer, setDrawer] = useState<{ open: boolean; entryId?: number | null; templateId?: number | null; date?: string | null }>({ open: false });
  const [newOpen, setNewOpen] = useState(false);
  const [newTemplateId, setNewTemplateId] = useState('');
  const [newDate, setNewDate] = useState(todayISO());
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  useEffect(() => { mesGet<{ items: ChecklistTemplate[] }>('/templates', { items: [] }).then((r) => setTemplates(r.items || [])); }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const qs = new URLSearchParams({ start: range.start, end: range.end });
    if (templateId) qs.set('template_id', templateId);
    if (status) qs.set('status', status);
    const r = await mesGet<{ items: ChecklistEntry[] }>(`/checklists?${qs.toString()}`, { items: [] });
    setItems(r.items || []);
    setSelected(new Set());
    setLoading(false);
  }, [range, templateId, status]);
  useEffect(() => { load(); }, [load]);

  const toggle = (id: number) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setSelected((s) => (s.size === items.length ? new Set() : new Set(items.map((i) => i.id))));

  const bulk = async (action: 'submit' | 'review' | 'approve' | 'reject', reason?: string) => {
    if (selected.size === 0) return;
    let ok = 0, fail = 0;
    for (const id of Array.from(selected)) {
      const r = await mesPost(`/checklists/${id}/${action}`, action === 'reject' ? { reason } : undefined);
      if (r.ok) ok++; else fail++;
    }
    show(`처리 완료 ${ok}건${fail ? ` · 실패 ${fail}건` : ''}`, fail ? 'danger' : 'success');
    load();
  };

  const csv = () => {
    downloadCSV(`checklists_${range.start}_${range.end}.csv`,
      ['점검일', '양식코드', '양식명', '교대', '작성자', '부적합수', '상태', '검토자', '승인자', '상신시각', '승인시각'],
      items.map((i) => [i.check_date, i.template_code || '', i.template_name || '', i.shift, i.author || '', i.deviation_count, APPROVAL_STATUS[i.status]?.label || i.status, i.reviewer || '', i.approver || '', dt(i.submitted_at), dt(i.approved_at)]));
  };

  return (
    <div className="space-y-4">
      {toastNode}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PeriodBar range={range} setRange={setRange} onApply={setRange} />
        <div className="flex flex-wrap items-center gap-2">
          <select className={C.select} value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
            <option value="">전체 양식</option>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.code} · {t.name}</option>)}
          </select>
          <button className={`${C.btn} ${C.btnPrimary}`} onClick={() => setNewOpen(true)}>새 작성</button>
          <button className={`${C.btn} ${C.btnGhost}`} onClick={csv}>CSV</button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {STATUS_TABS.map((t) => (
          <button key={t.key} onClick={() => setStatus(t.key)} className={`${C.btn} px-3 py-1.5 ${status === t.key ? C.btnPrimary : C.btnGhost}`}>{t.label}</button>
        ))}
      </div>

      {selected.size > 0 && (
        <div className="flex items-center gap-2 bg-bg-1 border border-border-primary rounded-lg px-3 py-2">
          <span className="text-xs text-text-tertiary">{selected.size}건 선택</span>
          <button className={`${C.btn} ${C.btnGhost} px-3 py-1.5`} onClick={() => bulk('submit')}>상신</button>
          <button className={`${C.btn} ${C.btnGhost} px-3 py-1.5`} onClick={() => bulk('review')}>검토</button>
          <button className={`${C.btn} ${C.btnSuccess} px-3 py-1.5`} onClick={() => bulk('approve')}>승인</button>
          <button className={`${C.btn} ${C.btnDanger} px-3 py-1.5`} onClick={() => setRejectOpen(true)}>반려</button>
        </div>
      )}

      {loading ? (
        <div className="py-14 text-center text-text-tertiary text-sm">불러오는 중…</div>
      ) : items.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={C.th}><input type="checkbox" checked={selected.size === items.length && items.length > 0} onChange={toggleAll} /></th>
                <th className={C.th}>점검일</th>
                <th className={C.th}>양식코드</th>
                <th className={C.th}>양식명</th>
                <th className={C.th}>교대</th>
                <th className={C.th}>작성자</th>
                <th className={C.th}>부적합수</th>
                <th className={C.th}>상태</th>
                <th className={C.th}>검토자</th>
                <th className={C.th}>승인자</th>
                <th className={C.th}>상신시각</th>
                <th className={C.th}>승인시각</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id} className="hover:bg-bg-inset/50 cursor-pointer" onClick={() => setDrawer({ open: true, entryId: i.id })}>
                  <td className={C.td} onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={selected.has(i.id)} onChange={() => toggle(i.id)} /></td>
                  <td className={C.td}>{i.check_date}</td>
                  <td className={C.td}>{i.template_code}</td>
                  <td className={C.td}>{i.template_name}</td>
                  <td className={C.td}>{i.shift}</td>
                  <td className={C.td}>{i.author || '-'}</td>
                  <td className={C.td}>{i.deviation_count > 0 ? <Pill tone="danger">{i.deviation_count}</Pill> : i.deviation_count}</td>
                  <td className={C.td}><StatusPill status={i.status} map={APPROVAL_STATUS} /></td>
                  <td className={C.td}>{i.reviewer || '-'}</td>
                  <td className={C.td}>{i.approver || '-'}</td>
                  <td className={C.td}>{dt(i.submitted_at)}</td>
                  <td className={C.td}>{dt(i.approved_at)}</td>
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

      <Modal open={newOpen} onClose={() => setNewOpen(false)} title="새 일지 작성" footer={<>
        <button className={`${C.btn} ${C.btnGhost}`} onClick={() => setNewOpen(false)}>취소</button>
        <button className={`${C.btn} ${C.btnPrimary}`} onClick={() => { setNewOpen(false); setDrawer({ open: true, templateId: newTemplateId ? Number(newTemplateId) : null, date: newDate }); }}>작성 시작</button>
      </>}>
        <div className="space-y-3">
          <div>
            <div className={C.label}>양식</div>
            <select className={`${C.select} w-full`} value={newTemplateId} onChange={(e) => setNewTemplateId(e.target.value)}>
              <option value="">선택하세요</option>
              {templates.filter((t) => t.is_active).map((t) => <option key={t.id} value={t.id}>{t.code} · {t.name}</option>)}
            </select>
          </div>
          <div>
            <div className={C.label}>점검일</div>
            <input type="date" className={`${C.input} w-full`} value={newDate} onChange={(e) => setNewDate(e.target.value)} />
          </div>
        </div>
      </Modal>

      <Modal open={rejectOpen} onClose={() => setRejectOpen(false)} title="일괄 반려" footer={<>
        <button className={`${C.btn} ${C.btnGhost}`} onClick={() => setRejectOpen(false)}>취소</button>
        <button className={`${C.btn} ${C.btnDanger}`} onClick={() => { setRejectOpen(false); bulk('reject', rejectReason); setRejectReason(''); }}>반려</button>
      </>}>
        <textarea className={`${C.input} w-full`} rows={3} placeholder="반려 사유" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
      </Modal>
    </div>
  );
}
