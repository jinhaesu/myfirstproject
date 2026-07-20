'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ChatContainer } from '@/components/chat/ChatContainer';
import { useAuth } from '@/contexts/AuthContext';
import { Navigation } from '@/components/layout/Navigation';

export default function Home() {
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();

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

      {/* 메인 콘텐츠 — 채팅 전면 */}
      <div className="max-w-5xl mx-auto px-4 py-6">
        <div className="h-[calc(100vh-140px)]">
          <ChatContainer />
        </div>
      </div>
    </main>
  );
}
