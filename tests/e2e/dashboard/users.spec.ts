import { test, expect, type Page } from '../fixtures/test'

// 用户管理 (/dashboard/users) — owner storageState → full student:* + member:create, so both tabs show.
// Every test is self-contained: it creates its own uniquely-named rows and asserts only on those,
// never on global counts (the suite shares one DB, workers:1).

function portalAccountsList(page: Page) {
  return page.locator('h3', { hasText: '门户账号' }).locator('xpath=./following-sibling::ul[1]')
}
function accountRow(page: Page, name: string) {
  return portalAccountsList(page).locator('li').filter({ hasText: name })
}

test.describe('用户管理', () => {
  test('页面含用户管理标题与学生/家长两个 Tab', async ({ page }) => {
    await page.goto('/dashboard/users')
    await expect(page.getByRole('heading', { name: '用户管理', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: '学生', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: '家长', exact: true })).toBeVisible()
    // Default tab is students → its section heading renders.
    await expect(page.getByRole('heading', { name: '学生', exact: true })).toBeVisible()
  })

  test('家长 Tab 新建门户账号并显示登录邮箱', async ({ page }) => {
    const name = `E2E临时-家长-${Date.now()}`
    await page.goto('/dashboard/users?tab=parents')
    await page.getByRole('button', { name: '新建用户' }).click()
    await page.getByPlaceholder('显示名').fill(name)
    await page.getByPlaceholder('密码（至少 8 位）').fill('E2ePortalPw1')
    await page.getByRole('button', { name: '新建', exact: true }).click()

    await expect(page.getByText(/已新建！登录邮箱：/)).toBeVisible()
    // The new account surfaces in the 门户账号 list (router.refresh re-fetches).
    await expect(accountRow(page, name)).toBeVisible()
  })

  test('把已有学生关联到家长账号，再解绑', async ({ page }) => {
    const parentName = `E2E临时-关联家长-${Date.now()}`
    const studentName = `E2E临时-关联学生-${Date.now()}`

    // 1) Create a uniquely-named student on the students tab.
    await page.goto('/dashboard/users?tab=students')
    await page.getByPlaceholder('姓名').fill(studentName)
    await page.getByRole('button', { name: '添加学生' }).click()
    await expect(page.getByText(studentName)).toBeVisible()

    // 2) Create the parent account on the parents tab.
    await page.goto('/dashboard/users?tab=parents')
    await page.getByRole('button', { name: '新建用户' }).click()
    await page.getByPlaceholder('显示名').fill(parentName)
    await page.getByPlaceholder('密码（至少 8 位）').fill('E2ePortalPw1')
    await page.getByRole('button', { name: '新建', exact: true }).click()
    await expect(page.getByText(/已新建！登录邮箱：/)).toBeVisible()

    // 3) Assign the student to this account via the row's 关联学生 picker.
    const row = accountRow(page, parentName)
    await row.getByLabel('关联学生…').selectOption({ label: studentName })
    await row.getByRole('button', { name: '关联', exact: true }).click()
    await expect(row.getByText(studentName)).toBeVisible()

    // 4) Unlink → the chip disappears from the row.
    await row
      .locator('li')
      .filter({ hasText: studentName })
      .getByRole('button', { name: '解绑' })
      .click()
    await expect(row.locator('li').filter({ hasText: studentName })).toHaveCount(0)
  })
})
