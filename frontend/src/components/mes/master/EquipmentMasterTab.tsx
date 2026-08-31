'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { mesGet, mesPost, mesDelete, type MesEquipment, type MesProcess } from '@/lib/mes/api';
import { C, Pill, Modal, EmptyState } from '@/lib/mes/ui';
import { Toolbar, FieldRow, FormGrid, RowActions, FLOORS } from './_shared';

const EQ_TYPES = ['로터리오븐', '터널오븐', '데크오븐', '배합기', '금속검출기', '급속동결기', '냉각실', '창고', '기타'];

const emptyForm = (): Partial<MesEquipment> => ({
  code: '', name: '', process_id: undefined, floor: '2F', unit_label: '', eq_type: '로터리오븐',
  maker: '', model: '', spec: '', purchase_date: '', purchase_amount: undefined, plc_yn: false, sort_order: 0, notes: '', is_active: true,
});

export default function EquipmentMasterTab({ showToast }: { showToast: (msg: string, tone?: 'success' | 'danger' | 'info') => void }) {
  const [items, setItems] = useState<MesEquipment[]>([]);
  const [processes, setProcesses] = useState<MesProcess[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [activeOnly, setActiveOnly] = useState(true);
  const [floorFilter, setFloorFilter] = useState('전체');
  const [processFilter, setProcessFilter] = useState('전체');
  const [typeFilter, setTypeFilter] = useState('전체');
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState<Partial<MesEquipment>>(emptyForm());

  const load = async () => {
    setLoading(true);
    const [e, p] = await Promise.all([
      mesGet<{ items: MesEquipment[] }>('/equipment', { items: [] }),
      mesGet<{ items: MesProcess[] }>('/processes', { items: [] }),
    ]);
    setItems(e.items || []);
    setProcesses(p.items || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => items
    .filter((e) => !activeOnly || e.is_active)
    .filter((e) => floorFilter === '전체' || (e.floor || '-') === floorFilter)
    .filter((e) => processFilter === '전체' || String(e.process_id ?? '') === processFilter)
    .filter((e) => typeFilter === '전체' || (e.eq_type || '') === typeFilter)
    .filter((e) => !q || `${e.code}${e.name}${e.maker || ''}${e.model || ''}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (a.floor || '').localeCompare(b.floor || '') || (a.sort_order - b.sort_order) || a.code.localeCompare(b.code)), [items, q, activeOnly, floorFilter, processFilter, typeFilter]);

  const grouped = useMemo(() => {
    const map = new Map<string, MesEquipment[]>();
    filtered.forEach((e) => { const k = e.floor || '미지정'; if (!map.has(k)) map.set(k, []); map.get(k)!.push(e); });
    return Array.from(map.entries());
  }, [filtered]);

  const openAdd = () => { setForm(emptyForm()); setModal(true); };
  const openEdit = (e: MesEquipment) => { setForm({ ...e }); setModal(true); };

  const save = async () => {
    if (!form.code || !form.name) { showToast('코드·이름은 필수입니다', 'danger'); return; }
    const body = { ...form, process_id: form.process_id ? Number(form.process_id) : null, purchase_amount: form.purchase_amount ? Number(form.purchase_amount) : null };
    const r = await mesPost('/equipment', body);
    if (r.ok) { showToast('저장되었습니다'); setModal(false); load(); } else showToast(r.error || '저장 실패', 'danger');
  };
  const deactivate = async (id: number) => {
    const r = await mesDelete(`/equipment/${id}`);
    if (r.ok) { showToast('비활성 처리되었습니다'); load(); } else showToast(r.error || '실패', 'danger');
  };

  return (
    <div>
      <Toolbar
        q={q} setQ={setQ} placeholder="코드/이름/메이커/모델 검색" activeOnly={activeOnly} setActiveOnly={setActiveOnly} onAdd={openAdd}
        right={<>
          <select className={C.select} value={floorFilter} onChange={(e) => setFloorFilter(e.target.value)}>
            <option value="전체">전체 층</option>
            {FLOORS.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
          <select className={C.select} value={processFilter} onChange={(e) => setProcessFilter(e.target.value)}>
            <option value="전체">전체 공정</option>
            {processes.map((p) => <option key={p.id} value={String(p.id)}>{p.name}</option>)}
          </select>
          <select className={C.select} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="전체">전체 유형</option>
            {EQ_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </>}
      />
      <div className={`${C.card} overflow-x-auto`}>
        <table className="w-full">
          <thead>
            <tr>
              <th className={C.th}>정렬</th><th className={C.th}>코드</th><th className={C.th}>설비명</th><th className={C.th}>층</th>
              <th className={C.th}>유형</th><th className={C.th}>공정</th><th className={C.th}>메이커/모델</th><th className={C.th}>PLC</th><th className={C.th}>활성</th><th className={C.th}></th>
            </tr>
          </thead>
          <tbody>
            {grouped.map(([floor, rows]) => (
              <Fragment key={floor}>
                <tr>
                  <td colSpan={10} className="px-3 py-1.5 text-xs font-bold text-text-tertiary bg-bg-inset/50">{floor} ({rows.length})</td>
                </tr>
                {rows.map((e) => (
                  <tr key={e.id}>
                    <td className={C.tdNum}>{e.sort_order}</td>
                    <td className={C.td}>{e.code}</td>
                    <td className={C.td}>{e.name}{e.unit_label ? ` (${e.unit_label})` : ''}</td>
                    <td className={C.td}>{e.floor || '-'}</td>
                    <td className={C.td}>{e.eq_type || '-'}</td>
                    <td className={C.td}>{e.process_name || '-'}</td>
                    <td className={C.td}>{[e.maker, e.model].filter(Boolean).join(' / ') || '-'}</td>
                    <td className={C.td}>{e.plc_yn ? <Pill tone="brand">PLC</Pill> : '-'}</td>
                    <td className={C.td}><Pill tone={e.is_active ? 'success' : 'muted'}>{e.is_active ? '활성' : '비활성'}</Pill></td>
                    <td className={C.td}><RowActions onEdit={() => openEdit(e)} onDeactivate={() => deactivate(e.id)} isActive={e.is_active} /></td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
        {!loading && filtered.length === 0 && <EmptyState title="등록된 설비가 없습니다" />}
      </div>

      <Modal
        open={modal}
        onClose={() => setModal(false)}
        title={form.id ? '설비 수정' : '설비 추가'}
        width="max-w-3xl"
        footer={<>
          <button onClick={() => setModal(false)} className={`${C.btn} ${C.btnGhost}`}>취소</button>
          <button onClick={save} className={`${C.btn} ${C.btnPrimary}`}>저장</button>
        </>}
      >
        <FormGrid>
          <FieldRow label="코드" required><input className={`${C.input} w-full`} value={form.code || ''} onChange={(e) => setForm({ ...form, code: e.target.value })} /></FieldRow>
          <FieldRow label="설비명" required><input className={`${C.input} w-full`} value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} /></FieldRow>
          <FieldRow label="공정">
            <select className={`${C.select} w-full`} value={form.process_id ? String(form.process_id) : ''} onChange={(e) => setForm({ ...form, process_id: e.target.value ? Number(e.target.value) : undefined })}>
              <option value="">-</option>
              {processes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </FieldRow>
          <FieldRow label="층">
            <select className={`${C.select} w-full`} value={form.floor || '-'} onChange={(e) => setForm({ ...form, floor: e.target.value })}>
              {FLOORS.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </FieldRow>
          <FieldRow label="호기 라벨"><input className={`${C.input} w-full`} placeholder="2F1호기" value={form.unit_label || ''} onChange={(e) => setForm({ ...form, unit_label: e.target.value })} /></FieldRow>
          <FieldRow label="설비유형">
            <select className={`${C.select} w-full`} value={form.eq_type || ''} onChange={(e) => setForm({ ...form, eq_type: e.target.value })}>
              {EQ_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </FieldRow>
          <FieldRow label="메이커"><input className={`${C.input} w-full`} value={form.maker || ''} onChange={(e) => setForm({ ...form, maker: e.target.value })} /></FieldRow>
          <FieldRow label="모델명"><input className={`${C.input} w-full`} value={form.model || ''} onChange={(e) => setForm({ ...form, model: e.target.value })} /></FieldRow>
          <FieldRow label="규격" className="col-span-2"><input className={`${C.input} w-full`} value={form.spec || ''} onChange={(e) => setForm({ ...form, spec: e.target.value })} /></FieldRow>
          <FieldRow label="구매일"><input type="date" className={`${C.input} w-full`} value={form.purchase_date || ''} onChange={(e) => setForm({ ...form, purchase_date: e.target.value })} /></FieldRow>
          <FieldRow label="구매금액"><input type="number" className={`${C.input} w-full`} value={form.purchase_amount ?? ''} onChange={(e) => setForm({ ...form, purchase_amount: e.target.value ? Number(e.target.value) : undefined })} /></FieldRow>
          <FieldRow label="PLC 사용"><label className="flex items-center gap-2 h-[38px] text-sm text-text-secondary"><input type="checkbox" checked={!!form.plc_yn} onChange={(e) => setForm({ ...form, plc_yn: e.target.checked })} /> PLC 연동</label></FieldRow>
          <FieldRow label="정렬순"><input type="number" className={`${C.input} w-full`} value={form.sort_order ?? 0} onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })} /></FieldRow>
          <FieldRow label="활성"><label className="flex items-center gap-2 h-[38px] text-sm text-text-secondary"><input type="checkbox" checked={form.is_active ?? true} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} /> 사용</label></FieldRow>
        </FormGrid>
        <div className="mt-3">
          <FieldRow label="비고"><textarea className={`${C.input} w-full`} rows={2} value={form.notes || ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></FieldRow>
        </div>
      </Modal>
    </div>
  );
}
