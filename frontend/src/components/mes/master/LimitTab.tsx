'use client';

import { useEffect, useMemo, useState } from 'react';
import { mesGet, mesPost, mesDelete, type MesLimit, type MesProcess, type MesCode } from '@/lib/mes/api';
import { C, Pill, Modal, EmptyState } from '@/lib/mes/ui';
import { Toolbar, FieldRow, FormGrid, RowActions } from './_shared';

const PARAMS: { value: string; label: string }[] = [
  { value: 'temp', label: '온도' }, { value: 'time', label: '시간' }, { value: 'alcohol_ratio', label: '주정비율' },
  { value: 'metal', label: '금속' }, { value: 'other', label: '기타' },
];
const paramLabel = (v: string) => PARAMS.find((p) => p.value === v)?.label || v;

const emptyForm = (): Partial<MesLimit> => ({
  process_id: undefined, family_code: '', name: '', param: 'temp', min_value: undefined, max_value: undefined,
  unit: '℃', check_cycle: '', check_method: '', corrective_action: '', alarm_yn: true, notes: '', is_active: true,
});

export default function LimitTab({ showToast }: { showToast: (msg: string, tone?: 'success' | 'danger' | 'info') => void }) {
  const [items, setItems] = useState<MesLimit[]>([]);
  const [processes, setProcesses] = useState<MesProcess[]>([]);
  const [families, setFamilies] = useState<MesCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [processFilter, setProcessFilter] = useState('전체');
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState<Partial<MesLimit>>(emptyForm());
  const [showMatrix, setShowMatrix] = useState(false);

  const load = async () => {
    setLoading(true);
    const [l, p, f] = await Promise.all([
      mesGet<{ items: MesLimit[] }>('/limits', { items: [] }),
      mesGet<{ items: MesProcess[] }>('/processes', { items: [] }),
      mesGet<{ items: MesCode[] }>('/codes?group=FAMILY', { items: [] }),
    ]);
    setItems(l.items || []);
    setProcesses(p.items || []);
    setFamilies((f.items || []).filter((x) => x.is_active));
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => items
    .filter((l) => l.is_active)
    .filter((l) => processFilter === '전체' || String(l.process_id) === processFilter)
    .sort((a, b) => a.process_id - b.process_id), [items, processFilter]);

  const ccpProcesses = useMemo(() => processes.filter((p) => p.is_ccp && p.is_active), [processes]);

  const openAdd = () => { setForm(emptyForm()); setModal(true); };
  const openEdit = (l: MesLimit) => { setForm({ ...l }); setModal(true); };

  const save = async () => {
    if (!form.process_id || !form.name || !form.param) { showToast('공정·기준명·파라미터는 필수입니다', 'danger'); return; }
    const r = await mesPost('/limits', { ...form, process_id: Number(form.process_id), family_code: form.family_code || null });
    if (r.ok) { showToast('저장되었습니다'); setModal(false); load(); } else showToast(r.error || '저장 실패', 'danger');
  };
  const deactivate = async (id: number) => {
    const r = await mesDelete(`/limits/${id}`);
    if (r.ok) { showToast('비활성 처리되었습니다'); load(); } else showToast(r.error || '실패', 'danger');
  };

  const rangeText = (l: MesLimit) => {
    const u = l.unit || '';
    if (l.min_value != null && l.max_value != null) return `${l.min_value}~${l.max_value}${u}`;
    if (l.min_value != null) return `≥${l.min_value}${u}`;
    if (l.max_value != null) return `≤${l.max_value}${u}`;
    return '-';
  };

  const matrixRows = [{ code: '', name: '공통' }, ...families.map((f) => ({ code: f.code, name: f.name }))];

  return (
    <div>
      <Toolbar
        q="" setQ={() => {}} activeOnly={true} setActiveOnly={() => {}} onAdd={openAdd}
        right={<>
          <select className={C.select} value={processFilter} onChange={(e) => setProcessFilter(e.target.value)}>
            <option value="전체">전체 공정</option>
            {processes.map((p) => <option key={p.id} value={String(p.id)}>{p.name}</option>)}
          </select>
          <button onClick={() => setShowMatrix((v) => !v)} className={`${C.btn} ${showMatrix ? C.btnPrimary : C.btnGhost}`}>매트릭스 뷰</button>
        </>}
      />

      {showMatrix && (
        <div className={`${C.card} overflow-x-auto mb-4 p-3`}>
          <table className="w-full">
            <thead>
              <tr>
                <th className={C.th}>제품군</th>
                {ccpProcesses.map((p) => <th key={p.id} className={C.th}>{p.name}</th>)}
              </tr>
            </thead>
            <tbody>
              {matrixRows.map((row) => (
                <tr key={row.code || '__common__'}>
                  <td className={C.td}>{row.name}</td>
                  {ccpProcesses.map((p) => {
                    const cell = items.filter((l) => l.is_active && l.process_id === p.id && (l.family_code || '') === row.code);
                    return <td key={p.id} className={C.td}>{cell.length ? cell.map((c) => rangeText(c)).join(', ') : '-'}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className={`${C.card} overflow-x-auto`}>
        <table className="w-full">
          <thead>
            <tr>
              <th className={C.th}>공정</th><th className={C.th}>제품군</th><th className={C.th}>기준명</th><th className={C.th}>파라미터</th>
              <th className={C.th}>범위</th><th className={C.th}>점검주기</th><th className={C.th}>점검방법</th><th className={C.th}>개선조치</th><th className={C.th}>알람</th><th className={C.th}></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((l) => (
              <tr key={l.id}>
                <td className={C.td}>{l.process_name || processes.find((p) => p.id === l.process_id)?.name || l.process_id}</td>
                <td className={C.td}>{l.family_code ? (families.find((f) => f.code === l.family_code)?.name || l.family_code) : '공통'}</td>
                <td className={C.td}>{l.name}</td>
                <td className={C.td}>{paramLabel(l.param)}</td>
                <td className={C.td}>{rangeText(l)}</td>
                <td className={C.td}>{l.check_cycle || '-'}</td>
                <td className={C.td}>{l.check_method || '-'}</td>
                <td className={C.td}>{l.corrective_action || '-'}</td>
                <td className={C.td}>{l.alarm_yn ? <Pill tone="danger">알람</Pill> : '-'}</td>
                <td className={C.td}><RowActions onEdit={() => openEdit(l)} onDeactivate={() => deactivate(l.id)} isActive={l.is_active} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && filtered.length === 0 && <EmptyState title="등록된 한계기준이 없습니다" />}
      </div>

      <Modal
        open={modal}
        onClose={() => setModal(false)}
        title={form.id ? '한계기준 수정' : '한계기준 추가'}
        width="max-w-3xl"
        footer={<>
          <button onClick={() => setModal(false)} className={`${C.btn} ${C.btnGhost}`}>취소</button>
          <button onClick={save} className={`${C.btn} ${C.btnPrimary}`}>저장</button>
        </>}
      >
        <FormGrid>
          <FieldRow label="공정" required>
            <select className={`${C.select} w-full`} value={form.process_id ? String(form.process_id) : ''} onChange={(e) => setForm({ ...form, process_id: e.target.value ? Number(e.target.value) : undefined })}>
              <option value="">선택</option>
              {processes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </FieldRow>
          <FieldRow label="제품군">
            <select className={`${C.select} w-full`} value={form.family_code || ''} onChange={(e) => setForm({ ...form, family_code: e.target.value })}>
              <option value="">공통</option>
              {families.map((f) => <option key={f.code} value={f.code}>{f.name}</option>)}
            </select>
          </FieldRow>
          <FieldRow label="기준명" required className="col-span-2"><input className={`${C.input} w-full`} value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} /></FieldRow>
          <FieldRow label="파라미터">
            <select className={`${C.select} w-full`} value={form.param || 'temp'} onChange={(e) => setForm({ ...form, param: e.target.value })}>
              {PARAMS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </FieldRow>
          <FieldRow label="단위"><input className={`${C.input} w-full`} value={form.unit || ''} onChange={(e) => setForm({ ...form, unit: e.target.value })} /></FieldRow>
          <FieldRow label="최소값"><input type="number" className={`${C.input} w-full`} value={form.min_value ?? ''} onChange={(e) => setForm({ ...form, min_value: e.target.value ? Number(e.target.value) : undefined })} /></FieldRow>
          <FieldRow label="최대값"><input type="number" className={`${C.input} w-full`} value={form.max_value ?? ''} onChange={(e) => setForm({ ...form, max_value: e.target.value ? Number(e.target.value) : undefined })} /></FieldRow>
          <FieldRow label="점검주기"><input className={`${C.input} w-full`} placeholder="배치마다/1일 1회 등" value={form.check_cycle || ''} onChange={(e) => setForm({ ...form, check_cycle: e.target.value })} /></FieldRow>
          <FieldRow label="알람"><label className="flex items-center gap-2 h-[38px] text-sm text-text-secondary"><input type="checkbox" checked={form.alarm_yn ?? true} onChange={(e) => setForm({ ...form, alarm_yn: e.target.checked })} /> 이탈 시 알람</label></FieldRow>
          <FieldRow label="점검방법" className="col-span-2"><input className={`${C.input} w-full`} value={form.check_method || ''} onChange={(e) => setForm({ ...form, check_method: e.target.value })} /></FieldRow>
          <FieldRow label="개선조치" className="col-span-2"><input className={`${C.input} w-full`} value={form.corrective_action || ''} onChange={(e) => setForm({ ...form, corrective_action: e.target.value })} /></FieldRow>
        </FormGrid>
        <div className="mt-3">
          <FieldRow label="비고"><textarea className={`${C.input} w-full`} rows={2} value={form.notes || ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></FieldRow>
        </div>
      </Modal>
    </div>
  );
}
