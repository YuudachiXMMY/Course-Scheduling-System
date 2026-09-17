import { fileURLToPath } from 'node:url'
import tsconfigPaths from 'vite-tsconfig-paths'
import { configDefaults, defineConfig } from 'vitest/config'

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
    // The unit suite is `tests/**/*.test.ts`; the Playwright E2E suite lives under
    // `tests/e2e/**/*.spec.ts` and MUST NOT be collected by vitest — those specs call
    // Playwright's test.describe()/test.use(), which throw "did not expect ... to be
    // called here" under the vitest runner. Scope to `.test.ts` and hard-exclude e2e.
    include: ['tests/**/*.test.ts'],
    exclude: [...configDefaults.exclude, 'tests/e2e/**'],
    // Run test FILES sequentially. The DB-integration suites all share ONE Postgres and clean up by
    // broad predicates (e.g. `delete from user where email like 'portal_%@portal.local'`), so under
    // file parallelism one file's cleanup can delete another file's in-flight rows mid-provision —
    // Better Auth's non-transactional createUser then hits an account_user_id FK violation. Serialising
    // files removes that cross-file race deterministically (a few seconds slower, always green).
    fileParallelism: false,
    // Load .env (DATABASE_URL etc.) so `npm run test` works standalone — vitest,
    // unlike Next, does NOT auto-load .env. In CI / docker the vars are already in
    // the process env and dotenv is a harmless no-op.
    setupFiles: ['dotenv/config'],
  },
})
