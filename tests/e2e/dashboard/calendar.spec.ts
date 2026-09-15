import { test, expect } from '../fixtures/test'
import type { Page } from '@playwright/test'

// iCal 订阅链接 CRUD on /dashboard/calendar (project `staff`, default owner storageState → has
// lesson:read/update). This exercises the FeedPanel subscription-link lifecycle
// (generate → copy → rotate → revoke → regenerate), NOT the FullCalendar grid.
//
// Shared-backend notes (see AUTHORING.md):
// - There is exactly ONE active (non-revoked) feed per tenant, so the panel's state is global to the
//   fixture tenant and may already exist from a prior run. Each test rebuilds its precondition via
//   `ensureFeed`, and the revoke test regenerates at the end to leave the tenant with a usable feed.
// - rotate/revoke use window.confirm → a dialog handler MUST be registered before the click.
// - copy uses navigator.clipboard → perms granted below; we accept either toast so clipboard quirks
//   don't fail the test.

// Both feed URLs point at /api/calendar/<token>; the webcal link is the https URL with the scheme
// swapped. These locators uniquely target the live feed URLs (the page's inline <code>webcal://</code>
// / <code>https://</code> help snippets do not contain the /api/calendar/ path).
const webcalLink = (page: Page) => page.locator('a[href^="webcal:"]')
const httpsCode = (page: Page) => page.locator('code').filter({ hasText: '/api/calendar/' })

// Land on the settings page with an active feed present, creating one if none exists yet.
async function ensureFeed(page: Page) {
  await page.goto('/dashboard/calendar')
  await expect(page.getByRole('heading', { name: '日历订阅', exact: true })).toBeVisible()

  const generate = page.getByRole('button', { name: '生成订阅链接' })
  if (await generate.isVisible()) {
    await generate.click()
    await expect(page.getByText('已生成订阅链接')).toBeVisible()
  }
  // Feed branch is now rendered (rotate/revoke controls present).
  await expect(page.getByRole('button', { name: '重新生成链接' })).toBeVisible()
}

test.describe('日历订阅链接 CRUD', () => {
  // Clipboard perms for the copy button (AUTHORING.md gotcha). storageState from the project is
  // preserved — contextOptions only adds permissions.
  test.use({ contextOptions: { permissions: ['clipboard-read', 'clipboard-write'] } })

  test('生成订阅链接并展示 webcal/https 链接与复制', async ({ page }) => {
    await ensureFeed(page)

    const webcal = webcalLink(page)
    await expect(webcal).toBeVisible()
    await expect(webcal).toHaveAttribute('href', /\/api\/calendar\//)
    await expect(httpsCode(page)).toBeVisible()

    // Copy is navigator.clipboard-backed; don't fail on clipboard — accept either the success toast
    // or the manual-fallback toast.
    await page.getByRole('button', { name: '复制' }).first().click()
    await expect(page.getByText(/已复制链接|复制失败/)).toBeVisible()
  })

  test('重新生成链接后展示的订阅 URL 变化', async ({ page }) => {
    // rotate() fires window.confirm → accept before the click or Playwright hangs.
    page.on('dialog', (d) => d.accept())
    await ensureFeed(page)

    const before = (await httpsCode(page).innerText()).trim()

    await page.getByRole('button', { name: '重新生成链接' }).click()
    await expect(page.getByText('已重新生成链接')).toBeVisible()

    // router.refresh() re-renders the panel with a fresh token → the displayed URL must differ.
    await expect(httpsCode(page)).not.toHaveText(before)
  })

  test('停用订阅后回到未生成状态，随后重新生成', async ({ page }) => {
    // revoke() fires window.confirm → accept before the click.
    page.on('dialog', (d) => d.accept())
    await ensureFeed(page)

    await page.getByRole('button', { name: '停用' }).click()
    await expect(page.getByText('已停用订阅')).toBeVisible()
    await expect(page.getByText('尚未生成订阅链接')).toBeVisible()

    // Leave the tenant with a usable feed for later runs/specs.
    await page.getByRole('button', { name: '生成订阅链接' }).click()
    await expect(page.getByText('已生成订阅链接')).toBeVisible()
    await expect(webcalLink(page)).toBeVisible()
  })
})
