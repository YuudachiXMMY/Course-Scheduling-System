import { test, expect } from '../fixtures/test'
import { E2E_ACCOUNTS } from '../fixtures/seed-constants'
import { LoginPage } from '../pages/login.page'

// Logout + protected-route redirects (project auth-flows). The 「退出登录」button (src/app/dashboard/
// logout-button.tsx, reused by both dashboard + portal layouts) clears the Better Auth session then
// pushes /login. The dashboard/portal layout guards redirect any unauthenticated request to /login.

test.describe('退出登录', () => {
  // Log in FRESH (a dedicated session) rather than reusing the shared owner storageState — signing out
  // deletes the session server-side, which would otherwise invalidate every other staff spec's cookie.
  test('教职工(owner)点击「退出登录」后回到 /login', async ({ page }) => {
    const login = new LoginPage(page)
    await login.goto()
    await login.login(E2E_ACCOUNTS.owner.email, E2E_ACCOUNTS.owner.password)
    await page.goto('/dashboard')
    await expect(page.getByRole('heading', { name: '仪表盘' })).toBeVisible()

    await page.getByRole('button', { name: '退出登录', exact: true }).click()
    await expect(page).toHaveURL(/\/login/)
  })
})

test.describe('未登录访问受保护路由被重定向', () => {
  // Explicitly drop all auth so these run signed-out regardless of project defaults.
  test.use({ storageState: { cookies: [], origins: [] } })

  test('未登录访问 /dashboard 重定向到 /login', async ({ page }) => {
    await page.goto('/dashboard')
    await expect(page).toHaveURL(/\/login/)
  })

  test('未登录访问 /portal 重定向到 /login', async ({ page }) => {
    await page.goto('/portal')
    await expect(page).toHaveURL(/\/login/)
  })
})
