'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Navigation } from '@/components/layout/Navigation';
import { mesGet } from '@/lib/mes/api';
import type { MesProcess, MesWorker, PopKind } from '@/lib/mes/api';
import { Tabs, todayISO, useToast } from '@/lib/mes/ui';
import { TopBar } from '@/components/mes/pop/TopBar';
import { SummaryStrip } from '@/components/mes/pop/SummaryStrip';
import { RunPanel } from '@/components/mes/pop/RunPanel';
import { PackingPanel } from '@/components/mes/pop/PackingPanel';
import { POP_KIND_LABEL } from '@/components/mes/pop/types';
import type { RunsSummary } from '@/components/mes/pop/types';

const KIND_ORDER: PopKind[] = ['mixing', 'heating', 'freezing', 'metal', 'packing'];

export default function PopPage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  useEffect(() => { if (!isLoading && !user) router.replace('/login'); }, [isLoading, user, router]);

  const [date, setDate] = useState(todayISO());
  const [kind, setKind] = useState<PopKind>('mixing');
  const [fullscreen, setFullscreen] = useState(false);
  const [processes, setProcesses] = useState<MesProcess[]>([]);
  const [workers, setWorkers] = useState<MesWorker[]>([]);
  const [summary, setSummary] = useState<RunsSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const { toast, show, node } = useToast();

  const loadRefData = useCallback(() => {
    mesGet<{ items: MesProcess[] }>('/processes?active=1', { items: [] }).then((r) => setProcesses((r.items || []).sort((a, b) => a.sort_order - b.sort_order)));
    mesGet<{ items: MesWorker[] }>('/workers?active=1', { items: [] }).then((r) => setWorkers((r.items || []).sort((a, b) => a.sort_order - b.sort_order)));
  }, []);
  const loadSummary = useCallback(() => {
    setSummaryLoading(true);
    mesGet<RunsSummary>(`/runs/summary?date=${date}`, { by_process: [], by_equipment: [], total: 0, pass_rate: 0 }).then(setSummary).finally(() => setSummaryLoading(false));
  }, [date]);

  useEffect(() => { if (user) loadRefData(); }, [user, loadRefData]);
  useEffect(() => { if (user) loadSummary(); }, [user, loadSummary]);

  useEffect(() => {
    const onFsChange = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen().catch(() => setFullscreen(true));
  };

  const refresh = () => { loadRefData(); loadSummary(); };

  if (isLoading || !user) return <div className="min-h-screen bg-bg-0" />;

  return (
    <div className="min-h-screen bg-bg-0">
      {!fullscreen && <Navigation />}
      <main className="max-w-none px-3 py-4">
        <TopBar date={date} onDate={setDate} onRefresh={refresh} fullscreen={fullscreen} onToggleFullscreen={toggleFullscreen} />
        <SummaryStrip summary={summary} loading={summaryLoading} />
        <Tabs
          size="lg"
          value={kind}
          onChange={setKind}
          tabs={KIND_ORDER.map((k) => ({ key: k, label: POP_KIND_LABEL[k] }))}
        />
        <div className="mt-4">
          {kind === 'packing'
            ? <PackingPanel date={date} workers={workers} toast={show} />
            : <RunPanel popKind={kind} date={date} allProcesses={processes} workers={workers} toast={show} />}
        </div>
      </main>
      {node}
    </div>
  );
}
