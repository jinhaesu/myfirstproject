'use client';

import { useEffect, useState } from 'react';
import { mesDelete, mesGet, mesPost, type Downtime, type MesCode } from '@/lib/mes/api';
import { C, EmptyState, Modal, dt, fmt } from '@/lib/mes/ui';

export function DowntimesTab({ workOrderId, downtimes, onChanged, showToast }: {
  workOrderId: number; downtimes: Downtime[]; onChanged: () => void; showToast: (m: string, t?: 'success' | 'danger' | 'info') => void;
}) {
  const [codes, setCodes] = useState<MesCode[]>([]);
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { mesGet<{ items: MesCode[] }>('/codes?group=DOWNTIME', { items: [] }).then((r) => setCodes(r.items || [])); }, []);

  const submit = async () => {
    if (!code) { showToast('비가동 유형을 선택하세요', 'danger'); return; }
    setSaving(true);
    const r = await mesPost(`/work-orders/${workOrderId}/downtimes`, {
      downtime_code: code, start_at: startAt || undefined, end_at: endAt || undefined, reason: reason || undefined,
    });
    setSaving(false);
    if (!r.ok) { showToast(r.error || '등록 실패', 'danger'); return; }
    showToast('비가동을 등록했습니다'); setCode(''); setStartAt(''); setEndAt(''); setReason(''); setOpen(false); onChanged();
  };

  const endNow = async (id: number) => {
    const r = await mesPost(`/downtimes/${id}/end`);
    if (!r.ok) { showToast(r.error || '종료 실패', 'danger'); return; }
    showToast('비가동을 종료했습니다'); onChanged();
  };

  const del = async (id: number) => {
    const r = await mesDelete(`/downtimes/${id}`);
    if (!r.ok) { showToast(r.error || '삭제 실패', 'danger'); return; }
    showToast('삭제했습니다'); onChanged();
  };

  return (
    <div>
      <div className="flex justify-end mb-2">
        <button className={`${C.btn} ${C.btnPrimary}`} onClick={() => setOpen(true)}>+ 비가동등록</button>
      </div>
      {downtimes.length === 0 ? <EmptyState title="등록된 비가동이 없습니다" /> : (
        <table className="w-full border-collapse">
          <thead><tr><th className={C.th}>유형</th><th className={C.th}>시작</th><th className={C.th}>종료</th><th className={`${C.th} text-right`}>시간(분)</th><th className={C.th}>사유</th><th className={C.th}></th></tr></thead>
          <tbody>
            {downtimes.map((d) => (
              <tr key={d.id}>
                <td className={C.td}>{d.downtime_name || d.downtime_code}</td>
                <td className={C.td}>{dt(d.start_at)}</td>
                <td className={C.td}>{d.end_at ? dt(d.end_at) : <span className="text-warning font-semibold">진행중</span>}</td>
                <td className={C.tdNum}>{fmt(d.minutes)}</td>
                <td className={C.td}>{d.reason || '-'}</td>
                <td className={C.td}>
                  <div className="flex gap-2">
                    {!d.end_at && <button className="text-warning text-xs hover:underline" onClick={() => endNow(d.id)}>종료</button>}
                    <button className="text-danger text-xs hover:underline" onClick={() => del(d.id)}>삭제</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="비가동 등록" width="max-w-md"
        footer={<><button className={`${C.btn} ${C.btnGhost}`} onClick={() => setOpen(false)}>취소</button><button className={`${C.btn} ${C.btnPrimary}`} disabled={saving} onClick={submit}>{saving ? '저장 중…' : '저장'}</button></>}>
        <div className="space-y-3">
          <div>
            <label className={C.label}>비가동 유형</label>
            <select className={`${C.select} w-full`} value={code} onChange={(e) => setCode(e.target.value)}>
              <option value="">선택</option>
              {codes.map((c) => <option key={c.id} value={c.code}>{c.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={C.label}>시작(비우면 지금)</label><input type="datetime-local" className={`${C.input} w-full`} value={startAt} onChange={(e) => setStartAt(e.target.value)} /></div>
            <div><label className={C.label}>종료(비우면 진행중)</label><input type="datetime-local" className={`${C.input} w-full`} value={endAt} onChange={(e) => setEndAt(e.target.value)} /></div>
          </div>
          <div><label className={C.label}>사유</label><textarea className={`${C.input} w-full`} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
        </div>
      </Modal>
    </div>
  );
}
