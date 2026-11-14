'use client';

import { useEffect, useState } from 'react';
import { MoonIcon, SunIcon } from '@/components/nd/icons';

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
      className="p-2 text-text-tertiary hover:text-text-primary hover:bg-bg-secondary rounded-lg transition-colors"
    >
      {!mounted ? (
        <span className="block w-4 h-4" />
      ) : theme === 'dark' ? (
        // Sun icon (클릭 시 라이트 모드로 전환됨을 암시)
        <SunIcon className="w-4 h-4" />
      ) : (
        // Moon icon (클릭 시 다크 모드로 전환됨을 암시)
        <MoonIcon className="w-4 h-4" />
      )}
    </button>
  );
}

export default ThemeToggle;
