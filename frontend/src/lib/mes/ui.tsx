'use client';

// MES 공용 UI 아톰 — 테마 토큰 클래스만 사용(라이트/다크 자동).
import { useEffect, useState, type ReactNode } from 'react';

export const C = {
  card: 'bg-bg-1 border border-border-primary rounded-xl',
  cardPad: 'bg-bg-1 border border-border-primary rounded-xl p-4',
  input: 'bg-bg-0 border border-border-primary rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-brand disabled:opacity-50',
  select: 'bg-bg-0 border border-border-primary rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-brand',
  btn: 'inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed',
  btnPrimary: 'bg-brand hover:bg-brand-hover text-white',
  btnSuccess: 'bg-success hover:opacity-90 text-white',
  btnDanger: 'bg-danger hover:opacity-90 text-white',
  btnWarn: 'bg-warning hover:opacity-90 text-black',
  btnGhost: 'bg-bg-inset hover:bg-border-primary text-text-secondary border border-border-primary',
  th: 'text-left text-xs font-semibold text-text-tertiary px-3 py-2 border-b border-border-primary whitespace-nowrap',
  td: 'px-3 py-2 text-sm text-text-secondary border-b border-bg-inset whitespace-nowrap',
  tdNum: 'px-3 py-2 text-sm text-text-secondary border-b border-bg-inset whitespace-nowrap text-right tabular-nums',
  label: 'block text-xs font-semibold text-text-tertiary mb-1',
  // POP(태블릿) 대형 컨트롤
  bigBtn: 'inline-flex items-center justify-center gap-2 min-h-[56px] px-5 rounded-xl text-lg font-bold transition-colors active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed',
  bigInput: 'bg-bg-0 border-2 border-border-primary rounded-xl px-4 py-3 text-xl text-text-primary focus:outline-none focus:border-brand tabular-nums',
};

export const COLORS = ['#5E6AD2', '#27A644', '#F0BF00', '#00B8CC', '#EB5757', '#A855F7', '#F97316', '#14B8A6', '#4EA7FC', '#7A7FAD'];

export const fmt = (n: number | null | undefined, d = 0) => (n === null || n === undefined || Number.isNaN(Number(n)) ? '-' : Number(n).toLocaleString('ko-KR', { maximumFractionDigits: d, minimumFractionDigits: 0 }));
export const pct = (n: number | null | undefined, d = 1) => (n === null || n === undefined || Number.isNaN(Number(n)) ? '-' : `${(Number(n) * (Math.abs(Number(n)) <= 1.5 ? 100 : 1)).toFixed(d)}%`);
export const won = (n: number | null | undefined) => (n === null || n === undefined ? '-' : '₩' + Math.round(Number(n)).toLocaleString('ko-KR'));
export const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const todayISO = () => iso(new Date());
export const monthISO = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
export const hhmm = (s?: string | null) => { if (!s) return '-'; const d = new Date(s); if (Number.isNaN(d.getTime())) return s.slice(11, 16); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
export const dt = (s?: string | null) => { if (!s) return '-'; const d = new Date(s); if (Number.isNaN(d.getTime())) return s; return `${iso(d)} ${hhmm(s)}`; };
export const addDays = (s: string, n: number) => { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return iso(d); };
export const elapsedMin = (start?: string | null, end?: string | null) => { if (!start) return 0; const a = new Date(start).getTime(); const b = end ? new Date(end).getTime() : Date.now(); return Math.max(0, Math.round((b - a) / 60000)); };
export const fmtDuration = (min: number) => { const m = Math.max(0, Math.round(min)); const h = Math.floor(m / 60); return h > 0 ? `${h}시간 ${m % 60}분` : `${m}분`; };

export function presetRange(kind: string): { start: string; end: string } {
  const now = new Date(); const y = now.getFullYear(), m = now.getMonth();
  if (kind === 'today') return { start: iso(now), end: iso(now) };
  if (kind === '7d') { const s = new Date(now); s.setDate(now.getDate() - 6); return { start: iso(s), end: iso(now) }; }
  if (kind === '14d') { const s = new Date(now); s.setDate(now.getDate() - 13); return { start: iso(s), end: iso(now) }; }
  if (kind === 'thisMonth') return { start: iso(new Date(y, m, 1)), end: iso(new Date(y, m + 1, 0)) };
  if (kind === 'lastMonth') return { start: iso(new Date(y, m - 1, 1)), end: iso(new Date(y, m, 0)) };
  if (kind === 'thisQuarter') { const q = Math.floor(m / 3); return { start: iso(new Date(y, q * 3, 1)), end: iso(new Date(y, q * 3 + 3, 0)) }; }
  if (kind === 'thisYear') return { start: iso(new Date(y, 0, 1)), end: iso(now) };
  return { start: iso(new Date(y, m, 1)), end: iso(now) };
}
export const PRESETS: [string, string][] = [['today', '오늘'], ['7d', '7일'], ['14d', '14일'], ['thisMonth', '당월'], ['lastMonth', '전월'], ['thisQuarter', '당분기'], ['thisYear', '올해']];

export function PeriodBar({ range, setRange, onApply }: { range: { start: string; end: string }; setRange: (r: { start: string; end: string }) => void; onApply?: (r: { start: string; end: string }) => void }) {
  const preset = (k: string) => { const r = presetRange(k); setRange(r); onApply?.(r); };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input type="date" value={range.start} onChange={(e) => setRange({ ...range, start: e.target.value })} className={C.input} />
      <span className="text-text-quaternary">~</span>
      <input type="date" value={range.end} onChange={(e) => setRange({ ...range, end: e.target.value })} className={C.input} />
      {onApply && <button onClick={() => onApply(range)} className={`${C.btn} ${C.btnPrimary}`}>조회</button>}
      <div className="flex flex-wrap gap-1">
        {PRESETS.map(([k, l]) => <button key={k} onClick={() => preset(k)} className={`${C.btn} ${C.btnGhost} px-2.5 py-1.5`}>{l}</button>)}
      </div>
    </div>
  );
}

export function StatCard({ label, value, sub, tone, icon, onClick }: { label: string; value: ReactNode; sub?: ReactNode; tone?: string; icon?: ReactNode; onClick?: () => void }) {
  return (
    <div className={`${C.card} p-4 ${onClick ? 'cursor-pointer hover:border-brand transition-colors' : ''}`} onClick={onClick}>
      <div className="flex items-center justify-between mb-1">
        <div className="text-[11px] text-text-tertiary truncate" title={label}>{label}</div>
        {icon && <div className="text-text-quaternary">{icon}</div>}
      </div>
      <div className={`text-xl font-bold tabular-nums leading-tight break-keep ${tone || 'text-text-primary'}`}>{value}</div>
      {sub && <div className="text-[11px] text-text-quaternary mt-1 truncate">{sub}</div>}
    </div>
  );
}

export type Tone = 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'muted' | 'purple';
const toneCls: Record<Tone, string> = {
  brand: 'bg-brand/15 text-accent border-brand/30',
  success: 'bg-success/15 text-success border-success/30',
  warning: 'bg-warning/15 text-warning border-warning/30',
  danger: 'bg-danger/15 text-danger border-danger/30',
  info: 'bg-info/15 text-info border-info/30',
  muted: 'bg-bg-inset text-text-tertiary border-border-primary',
  purple: 'bg-purple/15 text-purple border-purple/30',
};
export function Pill({ tone = 'muted', children, className = '', size = 'sm' }: { tone?: Tone; children: ReactNode; className?: string; size?: 'sm' | 'md' | 'lg' }) {
  const sz = size === 'lg' ? 'px-3 py-1 text-base' : size === 'md' ? 'px-2.5 py-0.5 text-sm' : 'px-2 py-0.5 text-[11px]';
  return <span className={`inline-flex items-center gap-1 rounded-full border font-semibold whitespace-nowrap ${sz} ${toneCls[tone]} ${className}`}>{children}</span>;
}

export const WO_STATUS: Record<string, { label: string; tone: Tone }> = {
  planned: { label: '계획', tone: 'muted' }, released: { label: '지시', tone: 'info' }, in_progress: { label: '진행중', tone: 'brand' },
  paused: { label: '일시정지', tone: 'warning' }, done: { label: '완료', tone: 'success' }, cancelled: { label: '취소', tone: 'danger' },
};
export const APPROVAL_STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: '작성중', tone: 'muted' }, submitted: { label: '상신', tone: 'info' }, reviewed: { label: '검토완료', tone: 'purple' },
  approved: { label: '승인', tone: 'success' }, rejected: { label: '반려', tone: 'danger' },
};
export const DEV_STATUS: Record<string, { label: string; tone: Tone }> = {
  open: { label: '미조치', tone: 'danger' }, in_progress: { label: '조치중', tone: 'warning' }, closed: { label: '조치완료', tone: 'success' },
};
export function StatusPill({ status, map, size }: { status: string; map: Record<string, { label: string; tone: Tone }>; size?: 'sm' | 'md' | 'lg' }) {
  const s = map[status] || { label: status, tone: 'muted' as Tone };
  return <Pill tone={s.tone} size={size}>{s.label}</Pill>;
}
export function JudgePill({ j, size = 'md' }: { j?: string | null; size?: 'sm' | 'md' | 'lg' }) {
  if (!j) return <Pill tone="muted" size={size}>진행</Pill>;
  return <Pill tone={j === '적' ? 'success' : 'danger'} size={size}>{j === '적' ? '적합' : '부적합'}</Pill>;
}

export function Tabs<T extends string>({ tabs, value, onChange, size = 'md' }: { tabs: { key: T; label: ReactNode; badge?: ReactNode }[]; value: T; onChange: (t: T) => void; size?: 'md' | 'lg' }) {
  return (
    <div className="flex gap-1 border-b border-border-primary overflow-x-auto">
      {tabs.map((t) => (
        <button key={t.key} onClick={() => onChange(t.key)}
          className={`${size === 'lg' ? 'px-5 py-3 text-base' : 'px-4 py-2.5 text-sm'} font-semibold border-b-2 -mb-px transition-colors whitespace-nowrap inline-flex items-center gap-2 ${value === t.key ? 'border-brand text-accent' : 'border-transparent text-text-tertiary hover:text-text-secondary'}`}>
          {t.label}{t.badge}
        </button>
      ))}
    </div>
  );
}

export function EmptyState({ title = '조회된 데이터가 없습니다', sub = '다른 조건으로 검색해보세요', action }: { title?: string; sub?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center py-14 text-center">
      <div className="w-14 h-14 rounded-full bg-bg-inset flex items-center justify-center mb-3">
        <svg className="w-6 h-6 text-text-quaternary" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 12h6m-6 4h6M7 4h7l5 5v11a2 2 0 01-2 2H7a2 2 0 01-2-2V6a2 2 0 012-2z" /></svg>
      </div>
      <div className="text-sm font-semibold text-text-primary">{title}</div>
      <div className="text-xs text-text-tertiary mt-1">{sub}</div>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Modal({ open, onClose, title, children, width = 'max-w-2xl', footer }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; width?: string; footer?: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h); return () => document.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`${C.card} w-full ${width} max-h-[92vh] flex flex-col shadow-2xl`}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-border-primary">
          <div className="text-base font-bold text-text-primary">{title}</div>
          <button onClick={onClose} className="text-text-tertiary hover:text-text-primary text-xl leading-none">×</button>
        </div>
        <div className="px-5 py-4 overflow-y-auto flex-1">{children}</div>
        {footer && <div className="px-5 py-3 border-t border-border-primary flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

export function Drawer({ open, onClose, title, children, width = 'max-w-3xl' }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; width?: string }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[100] bg-black/50" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`absolute right-0 top-0 h-full w-full ${width} bg-bg-1 border-l border-border-primary shadow-2xl flex flex-col`}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-border-primary">
          <div className="text-base font-bold text-text-primary">{title}</div>
          <button onClick={onClose} className="text-text-tertiary hover:text-text-primary text-xl leading-none">×</button>
        </div>
        <div className="px-5 py-4 overflow-y-auto flex-1">{children}</div>
      </div>
    </div>
  );
}

export function ConfirmButton({ onConfirm, children, className, confirmText = '정말 진행할까요?' }: { onConfirm: () => void; children: ReactNode; className?: string; confirmText?: string }) {
  const [arm, setArm] = useState(false);
  useEffect(() => { if (!arm) return; const t = setTimeout(() => setArm(false), 3000); return () => clearTimeout(t); }, [arm]);
  return (
    <button className={className} onClick={() => { if (arm) { setArm(false); onConfirm(); } else setArm(true); }}>
      {arm ? confirmText : children}
    </button>
  );
}

export function Toast({ msg, tone = 'success' }: { msg: string | null; tone?: 'success' | 'danger' | 'info' }) {
  if (!msg) return null;
  const cls = tone === 'danger' ? 'bg-danger text-white' : tone === 'info' ? 'bg-info text-white' : 'bg-success text-white';
  return <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[200] px-4 py-2.5 rounded-lg shadow-xl text-sm font-semibold ${cls}`}>{msg}</div>;
}
export function useToast() {
  const [toast, setToast] = useState<{ msg: string; tone: 'success' | 'danger' | 'info' } | null>(null);
  const show = (msg: string, tone: 'success' | 'danger' | 'info' = 'success') => { setToast({ msg, tone }); setTimeout(() => setToast(null), 2500); };
  return { toast, show, node: <Toast msg={toast?.msg || null} tone={toast?.tone} /> };
}

export function ProgressBar({ value, tone = 'brand', height = 'h-2' }: { value: number; tone?: 'brand' | 'success' | 'warning' | 'danger'; height?: string }) {
  const v = Math.max(0, Math.min(100, value || 0));
  const bg = tone === 'success' ? 'bg-success' : tone === 'warning' ? 'bg-warning' : tone === 'danger' ? 'bg-danger' : 'bg-brand';
  return <div className={`w-full ${height} rounded-full bg-bg-inset overflow-hidden`}><div className={`${height} ${bg} rounded-full transition-all`} style={{ width: `${v}%` }} /></div>;
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return <div className="flex items-center justify-between mb-3"><h2 className="text-sm font-bold text-text-primary">{children}</h2>{right}</div>;
}

export function PageHeader({ title, sub, right }: { title: string; sub?: string; right?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold text-text-primary">{title}</h1>
        {sub && <p className="text-sm text-text-tertiary mt-0.5">{sub}</p>}
      </div>
      {right && <div className="flex items-center gap-2">{right}</div>}
    </div>
  );
}

// 숫자 키패드 (POP)
export function Keypad({ onKey, onClear, onBack, onApply, applyLabel = '적용' }: { onKey: (k: string) => void; onClear: () => void; onBack: () => void; onApply?: () => void; applyLabel?: string }) {
  const keys = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '0', '00', '.'];
  return (
    <div className="grid grid-cols-4 gap-2">
      {keys.slice(0, 3).map((k) => <KeyBtn key={k} onClick={() => onKey(k)}>{k}</KeyBtn>)}
      <KeyBtn onClick={onClear} className="bg-danger/15 text-danger border-danger/30">CE</KeyBtn>
      {keys.slice(3, 6).map((k) => <KeyBtn key={k} onClick={() => onKey(k)}>{k}</KeyBtn>)}
      <KeyBtn onClick={onBack} className="bg-warning/15 text-warning border-warning/30">←</KeyBtn>
      {keys.slice(6, 9).map((k) => <KeyBtn key={k} onClick={() => onKey(k)}>{k}</KeyBtn>)}
      <KeyBtn onClick={() => onKey('.')}>.</KeyBtn>
      <KeyBtn onClick={() => onKey('0')}>0</KeyBtn>
      <KeyBtn onClick={() => onKey('00')}>00</KeyBtn>
      {onApply ? <KeyBtn onClick={onApply} className="col-span-2 bg-brand text-white border-brand">{applyLabel}</KeyBtn> : <div className="col-span-2" />}
    </div>
  );
}
function KeyBtn({ children, onClick, className = '' }: { children: ReactNode; onClick: () => void; className?: string }) {
  return <button type="button" onClick={onClick} className={`min-h-[56px] rounded-xl border border-border-primary bg-bg-0 text-2xl font-bold text-text-primary active:scale-95 transition-transform ${className}`}>{children}</button>;
}

// 다운로드 CSV
export function downloadCSV(filename: string, headers: string[], rows: (string | number | null | undefined)[][]) {
  const esc = (v: any) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = '﻿' + [headers.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
}
