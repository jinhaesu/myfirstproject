'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Navigation } from '@/components/layout/Navigation';
import { TargetListSection } from '@/components/targets/TargetListSection';
import { SalesStatusSection } from '@/components/targets/SalesStatusSection';
import { ReportSection } from '@/components/targets/ReportSection';

export default function TargetsPage() {
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState<number | null>(new Date().getMonth() + 1);
  const [excludeVat, setExcludeVat] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
    }
  }, [user, authLoading, router]);

  if (authLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-bg-0 to-bg-0 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-brand border-t-transparent rounded-full animate-spin" />
          <p className="text-text-tertiary">로딩 중...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-bg-0 to-bg-0">
      <Navigation />

      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-text-primary">목표 영업 지표</h1>
            <p className="text-text-tertiary mt-1">연간/월간 목표를 설정하고 실적을 관리하세요</p>
          </div>
          {/* 부가세 토글 - 전체 적용 */}
          <label className="flex items-center gap-2 cursor-pointer bg-bg-1 px-4 py-2 rounded-lg border border-border-primary shadow-[0px_1px_3px_rgba(0,0,0,0.2)]">
            <input
              type="checkbox"
              checked={excludeVat}
              onChange={(e) => setExcludeVat(e.target.checked)}
              className="w-4 h-4 text-link rounded border-border-primary focus:ring-brand"
            />
            <span className="text-sm font-medium text-text-secondary">부가세 별도</span>
          </label>
        </div>

        {/* 리포트 섹션 */}
        <ReportSection
          selectedYear={selectedYear}
          selectedMonth={selectedMonth}
          excludeVat={excludeVat}
        />

        {/* 목표 리스트 섹션 */}
        <TargetListSection
          selectedYear={selectedYear}
          setSelectedYear={setSelectedYear}
          selectedMonth={selectedMonth}
          setSelectedMonth={setSelectedMonth}
          excludeVat={excludeVat}
        />

        {/* 매출 현황 및 실시간 섹션 */}
        <SalesStatusSection
          selectedYear={selectedYear}
          selectedMonth={selectedMonth || new Date().getMonth() + 1}
          excludeVat={excludeVat}
        />
      </div>
    </main>
  );
}
