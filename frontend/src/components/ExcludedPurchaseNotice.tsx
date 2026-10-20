'use client';

import { useEffect, useState } from 'react';

// 원가 gap 비교에서 제외한 'BOM 비대상 구매'(포장·물류자재·소모품 등)를 그래프 위에 명시하고,
// 클릭 시 품목별 제외 내역을 모달로 띄운다. 금액은 공급가(VAT별도).
type Excluded = {
  purchase_total: number; bom_scope: number; excluded: number; excluded_pct: number | null; item_count: number;
  by_class: { mclass: string; amount: number }[];
  items: { item_code: string | null; item_name: string; mclass: string | null; vendor: string | null; amount: number; count: number }[];
};

const authHeaders = (): Record<string, string> => {
  const t = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
  return t ? { Authorization: `Bearer ${t}` } : {};
};
const won = (n: number) => '₩' + Math.round(n || 0).toLocaleString('ko-KR');
const wonShort = (n: number) => { const a = Math.abs(n || 0); const s = n < 0 ? '-' : ''; if (a >= 1e8) return s + (a / 1e8).toFixed(1).replace(/\.0$/, '') + '억'; if (a >= 1e4) return s + Math.round(a / 1e4).toLocaleString('ko-KR') + '만'; return s + '₩' + Math.round(a).toLocaleString('ko-KR'); };

export function ExcludedPurchaseNotice({ start, end, team, endpoint = '/purchase/records/excluded' }: {
  start: string; end: string; team?: string | null; endpoint?: string;
}) {
  const [d, setD] = useState<Excluded | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!start || !end) return;
    const q = new URLSearchParams({ start, end, limit: '200' });
    if (team) q.set('team', team);
    fetch(`/api${endpoint}?${q.toString()}`, { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : null)).then(setD).catch(() => setD(null));
  }, [start, end, team, endpoint]);
  if (!d || !d.excluded) return null;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className="w-full mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-left text-xs rounded-lg border border-dashed border-warning/60 bg-warning/10 px-3 py-2 hover:bg-warning/15 transition-colors">
        <span className="font-semibold text-warning">비교 제외</span>
        <span className="text-text-secondary">BOM 비대상 구매 <b className="text-text-primary tabular-nums">{wonShort(d.excluded)}</b>
          {d.excluded_pct != null && <> (전체 {wonShort(d.purchase_total)}의 {d.excluded_pct}%)</>} — 포장·물류자재·소모품 등은 그래프에서 뺐습니다</span>
        <span className="ml-auto text-brand underline underline-offset-2">제외 내역 보기 →</span>
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          <div className="relative bg-bg-1 border border-border-primary rounded-2xl w-full max-w-3xl max-h-[85vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="text-xs text-text-tertiary">{start} ~ {end} · 공급가(VAT별도)</div>
                <div className="text-lg font-bold text-text-primary">원가 비교에서 제외한 구매 {wonShort(d.excluded)}</div>
                <div className="text-xs text-text-quaternary mt-1">BOM 자재 마스터(원재료·부자재) 품목코드에 없는 구매입니다. 원가 gap은 BOM자재 구매 {wonShort(d.bom_scope)}만으로 비교합니다.</div>
              </div>
              <button onClick={() => setOpen(false)} className="text-text-tertiary hover:text-text-primary text-xl">×</button>
            </div>
            <div className="flex flex-wrap gap-2 mb-4">
              {d.by_class.map((c) => (
                <span key={c.mclass} className="text-xs px-2 py-1 rounded-md bg-bg-inset text-text-secondary">{c.mclass} <b className="text-text-primary tabular-nums">{wonShort(c.amount)}</b></span>
              ))}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-text-tertiary text-left">
                  <th className="py-1.5 pr-2 font-medium">품목</th><th className="py-1.5 pr-2 font-medium">분류</th>
                  <th className="py-1.5 pr-2 font-medium">거래처</th><th className="py-1.5 pr-2 font-medium text-right">건수</th>
                  <th className="py-1.5 font-medium text-right">금액</th>
                </tr></thead>
                <tbody>{d.items.map((x, i) => (
                  <tr key={i} className="border-t border-border-primary">
                    <td className="py-1.5 pr-2 text-text-primary">{x.item_name}{x.item_code && <span className="text-text-quaternary ml-1">({x.item_code})</span>}</td>
                    <td className="py-1.5 pr-2 text-text-secondary">{x.mclass || '-'}</td>
                    <td className="py-1.5 pr-2 text-text-secondary truncate max-w-[10rem]">{x.vendor || '-'}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums text-text-secondary">{x.count}</td>
                    <td className="py-1.5 text-right tabular-nums text-warning">{won(x.amount)}</td>
                  </tr>
                ))}</tbody>
              </table>
              {d.item_count > d.items.length && <div className="text-[11px] text-text-quaternary mt-2">상위 {d.items.length}개 품목 표시 (전체 {d.item_count}개)</div>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
