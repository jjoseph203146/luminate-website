/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html'],
  theme: {
    extend: {
      colors: {
        navy: '#0D1B2E', navy2: '#0A1524', card: '#101F35', card2: '#152A45',
        ink: '#F4F7FB', dim: '#C4D1E2', dim2: '#7E8DA0',
        accent: '#E8E2D4', accenthi: '#F3EEE3',
        brgreen: '#3DAE7A', brred: '#E0796B',
        line: 'rgba(196,209,226,.10)',
      },
      fontFamily: { serif: ['"Playfair Display"', 'serif'], sans: ['Inter', 'system-ui', 'sans-serif'] },
    },
  },
}
