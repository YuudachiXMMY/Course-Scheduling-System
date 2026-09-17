import { test, expect, type Page } from '../fixtures/test'

// 用户管理 (/dashboard/users) — owner storageState → member:create, so all four management tabs show
// (owner also passes the admin+ page gate). Every test is self-contained: it creates its own uniquely-named
// rows and asserts only on those, never on global counts (the suite shares one DB, workers:1).

function portalAccountsList(page: Page) {
  return page.locator('h3', { hasText: '门户账号' }).locator('xpath=./following-sibling::ul[1]')
}
function accountRow(page: Page, name: string) {
  return portalAccountsList(page).locator('li').filter({ hasText: name })
}
function teachersList(page: Page) {
  return page.locator('h3', { hasText: '教师 / 助教' }).locator('xpath=./following-sibling::ul[1]')
}

test.describe('用户管理', () => {
  test('页面含用户管理标题与学生/家长/教师/管理员四个 Tab', async ({ page }) => {
    await page.goto('/dashboard/users')
    await expect(page.getByRole('heading', { name: '用户管理', exact: true })).toBeVisible()
    for (const tab of ['学生', '家长', '教师', '管理员']) {
      await expect(page.getByRole('link', { name: tab, exact: true })).toBeVisible()
    }
    // Default tab is students → its section heading renders.
    await expect(page.getByRole('heading', { name: '学生', exact: true })).toBeVisible()
  })

  test('教师 Tab 新建教师账号并显示登录邮箱', async ({ page }) => {
    const name = `E2E临时-教师-${Date.now()}`
    const email = `e2e_teacher_${Date.now()}@x.com`
    await page.goto('/dashboard/users?tab=teachers')
    await page.getByRole('button', { name: '新建账号' }).click()
    await page.getByPlaceholder('显示名').fill(name)
    await page.getByPlaceholder('登录邮箱').fill(email)
    await page.getByPlaceholder('密码（至少 8 位）').fill('E2eStaffPw1')
    await page.getByRole('button', { name: '新建', exact: true }).click()

    await expect(page.getByText(/已新建账号！登录邮箱：/)).toBeVisible()
    // The new teacher surfaces in the 教师 / 助教 list (router.refresh re-fetches).
    await expect(teachersList(page).locator('li').filter({ hasText: name })).toBeVisible()
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
