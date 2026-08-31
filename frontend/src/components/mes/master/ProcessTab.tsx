'use client';

import { useEffect, useMemo, useState } from 'react';
import { mesGet, mesPost, mesDelete, type MesProcess, type MesEquipment } from '@/lib/mes/api';
import { C, Pill, Modal, EmptyState } from '@/lib/mes/ui';
import { Toolbar, FieldRow, FormGrid, RowActions, FLOORS, POP_KIND_OPTIONS, popKindLabel } from './_shared';

const PROCESS_CLASSES = ['배합', '가열', '급속동결', '금속검출', '포장가공', '성형', '냉각', '기타'];
const FLOW_ORDER = ['배합', '성형', '가열', '냉각', '급속동결', '금속검출', '포장가공'];

const emptyForm = (): Partial<MesProcess> => ({
  code: '', name: '', process_class: '배합', floor: '2F', is_ccp: false, ccp_code: '',
  pop_kind: undefined, sub_kind: '', sort_order: 0, notes: '', is_active: true,
});

export default function ProcessTab({ showToast }: { showToast: (msg: string, tone?: 'success' | 'danger' | 'info') => void }) {
  const [items, setItems] = useState<MesProcess[]>([]);
  const [equip, setEquip] = useState<MesEquipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [activeOnly, setActiveOnly] = useState(true);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState<Partial<MesProcess>>(emptyForm());

  const load = async () => {
    setLoading(true);
    const [p, e] = await Promise.all([
      mesGet<{ items: MesProcess[] }>('/processes', { items: [] }),
      mesGet<{ items: MesEquipment[] }>('/equipment', { items: [] }),
    ]);
    setItems(p.items || []);
    setEquip(e.items || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => items
    .filter((p) => !activeOnly || p.is_active)
    .filter((p) => !q || `${p.code}${p.name}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (a.sort_order - b.sort_order) || a.code.localeCompare(b.code)), [items, q, activeOnly]);

  const openAdd = () => { setForm(emptyForm()); setModal(true); };
  const openEdit = (p: MesProcess) => { setForm({ ...p }); setModal(true); };

  const save = async () => {
    if (!form.code || !form.name) { showToast('코드·이름은 필수입니다', 'danger'); return; }
    const r = await mesPost('/processes', form);
    if (r.ok) { showToast('저장되었습니다'); setModal(false); load(); } else showToast(r.error || '저장 실패', 'danger');
  };
  const deactivate = async (id: number) => {
    const r = await mesDelete(`/processes/${id}`);
    if (r.ok) { showToast('비활성 처리되었습니다'); load(); } else showToast(r.error || '실패', 'danger');
  };

  const flow = FLOW_ORDER.map((cls) => {
    const procs = items.filter((p) => p.process_class === cls && p.is_active);
    const procIds = new Set(procs.map((p) => p.id));
    const eqCount = equip.filter((e) => e.process_id != null && procIds.has(e.process_id) && e.is_active).length;
    return { cls, procCount: procs.length, eqCount };
  });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-4 items-start">
      <div>
        <Toolbar q={q} setQ={setQ} placeholder="코드/이름 검색" activeOnly={activeOnly} setActiveOnly={setActiveOnly} onAdd={openAdd} />
        <div className={`${C.card} overflow-x-auto`}>
          <table className="w-full">
            <thead>
              <tr>
                <th className={C.th}>정렬</th><th className={C.th}>코드</th><th className={C.th}>이름</th><th className={C.th}>구분</th>
                <th className={C.th}>층</th><th className={C.th}>POP종류</th><th className={C.th}>CCP</th><th className={C.th}>활성</th><th className={C.th}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id}>
                  <td className={C.tdNum}>{p.sort_order}</td>
                  <td className={C.td}>{p.code}</td>
                  <td className={C.td}>{p.name}</td>
                  <td className={C.td}>{p.process_class}{p.sub_kind ? ` · ${p.sub_kind}` : ''}</td>
                  <td className={C.td}>{p.floor || '-'}</td>
                  <td className={C.td}>{p.pop_kind ? <Pill tone="info">{popKindLabel(p.pop_kind)}</Pill> : '-'}</td>
                  <td className={C.td}>{p.is_ccp ? <Pill tone="danger">{p.ccp_code || 'CCP'}</Pill> : '-'}</td>
                  <td className={C.td}><Pill tone={p.is_active ? 'success' : 'muted'}>{p.is_active ? '활성' : '비활성'}</Pill></td>
                  <td className={C.td}><RowActions onEdit={() => openEdit(p)} onDeactivate={() => deactivate(p.id)} isActive={p.is_active} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && filtered.length === 0 && <EmptyState title="등록된 공정이 없습니다" />}
        </div>
      </div>

      <div className={C.cardPad}>
        <div className="text-sm font-bold text-text-primary mb-3">공정 흐름</div>
        <div className="flex flex-col gap-2">
          {flow.map((f, i) => (
            <div key={f.cls} className="flex items-center gap-2">
              <div className="flex-1 rounded-lg border border-border-primary bg-bg-0 px-3 py-2">
                <div className="text-xs font-semibold text-text-primary">{i + 1}. {f.cls}</div>
                <div className="text-[11px] text-text-quaternary mt-0.5">공정 {f.procCount} · 설비 {f.eqCount}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <Modal
        open={modal}
        onClose={() => setModal(false)}
        title={form.id ? '공정 수정' : '공정 추가'}
        footer={<>
          <button onClick={() => setModal(false)} className={`${C.btn} ${C.btnGhost}`}>취소</button>
          <button onClick={save} className={`${C.btn} ${C.btnPrimary}`}>저장</button>
        </>}
      >
        <FormGrid>
          <FieldRow label="코드" required><input className={`${C.input} w-full`} value={form.code || ''} onChange={(e) => setForm({ ...form, code: e.target.value })} /></FieldRow>
          <FieldRow label="이름" required><input className={`${C.input} w-full`} value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} /></FieldRow>
          <FieldRow label="구분">
            <select className={`${C.select} w-full`} value={form.process_class || '배합'} onChange={(e) => setForm({ ...form, process_class: e.target.value })}>
              {PROCESS_CLASSES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </FieldRow>
          <FieldRow label="층">
            <select className={`${C.select} w-full`} value={form.floor || '-'} onChange={(e) => setForm({ ...form, floor: e.target.value })}>
              {FLOORS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </FieldRow>
          <FieldRow label="POP 종류">
            <select className={`${C.select} w-full`} value={form.pop_kind || ''} onChange={(e) => setForm({ ...form, pop_kind: (e.target.value || undefined) as any })}>
              <option value="">-</option>
              {POP_KIND_OPTIONS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
            </select>
          </FieldRow>
          <FieldRow label="가열 하위구분"><input className={`${C.input} w-full`} placeholder="굽기/끓임/멜팅/터널" value={form.sub_kind || ''} onChange={(e) => setForm({ ...form, sub_kind: e.target.value })} /></FieldRow>
          <FieldRow label="CCP 여부">
            <label className="flex items-center gap-2 h-[38px] text-sm text-text-secondary"><input type="checkbox" checked={!!form.is_ccp} onChange={(e) => setForm({ ...form, is_ccp: e.target.checked })} /> CCP 공정</label>
          </FieldRow>
          <FieldRow label="CCP 코드"><input className={`${C.input} w-full`} placeholder="CCP-2B" disabled={!form.is_ccp} value={form.ccp_code || ''} onChange={(e) => setForm({ ...form, ccp_code: e.target.value })} /></FieldRow>
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
