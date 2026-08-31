'use client';

import { useCallback, useEffect, useState } from 'react';
import { mesGet, mesPost } from '@/lib/mes/api';
import type { WorkOrder, MesCode, MesWorker } from '@/lib/mes/api';
import { C, ConfirmButton } from '@/lib/mes/ui';
import { WorkOrderList } from './WorkOrderList';
import { WorkOrderDetailTabs } from './WorkOrderDetailTabs';
import { ResultModal, DefectModal, DowntimeModal, WorkerModal } from './WorkOrderModals';
import type { WoDetail } from './types';

type ModalKind = 'result' | 'defect' | 'downtime' | 'worker' | null;

/** 포장·작업지시 탭 — 작업지시 조회/시작/실적/불량/비가동/작업자/종료 + 하단 현황 */
export function PackingPanel({ date, workers, toast }: { date: string; workers: MesWorker[]; toast: (msg: string, tone?: 'success' | 'danger' | 'info') => void }) {
  const [rows, setRows] = useState<WorkOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<WoDetail | null>(null);
  const [defectCodes, setDefectCodes] = useState<MesCode[]>([]);
  const [downtimeCodes, setDowntimeCodes] = useState<MesCode[]>([]);
  const [modal, setModal] = useState<ModalKind>(null);
  const [busy, setBusy] = useState(false);
  const [bomLoading, setBomLoading] = useState(false);

  const loadList = useCallback(() => {
    setLoading(true);
    mesGet<{ items: WorkOrder[] }>(`/work-orders?start=${date}&end=${date}`, { items: [] }).then((r) => setRows(r.items || [])).finally(() => setLoading(false));
  }, [date]);

  const loadDetail = useCallback((id: number) => {
    mesGet<WoDetail>(`/work-orders/${id}`, { order: null as any, results: [], defects: [], downtimes: [], materials: [], workers: [], runs: [] }).then((r) => { if (r.order) setDetail(r); });
  }, []);

  useEffect(() => { loadList(); }, [loadList]);
  useEffect(() => {
    mesGet<{ items: MesCode[] }>('/codes?group=DEFECT', { items: [] }).then((r) => setDefectCodes(r.items || []));
    mesGet<{ items: MesCode[] }>('/codes?group=DOWNTIME', { items: [] }).then((r) => setDowntimeCodes(r.items || []));
  }, []);
  useEffect(() => { if (selectedId) loadDetail(selectedId); else setDetail(null); }, [selectedId, loadDetail]);

  const refreshAll = () => { loadList(); if (selectedId) loadDetail(selectedId); };

  const selected = rows.find((r) => r.id === selectedId) || null;
  const openDowntime = detail?.downtimes.find((d) => !d.end_at) || null;

  const act = async (path: string, body?: any, msg?: string) => {
    if (!selectedId) return;
    setBusy(true);
    const res = await mesPost(path, body);
    setBusy(false);
    if (!res.ok) { toast(res.error || '처리에 실패했습니다', 'danger'); return; }
    toast(msg || '처리되었습니다', 'success');
    refreshAll();
  };

  const doStart = () => act(`/work-orders/${selectedId}/start`, undefined, '작업을 시작했습니다');
  const doFinish = () => act(`/work-orders/${selectedId}/finish`, undefined, '작업을 종료했습니다');
  const doResult = (p: { prod_qty: number; defect_qty: number; worker_id: number | null }) => act(`/work-orders/${selectedId}/results`, p, '실적을 등록했습니다').then(() => setModal(null));
  const doDefect = (p: { defect_code: string; qty: number }) => act(`/work-orders/${selectedId}/defects`, p, '불량을 등록했습니다').then(() => setModal(null));
  const doDowntimeStart = (p: { downtime_code: string; reason: string }) => act(`/work-orders/${selectedId}/downtimes`, p, '비가동을 등록했습니다').then(() => setModal(null));
  const doDowntimeEnd = () => { if (openDowntime) act(`/downtimes/${openDowntime.id}/end`, undefined, '비가동을 종료했습니다'); };
  const doWorkers = (ids: number[]) => act(`/work-orders/${selectedId}/workers`, { worker_ids: ids }, '작업자를 저장했습니다').then(() => setModal(null));

  const doBomAuto = async () => {
    if (!selectedId) return;
    setBomLoading(true);
    const res = await mesPost(`/work-orders/${selectedId}/materials/from-bom`);
    setBomLoading(false);
    if (!res.ok) { toast(res.error || 'BOM 자동투입에 실패했습니다', 'danger'); return; }
    toast('BOM 기준으로 자재를 투입했습니다', 'success');
    loadDetail(selectedId);
  };

  const goInventory = () => window.open('/inventory/production', '_blank');

  const canStart = selected && (selected.status === 'planned' || selected.status === 'released');
  const canFinish = selected && (selected.status === 'in_progress' || selected.status === 'paused');

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
      <div className="xl:col-span-2 bg-bg-1 border border-border-primary rounded-xl p-4">
        <div className="text-sm font-bold text-text-primary mb-3">오늘 작업지시</div>
        <WorkOrderList rows={rows} loading={loading} selectedId={selectedId} onSelect={setSelectedId} />
      </div>
      <div className="bg-bg-1 border border-border-primary rounded-xl p-4">
        <div className="text-sm font-bold text-text-primary mb-3">{selected ? `${selected.wo_no} · ${selected.item_name}` : '작업지시를 선택하세요'}</div>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={doStart} disabled={!canStart || busy} className={`${C.bigBtn} ${C.btnSuccess} text-base`}>작업시작</button>
          <button onClick={() => setModal('result')} disabled={!selectedId || busy} className={`${C.bigBtn} bg-warning text-black text-base`}>실적등록</button>
          <button onClick={() => setModal('defect')} disabled={!selectedId || busy} className={`${C.bigBtn} ${C.btnDanger} text-base`}>불량등록</button>
          {openDowntime ? (
            <button onClick={doDowntimeEnd} disabled={busy} className={`${C.bigBtn} bg-info text-white text-base`}>비가동종료</button>
          ) : (
            <button onClick={() => setModal('downtime')} disabled={!selectedId || busy} className={`${C.bigBtn} ${C.btnWarn} text-base`}>비가동</button>
          )}
          <button onClick={() => setModal('worker')} disabled={!selectedId || busy} className={`${C.bigBtn} ${C.btnGhost} text-base`}>작업자등록</button>
          <ConfirmButton onConfirm={doFinish} className={`${C.bigBtn} ${!canFinish || busy ? 'opacity-40 pointer-events-none' : ''} bg-danger text-white text-base`} confirmText="작업종료?">작업종료</ConfirmButton>
          <button onClick={goInventory} className={`${C.bigBtn} ${C.btnPrimary} text-base col-span-2`}>제품입고(재고 이동)</button>
        </div>
      </div>
      <div className="xl:col-span-3 bg-bg-1 border border-border-primary rounded-xl p-4">
        <WorkOrderDetailTabs detail={detail} onBomAuto={doBomAuto} bomLoading={bomLoading} />
      </div>

      <ResultModal open={modal === 'result'} onClose={() => setModal(null)} onSubmit={doResult} workers={workers} submitting={busy} />
      <DefectModal open={modal === 'defect'} onClose={() => setModal(null)} onSubmit={doDefect} codes={defectCodes} submitting={busy} />
      <DowntimeModal open={modal === 'downtime'} onClose={() => setModal(null)} onSubmit={doDowntimeStart} codes={downtimeCodes} submitting={busy} />
      <WorkerModal open={modal === 'worker'} onClose={() => setModal(null)} onSubmit={doWorkers} workers={workers} initialIds={(detail?.workers || []).map((w) => w.id)} submitting={busy} />
    </div>
  );
}
