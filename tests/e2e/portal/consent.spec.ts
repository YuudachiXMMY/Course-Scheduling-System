import { test, expect } from '../fixtures/test'
import { authStatePath } from '../fixtures/seed-constants'

// First-login consent notice (P7a-9, now Ontario/PIPEDA). `parentNoConsent` is signed in but has NO
// portalLink.consentedAt stamp, so the portal shell (src/app/portal/layout.tsx) renders <ConsentGate/>
// — a small modal window (role="dialog") — in place of the page.
//
// New behavior: the modal is closable. Closing it (× / Esc) counts as implied consent, exactly like
// the "我已阅读并同意" button: the server stamps consentedAt and the notice never reappears. We assert
// the × (implied-consent) path end to end because that is what changed; the agree button calls the
// same acknowledgeConsent server action.
//
// NOTE: this is the ONLY spec that uses `parentNoConsent`. Dismissing the notice here consents the
// account for the rest of the run — that is intentional; a re-seed resets it. This account is linked
// to studentB.
test.describe('Portal 首登数据处理告知（安省/PIPEDA 小窗）', () => {
  test.use({ storageState: authStatePath('parentNoConsent') })

  test('未同意家长首访 /portal 命中小窗；关闭（隐含同意）后进入「课表」', async ({
    page,
    seed,
  }) => {
    await page.goto('/portal')

    // The notice renders as a small modal window that blocks portal content.
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('heading', { name: '数据处理告知与同意' })).toBeVisible()

    // Both controls are present: the explicit agree button AND a close (×) that means implied consent.
    await expect(dialog.getByRole('button', { name: '我已阅读并同意' })).toBeVisible()
    const close = dialog.getByRole('button', { name: /关闭/ })
    await expect(close).toBeVisible()

    // Until the user acts, the underlying page content is still gated (server requireConsent).
    await expect(page.getByRole('heading', { name: '课表' })).toHaveCount(0)

    // Closing (×) = implied consent → acknowledgeConsent stamps consentedAt → router.refresh() reveals
    // the page. The modal is gone and the linked student's (studentB) schedule now renders.
    await close.click()

    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByRole('heading', { name: '课表' })).toBeVisible()
    await expect(
      page.getByTestId('schedule-card').filter({ hasText: `${seed.studentB.name} 的课表` }),
    ).toBeVisible()
  })
})
