'use client';

import { useEffect, useMemo, useState } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { mesDelete, mesGet, mesPost, type Defect, type MesCode } from '@/lib/mes/api';
import { C, COLORS, EmptyState, Modal, fmt } from '@/lib/mes/ui';

export function DefectsTab({ workOrderId, defects, onChanged, showToast }: {
  workOrderId: number; defects: Defect[]; onChanged: () => void; showToast: (m: string, t?: 'success' | 'danger' | 'info') => void;
}) {
  const [codes, setCodes] = useState<MesCode[]>([]);
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [qty, setQty] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { mesGet<{ items: MesCode[] }>('/codes?group=DEFECT', { items: [] }).then((r) => setCodes(r.items || [])); }, []);

  const pieData = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of defects) m.set(d.defect_name || d.defect_code, (m.get(d.defect_name || d.defect_code) || 0) + d.qty);
    return Array.from(m.entries()).map(([name, value]) => ({ name, value }));
  }, [defects]);

  const submit = async () => {
    if (!code) { showToast('불량유형을 선택하세요', 'danger'); return; }
    if (!qty || Number(qty) <= 0) { showToast('수량을 입력하세요', 'danger'); return; }
    setSaving(true);
    const r = await mesPost(`/work-orders/${workOrderId}/defects`, { defect_code: code, qty: Number(qty), notes: notes || undefined });
    setSaving(false);
    if (!r.ok) { showToast(r.error || '등록 실패', 'danger'); return; }
    showToast('불량을 등록했습니다'); setCode(''); setQty(''); setNotes(''); setOpen(false); onChanged();
  };

  const del = async (id: number) => {
    const r = await mesDelete(`/defects/${id}`);
    if (!r.ok) { showToast(r.error || '삭제 실패', 'danger'); return; }
    showToast('삭제했습니다'); onChanged();
  };

  return (
    <div>
      <div className="flex justify-end mb-2">
        <button className={`${C.btn} ${C.btnPrimary}`} onClick={() => setOpen(true)}>+ 불량등록</button>
      </div>
      {defects.length === 0 ? <EmptyState title="등록된 불량이 없습니다" /> : (
        <div className="grid grid-cols-3 gap-4">
          <div className="col-span-2">
            <table className="w-full border-collapse">
              <thead><tr><th className={C.th}>불량유형</th><th className={`${C.th} text-right`}>수량</th><th className={C.th}>비고</th><th className={C.th}></th></tr></thead>
              <tbody>
                {defects.map((d) => (
                  <tr key={d.id}>
                    <td className={C.td}>{d.defect_name || d.defect_code}</td>
                    <td className={C.tdNum}>{fmt(d.qty)}</td>
                    <td className={C.td}>{d.notes || '-'}</td>
                    <td className={C.td}><button className="text-danger text-xs hover:underline" onClick={() => del(d.id)}>삭제</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={40} outerRadius={70} paddingAngle={2}>
                  {pieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="불량 등록" width="max-w-md"
        footer={<><button className={`${C.btn} ${C.btnGhost}`} onClick={() => setOpen(false)}>취소</button><button className={`${C.btn} ${C.btnPrimary}`} disabled={saving} onClick={submit}>{saving ? '저장 중…' : '저장'}</button></>}>
        <div className="space-y-3">
          <div>
            <label className={C.label}>불량유형</label>
            <select className={`${C.select} w-full`} value={code} onChange={(e) => setCode(e.target.value)}>
              <option value="">선택</option>
              {codes.map((c) => <option key={c.id} value={c.code}>{c.name}</option>)}
            </select>
          </div>
          <div><label className={C.label}>수량</label><input type="number" className={`${C.input} w-full`} value={qty} onChange={(e) => setQty(e.target.value)} /></div>
          <div><label className={C.label}>비고</label><textarea className={`${C.input} w-full`} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
        </div>
      </Modal>
    </div>
  );
}
