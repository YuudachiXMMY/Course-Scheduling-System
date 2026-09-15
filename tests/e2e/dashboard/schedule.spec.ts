import { test, expect } from '../fixtures/test'
import type { Page } from '@playwright/test'

// Dashboard schedule (project `staff`, default owner storageState → has lesson:list/create/update).
// The page renders a FullCalendar (src/app/dashboard/schedule/calendar.tsx) over seeded lessons that
// are anchored around "now" (term = now-10d … now+6w), so events land inside the calendar's window.
//
// We DELIBERATELY avoid the fragile drag-to-create flow (FullCalendar timegrid selection is timing/
// pixel sensitive) and instead exercise the robust, seeded read/write paths: opening a lesson drawer,
// marking attendance, and saving the shared note. Assertions target visible UI changes (the drawer,
// the green success message), never global counts.
test.describe('排课日历', () => {
  // Native alerts fire on drag-create with no section / on schedule conflicts. We never trigger those
  // here, but registering a handler up front keeps the test from hanging if one ever surfaces.
  test.beforeEach(async ({ page }) => {
    page.on('dialog', (d) => d.accept())
  })

  test('日历加载：显示「排课」标题、FullCalendar 网格与班级选择器', async ({ page }) => {
    await page.goto('/dashboard/schedule')
    await expect(page.getByRole('heading', { name: '排课', exact: true })).toBeVisible()
    // FullCalendar's root has the `.fc` class once the client component has hydrated & rendered.
    await expect(page.locator('.fc').first()).toBeVisible()
    // The "拖拽新建课节的班级" select (opaque widget → uses the E2E testid).
    await expect(page.getByTestId('section-select')).toBeVisible()
  })

  test('打开已排课节抽屉并记录出勤', async ({ page }) => {
    await openFirstLessonDrawer(page)

    // Wait for the drawer's roster/notes/meta fetch to settle (the "加载中…" hint clears on load).
    await expect(page.getByText('加载中…')).toBeHidden()

    const rows = page.getByTestId('attendance-row')
    const rowCount = await rows.count()

    if (rowCount > 0) {
      // Mark the first rostered student present → the drawer shows a green "已保存出勤" confirmation.
      await rows.first().getByRole('button', { name: '出勤', exact: true }).click()
      await expect(page.getByText('已保存出勤')).toBeVisible()
    } else {
      // Some seeded lesson's section may have no active enrollment; just prove the drawer opened,
      // then close it (per the "该班级暂无在读学生" branch in lesson-detail.tsx).
      await expect(page.getByText('该班级暂无在读学生')).toBeVisible()
    }

    // Close via the explicit 关闭 button and confirm the drawer is gone.
    await page.getByRole('button', { name: '关闭' }).click()
    await expect(page.getByTestId('lesson-detail-drawer')).toHaveCount(0)
  })

  test('在抽屉内保存本节课共享笔记', async ({ page }) => {
    await openFirstLessonDrawer(page)

    // Wait for the notes fetch to populate the textarea BEFORE typing — otherwise the effect's
    // setSharedNote() would overwrite our input (controlled component race).
    await expect(page.getByText('加载中…')).toBeHidden()

    // Unique content so repeated/overlapping runs never collide; we assert on the toast, not the body.
    const noteBody = `E2E临时笔记-${Date.now()}`
    await page.getByPlaceholder('今天讲了…').fill(noteBody)
    await page.getByRole('button', { name: '保存笔记', exact: true }).click()

    // saveShared() sets msg='已保存本节课笔记' after the server action resolves (attendance-actions.ts).
    await expect(page.getByText('已保存本节课笔记')).toBeVisible()

    await page.getByRole('button', { name: '关闭' }).click()
    await expect(page.getByTestId('lesson-detail-drawer')).toHaveCount(0)
  })
})

/**
 * Navigate to the schedule, switch FullCalendar to month view (surfaces every seeded event as a
 * clickable block — no dayMaxEvents collapsing is configured), then open the first lesson's detail
 * drawer. Returns the drawer locator. The seed guarantees section A has lessons around now, and the
 * calendar's initialDate is the first event's start, so month view always contains at least one event.
 */
async function openFirstLessonDrawer(page: Page) {
  await page.goto('/dashboard/schedule')
  await expect(page.locator('.fc').first()).toBeVisible()

  // FullCalendar toolbar buttons have no stable role/text → target the view button by class.
  await page.locator('.fc-dayGridMonth-button').click()

  // Each mounted event gets a `calendar-event-<lessonId>` testid via eventDidMount (calendar.tsx).
  const firstEvent = page.locator('[data-testid^="calendar-event-"]').first()
  await expect(firstEvent).toBeVisible()
  await firstEvent.click()

  const drawer = page.getByTestId('lesson-detail-drawer')
  await expect(drawer).toBeVisible()
  await expect(page.getByRole('heading', { name: '课节详情' })).toBeVisible()
  return drawer
}
