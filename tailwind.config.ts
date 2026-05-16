import type { Config } from 'tailwindcss'

export default {
  content: ['src/web/**/*.{ts,tsx,html}'],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        canvas: 'var(--bg-canvas)',
        main: 'var(--bg-main)',
        raised: 'var(--bg-raised)',
        sunken: 'var(--bg-sunken)',
        ink: {
          DEFAULT: 'var(--ink-primary)',
          primary: 'var(--ink-primary)',
          secondary: 'var(--ink-secondary)',
          muted: 'var(--ink-muted)',
        },
        rule: 'var(--rule)',
        brand: {
          DEFAULT: 'var(--brand)',
          ink: 'var(--brand-ink)',
        },
        severity: {
          must: 'var(--severity-must)',
          should: 'var(--severity-should)',
          nit: 'var(--severity-nit)',
        },
        accent: {
          ready: 'var(--accent-ready)',
          active: 'var(--accent-active)',
        },
      },
      fontFamily: {
        sans: [
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          'PingFang SC',
          'Hiragino Sans GB',
          'Microsoft YaHei',
          'Noto Sans CJK SC',
          'Noto Sans SC',
          'sans-serif',
        ],
        mono: [
          'ui-monospace',
          'SFMono-Regular',
          'SF Mono',
          'Menlo',
          'Consolas',
          'Liberation Mono',
          'monospace',
        ],
      },
      fontSize: {
        display: ['32px', { lineHeight: '36px', letterSpacing: '-0.02em', fontWeight: '800' }],
        h1: ['22px', { lineHeight: '28px', letterSpacing: '-0.01em', fontWeight: '700' }],
        h2: ['16px', { lineHeight: '22px', fontWeight: '600' }],
        body: ['14px', { lineHeight: '22px', fontWeight: '400' }],
        meta: ['12px', { lineHeight: '16px', fontWeight: '500' }],
        caps: ['11px', { lineHeight: '14px', letterSpacing: '0.06em', fontWeight: '700' }],
        code: ['13px', { lineHeight: '20px', fontWeight: '450' }],
      },
      letterSpacing: {
        caps: '0.06em',
        'caps-wide': '0.08em',
      },
      borderRadius: {
        none: '0',
        sm: '4px',
        DEFAULT: '6px',
        md: '6px',
        lg: '10px',
      },
      transitionTimingFunction: {
        'out-quart': 'cubic-bezier(0.25, 1, 0.5, 1)',
      },
      transitionDuration: {
        180: '180ms',
        240: '240ms',
      },
      keyframes: {
        'running-pulse': {
          '0%, 100%': { opacity: '0.5' },
          '50%': { opacity: '1' },
        },
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'slide-in-right': {
          from: { transform: 'translateX(100%)' },
          to: { transform: 'translateX(0)' },
        },
        'progress-indeterminate': {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(400%)' },
        },
        'peek-in': {
          from: { transform: 'translate(8px, 4px)', opacity: '0' },
          to: { transform: 'translate(0, 0)', opacity: '1' },
        },
      },
      animation: {
        'running-pulse': 'running-pulse 2.4s ease-in-out infinite',
        'fade-in': 'fade-in 180ms cubic-bezier(0.25, 1, 0.5, 1)',
        'slide-in-right': 'slide-in-right 180ms cubic-bezier(0.25, 1, 0.5, 1)',
        'progress-indeterminate': 'progress-indeterminate 1.6s ease-in-out infinite',
        'peek-in': 'peek-in 220ms cubic-bezier(0.22, 1, 0.36, 1)',
      },
    },
  },
  plugins: [],
} satisfies Config
