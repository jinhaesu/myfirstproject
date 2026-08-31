'use client';

import { useEffect, useState } from 'react';
import { mesDelete, mesGet, mesPost, type MesWorker, type WorkOrder } from '@/lib/mes/api';
import { C, ConfirmButton, Drawer, ProgressBar, StatusPill, Tabs, WO_STATUS, dt, fmt, fmtDuration } from '@/lib/mes/ui';
import type { WoAction, WorkOrderDetail } from './types';
import { PRIORITY_COLOR } from './types';
import { ResultsTab } from './tabs/ResultsTab';
import { DefectsTab } from './tabs/DefectsTab';
import { DowntimesTab } from './tabs/DowntimesTab';
import { MaterialsTab } from './tabs/MaterialsTab';
import { WorkersTab } from './tabs/WorkersTab';
import { RunsTab } from './tabs/RunsTab';

type TabKey = 'results' | 'defects' | 'downtimes' | 'materials' | 'workers' | 'runs';

const emptyDetail = (): WorkOrderDetail => ({
  order: { id: 0, wo_no: '', order_date: '', seq: 0, item_name: '', process_id: 0, plan_qty: 0, unit: 'ea', status: 'planned', priority: 3 },
  results: [], defects: [], downtimes: [], materials: [], workers: [], runs: [],
});

export function WorkOrderDrawer({ id, onClose, onEdit, onListChanged, workers, showToast }: {
  id: number | null;
  onClose: () => void;
  onEdit: (order: WorkOrder) => void;
  onListChanged: () => void;
  workers: MesWorker[];
  showToast: (m: string, t?: 'success' | 'danger' | 'info') => void;
}) {
  const [detail, setDetail] = useState<WorkOrderDetail>(emptyDetail());
  const [tab, setTab] = useState<TabKey>('results');
  const [loading, setLoading] = useState(false);
  const [acting, setActing] = useState(false);

  const load = () => {
    if (id === null) return;
    setLoading(true);
    mesGet<WorkOrderDetail>(`/work-orders/${id}`, emptyDetail()).then((r) => { setDetail(r); setLoading(false); });
  };

  useEffect(() => { setTab('results'); load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  const refresh = () => { load(); onListChanged(); };

  const doAction = async (action: WoAction) => {
    if (id === null) return;
    setActing(true);
    const r = await mesPost(`/work-orders/${id}/${action}`);
    setActing(false);
    if (!r.ok) { showToast(r.error || '처리 실패', 'danger'); return; }
    showToast('처리했습니다'); refresh();
  };

  const doDelete = async () => {
    if (id === null) return;
    const r = await mesDelete(`/work-orders/${id}`);
    if (!r.ok) { showToast(r.error || '삭제 실패', 'danger'); return; }
    showToast('삭제했습니다'); onClose(); onListChanged();
  };

  const o = detail.order;
  const defectRate = o.prod_qty ? ((o.defect_qty || 0) / o.prod_qty) * 100 : 0;
  const workerIds = detail.workers.map((w) => w.id);

  const tabs: { key: TabKey; label: string; badge?: React.ReactNode }[] = [
    { key: 'results', label: '실적', badge: detail.results.length ? <span className="text-[10px] text-text-quaternary">{detail.results.length}</span> : undefined },
    { key: 'defects', label: '불량', badge: detail.defects.length ? <span className="text-[10px] text-text-quaternary">{detail.defects.length}</span> : undefined },
    { key: 'downtimes', label: '비가동', badge: detail.downtimes.length ? <span className="text-[10px] text-text-quaternary">{detail.downtimes.length}</span> : undefined },
    { key: 'materials', label: '자재투입', badge: detail.materials.length ? <span className="text-[10px] text-text-quaternary">{detail.materials.length}</span> : undefined },
    { key: 'workers', label: '작업자' },
    { key: 'runs', label: '공정실행' },
  ];

  return (
    <Drawer open={id !== null} onClose={onClose} title={id !== null ? `작업지시 상세 — ${o.wo_no || ''}` : ''} width="max-w-4xl">
      {id === null || loading ? (
        <div className="text-sm text-text-tertiary py-10 text-center">불러오는 중…</div>
      ) : (
        <div className="space-y-5">
          <div className={`${C.cardPad}`}>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <div className="flex items-center gap-2">
                <StatusPill status={o.status} map={WO_STATUS} size="md" />
                <span className="text-lg font-bold text-text-primary">{o.item_name}</span>
                {o.family_code && <span className="text-[11px] px-1.5 py-0.5 rounded bg-bg-inset text-text-tertiary">{o.family_code}</span>}
                <span className="inline-flex items-center gap-1 text-xs text-text-tertiary"><span className={`w-2 h-2 rounded-full ${PRIORITY_COLOR[o.priority] || 'bg-text-quaternary'}`} />우선순위 {o.priority}</span>
              </div>
              <div className="text-xs text-text-tertiary">{o.equipment_name || '미배정'} · {o.process_name}</div>
            </div>
            <ProgressBar value={o.progress_pct || 0} tone={o.status === 'done' ? 'success' : o.status === 'paused' ? 'warning' : 'brand'} height="h-2.5" />
            <div className="grid grid-cols-4 sm:grid-cols-7 gap-3 mt-3 text-center">
              <div><div className="text-[11px] text-text-tertiary">계획</div><div className="text-sm font-bold text-text-primary tabular-nums">{fmt(o.plan_qty)}</div></div>
              <div><div className="text-[11px] text-text-tertiary">생산</div><div className="text-sm font-bold text-text-primary tabular-nums">{fmt(o.prod_qty)}</div></div>
              <div><div className="text-[11px] text-text-tertiary">양품</div><div className="text-sm font-bold text-success tabular-nums">{fmt(o.good_qty)}</div></div>
              <div><div className="text-[11px] text-text-tertiary">불량</div><div className="text-sm font-bold text-danger tabular-nums">{fmt(o.defect_qty)}</div></div>
              <div><div className="text-[11px] text-text-tertiary">불량률</div><div className="text-sm font-bold text-text-primary tabular-nums">{defectRate.toFixed(1)}%</div></div>
              <div><div className="text-[11px] text-text-tertiary">진행률</div><div className="text-sm font-bold text-accent tabular-nums">{fmt(o.progress_pct)}%</div></div>
              <div><div className="text-[11px] text-text-tertiary">비가동</div><div className="text-sm font-bold text-warning tabular-nums">{fmtDuration(o.downtime_minutes || 0)}</div></div>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 text-xs text-text-tertiary">
              <span>지시번호 {o.wo_no}</span><span>지시일 {o.order_date}</span>
              <span>시작 {dt(o.start_at)}</span><span>종료 {dt(o.end_at)}</span>
              {o.lot_no && <span>LOT {o.lot_no}</span>}
              {o.expiry_date && <span>유통기한 {o.expiry_date}</span>}
            </div>
            <div className="flex flex-wrap gap-2 mt-4">
              {o.status === 'released' && <button className={`${C.btn} ${C.btnPrimary}`} disabled={acting} onClick={() => doAction('start')}>시작</button>}
              {o.status === 'in_progress' && <button className={`${C.btn} ${C.btnWarn}`} disabled={acting} onClick={() => doAction('pause')}>일시정지</button>}
              {o.status === 'paused' && <button className={`${C.btn} ${C.btnPrimary}`} disabled={acting} onClick={() => doAction('resume')}>재개</button>}
              {(o.status === 'in_progress' || o.status === 'paused') && (
                <ConfirmButton className={`${C.btn} ${C.btnSuccess}`} onConfirm={() => doAction('finish')} confirmText="종료할까요?">종료</ConfirmButton>
              )}
              {(o.status === 'planned' || o.status === 'released' || o.status === 'in_progress' || o.status === 'paused') && (
                <ConfirmButton className={`${C.btn} ${C.btnGhost}`} onConfirm={() => doAction('cancel')} confirmText="취소할까요?">취소</ConfirmButton>
              )}
              <button className={`${C.btn} ${C.btnGhost}`} onClick={() => onEdit(o)}>수정</button>
              <ConfirmButton className={`${C.btn} ${C.btnGhost} !text-danger`} onConfirm={doDelete} confirmText="삭제할까요?">삭제</ConfirmButton>
            </div>
          </div>

          <div>
            <Tabs tabs={tabs} value={tab} onChange={setTab} />
            <div className="pt-4">
              {tab === 'results' && <ResultsTab workOrderId={o.id} results={detail.results} workers={workers} onChanged={refresh} showToast={showToast} />}
              {tab === 'defects' && <DefectsTab workOrderId={o.id} defects={detail.defects} onChanged={refresh} showToast={showToast} />}
              {tab === 'downtimes' && <DowntimesTab workOrderId={o.id} downtimes={detail.downtimes} onChanged={refresh} showToast={showToast} />}
              {tab === 'materials' && <MaterialsTab workOrderId={o.id} materials={detail.materials} onChanged={refresh} showToast={showToast} />}
              {tab === 'workers' && <WorkersTab workOrderId={o.id} workerIds={workerIds} allWorkers={workers} onChanged={refresh} showToast={showToast} />}
              {tab === 'runs' && <RunsTab runs={detail.runs} />}
            </div>
          </div>
        </div>
      )}
    </Drawer>
  );
}
