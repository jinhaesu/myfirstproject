'use client';

import { useEffect, useMemo, useState } from 'react';
import { mesGet, mesPost, mesDelete, type MesCode, type MesItem } from '@/lib/mes/api';
import { C, Pill, Modal, EmptyState } from '@/lib/mes/ui';
import { Combobox, localFetcher } from '@/components/Combobox';
import { Toolbar, FieldRow, FormGrid, RowActions, POP_KIND_OPTIONS, popKindLabel } from './_shared';

interface FamilyExtra { csa_category?: string; pop_kinds?: string[]; limit_temp?: number | null }
type FamilyForm = Partial<MesCode> & { extra?: FamilyExtra };

const emptyForm = (): FamilyForm => ({ code: '', name: '', group_code: 'FAMILY', sort_order: 0, is_active: true, extra: { csa_category: '', pop_kinds: [], limit_temp: null } });

export default function FamilyTab({ showToast }: { showToast: (msg: string, tone?: 'success' | 'danger' | 'info') => void }) {
  const [items, setItems] = useState<MesCode[]>([]);
  const [scmItems, setScmItems] = useState<MesItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [activeOnly, setActiveOnly] = useState(true);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState<FamilyForm>(emptyForm());
  const [selected, setSelected] = useState<MesCode | null>(null);
  const [preview, setPreview] = useState<MesItem[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    const [c, i] = await Promise.all([
      mesGet<{ items: MesCode[] }>('/codes?group=FAMILY', { items: [] }),
      mesGet<{ items: MesItem[] }>('/items?q=', { items: [] }),
    ]);
    setItems(c.items || []);
    setScmItems(i.items || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const categories = useMemo(() => Array.from(new Set(scmItems.map((i) => i.category).filter(Boolean))) as string[], [scmItems]);

  const filtered = useMemo(() => items
    .filter((c) => !activeOnly || c.is_active)
    .filter((c) => !q || `${c.code}${c.name}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (a.sort_order - b.sort_order) || a.code.localeCompare(b.code)), [items, q, activeOnly]);

  const openAdd = () => { setForm(emptyForm()); setModal(true); };
  const openEdit = (c: MesCode) => { setForm({ ...c, group_code: 'FAMILY', extra: { csa_category: c.extra?.csa_category || '', pop_kinds: c.extra?.pop_kinds || [], limit_temp: c.extra?.limit_temp ?? null } }); setModal(true); };

  const togglePopKind = (v: string) => {
    setForm((f) => {
      const cur = f.extra?.pop_kinds || [];
      const next = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v];
      return { ...f, extra: { ...f.extra, pop_kinds: next } };
    });
  };

  const save = async () => {
    if (!form.code || !form.name) { showToast('코드·이름은 필수입니다', 'danger'); return; }
    const body = { id: form.id, group_code: 'FAMILY', code: form.code, name: form.name, sort_order: form.sort_order ?? 0, is_active: form.is_active ?? true, notes: form.notes, extra: form.extra };
    const r = await mesPost('/codes', body);
    if (r.ok) { showToast('저장되었습니다'); setModal(false); load(); } else showToast(r.error || '저장 실패', 'danger');
  };
  const deactivate = async (id: number) => {
    const r = await mesDelete(`/codes/${id}`);
    if (r.ok) { showToast('비활성 처리되었습니다'); load(); } else showToast(r.error || '실패', 'danger');
  };

  const selectRow = async (c: MesCode) => {
    setSelected(c);
    const cat = c.extra?.csa_category;
    if (!cat) { setPreview([]); return; }
    setPreviewLoading(true);
    const r = await mesGet<{ items: MesItem[] }>(`/items?q=${encodeURIComponent(cat)}`, { items: [] });
    setPreview((r.items || []).slice(0, 30));
    setPreviewLoading(false);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4 items-start">
      <div>
        <Toolbar q={q} setQ={setQ} placeholder="코드/이름 검색" activeOnly={activeOnly} setActiveOnly={setActiveOnly} onAdd={openAdd} />
        <div className={`${C.card} overflow-x-auto`}>
          <table className="w-full">
            <thead>
              <tr>
                <th className={C.th}>코드</th><th className={C.th}>제품군명</th><th className={C.th}>CSA 품목류</th>
                <th className={C.th}>POP 사용공정</th><th className={C.th}>한계온도</th><th className={C.th}>활성</th><th className={C.th}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id} onClick={() => selectRow(c)} className={`cursor-pointer ${selected?.id === c.id ? 'bg-brand/5' : ''}`}>
                  <td className={C.td}>{c.code}</td>
                  <td className={C.td}>{c.name}</td>
                  <td className={C.td}>{c.extra?.csa_category || '-'}</td>
                  <td className={C.td}>
                    <div className="flex flex-wrap gap-1">
                      {(c.extra?.pop_kinds || []).map((k: string) => <Pill key={k} tone="info">{popKindLabel(k)}</Pill>)}
                      {(!c.extra?.pop_kinds || c.extra.pop_kinds.length === 0) && '-'}
                    </div>
                  </td>
                  <td className={C.td}>{c.extra?.limit_temp != null ? `${c.extra.limit_temp}℃` : '-'}</td>
                  <td className={C.td}><Pill tone={c.is_active ? 'success' : 'muted'}>{c.is_active ? '활성' : '비활성'}</Pill></td>
                  <td className={C.td} onClick={(e) => e.stopPropagation()}><RowActions onEdit={() => openEdit(c)} onDeactivate={() => deactivate(c.id)} isActive={c.is_active} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && filtered.length === 0 && <EmptyState title="등록된 제품군이 없습니다" />}
        </div>
      </div>

      <div className={C.cardPad}>
        <div className="text-sm font-bold text-text-primary mb-2">SCM 품목 매칭 미리보기</div>
        {!selected && <div className="text-xs text-text-tertiary">좌측에서 제품군을 선택하세요</div>}
        {selected && (
          <>
            <div className="text-xs text-text-tertiary mb-2">{selected.name} → &quot;{selected.extra?.csa_category || '-'}&quot; 검색 결과 {preview.length}건</div>
            {previewLoading && <div className="text-xs text-text-quaternary">불러오는 중…</div>}
            {!previewLoading && preview.length === 0 && <div className="text-xs text-text-quaternary">매칭 품목이 없습니다</div>}
            <div className="flex flex-col gap-1 max-h-[420px] overflow-y-auto">
              {preview.map((p) => (
                <div key={p.id} className="text-xs px-2 py-1.5 rounded-lg bg-bg-0 border border-border-primary">
                  <div className="font-semibold text-text-primary truncate">{p.name}</div>
                  <div className="text-text-quaternary truncate">{p.code || '-'} · {p.item_type || '-'}</div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <Modal
        open={modal}
        onClose={() => setModal(false)}
        title={form.id ? '제품군 수정' : '제품군 추가'}
        footer={<>
          <button onClick={() => setModal(false)} className={`${C.btn} ${C.btnGhost}`}>취소</button>
          <button onClick={save} className={`${C.btn} ${C.btnPrimary}`}>저장</button>
        </>}
      >
        <FormGrid>
          <FieldRow label="코드" required><input className={`${C.input} w-full`} value={form.code || ''} onChange={(e) => setForm({ ...form, code: e.target.value })} /></FieldRow>
          <FieldRow label="제품군명" required><input className={`${C.input} w-full`} value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} /></FieldRow>
          <FieldRow label="CSA 품목류" className="col-span-2">
            <Combobox<string>
              value={form.extra?.csa_category || ''}
              onChange={(v) => setForm((f) => ({ ...f, extra: { ...f.extra, csa_category: v } }))}
              fetcher={localFetcher(categories, (c) => c)}
              render={(c) => <span>{c}</span>}
              getLabel={(c) => c}
              placeholder="직접 입력 또는 선택"
            />
          </FieldRow>
          <FieldRow label="한계온도(℃)"><input type="number" className={`${C.input} w-full`} value={form.extra?.limit_temp ?? ''} onChange={(e) => setForm((f) => ({ ...f, extra: { ...f.extra, limit_temp: e.target.value ? Number(e.target.value) : null } }))} /></FieldRow>
          <FieldRow label="정렬순"><input type="number" className={`${C.input} w-full`} value={form.sort_order ?? 0} onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })} /></FieldRow>
          <FieldRow label="POP 사용공정" className="col-span-2">
            <div className="flex flex-wrap gap-3">
              {POP_KIND_OPTIONS.map((k) => (
                <label key={k.value} className="flex items-center gap-1.5 text-sm text-text-secondary cursor-pointer">
                  <input type="checkbox" checked={(form.extra?.pop_kinds || []).includes(k.value)} onChange={() => togglePopKind(k.value)} /> {k.label}
                </label>
              ))}
            </div>
          </FieldRow>
          <FieldRow label="활성"><label className="flex items-center gap-2 h-[38px] text-sm text-text-secondary"><input type="checkbox" checked={form.is_active ?? true} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} /> 사용</label></FieldRow>
        </FormGrid>
      </Modal>
    </div>
  );
}
