'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Navigation } from '@/components/layout/Navigation';
import { mesGet } from '@/lib/mes/api';
import { C, PageHeader, todayISO } from '@/lib/mes/ui';
import { KpiCards } from '@/components/mes/home/KpiCards';
import { AlertsList } from '@/components/mes/home/AlertsList';
import { OrdersProgress } from '@/components/mes/home/OrdersProgress';
import { CcpChart } from '@/components/mes/home/CcpChart';
import { EquipmentStatus } from '@/components/mes/home/EquipmentStatus';
import { ApprovalBox } from '@/components/mes/home/ApprovalBox';
import { QuickLinks } from '@/components/mes/home/QuickLinks';
import type { DashboardResp, EquipmentStatusItem } from '@/components/mes/home/types';

export default function MesHomePage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  useEffect(() => { if (!isLoading && !user) router.replace('/login'); }, [isLoading, user, router]);

  const [date, setDate] = useState(todayISO());
  const [dash, setDash] = useState<DashboardResp | null>(null);
  const [equipment, setEquipment] = useState<EquipmentStatusItem[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      mesGet<DashboardResp>(`/dashboard?date=${date}`, null as any),
      mesGet<{ items: EquipmentStatusItem[] }>(`/equipment/status?date=${date}`, { items: [] }),
    ]).then(([d, eq]) => { setDash(d); setEquipment(eq.items || []); }).finally(() => setLoading(false));
  }, [date]);

  useEffect(() => { if (user) load(); }, [user, load]);

  if (isLoading || !user) return <div className="min-h-screen bg-bg-0" />;

  return (
    <div className="min-h-screen bg-bg-0">
      <Navigation />
      <main className="max-w-[1400px] mx-auto px-4 py-6">
        <PageHeader
          title="MES 홈"
          sub="생산현장 전체 현황을 한눈에 확인합니다"
          right={<>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={C.input} />
            <button onClick={load} disabled={loading} className={`${C.btn} ${C.btnGhost}`}>{loading ? '불러오는 중…' : '새로고침'}</button>
          </>}
        />

        <KpiCards d={dash} />

        <div className="mb-5"><QuickLinks /></div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-5">
          <div className="lg:col-span-1"><AlertsList alerts={dash?.alerts || []} /></div>
          <div className="lg:col-span-2 flex flex-col gap-4">
            <OrdersProgress orders={dash?.orders || null} />
            <ApprovalBox ccp={dash?.ccp_logs || null} />
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <CcpChart rows={dash?.runs.by_process || []} />
          <EquipmentStatus summary={dash?.equipment || null} items={equipment} />
        </div>
      </main>
    </div>
  );
}
