import type { Config } from 'tailwindcss';

// 색은 CSS 변수라 Tailwind 가 투명도를 계산할 수 없다. color-mix 로 감싸야
// bg-brand/10, border-danger/30 같은 투명도 표기가 실제 CSS 로 만들어진다.
const c = (v: string) => `color-mix(in srgb, var(${v}) calc(<alpha-value> * 100%), transparent)`;

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
      // 글꼴은 두 가지뿐: 본문 Pretendard Variable, 고정폭 Geist Mono (styles/nd-type.css 의 변수)
      fontFamily: { sans: ['var(--nd-font-sans)'], mono: ['var(--nd-font-mono)'] },
      // 라이트/다크 테마 토큰 — CSS 변수를 가리키는 시맨틱 컬러 이름.
      // 값은 src/app/globals.css의 :root / :root[data-theme="light"]에서 정의됨.
      colors: {
        // Backgrounds (레벨별 표면)
        'bg-0': c('--color-bg-level-0'),
        'bg-1': c('--color-bg-level-1'),
        'bg-2': c('--color-bg-level-2'),
        'bg-secondary': c('--color-bg-secondary'),
        'bg-tertiary': c('--color-bg-tertiary'),
        'bg-quaternary': c('--color-bg-quaternary'),
        'bg-inset': c('--color-bg-inset'),
        // Text
        'text-primary': c('--color-text-primary'),
        'text-secondary': c('--color-text-secondary'),
        'text-tertiary': c('--color-text-tertiary'),
        'text-quaternary': c('--color-text-quaternary'),
        'text-dim': c('--color-text-dim'),
        'text-muted': c('--color-text-muted'),
        // Borders
        'border-primary': c('--color-border-primary'),
        'border-secondary': c('--color-border-secondary'),
        'border-subtle': c('--color-border-subtle'),
        // Brand family (다크/라이트 공통 유지)
        'brand': c('--color-brand-bg'),
        'brand-hover': c('--color-brand-hover'),
        'brand-light': c('--color-brand-light'),
        'link': c('--color-link-primary'),
        'accent': c('--color-accent-hover'),
        // Semantic status
        'danger': c('--color-danger'),
        'success': c('--color-success'),
        'success-hover': c('--color-success-hover'),
        'success-light': c('--color-success-light'),
        'warning': c('--color-warning'),
        'orange': c('--color-orange'),
        'info': c('--color-info'),
        'cyan': c('--color-cyan'),
        'purple': c('--color-purple'),
        // 강조색 위의 글자(어두운 화면에서는 거의 검정)
        'on-brand': c('--color-on-brand'),
      },
      // 깊이: 밝은 화면은 옅은 그림자, 어두운 화면은 그림자 없이 면 단계와 가는 선
      boxShadow: {
        'nd-s': 'var(--nd-shadow-s)',
        'nd-f': 'var(--nd-shadow-f)',
      },
      // 움직임: 곡선 하나, 길이 셋 (styles/nd-cosmos.css)
      transitionTimingFunction: {
        DEFAULT: 'var(--nd-ease)',
        nd: 'var(--nd-ease)',
      },
      transitionDuration: {
        DEFAULT: 'var(--nd-fast)',
        fast: 'var(--nd-fast)',
        mid: 'var(--nd-mid)',
        slow: 'var(--nd-slow)',
      },
    },
  },
  plugins: [],
};
export default config;
