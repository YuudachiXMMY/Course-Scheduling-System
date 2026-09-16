import { test, expect } from '../fixtures/test'

// 班级工作台「排课」tab 的行内笔记/点评/成绩编辑 (project `staff`, default owner storageState → has
// lesson:update). Section A is seeded with lessons around "now" and an active enrollment for student A,
// so its 排课 list renders at least one lesson row with a rostered student. We open a lesson's inline
// editor, save the shared Summary, then (if a student row is present) a 点评 and a 成绩, asserting on the
// green success flash — never on global counts. Mirrors schedule.spec.ts.
test.describe('班级工作台 · 排课行内笔记点评', () => {
  test.beforeEach(async ({ page }) => {
    // Defensive: no native dialogs are expected here, but a registered handler keeps the run from
    // hanging if one ever surfaces (same rationale as schedule.spec.ts).
    page.on('dialog', (d) => d.accept())
  })

  test('展开课节 → 保存 Summary / 点评 / 成绩', async ({ page, seed }) => {
    await page.goto(`/dashboard/teach/${seed.sectionA.id}?tab=lessons`)

    // The inline editor's toggle appears on every lesson row; open the first one.
    const toggle = page.getByRole('button', { name: /笔记点评/ }).first()
    await expect(toggle).toBeVisible()
    await toggle.click()

    // Inline state is SSR-seeded via useState initializer (no client fetch), so there is no
    // controlled-component race — we can type immediately after the editor renders.
    const summary = page.getByPlaceholder('今天讲了…')
    await expect(summary).toBeVisible()
    await summary.fill(`E2E排课笔记-${Date.now()}`)
    await page.getByRole('button', { name: '保存笔记', exact: true }).click()
    await expect(page.getByText('已保存本节课笔记')).toBeVisible()

    // Section A has an active enrollment → at least one student row with 点评 + 成绩.
    const studentRows = page.getByTestId('lesson-note-student')
    if ((await studentRows.count()) > 0) {
      const row = studentRows.first()

      await row.locator('textarea').fill(`E2E点评-${Date.now()}`)
      await row.getByRole('button', { name: '保存点评', exact: true }).click()
      await expect(page.getByText('已保存点评')).toBeVisible()

      await row.getByPlaceholder('分数').fill('88')
      await row.getByPlaceholder('满分').fill('100')
      await row.getByRole('button', { name: '保存成绩', exact: true }).click()
      await expect(page.getByText('已保存成绩')).toBeVisible()
    }
  })
})
