'use client';

import { C, StatusPill, DEV_STATUS, EmptyState, dt, fmt } from '@/lib/mes/ui';
import type { Deviation } from '@/lib/mes/api';

/** 이탈내역 서브탭 */
export function DeviationList({ rows, loading }: { rows: Deviation[]; loading: boolean }) {
  if (loading) return <div className="py-10 text-center text-text-tertiary text-sm">불러오는 중…</div>;
  if (rows.length === 0) return <EmptyState title="이탈 내역이 없습니다" sub="선택한 날짜에 등록된 이탈이 없습니다" />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[820px] border-collapse">
        <thead>
          <tr>
            <th className={C.th}>발생시각</th>
            <th className={C.th}>설비</th>
            <th className={C.th}>유형</th>
            <th className={C.th}>내용</th>
            <th className={C.th}>기준/측정</th>
            <th className={C.th}>조치</th>
            <th className={C.th}>상태</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => (
            <tr key={d.id}>
              <td className={C.td}>{dt(d.occurred_at)}</td>
              <td className={C.td}>{d.equipment_name || '-'}</td>
              <td className={`${C.td} font-semibold text-danger`}>{d.deviation_name || d.deviation_code}</td>
              <td className={C.td}>{d.description || '-'}</td>
              <td className={C.tdNum}>{d.limit_value != null ? fmt(d.limit_value) : '-'} / {d.measured_value != null ? fmt(d.measured_value) : '-'}</td>
              <td className={C.td}>{d.corrective_action || '-'}</td>
              <td className={C.td}><StatusPill status={d.status} map={DEV_STATUS} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
