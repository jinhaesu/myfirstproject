'use client';

import { useState } from 'react';
import { C, Tabs, EmptyState, dt, fmt } from '@/lib/mes/ui';
import type { WoDetail } from './types';

type SubTab = 'workers' | 'materials' | 'defects' | 'results';

/** 하단 현황 탭 — 작업자/자재투입/불량/생산실적 */
export function WorkOrderDetailTabs({ detail, onBomAuto, bomLoading }: { detail: WoDetail | null; onBomAuto: () => void; bomLoading: boolean }) {
  const [tab, setTab] = useState<SubTab>('workers');
  if (!detail) return <EmptyState title="작업지시를 선택하세요" sub="목록에서 작업지시를 선택하면 현황이 표시됩니다" />;

  return (
    <div>
      <Tabs
        tabs={[
          { key: 'workers', label: `작업자 (${detail.workers.length})` },
          { key: 'materials', label: `자재투입 (${detail.materials.length})` },
          { key: 'defects', label: `불량 (${detail.defects.length})` },
          { key: 'results', label: `생산실적 (${detail.results.length})` },
        ]}
        value={tab} onChange={(t) => setTab(t as SubTab)}
      />
      <div className="mt-3 overflow-x-auto">
        {tab === 'workers' && (
          detail.workers.length === 0 ? <EmptyState title="등록된 작업자가 없습니다" /> : (
            <div className="flex flex-wrap gap-2">{detail.workers.map((w) => <span key={w.id} className="px-3 py-1.5 rounded-full bg-bg-inset text-sm font-semibold text-text-primary border border-border-primary">{w.name}</span>)}</div>
          )
        )}
        {tab === 'materials' && (
          <>
            <div className="flex justify-end mb-2">
              <button onClick={onBomAuto} disabled={bomLoading} className={`${C.btn} ${C.btnPrimary}`}>{bomLoading ? '투입 중…' : 'BOM 자동투입'}</button>
            </div>
            {detail.materials.length === 0 ? <EmptyState title="투입된 자재가 없습니다" sub="BOM 자동투입을 사용하거나 직접 등록하세요" /> : (
              <table className="w-full min-w-[560px] border-collapse">
                <thead><tr><th className={C.th}>구분</th><th className={C.th}>자재명</th><th className={C.th}>수량</th><th className={C.th}>단위</th><th className={C.th}>LOT</th></tr></thead>
                <tbody>{detail.materials.map((m) => (
                  <tr key={m.id}><td className={C.td}>{m.material_type === 'raw' ? '원재료' : m.material_type === 'sub' ? '부재료' : '반제품'}</td><td className={C.td}>{m.material_name}</td><td className={C.tdNum}>{fmt(m.qty, 2)}</td><td className={C.td}>{m.unit || '-'}</td><td className={C.td}>{m.lot_no || '-'}</td></tr>
                ))}</tbody>
              </table>
            )}
          </>
        )}
        {tab === 'defects' && (
          detail.defects.length === 0 ? <EmptyState title="등록된 불량이 없습니다" /> : (
            <table className="w-full min-w-[420px] border-collapse">
              <thead><tr><th className={C.th}>유형</th><th className={C.th}>수량</th><th className={C.th}>비고</th></tr></thead>
              <tbody>{detail.defects.map((d) => (<tr key={d.id}><td className={`${C.td} text-danger font-semibold`}>{d.defect_name || d.defect_code}</td><td className={C.tdNum}>{fmt(d.qty)}</td><td className={C.td}>{d.notes || '-'}</td></tr>))}</tbody>
            </table>
          )
        )}
        {tab === 'results' && (
          detail.results.length === 0 ? <EmptyState title="등록된 생산실적이 없습니다" /> : (
            <table className="w-full min-w-[680px] border-collapse">
              <thead><tr><th className={C.th}>실적번호</th><th className={C.th}>시작</th><th className={C.th}>종료</th><th className={C.th}>생산</th><th className={C.th}>양품</th><th className={C.th}>불량</th><th className={C.th}>작업자</th></tr></thead>
              <tbody>{detail.results.map((r) => (
                <tr key={r.id}><td className={C.td}>{r.result_no}</td><td className={C.td}>{dt(r.start_at)}</td><td className={C.td}>{dt(r.end_at)}</td><td className={C.tdNum}>{fmt(r.prod_qty)}</td><td className={C.tdNum}>{fmt(r.good_qty)}</td><td className={C.tdNum}>{fmt(r.defect_qty)}</td><td className={C.td}>{r.worker_name || '-'}</td></tr>
              ))}</tbody>
            </table>
          )
        )}
      </div>
    </div>
  );
}
