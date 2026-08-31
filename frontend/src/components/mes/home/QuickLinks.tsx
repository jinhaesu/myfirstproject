'use client';

import Link from 'next/link';

const LINKS = [
  { href: '/mes/pop', label: 'POP 현장단말', desc: '공정실행·작업지시 태블릿 화면', icon: '📟' },
  { href: '/mes/work-orders', label: '작업지시', desc: '목록·칸반·설비 타임라인', icon: '📋' },
  { href: '/mes/haccp/checklists', label: '선행점검일지', desc: 'SMART HACCP 오늘 점검', icon: '✅' },
  { href: '/mes/monitoring', label: '모니터링 보드', desc: '층별 실시간 온도·금속검출', icon: '📡' },
];

/** 빠른 이동 카드 */
export function QuickLinks() {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} className="bg-bg-1 border border-border-primary rounded-xl p-4 hover:border-brand transition-colors">
          <div className="text-2xl mb-1.5">{l.icon}</div>
          <div className="text-sm font-bold text-text-primary">{l.label}</div>
          <div className="text-xs text-text-tertiary mt-0.5">{l.desc}</div>
        </Link>
      ))}
    </div>
  );
}
