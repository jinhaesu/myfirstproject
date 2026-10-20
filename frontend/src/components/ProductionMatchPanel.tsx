'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

// 생산실적 품목명 ↔ BOM 품목 매칭 관리. 미매칭·부분일치를 별칭으로 확정하면
// BOM 이론소요·원가 동기화(생산 가중평균)에 바로 반영된다.
type Row = { production_name: string; qty: number; csa_product: string | null; item_id: number | null;
  item_name: string | null; match: 'alias' | 'exact' | 'partial' | 'none'; unit_cost: number | null };
type Opt = { id: number; name: string; category: string | null; cost: number };

const authHeaders = (): Record<string, string> => {
  const t = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (t) h.Authorization = `Bearer ${t}`;
  return h;
};
const BADGE: Record<Row['match'], [string, string]> = {
  alias: ['별칭', 'bg-success/10 text-success border-success/25'],
  exact: ['정확', 'bg-info/10 text-info border-info/25'],
  partial: ['부분일치', 'bg-warning/10 text-warning border-warning/30'],
  none: ['미매칭', 'bg-danger/10 text-danger border-danger/30'],
};

export function ProductionMatchPanel() {
  const [open, setOpen] = useState(false);
  const [d, setD] = useState<{ since: string; rows: Row[]; unmatched_pct: number; unmatched_qty: number; total_qty: number; items: Opt[] } | null>(null);
  const [filter, setFilter] = useState<'review' | 'all'>('review');
  const [q, setQ] = useState('');
  const [saving, setSaving] = useState<string | null>(null);
  const load = useCallback(() => {
    fetch('/api/scm/bom/production-matching?days=180', { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : null)).then(setD).catch(() => setD(null));
  }, []);
  useEffect(() => { if (open && !d) load(); }, [open, d, load]);

  const rows = useMemo(() => (d?.rows || []).filter((r) =>
    (filter === 'all' || r.match === 'none' || r.match === 'partial')
    && (!q || r.production_name.includes(q) || (r.item_name || '').includes(q))), [d, filter, q]);

  const save = async (name: string, itemId: number | null) => {
    setSaving(name);
    await fetch('/api/scm/bom/production-alias', { method: 'PUT', headers: authHeaders(),
      body: JSON.stringify({ production_name: name, item_id: itemId }) }).catch(() => null);
    setSaving(null);
    load();
  };

  return (
    <div className="bg-bg-1 border border-border-primary rounded-xl p-4 mb-5">
      <button type="button" onClick={() => setOpen((v) => !v)} className="w-full flex flex-wrap items-center gap-2 text-left">
        <span className="text-sm font-semibold text-text-primary">생산품목 ↔ BOM 매칭</span>
        {d && <span className={`text-xs px-2 py-0.5 rounded-md ${d.unmatched_pct > 3 ? 'bg-danger/15 text-danger' : 'bg-success/15 text-success'}`}>
          최근 180일 미매칭 {d.unmatched_pct}% ({d.unmatched_qty.toLocaleString('ko-KR')}개)</span>}
        <span className="text-xs text-text-quaternary">생산실적 품목명이 어느 BOM으로 원가 계산되는지 확인·지정</span>
        <span className="ml-auto text-text-tertiary text-sm">{open ? '접기 ▲' : '열기 ▼'}</span>
      </button>
      {open && (
        <div className="mt-3">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            {(['review', 'all'] as const).map((f) => (
              <button key={f} onClick={() => setFilter(f)} className={`px-2.5 py-1 rounded-md text-xs border ${filter === f ? 'bg-brand text-white border-brand' : 'border-border-primary text-text-secondary'}`}>
                {f === 'review' ? '점검 필요(미매칭·부분일치)' : '전체'}</button>
            ))}
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="품목명 검색" className="bg-bg-0 border border-border-primary rounded-lg px-2.5 py-1 text-xs text-text-primary focus:outline-none focus:border-brand" />
            {d && <span className="text-[11px] text-text-quaternary ml-auto">{d.since}~ · 별칭 지정 즉시 BOM 이론소요에 반영, 매출원가는 원가 동기화 후 반영</span>}
          </div>
          <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-bg-1"><tr className="text-text-tertiary text-left">
                <th className="py-1.5 pr-2 font-medium">생산 품목명</th><th className="py-1.5 pr-2 font-medium text-right">생산량</th>
                <th className="py-1.5 pr-2 font-medium">매칭</th><th className="py-1.5 pr-2 font-medium">BOM 품목 (변경 가능)</th>
                <th className="py-1.5 font-medium text-right">개당원가</th>
              </tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.production_name + (r.csa_product || '')} className="border-t border-border-primary">
                  <td className="py-1.5 pr-2 text-text-primary">{r.production_name}{r.csa_product && <span className="text-text-quaternary ml-1">· {r.csa_product}</span>}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums text-text-secondary">{r.qty.toLocaleString('ko-KR')}</td>
                  <td className="py-1.5 pr-2"><span className={`px-1.5 py-0.5 rounded border ${BADGE[r.match][1]}`}>{BADGE[r.match][0]}</span></td>
                  <td className="py-1.5 pr-2">
                    <select value={r.item_id ?? ''} disabled={saving === r.production_name}
                      onChange={(e) => save(r.production_name, e.target.value ? Number(e.target.value) : null)}
                      className="w-full max-w-[26rem] bg-bg-0 border border-border-primary rounded-md px-1.5 py-1 text-xs text-text-primary">
                      <option value="">— 미지정 —</option>
                      {(d?.items || []).map((o) => <option key={o.id} value={o.id}>{o.name} ({o.cost.toLocaleString('ko-KR')}원)</option>)}
                    </select>
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-warning">{r.unit_cost != null ? `${r.unit_cost.toLocaleString('ko-KR')}원` : '-'}</td>
                </tr>
              ))}</tbody>
            </table>
            {rows.length === 0 && <div className="py-6 text-center text-xs text-text-quaternary">{d ? '점검할 항목이 없습니다' : '불러오는 중…'}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
