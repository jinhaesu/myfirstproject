'use client';

import { useState, FormEvent, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';

// 대시보드와 동일하게 백엔드 절대주소를 직접 호출(검증된 경로).
// 프록시(rewrite)만 깨졌을 때 로그인이 "서버 연결에 실패"로 막히는 것을 방지.
const API_BASE = (process.env.NEXT_PUBLIC_API_URL || '') + '/api';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [step, setStep] = useState<'email' | 'otp'>('email');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const { loginWithToken } = useAuth();
  const router = useRouter();
  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);

  // 카운트다운 타이머
  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [countdown]);

  const handleSendOTP = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setIsLoading(true);

    try {
      const response = await fetch(`${API_BASE}/auth/send-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      const data = await response.json();

      if (response.ok) {
        setStep('otp');
        setSuccess('인증 코드가 이메일로 발송되었습니다');
        setCountdown(300); // 5분 카운트다운
        setTimeout(() => otpRefs.current[0]?.focus(), 100);
      } else {
        setError(data.detail || '인증 코드 발송에 실패했습니다');
      }
    } catch {
      setError('서버 연결에 실패했습니다');
    }
    setIsLoading(false);
  };

  const handleVerifyOTP = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    const otpCode = otp.join('');

    try {
      const response = await fetch(`${API_BASE}/auth/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, otp: otpCode }),
      });

      const data = await response.json();

      if (response.ok) {
        loginWithToken(data.access_token, data.user);
        router.push('/');
      } else {
        setError(data.detail || '인증 코드가 올바르지 않습니다');
        setOtp(['', '', '', '', '', '']);
        otpRefs.current[0]?.focus();
      }
    } catch {
      setError('서버 연결에 실패했습니다');
    }
    setIsLoading(false);
  };

  const handleOtpChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return; // 숫자만 허용

    const newOtp = [...otp];
    newOtp[index] = value.slice(-1); // 마지막 숫자만
    setOtp(newOtp);

    // 다음 입력칸으로 이동
    if (value && index < 5) {
      otpRefs.current[index + 1]?.focus();
    }
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
  };

  const handleOtpPaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pastedData = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    const newOtp = [...otp];
    for (let i = 0; i < pastedData.length; i++) {
      newOtp[i] = pastedData[i];
    }
    setOtp(newOtp);
    otpRefs.current[Math.min(pastedData.length, 5)]?.focus();
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleResendOTP = async () => {
    if (countdown > 0) return;
    setOtp(['', '', '', '', '', '']);
    await handleSendOTP({ preventDefault: () => {} } as FormEvent);
  };

  const handleBackToEmail = () => {
    setStep('email');
    setOtp(['', '', '', '', '', '']);
    setError('');
    setSuccess('');
    setCountdown(0);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#08090A] to-[#08090A] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* 로고 */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-gradient-to-br from-[#5E6AD2] to-[#5E6AD2] rounded-2xl flex items-center justify-center shadow-[0px_7px_32px_rgba(0,0,0,0.35)] mx-auto mb-4">
            <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-[#5E6AD2] to-[#5E6AD2] bg-clip-text text-transparent">
            Nuldam BigQuery Chat Analytics
          </h1>
          <p className="text-[#8A8F98] mt-2">로그인하여 데이터 분석을 시작하세요</p>
        </div>

        {/* 로그인 폼 */}
        <div className="bg-[#0F1011] rounded-2xl shadow-[0px_7px_32px_rgba(0,0,0,0.35)] p-8 border border-[#23252A]">
          {step === 'email' ? (
            <form onSubmit={handleSendOTP} className="space-y-6">
              {error && (
                <div className="p-4 bg-[#EB5757]/10 border border-[#EB5757]/30 rounded-xl text-[#EB5757] text-sm flex items-center gap-2">
                  <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {error}
                </div>
              )}

              <div>
                <label htmlFor="email" className="block text-sm font-medium text-[#D0D6E0] mb-2">
                  이메일
                </label>
                <input
                  type="email"
                  id="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@company.com"
                  required
                  className="w-full px-4 py-3 border border-[#23252A] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#5E6AD2] focus:border-transparent transition-all"
                />
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-3 bg-gradient-to-r from-[#5E6AD2] to-[#5E6AD2] text-white rounded-xl font-semibold hover:from-[#5E6AD2] hover:to-[#4B55A5] disabled:from-[#1C1C1F] disabled:to-[#232326] disabled:cursor-not-allowed transition-all shadow-[0px_3px_12px_rgba(0,0,0,0.2)] hover:shadow-[0px_7px_32px_rgba(0,0,0,0.35)] flex items-center justify-center gap-2"
              >
                {isLoading ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    발송 중...
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                    인증 코드 발송
                  </>
                )}
              </button>
            </form>
          ) : (
            <form onSubmit={handleVerifyOTP} className="space-y-6">
              {error && (
                <div className="p-4 bg-[#EB5757]/10 border border-[#EB5757]/30 rounded-xl text-[#EB5757] text-sm flex items-center gap-2">
                  <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {error}
                </div>
              )}

              {success && (
                <div className="p-4 bg-[#27A644]/10 border border-[#27A644]/30 rounded-xl text-[#27A644] text-sm flex items-center gap-2">
                  <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {success}
                </div>
              )}

              <div className="text-center">
                <p className="text-sm text-[#8A8F98] mb-1">인증 코드가 발송된 이메일:</p>
                <p className="font-medium text-[#F7F8F8]">{email}</p>
                <button
                  type="button"
                  onClick={handleBackToEmail}
                  className="text-sm text-[#7070FF] hover:text-[#828FFF] mt-1"
                >
                  다른 이메일 사용
                </button>
              </div>

              <div>
                <label className="block text-sm font-medium text-[#D0D6E0] mb-3 text-center">
                  6자리 인증 코드 입력
                </label>
                <div className="flex justify-center gap-2" onPaste={handleOtpPaste}>
                  {otp.map((digit, index) => (
                    <input
                      key={index}
                      ref={(el) => { otpRefs.current[index] = el; }}
                      type="text"
                      inputMode="numeric"
                      maxLength={1}
                      value={digit}
                      onChange={(e) => handleOtpChange(index, e.target.value)}
                      onKeyDown={(e) => handleOtpKeyDown(index, e)}
                      className="w-12 h-14 text-center text-2xl font-bold border border-[#23252A] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#5E6AD2] focus:border-transparent transition-all"
                    />
                  ))}
                </div>
              </div>

              {countdown > 0 && (
                <p className="text-center text-sm text-[#8A8F98]">
                  남은 시간: <span className="font-medium text-[#7070FF]">{formatTime(countdown)}</span>
                </p>
              )}

              <button
                type="submit"
                disabled={isLoading || otp.some(d => !d)}
                className="w-full py-3 bg-gradient-to-r from-[#5E6AD2] to-[#5E6AD2] text-white rounded-xl font-semibold hover:from-[#5E6AD2] hover:to-[#4B55A5] disabled:from-[#1C1C1F] disabled:to-[#232326] disabled:cursor-not-allowed transition-all shadow-[0px_3px_12px_rgba(0,0,0,0.2)] hover:shadow-[0px_7px_32px_rgba(0,0,0,0.35)] flex items-center justify-center gap-2"
              >
                {isLoading ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    확인 중...
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    확인
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={handleResendOTP}
                disabled={countdown > 0 || isLoading}
                className="w-full py-2 text-sm text-[#8A8F98] hover:text-[#7070FF] disabled:text-[#62666D] disabled:cursor-not-allowed transition-colors"
              >
                {countdown > 0 ? `${formatTime(countdown)} 후 재발송 가능` : '인증 코드 재발송'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
