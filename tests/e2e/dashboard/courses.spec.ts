import { test, expect, type Page } from '../fixtures/test'

// Courses area (project `staff`, default owner storageState → full course:* + lesson:create +
// enrollment perms). The four steps chain (create course → add a section in it → enroll a student →
// archive/restore), so they run `serial` against the shared backend (workers:1). Names are timestamped
// once so re-runs and other specs never collide, and each step asserts on ITS OWN row, never a global
// count. Course/section mutations here are plain Server Actions (POST current URL + Next-Action) — we
// assert on the resulting visible UI change, not a semantic REST response.
const stamp = Date.now()
const courseTitle = `E2E临时课程-${stamp}`
const sectionName = `E2E临时班级-${stamp}`
const CAPACITY = 5

// --- spec-local locator helpers (no shared Page Object per AUTHORING.md) ---------------------------
// An active course renders as a bordered `p-4` card containing its <h3> title. The always-open top
// create form and the inline edit form share the same classes but carry NO course-title text, so
// filtering by the unique title pins exactly the card we created.
function courseCard(page: Page) {
  return page
    .locator('div.rounded-lg.border.border-neutral-200.p-4')
    .filter({ hasText: courseTitle })
}

function todayISODate(): string {
  // term start = today; leaving 学期结束 empty gives materializeSection a +16-week horizon, so at least
  // one weekly occurrence is guaranteed to generate regardless of which weekday we pick.
  return new Date().toISOString().slice(0, 10)
}

test.describe.serial('课程管理（课程 / 班级 / 花名册 / 归档恢复）', () => {
  test('创建课程：顶部表单填写唯一名称 → 添加课程，课程卡片出现', async ({ page }) => {
    await page.goto('/dashboard/courses')
    await expect(page.getByRole('heading', { name: '课程', exact: true })).toBeVisible()

    // On a fresh page only the top create form is open (existing courses collapse to an 编辑 button),
    // so the placeholder + 添加课程 button are unique.
    await page.getByPlaceholder('课程名称（如 高一数学）').fill(courseTitle)
    await page.getByRole('button', { name: '添加课程' }).click()

    await expect(page.getByRole('heading', { name: courseTitle, exact: true })).toBeVisible()
  })

  test('新建班级：班级名 + 时段(周三/时间/时长) + 容量 + 学期开始 → 生成课节', async ({ page }) => {
    await page.goto('/dashboard/courses')
    const card = courseCard(page)

    await card.getByRole('button', { name: '+ 新建班级' }).click()
    await card.getByPlaceholder('班级名称（如 周一班）').fill(sectionName)

    // One meeting slot. 周三(WE) @ 07:00, default 60 分 — an early, unusual slot to steer clear of any
    // teacher lessons the owner might collide with (a conflict would just skip that occurrence).
    // Target the weekday select by its accessible name (含「星期」) rather than positional .first():
    // CR2 added a 授课教师 <select> before the meeting rows for whole-tenant actors (owner runs this
    // spec), so .first() would now land on the teacher picker and time out on the missing 'WE' option.
    await card.getByRole('combobox', { name: /星期/ }).first().selectOption('WE')
    await card.locator('input[type="time"]').first().fill('07:00')
    await card
      .locator('label')
      .filter({ hasText: '容量' })
      .getByRole('spinbutton')
      .fill(String(CAPACITY))
    // 学期开始 is required (first date input); 学期结束 (second) left blank.
    await card.locator('input[type="date"]').first().fill(todayISODate())

    await card.getByRole('button', { name: '创建并生成课节' }).click()

    // The green status line confirms lessons materialized; horizon guarantees a non-zero count.
    await expect(card.getByText(/已生成 \d+ 节课/)).toBeVisible({ timeout: 15_000 })
  })

  test('管理学生：从「选择学生…」下拉选中已有学生 → 添加，花名册计数与姓名更新', async ({
    page,
    seed,
  }) => {
    await page.goto('/dashboard/courses')
    // Scope everything to the new section's list row so it never collides with the course card header
    // or other sections.
    const row = courseCard(page).locator('li').filter({ hasText: sectionName })

    await row.getByRole('button', { name: '管理学生' }).click()
    // Pick seeded student A — active and not yet enrolled in this brand-new section, so it's offered.
    await row.getByRole('combobox').selectOption({ label: seed.studentA.name })
    await row.getByRole('button', { name: '添加', exact: true }).click()

    // Roster count reflects the enrollment and the student's name shows in the in-读 list.
    await expect(row.getByText(`在读学生 1/${CAPACITY}`)).toBeVisible()
    await expect(row.getByText(seed.studentA.name)).toBeVisible()
  })

  test('归档与恢复课程：编辑 → 归档进入「已归档」→ 恢复回「在读」', async ({ page }) => {
    // archiveCourse/restoreCourse are plain Server Actions today (no window.confirm), but AUTHORING
    // lists archive under confirm-driven flows — register an accept handler defensively so this can't
    // hang if a confirm is ever added.
    page.on('dialog', (d) => d.accept())

    await page.goto('/dashboard/courses')
    const card = courseCard(page)

    // The course 编辑 lives in the card header (`div.mb-2`); section rows also render 编辑 in the <ul>,
    // so scope to the header to hit the course's edit form.
    await card.locator('div.mb-2').getByRole('button', { name: '编辑' }).click()
    await card.getByRole('button', { name: '归档' }).click()

    // Course leaves the active cards and appears in 已归档 with a 恢复 button.
    const archivedRow = page.locator('li').filter({ hasText: courseTitle })
    await expect(archivedRow.getByRole('button', { name: '恢复', exact: true })).toBeVisible()

    await archivedRow.getByRole('button', { name: '恢复', exact: true }).click()

    // Restored → the active card heading is back and no archived row for it remains.
    await expect(page.getByRole('heading', { name: courseTitle, exact: true })).toBeVisible()
    await expect(page.locator('li').filter({ hasText: courseTitle })).toHaveCount(0)
  })
})
