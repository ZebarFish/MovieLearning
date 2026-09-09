/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#e3f2fd',
          500: '#2196f3',
          600: '#1e88e5',
          700: '#1976d2',
        },
      },
    },
  },
  plugins: [],
  // Disable preflight to avoid conflicts with MUI's CssBaseline
  corePlugins: {
    preflight: false,
  },
};