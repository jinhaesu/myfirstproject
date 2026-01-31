'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ChatContainer } from '@/components/chat/ChatContainer';
import { TableSelector } from '@/components/table/TableSelector';
import { useTables } from '@/hooks/useTables';
import { useAuth } from '@/contexts/AuthContext';

export default function Home() {
  const { user, isLoading: authLoading, logout } = useAuth();
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
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-slate-600">로딩 중...</p>
        </div>
      </div>
    );
  }

  // 로그인 안됨
  if (!user) {
    return null;
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
      {/* 헤더 */}
      <header className="bg-white/80 backdrop-blur-md shadow-sm border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl flex items-center justify-center shadow-lg">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
              <div>
                <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
                  Nuldam BigQuery Chat Analytics
                </h1>
                <p className="text-slate-500 text-sm">자연어로 데이터를 분석하세요</p>
              </div>
            </div>

            {/* 사용자 정보 & 로그아웃 */}
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-gradient-to-br from-emerald-400 to-teal-500 rounded-full flex items-center justify-center text-white font-semibold text-sm">
                  {user.name.charAt(0)}
                </div>
                <span className="text-sm text-slate-700 font-medium hidden sm:block">{user.name}</span>
              </div>
              <button
                onClick={logout}
                className="flex items-center gap-1 px-3 py-2 text-sm text-slate-500 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                <span className="hidden sm:block">로그아웃</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* 메인 콘텐츠 */}
      <div className="max-w-7xl mx-auto px-4 py-6">
        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 shadow-sm">
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
          <div className="lg:col-span-3 h-[calc(100vh-180px)]">
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
