// DEVIATION (Tailwind v4 wiring, not enumerated in the plan): globals.css uses
// `@import "tailwindcss"` + `@theme`, which requires the @tailwindcss/postcss plugin.
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
}

export default config
