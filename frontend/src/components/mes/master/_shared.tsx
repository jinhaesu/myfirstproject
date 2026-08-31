'use client';

// /mes/master 탭 공용 소품 — 검색바·필드행·폼그리드. 이 파일은 master 화면 전용이며
// 다른 MES 화면(공용 src/lib/mes/*)과는 무관하다.
import { type ReactNode } from 'react';
import { C, ConfirmButton } from '@/lib/mes/ui';

export const FLOORS = ['1F', '2F', '3F', '-'];
export const POP_KIND_OPTIONS: { value: string; label: string }[] = [
  { value: 'mixing', label: '배합' },
  { value: 'heating', label: '가열' },
  { value: 'freezing', label: '급속동결' },
  { value: 'metal', label: '금속검출' },
  { value: 'packing', label: '포장' },
];
export const popKindLabel = (v?: string | null) => POP_KIND_OPTIONS.find((k) => k.value === v)?.label || v || '-';

export function Toolbar({
  q, setQ, placeholder, activeOnly, setActiveOnly, onAdd, addLabel = '+ 추가', right,
}: {
  q: string; setQ: (v: string) => void; placeholder?: string;
  activeOnly: boolean; setActiveOnly: (v: boolean) => void;
  onAdd?: () => void; addLabel?: string; right?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 mb-3">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder || '검색'} className={`${C.input} w-56`} />
      <label className="flex items-center gap-1.5 text-xs text-text-tertiary cursor-pointer select-none">
        <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} />
        활성만
      </label>
      <div className="flex-1" />
      {right}
      {onAdd && <button onClick={onAdd} className={`${C.btn} ${C.btnPrimary}`}>{addLabel}</button>}
    </div>
  );
}

export function FieldRow({ label, required, children, className }: { label: string; required?: boolean; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label className={C.label}>{label}{required && <span className="text-danger ml-0.5">*</span>}</label>
      {children}
    </div>
  );
}

export function FormGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3">{children}</div>;
}

export function RowActions({ onEdit, onDeactivate, isActive = true }: { onEdit: () => void; onDeactivate?: () => void; isActive?: boolean }) {
  return (
    <div className="flex gap-1">
      <button onClick={onEdit} className={`${C.btn} ${C.btnGhost} px-2 py-1 text-xs`}>수정</button>
      {isActive && onDeactivate && (
        <ConfirmButton onConfirm={onDeactivate} className={`${C.btn} ${C.btnDanger} px-2 py-1 text-xs`}>비활성</ConfirmButton>
      )}
    </div>
  );
}
