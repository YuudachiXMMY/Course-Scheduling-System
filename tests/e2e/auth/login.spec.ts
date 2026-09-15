import { test, expect } from '../fixtures/test'
import { E2E_ACCOUNTS } from '../fixtures/seed-constants'
import { LoginPage } from '../pages/login.page'

// Foundation smoke: proves seeding + login + role dispatch end-to-end. If this fails, the whole E2E
// harness (global-setup, seed, storageState) is misconfigured — fix it before anything else.
test.describe('登录与角色分发', () => {
  test('教职工(owner)登录后进入 /dashboard', async ({ page }) => {
    const login = new LoginPage(page)
    await login.goto()
    await expect(login.heading).toBeVisible()
    await login.login(E2E_ACCOUNTS.owner.email, E2E_ACCOUNTS.owner.password)
    await expect(page).toHaveURL(/\/dashboard/)
    await expect(page.getByRole('heading', { name: '仪表盘' })).toBeVisible()
  })

  test('家长(consented)登录后进入 /portal 并看到「我的课表」', async ({ page }) => {
    const login = new LoginPage(page)
    await login.goto()
    await login.login(E2E_ACCOUNTS.parent.email, E2E_ACCOUNTS.parent.password)
    await expect(page).toHaveURL(/\/portal/)
    await expect(page.getByRole('heading', { name: '我的课表' })).toBeVisible()
  })

  test('密码错误时停留在 /login 并显示错误', async ({ page }) => {
    const login = new LoginPage(page)
    await login.goto()
    await login.fill(E2E_ACCOUNTS.owner.email, 'wrong-password-xxxx')
    await login.submit.click()
    // Better Auth is not localized → message is English ("Invalid email or password"). Assert the
    // error styling is shown and we did NOT navigate away, rather than pinning the exact copy.
    await expect(page.locator('p.text-red-600')).toBeVisible()
    await expect(page).toHaveURL(/\/login/)
  })
})
