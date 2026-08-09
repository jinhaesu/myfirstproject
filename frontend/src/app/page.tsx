'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';

// '/' 는 더 이상 AI 챗 페이지가 아니다 (AI는 우측 하단 플로팅 비서로만 사용).
// 로그인 상태면 매출 취합으로, 아니면 로그인으로 리다이렉트.
export default function Home() {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;
    router.replace(user ? '/channels' : '/login');
  }, [user, isLoading, router]);

  return (
    <div className="min-h-screen bg-bg-0 flex items-center justify-center">
      <div className="w-10 h-10 border-4 border-brand border-t-transparent rounded-full animate-spin" />
    </div>
  );
}
