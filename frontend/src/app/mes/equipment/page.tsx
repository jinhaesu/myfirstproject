'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Navigation } from '@/components/layout/Navigation';
import { mesGet, type MesEquipment, type MesCode } from '@/lib/mes/api';
import { C, PageHeader, StatCard, Tabs, todayISO, EmptyState, useToast } from '@/lib/mes/ui';
import type { EquipStatusRow } from '@/components/mes/equipment/types';
import { EVENT_TYPES } from '@/components/mes/equipment/_shared';
import EquipmentCard from '@/components/mes/equipment/EquipmentCard';
import EquipmentDrawer from '@/components/mes/equipment/EquipmentDrawer';
import EventModal from '@/components/mes/equipment/EventModal';
import HistoryTab from '@/components/mes/equipment/HistoryTab';
import UtilizationTab from '@/components/mes/equipment/UtilizationTab';
import FailureStatsTab from '@/components/mes/equipment/FailureStatsTab';

type BottomTab = '이력 목록' | '가동 현황' | '고장 통계';
const BOTTOM_TABS: BottomTab[] = ['이력 목록', '가동 현황', '고장 통계'];
const FLOOR_OPTS = ['전체', '1F', '2F', '3F'];

export default function MesEquipmentPage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  const [date, setDate] = useState(todayISO());
  const [floor, setFloor] = useState('전체');
  const [rows, setRows] = useState<EquipStatusRow[]>([]);
  const [equipmentAll, setEquipmentAll] = useState<MesEquipment[]>([]);
  const [eventTypes, setEventTypes] = useState<string[]>(EVENT_TYPES);
  const [loading, setLoading] = useState(true);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [eventModal, setEventModal] = useState<{ open: boolean; equipmentId: number | null }>({ open: false, equipmentId: null });
  const [bottomTab, setBottomTab] = useState<BottomTab>('이력 목록');
  const [reloadKey, setReloadKey] = useState(0);
  const { show, node } = useToast();

  useEffect(() => { if (!isLoading && !user) router.replace('/login'); }, [isLoading, user, router]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setLoading(true);
    mesGet<{ items: EquipStatusRow[] }>(`/equipment/status?date=${date}`, { items: [] }).then((r) => {
      if (cancelled) return;
      setRows(r.items || []);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [user, date, reloadKey]);

  useEffect(() => {
    if (!user) return;
    mesGet<{ items: MesEquipment[] }>('/equipment?active=1', { items: [] }).then((r) => setEquipmentAll(r.items || []));
    mesGet<{ items: MesCode[] }>('/codes?group=EQ_EVENT', { items: [] }).then((r) => {
      const names = (r.items || []).filter((c) => c.is_active).map((c) => c.name);
      if (names.length > 0) setEventTypes(names);
    });
  }, [user]);

  const filteredRows = useMemo(() => rows.filter((r) => floor === '전체' || (r.equipment.floor || '-') === floor), [rows, floor]);
  const grouped = useMemo(() => {
    const map = new Map<string, EquipStatusRow[]>();
    filteredRows.forEach((r) => { const k = r.equipment.floor || '미지정'; if (!map.has(k)) map.set(k, []); map.get(k)!.push(r); });
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filteredRows]);

  const kpi = useMemo(() => ({
    running: rows.filter((r) => r.state === 'running').length,
    idle: rows.filter((r) => r.state === 'idle').length,
    down: rows.filter((r) => r.state === 'down').length,
    off: rows.filter((r) => r.state === 'off').length,
    openEvents: rows.reduce((s, r) => s + (r.open_events || 0), 0),
  }), [rows]);

  if (isLoading || !user) return <div className="min-h-screen bg-bg-0" />;

  const selectedRow = rows.find((r) => r.equipment.id === selectedId) || null;

  return (
    <div className="min-h-screen bg-bg-0">
      <Navigation />
      <main className="max-w-[1400px] mx-auto px-4 py-6">
        <PageHeader
          title="설비관리"
          right={
            <>
              <input type="date" className={C.input} value={date} onChange={(e) => setDate(e.target.value)} />
              <div className="flex gap-1">
                {FLOOR_OPTS.map((f) => (
                  <button key={f} onClick={() => setFloor(f)} className={`${C.btn} ${floor === f ? C.btnPrimary : C.btnGhost} px-2.5 py-1.5 text-xs`}>{f}</button>
                ))}
              </div>
              <button onClick={() => setEventModal({ open: true, equipmentId: null })} className={`${C.btn} ${C.btnPrimary}`}>+ 이력 등록</button>
            </>
          }
        />

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-5">
          <StatCard label="가동중" value={kpi.running} tone="text-accent" />
          <StatCard label="대기" value={kpi.idle} />
          <StatCard label="고장" value={kpi.down} tone="text-danger" />
          <StatCard label="비활성" value={kpi.off} />
          <StatCard label="미결 이벤트" value={kpi.openEvents} tone="text-warning" />
        </div>

        {!loading && filteredRows.length === 0 && <EmptyState title="표시할 설비가 없습니다" sub="층 필터나 날짜를 확인해보세요" />}
        <div className="flex flex-col gap-6 mb-8">
          {grouped.map(([f, list]) => (
            <div key={f}>
              <div className="text-xs font-bold text-text-tertiary mb-2">{f} ({list.length})</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {list.map((r) => (
                  <EquipmentCard key={r.equipment.id} row={r} onClick={() => setSelectedId(r.equipment.id)} />
                ))}
              </div>
            </div>
          ))}
        </div>

        <Tabs tabs={BOTTOM_TABS.map((t) => ({ key: t, label: t }))} value={bottomTab} onChange={setBottomTab} />
        <div className="mt-4">
          {bottomTab === '이력 목록' && <HistoryTab reloadKey={reloadKey} />}
          {bottomTab === '가동 현황' && <UtilizationTab date={date} />}
          {bottomTab === '고장 통계' && <FailureStatsTab reloadKey={reloadKey} />}
        </div>
      </main>

      <EquipmentDrawer
        row={selectedRow}
        date={date}
        onClose={() => setSelectedId(null)}
        onOpenEventModal={(id) => setEventModal({ open: true, equipmentId: id })}
        reloadKey={reloadKey}
      />
      <EventModal
        open={eventModal.open}
        onClose={() => setEventModal({ open: false, equipmentId: null })}
        equipmentOptions={equipmentAll}
        presetEquipmentId={eventModal.equipmentId}
        eventTypes={eventTypes}
        onSaved={() => setReloadKey((k) => k + 1)}
        showToast={show}
      />
      {node}
    </div>
  );
}
