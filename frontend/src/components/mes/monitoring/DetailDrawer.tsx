'use client';

import { useEffect, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { mesGet } from '@/lib/mes/api';
import type { ProcessRun } from '@/lib/mes/api';
import { Drawer, C, JudgePill, hhmm, fmt, EmptyState, todayISO } from '@/lib/mes/ui';
import type { MonitorTile, SensorResp } from './types';

/** 타일 클릭 상세 — 최근 24시간 온도 스파크라인 + 오늘 실행 목록 */
export function DetailDrawer({ tile, onClose }: { tile: MonitorTile | null; onClose: () => void }) {
  const [points, setPoints] = useState<{ t: string; v: number }[]>([]);
  const [runs, setRuns] = useState<ProcessRun[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!tile) return;
    setLoading(true);
    const end = new Date();
    const start = new Date(end.getTime() - 24 * 3600 * 1000);
    const kind = tile.kind === 'metal' ? 'metal_pass' : 'temp';
    Promise.all([
      mesGet<SensorResp>(`/sensors?equipment_id=${tile.equipment_id}&start=${start.toISOString()}&end=${end.toISOString()}&kind=${kind}`, { items: [] }),
      mesGet<{ items: ProcessRun[] }>(`/runs?date=${todayISO()}&equipment_id=${tile.equipment_id}`, { items: [] }),
    ]).then(([sensors, r]) => {
      setPoints((sensors.items || []).map((p) => ({ t: hhmm(p.ts), v: p.value })));
      setRuns(r.items || []);
    }).finally(() => setLoading(false));
  }, [tile]);

  return (
    <Drawer open={!!tile} onClose={onClose} title={tile?.name || ''} width="max-w-2xl">
      {tile && (
        <div className="flex flex-col gap-5">
          <div>
            <div className="text-xs font-semibold text-text-tertiary mb-2">최근 24시간 {tile.kind === 'metal' ? '양품 판정' : '온도'} 추이</div>
            <div className="h-56 bg-bg-0 border border-border-primary rounded-xl p-2">
              {points.length === 0 ? (
                <div className="h-full flex items-center justify-center text-xs text-text-tertiary">{loading ? '불러오는 중…' : '센서 데이터가 없습니다'}</div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={points}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-primary)" />
                    <XAxis dataKey="t" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} domain={['auto', 'auto']} />
                    <Tooltip />
                    <Line type="monotone" dataKey="v" stroke="#5E6AD2" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
          <div>
            <div className="text-xs font-semibold text-text-tertiary mb-2">오늘 실행 목록</div>
            {runs.length === 0 ? <EmptyState title="오늘 실행 내역이 없습니다" /> : (
              <table className="w-full border-collapse">
                <thead><tr><th className={C.th}>품명</th><th className={C.th}>시작</th><th className={C.th}>종료</th><th className={C.th}>측정</th><th className={C.th}>판정</th></tr></thead>
                <tbody>{runs.map((r) => (
                  <tr key={r.id}><td className={C.td}>{r.item_name || '-'}</td><td className={C.td}>{hhmm(r.start_at)}</td><td className={C.td}>{hhmm(r.end_at)}</td><td className={C.tdNum}>{r.measured_value != null ? fmt(r.measured_value) : '-'}</td><td className={C.td}><JudgePill j={r.judgment} size="sm" /></td></tr>
                ))}</tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </Drawer>
  );
}
