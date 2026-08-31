'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Navigation } from '@/components/layout/Navigation';
import { mesGet } from '@/lib/mes/api';
import { C, EmptyState, dt } from '@/lib/mes/ui';
import { Tile } from '@/components/mes/monitoring/Tile';
import { DetailDrawer } from '@/components/mes/monitoring/DetailDrawer';
import type { MonitoringResp, MonitorTile } from '@/components/mes/monitoring/types';

const REFRESH_SEC = 30;
const FLOORS: { key: string; label: string }[] = [{ key: '2F', label: '2F' }, { key: '3F', label: '3F' }];

export default function MonitoringPage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  useEffect(() => { if (!isLoading && !user) router.replace('/login'); }, [isLoading, user, router]);

  const [floor, setFloor] = useState('2F');
  const [data, setData] = useState<MonitoringResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [auto, setAuto] = useState(true);
  const [countdown, setCountdown] = useState(REFRESH_SEC);
  const [fullscreen, setFullscreen] = useState(false);
  const [selected, setSelected] = useState<MonitorTile | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    mesGet<MonitoringResp>(`/monitoring?floor=${floor}`, { floor, groups: [], updated_at: null }).then(setData).finally(() => { setLoading(false); setCountdown(REFRESH_SEC); });
  }, [floor]);

  useEffect(() => { if (user) load(); }, [user, load]);

  useEffect(() => {
    if (!auto) return;
    const t = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) { load(); return REFRESH_SEC; }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [auto, load]);

  useEffect(() => {
    const onFsChange = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);
  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen().catch(() => setFullscreen(true));
  };

  if (isLoading || !user) return <div className="min-h-screen bg-bg-0" />;

  return (
    <div className="min-h-screen bg-bg-0">
      {!fullscreen && <Navigation />}
      <main className="max-w-none px-3 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold text-text-primary">모니터링 보드</h1>
            <div className="flex gap-1 bg-bg-1 border border-border-primary rounded-lg p-1">
              {FLOORS.map((f) => (
                <button key={f.key} onClick={() => setFloor(f.key)} className={`px-4 py-1.5 rounded-md text-sm font-bold transition-colors ${floor === f.key ? 'bg-brand text-white' : 'text-text-tertiary'}`}>{f.label}</button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-tertiary">마지막 갱신 {data?.updated_at ? dt(data.updated_at) : '-'}</span>
            <button onClick={() => setAuto((a) => !a)} className={`${C.btn} ${auto ? C.btnPrimary : C.btnGhost}`}>
              자동새로고침 {auto ? `${countdown}s` : 'OFF'}
            </button>
            <button onClick={load} className={`${C.btn} ${C.btnGhost}`}>새로고침</button>
            <button onClick={toggleFullscreen} className={`${C.btn} ${fullscreen ? C.btnWarn : C.btnGhost}`}>{fullscreen ? '전체화면 종료' : '전체화면'}</button>
          </div>
        </div>

        {loading && !data ? (
          <div className="py-16 text-center text-text-tertiary text-sm">불러오는 중…</div>
        ) : !data || data.groups.length === 0 ? (
          <EmptyState title="모니터링 데이터가 없습니다" sub="다른 층을 선택해보세요" />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {data.groups.map((g) => (
              <div key={g.title} className="bg-bg-1 border border-border-primary rounded-xl p-4">
                <div className="text-sm font-bold text-text-primary mb-3">{g.title}</div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {g.tiles.map((t) => <Tile key={t.equipment_id} tile={t} onClick={() => setSelected(t)} />)}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
      <DetailDrawer tile={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
