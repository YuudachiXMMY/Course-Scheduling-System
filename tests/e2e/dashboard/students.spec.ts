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
// Anchor a row on its TITLE (the font-medium student-name span), not on arbitrary row text. After 开通,
// a student login is named after the student and then appears as an <option> in EVERY other row's 关联
// picker — a native <select>'s option text counts toward the <li>'s textContent, so a plain
// `filter({ hasText: name })` would also match those rows (strict-mode violation). Only the owning row
// carries the name in a `.font-medium` heading span; <option>s are not spans, so this excludes them.
function activeRow(page: Page, name: string) {
  return activeList(page)
    .locator(':scope > li')
    .filter({ has: page.locator('span.font-medium', { hasText: name }) })
}

// Fill the always-open top create form (the only open StudentForm on a fresh page → placeholders are
// unique) and assert the new student surfaces in the active list.
async function createStudent(page: Page, opts: { name: string; wechat?: string; grade?: string }) {
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

  test('为学生开通「学生门户账号」，登录状态合并显示在学生行内', async ({ page }) => {
    const name = `E2E临时-开通-${Date.now()}`
    await page.goto('/dashboard/users?tab=students')
    // Fresh, uniquely-named student → the synthesized login email is unique (portal_<nanoid>@…),
    // so this never clashes with the seeded portal accounts.
    await createStudent(page, { name, grade: '初三' })

    const row = activeRow(page, name)
    // 合并后：学生行不再有单独的「学生门户账号」列表，登录状态就在行内。开通前显示「未开通」。
    await expect(row.getByText('学生登录：未开通')).toBeVisible()

    // 学生行的开通入口固定创建 student 账号（无账号类型下拉）；显示名默认学生名、登录邮箱自动生成，
    // 只需填密码（≥ 8）。
    await row.getByRole('button', { name: '开通学生门户账号' }).click()
    await row.getByPlaceholder('密码（至少 8 位）').fill('E2ePortalPw1')
    await row.getByRole('button', { name: '开通', exact: true }).click()

    // 核心新行为：开通成功后 router.refresh，学生行从「未开通+开通表单」切换到「已开通」分支——登录邮箱
    // 持久合并展示在该学生行内（不再是顶部独立账号列表；比原先的瞬时提示更持久，导师可随时复制转交），
    // 并就地提供重置密码入口。合成邮箱形如 portal_<nanoid>@<域名>。
    await expect(row.getByText(/学生登录：\s*portal_.*@/)).toBeVisible()
    await expect(row.getByRole('button', { name: '重置密码' })).toBeVisible()
    // 合并后不再出现「未开通」文案。
    await expect(row.getByText('学生登录：未开通')).toHaveCount(0)
  })
})
