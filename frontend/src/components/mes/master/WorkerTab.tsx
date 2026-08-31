'use client';

import { useEffect, useMemo, useState } from 'react';
import { mesGet, mesPost, mesDelete, type MesWorker } from '@/lib/mes/api';
import { C, Pill, Modal, EmptyState, StatCard, todayISO, type Tone } from '@/lib/mes/ui';
import { Toolbar, FieldRow, FormGrid, RowActions, FLOORS } from './_shared';

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addYears = (s: string, n: number) => { const d = new Date(s + 'T00:00:00'); d.setFullYear(d.getFullYear() + n); return iso(d); };
const dDay = (next?: string | null): number | null => {
  if (!next) return null;
  const a = new Date(todayISO() + 'T00:00:00').getTime();
  const b = new Date(next + 'T00:00:00').getTime();
  return Math.round((b - a) / 86400000);
};
function certBadge(next?: string | null): { tone: Tone; label: string } {
  const d = dDay(next);
  if (d === null) return { tone: 'muted', label: '미등록' };
  if (d < 0) return { tone: 'danger', label: `만료 D+${Math.abs(d)}` };
  if (d <= 30) return { tone: 'warning', label: `D-${d}` };
  return { tone: 'success', label: `D-${d}` };
}

const emptyForm = (): Partial<MesWorker> => ({
  name: '', department: '', default_floor: '2F', phone: '', health_cert_date: '', health_cert_next: '', sort_order: 0, notes: '', is_active: true,
});

export default function WorkerTab({ showToast }: { showToast: (msg: string, tone?: 'success' | 'danger' | 'info') => void }) {
  const [items, setItems] = useState<MesWorker[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [activeOnly, setActiveOnly] = useState(true);
  const [dueSoonOnly, setDueSoonOnly] = useState(false);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState<Partial<MesWorker>>(emptyForm());

  const load = async () => {
    setLoading(true);
    const r = await mesGet<{ items: MesWorker[] }>('/workers', { items: [] });
    setItems(r.items || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const stats = useMemo(() => {
    const active = items.filter((w) => w.is_active);
    const dueSoon = active.filter((w) => { const d = dDay(w.health_cert_next); return d !== null && d >= 0 && d <= 30; });
    const expired = active.filter((w) => { const d = dDay(w.health_cert_next); return d !== null && d < 0; });
    return { total: active.length, dueSoon: dueSoon.length, expired: expired.length };
  }, [items]);

  const filtered = useMemo(() => items
    .filter((w) => !activeOnly || w.is_active)
    .filter((w) => !q || `${w.name}${w.department || ''}`.toLowerCase().includes(q.toLowerCase()))
    .filter((w) => { if (!dueSoonOnly) return true; const d = dDay(w.health_cert_next); return d !== null && d <= 30; })
    .sort((a, b) => (a.sort_order - b.sort_order) || a.name.localeCompare(b.name)), [items, q, activeOnly, dueSoonOnly]);

  const openAdd = () => { setForm(emptyForm()); setModal(true); };
  const openEdit = (w: MesWorker) => { setForm({ ...w }); setModal(true); };

  const onCertDateChange = (v: string) => {
    setForm((f) => ({ ...f, health_cert_date: v, health_cert_next: v ? addYears(v, 1) : f.health_cert_next }));
  };

  const save = async () => {
    if (!form.name) { showToast('이름은 필수입니다', 'danger'); return; }
    const r = await mesPost('/workers', form);
    if (r.ok) { showToast('저장되었습니다'); setModal(false); load(); } else showToast(r.error || '저장 실패', 'danger');
  };
  const deactivate = async (id: number) => {
    const r = await mesDelete(`/workers/${id}`);
    if (r.ok) { showToast('비활성 처리되었습니다'); load(); } else showToast(r.error || '실패', 'danger');
  };

  return (
    <div>
      <div className="grid grid-cols-3 gap-3 mb-4 max-w-xl">
        <StatCard label="전체 작업자" value={stats.total} />
        <StatCard label="보건증 만료임박(30일)" value={stats.dueSoon} tone="text-warning" />
        <StatCard label="보건증 만료" value={stats.expired} tone="text-danger" />
      </div>
      <Toolbar
        q={q} setQ={setQ} placeholder="이름/부서 검색" activeOnly={activeOnly} setActiveOnly={setActiveOnly} onAdd={openAdd}
        right={
          <label className="flex items-center gap-1.5 text-xs text-text-tertiary cursor-pointer select-none">
            <input type="checkbox" checked={dueSoonOnly} onChange={(e) => setDueSoonOnly(e.target.checked)} /> 만료 임박만
          </label>
        }
      />
      <div className={`${C.card} overflow-x-auto`}>
        <table className="w-full">
          <thead>
            <tr>
              <th className={C.th}>정렬</th><th className={C.th}>이름</th><th className={C.th}>부서</th><th className={C.th}>기본층</th>
              <th className={C.th}>연락처</th><th className={C.th}>검진일</th><th className={C.th}>다음검진</th><th className={C.th}>보건증</th><th className={C.th}>활성</th><th className={C.th}></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((w) => {
              const badge = certBadge(w.health_cert_next);
              return (
                <tr key={w.id}>
                  <td className={C.tdNum}>{w.sort_order}</td>
                  <td className={C.td}>{w.name}</td>
                  <td className={C.td}>{w.department || '-'}</td>
                  <td className={C.td}>{w.default_floor || '-'}</td>
                  <td className={C.td}>{w.phone || '-'}</td>
                  <td className={C.td}>{w.health_cert_date || '-'}</td>
                  <td className={C.td}>{w.health_cert_next || '-'}</td>
                  <td className={C.td}><Pill tone={badge.tone}>{badge.label}</Pill></td>
                  <td className={C.td}><Pill tone={w.is_active ? 'success' : 'muted'}>{w.is_active ? '활성' : '비활성'}</Pill></td>
                  <td className={C.td}><RowActions onEdit={() => openEdit(w)} onDeactivate={() => deactivate(w.id)} isActive={w.is_active} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!loading && filtered.length === 0 && <EmptyState title="등록된 작업자가 없습니다" />}
      </div>

      <Modal
        open={modal}
        onClose={() => setModal(false)}
        title={form.id ? '작업자 수정' : '작업자 추가'}
        footer={<>
          <button onClick={() => setModal(false)} className={`${C.btn} ${C.btnGhost}`}>취소</button>
          <button onClick={save} className={`${C.btn} ${C.btnPrimary}`}>저장</button>
        </>}
      >
        <FormGrid>
          <FieldRow label="이름" required><input className={`${C.input} w-full`} value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} /></FieldRow>
          <FieldRow label="부서"><input className={`${C.input} w-full`} value={form.department || ''} onChange={(e) => setForm({ ...form, department: e.target.value })} /></FieldRow>
          <FieldRow label="기본층">
            <select className={`${C.select} w-full`} value={form.default_floor || '-'} onChange={(e) => setForm({ ...form, default_floor: e.target.value })}>
              {FLOORS.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </FieldRow>
          <FieldRow label="연락처"><input className={`${C.input} w-full`} value={form.phone || ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></FieldRow>
          <FieldRow label="검진일"><input type="date" className={`${C.input} w-full`} value={form.health_cert_date || ''} onChange={(e) => onCertDateChange(e.target.value)} /></FieldRow>
          <FieldRow label="다음 검진일(자동제안)"><input type="date" className={`${C.input} w-full`} value={form.health_cert_next || ''} onChange={(e) => setForm({ ...form, health_cert_next: e.target.value })} /></FieldRow>
          <FieldRow label="정렬순"><input type="number" className={`${C.input} w-full`} value={form.sort_order ?? 0} onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })} /></FieldRow>
          <FieldRow label="활성"><label className="flex items-center gap-2 h-[38px] text-sm text-text-secondary"><input type="checkbox" checked={form.is_active ?? true} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} /> 재직중</label></FieldRow>
        </FormGrid>
        <div className="mt-3">
          <FieldRow label="비고"><textarea className={`${C.input} w-full`} rows={2} value={form.notes || ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></FieldRow>
        </div>
      </Modal>
    </div>
  );
}
