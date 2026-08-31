'use client';

import { useEffect, useState } from 'react';
import { C, JudgePill, ConfirmButton, fmt, hhmm, elapsedMin } from '@/lib/mes/ui';
import type { ProcessRun, PopKind } from '@/lib/mes/api';

function LiveTimer({ startAt }: { startAt?: string | null }) {
  const [, force] = useState(0);
  useEffect(() => { const t = setInterval(() => force((x) => x + 1), 1000); return () => clearInterval(t); }, []);
  const min = elapsedMin(startAt, null);
  return (
    <span className="inline-flex items-center gap-1.5 font-bold text-brand tabular-nums">
      <span className="w-2 h-2 rounded-full bg-brand animate-pulse" />
      {min}분
    </span>
  );
}

/** 공정실행 목록 (배합/가열/급속동결/금속검출 공통) */
export function RunTable({
  popKind, rows, loading, onEnd, onDelete, selectedId, onSelect,
}: {
  popKind: PopKind;
  rows: ProcessRun[];
  loading: boolean;
  onEnd: (r: ProcessRun) => void;
  onDelete: (r: ProcessRun) => void;
  selectedId: number | null;
  onSelect: (id: number) => void;
}) {
  const showAlcohol = popKind === 'mixing';
  const showMeasure = popKind === 'heating' || popKind === 'freezing';
  const showTest = popKind === 'metal';

  if (loading) return <div className="py-10 text-center text-text-tertiary text-sm">불러오는 중…</div>;
  if (rows.length === 0) return <div className="py-10 text-center text-text-tertiary text-sm">오늘 실행 내역이 없습니다. 우측에서 [시작]하세요.</div>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[900px] border-collapse">
        <thead>
          <tr>
            <th className={C.th}>호기</th>
            <th className={C.th}>품명</th>
            <th className={C.th}>원료(kg)</th>
            {showAlcohol && <th className={C.th}>주정(g)</th>}
            {showMeasure && <th className={C.th}>기준/측정</th>}
            {showTest && <th className={C.th}>결과</th>}
            <th className={C.th}>시작</th>
            <th className={C.th}>종료</th>
            <th className={C.th}>경과/소요</th>
            <th className={C.th}>판정</th>
            <th className={C.th}>담당자</th>
            <th className={C.th}>액션</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const running = r.status === 'running';
            return (
              <tr
                key={r.id}
                onClick={() => onSelect(r.id)}
                className={`cursor-pointer transition-colors ${running ? 'border-l-4 border-brand bg-brand/5' : selectedId === r.id ? 'bg-bg-inset' : ''}`}
              >
                <td className={C.td}>{r.equipment_name || '-'}</td>
                <td className={`${C.td} font-semibold text-text-primary`}>{r.item_name || '-'}</td>
                <td className={C.tdNum}>{fmt(r.input_kg, 2)}</td>
                {showAlcohol && <td className={C.tdNum}>{fmt(r.alcohol_g, 0)}</td>}
                {showMeasure && <td className={C.tdNum}>{r.limit_value != null ? `${fmt(r.limit_value)}` : '-'} / {r.measured_value != null ? fmt(r.measured_value) : '-'}</td>}
                {showTest && <td className={C.td}>{r.test_result === 'pass' ? '양품 통과' : r.test_result === 'detect' ? '검출' : r.test_result === 'test' ? '시편 TEST' : '-'}</td>}
                <td className={C.td}>{hhmm(r.start_at)}</td>
                <td className={C.td}>{hhmm(r.end_at)}</td>
                <td className={C.td}>{running ? <LiveTimer startAt={r.start_at} /> : (r.minutes != null ? `${fmt(r.minutes)}분` : '-')}</td>
                <td className={C.td}><JudgePill j={r.judgment} /></td>
                <td className={C.td}>{r.worker_name || '-'}</td>
                <td className={C.td} onClick={(e) => e.stopPropagation()}>
                  <div className="flex gap-1.5">
                    {running && <button onClick={() => onEnd(r)} className={`${C.btn} ${C.btnDanger} px-2.5 py-1.5 text-xs`}>종료</button>}
                    <ConfirmButton onConfirm={() => onDelete(r)} className={`${C.btn} ${C.btnGhost} px-2.5 py-1.5 text-xs`} confirmText="삭제?">삭제</ConfirmButton>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
