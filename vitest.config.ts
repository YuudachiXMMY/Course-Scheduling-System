import { fileURLToPath } from 'node:url'
import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'

// DEVIATION (vitest wiring, not enumerated in the plan):
//  - vite-tsconfig-paths resolves the `@/*` -> ./src/* alias inside tests.
//  - `server-only` is a poison-pill that throws when imported outside an RSC
//    graph; under Node/vitest it would abort the test on import of @/db. Alias
//    it to an empty stub so the tenant-isolation test can exercise forTenant().
export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: {
      'server-only': fileURLToPath(new URL('./tests/server-only-stub.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    // Load .env (DATABASE_URL etc.) so `npm run test` works standalone — vitest,
    // unlike Next, does NOT auto-load .env. In CI / docker the vars are already in
    // the process env and dotenv is a harmless no-op.
    setupFiles: ['dotenv/config'],
  },
})
