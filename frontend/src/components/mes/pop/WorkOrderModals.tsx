'use client';

import { useEffect, useState } from 'react';
import { C, Modal, Keypad } from '@/lib/mes/ui';
import type { MesCode, MesWorker } from '@/lib/mes/api';

function ChipGrid<T>({ items, getKey, getLabel, selected, onPick, cols = 3 }: { items: T[]; getKey: (t: T) => string | number; getLabel: (t: T) => string; selected: (t: T) => boolean; onPick: (t: T) => void; cols?: number }) {
  return (
    <div className={`grid gap-2 max-h-[220px] overflow-y-auto pr-1`} style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))` }}>
      {items.map((it) => (
        <button key={getKey(it)} type="button" onClick={() => onPick(it)}
          className={`${C.bigBtn} text-sm px-2 ${selected(it) ? 'bg-brand text-white' : 'bg-bg-0 border-2 border-border-primary text-text-primary'}`}>
          {getLabel(it)}
        </button>
      ))}
    </div>
  );
}

function NumField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <div className={C.label}>{label}</div>
      <input readOnly value={value} className={`${C.bigInput} w-full text-center`} placeholder="0" />
    </div>
  );
}

// ── 실적등록 ──
export function ResultModal({ open, onClose, onSubmit, workers, submitting }: { open: boolean; onClose: () => void; onSubmit: (p: { prod_qty: number; defect_qty: number; worker_id: number | null }) => void; workers: MesWorker[]; submitting: boolean }) {
  const [prod, setProd] = useState('');
  const [defect, setDefect] = useState('');
  const [workerId, setWorkerId] = useState<number | null>(null);
  const [focus, setFocus] = useState<'prod' | 'defect'>('prod');
  useEffect(() => { if (open) { setProd(''); setDefect(''); setWorkerId(null); setFocus('prod'); } }, [open]);
  const key = (k: string) => {
    const cur = focus === 'prod' ? prod : defect;
    if (k === '.' && cur.includes('.')) return;
    (focus === 'prod' ? setProd : setDefect)(cur + k);
  };
  const clear = () => (focus === 'prod' ? setProd('') : setDefect(''));
  const back = () => (focus === 'prod' ? setProd(prod.slice(0, -1)) : setDefect(defect.slice(0, -1)));
  return (
    <Modal open={open} onClose={onClose} title="생산실적 등록" width="max-w-xl"
      footer={<>
        <button onClick={onClose} className={`${C.btn} ${C.btnGhost} min-h-[48px] px-5`}>취소</button>
        <button disabled={submitting || prod === ''} onClick={() => onSubmit({ prod_qty: parseFloat(prod) || 0, defect_qty: parseFloat(defect) || 0, worker_id: workerId })} className={`${C.btn} ${C.btnPrimary} min-h-[48px] px-6`}>{submitting ? '저장 중…' : '저장'}</button>
      </>}>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div onClick={() => setFocus('prod')} className={focus === 'prod' ? 'ring-2 ring-brand rounded-xl' : ''}><NumField label="생산수량" value={prod} onChange={setProd} /></div>
        <div onClick={() => setFocus('defect')} className={focus === 'defect' ? 'ring-2 ring-brand rounded-xl' : ''}><NumField label="불량수량" value={defect} onChange={setDefect} /></div>
      </div>
      <div className="mb-3">
        <div className={C.label}>작업자</div>
        <ChipGrid items={workers} getKey={(w) => w.id} getLabel={(w) => w.name} selected={(w) => w.id === workerId} onPick={(w) => setWorkerId(w.id)} />
      </div>
      <Keypad onKey={key} onClear={clear} onBack={back} />
    </Modal>
  );
}

// ── 불량등록 ──
export function DefectModal({ open, onClose, onSubmit, codes, submitting }: { open: boolean; onClose: () => void; onSubmit: (p: { defect_code: string; qty: number }) => void; codes: MesCode[]; submitting: boolean }) {
  const [code, setCode] = useState<string | null>(null);
  const [qty, setQty] = useState('');
  useEffect(() => { if (open) { setCode(null); setQty(''); } }, [open]);
  const key = (k: string) => setQty((v) => (k === '.' && v.includes('.')) ? v : v + k);
  return (
    <Modal open={open} onClose={onClose} title="불량등록" width="max-w-xl"
      footer={<>
        <button onClick={onClose} className={`${C.btn} ${C.btnGhost} min-h-[48px] px-5`}>취소</button>
        <button disabled={submitting || !code || qty === ''} onClick={() => code && onSubmit({ defect_code: code, qty: parseFloat(qty) || 0 })} className={`${C.btn} ${C.btnDanger} min-h-[48px] px-6`}>{submitting ? '저장 중…' : '등록'}</button>
      </>}>
      <div className="mb-3">
        <div className={C.label}>불량유형</div>
        <ChipGrid items={codes} getKey={(c) => c.code} getLabel={(c) => c.name} selected={(c) => c.code === code} onPick={(c) => setCode(c.code)} />
      </div>
      <NumField label="불량수량" value={qty} onChange={setQty} />
      <div className="mt-3"><Keypad onKey={key} onClear={() => setQty('')} onBack={() => setQty(qty.slice(0, -1))} /></div>
    </Modal>
  );
}

// ── 비가동등록 ──
export function DowntimeModal({ open, onClose, onSubmit, codes, submitting }: { open: boolean; onClose: () => void; onSubmit: (p: { downtime_code: string; reason: string }) => void; codes: MesCode[]; submitting: boolean }) {
  const [code, setCode] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  useEffect(() => { if (open) { setCode(null); setReason(''); } }, [open]);
  return (
    <Modal open={open} onClose={onClose} title="비가동 등록" width="max-w-xl"
      footer={<>
        <button onClick={onClose} className={`${C.btn} ${C.btnGhost} min-h-[48px] px-5`}>취소</button>
        <button disabled={submitting || !code} onClick={() => code && onSubmit({ downtime_code: code, reason })} className={`${C.btn} ${C.btnWarn} min-h-[48px] px-6`}>{submitting ? '저장 중…' : '비가동 시작'}</button>
      </>}>
      <div className="mb-3">
        <div className={C.label}>비가동 유형</div>
        <ChipGrid items={codes} getKey={(c) => c.code} getLabel={(c) => c.name} selected={(c) => c.code === code} onPick={(c) => setCode(c.code)} />
      </div>
      <div className={C.label}>사유</div>
      <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} className={`${C.input} w-full text-base`} placeholder="사유를 입력하세요(선택)" />
    </Modal>
  );
}

// ── 작업자등록 ──
export function WorkerModal({ open, onClose, onSubmit, workers, initialIds, submitting }: { open: boolean; onClose: () => void; onSubmit: (ids: number[]) => void; workers: MesWorker[]; initialIds: number[]; submitting: boolean }) {
  const [ids, setIds] = useState<number[]>([]);
  useEffect(() => { if (open) setIds(initialIds); }, [open, initialIds]);
  const toggle = (id: number) => setIds((cur) => cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
  return (
    <Modal open={open} onClose={onClose} title="작업자 등록" width="max-w-xl"
      footer={<>
        <button onClick={onClose} className={`${C.btn} ${C.btnGhost} min-h-[48px] px-5`}>취소</button>
        <button disabled={submitting} onClick={() => onSubmit(ids)} className={`${C.btn} ${C.btnPrimary} min-h-[48px] px-6`}>{submitting ? '저장 중…' : `저장(${ids.length}명)`}</button>
      </>}>
      <ChipGrid items={workers} getKey={(w) => w.id} getLabel={(w) => w.name} selected={(w) => ids.includes(w.id)} onPick={(w) => toggle(w.id)} />
    </Modal>
  );
}
