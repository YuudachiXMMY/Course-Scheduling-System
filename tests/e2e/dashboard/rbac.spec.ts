import { test, expect } from '../fixtures/test'
import { authStatePath } from '../fixtures/seed-constants'

// Role-based access control at the layout/dispatcher boundary. These are UX-level guards
// (src/app/dashboard/layout.tsx, src/app/portal/layout.tsx, src/app/page.tsx): staff roles
// belong in /dashboard, portal roles (parent/student) belong in /portal, and the root path
// dispatches each role to its home. Real authorization is re-checked per action; here we only
// assert the redirect/access behaviour of the shells.

test.describe('RBAC — 教职工可访问 /dashboard', () => {
  test.describe('教师(teacher)', () => {
    test.use({ storageState: authStatePath('teacher') })

    test('teacher 登录态可进入 /dashboard 且不被重定向', async ({ page }) => {
      await page.goto('/dashboard')
      await expect(page).toHaveURL(/\/dashboard/)
      await expect(page.getByRole('heading', { name: '仪表盘' })).toBeVisible()
    })
  })

  test.describe('管理员(admin)', () => {
    test.use({ storageState: authStatePath('admin') })

    test('admin 登录态可进入 /dashboard 且不被重定向', async ({ page }) => {
      await page.goto('/dashboard')
      await expect(page).toHaveURL(/\/dashboard/)
      await expect(page.getByRole('heading', { name: '仪表盘' })).toBeVisible()
    })
  })
})

test.describe('RBAC — 门户角色被挡在 /dashboard 外', () => {
  test.use({ storageState: authStatePath('parent') })

  test('parent 访问 /dashboard 被重定向到 /portal', async ({ page }) => {
    await page.goto('/dashboard')
    await expect(page).toHaveURL(/\/portal/)
    // The staff heading must NOT be present after the redirect.
    await expect(page.getByRole('heading', { name: '仪表盘' })).toHaveCount(0)
  })
})

test.describe('RBAC — 根路径角色分发', () => {
  test.describe('教职工(owner)', () => {
    test.use({ storageState: authStatePath('owner') })

    test('owner 访问 / 被分发到 /dashboard', async ({ page }) => {
      await page.goto('/')
      await expect(page).toHaveURL(/\/dashboard/)
      await expect(page.getByRole('heading', { name: '仪表盘' })).toBeVisible()
    })
  })

  test.describe('家长(parent)', () => {
    test.use({ storageState: authStatePath('parent') })

    test('parent 访问 / 被分发到 /portal', async ({ page }) => {
      await page.goto('/')
      await expect(page).toHaveURL(/\/portal/)
      await expect(page.getByRole('heading', { name: '课表' })).toBeVisible()
    })
  })
})
