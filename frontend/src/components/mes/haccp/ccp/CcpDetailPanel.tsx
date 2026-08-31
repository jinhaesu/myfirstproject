'use client';

// CCP 점검일지 상세 패널 — GET /ccp-logs/{id} → {log, runs, limits}, 결재 액션 + 인쇄.
import { useEffect, useState } from 'react';
import { mesGetRaw, mesPost, mesPut, CcpLog, ProcessRun, MesLimit } from '@/lib/mes/api';
import { C, Pill, StatusPill, APPROVAL_STATUS, JudgePill, Modal, useToast, hhmm, dt, fmt } from '@/lib/mes/ui';

function printLog(log: CcpLog, runs: ProcessRun[], limits: MesLimit[]) {
  const w = window.open('', '_blank', 'width=1000,height=1200');
  if (!w) return;
  const runRows = runs.map((r) => `<tr>
    <td>${r.equipment_name || '-'}</td><td>${r.item_name || '-'}</td><td>${fmt(r.input_kg, 1)}</td><td>${fmt(r.alcohol_g, 1)}</td>
    <td>${fmt(r.limit_value, 1)}</td><td>${fmt(r.measured_value, 1)}</td><td>${hhmm(r.start_at)}</td><td>${hhmm(r.end_at)}</td>
    <td>${fmt(r.minutes, 0)}</td><td>${r.judgment === '적' ? '적합' : r.judgment === '부' ? '부적합' : '-'}</td><td>${r.worker_name || '-'}</td><td>${r.notes || ''}</td>
  </tr>`).join('');
  const limitRows = limits.map((l) => `<tr><td>${l.name}</td><td>${l.min_value ?? ''}~${l.max_value ?? ''}${l.unit || ''}</td><td>${l.check_cycle || ''}</td><td>${l.check_method || ''}</td><td>${l.corrective_action || ''}</td></tr>`).join('');
  w.document.write(`
    <html><head><title>CCP 점검일지</title>
    <style>
      body{font-family:'Malgun Gothic',sans-serif;padding:24px;color:#111}
      h1{font-size:20px;margin-bottom:4px}
      table{width:100%;border-collapse:collapse;font-size:11px;margin-top:10px}
      th,td{border:1px solid #999;padding:5px 6px;text-align:left}
      th{background:#eee}
      .sign{display:flex;gap:8px;margin-top:16px;justify-content:flex-end}
      .sign div{border:1px solid #999;padding:8px 16px;text-align:center;min-width:100px}
    </style></head>
    <body>
      <h1>조인앤조인 — CCP 점검일지 (${log.ccp_code || ''} ${log.process_name || ''})</h1>
      <p>점검일자: ${log.log_date} · 설비: ${log.equipment_name || '-'} · 작성자: ${log.author || '-'}</p>
      <h3>한계기준</h3>
      <table><thead><tr><th>항목</th><th>기준</th><th>주기</th><th>방법</th><th>개선조치</th></tr></thead><tbody>${limitRows}</tbody></table>
      <h3>실행 기록</h3>
      <table><thead><tr><th>호기</th><th>품명</th><th>원료kg</th><th>주정g</th><th>기준</th><th>측정</th><th>시작</th><th>종료</th><th>소요(분)</th><th>판정</th><th>담당자</th><th>비고</th></tr></thead><tbody>${runRows}</tbody></table>
      <div class="sign"><div>작성<br/>${log.author || ''}</div><div>승인<br/>${log.approver || ''}</div></div>
    </body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 300);
}

export default function CcpDetailPanel({ logId, onChanged }: { logId: number | null; onChanged: () => void }) {
  const { toast, show, node: toastNode } = useToast();
  const [log, setLog] = useState<CcpLog | null>(null);
  const [runs, setRuns] = useState<ProcessRun[]>([]);
  const [limits, setLimits] = useState<MesLimit[]>([]);
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const load = async () => {
    if (!logId) { setLog(null); return; }
    setLoading(true);
    const r = await mesGetRaw<{ log: CcpLog; runs: ProcessRun[]; limits: MesLimit[] }>(`/ccp-logs/${logId}`);
    if (r.ok) {
      setLog(r.data.log); setRuns(r.data.runs || []); setLimits(r.data.limits || []); setNotes(r.data.log?.notes || '');
    } else show('상세 조회 실패', 'danger');
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [logId]);

  const readOnly = log?.status === 'approved';

  const saveNotes = async () => {
    if (!log) return;
    const r = await mesPut(`/ccp-logs/${log.id}`, { notes });
    if (!r.ok) { show(r.error || '저장 실패', 'danger'); return; }
    show('비고가 저장되었습니다');
    onChanged();
  };

  const workflow = async (action: 'submit' | 'approve' | 'reject') => {
    if (!log) return;
    if (action === 'reject') { setRejectOpen(true); return; }
    const r = await mesPost(`/ccp-logs/${log.id}/${action}`);
    if (!r.ok) { show(r.error || '처리 실패', 'danger'); return; }
    show(action === 'submit' ? '상신되었습니다' : '승인되었습니다');
    onChanged();
    load();
  };
  const submitReject = async () => {
    if (!log) return;
    const r = await mesPost(`/ccp-logs/${log.id}/reject`, { reason: rejectReason });
    setRejectOpen(false); setRejectReason('');
    if (!r.ok) { show(r.error || '반려 실패', 'danger'); return; }
    show('반려 처리되었습니다', 'info');
    onChanged();
    load();
  };

  if (!logId) return <div className={`${C.cardPad} h-full flex items-center justify-center text-sm text-text-tertiary`}>일지를 선택하세요</div>;
  if (loading || !log) return <div className={`${C.cardPad} h-full flex items-center justify-center text-sm text-text-tertiary`}>불러오는 중…</div>;

  const total = runs.length;
  const pass = runs.filter((r) => r.judgment === '적').length;
  const fail = runs.filter((r) => r.judgment === '부').length;
  const rate = total ? (pass / total) * 100 : 0;

  return (
    <div className={`${C.cardPad} space-y-4`}>
      {toastNode}
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-bold text-text-primary flex items-center gap-2">
            {log.ccp_code} {log.process_name} · {log.equipment_name || '설비 미지정'}
            {readOnly && <span title="승인됨(읽기 전용)">🔒</span>}
          </div>
          <div className="text-xs text-text-tertiary mt-0.5">{log.log_date} · 작성자 {log.author || '-'}</div>
        </div>
        <StatusPill status={log.status} map={APPROVAL_STATUS} />
      </div>

      {limits.length > 0 && (
        <div className="bg-bg-0 border border-border-primary rounded-lg p-3 space-y-1">
          <div className="text-xs font-bold text-text-tertiary mb-1">한계기준</div>
          {limits.map((l) => (
            <div key={l.id} className="flex flex-wrap gap-x-3 text-xs text-text-secondary">
              <span className="font-semibold text-text-primary">{l.name}</span>
              <span>기준 {l.min_value ?? '-'}~{l.max_value ?? '-'}{l.unit || ''}</span>
              <span>주기 {l.check_cycle || '-'}</span>
              <span>방법 {l.check_method || '-'}</span>
              <span>개선조치 {l.corrective_action || '-'}</span>
            </div>
          ))}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={C.th}>호기</th><th className={C.th}>품명</th><th className={C.th}>원료kg</th><th className={C.th}>주정g</th>
              <th className={C.th}>기준</th><th className={C.th}>측정</th><th className={C.th}>시작</th><th className={C.th}>종료</th>
              <th className={C.th}>소요(분)</th><th className={C.th}>판정</th><th className={C.th}>담당자</th><th className={C.th}>비고</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id}>
                <td className={C.td}>{r.equipment_name || '-'}</td>
                <td className={C.td}>{r.item_name || '-'}</td>
                <td className={C.tdNum}>{fmt(r.input_kg, 1)}</td>
                <td className={C.tdNum}>{fmt(r.alcohol_g, 1)}</td>
                <td className={C.tdNum}>{fmt(r.limit_value, 1)}</td>
                <td className={C.tdNum}>{fmt(r.measured_value, 1)}</td>
                <td className={C.td}>{hhmm(r.start_at)}</td>
                <td className={C.td}>{hhmm(r.end_at)}</td>
                <td className={C.tdNum}>{fmt(r.minutes, 0)}</td>
                <td className={C.td}><JudgePill j={r.judgment} size="sm" /></td>
                <td className={C.td}>{r.worker_name || '-'}</td>
                <td className={C.td}>{r.notes || '-'}</td>
              </tr>
            ))}
            {runs.length === 0 && <tr><td className={C.td} colSpan={12}><div className="py-6 text-center text-text-tertiary">실행 기록 없음</div></td></tr>}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-4 gap-2">
        <div className={`${C.card} p-3 text-center`}><div className="text-[11px] text-text-tertiary">총 실행</div><div className="text-lg font-bold text-text-primary">{total}</div></div>
        <div className={`${C.card} p-3 text-center`}><div className="text-[11px] text-text-tertiary">적합</div><div className="text-lg font-bold text-success">{pass}</div></div>
        <div className={`${C.card} p-3 text-center`}><div className="text-[11px] text-text-tertiary">부적합</div><div className="text-lg font-bold text-danger">{fail}</div></div>
        <div className={`${C.card} p-3 text-center`}><div className="text-[11px] text-text-tertiary">적합률</div><div className="text-lg font-bold text-text-primary">{rate.toFixed(1)}%</div></div>
      </div>

      <div>
        <div className={C.label}>비고</div>
        <textarea className={`${C.input} w-full`} rows={2} value={notes} disabled={readOnly} onChange={(e) => setNotes(e.target.value)} onBlur={saveNotes} />
      </div>

      {log.reject_reason && log.status === 'draft' && (
        <div className="text-xs text-danger bg-danger/10 border border-danger/30 rounded-lg px-3 py-2">반려 사유: {log.reject_reason}</div>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        <button className={`${C.btn} ${C.btnGhost}`} onClick={() => printLog(log, runs, limits)}>인쇄</button>
        {log.status === 'draft' && <button className={`${C.btn} ${C.btnPrimary}`} onClick={() => workflow('submit')}>상신</button>}
        {log.status === 'submitted' && <>
          <button className={`${C.btn} ${C.btnSuccess}`} onClick={() => workflow('approve')}>승인</button>
          <button className={`${C.btn} ${C.btnDanger}`} onClick={() => workflow('reject')}>반려</button>
        </>}
      </div>

      <Modal open={rejectOpen} onClose={() => setRejectOpen(false)} title="반려 사유" footer={<>
        <button className={`${C.btn} ${C.btnGhost}`} onClick={() => setRejectOpen(false)}>취소</button>
        <button className={`${C.btn} ${C.btnDanger}`} onClick={submitReject}>반려</button>
      </>}>
        <textarea className={`${C.input} w-full`} rows={3} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
      </Modal>
    </div>
  );
}
