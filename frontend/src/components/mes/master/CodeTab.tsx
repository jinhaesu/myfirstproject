'use client';

import { useEffect, useMemo, useState } from 'react';
import { mesGet, mesPost, mesDelete, type MesCode } from '@/lib/mes/api';
import { C, Pill, Modal, EmptyState } from '@/lib/mes/ui';
import { Toolbar, FieldRow, FormGrid, RowActions } from './_shared';

const GROUPS: { key: string; label: string }[] = [
  { key: 'DOWNTIME', label: '비가동유형' },
  { key: 'DEFECT', label: '불량유형' },
  { key: 'DEVIATION', label: '이탈유형' },
  { key: 'EQ_EVENT', label: '설비이벤트' },
];

const emptyForm = (group: string): Partial<MesCode> => ({ code: '', name: '', group_code: group, sort_order: 0, is_active: true, notes: '' });

export default function CodeTab({ showToast }: { showToast: (msg: string, tone?: 'success' | 'danger' | 'info') => void }) {
  const [group, setGroup] = useState('DOWNTIME');
  const [items, setItems] = useState<MesCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [activeOnly, setActiveOnly] = useState(true);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState<Partial<MesCode>>(emptyForm(group));

  const load = async () => {
    setLoading(true);
    const r = await mesGet<{ items: MesCode[] }>(`/codes?group=${group}`, { items: [] });
    setItems(r.items || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, [group]);

  const filtered = useMemo(() => items
    .filter((c) => !activeOnly || c.is_active)
    .filter((c) => !q || `${c.code}${c.name}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (a.sort_order - b.sort_order) || a.code.localeCompare(b.code)), [items, q, activeOnly]);

  const openAdd = () => { setForm(emptyForm(group)); setModal(true); };
  const openEdit = (c: MesCode) => { setForm({ ...c }); setModal(true); };

  const save = async () => {
    if (!form.code || !form.name) { showToast('코드·이름은 필수입니다', 'danger'); return; }
    const r = await mesPost('/codes', { ...form, group_code: group });
    if (r.ok) { showToast('저장되었습니다'); setModal(false); load(); } else showToast(r.error || '저장 실패', 'danger');
  };
  const deactivate = async (id: number) => {
    const r = await mesDelete(`/codes/${id}`);
    if (r.ok) { showToast('비활성 처리되었습니다'); load(); } else showToast(r.error || '실패', 'danger');
  };

  return (
    <div>
      <div className="flex gap-1 mb-4">
        {GROUPS.map((g) => (
          <button key={g.key} onClick={() => setGroup(g.key)} className={`${C.btn} ${group === g.key ? C.btnPrimary : C.btnGhost}`}>{g.label}</button>
        ))}
      </div>
      <Toolbar q={q} setQ={setQ} placeholder="코드/이름 검색" activeOnly={activeOnly} setActiveOnly={setActiveOnly} onAdd={openAdd} />
      <div className={`${C.card} overflow-x-auto`}>
        <table className="w-full">
          <thead>
            <tr><th className={C.th}>정렬</th><th className={C.th}>코드</th><th className={C.th}>이름</th><th className={C.th}>비고</th><th className={C.th}>활성</th><th className={C.th}></th></tr>
          </thead>
          <tbody>
            {filtered.map((c) => (
              <tr key={c.id}>
                <td className={C.tdNum}>{c.sort_order}</td>
                <td className={C.td}>{c.code}</td>
                <td className={C.td}>{c.name}</td>
                <td className={C.td}>{c.notes || '-'}</td>
                <td className={C.td}><Pill tone={c.is_active ? 'success' : 'muted'}>{c.is_active ? '활성' : '비활성'}</Pill></td>
                <td className={C.td}><RowActions onEdit={() => openEdit(c)} onDeactivate={() => deactivate(c.id)} isActive={c.is_active} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && filtered.length === 0 && <EmptyState title="등록된 코드가 없습니다" />}
      </div>

      <Modal
        open={modal}
        onClose={() => setModal(false)}
        title={form.id ? '공통코드 수정' : '공통코드 추가'}
        footer={<>
          <button onClick={() => setModal(false)} className={`${C.btn} ${C.btnGhost}`}>취소</button>
          <button onClick={save} className={`${C.btn} ${C.btnPrimary}`}>저장</button>
        </>}
      >
        <FormGrid>
          <FieldRow label="코드" required><input className={`${C.input} w-full`} value={form.code || ''} onChange={(e) => setForm({ ...form, code: e.target.value })} /></FieldRow>
          <FieldRow label="이름" required><input className={`${C.input} w-full`} value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} /></FieldRow>
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
