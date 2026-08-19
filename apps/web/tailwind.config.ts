import type { Config } from 'tailwindcss';

/**
 * One neutral palette plus a single accent. A due-diligence tool should read as calm and legible;
 * colour is reserved for state (destructive, selected, focus) so that when something *is*
 * coloured, it means something.
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: '#ffffff',
          muted: '#f7f8fa',
          sunken: '#eef0f4',
        },
        ink: {
          DEFAULT: '#111827',
          muted: '#4b5563',
          subtle: '#6b7280',
        },
        line: {
          DEFAULT: '#e5e7eb',
          strong: '#d1d5db',
        },
        accent: {
          DEFAULT: '#2563eb',
          hover: '#1d4ed8',
          subtle: '#eff6ff',
        },
        danger: {
          DEFAULT: '#dc2626',
          hover: '#b91c1c',
          subtle: '#fef2f2',
        },
      },
      fontFamily: {
        sans: [
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'sans-serif',
        ],
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'slide-up': {
          // Use the individual transform property so this motion composes with an element's
          // existing transform. Dialogs rely on transform: translate(-50%, -50%) for centering;
          // animating the transform shorthand temporarily replaced that and made every dialog
          // snap sideways as it opened.
          from: { opacity: '0', translate: '0 4px' },
          to: { opacity: '1', translate: '0 0' },
        },
      },
      animation: {
        'fade-in': 'fade-in 120ms ease-out',
        'slide-up': 'slide-up 140ms ease-out',
      },
    },
  },
  plugins: [],
} satisfies Config;
