'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Navigation } from '@/components/layout/Navigation';
import { mesGet, type MesEquipment, type MesProcess } from '@/lib/mes/api';
import { PageHeader, Tabs } from '@/lib/mes/ui';
import { DailyTab } from '@/components/mes/production/DailyTab';
import { TrendTab } from '@/components/mes/production/TrendTab';
import { ParetoTab } from '@/components/mes/production/ParetoTab';
import { PlanTab } from '@/components/mes/production/PlanTab';

type TabKey = 'daily' | 'trend' | 'pareto' | 'plan';

export default function ProductionPage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  useEffect(() => { if (!isLoading && !user) router.replace('/login'); }, [isLoading, user, router]);

  const [tab, setTab] = useState<TabKey>('daily');
  const [processes, setProcesses] = useState<MesProcess[]>([]);
  const [equipment, setEquipment] = useState<MesEquipment[]>([]);

  useEffect(() => {
    mesGet<{ items: MesProcess[] }>('/processes?active=1', { items: [] }).then((r) => setProcesses(r.items || []));
    mesGet<{ items: MesEquipment[] }>('/equipment', { items: [] }).then((r) => setEquipment(r.items || []));
  }, []);

  if (isLoading || !user) return <div className="min-h-screen bg-bg-0" />;

  return (
    <div className="min-h-screen bg-bg-0">
      <Navigation />
      <main className="max-w-[1400px] mx-auto px-4 py-6">
        <PageHeader title="생산일보·OEE·계획" sub="일자별 생산 실적, OEE, 추이, 파레토, 월간 생산계획" />

        <Tabs
          tabs={[
            { key: 'daily', label: '생산일보' },
            { key: 'trend', label: '추이' },
            { key: 'pareto', label: '파레토' },
            { key: 'plan', label: '생산계획' },
          ]}
          value={tab}
          onChange={(t) => setTab(t as TabKey)}
        />

        <div className="pt-4">
          {tab === 'daily' && <DailyTab processes={processes} equipment={equipment} />}
          {tab === 'trend' && <TrendTab />}
          {tab === 'pareto' && <ParetoTab />}
          {tab === 'plan' && <PlanTab />}
        </div>
      </main>
    </div>
  );
}
