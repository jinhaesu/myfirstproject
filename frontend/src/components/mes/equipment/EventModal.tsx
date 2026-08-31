'use client';

import { useEffect, useState } from 'react';
import { mesPost, type MesEquipment } from '@/lib/mes/api';
import { C, Modal, todayISO } from '@/lib/mes/ui';
import { EVENT_TYPES } from './_shared';

interface FormState {
  equipment_id: number | '';
  event_type: string;
  event_date: string;
  description: string;
  part_name: string;
  cost: string;
  done_by: string;
  downtime_minutes: string;
  status: 'open' | 'closed';
}

const emptyForm = (equipmentId?: number | null): FormState => ({
  equipment_id: equipmentId ?? '', event_type: EVENT_TYPES[0], event_date: todayISO(), description: '',
  part_name: '', cost: '', done_by: '', downtime_minutes: '', status: 'open',
});

export default function EventModal({
  open, onClose, equipmentOptions, presetEquipmentId, eventTypes, onSaved, showToast,
}: {
  open: boolean; onClose: () => void; equipmentOptions: MesEquipment[]; presetEquipmentId?: number | null;
  eventTypes?: string[]; onSaved: () => void; showToast: (msg: string, tone?: 'success' | 'danger' | 'info') => void;
}) {
  const [form, setForm] = useState<FormState>(emptyForm(presetEquipmentId));

  useEffect(() => { if (open) setForm(emptyForm(presetEquipmentId)); }, [open, presetEquipmentId]);

  const types = eventTypes && eventTypes.length > 0 ? eventTypes : EVENT_TYPES;

  const save = async () => {
    if (!form.equipment_id) { showToast('설비를 선택하세요', 'danger'); return; }
    if (!form.event_date) { showToast('일자를 입력하세요', 'danger'); return; }
    const body = {
      equipment_id: Number(form.equipment_id),
      event_type: form.event_type,
      event_date: form.event_date,
      description: form.description || null,
      part_name: form.part_name || null,
      cost: form.cost ? Number(form.cost) : null,
      done_by: form.done_by || null,
      downtime_minutes: form.downtime_minutes ? Number(form.downtime_minutes) : null,
      status: form.status,
    };
    const r = await mesPost('/equipment-events', body);
    if (r.ok) { showToast('이력이 등록되었습니다'); onSaved(); onClose(); } else showToast(r.error || '등록 실패', 'danger');
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="설비 이력 등록"
      footer={<>
        <button onClick={onClose} className={`${C.btn} ${C.btnGhost}`}>취소</button>
        <button onClick={save} className={`${C.btn} ${C.btnPrimary}`}>저장</button>
      </>}
    >
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={C.label}>설비<span className="text-danger ml-0.5">*</span></label>
          <select className={`${C.select} w-full`} value={form.equipment_id} onChange={(e) => setForm({ ...form, equipment_id: e.target.value ? Number(e.target.value) : '' })} disabled={!!presetEquipmentId}>
            <option value="">선택</option>
            {equipmentOptions.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </div>
        <div>
          <label className={C.label}>이벤트 유형</label>
          <select className={`${C.select} w-full`} value={form.event_type} onChange={(e) => setForm({ ...form, event_type: e.target.value })}>
            {types.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className={C.label}>일자<span className="text-danger ml-0.5">*</span></label>
          <input type="date" className={`${C.input} w-full`} value={form.event_date} onChange={(e) => setForm({ ...form, event_date: e.target.value })} />
        </div>
        <div>
          <label className={C.label}>상태</label>
          <select className={`${C.select} w-full`} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as 'open' | 'closed' })}>
            <option value="open">진행중</option>
            <option value="closed">마감</option>
          </select>
        </div>
        <div>
          <label className={C.label}>부품명</label>
          <input className={`${C.input} w-full`} value={form.part_name} onChange={(e) => setForm({ ...form, part_name: e.target.value })} />
        </div>
        <div>
          <label className={C.label}>비용</label>
          <input type="number" className={`${C.input} w-full`} value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} />
        </div>
        <div>
          <label className={C.label}>담당자</label>
          <input className={`${C.input} w-full`} value={form.done_by} onChange={(e) => setForm({ ...form, done_by: e.target.value })} />
        </div>
        <div>
          <label className={C.label}>정지시간(분)</label>
          <input type="number" className={`${C.input} w-full`} value={form.downtime_minutes} onChange={(e) => setForm({ ...form, downtime_minutes: e.target.value })} />
        </div>
        <div className="col-span-2">
          <label className={C.label}>내용</label>
          <textarea className={`${C.input} w-full`} rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>
      </div>
    </Modal>
  );
}
