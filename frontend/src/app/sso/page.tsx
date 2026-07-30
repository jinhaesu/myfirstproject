'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';

// 대시보드/로그인과 동일하게 백엔드 절대주소를 직접 호출한다.
const API_BASE = (process.env.NEXT_PUBLIC_API_URL || '') + '/api';

export default function SSOPage() {
  const { loginWithToken } = useAuth();
  const router = useRouter();
  const [error, setError] = useState('');

  useEffect(() => {
    // 브라우저 URL 해시(#token=...)에서 허브 토큰 추출
    const hash =
      typeof window !== 'undefined'
        ? window.location.hash.replace(/^#/, '')
        : '';
    const params = new URLSearchParams(hash);
    const token = params.get('token');

    // 토큰이 주소창에 남지 않도록 즉시 제거
    if (typeof window !== 'undefined') {
      window.history.replaceState(
        null,
        '',
        window.location.pathname + window.location.search
      );
    }

    if (!token) {
      setError('SSO 토큰을 찾을 수 없습니다.');
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const response = await fetch(`${API_BASE}/auth/sso`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });

        if (!response.ok) {
          if (!cancelled) setError('회사 계정 로그인에 실패했습니다.');
          return;
        }

        const data = await response.json();
        if (cancelled) return;
        loginWithToken(data.access_token, data.user);
        router.push('/');
      } catch {
        if (!cancelled) setError('서버 연결에 실패했습니다.');
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-bg-0 to-bg-0 flex items-center justify-center p-4">
      <div className="w-full max-w-md text-center">
        {error ? (
          <div className="bg-bg-1 rounded-2xl shadow-[0px_7px_32px_rgba(0,0,0,0.35)] p-8 border border-border-primary">
            <div className="p-4 bg-danger/10 border border-danger/30 rounded-xl text-danger text-sm flex items-center justify-center gap-2 mb-6">
              <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {error}
            </div>
            <a
              href="/login"
              className="text-sm text-link hover:text-accent"
            >
              로그인 페이지로 돌아가기
            </a>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4 text-text-tertiary">
            <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />
            <p>회사 계정으로 로그인 중...</p>
          </div>
        )}
      </div>
    </div>
  );
}
