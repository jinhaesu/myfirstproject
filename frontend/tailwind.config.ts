import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    // 전체 폰트 사이즈 한 단계 축소
    fontSize: {
      'xs':   ['0.6875rem', { lineHeight: '0.875rem' }],   // 11px (was 12px)
      'sm':   ['0.75rem',   { lineHeight: '1.125rem' }],   // 12px (was 14px)
      'base': ['0.8125rem', { lineHeight: '1.25rem' }],    // 13px (was 16px)
      'lg':   ['0.9375rem', { lineHeight: '1.375rem' }],   // 15px (was 18px)
      'xl':   ['1.0625rem', { lineHeight: '1.5rem' }],     // 17px (was 20px)
      '2xl':  ['1.25rem',   { lineHeight: '1.625rem' }],   // 20px (was 24px)
      '3xl':  ['1.5rem',    { lineHeight: '1.875rem' }],   // 24px (was 30px)
      '4xl':  ['1.875rem',  { lineHeight: '2.25rem' }],    // 30px (was 36px)
      '5xl':  ['2.25rem',   { lineHeight: '2.5rem' }],     // 36px (was 48px)
    },
    extend: {
      // 라이트/다크 테마 토큰 — CSS 변수를 가리키는 시맨틱 컬러 이름.
      // 값은 src/app/globals.css의 :root / :root[data-theme="light"]에서 정의됨.
      colors: {
        // Backgrounds (레벨별 표면)
        'bg-0': 'var(--color-bg-level-0)',
        'bg-1': 'var(--color-bg-level-1)',
        'bg-2': 'var(--color-bg-level-2)',
        'bg-secondary': 'var(--color-bg-secondary)',
        'bg-tertiary': 'var(--color-bg-tertiary)',
        'bg-quaternary': 'var(--color-bg-quaternary)',
        'bg-inset': 'var(--color-bg-inset)',
        // Text
        'text-primary': 'var(--color-text-primary)',
        'text-secondary': 'var(--color-text-secondary)',
        'text-tertiary': 'var(--color-text-tertiary)',
        'text-quaternary': 'var(--color-text-quaternary)',
        'text-dim': 'var(--color-text-dim)',
        'text-muted': 'var(--color-text-muted)',
        // Borders
        'border-primary': 'var(--color-border-primary)',
        'border-secondary': 'var(--color-border-secondary)',
        'border-subtle': 'var(--color-border-subtle)',
        // Brand family (다크/라이트 공통 유지)
        'brand': 'var(--color-brand-bg)',
        'brand-hover': 'var(--color-brand-hover)',
        'brand-light': 'var(--color-brand-light)',
        'link': 'var(--color-link-primary)',
        'accent': 'var(--color-accent-hover)',
        // Semantic status
        'danger': 'var(--color-danger)',
        'success': 'var(--color-success)',
        'success-hover': 'var(--color-success-hover)',
        'success-light': 'var(--color-success-light)',
        'warning': 'var(--color-warning)',
        'orange': 'var(--color-orange)',
        'info': 'var(--color-info)',
        'cyan': 'var(--color-cyan)',
        'purple': 'var(--color-purple)',
      },
    },
  },
  plugins: [],
};
export default config;
