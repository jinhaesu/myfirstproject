'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Navigation } from '@/components/layout/Navigation';
import { PageHeader, Tabs } from '@/lib/mes/ui';
import TodayTab from '@/components/mes/haccp/checklist/TodayTab';
import CalendarTab from '@/components/mes/haccp/checklist/CalendarTab';
import ListTab from '@/components/mes/haccp/checklist/ListTab';
import TemplatesTab from '@/components/mes/haccp/checklist/TemplatesTab';

type TabKey = 'today' | 'calendar' | 'list' | 'templates';

export default function ChecklistsPage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (!isLoading && !user) router.replace('/login');
  }, [isLoading, user, router]);

  const [tab, setTab] = useState<TabKey>('today');

  if (isLoading || !user) return <div className="min-h-screen bg-bg-0" />;

  return (
    <div className="min-h-screen bg-bg-0">
      <Navigation />
      <main className="max-w-[1400px] mx-auto px-4 py-6">
        <PageHeader title="선행점검일지" sub="SMART HACCP 선행요건 점검 양식 · 일지 작성 · 결재" />
        <Tabs
          tabs={[
            { key: 'today', label: '오늘 점검' },
            { key: 'calendar', label: '달력' },
            { key: 'list', label: '일지 목록' },
            { key: 'templates', label: '템플릿' },
          ]}
          value={tab}
          onChange={(t) => setTab(t as TabKey)}
        />
        <div className="mt-4">
          {tab === 'today' && <TodayTab />}
          {tab === 'calendar' && <CalendarTab />}
          {tab === 'list' && <ListTab />}
          {tab === 'templates' && <TemplatesTab />}
        </div>
      </main>
    </div>
  );
}
