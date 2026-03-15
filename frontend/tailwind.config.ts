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
    extend: {},
  },
  plugins: [],
};
export default config;
