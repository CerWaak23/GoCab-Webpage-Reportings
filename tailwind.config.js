/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Colores de marca, tomados del logo (public/gocab-full.svg)
        marca: {
          azul: '#33548E',
          'azul-oscuro': '#27406e',
          'azul-tenue': '#e9eef6',
          'azul-borde': '#b9c8e0',
          oliva: '#59621D',
        },
      },
    },
  },
  plugins: [],
};
