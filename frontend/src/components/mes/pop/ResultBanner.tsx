'use client';

/** 종료 결과 판정 배너 — 2초간 큰 화면 표시 */
export function ResultBanner({ judgment }: { judgment: '적' | '부' | null }) {
  if (!judgment) return null;
  const ok = judgment === '적';
  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/70 pointer-events-none">
      <div className={`rounded-3xl px-16 py-12 text-center shadow-2xl ${ok ? 'bg-success' : 'bg-danger'}`}>
        <div className="text-6xl font-black text-white mb-2">{ok ? '적합' : '부적합'}</div>
        {!ok && <div className="text-lg font-semibold text-white/90">이탈이 자동 등록되었습니다</div>}
      </div>
    </div>
  );
}
