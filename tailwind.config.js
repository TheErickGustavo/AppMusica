/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          'ui-sans-serif',
          'system-ui',
          '"Segoe UI Variable Display"',
          '"Segoe UI Variable Text"',
          '"Segoe UI"',
          'Inter',
          '"SF Pro Display"',
          '-apple-system',
          'BlinkMacSystemFont',
          'sans-serif'
        ],
        mono: [
          'ui-monospace',
          '"Cascadia Mono"',
          '"JetBrains Mono"',
          '"SF Mono"',
          'Consolas',
          '"Roboto Mono"',
          'monospace'
        ]
      },
      colors: {
        surface: {
          base: '#09090b',
          raised: '#18181b',
          card: 'rgba(24, 24, 27, 0.5)'
        }
      },
      keyframes: {
        'eq-bar': {
          '0%, 100%': { transform: 'scaleY(0.25)' },
          '50%': { transform: 'scaleY(1)' }
        },
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' }
        }
      },
      animation: {
        'fade-up': 'fade-up 0.35s cubic-bezier(0.16, 1, 0.3, 1) both'
      },
      transitionTimingFunction: {
        precise: 'cubic-bezier(0.16, 1, 0.3, 1)'
      }
    }
  },
  plugins: []
}
