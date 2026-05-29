'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ChatContainer } from '@/components/chat/ChatContainer';
import { TableSelector } from '@/components/table/TableSelector';
import { useTables } from '@/hooks/useTables';
import { useAuth } from '@/contexts/AuthContext';
import { Navigation } from '@/components/layout/Navigation';

export default function Home() {
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const {
    tables,
    selectedTable,
    setSelectedTable,
    schema,
    isLoading,
    error,
  } = useTables();

  // 로그인 확인
  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
    }
  }, [user, authLoading, router]);

  // 로딩 중
  if (authLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#08090A] to-[#08090A] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-[#5E6AD2] border-t-transparent rounded-full animate-spin" />
          <p className="text-[#8A8F98]">로딩 중...</p>
        </div>
      </div>
    );
  }

  // 로그인 안됨
  if (!user) {
    return null;
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-[#08090A] to-[#08090A]">
      <Navigation />

      {/* 메인 콘텐츠 */}
      <div className="max-w-7xl mx-auto px-4 py-6">
        {error && (
          <div className="mb-4 p-4 bg-[#EB5757]/10 border border-[#EB5757]/30 rounded-xl text-[#EB5757] shadow-[0px_1px_3px_rgba(0,0,0,0.2)]">
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {error}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* 사이드바 - 테이블 선택 */}
          <div className="lg:col-span-1">
            <TableSelector
              tables={tables}
              selectedTable={selectedTable}
              onSelectTable={setSelectedTable}
              schema={schema}
              isLoading={isLoading}
            />
          </div>

          {/* 메인 - 채팅 영역 */}
          <div className="lg:col-span-3 h-[calc(100vh-140px)]">
            <ChatContainer
              tableId={selectedTable}
              datasetId={tables?.dataset_id}
            />
          </div>
        </div>
      </div>
    </main>
  );
}
