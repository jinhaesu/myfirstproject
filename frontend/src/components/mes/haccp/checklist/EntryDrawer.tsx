'use client';

// 선행점검일지 작성/열람 Drawer — 새 작성(템플릿 미지정 가능) 또는 기존 entry 열람/편집/결재.
import { useEffect, useMemo, useState } from 'react';
import { mesGet, mesGetRaw, mesPost, mesSend, ChecklistEntry, ChecklistItem, ChecklistTemplate } from '@/lib/mes/api';
import { C, Drawer, Modal, Pill, StatusPill, APPROVAL_STATUS, useToast, todayISO, dt } from '@/lib/mes/ui';

export interface EntryDrawerProps {
  open: boolean;
  onClose: () => void;
  entryId?: number | null;
  initTemplateId?: number | null;
  initCheckDate?: string | null;
  onSaved?: () => void;
}

type ResultMap = Record<string, { value: any; note?: string }>;

function isNg(item: ChecklistItem, val: any): boolean {
  if (item.type === 'ok') return val === 'ng';
  if (item.type === 'num') {
    if (val === '' || val === null || val === undefined) return false;
    const n = Number(val);
    if (Number.isNaN(n)) return false;
    if (item.min !== null && item.min !== undefined && n < item.min) return true;
    if (item.max !== null && item.max !== undefined && n > item.max) return true;
    return false;
  }
  return false;
}

function groupBySection(items: ChecklistItem[]): { section: string; items: ChecklistItem[] }[] {
  const groups: { section: string; items: ChecklistItem[] }[] = [];
  const map = new Map<string, ChecklistItem[]>();
  for (const it of items) {
    const key = it.section || '';
    if (!map.has(key)) { map.set(key, []); groups.push({ section: key, items: map.get(key)! }); }
    map.get(key)!.push(it);
  }
  return groups;
}

function printEntry(template: ChecklistTemplate, checkDate: string, shift: string, results: ResultMap, remarks: string, meta: { author?: string | null; reviewer?: string | null; approver?: string | null; status?: string }) {
  const w = window.open('', '_blank', 'width=900,height=1100');
  if (!w) return;
  const rows = template.items.map((it) => {
    const r = results[String(it.no)];
    const val = r?.value;
    const disp = it.type === 'ok' ? (val === 'ok' ? '적합' : val === 'ng' ? '부적합' : '-') : (val === undefined || val === null || val === '' ? '-' : String(val) + (it.type === 'num' && it.unit ? it.unit : ''));
    return `<tr><td>${it.no}</td><td>${it.section || ''}</td><td>${it.item}</td><td>${it.standard || ''}</td><td>${disp}</td><td>${r?.note || ''}</td></tr>`;
  }).join('');
  w.document.write(`
    <html><head><title>${template.name}</title>
    <style>
      body{font-family:'Malgun Gothic',sans-serif;padding:24px;color:#111}
      h1{font-size:20px;margin-bottom:4px}
      table{width:100%;border-collapse:collapse;font-size:12px;margin-top:12px}
      th,td{border:1px solid #999;padding:6px 8px;text-align:left}
      th{background:#eee}
      .meta{display:flex;gap:16px;font-size:13px;margin-top:8px}
      .sign{display:flex;gap:8px;margin-top:16px;justify-content:flex-end}
      .sign div{border:1px solid #999;padding:8px 16px;text-align:center;min-width:100px}
    </style></head>
    <body>
      <h1>조인앤조인 — ${template.name} (${template.code})</h1>
      <div class="meta">
        <div>점검일: ${checkDate}</div><div>교대: ${shift}</div><div>작성자: ${meta.author || '-'}</div><div>상태: ${meta.status || ''}</div>
      </div>
      <table>
        <thead><tr><th>No</th><th>구분</th><th>점검항목</th><th>기준</th><th>결과</th><th>비고</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p>특이사항: ${remarks || '-'}</p>
      <div class="sign">
        <div>작성<br/>${meta.author || ''}</div>
        <div>검토<br/>${meta.reviewer || ''}</div>
        <div>승인<br/>${meta.approver || ''}</div>
      </div>
    </body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 300);
}

export default function EntryDrawer({ open, onClose, entryId, initTemplateId, initCheckDate, onSaved }: EntryDrawerProps) {
  const { toast, show, node: toastNode } = useToast();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [templates, setTemplates] = useState<ChecklistTemplate[]>([]);
  const [templateId, setTemplateId] = useState<number | null>(null);
  const [template, setTemplate] = useState<ChecklistTemplate | null>(null);
  const [entry, setEntry] = useState<ChecklistEntry | null>(null);
  const [checkDate, setCheckDate] = useState(todayISO());
  const [shift, setShift] = useState('-');
  const [results, setResults] = useState<ResultMap>({});
  const [remarks, setRemarks] = useState('');
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectAction, setRejectAction] = useState<'reject' | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const tmplRes = await mesGet<{ items: ChecklistTemplate[] }>('/templates', { items: [] });
      if (cancelled) return;
      setTemplates(tmplRes.items || []);
      if (entryId) {
        const r = await mesGetRaw<{ entry: ChecklistEntry; template: ChecklistTemplate }>(`/checklists/${entryId}`);
        if (cancelled) return;
        if (r.ok && r.data?.entry) {
          setEntry(r.data.entry);
          setTemplate(r.data.template);
          setTemplateId(r.data.template?.id ?? r.data.entry.template_id);
          setCheckDate(r.data.entry.check_date);
          setShift(r.data.entry.shift || '-');
          setResults(r.data.entry.results || {});
          setRemarks(r.data.entry.remarks || '');
        } else {
          show('일지를 불러오지 못했습니다', 'danger');
        }
      } else {
        setEntry(null);
        const tid = initTemplateId ?? null;
        setTemplateId(tid);
        setTemplate(tid ? (tmplRes.items || []).find((t) => t.id === tid) || null : null);
        setCheckDate(initCheckDate || todayISO());
        setShift('-');
        setResults({});
        setRemarks('');
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, entryId, initTemplateId, initCheckDate]);

  useEffect(() => {
    if (!entryId && templateId) setTemplate(templates.find((t) => t.id === templateId) || null);
  }, [templateId, templates, entryId]);

  const readOnly = !!entry && entry.status !== 'draft' && entry.status !== 'rejected';
  const devCount = useMemo(() => {
    if (!template) return 0;
    return template.items.filter((it) => isNg(it, results[String(it.no)]?.value)).length;
  }, [template, results]);

  const setVal = (no: number, value: any) => setResults((r) => ({ ...r, [String(no)]: { ...(r[String(no)] || {}), value } }));
  const setNote = (no: number, note: string) => setResults((r) => ({ ...r, [String(no)]: { ...(r[String(no)] || {}), note } }));
  const allOk = () => {
    if (!template) return;
    setResults((r) => {
      const next = { ...r };
      for (const it of template.items) if (it.type === 'ok') next[String(it.no)] = { ...(next[String(it.no)] || {}), value: 'ok' };
      return next;
    });
  };

  const doSave = async (thenSubmit: boolean) => {
    if (!templateId) { show('양식을 선택하세요', 'danger'); return null; }
    setSaving(true);
    const res = await mesPost<{ id?: number; entry?: ChecklistEntry }>('/checklists', {
      id: entry?.id,
      template_id: templateId,
      check_date: checkDate,
      shift,
      results_json: results,
      remarks,
    });
    setSaving(false);
    if (!res.ok) { show(res.error || '저장 실패', 'danger'); return null; }
    const savedId = (res.data as any)?.id ?? (res.data as any)?.entry?.id ?? entry?.id;
    if (thenSubmit && savedId) {
      const sr = await mesPost(`/checklists/${savedId}/submit`);
      if (!sr.ok) { show(sr.error || '상신 실패', 'danger'); return null; }
      show('저장 후 상신되었습니다');
      onSaved?.();
      onClose();
      return savedId;
    }
    show('임시저장되었습니다');
    onSaved?.();
    if (savedId && !entry) {
      // 신규 저장 후 계속 편집: 리로드하여 상태 반영
      const r = await mesGetRaw<{ entry: ChecklistEntry; template: ChecklistTemplate }>(`/checklists/${savedId}`);
      if (r.ok) { setEntry(r.data.entry); setTemplate(r.data.template); }
    }
    return savedId;
  };

  const doWorkflow = async (action: 'review' | 'approve' | 'reject') => {
    if (!entry) return;
    if (action === 'reject') { setRejectAction('reject'); setRejectOpen(true); return; }
    const r = await mesPost(`/checklists/${entry.id}/${action}`);
    if (!r.ok) { show(r.error || '처리 실패', 'danger'); return; }
    show(action === 'review' ? '검토 처리되었습니다' : '승인되었습니다');
    onSaved?.();
    const rr = await mesGetRaw<{ entry: ChecklistEntry; template: ChecklistTemplate }>(`/checklists/${entry.id}`);
    if (rr.ok) setEntry(rr.data.entry);
  };

  const submitReject = async () => {
    if (!entry) return;
    const r = await mesPost(`/checklists/${entry.id}/reject`, { reason: rejectReason });
    setRejectOpen(false); setRejectReason('');
    if (!r.ok) { show(r.error || '반려 처리 실패', 'danger'); return; }
    show('반려 처리되었습니다', 'info');
    onSaved?.();
    const rr = await mesGetRaw<{ entry: ChecklistEntry; template: ChecklistTemplate }>(`/checklists/${entry.id}`);
    if (rr.ok) setEntry(rr.data.entry);
  };

  const doDelete = async () => {
    if (!entry) return;
    const r = await mesSend(`/checklists/${entry.id}`, 'DELETE');
    if (!r.ok) { show(r.error || '삭제 실패', 'danger'); return; }
    show('삭제되었습니다', 'info');
    onSaved?.();
    onClose();
  };

  return (
    <Drawer open={open} onClose={onClose} title={template ? `${template.code} · ${template.name}` : '선행점검일지 작성'} width="max-w-4xl">
      {toastNode}
      {loading ? (
        <div className="py-20 text-center text-text-tertiary text-sm">불러오는 중…</div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3 bg-bg-0 border border-border-primary rounded-lg p-3">
            <div className="flex-1 min-w-[160px]">
              <div className={C.label}>양식</div>
              {entryId || templateId ? (
                <div className="text-sm font-semibold text-text-primary">{template ? `${template.code} · ${template.name}` : '-'}</div>
              ) : (
                <select className={`${C.select} w-full`} value={templateId ?? ''} onChange={(e) => setTemplateId(e.target.value ? Number(e.target.value) : null)}>
                  <option value="">선택하세요</option>
                  {templates.filter((t) => t.is_active).map((t) => <option key={t.id} value={t.id}>{t.code} · {t.name}</option>)}
                </select>
              )}
            </div>
            <div>
              <div className={C.label}>점검일</div>
              <input type="date" className={C.input} value={checkDate} disabled={readOnly} onChange={(e) => setCheckDate(e.target.value)} />
            </div>
            <div>
              <div className={C.label}>교대</div>
              <select className={C.select} value={shift} disabled={readOnly} onChange={(e) => setShift(e.target.value)}>
                <option value="-">-</option>
                <option value="주간">주간</option>
                <option value="야간">야간</option>
              </select>
            </div>
            <div>
              <div className={C.label}>작성자</div>
              <div className="text-sm text-text-secondary">{entry?.author || '-'}</div>
            </div>
            {entry && (
              <div>
                <div className={C.label}>상태</div>
                <StatusPill status={entry.status} map={APPROVAL_STATUS} />
              </div>
            )}
            <div>
              <div className={C.label}>부적합</div>
              <Pill tone={devCount > 0 ? 'danger' : 'success'} size="md">{devCount}건</Pill>
            </div>
            {entry && (entry.status === 'submitted' || entry.status === 'reviewed' || entry.status === 'approved') && (
              <div className="ml-auto flex gap-2">
                {entry.status === 'submitted' && <button className={`${C.btn} ${C.btnPrimary}`} onClick={() => doWorkflow('review')}>검토</button>}
                {entry.status === 'reviewed' && <button className={`${C.btn} ${C.btnSuccess}`} onClick={() => doWorkflow('approve')}>승인</button>}
                {(entry.status === 'submitted' || entry.status === 'reviewed') && <button className={`${C.btn} ${C.btnDanger}`} onClick={() => doWorkflow('reject')}>반려</button>}
              </div>
            )}
          </div>

          {entry?.status === 'rejected' && entry.reject_reason && (
            <div className="text-xs text-danger bg-danger/10 border border-danger/30 rounded-lg px-3 py-2">반려 사유: {entry.reject_reason}</div>
          )}

          {!template ? (
            <div className="py-14 text-center text-text-tertiary text-sm">양식을 선택하면 점검 항목이 표시됩니다.</div>
          ) : (
            <>
              <div className="flex justify-end">
                {!readOnly && <button className={`${C.btn} ${C.btnGhost}`} onClick={allOk}>전체 적합</button>}
              </div>
              {groupBySection(template.items).map((g, gi) => (
                <div key={gi} className="overflow-x-auto">
                  {g.section && <div className="text-xs font-bold text-text-tertiary mb-1 mt-2">{g.section}</div>}
                  <table className="w-full border-collapse">
                    <thead>
                      <tr>
                        <th className={C.th} style={{ width: 40 }}>No</th>
                        <th className={C.th}>점검항목</th>
                        <th className={C.th}>기준</th>
                        <th className={C.th} style={{ width: 220 }}>입력</th>
                        <th className={C.th}>비고</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.items.map((it) => {
                        const val = results[String(it.no)]?.value;
                        const ng = isNg(it, val);
                        return (
                          <tr key={it.no}>
                            <td className={C.td}>{it.no}</td>
                            <td className={C.td} style={{ whiteSpace: 'normal' }}>{it.item}</td>
                            <td className={C.td} style={{ whiteSpace: 'normal' }}>{it.standard || '-'}</td>
                            <td className={C.td}>
                              {it.type === 'ok' && (
                                <div className="flex gap-1.5">
                                  <button disabled={readOnly} className={`${C.btn} px-3 py-1.5 ${val === 'ok' ? C.btnSuccess : C.btnGhost}`} onClick={() => setVal(it.no, 'ok')}>적합</button>
                                  <button disabled={readOnly} className={`${C.btn} px-3 py-1.5 ${val === 'ng' ? C.btnDanger : C.btnGhost}`} onClick={() => setVal(it.no, 'ng')}>부적합</button>
                                </div>
                              )}
                              {it.type === 'num' && (
                                <div className="flex items-center gap-1.5">
                                  <input type="number" disabled={readOnly} className={`${C.input} w-24 ${ng ? 'border-danger text-danger' : ''}`} value={val ?? ''} onChange={(e) => setVal(it.no, e.target.value === '' ? '' : Number(e.target.value))} />
                                  {it.unit && <span className="text-xs text-text-tertiary">{it.unit}</span>}
                                  {ng && <span className="text-[11px] text-danger font-semibold">기준 이탈</span>}
                                </div>
                              )}
                              {it.type === 'text' && (
                                <input type="text" disabled={readOnly} className={`${C.input} w-full`} value={val ?? ''} onChange={(e) => setVal(it.no, e.target.value)} />
                              )}
                            </td>
                            <td className={C.td}>
                              <input type="text" disabled={readOnly} className={`${C.input} w-full`} value={results[String(it.no)]?.note ?? ''} onChange={(e) => setNote(it.no, e.target.value)} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ))}

              <div>
                <div className={C.label}>특이사항</div>
                <textarea disabled={readOnly} className={`${C.input} w-full`} rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
              </div>

              <div className="flex flex-wrap justify-end gap-2 pt-2 border-t border-border-primary">
                <button className={`${C.btn} ${C.btnGhost}`} onClick={() => template && printEntry(template, checkDate, shift, results, remarks, { author: entry?.author, reviewer: entry?.reviewer, approver: entry?.approver, status: entry ? (APPROVAL_STATUS[entry.status]?.label || entry.status) : '작성중' })}>인쇄</button>
                {entry && entry.status === 'draft' && <button className={`${C.btn} ${C.btnDanger}`} onClick={doDelete}>삭제</button>}
                {!readOnly && (
                  <>
                    <button disabled={saving} className={`${C.btn} ${C.btnGhost}`} onClick={() => doSave(false)}>임시저장</button>
                    <button disabled={saving} className={`${C.btn} ${C.btnPrimary}`} onClick={() => doSave(true)}>저장 후 상신</button>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      )}

      <Modal open={rejectOpen} onClose={() => setRejectOpen(false)} title="반려 사유" footer={<>
        <button className={`${C.btn} ${C.btnGhost}`} onClick={() => setRejectOpen(false)}>취소</button>
        <button className={`${C.btn} ${C.btnDanger}`} onClick={submitReject}>반려</button>
      </>}>
        <textarea className={`${C.input} w-full`} rows={3} placeholder="반려 사유를 입력하세요" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
      </Modal>
    </Drawer>
  );
}
