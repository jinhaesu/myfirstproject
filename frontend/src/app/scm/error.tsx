'use client';

import { useEffect } from 'react';

export default function ScmError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // ChunkLoadError → 페이지 새로고침으로 해결
    if (error.message?.includes('ChunkLoadError') || error.message?.includes('Loading chunk')) {
      window.location.reload();
    }
  }, [error]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-[#08090A] flex items-center justify-center">
      <div className="bg-[#0F1011] rounded-2xl shadow-[0px_1px_3px_rgba(0,0,0,0.2)] border border-[#23252A] p-8 max-w-md text-center">
        <div className="w-12 h-12 bg-[#EB5757]/15 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-6 h-6 text-[#EB5757]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
        </div>
        <h2 className="text-lg font-semibold text-[#F7F8F8] mb-2">페이지 로드 오류</h2>
        <p className="text-sm text-[#8A8F98] mb-4">{error.message || '알 수 없는 오류가 발생했습니다.'}</p>
        <div className="flex gap-3 justify-center">
          <button
            onClick={reset}
            className="px-4 py-2 bg-[#5E6AD2] text-white rounded-lg hover:bg-[#828FFF] transition-colors text-sm"
          >
            다시 시도
          </button>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-[#141516] text-[#D0D6E0] rounded-lg hover:bg-[#141516]/7 transition-colors text-sm"
          >
            페이지 새로고침
          </button>
        </div>
      </div>
    </div>
  );
}
