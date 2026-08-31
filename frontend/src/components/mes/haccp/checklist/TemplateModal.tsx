'use client';

// 템플릿 신규/편집 모달 — 기본정보 + 항목 편집 표(추가/삭제/위아래 이동).
import { useEffect, useState } from 'react';
import { mesPost, ChecklistItem, ChecklistTemplate } from '@/lib/mes/api';
import { C, Modal, useToast } from '@/lib/mes/ui';

const CATEGORIES = ['선행요건', '검수', '위생', '설비', '기타'];
const CYCLES: { key: ChecklistTemplate['cycle']; label: string }[] = [
  { key: 'daily', label: '매일' }, { key: 'weekly', label: '주간' }, { key: 'monthly', label: '월간' }, { key: 'asneeded', label: '수시' },
];

interface Props {
  open: boolean;
  onClose: () => void;
  template: ChecklistTemplate | null; // null = 신규, {id:0,...} 도 신규 취급 가능
  duplicateFrom?: ChecklistTemplate | null;
  onSaved: () => void;
}

let noSeed = 1;

export default function TemplateModal({ open, onClose, template, duplicateFrom, onSaved }: Props) {
  const { toast, show, node: toastNode } = useToast();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState('선행요건');
  const [cycle, setCycle] = useState<ChecklistTemplate['cycle']>('daily');
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [reviewer, setReviewer] = useState(true);
  const [approver, setApprover] = useState(true);
  const [isActive, setIsActive] = useState(true);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const src = template || duplicateFrom;
    if (src) {
      setCode(duplicateFrom ? `${duplicateFrom.code}-COPY` : src.code);
      setName(duplicateFrom ? `${duplicateFrom.name} (복제)` : src.name);
      setCategory(src.category); setCycle(src.cycle);
      setItems((src.items || []).map((it, i) => ({ ...it, no: i + 1 })));
      setReviewer(src.approval?.reviewer ?? true);
      setApprover(src.approval?.approver ?? true);
      setIsActive(duplicateFrom ? true : src.is_active);
      setNotes(src.notes || '');
    } else {
      setCode(''); setName(''); setCategory('선행요건'); setCycle('daily');
      setItems([{ no: 1, section: '', item: '', standard: '', type: 'ok', unit: '', ref: '', min: null, max: null }]);
      setReviewer(true); setApprover(true); setIsActive(true); setNotes('');
    }
  }, [open, template, duplicateFrom]);

  const renumber = (arr: ChecklistItem[]) => arr.map((it, i) => ({ ...it, no: i + 1 }));
  const addItem = () => setItems((arr) => renumber([...arr, { no: 0, section: arr[arr.length - 1]?.section || '', item: '', standard: '', type: 'ok', unit: '', ref: '', min: null, max: null }]));
  const removeItem = (idx: number) => setItems((arr) => renumber(arr.filter((_, i) => i !== idx)));
  const moveItem = (idx: number, dir: -1 | 1) => setItems((arr) => {
    const n = [...arr]; const j = idx + dir; if (j < 0 || j >= n.length) return arr;
    [n[idx], n[j]] = [n[j], n[idx]]; return renumber(n);
  });
  const updateItem = (idx: number, patch: Partial<ChecklistItem>) => setItems((arr) => arr.map((it, i) => (i === idx ? { ...it, ...patch } : it)));

  const save = async () => {
    if (!code.trim() || !name.trim()) { show('코드와 이름을 입력하세요', 'danger'); return; }
    if (items.some((it) => !it.item.trim())) { show('점검항목을 모두 입력하세요', 'danger'); return; }
    setSaving(true);
    const isEditing = !!template && !duplicateFrom;
    const r = await mesPost('/templates', {
      id: isEditing ? template!.id : undefined,
      code, name, category, cycle, items,
      approval: { reviewer, approver },
      is_active: isActive, sort_order: template?.sort_order ?? 0, notes,
    });
    setSaving(false);
    if (!r.ok) { show(r.error || '저장 실패', 'danger'); return; }
    show('저장되었습니다');
    onSaved();
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title={template && !duplicateFrom ? '템플릿 편집' : '새 템플릿'} width="max-w-5xl" footer={<>
      <button className={`${C.btn} ${C.btnGhost}`} onClick={onClose}>취소</button>
      <button disabled={saving} className={`${C.btn} ${C.btnPrimary}`} onClick={save}>저장</button>
    </>}>
      {toastNode}
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <div className={C.label}>코드</div>
            <input className={`${C.input} w-full`} value={code} onChange={(e) => setCode(e.target.value)} placeholder="JJ-PP-01-B" />
          </div>
          <div className="col-span-2 md:col-span-2">
            <div className={C.label}>이름</div>
            <input className={`${C.input} w-full`} value={name} onChange={(e) => setName(e.target.value)} placeholder="조도 점검표" />
          </div>
          <div>
            <div className={C.label}>카테고리</div>
            <select className={`${C.select} w-full`} value={category} onChange={(e) => setCategory(e.target.value)}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <div className={C.label}>주기</div>
            <select className={`${C.select} w-full`} value={cycle} onChange={(e) => setCycle(e.target.value as any)}>
              {CYCLES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </div>
          <div className="flex items-end gap-3">
            <label className="flex items-center gap-1.5 text-xs text-text-secondary"><input type="checkbox" checked={reviewer} onChange={(e) => setReviewer(e.target.checked)} />검토 필요</label>
            <label className="flex items-center gap-1.5 text-xs text-text-secondary"><input type="checkbox" checked={approver} onChange={(e) => setApprover(e.target.checked)} />승인 필요</label>
            <label className="flex items-center gap-1.5 text-xs text-text-secondary"><input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />활성</label>
          </div>
          <div className="col-span-2 md:col-span-4">
            <div className={C.label}>비고</div>
            <input className={`${C.input} w-full`} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-bold text-text-primary">점검 항목 ({items.length})</div>
            <button className={`${C.btn} ${C.btnGhost} px-3 py-1.5`} onClick={addItem}>+ 행 추가</button>
          </div>
          <div className="overflow-x-auto border border-border-primary rounded-lg">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className={C.th} style={{ width: 36 }}>No</th>
                  <th className={C.th} style={{ width: 100 }}>구분</th>
                  <th className={C.th}>점검항목</th>
                  <th className={C.th}>기준</th>
                  <th className={C.th} style={{ width: 90 }}>유형</th>
                  <th className={C.th} style={{ width: 60 }}>단위</th>
                  <th className={C.th} style={{ width: 60 }}>min</th>
                  <th className={C.th} style={{ width: 60 }}>max</th>
                  <th className={C.th} style={{ width: 90 }} />
                </tr>
              </thead>
              <tbody>
                {items.map((it, idx) => (
                  <tr key={idx}>
                    <td className={C.td}>{it.no}</td>
                    <td className={C.td}><input className={`${C.input} w-full`} value={it.section || ''} onChange={(e) => updateItem(idx, { section: e.target.value })} /></td>
                    <td className={C.td}><input className={`${C.input} w-full`} value={it.item} onChange={(e) => updateItem(idx, { item: e.target.value })} /></td>
                    <td className={C.td}><input className={`${C.input} w-full`} value={it.standard || ''} onChange={(e) => updateItem(idx, { standard: e.target.value })} /></td>
                    <td className={C.td}>
                      <select className={`${C.select} w-full`} value={it.type} onChange={(e) => updateItem(idx, { type: e.target.value as any })}>
                        <option value="ok">ok</option><option value="num">num</option><option value="text">text</option>
                      </select>
                    </td>
                    <td className={C.td}><input className={`${C.input} w-full`} value={it.unit || ''} onChange={(e) => updateItem(idx, { unit: e.target.value })} disabled={it.type !== 'num'} /></td>
                    <td className={C.td}><input type="number" className={`${C.input} w-full`} value={it.min ?? ''} onChange={(e) => updateItem(idx, { min: e.target.value === '' ? null : Number(e.target.value) })} disabled={it.type !== 'num'} /></td>
                    <td className={C.td}><input type="number" className={`${C.input} w-full`} value={it.max ?? ''} onChange={(e) => updateItem(idx, { max: e.target.value === '' ? null : Number(e.target.value) })} disabled={it.type !== 'num'} /></td>
                    <td className={C.td}>
                      <div className="flex gap-1">
                        <button className={`${C.btn} ${C.btnGhost} px-1.5 py-1`} onClick={() => moveItem(idx, -1)}>↑</button>
                        <button className={`${C.btn} ${C.btnGhost} px-1.5 py-1`} onClick={() => moveItem(idx, 1)}>↓</button>
                        <button className={`${C.btn} ${C.btnDanger} px-1.5 py-1`} onClick={() => removeItem(idx)}>×</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Modal>
  );
}
