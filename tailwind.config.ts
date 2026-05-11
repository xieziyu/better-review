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
          running: 'var(--accent-running)',
        },
      },
      fontFamily: {
        sans: [
          'Inter',
          'Noto Sans SC',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'sans-serif',
        ],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
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
      },
      animation: {
        'running-pulse': 'running-pulse 2.4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
} satisfies Config
