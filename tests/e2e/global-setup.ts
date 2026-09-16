import { request } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'

import { E2E_CONFIG } from './fixtures/e2e-config'
import { readSeedData } from './fixtures/seed-data'
import {
  AUTH_STATE_DIR,
  E2E_ACCOUNTS,
  STORAGE_STATE_ROLES,
  authStatePath,
} from './fixtures/seed-constants'

// Runs once before the whole suite:
//   1. (re)seed the fixture tenant into the app's Postgres (child process, react-server condition)
//   2. wait for the app to be reachable
//   3. sign each reusable role in via the real HTTP endpoint and persist its storageState
// The seed lives in a child process on purpose: it must import server-only modules (@/db, @/auth),
// which would poison the Playwright runner. Keeping the runner free of those imports avoids the
// server-only trap entirely.
export default async function globalSetup() {
  const { baseURL, databaseUrl, authSecret, skipSeed } = E2E_CONFIG

  if (skipSeed) {
    console.log('[e2e] E2E_SKIP_SEED=1 → skipping reseed (reusing existing fixture)')
  } else {
    if (!databaseUrl) {
      throw new Error(
        '[e2e] No E2E_DATABASE_URL / DATABASE_URL. Copy .env.e2e.example → .env.e2e and set the ' +
          'connection string for the Postgres the app reads from (see README E2E section).',
      )
    }
    console.log('[e2e] seeding fixture tenant…')
    try {
      const out = execFileSync(
        'node',
        ['--conditions=react-server', '--import', 'tsx', 'scripts/seed-e2e.ts'],
        {
          stdio: 'pipe',
          encoding: 'utf8',
          env: {
            ...process.env,
            DATABASE_URL: databaseUrl,
            BETTER_AUTH_SECRET: authSecret,
            BETTER_AUTH_URL: baseURL,
            NEXT_PUBLIC_APP_URL: baseURL,
            E2E_BASE_URL: baseURL,
            NODE_ENV: process.env.NODE_ENV ?? 'test',
          },
        },
      )
      // Surface only the seed's own progress lines; drizzle query logging is noise.
      out
        .split('\n')
        .filter((l) => l.includes('[seed-e2e]'))
        .forEach((l) => console.log(l))
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string; message?: string }
      console.error(
        '[e2e] seed FAILED:\n' + (err.stdout ?? '') + '\n' + (err.stderr ?? err.message),
      )
      throw new Error('E2E seed failed — see output above')
    }
  }

  await waitForApp(baseURL)

  console.log('[e2e] minting storageState for roles:', STORAGE_STATE_ROLES.join(', '))
  mkdirSync(AUTH_STATE_DIR, { recursive: true })
  // Sanity: fail fast with a clear message if the seed manifest is missing/stale.
  readSeedData()

  for (const role of STORAGE_STATE_ROLES) {
    const acct = E2E_ACCOUNTS[role]
    const ctx = await request.newContext({ baseURL })
    await signInWithRetry(ctx, role, acct.email, acct.password)
    await ctx.storageState({ path: authStatePath(role) })
    await ctx.dispose()
    await sleep(400) // be gentle with Better Auth's (production) sign-in rate limiter
  }
  console.log('[e2e] global-setup complete')
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Better Auth enables a short-window rate limit on auth endpoints in production. Sign in with backoff,
// honoring the X-Retry-After header, so global-setup is robust to throttling.
async function signInWithRetry(
  ctx: Awaited<ReturnType<typeof request.newContext>>,
  role: string,
  email: string,
  password: string,
) {
  const maxAttempts = 6
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await ctx.post('/api/auth/sign-in/email', { data: { email, password } })
    if (res.ok()) return
    if (res.status() === 429 && attempt < maxAttempts) {
      const retryAfter = Number(res.headers()['x-retry-after']) || 10
      console.log(
        `[e2e] sign-in ${role} rate-limited; waiting ${retryAfter}s (attempt ${attempt}/${maxAttempts})`,
      )
      await sleep((retryAfter + 1) * 1000)
      continue
    }
    throw new Error(
      `[e2e] sign-in failed for ${role} (${email}): ${res.status()} ${await res.text()}`,
    )
  }
}

async function waitForApp(baseURL: string) {
  const deadline = Date.now() + 60_000
  let lastErr = ''
  while (Date.now() < deadline) {
    try {
      const ctx = await request.newContext({ baseURL })
      const res = await ctx.get('/api/health', { timeout: 5_000 })
      await ctx.dispose()
      if (res.ok()) return
      lastErr = `status ${res.status()}`
    } catch (e) {
      lastErr = (e as Error).message
    }
    await new Promise((r) => setTimeout(r, 1_500))
  }
  throw new Error(`[e2e] app not reachable at ${baseURL}/api/health within 60s (${lastErr})`)
}
