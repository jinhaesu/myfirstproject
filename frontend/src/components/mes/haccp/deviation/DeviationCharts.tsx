'use client';

// 이탈 통계 3종 — 유형별/공정별 바, 일별 추이 라인. GET /deviations/stats 응답 사용.
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts';
import { C, COLORS, SectionTitle } from '@/lib/mes/ui';

export interface StatItem { code?: string; name: string; count: number }
export interface DayItem { date: string; count: number }

export default function DeviationCharts({ byType, byProcess, byDay }: { byType: StatItem[]; byProcess: StatItem[]; byDay: DayItem[] }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className={`${C.cardPad} h-64`}>
        <SectionTitle>유형별 발생</SectionTitle>
        <ResponsiveContainer width="100%" height="85%">
          <BarChart data={byType} margin={{ left: -20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-primary)" />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={50} />
            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
            <Tooltip />
            <Bar dataKey="count" fill={COLORS[0]} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className={`${C.cardPad} h-64`}>
        <SectionTitle>공정별 발생</SectionTitle>
        <ResponsiveContainer width="100%" height="85%">
          <BarChart data={byProcess} margin={{ left: -20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-primary)" />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={50} />
            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
            <Tooltip />
            <Bar dataKey="count" fill={COLORS[4]} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className={`${C.cardPad} h-64`}>
        <SectionTitle>일별 추이</SectionTitle>
        <ResponsiveContainer width="100%" height="85%">
          <LineChart data={byDay} margin={{ left: -20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-primary)" />
            <XAxis dataKey="date" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
            <Tooltip />
            <Line type="monotone" dataKey="count" stroke={COLORS[1]} strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
