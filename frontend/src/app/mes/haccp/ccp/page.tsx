'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Navigation } from '@/components/layout/Navigation';
import { mesGet, mesPost, CcpLog, MesProcess } from '@/lib/mes/api';
import { C, PageHeader, PeriodBar, presetRange, StatCard, StatusPill, APPROVAL_STATUS, Pill, EmptyState, Modal, useToast, todayISO, dt } from '@/lib/mes/ui';
import CcpDetailPanel from '@/components/mes/haccp/ccp/CcpDetailPanel';

const STATUS_TABS: { key: string; label: string }[] = [
  { key: '', label: '전체' },
  { key: 'draft', label: '작성중' },
  { key: 'submitted', label: '상신' },
  { key: 'approved', label: '승인' },
  { key: 'rejected', label: '반려' },
];

export default function CcpLogsPage() {
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
  const [items, setItems] = useState<CcpLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [activeId, setActiveId] = useState<number | null>(null);
  const [genOpen, setGenOpen] = useState(false);
  const [genDate, setGenDate] = useState(todayISO());

  useEffect(() => { mesGet<{ items: MesProcess[] }>('/processes?active=1', { items: [] }).then((r) => setProcesses((r.items || []).filter((p) => p.is_ccp))); }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const qs = new URLSearchParams({ start: range.start, end: range.end });
    if (processId) qs.set('process_id', processId);
    if (status) qs.set('status', status);
    const r = await mesGet<{ items: CcpLog[] }>(`/ccp-logs?${qs.toString()}`, { items: [] });
    setItems(r.items || []);
    setSelected(new Set());
    setLoading(false);
  }, [range, processId, status]);
  useEffect(() => { load(); }, [load]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const i of items) c[i.status] = (c[i.status] || 0) + 1;
    return c;
  }, [items]);

  const kpi = useMemo(() => ({
    total: items.length,
    pending: items.filter((i) => i.status === 'submitted').length,
    approved: items.filter((i) => i.status === 'approved').length,
    withFail: items.filter((i) => (i.fail_count || 0) > 0).length,
  }), [items]);

  const toggle = (id: number) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setSelected((s) => (s.size === items.length ? new Set() : new Set(items.map((i) => i.id))));

  const bulk = async (action: 'submit' | 'approve' | 'reject') => {
    if (selected.size === 0) return;
    let ok = 0, fail = 0;
    for (const id of Array.from(selected)) {
      const r = await mesPost(`/ccp-logs/${id}/${action}`);
      if (r.ok) ok++; else fail++;
    }
    show(`처리 완료 ${ok}건${fail ? ` · 실패 ${fail}건` : ''}`, fail ? 'danger' : 'success');
    load();
  };

  const generate = async () => {
    const r = await mesPost<{ created?: number; updated?: number }>('/ccp-logs/generate', { date: genDate });
    if (!r.ok) { show(r.error || '생성 실패', 'danger'); return; }
    setGenOpen(false);
    show(`생성 ${r.data?.created ?? 0} / 갱신 ${r.data?.updated ?? 0}`);
    load();
  };

  if (isLoading || !user) return <div className="min-h-screen bg-bg-0" />;

  return (
    <div className="min-h-screen bg-bg-0">
      <Navigation />
      <main className="max-w-[1400px] mx-auto px-4 py-6">
        {toastNode}
        <PageHeader title="CCP 점검일지" sub="중요관리점(CCP) 실행 기록 결재" right={
          <button className={`${C.btn} ${C.btnPrimary}`} onClick={() => setGenOpen(true)}>일지 생성</button>
        } />

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <StatCard label="일지 수" value={`${kpi.total}건`} />
          <StatCard label="상신 대기" value={`${kpi.pending}건`} tone="text-info" />
          <StatCard label="승인" value={`${kpi.approved}건`} tone="text-success" />
          <StatCard label="부적합 포함" value={`${kpi.withFail}건`} tone="text-danger" />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div className="flex flex-wrap gap-1.5">
            {STATUS_TABS.map((t) => (
              <button key={t.key} onClick={() => setStatus(t.key)} className={`${C.btn} px-3 py-1.5 ${status === t.key ? C.btnPrimary : C.btnGhost}`}>
                {t.label}{t.key && counts[t.key] ? ` (${counts[t.key]})` : ''}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select className={C.select} value={processId} onChange={(e) => setProcessId(e.target.value)}>
              <option value="">전체 CCP 공정</option>
              {processes.map((p) => <option key={p.id} value={p.id}>{p.ccp_code} {p.name}</option>)}
            </select>
            <PeriodBar range={range} setRange={setRange} onApply={setRange} />
          </div>
        </div>

        {selected.size > 0 && (
          <div className="flex items-center gap-2 bg-bg-1 border border-border-primary rounded-lg px-3 py-2 mb-3">
            <span className="text-xs text-text-tertiary">{selected.size}건 선택</span>
            <button className={`${C.btn} ${C.btnGhost} px-3 py-1.5`} onClick={() => bulk('submit')}>상신</button>
            <button className={`${C.btn} ${C.btnSuccess} px-3 py-1.5`} onClick={() => bulk('approve')}>승인</button>
            <button className={`${C.btn} ${C.btnDanger} px-3 py-1.5`} onClick={() => bulk('reject')}>반려</button>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-[1.3fr_1fr] gap-4">
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
                      <th className={C.th}><input type="checkbox" checked={selected.size === items.length && items.length > 0} onChange={toggleAll} /></th>
                      <th className={C.th}>점검일자</th>
                      <th className={C.th}>CCP코드</th>
                      <th className={C.th}>공정</th>
                      <th className={C.th}>설비</th>
                      <th className={C.th}>실행수</th>
                      <th className={C.th}>부적합수</th>
                      <th className={C.th}>상태</th>
                      <th className={C.th}>작성자</th>
                      <th className={C.th}>승인자</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((i) => (
                      <tr key={i.id} onClick={() => setActiveId(i.id)} className={`cursor-pointer hover:bg-bg-inset/50 ${activeId === i.id ? 'bg-brand/5' : ''}`}>
                        <td className={C.td} onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={selected.has(i.id)} onChange={() => toggle(i.id)} /></td>
                        <td className={C.td}>{i.log_date}</td>
                        <td className={C.td}>{i.ccp_code}</td>
                        <td className={C.td}>{i.process_name}</td>
                        <td className={C.td}>{i.equipment_name || '-'}</td>
                        <td className={C.tdNum}>{i.run_count ?? '-'}</td>
                        <td className={C.tdNum}>{(i.fail_count || 0) > 0 ? <Pill tone="danger">{i.fail_count}</Pill> : (i.fail_count ?? 0)}</td>
                        <td className={C.td}><StatusPill status={i.status} map={APPROVAL_STATUS} /></td>
                        <td className={C.td}>{i.author || '-'}</td>
                        <td className={C.td}>{i.approver || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div>
            <CcpDetailPanel logId={activeId} onChanged={load} />
          </div>
        </div>

        <Modal open={genOpen} onClose={() => setGenOpen(false)} title="일지 생성" footer={<>
          <button className={`${C.btn} ${C.btnGhost}`} onClick={() => setGenOpen(false)}>취소</button>
          <button className={`${C.btn} ${C.btnPrimary}`} onClick={generate}>생성</button>
        </>}>
          <div>
            <div className={C.label}>대상 일자</div>
            <input type="date" className={`${C.input} w-full`} value={genDate} onChange={(e) => setGenDate(e.target.value)} />
            <p className="text-xs text-text-tertiary mt-2">해당일 CCP 공정 실행(run)이 있는 공정·설비 조합마다 점검일지를 생성/갱신합니다.</p>
          </div>
        </Modal>
      </main>
    </div>
  );
}
