'use client';

import Link from 'next/link';
import { C } from '@/lib/mes/ui';

export default function TemplateLinkTab() {
  return (
    <div className={`${C.cardPad} max-w-xl text-center py-12`}>
      <div className="text-base font-bold text-text-primary mb-2">점검 템플릿</div>
      <p className="text-sm text-text-tertiary mb-5">선행점검일지 &gt; 템플릿 탭에서 관리합니다.</p>
      <Link href="/mes/haccp/checklists" className={`${C.btn} ${C.btnPrimary}`}>선행점검일지로 이동</Link>
    </div>
  );
}
