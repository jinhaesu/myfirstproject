'use client';

import { useEffect, useMemo, useState } from 'react';
import { C, Keypad } from '@/lib/mes/ui';
import type { MesEquipment, MesWorker, MesCode, MesLimit, PopKind } from '@/lib/mes/api';

function limitText(lim: MesLimit): string {
  const unit = lim.unit || (lim.param === 'temp' ? '℃' : lim.param === 'time' ? '분' : lim.param === 'alcohol_ratio' ? '%' : '');
  if (lim.param === 'temp' || lim.param === 'time') {
    if (lim.min_value != null && lim.max_value != null) return `${lim.name} ${lim.min_value}~${lim.max_value}${unit}`;
    if (lim.min_value != null) return `${lim.name} ${lim.min_value}${unit} 이상`;
    if (lim.max_value != null) return `${lim.name} ${lim.max_value}${unit} 이하`;
  }
  if (lim.param === 'alcohol_ratio' && lim.min_value != null && lim.max_value != null) return `${lim.name} ${lim.min_value}~${lim.max_value}${unit}`;
  return lim.name;
}

export interface StartPayload {
  equipment_id: number | null;
  family_code: string | null;
  item_name: string;
  input_kg: number | null;
  alcohol_g: number | null;
  worker_id: number | null;
}

/** POP 공정실행 입력 패널 — 호기·품명·투입량·주정·한계값·담당자 + 키패드 + 시작 */
export function InputPanel({
  popKind, equipment, families, workers, limits, starting, onStart,
}: {
  popKind: PopKind;
  equipment: MesEquipment[];
  families: MesCode[];
  workers: MesWorker[];
  limits: MesLimit[];
  starting: boolean;
  onStart: (p: StartPayload) => void;
}) {
  const [equipmentId, setEquipmentId] = useState<number | null>(null);
  const [familyCode, setFamilyCode] = useState<string | null>(null);
  const [inputKg, setInputKg] = useState('');
  const [alcoholG, setAlcoholG] = useState('');
  const [alcoholTouched, setAlcoholTouched] = useState(false);
  const [workerId, setWorkerId] = useState<number | null>(null);
  const [focusField, setFocusField] = useState<'kg' | 'alcohol'>('kg');

  useEffect(() => { setEquipmentId(null); setFamilyCode(null); setInputKg(''); setAlcoholG(''); setAlcoholTouched(false); setWorkerId(null); }, [popKind]);

  useEffect(() => {
    if (popKind !== 'mixing' || alcoholTouched) return;
    const kg = parseFloat(inputKg);
    setAlcoholG(Number.isFinite(kg) ? String(Math.round(kg * 10)) : '');
  }, [inputKg, popKind, alcoholTouched]);

  const family = families.find((f) => f.code === familyCode) || null;
  const matchedLimit = useMemo(() => {
    if (!familyCode) return limits.find((l) => !l.family_code) || null;
    return limits.find((l) => l.family_code === familyCode) || limits.find((l) => !l.family_code) || null;
  }, [limits, familyCode]);

  const needFamily = popKind !== 'metal';
  const needQty = popKind !== 'metal';
  const canStart = !!equipmentId && (!needFamily || !!familyCode) && (!needQty || parseFloat(inputKg) > 0);

  const applyKey = (k: string) => {
    const setter = focusField === 'kg' ? setInputKg : (v: string) => { setAlcoholTouched(true); setAlcoholG(v); };
    const cur = focusField === 'kg' ? inputKg : alcoholG;
    if (k === '.' && cur.includes('.')) return;
    setter(cur + k);
  };
  const clear = () => { if (focusField === 'kg') setInputKg(''); else { setAlcoholTouched(true); setAlcoholG(''); } };
  const back = () => { const cur = focusField === 'kg' ? inputKg : alcoholG; const nv = cur.slice(0, -1); if (focusField === 'kg') setInputKg(nv); else { setAlcoholTouched(true); setAlcoholG(nv); } };

  const doStart = () => {
    onStart({
      equipment_id: equipmentId,
      family_code: familyCode,
      item_name: family?.name || '',
      input_kg: needQty ? (parseFloat(inputKg) || 0) : null,
      alcohol_g: popKind === 'mixing' ? (parseFloat(alcoholG) || 0) : null,
      worker_id: workerId,
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className={C.label}>호기 선택</div>
        <div className="grid grid-cols-3 gap-2">
          {equipment.length === 0 && <div className="col-span-3 text-xs text-text-tertiary py-2">해당 공정에 등록된 설비가 없습니다</div>}
          {equipment.map((eq) => (
            <button key={eq.id} onClick={() => setEquipmentId(eq.id)}
              className={`${C.bigBtn} ${equipmentId === eq.id ? 'bg-brand text-white' : 'bg-bg-0 border-2 border-border-primary text-text-primary'} text-sm px-2`}>
              {eq.unit_label || eq.name}
            </button>
          ))}
        </div>
      </div>

      {needFamily && (
        <div>
          <div className={C.label}>품명</div>
          <div className="grid grid-cols-3 gap-2 max-h-[220px] overflow-y-auto pr-1">
            {families.length === 0 && <div className="col-span-3 text-xs text-text-tertiary py-2">해당 공정의 품명(제품군) 코드가 없습니다</div>}
            {families.map((f) => (
              <button key={f.code} onClick={() => setFamilyCode(f.code)}
                className={`${C.bigBtn} ${familyCode === f.code ? 'bg-brand text-white' : 'bg-bg-0 border-2 border-border-primary text-text-primary'} text-sm px-2`}>
                {f.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {needQty && (
        <div>
          <div className={C.label}>원료투입량 (kg)</div>
          <input readOnly onFocus={() => setFocusField('kg')} value={inputKg}
            className={`${C.bigInput} w-full text-center ${focusField === 'kg' ? 'border-brand ring-2 ring-brand/30' : ''}`} placeholder="0" />
        </div>
      )}

      {popKind === 'mixing' && (
        <div>
          <div className={C.label}>주정투입량 (g) — 원료×10 자동, 수정 가능</div>
          <input readOnly onFocus={() => setFocusField('alcohol')} value={alcoholG}
            className={`${C.bigInput} w-full text-center ${focusField === 'alcohol' ? 'border-brand ring-2 ring-brand/30' : ''}`} placeholder="0" />
        </div>
      )}

      {(popKind === 'heating' || popKind === 'freezing') && (
        <div className="rounded-xl border-2 border-warning/40 bg-warning/10 px-4 py-3">
          <div className="text-xs font-semibold text-warning mb-0.5">한계기준</div>
          <div className="text-base font-bold text-text-primary">{matchedLimit ? limitText(matchedLimit) : '등록된 한계기준이 없습니다'}</div>
          <div className="text-[11px] text-text-tertiary mt-0.5">측정값은 종료 시 입력합니다</div>
        </div>
      )}

      <div>
        <div className={C.label}>담당자</div>
        <div className="grid grid-cols-3 gap-2 max-h-[160px] overflow-y-auto pr-1">
          {workers.map((w) => (
            <button key={w.id} onClick={() => setWorkerId(w.id)}
              className={`${C.bigBtn} ${workerId === w.id ? 'bg-brand text-white' : 'bg-bg-0 border-2 border-border-primary text-text-primary'} text-sm px-2`}>
              {w.name}
            </button>
          ))}
        </div>
      </div>

      {needQty && (
        <Keypad
          onKey={applyKey}
          onClear={clear}
          onBack={back}
        />
      )}

      <button onClick={doStart} disabled={!canStart || starting} className={`${C.bigBtn} ${C.btnSuccess} w-full text-2xl`}>
        {starting ? '시작 중…' : '▶ 시작'}
      </button>
    </div>
  );
}
