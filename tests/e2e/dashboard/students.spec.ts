import { test, expect, type Page } from '../fixtures/test'

// Students area (project `staff`, default owner storageState → full student:* + member:create perms).
// Every test is self-contained: it CREATES its own uniquely-named student and asserts on that row,
// never on global counts (the suite shares one DB, workers:1). Clipboard perms are granted so the
// ExportPanel copy path (navigator.clipboard) succeeds headlessly.
test.use({ contextOptions: { permissions: ['clipboard-read', 'clipboard-write'] } })

// --- spec-local locator helpers (no shared Page Object per AUTHORING.md) ---------------------------
// The page renders two sections: "在读学生（N）" and (conditionally) "已归档（N）", each a <h3> followed
// by a sibling <ul>. Scope row lookups to the right section so an archived row can't be mistaken for
// an active one (both carry the same unique name).
function activeList(page: Page) {
  return page.locator('h3', { hasText: '在读学生' }).locator('xpath=./following-sibling::ul[1]')
}
function archivedList(page: Page) {
  return page.locator('h3', { hasText: '已归档' }).locator('xpath=./following-sibling::ul[1]')
}
function activeRow(page: Page, name: string) {
  return activeList(page).locator('li').filter({ hasText: name })
}

// Fill the always-open top create form (the only open StudentForm on a fresh page → placeholders are
// unique) and assert the new student surfaces in the active list.
async function createStudent(
  page: Page,
  opts: { name: string; wechat?: string; grade?: string },
) {
  await page.getByPlaceholder('姓名').fill(opts.name)
  if (opts.wechat) await page.getByPlaceholder('家长微信').fill(opts.wechat)
  if (opts.grade) await page.getByPlaceholder('年级').fill(opts.grade)
  await page.getByRole('button', { name: '添加学生' }).click()
  await expect(activeList(page).getByText(opts.name)).toBeVisible()
}

test.describe('学生管理', () => {
  test('新建学生后出现在「在读学生」列表', async ({ page }) => {
    const name = `E2E临时-新建-${Date.now()}`
    const wechat = `wx-${Date.now()}`
    await page.goto('/dashboard/users?tab=students')
    await expect(page.getByRole('heading', { name: '学生', exact: true })).toBeVisible()

    await createStudent(page, { name, wechat, grade: '初二' })

    // Assert on OUR row (unique name), including the subtitle we typed — not a global count.
    const row = activeRow(page, name)
    await expect(row).toContainText('初二')
    await expect(row).toContainText(wechat)
  })

  test('编辑学生字段、归档后进入「已归档」、再恢复回「在读学生」', async ({ page }) => {
    const name = `E2E临时-编辑-${Date.now()}`
    const grade = '初一'
    const newWechat = `wx改-${Date.now()}`
    await page.goto('/dashboard/users?tab=students')
    await createStudent(page, { name, wechat: `wx初始-${Date.now()}`, grade })

    // Edit: open the row's inline form, change 家长微信, save. Scope every locator to the row so it
    // never collides with the still-open top create form (which shares the same placeholders).
    const row = activeRow(page, name)
    await row.getByRole('button', { name: '编辑' }).click()
    await row.getByPlaceholder('家长微信').fill(newWechat)
    await row.getByRole('button', { name: '保存', exact: true }).click()
    // Form collapses back to 编辑 and the subtitle reflects the new value.
    await expect(row).toContainText(newWechat)

    // Archive: reopen the form and click 归档 (a plain server action — no window.confirm involved).
    await row.getByRole('button', { name: '编辑' }).click()
    await row.getByRole('button', { name: '归档' }).click()
    // It leaves the active list and shows up (with a 恢复 button) under 已归档.
    await expect(activeList(page).getByText(name)).toHaveCount(0)
    const archivedRow = archivedList(page).locator('li').filter({ hasText: name })
    await expect(archivedRow.getByRole('button', { name: '恢复', exact: true })).toBeVisible()

    // Restore: click 恢复, it returns to the active list.
    await archivedRow.getByRole('button', { name: '恢复', exact: true }).click()
    await expect(activeList(page).getByText(name)).toBeVisible()
  })

  test('为学生生成分享链接（复制成功提示 + 复制分享链接按钮）', async ({ page }) => {
    const name = `E2E临时-分享-${Date.now()}`
    await page.goto('/dashboard/users?tab=students')
    await createStudent(page, { name, grade: '高一' })

    const row = activeRow(page, name)
    // No share yet → the button reads 生成分享链接.
    await row.getByRole('button', { name: '生成分享链接' }).click()

    // Toast (green) confirms creation+copy; router.refresh then swaps the button to 复制分享链接 and
    // renders the /s/<token> URL in a <code>.
    await expect(row.getByText('已生成并复制分享链接')).toBeVisible()
    await expect(row.getByRole('button', { name: '复制分享链接' })).toBeVisible()
    await expect(row.locator('code')).toContainText('/s/')
  })

  test('为学生开通门户登录并显示登录邮箱', async ({ page }) => {
    const name = `E2E临时-开通-${Date.now()}`
    await page.goto('/dashboard/users?tab=students')
    // Fresh, uniquely-named student → the synthesized login email is unique (portal_<nanoid>@…),
    // so this never clashes with the seeded portal accounts.
    await createStudent(page, { name, grade: '初三' })

    const row = activeRow(page, name)
    await row.getByRole('button', { name: '开通登录' }).click()
    // Defaults: kind=家长, 显示名 falls back to the student's name, 登录邮箱 auto-generated. Only the
    // password (≥ 8) is required.
    await row.getByPlaceholder('密码（至少 8 位）').fill('E2ePortalPw1')
    await row.getByRole('button', { name: '开通', exact: true }).click()

    await expect(row.getByText(/已开通！登录邮箱：/)).toBeVisible()
  })
})
