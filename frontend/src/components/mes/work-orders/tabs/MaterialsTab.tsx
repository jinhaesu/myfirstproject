'use client';

import { useState } from 'react';
import { mesDelete, mesGet, mesPost, type MaterialIssue } from '@/lib/mes/api';
import { C, EmptyState, Modal, fmt } from '@/lib/mes/ui';
import { Combobox } from '@/components/Combobox';

interface MaterialCandidate { id: number; type: 'raw' | 'sub'; name: string; unit?: string; erp_code?: string }

export function MaterialsTab({ workOrderId, materials, onChanged, showToast }: {
  workOrderId: number; materials: MaterialIssue[]; onChanged: () => void; showToast: (m: string, t?: 'success' | 'danger' | 'info') => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<MaterialCandidate | null>(null);
  const [qty, setQty] = useState('');
  const [unit, setUnit] = useState('');
  const [lotNo, setLotNo] = useState('');
  const [saving, setSaving] = useState(false);
  const [bomLoading, setBomLoading] = useState(false);

  const runBom = async () => {
    setBomLoading(true);
    const r = await mesPost(`/work-orders/${workOrderId}/materials/from-bom`);
    setBomLoading(false);
    if (!r.ok) { showToast(r.error || 'BOM 투입 실패', 'danger'); return; }
    showToast('BOM 자재를 자동투입했습니다'); onChanged();
  };

  const submit = async () => {
    if (!query.trim()) { showToast('자재명을 입력하세요', 'danger'); return; }
    if (!qty || Number(qty) <= 0) { showToast('수량을 입력하세요', 'danger'); return; }
    setSaving(true);
    const r = await mesPost(`/work-orders/${workOrderId}/materials`, {
      material_type: picked?.type || 'raw', material_id: picked?.id, material_name: picked?.name || query.trim(),
      qty: Number(qty), unit: unit || picked?.unit || undefined, lot_no: lotNo || undefined,
    });
    setSaving(false);
    if (!r.ok) { showToast(r.error || '등록 실패', 'danger'); return; }
    showToast('자재를 투입했습니다'); setQuery(''); setPicked(null); setQty(''); setUnit(''); setLotNo(''); setOpen(false); onChanged();
  };

  const del = async (id: number) => {
    const r = await mesDelete(`/materials/${id}`);
    if (!r.ok) { showToast(r.error || '삭제 실패', 'danger'); return; }
    showToast('삭제했습니다'); onChanged();
  };

  return (
    <div>
      <div className="flex justify-end gap-2 mb-2">
        <button className={`${C.btn} ${C.btnGhost}`} disabled={bomLoading} onClick={runBom}>{bomLoading ? '투입 중…' : 'BOM 자재 자동투입'}</button>
        <button className={`${C.btn} ${C.btnPrimary}`} onClick={() => setOpen(true)}>+ 수동 추가</button>
      </div>
      {materials.length === 0 ? <EmptyState title="투입된 자재가 없습니다" /> : (
        <table className="w-full border-collapse">
          <thead><tr><th className={C.th}>구분</th><th className={C.th}>자재명</th><th className={`${C.th} text-right`}>수량</th><th className={C.th}>LOT</th><th className={C.th}></th></tr></thead>
          <tbody>
            {materials.map((m) => (
              <tr key={m.id}>
                <td className={C.td}>{m.material_type === 'raw' ? '원료' : m.material_type === 'sub' ? '부자재' : '반제품'}</td>
                <td className={C.td}>{m.material_name}</td>
                <td className={C.tdNum}>{fmt(m.qty)} {m.unit || ''}</td>
                <td className={C.td}>{m.lot_no || '-'}</td>
                <td className={C.td}><button className="text-danger text-xs hover:underline" onClick={() => del(m.id)}>삭제</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="자재 수동 투입" width="max-w-md"
        footer={<><button className={`${C.btn} ${C.btnGhost}`} onClick={() => setOpen(false)}>취소</button><button className={`${C.btn} ${C.btnPrimary}`} disabled={saving} onClick={submit}>{saving ? '저장 중…' : '저장'}</button></>}>
        <div className="space-y-3">
          <div>
            <label className={C.label}>자재</label>
            <Combobox<MaterialCandidate>
              value={query}
              onChange={(v) => { setQuery(v); setPicked(null); }}
              fetcher={(q) => mesGet<{ items: MaterialCandidate[] }>(`/materials?q=${encodeURIComponent(q)}`, { items: [] }).then((r) => r.items || [])}
              getLabel={(it) => it.name}
              render={(it) => <div><div className="font-medium text-text-primary">{it.name}</div><div className="text-[11px] text-text-tertiary">{it.type === 'raw' ? '원료' : '부자재'} {it.erp_code ? `· ${it.erp_code}` : ''}</div></div>}
              onPick={(it) => { setPicked(it); setUnit(it.unit || ''); }}
              placeholder="자재명을 검색하세요"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={C.label}>수량</label><input type="number" className={`${C.input} w-full`} value={qty} onChange={(e) => setQty(e.target.value)} /></div>
            <div><label className={C.label}>단위</label><input className={`${C.input} w-full`} value={unit} onChange={(e) => setUnit(e.target.value)} /></div>
          </div>
          <div><label className={C.label}>LOT 번호</label><input className={`${C.input} w-full`} value={lotNo} onChange={(e) => setLotNo(e.target.value)} /></div>
        </div>
      </Modal>
    </div>
  );
}
