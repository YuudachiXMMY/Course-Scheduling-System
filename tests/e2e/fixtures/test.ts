import { test as base, expect, type Browser, type BrowserContext } from '@playwright/test'
import { readSeedData, type SeedData } from './seed-data'
import { authStatePath, type E2ERole } from './seed-constants'

// Shared test surface for all E2E specs. `seed` exposes the dynamic ids written by global-setup.
export const test = base.extend<{ seed: SeedData }>({
  seed: async ({}, use) => {
    // eslint-disable-next-line react-hooks/rules-of-hooks -- Playwright fixture `use`, not a React hook
    await use(readSeedData())
  },
})

export { expect }
export type { Page } from '@playwright/test'

/**
 * Open a browser context already signed in as `role` (via the storageState minted in global-setup).
 * Use for cross-role scenarios in a single test (e.g. parent submits, owner approves), or to act as a
 * non-default role inside a project. Remember to `await ctx.close()`.
 */
export async function contextForRole(browser: Browser, role: E2ERole): Promise<BrowserContext> {
  return browser.newContext({ storageState: authStatePath(role) })
}
