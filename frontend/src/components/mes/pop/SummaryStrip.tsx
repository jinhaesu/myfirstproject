'use client';

import { Pill } from '@/lib/mes/ui';
import type { RunsSummary } from './types';
import { POP_KIND_LABEL } from './types';

/** 오늘 실행 요약 스트립 — 총 건수·진행중·적합률 + 공정별 미니 칩 */
export function SummaryStrip({ summary, loading }: { summary: RunsSummary | null; loading: boolean }) {
  if (loading || !summary) {
    return <div className="flex items-center gap-2 mb-3 text-xs text-text-tertiary">요약 불러오는 중…</div>;
  }
  const running = summary.by_process.reduce((s, p) => s + p.running, 0);
  return (
    <div className="flex flex-wrap items-center gap-2 mb-3 bg-bg-1 border border-border-primary rounded-xl px-4 py-2.5">
      <span className="text-sm font-semibold text-text-primary">오늘 총 실행 {summary.total}건</span>
      <Pill tone="brand" size="md">진행중 {running}</Pill>
      <Pill tone={summary.pass_rate >= 0.95 ? 'success' : summary.pass_rate >= 0.8 ? 'warning' : 'danger'} size="md">
        적합률 {(summary.pass_rate * 100).toFixed(1)}%
      </Pill>
      <div className="w-px h-5 bg-border-primary mx-1" />
      <div className="flex flex-wrap gap-1.5">
        {summary.by_process.map((p) => (
          <span key={p.process_id} className="inline-flex items-center gap-1 rounded-full bg-bg-inset border border-border-primary px-2.5 py-1 text-xs text-text-secondary">
            {POP_KIND_LABEL[p.pop_kind || ''] || p.name} {p.pass}/{p.total} 적합
            {p.fail > 0 && <span className="text-danger font-bold">·부{p.fail}</span>}
          </span>
        ))}
      </div>
    </div>
  );
}
