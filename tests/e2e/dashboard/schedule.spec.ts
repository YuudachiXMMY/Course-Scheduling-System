import { test, expect } from '../fixtures/test'
import type { Page } from '@playwright/test'
import { DateTime } from 'luxon'

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

  // 时区一致性：日历事件必须按 America/Toronto（APP_TIME_ZONE，见 src/lib/timezone.ts）渲染其上课时间，
  // 与应用其它所有面（formatDateTime / schedule-card / 门户 / 报告，均 luxon setZone(Toronto)）一致。
  // FullCalendar 原生 Date 无法计算命名时区偏移；若未注册 @fullcalendar/luxon3 时区插件，命名时区会
  // 静默回退为 UTC 强制渲染（官方文档 "faked in UTC"）→ 日历显示 UTC 时间，与实际课程时间不统一。
  // 该用例用一条已知 UTC 瞬时的种子课节，断言事件块显示的时间等于其多伦多 wall-clock，从而在插件缺失
  // （UTC 回退）时失败、注册后通过。
  test('日历事件按多伦多时区渲染上课时间（而非 UTC 回退）', async ({ page, seed }) => {
    const lessonId = seed.lessons.studentAFutureLessonId
    const startISO = seed.lessons.studentAFutureStartAt
    test.skip(!lessonId || !startISO, '本次种子未生成 A 班未来课节')

    const start = DateTime.fromISO(startISO!, { zone: 'utc' })
    const torontoTime = start.setZone('America/Toronto').toFormat('HH:mm')
    const utcTime = start.toFormat('HH:mm')
    // 前提校验：种子瞬时距午夜足够远，使多伦多 wall-clock ≠ UTC wall-clock，断言才真正能区分
    // “时区感知渲染”与“UTC 回退”。种子课节为整点（Asia/Shanghai 16:00/18:00 → 偏移数小时），必然满足。
    expect(torontoTime).not.toBe(utcTime)

    await page.goto('/dashboard/schedule')
    await expect(page.locator('.fc').first()).toBeVisible()

    // 跳到本周后，有界地向后翻，直到该未来课节出现在网格中（每周例课，通常 1–2 次即可）。
    // 每次翻页后先等工具栏标题文本变化（= FullCalendar 导航重渲染已落定）再读 count，避免用无自动
    // 重试的 count() 在重渲染完成前读到 0 而误翻过目标周（CI-only flaky）。
    // FullCalendar DISABLES 「今天」 whenever the view already shows today, and the calendar loads on the
    // current week — so on a fresh load this button is disabled. Playwright's click waits for the element
    // to become actionable (enabled), so an unconditional click here hangs the full 15s and times out
    // (the observed CI failure). We only need it to guarantee a known "current week" start; when it is
    // already disabled we are on that week, so click only when it is actionable.
    const todayButton = page.locator('.fc-today-button')
    if (await todayButton.isEnabled()) await todayButton.click()
    const event = page.getByTestId(`calendar-event-${lessonId}`)
    const title = page.locator('.fc-toolbar-title')
    for (let i = 0; i < 8 && (await event.count()) === 0; i++) {
      const before = (await title.textContent()) ?? ''
      await page.locator('.fc-next-button').click()
      await expect(title).not.toHaveText(before)
    }
    await expect(event).toBeVisible()

    // 事件块通过 renderEventContent → arg.timeText 显示其上课时段（FullCalendar 对有结束时间的事件
    // 返回区间 "HH:mm - HH:mm"）。该时段的开始必须是多伦多 wall-clock、且绝不是 UTC wall-clock：
    //   - 已修复（luxon 插件生效）→ 文本形如 "04:00 - 05:00"，含多伦多 04:00、不含 UTC 08:00 → 通过
    //   - 未修复（UTC 回退）    → 文本形如 "08:00 - 09:00"，不含多伦多 04:00 → 失败
    const timeText = event.getByTestId('event-time')
    await expect(timeText).toContainText(torontoTime)
    await expect(timeText).not.toContainText(utcTime)
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
