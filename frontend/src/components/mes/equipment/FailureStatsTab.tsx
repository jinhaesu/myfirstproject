'use client';

import { useEffect, useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { mesGet, type EquipmentEvent } from '@/lib/mes/api';
import { C, PeriodBar, EmptyState, presetRange, COLORS } from '@/lib/mes/ui';

export default function FailureStatsTab({ reloadKey }: { reloadKey: number }) {
  const [range, setRange] = useState(presetRange('thisQuarter'));
  const [events, setEvents] = useState<EquipmentEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async (r = range) => {
    setLoading(true);
    const res = await mesGet<{ items: EquipmentEvent[] }>(`/equipment-events?start=${r.start}&end=${r.end}`, { items: [] });
    setEvents((res.items || []).filter((e) => e.event_type === '고장'));
    setLoading(false);
  };
  useEffect(() => { load(); }, [reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const chartData = useMemo(() => {
    const map = new Map<string, { name: string; count: number; downtime: number }>();
    events.forEach((e) => {
      const name = e.equipment_name || `설비#${e.equipment_id}`;
      if (!map.has(name)) map.set(name, { name, count: 0, downtime: 0 });
      const row = map.get(name)!;
      row.count += 1;
      row.downtime += e.downtime_minutes || 0;
    });
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [events]);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <PeriodBar range={range} setRange={setRange} onApply={load} />
      </div>
      {!loading && chartData.length === 0 && <EmptyState title="해당 기간 고장 이력이 없습니다" />}
      {chartData.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className={C.cardPad}>
            <div className="text-sm font-bold text-text-primary mb-3">설비별 고장 건수</div>
            <div style={{ width: '100%', height: Math.max(260, chartData.length * 34) }}>
              <ResponsiveContainer>
                <BarChart data={chartData} layout="vertical" margin={{ left: 20, right: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="count" name="고장 건수" fill={COLORS[4]} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className={C.cardPad}>
            <div className="text-sm font-bold text-text-primary mb-3">설비별 정지시간 합계(분)</div>
            <div style={{ width: '100%', height: Math.max(260, chartData.length * 34) }}>
              <ResponsiveContainer>
                <BarChart data={chartData} layout="vertical" margin={{ left: 20, right: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="downtime" name="정지시간(분)" fill={COLORS[6]} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
