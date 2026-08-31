'use client';

// 이탈 조치 모달(상세+조치완료/조치중) + 수동 이탈 등록 모달.
import { useEffect, useState } from 'react';
import { mesGet, mesPost, Deviation, MesCode, MesEquipment, MesProcess } from '@/lib/mes/api';
import { C, Modal, DEV_STATUS, StatusPill, useToast, dt, todayISO } from '@/lib/mes/ui';

export function DeviationActionModal({ open, onClose, deviation, onSaved }: { open: boolean; onClose: () => void; deviation: Deviation | null; onSaved: () => void }) {
  const { toast, show, node: toastNode } = useToast();
  const [correctiveAction, setCorrectiveAction] = useState('');
  const [actionBy, setActionBy] = useState('');

  useEffect(() => {
    if (open && deviation) { setCorrectiveAction(deviation.corrective_action || ''); setActionBy(deviation.action_by || ''); }
  }, [open, deviation]);

  if (!deviation) return null;

  const markInProgress = async () => {
    const r = await mesPost('/deviations', { id: deviation.id, status: 'in_progress' });
    if (!r.ok) { show(r.error || '처리 실패', 'danger'); return; }
    show('조치중으로 변경되었습니다', 'info');
    onSaved(); onClose();
  };
  const close = async () => {
    if (!correctiveAction.trim() || !actionBy.trim()) { show('조치내용과 조치자를 입력하세요', 'danger'); return; }
    const r = await mesPost(`/deviations/${deviation.id}/close`, { corrective_action: correctiveAction, action_by: actionBy });
    if (!r.ok) { show(r.error || '처리 실패', 'danger'); return; }
    show('조치완료 처리되었습니다');
    onSaved(); onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="이탈 · 개선조치" footer={<>
      <button className={`${C.btn} ${C.btnGhost}`} onClick={onClose}>닫기</button>
      {deviation.status === 'open' && <button className={`${C.btn} ${C.btnWarn}`} onClick={markInProgress}>조치중으로</button>}
      {deviation.status !== 'closed' && <button className={`${C.btn} ${C.btnSuccess}`} onClick={close}>조치완료</button>}
    </>}>
      {toastNode}
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div><div className={C.label}>발생시각</div>{dt(deviation.occurred_at)}</div>
          <div><div className={C.label}>상태</div><StatusPill status={deviation.status} map={DEV_STATUS} /></div>
          <div><div className={C.label}>공정</div>{deviation.process_name || '-'}</div>
          <div><div className={C.label}>설비</div>{deviation.equipment_name || '-'}</div>
          <div><div className={C.label}>유형</div>{deviation.deviation_name || deviation.deviation_code}</div>
          <div><div className={C.label}>기준/측정</div>{deviation.limit_value ?? '-'} / {deviation.measured_value ?? '-'}</div>
        </div>
        <div><div className={C.label}>내용</div><div className="text-sm text-text-secondary">{deviation.description || '-'}</div></div>
        <div>
          <div className={C.label}>조치내용</div>
          <textarea disabled={deviation.status === 'closed'} className={`${C.input} w-full`} rows={3} value={correctiveAction} onChange={(e) => setCorrectiveAction(e.target.value)} />
        </div>
        <div>
          <div className={C.label}>조치자</div>
          <input disabled={deviation.status === 'closed'} className={`${C.input} w-full`} value={actionBy} onChange={(e) => setActionBy(e.target.value)} />
        </div>
        {deviation.status === 'closed' && <div className="text-xs text-text-tertiary">조치시각: {dt(deviation.action_at)}</div>}
      </div>
    </Modal>
  );
}

export function DeviationRegisterModal({ open, onClose, processes, onSaved }: { open: boolean; onClose: () => void; processes: MesProcess[]; onSaved: () => void }) {
  const { toast, show, node: toastNode } = useToast();
  const [processId, setProcessId] = useState('');
  const [equipment, setEquipment] = useState<MesEquipment[]>([]);
  const [equipmentId, setEquipmentId] = useState('');
  const [codes, setCodes] = useState<MesCode[]>([]);
  const [code, setCode] = useState('');
  const [occurredAt, setOccurredAt] = useState('');
  const [description, setDescription] = useState('');
  const [limitValue, setLimitValue] = useState('');
  const [measuredValue, setMeasuredValue] = useState('');

  useEffect(() => {
    if (!open) return;
    mesGet<{ items: MesCode[] }>('/codes?group=DEVIATION', { items: [] }).then((r) => setCodes(r.items || []));
    setProcessId(''); setEquipmentId(''); setEquipment([]); setCode(''); setDescription(''); setLimitValue(''); setMeasuredValue('');
    const now = new Date();
    setOccurredAt(`${todayISO()}T${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`);
  }, [open]);

  useEffect(() => {
    if (!processId) { setEquipment([]); return; }
    mesGet<{ items: MesEquipment[] }>(`/equipment?process_id=${processId}&active=1`, { items: [] }).then((r) => setEquipment(r.items || []));
  }, [processId]);

  const save = async () => {
    if (!processId || !code || !occurredAt) { show('공정·유형·발생시각을 입력하세요', 'danger'); return; }
    const r = await mesPost('/deviations', {
      process_id: Number(processId), equipment_id: equipmentId ? Number(equipmentId) : undefined,
      occurred_at: occurredAt.length === 16 ? `${occurredAt}:00` : occurredAt,
      deviation_code: code, description, limit_value: limitValue === '' ? undefined : Number(limitValue), measured_value: measuredValue === '' ? undefined : Number(measuredValue),
    });
    if (!r.ok) { show(r.error || '등록 실패', 'danger'); return; }
    show('등록되었습니다');
    onSaved(); onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="수동 이탈 등록" footer={<>
      <button className={`${C.btn} ${C.btnGhost}`} onClick={onClose}>취소</button>
      <button className={`${C.btn} ${C.btnPrimary}`} onClick={save}>등록</button>
    </>}>
      {toastNode}
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className={C.label}>공정</div>
            <select className={`${C.select} w-full`} value={processId} onChange={(e) => setProcessId(e.target.value)}>
              <option value="">선택</option>
              {processes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <div className={C.label}>설비</div>
            <select className={`${C.select} w-full`} value={equipmentId} onChange={(e) => setEquipmentId(e.target.value)}>
              <option value="">전체</option>
              {equipment.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
          <div>
            <div className={C.label}>발생시각</div>
            <input type="datetime-local" className={`${C.input} w-full`} value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} />
          </div>
          <div>
            <div className={C.label}>유형</div>
            <select className={`${C.select} w-full`} value={code} onChange={(e) => setCode(e.target.value)}>
              <option value="">선택</option>
              {codes.map((c) => <option key={c.id} value={c.code}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <div className={C.label}>기준</div>
            <input type="number" className={`${C.input} w-full`} value={limitValue} onChange={(e) => setLimitValue(e.target.value)} />
          </div>
          <div>
            <div className={C.label}>측정</div>
            <input type="number" className={`${C.input} w-full`} value={measuredValue} onChange={(e) => setMeasuredValue(e.target.value)} />
          </div>
        </div>
        <div>
          <div className={C.label}>내용</div>
          <textarea className={`${C.input} w-full`} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
      </div>
    </Modal>
  );
}
