import type { Config } from 'tailwindcss';
import colors from 'tailwindcss/colors';

// Brand-neutral placeholder palette (no real campaign branding exists yet --
// see README.md). Aliased as semantic names (`brand`, `success`, `warning`,
// `danger`) rather than used directly (`blue`, `emerald`, ...) so a real
// campaign's colors can be swapped in per-tenant later by changing only
// this file, not every component that uses them.
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: colors.blue,
        success: colors.emerald,
        warning: colors.amber,
        danger: colors.rose,
      },
    },
  },
  plugins: [],
};

export default config;
