'use client';

import { useState } from 'react';
import { C, Modal, Keypad } from '@/lib/mes/ui';
import type { ProcessRun, PopKind } from '@/lib/mes/api';

export interface EndPayload { measured_value?: number; test_result?: 'pass' | 'detect' | 'test' }

/** 종료 입력 모달 — 가열/급속동결(측정값), 금속검출(판정 버튼) */
export function EndRunModal({
  open, run, popKind, submitting, onClose, onSubmit,
}: {
  open: boolean;
  run: ProcessRun | null;
  popKind: PopKind;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (p: EndPayload) => void;
}) {
  const [measured, setMeasured] = useState('');

  if (!open || !run) return null;

  if (popKind === 'metal') {
    return (
      <Modal open={open} onClose={onClose} title={`금속검출 종료 — ${run.equipment_name || ''}`} width="max-w-lg">
        <div className="text-sm text-text-secondary mb-4">{run.item_name} · 원료 {run.input_kg ?? '-'}kg</div>
        <div className="grid grid-cols-1 gap-3">
          <button disabled={submitting} onClick={() => onSubmit({ test_result: 'pass' })} className={`${C.bigBtn} ${C.btnSuccess} text-xl`}>양품 통과</button>
          <button disabled={submitting} onClick={() => onSubmit({ test_result: 'detect' })} className={`${C.bigBtn} ${C.btnDanger} text-xl`}>검출</button>
          <button disabled={submitting} onClick={() => onSubmit({ test_result: 'test' })} className={`${C.bigBtn} ${C.btnGhost} text-xl`}>시편 TEST</button>
        </div>
      </Modal>
    );
  }

  const label = popKind === 'freezing' ? '측정온도(℃)' : '측정값(품온/오븰온도, ℃)';
  const key = (k: string) => setMeasured((v) => (k === '.' && v.includes('.')) ? v : v + k);

  return (
    <Modal open={open} onClose={onClose} title={`종료 — ${run.equipment_name || ''} · ${run.item_name || ''}`} width="max-w-lg"
      footer={
        <>
          <button onClick={onClose} className={`${C.btn} ${C.btnGhost} min-h-[48px] px-5`}>취소</button>
          <button disabled={submitting || measured === ''} onClick={() => onSubmit({ measured_value: parseFloat(measured) })} className={`${C.btn} ${C.btnPrimary} min-h-[48px] px-6 text-base`}>
            {submitting ? '처리 중…' : '종료 확정'}
          </button>
        </>
      }
    >
      {run.limit_value != null && (
        <div className="rounded-xl border-2 border-warning/40 bg-warning/10 px-4 py-2.5 mb-4 text-sm font-semibold text-text-primary">
          한계기준 {run.limit_value}℃
        </div>
      )}
      <div className={C.label}>{label}</div>
      <input readOnly value={measured} className={`${C.bigInput} w-full text-center mb-3`} placeholder="0" />
      <Keypad onKey={key} onClear={() => setMeasured('')} onBack={() => setMeasured((v) => v.slice(0, -1))} />
    </Modal>
  );
}
