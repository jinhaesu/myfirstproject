'use client';

import { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { mesGet } from '@/lib/mes/api';
import { C, EmptyState, COLORS } from '@/lib/mes/ui';
import type { EquipRunSummaryRow } from './types';

export default function UtilizationTab({ date }: { date: string }) {
  const [rows, setRows] = useState<EquipRunSummaryRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    mesGet<{ by_equipment?: EquipRunSummaryRow[] }>(`/runs/summary?date=${date}`, {}).then((r) => {
      setRows(r.by_equipment || []);
      setLoading(false);
    });
  }, [date]);

  const chartData = rows.map((r) => ({
    name: r.name,
    pass: r.pass ?? Math.max(0, (r.total || 0) - (r.fail || 0)),
    fail: r.fail ?? 0,
  }));

  if (!loading && chartData.length === 0) return <EmptyState title={`${date} 실행 데이터가 없습니다`} />;

  return (
    <div className={`${C.cardPad}`}>
      <div className="text-sm font-bold text-text-primary mb-3">설비별 오늘 실행 · 부적합 ({date})</div>
      <div style={{ width: '100%', height: Math.max(280, chartData.length * 40) }}>
        <ResponsiveContainer>
          <BarChart data={chartData} layout="vertical" margin={{ left: 20, right: 20 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
            <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 11 }} />
            <Tooltip />
            <Legend />
            <Bar dataKey="pass" name="적합" stackId="a" fill={COLORS[1]} radius={[0, 0, 0, 0]} />
            <Bar dataKey="fail" name="부적합" stackId="a" fill={COLORS[4]} radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
