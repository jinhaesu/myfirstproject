'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { Navigation } from '@/components/layout/Navigation';
import { mesPost } from '@/lib/mes/api';
import { C, PageHeader, Tabs, ConfirmButton, useToast } from '@/lib/mes/ui';
import ProcessTab from '@/components/mes/master/ProcessTab';
import EquipmentMasterTab from '@/components/mes/master/EquipmentMasterTab';
import WorkerTab from '@/components/mes/master/WorkerTab';
import FamilyTab from '@/components/mes/master/FamilyTab';
import CodeTab from '@/components/mes/master/CodeTab';
import LimitTab from '@/components/mes/master/LimitTab';
import TemplateLinkTab from '@/components/mes/master/TemplateLinkTab';

type Tab = '공정' | '설비' | '작업자·보건증' | '제품군·품목매핑' | '공통코드' | 'CCP 한계기준' | '점검 템플릿';
const TABS: Tab[] = ['공정', '설비', '작업자·보건증', '제품군·품목매핑', '공통코드', 'CCP 한계기준', '점검 템플릿'];
const OWNER_EMAIL = 'lion9080@joinandjoin.com';

export default function MesMasterPage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('공정');
  const { show, node } = useToast();

  useEffect(() => { if (!isLoading && !user) router.replace('/login'); }, [isLoading, user, router]);

  if (isLoading || !user) return <div className="min-h-screen bg-bg-0" />;

  const isOwner = (user?.email || '').toLowerCase() === OWNER_EMAIL;

  const runSeed = async () => {
    const r = await mesPost<{ created?: Record<string, number> }>('/seed');
    if (r.ok) {
      const counts = r.data?.created ? Object.entries(r.data.created).map(([k, v]) => `${k} ${v}`).join(', ') : '완료';
      show(`시드 실행 완료 — ${counts}`, 'success');
    } else show(r.error || '시드 실행 실패', 'danger');
  };

  return (
    <div className="min-h-screen bg-bg-0">
      <Navigation />
      <main className="max-w-[1400px] mx-auto px-4 py-6">
        <PageHeader
          title="기준정보"
          sub="MES 고유 기준만 관리 — 품목·BOM·원부재료는 SCM(품목 관리/BOM)과 공유"
          right={
            <>
              <Link href="/scm/products" className={`${C.btn} ${C.btnGhost}`}>SCM 품목 관리로</Link>
              <Link href="/scm/bom" className={`${C.btn} ${C.btnGhost}`}>BOM</Link>
              {isOwner && (
                <ConfirmButton onConfirm={runSeed} className={`${C.btn} ${C.btnPrimary}`} confirmText="시드를 실행할까요?">
                  초기 데이터 시드
                </ConfirmButton>
              )}
            </>
          }
        />
        <Tabs tabs={TABS.map((t) => ({ key: t, label: t }))} value={tab} onChange={setTab} />
        <div className="mt-4">
          {tab === '공정' && <ProcessTab showToast={show} />}
          {tab === '설비' && <EquipmentMasterTab showToast={show} />}
          {tab === '작업자·보건증' && <WorkerTab showToast={show} />}
          {tab === '제품군·품목매핑' && <FamilyTab showToast={show} />}
          {tab === '공통코드' && <CodeTab showToast={show} />}
          {tab === 'CCP 한계기준' && <LimitTab showToast={show} />}
          {tab === '점검 템플릿' && <TemplateLinkTab />}
        </div>
      </main>
      {node}
    </div>
  );
}
