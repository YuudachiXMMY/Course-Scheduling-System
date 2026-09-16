// Side-effect module: map the E2E_* config onto the app's expected env vars BEFORE @/db and @/env are
// evaluated. It MUST be the first import in scripts/seed-e2e.ts — ES modules evaluate imports in source
// order, so this runs before the @/db import that reads process.env.DATABASE_URL / validates @/env.
//
// `--env-file-if-exists=.env.e2e` (in the npm script) has already loaded E2E_* into process.env by the
// time this executes. When global-setup spawns the seed it passes DATABASE_URL etc. directly, so the
// `??=` assignments below are no-ops in that path.
process.env.DATABASE_URL ||= process.env.E2E_DATABASE_URL ?? ''
process.env.BETTER_AUTH_SECRET ||=
  process.env.E2E_BETTER_AUTH_SECRET ?? 'e2e-insecure-secret-override-me-0123456789'
process.env.BETTER_AUTH_URL ||= process.env.E2E_BASE_URL ?? 'http://localhost:3000'
process.env.NEXT_PUBLIC_APP_URL ||= process.env.BETTER_AUTH_URL
// NODE_ENV is typed read-only by @types/node; assign through a widened view.
if (!process.env.NODE_ENV) (process.env as Record<string, string>).NODE_ENV = 'test'

if (!process.env.DATABASE_URL) {
  throw new Error(
    'E2E seed: no DATABASE_URL / E2E_DATABASE_URL. Set it in .env.e2e (see .env.e2e.example) or the env.',
  )
}
