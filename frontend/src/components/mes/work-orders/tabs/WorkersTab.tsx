'use client';

import { useEffect, useState } from 'react';
import { mesPost, type MesWorker } from '@/lib/mes/api';
import { C } from '@/lib/mes/ui';

export function WorkersTab({ workOrderId, workerIds, allWorkers, onChanged, showToast }: {
  workOrderId: number; workerIds: number[]; allWorkers: MesWorker[]; onChanged: () => void; showToast: (m: string, t?: 'success' | 'danger' | 'info') => void;
}) {
  const [sel, setSel] = useState<Set<number>>(new Set(workerIds));
  const [saving, setSaving] = useState(false);
  useEffect(() => setSel(new Set(workerIds)), [workerIds]);

  const toggle = (id: number) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const save = async () => {
    setSaving(true);
    const r = await mesPost(`/work-orders/${workOrderId}/workers`, { worker_ids: Array.from(sel) });
    setSaving(false);
    if (!r.ok) { showToast(r.error || '저장 실패', 'danger'); return; }
    showToast('작업자를 저장했습니다'); onChanged();
  };

  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-4">
        {allWorkers.map((w) => (
          <button key={w.id} type="button" onClick={() => toggle(w.id)}
            className={`px-2.5 py-1.5 rounded-full text-xs font-semibold border transition-colors ${sel.has(w.id) ? 'bg-brand text-white border-brand' : 'bg-bg-inset text-text-secondary border-border-primary hover:border-brand'}`}>
            {w.name}
          </button>
        ))}
      </div>
      <button className={`${C.btn} ${C.btnPrimary}`} disabled={saving} onClick={save}>{saving ? '저장 중…' : '작업자 저장'}</button>
    </div>
  );
}
