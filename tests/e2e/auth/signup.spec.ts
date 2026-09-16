import { test, expect } from '../fixtures/test'
import { E2E_ACCOUNTS } from '../fixtures/seed-constants'

// Sign-up flow (project auth-flows, no storageState). The form is <label>-wrapped inputs (locate by
// exact Chinese label text) posting via authClient.signUp.email → /api/auth/sign-up/email, which
// Better Auth rate-limits in production. The happy path therefore retries around that short window.
// src/app/(auth)/signup/page.tsx: 姓名/邮箱/密码 inputs, 「注册」submit, red <p> on error, minLength=8.
test.describe('注册', () => {
  test('happy path: 填写有效信息注册后进入 /dashboard', async ({ page }) => {
    // Email MUST be unique per run so re-runs don't collide with a previously-created account.
    const email = `e2e-signup-${Date.now()}@e2e.local`
    const name = `E2E注册-${Date.now()}`
    const password = 'E2eSignup123!' // ≥ 8 chars

    await page.goto('/signup')
    await expect(page.getByRole('heading', { name: '注册' })).toBeVisible()

    // Inline retry: on rate-limit the request is throttled and NO account is created, so re-submitting
    // the same email is safe. Wait out the ~fixed window (11s) between attempts, up to 4 tries.
    const maxAttempts = 4
    let landed = false
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await page.getByLabel('姓名').fill(name)
      await page.getByLabel('邮箱').fill(email)
      await page.getByLabel('密码').fill(password)
      // Capture the sign-up response so a retry honors the real rate-limit backoff (X-Retry-After)
      // rather than sleeping a fixed, guessed window.
      const responsePromise = page
        .waitForResponse((r) => r.url().includes('/api/auth/sign-up/email'), { timeout: 12_000 })
        .catch(() => null)
      await page.getByRole('button', { name: '注册', exact: true }).click()
      try {
        await page.waitForURL(/\/dashboard/, { timeout: 12_000 })
        landed = true
        break
      } catch {
        if (attempt === maxAttempts) break
        // Throttled → wait exactly X-Retry-After (+1s); otherwise a brief pause before retrying.
        const res = await responsePromise
        const retryAfter = res?.status() === 429 ? Number(res.headers()['x-retry-after']) || 10 : 2
        await page.waitForTimeout((retryAfter + 1) * 1000)
      }
    }

    expect(landed).toBe(true)
    await expect(page).toHaveURL(/\/dashboard/)
  })

  test('重复邮箱: 使用已存在的账号邮箱注册失败并停留在 /signup', async ({ page }) => {
    await page.goto('/signup')
    await expect(page.getByRole('heading', { name: '注册' })).toBeVisible()

    await page.getByLabel('姓名').fill(`E2E重复-${Date.now()}`)
    await page.getByLabel('邮箱').fill(E2E_ACCOUNTS.owner.email) // already seeded → sign-up rejected
    await page.getByLabel('密码').fill('E2eSignup123!')

    // Submit, retrying past any rate-limit (429) so we assert on the REAL duplicate rejection — not the
    // same red <p> a throttled response would also produce (that would pass for the wrong reason).
    let status = 0
    let body = ''
    const maxAttempts = 4
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const responsePromise = page.waitForResponse((r) =>
        r.url().includes('/api/auth/sign-up/email'),
      )
      await page.getByRole('button', { name: '注册', exact: true }).click()
      const res = await responsePromise
      status = res.status()
      body = await res.text()
      if (status !== 429 || attempt === maxAttempts) break
      const retryAfter = Number(res.headers()['x-retry-after']) || 10
      await page.waitForTimeout((retryAfter + 1) * 1000)
    }

    // A genuine duplicate is a 4xx that names the conflict — NOT a 429 rate-limit. Better Auth is not
    // localized, so we match on the response (status + code/message) rather than the rendered copy.
    expect(status, `expected duplicate-email rejection, got ${status}`).not.toBe(429)
    expect(status).toBeGreaterThanOrEqual(400)
    expect(status).toBeLessThan(500)
    expect(body.toLowerCase()).toMatch(/exist|already|unique/)
    await expect(page.locator('p.text-red-600')).toBeVisible()
    await expect(page).toHaveURL(/\/signup/)
  })

  test('密码过短: 少于 8 位被浏览器原生校验拦截，停留在 /signup', async ({ page }) => {
    await page.goto('/signup')
    await expect(page.getByRole('heading', { name: '注册' })).toBeVisible()

    await page.getByLabel('姓名').fill(`E2E短密码-${Date.now()}`)
    await page.getByLabel('邮箱').fill(`e2e-signup-short-${Date.now()}@e2e.local`)
    await page.getByLabel('密码').fill('short12') // 7 chars < minLength=8

    const passwordInput = page.getByLabel('密码')
    await page.getByRole('button', { name: '注册', exact: true }).click()

    // HTML5 minLength blocks form submission client-side (no request, no app error). We stay put and
    // the field reports as invalid.
    await expect(page).toHaveURL(/\/signup/)
    const valid = await passwordInput.evaluate((el) => (el as HTMLInputElement).checkValidity())
    expect(valid).toBe(false)
  })
})
