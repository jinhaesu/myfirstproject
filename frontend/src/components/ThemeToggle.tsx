'use client';

import { useEffect, useState } from 'react';

type Theme = 'dark' | 'light';

/**
 * 라이트/다크 테마 토글 버튼.
 * - <html data-theme="..."> 속성을 뒤집고 localStorage('theme')에 저장한다.
 * - 초기값은 layout.tsx의 인라인 스크립트가 하이드레이션 전에 세팅하므로,
 *   여기서는 마운트 시 현재 값을 읽어와 아이콘 상태만 동기화한다.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('dark');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const current = (document.documentElement.dataset.theme as Theme) || 'dark';
    setTheme(current);
    setMounted(true);
  }, []);

  const toggle = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('theme', next);
    } catch {
      // localStorage 접근 불가 시(프라이빗 모드 등) 조용히 무시
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={theme === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환'}
      title={theme === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환'}
      className="p-2 text-text-tertiary hover:text-text-primary hover:bg-white/5 rounded-lg transition-colors"
    >
      {!mounted ? (
        <span className="block w-4 h-4" />
      ) : theme === 'dark' ? (
        // Sun icon (클릭 시 라이트 모드로 전환됨을 암시)
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
        </svg>
      ) : (
        // Moon icon (클릭 시 다크 모드로 전환됨을 암시)
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
        </svg>
      )}
    </button>
  );
}

export default ThemeToggle;
