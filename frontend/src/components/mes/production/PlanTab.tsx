'use client';

import { useEffect, useMemo, useState } from 'react';
import { mesGet, mesPost, type MesItem } from '@/lib/mes/api';
import { C, downloadCSV, fmt, monthISO, todayISO } from '@/lib/mes/ui';
import { Combobox } from '@/components/Combobox';
import { PlansResponse } from './types';

const empty: PlansResponse = { items: [], actual: {} };

interface RowMeta { item_name: string; item_id?: number | null; family_code?: string | null }

export function PlanTab() {
  const [month, setMonth] = useState(monthISO());
  const [data, setData] = useState<PlansResponse>(empty);
  const [rows, setRows] = useState<RowMeta[]>([]);
  const [grid, setGrid] = useState<Record<string, Record<string, string>>>({});
  const [changed, setChanged] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [itemQuery, setItemQuery] = useState('');

  const days = useMemo(() => {
    const [y, m] = month.split('-').map(Number);
    const n = new Date(y, m, 0).getDate();
    return Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
  }, [month]);

  const load = () => {
    setLoading(true);
    mesGet<PlansResponse>(`/plans?month=${month}`, empty).then((r) => {
      setData(r);
      const metaByName = new Map<string, RowMeta>();
      const g: Record<string, Record<string, string>> = {};
      for (const p of r.items || []) {
        if (!metaByName.has(p.item_name)) metaByName.set(p.item_name, { item_name: p.item_name, item_id: p.item_id, family_code: p.family_code });
        if (!g[p.item_name]) g[p.item_name] = {};
        g[p.item_name][p.plan_date] = String(p.plan_qty ?? '');
      }
      setRows(Array.from(metaByName.values()));
      setGrid(g);
      setChanged(new Set());
      setLoading(false);
    });
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [month]);

  const setCell = (itemName: string, date: string, value: string) => {
    setGrid((g) => ({ ...g, [itemName]: { ...(g[itemName] || {}), [date]: value } }));
    setChanged((s) => new Set(s).add(`${itemName}|${date}`));
  };

  const addItem = (it: MesItem) => {
    if (rows.some((r) => r.item_name === it.name)) return;
    setRows((r) => [...r, { item_name: it.name, item_id: it.id, family_code: it.family_code }]);
    setGrid((g) => ({ ...g, [it.name]: g[it.name] || {} }));
    setItemQuery('');
  };

  const rowTotal = (itemName: string) => days.reduce((s, d) => s + (Number(grid[itemName]?.[d]) || 0), 0);
  const colTotal = (date: string) => rows.reduce((s, r) => s + (Number(grid[r.item_name]?.[date]) || 0), 0);
  const grandTotal = useMemo(() => rows.reduce((s, r) => s + rowTotal(r.item_name), 0), [rows, grid]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    if (changed.size === 0) return;
    setSaving(true);
    const items: { plan_date: string; item_id?: number | null; item_name: string; family_code?: string | null; plan_qty: number }[] = [];
    for (const key of Array.from(changed)) {
      const [itemName, date] = key.split('|');
      const meta = rows.find((r) => r.item_name === itemName);
      items.push({ plan_date: date, item_id: meta?.item_id ?? undefined, item_name: itemName, family_code: meta?.family_code ?? undefined, plan_qty: Number(grid[itemName]?.[date]) || 0 });
    }
    const r = await mesPost('/plans/bulk', { items });
    setSaving(false);
    if (r.ok) load();
  };

  const exportCSV = () => {
    downloadCSV(`plans_${month}.csv`, ['품목', ...days.map((d) => d.slice(8))], rows.map((r) => [r.item_name, ...days.map((d) => grid[r.item_name]?.[d] || '')]));
  };

  const isWeekend = (d: string) => { const wd = new Date(d + 'T00:00:00').getDay(); return wd === 0 || wd === 6; };
  const isToday = (d: string) => d === todayISO();

  return (
    <div>
      <div className={`${C.cardPad} mb-4 flex flex-wrap items-center gap-2`}>
        <input type="month" className={C.input} value={month} onChange={(e) => setMonth(e.target.value)} />
        <div className="w-64">
          <Combobox<MesItem>
            value={itemQuery}
            onChange={setItemQuery}
            fetcher={(q) => mesGet<{ items: MesItem[] }>('/items?q=' + q, { items: [] }).then((r) => r.items || [])}
            getLabel={(it) => it.name}
            render={(it) => <div><div className="font-medium text-text-primary">{it.name}</div><div className="text-[11px] text-text-tertiary">{it.item_type || ''}</div></div>}
            onPick={addItem}
            placeholder="+ 품목 추가"
          />
        </div>
        <div className="ml-auto flex gap-2">
          <button className={`${C.btn} ${C.btnGhost}`} onClick={exportCSV}>이 달 CSV</button>
          <button className={`${C.btn} ${C.btnPrimary}`} disabled={saving || changed.size === 0} onClick={save}>{saving ? '저장 중…' : `저장${changed.size > 0 ? ` (${changed.size})` : ''}`}</button>
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-text-tertiary py-10 text-center">불러오는 중…</div>
      ) : (
        <div className={`${C.card} overflow-x-auto`}>
          <table className="border-collapse min-w-max">
            <thead>
              <tr>
                <th className={`${C.th} sticky left-0 bg-bg-1 z-10 min-w-[140px]`}>품목</th>
                {days.map((d) => (
                  <th key={d} className={`${C.th} text-center min-w-[56px] ${isWeekend(d) ? 'bg-bg-inset/40' : ''} ${isToday(d) ? 'text-accent' : ''}`}>{Number(d.slice(8))}</th>
                ))}
                <th className={`${C.th} text-right min-w-[70px]`}>합계</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.item_name}>
                  <td className={`${C.td} sticky left-0 bg-bg-1 z-10 text-text-primary font-medium`}>{r.item_name}</td>
                  {days.map((d) => {
                    const key = `${r.item_name}|${d}`;
                    const val = grid[r.item_name]?.[d] || '';
                    const actual = data.actual?.[key];
                    const isChanged = changed.has(key);
                    return (
                      <td key={d} className={`${C.td} p-1 text-center ${isWeekend(d) ? 'bg-bg-inset/30' : ''} ${isToday(d) ? 'bg-brand/5' : ''}`}>
                        <input
                          value={val}
                          onChange={(e) => setCell(r.item_name, d, e.target.value.replace(/[^0-9.]/g, ''))}
                          className={`w-12 text-right text-xs bg-transparent border rounded px-1 py-0.5 focus:outline-none focus:border-brand tabular-nums ${isChanged ? 'border-warning bg-warning/10' : 'border-transparent hover:border-border-primary'}`}
                        />
                        {actual !== undefined && (
                          <div className={`text-[9px] tabular-nums ${val && actual >= Number(val) ? 'text-success' : 'text-text-quaternary'}`}>{fmt(actual)}</div>
                        )}
                      </td>
                    );
                  })}
                  <td className={`${C.tdNum} font-semibold text-text-primary`}>{fmt(rowTotal(r.item_name))}</td>
                </tr>
              ))}
              {rows.length > 0 && (
                <tr className="bg-bg-inset/40">
                  <td className={`${C.td} sticky left-0 bg-bg-inset/40 z-10 font-bold text-text-primary`}>합계</td>
                  {days.map((d) => <td key={d} className={`${C.tdNum} font-semibold`}>{fmt(colTotal(d))}</td>)}
                  <td className={`${C.tdNum} font-bold text-accent`}>{fmt(grandTotal)}</td>
                </tr>
              )}
            </tbody>
          </table>
          {rows.length === 0 && <div className="text-center py-10 text-sm text-text-tertiary">등록된 생산계획이 없습니다. 품목을 추가해 계획을 입력하세요.</div>}
        </div>
      )}
    </div>
  );
}
