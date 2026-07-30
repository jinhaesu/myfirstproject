'use client';

import { useEffect } from 'react';

// 통합 SSO 자동 포워드 로그인.
// 로그인 페이지에 진입하면 즉시 중앙 인증 허브(auth.nuldam.com)로 리다이렉트하여
// 구글 로그인을 수행한다. 이메일 OTP/비밀번호 폼은 노출하지 않는다.
// (허브 로그인 완료 후에는 /sso 콜백 페이지로 토큰이 전달되어 세션이 생성된다.)
export default function LoginPage() {
  useEffect(() => {
    window.location.href =
      'https://auth.nuldam.com/authorize?app=scm&return=' +
      encodeURIComponent('https://scm.nuldam.com/sso');
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-bg-0 to-bg-0 flex items-center justify-center p-4">
      <div className="flex flex-col items-center gap-4 text-text-tertiary">
        <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />
        <p>회사 계정 로그인으로 이동 중...</p>
      </div>
    </div>
  );
}
