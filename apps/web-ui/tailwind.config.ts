import type { Config } from 'tailwindcss';
import { fontFamily } from 'tailwindcss/defaultTheme';
import tailwindcssAnimate from 'tailwindcss-animate';

const hsl = (name: string) => `hsl(var(--${name}) / <alpha-value>)`;

export default {
  darkMode: ['class'],
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: { '2xl': '1400px' },
    },
    extend: {
      fontFamily: {
        sans: ['var(--font-sans)', ...fontFamily.sans],
        mono: ['var(--font-mono)', ...fontFamily.mono],
      },
      fontSize: {
        13: ['0.8125rem', { lineHeight: '1.25rem' }],
      },
      keyframes: {
        'message-pop': {
          '0%': { opacity: '0', transform: 'translateY(16px) scale(0.97)' },
          '60%': { opacity: '1', transform: 'translateY(-2px) scale(1.008)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        'fade-in-up': {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'message-pop': 'message-pop 0.4s cubic-bezier(0.16, 1, 0.3, 1) both',
        'fade-in-up': 'fade-in-up 0.35s cubic-bezier(0.16, 1, 0.3, 1) both',
      },
      colors: {
        border: hsl('border'),
        input: hsl('input'),
        ring: hsl('ring'),
        background: hsl('background'),
        foreground: hsl('foreground'),
        brand: hsl('brand'),
        primary: { DEFAULT: hsl('primary'), foreground: hsl('primary-foreground'), subtle: hsl('primary-subtle') },
        secondary: { DEFAULT: hsl('secondary'), foreground: hsl('secondary-foreground') },
        destructive: { DEFAULT: hsl('destructive'), foreground: hsl('destructive-foreground'), subtle: hsl('destructive-subtle') },
        muted: { DEFAULT: hsl('muted'), foreground: hsl('muted-foreground') },
        accent: { DEFAULT: hsl('accent'), foreground: hsl('accent-foreground') },
        card: { DEFAULT: hsl('card'), foreground: hsl('card-foreground') },
        popover: { DEFAULT: hsl('popover'), foreground: hsl('popover-foreground') },
        sidebar: { DEFAULT: hsl('sidebar'), foreground: hsl('sidebar-foreground') },
        warning: { subtle: hsl('warning-subtle'), foreground: hsl('warning-foreground') },
        success: { foreground: hsl('success-foreground') },
        status: {
          success: hsl('status-success'),
          warning: hsl('status-warning'),
          danger: hsl('status-danger'),
          neutral: hsl('status-neutral'),
        },
        ink: '#0b1215',
        panel: '#131a1d',
        edge: '#1f292d',
        line: '#283439',
        fog: '#9aa8ae',
        'gray-bg': '#f1f5f9',
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
    },
  },
  plugins: [tailwindcssAnimate],
} satisfies Config;
