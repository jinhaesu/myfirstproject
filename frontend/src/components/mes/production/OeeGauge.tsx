'use client';

import { PolarAngleAxis, RadialBar, RadialBarChart, ResponsiveContainer } from 'recharts';

function toneColor(v: number): string {
  if (v >= 85) return 'var(--color-success)';
  if (v >= 60) return 'var(--color-warning)';
  return 'var(--color-danger)';
}

export function OeeGauge({ label, value, sub }: { label: string; value: number; sub?: string }) {
  const v = Math.max(0, Math.min(100, value || 0));
  const color = toneColor(v);
  const data = [{ name: label, value: v }];
  return (
    <div className="flex flex-col items-center">
      <div className="w-full h-28 relative">
        <ResponsiveContainer width="100%" height="100%">
          <RadialBarChart cx="50%" cy="50%" innerRadius="72%" outerRadius="100%" barSize={10} data={data} startAngle={90} endAngle={-270}>
            <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
            <RadialBar dataKey="value" cornerRadius={6} fill={color} background={{ fill: 'var(--color-bg-inset)' }} isAnimationActive={false} />
          </RadialBarChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <div className="text-xl font-bold tabular-nums" style={{ color }}>{v.toFixed(0)}%</div>
        </div>
      </div>
      <div className="text-xs font-semibold text-text-secondary mt-1">{label}</div>
      {sub && <div className="text-[10px] text-text-quaternary">{sub}</div>}
    </div>
  );
}
