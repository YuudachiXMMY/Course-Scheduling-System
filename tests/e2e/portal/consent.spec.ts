import { test, expect } from '../fixtures/test'
import { authStatePath } from '../fixtures/seed-constants'

// First-login consent gate (P7a-9). `parentNoConsent` is signed in but has NO portalLink.consentedAt
// stamp, so the portal shell (src/app/portal/layout.tsx) renders <ConsentGate/> in place of the page.
// Acknowledging stamps consentedAt server-side and the gate never reappears.
//
// NOTE: this is the ONLY spec that uses `parentNoConsent`. Accepting here consents the account for the
// rest of the run — that is intentional; a re-seed resets it. This account is linked to studentB.
test.describe('Portal 首登同意门', () => {
  test.use({ storageState: authStatePath('parentNoConsent') })

  test('未同意家长首访 /portal 命中同意门，同意后进入「课表」', async ({ page, seed }) => {
    await page.goto('/portal')

    // The consent gate blocks content: heading + acknowledge button, and NO schedule yet.
    await expect(page.getByRole('heading', { name: '数据处理告知与同意' })).toBeVisible()
    const acknowledge = page.getByRole('button', { name: '我已阅读并同意' })
    await expect(acknowledge).toBeVisible()
    await expect(page.getByRole('heading', { name: '课表' })).toHaveCount(0)

    // Acknowledge → server action stamps consentedAt → router.refresh() swaps the gate for the page.
    await acknowledge.click()

    // Gate is gone and the linked student's (studentB) schedule now renders.
    await expect(page.getByRole('heading', { name: '数据处理告知与同意' })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: '课表' })).toBeVisible()
    await expect(
      page.getByTestId('schedule-card').filter({ hasText: `${seed.studentB.name} 的课表` }),
    ).toBeVisible()
  })
})
