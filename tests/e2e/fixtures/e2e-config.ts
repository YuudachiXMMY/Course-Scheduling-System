import { config as loadEnv } from 'dotenv'

// Load .env.e2e if present (local dev). In CI these come from the workflow env, and .env.e2e is absent,
// so this is a silent no-op. dotenv does not override already-set process.env values.
loadEnv({ path: '.env.e2e', quiet: true })

/** Resolved E2E configuration, shared by playwright.config.ts and global-setup.ts. */
export const E2E_CONFIG = {
  /** Where the running app is reachable — Playwright baseURL + BETTER_AUTH_URL for the seed. */
  baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
  /** Postgres the app reads from — the seed writes here so fixtures are visible to the app. */
  databaseUrl: process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL ?? '',
  /** Any ≥32-char string; only needs to satisfy the seed process's env validation. */
  authSecret:
    process.env.E2E_BETTER_AUTH_SECRET ??
    process.env.BETTER_AUTH_SECRET ??
    'e2e-insecure-secret-override-me-0123456789',
  /** Skip the (re)seed step in global-setup — e.g. when iterating on specs against an already-seeded DB. */
  skipSeed: process.env.E2E_SKIP_SEED === '1',
}
