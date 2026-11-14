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
    <div className="min-h-screen bg-bg-0 flex items-center justify-center">
      <div className="bg-bg-1 rounded-2xl shadow-nd-s border border-border-primary p-8 max-w-md text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons3d/empty.png" alt="" width={88} height={88} className="nd-icon3d w-[88px] h-[88px] mx-auto mb-3" />
        <h2 className="text-lg font-medium text-text-primary mb-2">화면을 불러오지 못했습니다</h2>
        <p className="text-sm text-text-tertiary mb-4">{error.message || '알 수 없는 오류가 발생했습니다.'}</p>
        <div className="flex gap-3 justify-center">
          <button
            onClick={reset}
            className="px-4 py-2 bg-brand text-on-brand rounded-lg hover:bg-accent transition-colors text-sm"
          >
            다시 시도
          </button>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-bg-2 text-text-secondary rounded-lg hover:bg-bg-secondary transition-colors text-sm"
          >
            페이지 새로고침
          </button>
        </div>
      </div>
    </div>
  );
}
