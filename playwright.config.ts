import { defineConfig, devices } from '@playwright/test'
import { E2E_CONFIG } from './tests/e2e/fixtures/e2e-config'
import { authStatePath } from './tests/e2e/fixtures/seed-constants'

// E2E runs against the REAL running app + a seeded fixture tenant in its Postgres (see
// tests/e2e/global-setup.ts and scripts/seed-e2e.ts). Because the whole suite shares ONE app instance
// and ONE database, tests run serially (workers: 1) for deterministic, contention-free behavior.
// Specs that create data use unique (timestamped) names and assert on their own rows, never on global
// counts — see tests/e2e/README.md.
export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  outputDir: './test-results',

  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },

  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never' }], ['junit', { outputFile: 'test-results/junit.xml' }]]
    : [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL: E2E_CONFIG.baseURL,
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },

  projects: [
    // Unauthenticated flows drive login/signup/logout themselves.
    {
      name: 'auth-flows',
      testMatch: '**/auth/**/*.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    // Public, no-auth pages (share links).
    {
      name: 'public',
      testMatch: '**/public/**/*.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    // Staff area — defaults to the owner storageState (all permissions). Specs needing a narrower role
    // override with `test.use({ storageState: authStatePath('teacher') })`.
    {
      name: 'staff',
      testMatch: '**/dashboard/**/*.spec.ts',
      use: { ...devices['Desktop Chrome'], storageState: authStatePath('owner') },
    },
    // Parent/student portal — defaults to the consented parent storageState.
    {
      name: 'portal',
      testMatch: '**/portal/**/*.spec.ts',
      use: { ...devices['Desktop Chrome'], storageState: authStatePath('parent') },
    },
  ],

  // Reuses the already-running app (docker container / `npm run dev`) if reachable; otherwise starts one.
  webServer: {
    command: 'npm run dev',
    url: `${E2E_CONFIG.baseURL}/api/health`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
