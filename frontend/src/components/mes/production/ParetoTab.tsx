'use client';

import { useEffect, useState } from 'react';
import {
  Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { mesGet } from '@/lib/mes/api';
import { C, EmptyState, PeriodBar, presetRange, fmt } from '@/lib/mes/ui';
import { ParetoItem, ParetoResponse, ratioPct } from './types';

const empty: ParetoResponse = { defects: [], downtimes: [] };

function ParetoChart({ title, items, valueKey, unit, color }: { title: string; items: ParetoItem[]; valueKey: 'qty' | 'minutes'; unit: string; color: string }) {
  const data = items.map((it) => ({ ...it, cum: ratioPct(it.cum_pct) }));
  return (
    <div className={`${C.cardPad}`}>
      <div className="text-sm font-bold text-text-primary mb-2">{title}</div>
      {items.length === 0 ? <EmptyState title="데이터가 없습니다" sub="" /> : (
        <>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={data}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-primary)" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} angle={-20} textAnchor="end" height={60} />
                <YAxis yAxisId="v" tick={{ fontSize: 11 }} />
                <YAxis yAxisId="c" orientation="right" domain={[0, 100]} unit="%" tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar yAxisId="v" dataKey={valueKey} name={unit} fill={color} radius={[3, 3, 0, 0]} />
                <Line yAxisId="c" type="monotone" dataKey="cum" name="누적%" stroke="var(--color-text-primary)" strokeWidth={2} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="text-xs text-text-tertiary mt-2">
            상위 3개: {items.slice(0, 3).map((it) => `${it.name}(${fmt(it[valueKey])}${unit}, ${ratioPct(it.pct).toFixed(0)}%)`).join(' · ')} — 누적 {ratioPct(data[Math.min(2, data.length - 1)]?.cum).toFixed(0)}%
          </div>
        </>
      )}
    </div>
  );
}

export function ParetoTab() {
  const [range, setRange] = useState(presetRange('thisMonth'));
  const [data, setData] = useState<ParetoResponse>(empty);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    mesGet<ParetoResponse>(`/production/pareto?start=${range.start}&end=${range.end}`, empty).then((r) => { setData(r); setLoading(false); });
  }, [range.start, range.end]);

  return (
    <div>
      <div className={`${C.cardPad} mb-4`}>
        <PeriodBar range={range} setRange={setRange} />
      </div>
      {loading ? (
        <div className="text-sm text-text-tertiary py-10 text-center">불러오는 중…</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ParetoChart title="불량 파레토" items={data.defects} valueKey="qty" unit="건" color="var(--color-danger)" />
          <ParetoChart title="비가동 파레토" items={data.downtimes} valueKey="minutes" unit="분" color="var(--color-warning)" />
        </div>
      )}
    </div>
  );
}
