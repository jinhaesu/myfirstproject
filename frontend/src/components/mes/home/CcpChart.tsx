'use client';

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { EmptyState, SectionTitle } from '@/lib/mes/ui';
import type { DashRunByProcess } from './types';

/** 공정별 CCP 적합률 가로 바 차트 */
export function CcpChart({ rows }: { rows: DashRunByProcess[] }) {
  const data = (rows || []).map((r) => ({ name: r.name, rate: Math.round((r.pass_rate <= 1.5 ? r.pass_rate * 100 : r.pass_rate) * 10) / 10, fail: r.fail }));
  return (
    <div className="bg-bg-1 border border-border-primary rounded-xl p-4">
      <SectionTitle>공정별 CCP 적합률</SectionTitle>
      {data.length === 0 ? <EmptyState title="오늘 실행된 CCP 공정이 없습니다" /> : (
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ left: 8, right: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-primary)" horizontal={false} />
              <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" />
              <YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v: number) => `${v}%`} />
              <Bar dataKey="rate" radius={[0, 6, 6, 0]}>
                {data.map((d, i) => <Cell key={i} fill={d.rate >= 95 ? '#27A644' : d.rate >= 80 ? '#F0BF00' : '#EB5757'} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
