import type { Page, Locator } from '@playwright/test'

// Page Object for /login (src/app/(auth)/login/page.tsx). Fields are <label>-wrapped inputs (no
// data-testid), so we locate by their exact Chinese label text.
export class LoginPage {
  readonly page: Page
  readonly heading: Locator
  readonly email: Locator
  readonly password: Locator
  readonly submit: Locator
  readonly signupLink: Locator

  constructor(page: Page) {
    this.page = page
    this.heading = page.getByRole('heading', { name: '登录' })
    this.email = page.getByLabel('邮箱')
    this.password = page.getByLabel('密码')
    this.submit = page.getByRole('button', { name: '登录' })
    this.signupLink = page.getByRole('link', { name: '注册' })
  }

  async goto() {
    await this.page.goto('/login')
  }

  async fill(email: string, password: string) {
    await this.email.fill(email)
    await this.password.fill(password)
  }

  /**
   * Sign in and wait to land on the role dispatcher's destination (/dashboard or /portal).
   * Only call with VALID credentials. Retries on failure to absorb Better Auth's production sign-in
   * rate limiter (short window), which storageState minting + other auth specs can trip.
   */
  async login(email: string, password: string) {
    const maxAttempts = 4
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await this.fill(email, password)
      // Capture the sign-in response so a retry can honor Better Auth's actual rate-limit backoff
      // (X-Retry-After) instead of blindly sleeping a fixed, guessed window.
      const responsePromise = this.page
        .waitForResponse((r) => r.url().includes('/api/auth/sign-in/email'), { timeout: 12_000 })
        .catch(() => null)
      await this.submit.click()
      try {
        await this.page.waitForURL(/\/(dashboard|portal)/, { timeout: 12_000 })
        return
      } catch {
        if (attempt === maxAttempts) {
          const err = await this.page
            .locator('p.text-red-600')
            .textContent()
            .catch(() => null)
          throw new Error(
            `login did not navigate after ${maxAttempts} attempts (last error: ${err ?? 'none'})`,
          )
        }
        // Throttled → wait exactly X-Retry-After (+1s); otherwise a brief pause before retrying.
        const res = await responsePromise
        const retryAfter = res?.status() === 429 ? Number(res.headers()['x-retry-after']) || 10 : 2
        await this.page.waitForTimeout((retryAfter + 1) * 1000)
      }
    }
  }
}
