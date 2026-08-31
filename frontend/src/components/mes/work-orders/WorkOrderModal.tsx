'use client';

import { useEffect, useState } from 'react';
import { mesGet, mesPost, type MesCode, type MesEquipment, type MesItem, type MesProcess, type MesWorker, type WorkOrder } from '@/lib/mes/api';
import { C, Modal, todayISO } from '@/lib/mes/ui';
import { Combobox } from '@/components/Combobox';

interface FormState {
  id?: number;
  order_date: string;
  item_id?: number | null;
  item_name: string;
  family_code: string;
  process_id: number | '';
  equipment_id: number | '';
  plan_qty: string;
  unit: string;
  batch_count: string;
  priority: number;
  lot_no: string;
  expiry_date: string;
  notes: string;
  worker_ids: number[];
  auto_bom: boolean;
}

const emptyForm = (): FormState => ({
  order_date: todayISO(), item_id: null, item_name: '', family_code: '', process_id: '', equipment_id: '',
  plan_qty: '', unit: 'ea', batch_count: '', priority: 3, lot_no: '', expiry_date: '', notes: '', worker_ids: [], auto_bom: true,
});

export function WorkOrderModal({ open, onClose, onSaved, editing, processes, equipment, workers, showToast }: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  editing: WorkOrder | null;
  processes: MesProcess[];
  equipment: MesEquipment[];
  workers: MesWorker[];
  showToast: (msg: string, tone?: 'success' | 'danger' | 'info') => void;
}) {
  const [form, setForm] = useState<FormState>(emptyForm());
  const [itemQuery, setItemQuery] = useState('');
  const [families, setFamilies] = useState<MesCode[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    mesGet<{ items: MesCode[] }>('/codes?group=FAMILY', { items: [] }).then((r) => setFamilies(r.items || []));
    if (editing) {
      setForm({
        id: editing.id,
        order_date: editing.order_date,
        item_id: editing.item_id ?? null,
        item_name: editing.item_name,
        family_code: editing.family_code || '',
        process_id: editing.process_id,
        equipment_id: editing.equipment_id ?? '',
        plan_qty: String(editing.plan_qty ?? ''),
        unit: editing.unit || 'ea',
        batch_count: editing.batch_count != null ? String(editing.batch_count) : '',
        priority: editing.priority || 3,
        lot_no: editing.lot_no || '',
        expiry_date: editing.expiry_date || '',
        notes: editing.notes || '',
        worker_ids: (editing.workers || []).map((w) => w.id),
        auto_bom: false,
      });
      setItemQuery(editing.item_name);
    } else {
      setForm(emptyForm());
      setItemQuery('');
    }
  }, [open, editing]);

  const filteredEquipment = form.process_id === '' ? equipment : equipment.filter((e) => e.process_id === form.process_id);

  const submit = async () => {
    if (!form.item_name.trim()) { showToast('품목명을 입력하세요', 'danger'); return; }
    if (form.process_id === '') { showToast('공정을 선택하세요', 'danger'); return; }
    if (!form.plan_qty || Number(form.plan_qty) <= 0) { showToast('계획수량을 입력하세요', 'danger'); return; }
    setSaving(true);
    const body: Record<string, any> = {
      order_date: form.order_date,
      item_id: form.item_id || undefined,
      item_name: form.item_name.trim(),
      family_code: form.family_code || undefined,
      process_id: form.process_id,
      equipment_id: form.equipment_id === '' ? undefined : form.equipment_id,
      plan_qty: Number(form.plan_qty),
      unit: form.unit || 'ea',
      batch_count: form.batch_count ? Number(form.batch_count) : undefined,
      priority: form.priority,
      lot_no: form.lot_no || undefined,
      expiry_date: form.expiry_date || undefined,
      notes: form.notes || undefined,
      worker_ids: form.worker_ids,
    };
    if (form.id) body.id = form.id;
    const r = await mesPost<WorkOrder>('/work-orders', body);
    if (!r.ok) { setSaving(false); showToast(r.error || '저장 실패', 'danger'); return; }
    if (form.auto_bom && r.data?.id) {
      await mesPost(`/work-orders/${r.data.id}/materials/from-bom`);
    }
    setSaving(false);
    showToast(form.id ? '작업지시를 수정했습니다' : '작업지시를 등록했습니다');
    onSaved();
    onClose();
  };

  const toggleWorker = (id: number) => {
    setForm((f) => ({ ...f, worker_ids: f.worker_ids.includes(id) ? f.worker_ids.filter((w) => w !== id) : [...f.worker_ids, id] }));
  };

  return (
    <Modal open={open} onClose={onClose} title={form.id ? '작업지시 수정' : '작업지시 등록'} width="max-w-3xl"
      footer={<>
        <button className={`${C.btn} ${C.btnGhost}`} onClick={onClose}>취소</button>
        <button className={`${C.btn} ${C.btnPrimary}`} disabled={saving} onClick={submit}>{saving ? '저장 중…' : '저장'}</button>
      </>}>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={C.label}>지시일</label>
          <input type="date" className={`${C.input} w-full`} value={form.order_date} onChange={(e) => setForm({ ...form, order_date: e.target.value })} />
        </div>
        <div>
          <label className={C.label}>제품군(FAMILY)</label>
          <select className={`${C.select} w-full`} value={form.family_code} onChange={(e) => setForm({ ...form, family_code: e.target.value })}>
            <option value="">선택 안 함</option>
            {families.map((f) => <option key={f.id} value={f.code}>{f.name}</option>)}
          </select>
        </div>
        <div className="col-span-2">
          <label className={C.label}>품목 (검색 또는 직접 입력)</label>
          <Combobox<MesItem>
            value={itemQuery}
            onChange={(v) => { setItemQuery(v); setForm((f) => ({ ...f, item_name: v, item_id: null })); }}
            fetcher={(q) => mesGet<{ items: MesItem[] }>(`/items?q=${encodeURIComponent(q)}`, { items: [] }).then((r) => r.items || [])}
            getLabel={(it) => it.name}
            render={(it) => <div><div className="font-medium text-text-primary">{it.name}</div><div className="text-[11px] text-text-tertiary">{it.item_type || ''} {it.family_code ? `· ${it.family_code}` : ''}</div></div>}
            onPick={(it) => setForm((f) => ({ ...f, item_id: it.id, item_name: it.name, family_code: it.family_code || f.family_code }))}
            placeholder="품목명을 검색하세요"
          />
        </div>
        <div>
          <label className={C.label}>공정</label>
          <select className={`${C.select} w-full`} value={form.process_id} onChange={(e) => setForm({ ...form, process_id: e.target.value ? Number(e.target.value) : '', equipment_id: '' })}>
            <option value="">선택</option>
            {processes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div>
          <label className={C.label}>설비</label>
          <select className={`${C.select} w-full`} value={form.equipment_id} onChange={(e) => setForm({ ...form, equipment_id: e.target.value ? Number(e.target.value) : '' })}>
            <option value="">미배정</option>
            {filteredEquipment.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </div>
        <div>
          <label className={C.label}>계획수량</label>
          <input type="number" className={`${C.input} w-full`} value={form.plan_qty} onChange={(e) => setForm({ ...form, plan_qty: e.target.value })} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={C.label}>단위</label>
            <input className={`${C.input} w-full`} value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} />
          </div>
          <div>
            <label className={C.label}>판수량</label>
            <input type="number" className={`${C.input} w-full`} value={form.batch_count} onChange={(e) => setForm({ ...form, batch_count: e.target.value })} />
          </div>
        </div>
        <div className="col-span-2">
          <label className={C.label}>우선순위</label>
          <div className="flex gap-1.5">
            {[1, 2, 3, 4, 5].map((p) => (
              <button key={p} type="button" onClick={() => setForm({ ...form, priority: p })}
                className={`${C.btn} flex-1 ${form.priority === p ? `${C.btnPrimary}` : C.btnGhost}`}>{p}</button>
            ))}
          </div>
        </div>
        <div>
          <label className={C.label}>LOT 번호</label>
          <input className={`${C.input} w-full`} value={form.lot_no} onChange={(e) => setForm({ ...form, lot_no: e.target.value })} />
        </div>
        <div>
          <label className={C.label}>유통기한</label>
          <input type="date" className={`${C.input} w-full`} value={form.expiry_date} onChange={(e) => setForm({ ...form, expiry_date: e.target.value })} />
        </div>
        <div className="col-span-2">
          <label className={C.label}>작업자</label>
          <div className="flex flex-wrap gap-1.5">
            {workers.map((w) => (
              <button key={w.id} type="button" onClick={() => toggleWorker(w.id)}
                className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors ${form.worker_ids.includes(w.id) ? 'bg-brand text-white border-brand' : 'bg-bg-inset text-text-secondary border-border-primary hover:border-brand'}`}>
                {w.name}
              </button>
            ))}
          </div>
        </div>
        <div className="col-span-2">
          <label className={C.label}>비고</label>
          <textarea className={`${C.input} w-full`} rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </div>
        <div className="col-span-2 flex items-center gap-2">
          <input id="auto_bom" type="checkbox" checked={form.auto_bom} onChange={(e) => setForm({ ...form, auto_bom: e.target.checked })} />
          <label htmlFor="auto_bom" className="text-sm text-text-secondary">저장 시 BOM 자재 자동투입</label>
        </div>
      </div>
    </Modal>
  );
}
