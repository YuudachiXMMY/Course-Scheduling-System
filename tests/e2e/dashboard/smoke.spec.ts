import { test, expect } from '../fixtures/test'

// Staff-area smoke: proves the owner storageState grants /dashboard access and the nav renders.
test.describe('Dashboard 入口冒烟', () => {
  test('owner 登录态可进入 /dashboard 且导航齐全', async ({ page }) => {
    await page.goto('/dashboard')
    await expect(page).toHaveURL(/\/dashboard/)
    await expect(page.getByRole('heading', { name: '仪表盘' })).toBeVisible()

    const nav = [
      { name: '排课', href: '/dashboard/schedule' },
      { name: '用户管理', href: '/dashboard/users' },
      { name: '课程', href: '/dashboard/courses' },
      { name: '报告', href: '/dashboard/reports' },
      { name: '改期申请', href: '/dashboard/reschedule' },
      { name: '日历订阅', href: '/dashboard/calendar' },
    ]
    for (const link of nav) {
      await expect(page.getByRole('link', { name: link.name })).toHaveAttribute('href', link.href)
    }
  })
})
