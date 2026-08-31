'use client';

import { useEffect, useState } from 'react';
import {
  Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { mesGet, type MesCode } from '@/lib/mes/api';
import { C, EmptyState, PeriodBar, presetRange } from '@/lib/mes/ui';
import { TrendResponse, ratioPct } from './types';

const empty: TrendResponse = { series: [] };

export function TrendTab() {
  const [range, setRange] = useState(presetRange('thisMonth'));
  const [granularity, setGranularity] = useState<'day' | 'week' | 'month'>('day');
  const [familyCode, setFamilyCode] = useState('');
  const [families, setFamilies] = useState<MesCode[]>([]);
  const [data, setData] = useState<TrendResponse>(empty);
  const [loading, setLoading] = useState(false);

  useEffect(() => { mesGet<{ items: MesCode[] }>('/codes?group=FAMILY', { items: [] }).then((r) => setFamilies(r.items || [])); }, []);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ start: range.start, end: range.end, granularity });
    if (familyCode) params.set('family_code', familyCode);
    mesGet<TrendResponse>(`/production/trend?${params.toString()}`, empty).then((r) => { setData(r); setLoading(false); });
  }, [range.start, range.end, granularity, familyCode]);

  const series = (data.series || []).map((s) => ({ ...s, oee_pct: ratioPct(s.oee) }));

  return (
    <div>
      <div className={`${C.cardPad} mb-4 flex flex-wrap items-center gap-2`}>
        <PeriodBar range={range} setRange={setRange} />
        <div className="flex gap-1">
          {(['day', 'week', 'month'] as const).map((g) => (
            <button key={g} className={`${C.btn} !px-2.5 !py-1.5 ${granularity === g ? C.btnPrimary : C.btnGhost}`} onClick={() => setGranularity(g)}>{g === 'day' ? '일' : g === 'week' ? '주' : '월'}</button>
          ))}
        </div>
        <select className={C.select} value={familyCode} onChange={(e) => setFamilyCode(e.target.value)}>
          <option value="">전체 제품군</option>
          {families.map((f) => <option key={f.id} value={f.code}>{f.name}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="text-sm text-text-tertiary py-10 text-center">불러오는 중…</div>
      ) : series.length === 0 ? (
        <EmptyState title="추이 데이터가 없습니다" sub="조회 조건을 변경해보세요" />
      ) : (
        <div className="space-y-4">
          <div className={`${C.cardPad} h-80`}>
            <div className="text-sm font-bold text-text-primary mb-2">계획 vs 실적 · OEE</div>
            <ResponsiveContainer width="100%" height="90%">
              <ComposedChart data={series}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-primary)" />
                <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                <YAxis yAxisId="qty" tick={{ fontSize: 11 }} />
                <YAxis yAxisId="oee" orientation="right" domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" />
                <Tooltip />
                <Legend />
                <Bar yAxisId="qty" dataKey="plan_qty" name="계획수량" fill="var(--color-brand-bg)" fillOpacity={0.35} radius={[3, 3, 0, 0]} />
                <Bar yAxisId="qty" dataKey="prod_qty" name="생산수량" fill="var(--color-brand-bg)" radius={[3, 3, 0, 0]} />
                <Line yAxisId="oee" type="monotone" dataKey="oee_pct" name="OEE(%)" stroke="var(--color-success)" strokeWidth={2.5} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className={`${C.cardPad} h-64`}>
            <div className="text-sm font-bold text-text-primary mb-2">비가동(분) · 지시건수</div>
            <ResponsiveContainer width="100%" height="90%">
              <ComposedChart data={series}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-primary)" />
                <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                <YAxis yAxisId="min" tick={{ fontSize: 11 }} />
                <YAxis yAxisId="cnt" orientation="right" tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Bar yAxisId="min" dataKey="downtime_minutes" name="비가동(분)" fill="var(--color-warning)" radius={[3, 3, 0, 0]} />
                <Line yAxisId="cnt" type="monotone" dataKey="wo_count" name="지시건수" stroke="var(--color-info)" strokeWidth={2} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}
