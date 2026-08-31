'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Navigation } from '@/components/layout/Navigation';
import {
  mesGet, mesPost, type MesEquipment, type MesProcess, type MesWorker, type WorkOrder,
} from '@/lib/mes/api';
import {
  C, EmptyState, PageHeader, Pill, StatCard, WO_STATUS, downloadCSV, fmt, todayISO, useToast,
} from '@/lib/mes/ui';
import { ListView } from '@/components/mes/work-orders/ListView';
import { KanbanView } from '@/components/mes/work-orders/KanbanView';
import { TimelineView } from '@/components/mes/work-orders/TimelineView';
import { WorkOrderModal } from '@/components/mes/work-orders/WorkOrderModal';
import { BulkGenerateModal } from '@/components/mes/work-orders/BulkGenerateModal';
import { WorkOrderDrawer } from '@/components/mes/work-orders/WorkOrderDrawer';
import { STATUS_ORDER, type TimelineResponse, type ViewMode, type WoAction } from '@/components/mes/work-orders/types';

const STATUS_CHIPS: { key: 'all' | WorkOrder['status']; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'planned', label: '계획' },
  { key: 'released', label: '지시' },
  { key: 'in_progress', label: '진행중' },
  { key: 'paused', label: '일시정지' },
  { key: 'done', label: '완료' },
  { key: 'cancelled', label: '취소' },
];

export default function WorkOrdersPage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  useEffect(() => { if (!isLoading && !user) router.replace('/login'); }, [isLoading, user, router]);

  const { show, node: toastNode } = useToast();

  const [range, setRange] = useState({ start: todayISO(), end: todayISO() });
  const [processId, setProcessId] = useState<number | ''>('');
  const [equipmentId, setEquipmentId] = useState<number | ''>('');
  const [statusChip, setStatusChip] = useState<'all' | WorkOrder['status']>('all');
  const [q, setQ] = useState('');

  const [view, setView] = useState<ViewMode>('list');

  const [processes, setProcesses] = useState<MesProcess[]>([]);
  const [equipment, setEquipment] = useState<MesEquipment[]>([]);
  const [workers, setWorkers] = useState<MesWorker[]>([]);
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [loading, setLoading] = useState(false);

  const [timeline, setTimeline] = useState<TimelineResponse>({ equipment: [] });

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [drawerId, setDrawerId] = useState<number | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<WorkOrder | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);

  useEffect(() => {
    mesGet<{ items: MesProcess[] }>('/processes?active=1', { items: [] }).then((r) => setProcesses(r.items || []));
    mesGet<{ items: MesEquipment[] }>('/equipment', { items: [] }).then((r) => setEquipment(r.items || []));
    mesGet<{ items: MesWorker[] }>('/workers?active=1', { items: [] }).then((r) => setWorkers(r.items || []));
  }, []);

  const loadOrders = () => {
    setLoading(true);
    const params = new URLSearchParams();
    params.set('start', range.start);
    params.set('end', range.end);
    if (processId !== '') params.set('process_id', String(processId));
    if (equipmentId !== '') params.set('equipment_id', String(equipmentId));
    if (q.trim()) params.set('q', q.trim());
    mesGet<{ items: WorkOrder[] }>(`/work-orders?${params.toString()}`, { items: [] }).then((r) => {
      setOrders(r.items || []);
      setLoading(false);
    });
  };

  useEffect(() => { loadOrders(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [range.start, range.end, processId, equipmentId, q]);

  useEffect(() => {
    if (view !== 'timeline') return;
    mesGet<TimelineResponse>(`/work-orders/timeline?date=${range.start}`, { equipment: [] }).then(setTimeline);
  }, [view, range.start, orders]);

  const filteredEquipment = processId === '' ? equipment : equipment.filter((e) => e.process_id === processId);

  const statusCounts = useMemo(() => {
    const m: Record<string, number> = { all: orders.length };
    for (const s of STATUS_ORDER) m[s] = orders.filter((o) => o.status === s).length;
    return m;
  }, [orders]);

  const displayed = useMemo(() => (statusChip === 'all' ? orders : orders.filter((o) => o.status === statusChip)), [orders, statusChip]);

  const kpi = useMemo(() => {
    const count = displayed.length;
    const planQty = displayed.reduce((s, o) => s + (o.plan_qty || 0), 0);
    const goodQty = displayed.reduce((s, o) => s + (o.good_qty || 0), 0);
    const prodQty = displayed.reduce((s, o) => s + (o.prod_qty || 0), 0);
    const defectQty = displayed.reduce((s, o) => s + (o.defect_qty || 0), 0);
    const defectRate = prodQty > 0 ? (defectQty / prodQty) * 100 : 0;
    const avgProgress = count > 0 ? displayed.reduce((s, o) => s + (o.progress_pct || 0), 0) / count : 0;
    return { count, planQty, goodQty, defectRate, avgProgress };
  }, [displayed]);

  const refreshAll = () => { loadOrders(); };

  const handleAction = async (id: number, action: WoAction) => {
    const r = await mesPost(`/work-orders/${id}/${action}`);
    if (!r.ok) { show(r.error || '처리 실패', 'danger'); return; }
    show('처리했습니다');
    refreshAll();
  };

  const toggleSelect = (id: number) => setSelectedIds((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = (ids: number[]) => setSelectedIds((s) => (s.size === ids.length && ids.every((i) => s.has(i)) ? new Set() : new Set(ids)));

  const exportCSV = () => {
    downloadCSV(
      `work-orders_${range.start}_${range.end}.csv`,
      ['지시번호', '지시일', '품명', '제품군', '공정', '설비', '계획', '생산', '양품', '불량', '진행률', '우선순위', '상태', '시작', '종료'],
      displayed.map((o) => [o.wo_no, o.order_date, o.item_name, o.family_code || '', o.process_name || '', o.equipment_name || '', o.plan_qty, o.prod_qty ?? '', o.good_qty ?? '', o.defect_qty ?? '', o.progress_pct ?? '', o.priority, WO_STATUS[o.status]?.label || o.status, o.start_at || '', o.end_at || ''])
    );
  };

  const openCreate = () => { setEditing(null); setModalOpen(true); };
  const openEdit = (o: WorkOrder) => { setEditing(o); setModalOpen(true); setDrawerId(null); };

  if (isLoading || !user) return <div className="min-h-screen bg-bg-0" />;

  return (
    <div className="min-h-screen bg-bg-0">
      <Navigation />
      <main className="max-w-[1400px] mx-auto px-4 py-6">
        <PageHeader
          title="작업지시"
          sub="생산 작업지시 등록 · 진행 · 실적 관리"
          right={
            <>
              <button className={`${C.btn} ${C.btnGhost}`} onClick={() => setBulkOpen(true)}>계획→일괄생성</button>
              <button className={`${C.btn} ${C.btnPrimary}`} onClick={openCreate}>+ 작업지시 등록</button>
            </>
          }
        />

        {/* 필터 바 */}
        <div className={`${C.cardPad} mb-4 flex flex-wrap items-center gap-2`}>
          <input type="date" className={C.input} value={range.start} onChange={(e) => setRange({ ...range, start: e.target.value, end: e.target.value > range.end ? e.target.value : range.end })} />
          <span className="text-text-quaternary">~</span>
          <input type="date" className={C.input} value={range.end} onChange={(e) => setRange({ ...range, end: e.target.value })} />
          <button className={`${C.btn} ${C.btnGhost} !px-2.5 !py-1.5`} onClick={() => setRange({ start: todayISO(), end: todayISO() })}>오늘</button>
          <select className={C.select} value={processId} onChange={(e) => { setProcessId(e.target.value ? Number(e.target.value) : ''); setEquipmentId(''); }}>
            <option value="">전체 공정</option>
            {processes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select className={C.select} value={equipmentId} onChange={(e) => setEquipmentId(e.target.value ? Number(e.target.value) : '')}>
            <option value="">전체 설비</option>
            {filteredEquipment.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
          <input className={`${C.input} w-48`} placeholder="지시번호/품명 검색" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="ml-auto flex items-center gap-2">
            <button className={`${C.btn} ${C.btnGhost}`} onClick={exportCSV}>CSV</button>
          </div>
        </div>

        {/* 상태 칩 */}
        <div className="flex flex-wrap gap-1.5 mb-4">
          {STATUS_CHIPS.map((c) => (
            <button key={c.key} onClick={() => setStatusChip(c.key)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${statusChip === c.key ? 'bg-brand text-white border-brand' : 'bg-bg-inset text-text-secondary border-border-primary hover:border-brand'}`}>
              {c.label} <span className="tabular-nums opacity-80">{statusCounts[c.key] ?? 0}</span>
            </button>
          ))}
        </div>

        {/* KPI */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4">
          <StatCard label="건수" value={`${fmt(kpi.count)}건`} />
          <StatCard label="계획수량" value={fmt(kpi.planQty)} />
          <StatCard label="양품" value={fmt(kpi.goodQty)} tone="text-success" />
          <StatCard label="불량률" value={`${kpi.defectRate.toFixed(1)}%`} tone={kpi.defectRate > 5 ? 'text-danger' : undefined} />
          <StatCard label="평균 진행률" value={`${kpi.avgProgress.toFixed(0)}%`} />
        </div>

        {/* 뷰 토글 */}
        <div className="flex items-center gap-1.5 mb-3">
          {([['list', '목록'], ['kanban', '칸반'], ['timeline', '설비 타임라인']] as [ViewMode, string][]).map(([k, l]) => (
            <button key={k} onClick={() => setView(k)} className={`${C.btn} ${view === k ? C.btnPrimary : C.btnGhost}`}>{l}</button>
          ))}
          {selectedIds.size > 0 && (
            <span className="ml-2 text-xs text-text-tertiary">{selectedIds.size}건 선택됨</span>
          )}
        </div>

        {loading ? (
          <div className="text-sm text-text-tertiary py-10 text-center">불러오는 중…</div>
        ) : displayed.length === 0 && view !== 'timeline' ? (
          <EmptyState title="작업지시가 없습니다" sub="조회 조건을 변경하거나 새 작업지시를 등록해보세요" action={<button className={`${C.btn} ${C.btnPrimary}`} onClick={openCreate}>+ 작업지시 등록</button>} />
        ) : view === 'list' ? (
          <ListView orders={displayed} onSelect={setDrawerId} selected={selectedIds} onToggleSelect={toggleSelect} onToggleAll={toggleAll} />
        ) : view === 'kanban' ? (
          <KanbanView orders={displayed} onSelect={setDrawerId} onAction={handleAction} />
        ) : (
          <TimelineView equipment={timeline.equipment} date={range.start} onSelect={setDrawerId} />
        )}
      </main>

      <WorkOrderModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={refreshAll}
        editing={editing}
        processes={processes}
        equipment={equipment}
        workers={workers}
        showToast={show}
      />
      <BulkGenerateModal
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        onSaved={refreshAll}
        processes={processes}
        equipment={equipment}
        showToast={show}
      />
      <WorkOrderDrawer
        id={drawerId}
        onClose={() => setDrawerId(null)}
        onEdit={openEdit}
        onListChanged={refreshAll}
        workers={workers}
        showToast={show}
      />
      {toastNode}
    </div>
  );
}
