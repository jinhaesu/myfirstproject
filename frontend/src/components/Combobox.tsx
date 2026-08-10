'use client';

import { useEffect, useState, useCallback, useRef, type ReactNode } from 'react';

const INPUT_CLS = 'bg-bg-0 border border-border-primary rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-brand';

// 서버/로컬 검색형 자동완성 콤보박스 — 클릭 시 리스트, 키워드 입력 시 연관값 필터.
// fetcher는 키워드를 받아 후보 배열을 Promise로 반환(로컬 배열 필터도 가능).
export function Combobox<T>({ value, onChange, fetcher, render, getLabel, onPick, placeholder, className }: {
  value: string;
  onChange: (v: string) => void;
  fetcher: (q: string) => Promise<T[]>;
  render: (item: T) => ReactNode;
  getLabel: (item: T) => string;
  onPick?: (item: T) => void;
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState<T[]>([]);
  const [hi, setHi] = useState(-1);
  const boxRef = useRef<HTMLDivElement>(null);
  const query = useCallback((q: string) => { fetcher(q).then((r) => { setOpts(r); setHi(-1); }); }, [fetcher]);
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => query(value), 180);
    return () => clearTimeout(t);
  }, [value, open, query]);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h);
  }, []);
  const pick = (it: T) => { onChange(getLabel(it)); onPick?.(it); setOpen(false); };
  return (
    <div className="relative" ref={boxRef}>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => { onChange(e.target.value); if (!open) setOpen(true); }}
        onFocus={() => { setOpen(true); query(value); }}
        onKeyDown={(e) => {
          if (!open) return;
          if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(h + 1, opts.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
          else if (e.key === 'Enter' && hi >= 0 && opts[hi]) { e.preventDefault(); pick(opts[hi]); }
          else if (e.key === 'Escape') setOpen(false);
        }}
        className={className || `${INPUT_CLS} w-full`}
      />
      {open && opts.length > 0 && (
        <div className="absolute z-30 mt-1 w-full max-h-64 overflow-y-auto bg-bg-1 border border-border-primary rounded-lg shadow-lg">
          {opts.map((it, i) => (
            <button
              key={i}
              type="button"
              onMouseEnter={() => setHi(i)}
              onClick={() => pick(it)}
              className={`w-full text-left px-3 py-2 text-sm ${i === hi ? 'bg-bg-inset' : ''} hover:bg-bg-inset border-b border-bg-inset last:border-0`}
            >
              {render(it)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// 로컬 배열용 fetcher 헬퍼 — 키워드가 label에 포함되는 항목을 앞순으로 반환.
export function localFetcher<T>(items: T[], getText: (it: T) => string, limit = 40) {
  return (q: string): Promise<T[]> => {
    const kw = (q || '').trim().toLowerCase();
    if (!kw) return Promise.resolve(items.slice(0, limit));
    const hit = items.filter((it) => getText(it).toLowerCase().includes(kw));
    return Promise.resolve(hit.slice(0, limit));
  };
}
