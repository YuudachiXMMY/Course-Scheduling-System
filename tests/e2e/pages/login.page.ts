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
        await this.page.waitForTimeout(11_000) // wait out the rate-limit window, then retry
      }
    }
  }
}
