'use client';

import { useEffect, useState } from 'react';
import { mesGet, mesPost, type MesEquipment, type MesProcess } from '@/lib/mes/api';
import { C, Modal, todayISO, fmt, EmptyState } from '@/lib/mes/ui';
import type { PlansResponse, PlanRow } from './types';

export function BulkGenerateModal({ open, onClose, onSaved, processes, equipment, showToast }: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  processes: MesProcess[];
  equipment: MesEquipment[];
  showToast: (msg: string, tone?: 'success' | 'danger' | 'info') => void;
}) {
  const [date, setDate] = useState(todayISO());
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [processId, setProcessId] = useState<number | ''>('');
  const [equipmentId, setEquipmentId] = useState<number | ''>('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    const month = date.slice(0, 7);
    mesGet<PlansResponse>(`/plans?month=${month}`, { items: [], actual: {} }).then((r) => {
      setPlans((r.items || []).filter((p) => p.plan_date === date));
      setChecked(new Set());
      setLoading(false);
    });
  }, [open, date]);

  const filteredEquipment = processId === '' ? equipment : equipment.filter((e) => e.process_id === processId);

  const toggle = (idx: number) => setChecked((s) => { const n = new Set(s); n.has(idx) ? n.delete(idx) : n.add(idx); return n; });
  const toggleAll = () => setChecked((s) => (s.size === plans.length ? new Set() : new Set(plans.map((_, i) => i))));

  const submit = async () => {
    if (checked.size === 0) { showToast('생성할 계획을 선택하세요', 'danger'); return; }
    if (processId === '') { showToast('공정을 선택하세요', 'danger'); return; }
    setSaving(true);
    const items = plans.filter((_, i) => checked.has(i)).map((p) => ({
      order_date: p.plan_date, item_id: p.item_id || undefined, item_name: p.item_name, family_code: p.family_code || undefined,
      process_id: processId, equipment_id: equipmentId === '' ? undefined : equipmentId, plan_qty: p.plan_qty, unit: p.unit || 'ea',
    }));
    const r = await mesPost('/work-orders/bulk', { items });
    setSaving(false);
    if (!r.ok) { showToast(r.error || '일괄 생성 실패', 'danger'); return; }
    showToast(`${items.length}건 작업지시를 생성했습니다`);
    onSaved();
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="생산계획 → 작업지시 일괄생성" width="max-w-2xl"
      footer={<>
        <button className={`${C.btn} ${C.btnGhost}`} onClick={onClose}>취소</button>
        <button className={`${C.btn} ${C.btnPrimary}`} disabled={saving} onClick={submit}>{saving ? '생성 중…' : `선택 ${checked.size}건 생성`}</button>
      </>}>
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div>
          <label className={C.label}>대상 일자</label>
          <input type="date" className={`${C.input} w-full`} value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div>
          <label className={C.label}>공정(기본값)</label>
          <select className={`${C.select} w-full`} value={processId} onChange={(e) => { setProcessId(e.target.value ? Number(e.target.value) : ''); setEquipmentId(''); }}>
            <option value="">선택</option>
            {processes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div>
          <label className={C.label}>설비(기본값)</label>
          <select className={`${C.select} w-full`} value={equipmentId} onChange={(e) => setEquipmentId(e.target.value ? Number(e.target.value) : '')}>
            <option value="">미배정</option>
            {filteredEquipment.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </div>
      </div>
      {loading ? (
        <div className="text-sm text-text-tertiary py-8 text-center">불러오는 중…</div>
      ) : plans.length === 0 ? (
        <EmptyState title="해당 일자의 생산계획이 없습니다" sub="생산계획 탭에서 먼저 계획을 등록하세요" />
      ) : (
        <div className={`${C.card} overflow-hidden`}>
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={C.th}><input type="checkbox" checked={checked.size === plans.length} onChange={toggleAll} /></th>
                <th className={C.th}>품명</th>
                <th className={C.th}>제품군</th>
                <th className={`${C.th} text-right`}>계획수량</th>
              </tr>
            </thead>
            <tbody>
              {plans.map((p, i) => (
                <tr key={i} className="hover:bg-bg-inset/60 cursor-pointer" onClick={() => toggle(i)}>
                  <td className={C.td} onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={checked.has(i)} onChange={() => toggle(i)} /></td>
                  <td className={`${C.td} text-text-primary font-medium`}>{p.item_name}</td>
                  <td className={C.td}>{p.family_code || '-'}</td>
                  <td className={C.tdNum}>{fmt(p.plan_qty)} {p.unit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
