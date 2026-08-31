'use client';

import { useState } from 'react';
import { mesDelete, mesPost, type MesWorker, type WorkResult } from '@/lib/mes/api';
import { C, ConfirmButton, EmptyState, Modal, dt, fmt } from '@/lib/mes/ui';

export function ResultsTab({ workOrderId, results, workers, onChanged, showToast }: {
  workOrderId: number; results: WorkResult[]; workers: MesWorker[]; onChanged: () => void; showToast: (m: string, t?: 'success' | 'danger' | 'info') => void;
}) {
  const [open, setOpen] = useState(false);
  const [prodQty, setProdQty] = useState('');
  const [defectQty, setDefectQty] = useState('');
  const [goodQty, setGoodQty] = useState('');
  const [workerId, setWorkerId] = useState<number | ''>('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const reset = () => { setProdQty(''); setDefectQty(''); setGoodQty(''); setWorkerId(''); setNotes(''); };

  const submit = async () => {
    if (!prodQty || Number(prodQty) <= 0) { showToast('생산수량을 입력하세요', 'danger'); return; }
    setSaving(true);
    const r = await mesPost(`/work-orders/${workOrderId}/results`, {
      prod_qty: Number(prodQty), defect_qty: defectQty ? Number(defectQty) : undefined,
      good_qty: goodQty ? Number(goodQty) : undefined, worker_id: workerId || undefined, notes: notes || undefined,
    });
    setSaving(false);
    if (!r.ok) { showToast(r.error || '등록 실패', 'danger'); return; }
    showToast('실적을 등록했습니다'); reset(); setOpen(false); onChanged();
  };

  const del = async (id: number) => {
    const r = await mesDelete(`/results/${id}`);
    if (!r.ok) { showToast(r.error || '삭제 실패', 'danger'); return; }
    showToast('삭제했습니다'); onChanged();
  };

  return (
    <div>
      <div className="flex justify-end mb-2">
        <button className={`${C.btn} ${C.btnPrimary}`} onClick={() => setOpen(true)}>+ 실적추가</button>
      </div>
      {results.length === 0 ? <EmptyState title="등록된 실적이 없습니다" /> : (
        <table className="w-full border-collapse">
          <thead><tr><th className={C.th}>실적번호</th><th className={C.th}>시작</th><th className={C.th}>종료</th><th className={`${C.th} text-right`}>생산</th><th className={`${C.th} text-right`}>양품</th><th className={`${C.th} text-right`}>불량</th><th className={C.th}>작업자</th><th className={C.th}></th></tr></thead>
          <tbody>
            {results.map((r) => (
              <tr key={r.id}>
                <td className={C.td}>{r.result_no}</td>
                <td className={C.td}>{dt(r.start_at)}</td>
                <td className={C.td}>{dt(r.end_at)}</td>
                <td className={C.tdNum}>{fmt(r.prod_qty)}</td>
                <td className={C.tdNum}>{fmt(r.good_qty)}</td>
                <td className={C.tdNum}>{fmt(r.defect_qty)}</td>
                <td className={C.td}>{r.worker_name || '-'}</td>
                <td className={C.td}><button className="text-danger text-xs hover:underline" onClick={() => del(r.id)}>삭제</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="생산실적 추가" width="max-w-md"
        footer={<><button className={`${C.btn} ${C.btnGhost}`} onClick={() => setOpen(false)}>취소</button><button className={`${C.btn} ${C.btnPrimary}`} disabled={saving} onClick={submit}>{saving ? '저장 중…' : '저장'}</button></>}>
        <div className="space-y-3">
          <div><label className={C.label}>생산수량</label><input type="number" className={`${C.input} w-full`} value={prodQty} onChange={(e) => setProdQty(e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={C.label}>양품(비우면 자동)</label><input type="number" className={`${C.input} w-full`} value={goodQty} onChange={(e) => setGoodQty(e.target.value)} /></div>
            <div><label className={C.label}>불량</label><input type="number" className={`${C.input} w-full`} value={defectQty} onChange={(e) => setDefectQty(e.target.value)} /></div>
          </div>
          <div>
            <label className={C.label}>작업자</label>
            <select className={`${C.select} w-full`} value={workerId} onChange={(e) => setWorkerId(e.target.value ? Number(e.target.value) : '')}>
              <option value="">선택 안 함</option>
              {workers.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
          <div><label className={C.label}>비고</label><textarea className={`${C.input} w-full`} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
        </div>
      </Modal>
    </div>
  );
}
