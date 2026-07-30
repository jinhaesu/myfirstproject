'use client';

// 채널 대시보드와 동일한 "데이터 불러오는 중…" 오버레이.
// 부모 컨테이너에 position: relative 가 있어야 함.
export function LoadingOverlay({ show, text = '데이터 불러오는 중…' }: { show: boolean; text?: string }) {
  if (!show) return null;
  return (
    <div className="absolute inset-0 z-20 bg-bg-0/55 backdrop-blur-[1px] flex items-start justify-center pt-24 pointer-events-none rounded-xl">
      <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-bg-inset border border-border-subtle shadow-lg text-xs text-text-secondary">
        <span className="w-3.5 h-3.5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        {text}
      </div>
    </div>
  );
}
