'use client';

import type { ProcessRun } from '@/lib/mes/api';
import { C, EmptyState, JudgePill, dt, fmt } from '@/lib/mes/ui';

export function RunsTab({ runs }: { runs: ProcessRun[] }) {
  if (runs.length === 0) return <EmptyState title="연결된 공정실행(POP) 기록이 없습니다" />;
  return (
    <table className="w-full border-collapse">
      <thead>
        <tr>
          <th className={C.th}>공정</th><th className={C.th}>설비</th><th className={C.th}>품명</th>
          <th className={`${C.th} text-right`}>투입(kg)</th><th className={`${C.th} text-right`}>기준</th><th className={`${C.th} text-right`}>측정</th>
          <th className={C.th}>시작</th><th className={C.th}>종료</th><th className={`${C.th} text-right`}>시간(분)</th><th className={C.th}>판정</th><th className={C.th}>담당</th>
        </tr>
      </thead>
      <tbody>
        {runs.map((r) => (
          <tr key={r.id}>
            <td className={C.td}>{r.process_name || '-'}</td>
            <td className={C.td}>{r.equipment_name || '-'}</td>
            <td className={C.td}>{r.item_name || '-'}</td>
            <td className={C.tdNum}>{fmt(r.input_kg, 1)}</td>
            <td className={C.tdNum}>{fmt(r.limit_value, 1)}</td>
            <td className={C.tdNum}>{fmt(r.measured_value, 1)}</td>
            <td className={C.td}>{dt(r.start_at)}</td>
            <td className={C.td}>{dt(r.end_at)}</td>
            <td className={C.tdNum}>{fmt(r.minutes)}</td>
            <td className={C.td}><JudgePill j={r.judgment} size="sm" /></td>
            <td className={C.td}>{r.worker_name || '-'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
