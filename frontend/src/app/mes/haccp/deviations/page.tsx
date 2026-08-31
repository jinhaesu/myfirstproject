'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Navigation } from '@/components/layout/Navigation';
import { mesGet, Deviation, MesProcess } from '@/lib/mes/api';
import { C, PageHeader, PeriodBar, presetRange, StatCard, StatusPill, DEV_STATUS, EmptyState, useToast, downloadCSV, dt, fmtDuration } from '@/lib/mes/ui';
import DeviationCharts, { StatItem, DayItem } from '@/components/mes/haccp/deviation/DeviationCharts';
import { DeviationActionModal, DeviationRegisterModal } from '@/components/mes/haccp/deviation/DeviationModals';

const STATUS_TABS: { key: string; label: string }[] = [
  { key: '', label: '전체' },
  { key: 'open', label: '미조치' },
  { key: 'in_progress', label: '조치중' },
  { key: 'closed', label: '조치완료' },
];

export default function DeviationsPage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (!isLoading && !user) router.replace('/login');
  }, [isLoading, user, router]);

  const { toast, show, node: toastNode } = useToast();
  const [range, setRange] = useState(presetRange('thisMonth'));
  const [status, setStatus] = useState('');
  const [processes, setProcesses] = useState<MesProcess[]>([]);
  const [processId, setProcessId] = useState('');
  const [items, setItems] = useState<Deviation[]>([]);
  const [stats, setStats] = useState<{ by_type: StatItem[]; by_process: StatItem[]; by_day: DayItem[] }>({ by_type: [], by_process: [], by_day: [] });
  const [loading, setLoading] = useState(true);
  const [actionTarget, setActionTarget] = useState<Deviation | null>(null);
  const [registerOpen, setRegisterOpen] = useState(false);

  useEffect(() => { mesGet<{ items: MesProcess[] }>('/processes?active=1', { items: [] }).then((r) => setProcesses(r.items || [])); }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const qs = new URLSearchParams({ start: range.start, end: range.end });
    if (processId) qs.set('process_id', processId);
    if (status) qs.set('status', status);
    const [listRes, statsRes] = await Promise.all([
      mesGet<{ items: Deviation[] }>(`/deviations?${qs.toString()}`, { items: [] }),
      mesGet<{ by_type: StatItem[]; by_process: StatItem[]; by_day: DayItem[] }>(`/deviations/stats?start=${range.start}&end=${range.end}`, { by_type: [], by_process: [], by_day: [] }),
    ]);
    setItems(listRes.items || []);
    setStats(statsRes || { by_type: [], by_process: [], by_day: [] });
    setLoading(false);
  }, [range, processId, status]);
  useEffect(() => { load(); }, [load]);

  const kpi = useMemo(() => {
    const open = items.filter((i) => i.status !== 'closed').length;
    const closed = items.filter((i) => i.status === 'closed' && i.action_at);
    const avgMin = closed.length
      ? closed.reduce((s, i) => s + Math.max(0, (new Date(i.action_at as string).getTime() - new Date(i.occurred_at).getTime()) / 60000), 0) / closed.length
      : 0;
    return { total: items.length, open, avgHours: avgMin / 60 };
  }, [items]);

  const csv = () => {
    downloadCSV(`deviations_${range.start}_${range.end}.csv`,
      ['발생시각', '공정', '설비', '유형', '내용', '기준', '측정', '상태', '조치내용', '조치자', '조치시각'],
      items.map((i) => [dt(i.occurred_at), i.process_name || '', i.equipment_name || '', i.deviation_name || i.deviation_code, i.description || '', i.limit_value ?? '', i.measured_value ?? '', DEV_STATUS[i.status]?.label || i.status, i.corrective_action || '', i.action_by || '', dt(i.action_at)]));
  };

  if (isLoading || !user) return <div className="min-h-screen bg-bg-0" />;

  return (
    <div className="min-h-screen bg-bg-0">
      <Navigation />
      <main className="max-w-[1400px] mx-auto px-4 py-6">
        {toastNode}
        <PageHeader title="이탈 · 개선조치" sub="한계기준 이탈 발생 이력과 개선조치 관리" right={
          <button className={`${C.btn} ${C.btnPrimary}`} onClick={() => setRegisterOpen(true)}>수동 이탈 등록</button>
        } />

        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
          <StatCard label="발생 건수" value={`${kpi.total}건`} />
          <StatCard label="미조치" value={`${kpi.open}건`} tone="text-danger" />
          <StatCard label="평균 조치 소요시간" value={`${kpi.avgHours.toFixed(1)}시간`} />
        </div>

        <div className="mb-4">
          <DeviationCharts byType={stats.by_type} byProcess={stats.by_process} byDay={stats.by_day} />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div className="flex flex-wrap gap-1.5">
            {STATUS_TABS.map((t) => (
              <button key={t.key} onClick={() => setStatus(t.key)} className={`${C.btn} px-3 py-1.5 ${status === t.key ? C.btnPrimary : C.btnGhost}`}>{t.label}</button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select className={C.select} value={processId} onChange={(e) => setProcessId(e.target.value)}>
              <option value="">전체 공정</option>
              {processes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <PeriodBar range={range} setRange={setRange} onApply={setRange} />
            <button className={`${C.btn} ${C.btnGhost}`} onClick={csv}>CSV</button>
          </div>
        </div>

        <div className={C.card}>
          {loading ? (
            <div className="py-14 text-center text-text-tertiary text-sm">불러오는 중…</div>
          ) : items.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className={C.th}>발생시각</th>
                    <th className={C.th}>공정</th>
                    <th className={C.th}>설비</th>
                    <th className={C.th}>유형</th>
                    <th className={C.th}>내용</th>
                    <th className={C.th}>기준/측정</th>
                    <th className={C.th}>상태</th>
                    <th className={C.th}>조치내용</th>
                    <th className={C.th}>조치자</th>
                    <th className={C.th}>조치시각</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((i) => (
                    <tr key={i.id} className="cursor-pointer hover:bg-bg-inset/50" onClick={() => setActionTarget(i)}>
                      <td className={C.td}>{dt(i.occurred_at)}</td>
                      <td className={C.td}>{i.process_name || '-'}</td>
                      <td className={C.td}>{i.equipment_name || '-'}</td>
                      <td className={C.td}>{i.deviation_name || i.deviation_code}</td>
                      <td className={C.td} style={{ whiteSpace: 'normal', maxWidth: 220 }}>{i.description || '-'}</td>
                      <td className={C.td}>{i.limit_value ?? '-'} / {i.measured_value ?? '-'}</td>
                      <td className={C.td}><StatusPill status={i.status} map={DEV_STATUS} /></td>
                      <td className={C.td} style={{ whiteSpace: 'normal', maxWidth: 220 }}>{i.corrective_action || '-'}</td>
                      <td className={C.td}>{i.action_by || '-'}</td>
                      <td className={C.td}>{dt(i.action_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <DeviationActionModal open={!!actionTarget} onClose={() => setActionTarget(null)} deviation={actionTarget} onSaved={load} />
        <DeviationRegisterModal open={registerOpen} onClose={() => setRegisterOpen(false)} processes={processes} onSaved={load} />
      </main>
    </div>
  );
}
