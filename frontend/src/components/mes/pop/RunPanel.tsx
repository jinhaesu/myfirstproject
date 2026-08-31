'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { mesGet, mesPost, mesDelete } from '@/lib/mes/api';
import type { MesProcess, MesEquipment, MesWorker, MesCode, MesLimit, ProcessRun, Deviation, PopKind } from '@/lib/mes/api';
import { Tabs } from '@/lib/mes/ui';
import { RunTable } from './RunTable';
import { DeviationList } from './DeviationList';
import { InputPanel, type StartPayload } from './InputPanel';
import { EndRunModal, type EndPayload } from './EndRunModal';
import { ResultBanner } from './ResultBanner';
import { SUB_KIND_LABEL } from './types';

/** 공정실행 탭 화면(배합/가열/급속동결/금속검출 공통) — 좌 목록 + 우 입력패널 */
export function RunPanel({
  popKind, date, allProcesses, workers, toast,
}: {
  popKind: PopKind;
  date: string;
  allProcesses: MesProcess[];
  workers: MesWorker[];
  toast: (msg: string, tone?: 'success' | 'danger' | 'info') => void;
}) {
  const kindProcesses = useMemo(() => allProcesses.filter((p) => p.pop_kind === popKind), [allProcesses, popKind]);
  const [subKind, setSubKind] = useState<string | null>(null);
  useEffect(() => {
    if (popKind === 'heating') {
      const first = kindProcesses[0]?.sub_kind || null;
      setSubKind(first);
    } else setSubKind(null);
  }, [popKind, kindProcesses]);

  const process = useMemo(() => {
    if (popKind === 'heating') return kindProcesses.find((p) => p.sub_kind === subKind) || kindProcesses[0] || null;
    return kindProcesses[0] || null;
  }, [kindProcesses, popKind, subKind]);

  const [equipment, setEquipment] = useState<MesEquipment[]>([]);
  const [families, setFamilies] = useState<MesCode[]>([]);
  const [limits, setLimits] = useState<MesLimit[]>([]);
  const [runs, setRuns] = useState<ProcessRun[]>([]);
  const [deviations, setDeviations] = useState<Deviation[]>([]);
  const [subTab, setSubTab] = useState<'list' | 'deviation'>('list');
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [starting, setStarting] = useState(false);
  const [endTarget, setEndTarget] = useState<ProcessRun | null>(null);
  const [ending, setEnding] = useState(false);
  const [banner, setBanner] = useState<'적' | '부' | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const loadRuns = useCallback(() => {
    if (!process) { setRuns([]); return; }
    setLoadingRuns(true);
    mesGet<{ items: ProcessRun[] }>(`/runs?date=${date}&process_id=${process.id}`, { items: [] })
      .then((r) => setRuns(r.items || []))
      .finally(() => setLoadingRuns(false));
  }, [process, date]);

  const loadDeviations = useCallback(() => {
    if (!process) { setDeviations([]); return; }
    mesGet<{ items: Deviation[] }>(`/deviations?start=${date}&end=${date}&process_id=${process.id}`, { items: [] }).then((r) => setDeviations(r.items || []));
  }, [process, date]);

  useEffect(() => { loadRuns(); loadDeviations(); }, [loadRuns, loadDeviations]);

  useEffect(() => {
    if (!process) { setEquipment([]); setLimits([]); return; }
    mesGet<{ items: MesEquipment[] }>(`/equipment?process_id=${process.id}&active=1`, { items: [] }).then((r) => setEquipment(r.items || []));
    mesGet<{ items: MesLimit[] }>(`/limits?process_id=${process.id}`, { items: [] }).then((r) => setLimits(r.items || []));
  }, [process]);

  useEffect(() => {
    mesGet<{ items: MesCode[] }>('/codes?group=FAMILY', { items: [] }).then((r) => {
      const all = r.items || [];
      const filtered = all.filter((f) => Array.isArray(f.extra?.pop_kinds) && f.extra!.pop_kinds.includes(popKind));
      setFamilies(filtered.length > 0 ? filtered : all);
    });
  }, [popKind]);

  // 실시간 폴링(10초) — 진행중 행 존재 시에만
  useEffect(() => {
    const hasRunning = runs.some((r) => r.status === 'running');
    if (!hasRunning) return;
    const t = setInterval(loadRuns, 10000);
    return () => clearInterval(t);
  }, [runs, loadRuns]);

  const handleStart = async (p: StartPayload) => {
    if (!process) return;
    setStarting(true);
    const res = await mesPost('/runs', {
      run_date: date,
      process_id: process.id,
      equipment_id: p.equipment_id,
      family_code: p.family_code,
      item_name: p.item_name,
      input_kg: p.input_kg,
      alcohol_g: p.alcohol_g,
      worker_id: p.worker_id,
    });
    setStarting(false);
    if (!res.ok) { toast(res.error || '시작 처리에 실패했습니다', 'danger'); return; }
    toast('공정을 시작했습니다', 'success');
    loadRuns();
  };

  const doEnd = async (id: number, payload: EndPayload) => {
    setEnding(true);
    const res = await mesPost<ProcessRun>(`/runs/${id}/end`, payload);
    setEnding(false);
    if (!res.ok) { toast(res.error || '종료 처리에 실패했습니다', 'danger'); return; }
    setEndTarget(null);
    const j = (res.data as any)?.judgment as '적' | '부' | undefined;
    if (j) { setBanner(j); setTimeout(() => setBanner(null), 2000); }
    if (j === '부') toast('부적합 — 이탈이 자동 등록되었습니다', 'danger'); else toast('종료 처리되었습니다', 'success');
    loadRuns(); loadDeviations();
  };

  const handleEndClick = (r: ProcessRun) => {
    if (popKind === 'mixing') { doEnd(r.id, {}); return; }
    setEndTarget(r);
  };

  const handleDelete = async (r: ProcessRun) => {
    const res = await mesDelete(`/runs/${r.id}`);
    if (!res.ok) { toast(res.error || '삭제에 실패했습니다', 'danger'); return; }
    toast('삭제되었습니다', 'info');
    loadRuns();
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
      <ResultBanner judgment={banner} />
      <div className="xl:col-span-2 bg-bg-1 border border-border-primary rounded-xl p-4">
        {popKind === 'heating' && (
          <div className="flex gap-2 mb-3">
            {kindProcesses.map((p) => (
              <button key={p.id} onClick={() => setSubKind(p.sub_kind || null)}
                className={`min-h-[48px] px-5 rounded-xl text-base font-bold border-2 transition-colors ${subKind === p.sub_kind ? 'bg-brand text-white border-brand' : 'bg-bg-0 text-text-primary border-border-primary'}`}>
                {SUB_KIND_LABEL[p.sub_kind || ''] || p.name}
              </button>
            ))}
          </div>
        )}
        <Tabs
          tabs={[{ key: 'list', label: '실행 목록', badge: runs.length ? <span className="text-xs text-text-tertiary">({runs.length})</span> : undefined }, { key: 'deviation', label: '이탈내역', badge: deviations.length ? <span className="text-xs text-danger font-bold">({deviations.length})</span> : undefined }]}
          value={subTab} onChange={setSubTab} size="lg"
        />
        <div className="mt-3">
          {subTab === 'list'
            ? <RunTable popKind={popKind} rows={runs} loading={loadingRuns} onEnd={handleEndClick} onDelete={handleDelete} selectedId={selectedId} onSelect={setSelectedId} />
            : <DeviationList rows={deviations} loading={false} />}
        </div>
      </div>
      <div className="bg-bg-1 border border-border-primary rounded-xl p-4">
        {process ? (
          <InputPanel popKind={popKind} equipment={equipment} families={families} workers={workers} limits={limits} starting={starting} onStart={handleStart} />
        ) : (
          <div className="text-sm text-text-tertiary py-10 text-center">해당 공정이 기준정보에 등록되어 있지 않습니다</div>
        )}
      </div>
      <EndRunModal open={!!endTarget} run={endTarget} popKind={popKind} submitting={ending} onClose={() => setEndTarget(null)} onSubmit={(p) => endTarget && doEnd(endTarget.id, p)} />
    </div>
  );
}
