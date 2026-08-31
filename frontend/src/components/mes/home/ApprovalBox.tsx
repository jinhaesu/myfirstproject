'use client';

import Link from 'next/link';
import { SectionTitle, Pill } from '@/lib/mes/ui';
import type { DashboardResp } from './types';

/** 결재함 요약 — CCP 일지 draft/submitted/approved */
export function ApprovalBox({ ccp }: { ccp: DashboardResp['ccp_logs'] | null }) {
  return (
    <div className="bg-bg-1 border border-border-primary rounded-xl p-4">
      <SectionTitle right={<Link href="/mes/haccp/ccp" className="text-xs font-semibold text-accent hover:underline">전체 보기 →</Link>}>CCP 점검일지 결재함</SectionTitle>
      <div className="flex gap-2">
        <Pill tone="muted" size="md">작성중 {ccp?.draft ?? 0}</Pill>
        <Pill tone="info" size="md">상신 {ccp?.submitted ?? 0}</Pill>
        <Pill tone="success" size="md">승인 {ccp?.approved ?? 0}</Pill>
      </div>
    </div>
  );
}
