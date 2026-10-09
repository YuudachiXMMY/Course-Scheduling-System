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

    // 本用例测的是「保存」，不是「发布」。PR#85 起「对外开放」默认勾选，不取消就会把这条
    // 测试笔记真的发给家长/学生 —— 那会打红 tests/e2e/portal/notes.spec.ts 的空态用例
    // （portal project 在 staff 之后跑，共用同一个库）。发布本身由下面的「默认勾选」用例覆盖。
    const shareToggle = page.getByLabel('对外开放（学生 / 家长可见）')
    await shareToggle.uncheck()
    // 勾选框是受控组件:上面那个 `加载中…` toBeHidden 在元素尚未挂载时也会立即通过,所以
    // 理论上 uncheck 可能抢在加载回调之前,被随后的 setShared() 覆盖回勾选。断言一下,
    // 让这种情况当场红掉 —— 否则它会静默地把笔记发布出去,再去打红另一个文件里的用例。
    await expect(shareToggle).not.toBeChecked()

    await page.getByRole('button', { name: '保存笔记', exact: true }).click()

    // saveShared() sets msg='已保存本节课笔记' after the server action resolves (attendance-actions.ts).
    await expect(page.getByText('已保存本节课笔记')).toBeVisible()

    await page.getByRole('button', { name: '关闭' }).click()
    await expect(page.getByTestId('lesson-detail-drawer')).toHaveCount(0)
  })

  test('抽屉中「对外开放」勾选框默认勾选', async ({ page }) => {
    // 必须打开一节**没有任何用例写过共享笔记**的课，否则这个断言测的不是"默认值"而是
    // "上一个用例写入的回显"。它此前正是如此:三个抽屉用例都用 .first() 开同一节课,
    // 而「保存本节课共享笔记」先跑并按 PR#85 的新默认存成 shared,于是这里读回 shared
    // 就绿了 —— 和缺省逻辑毫无关系。给上面那个用例加 uncheck() 后它读回 internal 才暴露。
    await openFirstLessonDrawer(page, 'last')
    await expect(page.getByText('加载中…')).toBeHidden()

    // 把上面那条前提变成显式断言:正文为空 ⇒ 库里没有这节课的共享笔记行 ⇒
    // getLessonNotes 走 attendance-actions.ts 的"无行则缺省 shared"分支。
    // 少了这一条，将来任何用例一旦写到这节课，本用例会再次静默地变成在测回显。
    await expect(page.getByPlaceholder('今天讲了…')).toHaveValue('')

    // 新笔记（无共享笔记行）→ sharedVisibility 缺省 shared → 勾选框默认勾选。
    const shareToggle = page.getByLabel('对外开放（学生 / 家长可见）')
    await expect(shareToggle).toBeVisible()
    await expect(shareToggle).toBeChecked()

    await page.getByRole('button', { name: '关闭' }).click()
    await expect(page.getByTestId('lesson-detail-drawer')).toHaveCount(0)
  })

  test('抽屉中「一键保存所有更改」一次提交地点/笔记/点评', async ({ page }) => {
    await openFirstLessonDrawer(page)
    await expect(page.getByText('加载中…')).toBeHidden()

    // 改动上课地点与共享笔记，然后仅点一次「一键保存所有更改」。
    await page.getByLabel('上课地点').fill(`E2E地点-${Date.now()}`)
    await page.getByPlaceholder('今天讲了…').fill(`E2E一键保存-${Date.now()}`)

    // 同上：测的是「一次提交三类改动」，不是「发布」。不取消默认勾选就会把笔记发给门户，
    // 打红 portal 的空态用例（见 tests/e2e/portal/notes.spec.ts 顶部说明）。
    // saveAll 的脏检查含 `shared !== init.shared`，所以 visibility-only 的改动也会落库
    // （lesson-detail.tsx:202/208）—— 取消勾选不会被当成"没改动"而跳过。
    const shareToggle = page.getByLabel('对外开放（学生 / 家长可见）')
    await shareToggle.uncheck()
    await expect(shareToggle).not.toBeChecked()

    await page.getByRole('button', { name: '一键保存所有更改', exact: true }).click()
    // 断言绿色成功提示（汇总文案含「已保存全部更改」），never on global counts.
    await expect(page.getByText(/已保存全部更改/)).toBeVisible()

    await page.getByRole('button', { name: '关闭' }).click()
    await expect(page.getByTestId('lesson-detail-drawer')).toHaveCount(0)
  })
})

/**
 * Navigate to the schedule, switch FullCalendar to month view (surfaces every seeded event as a
 * clickable block — no dayMaxEvents collapsing is configured), then open one lesson's detail
 * drawer. Returns the drawer locator. The seed guarantees section A has lessons around now, and the
 * calendar's initialDate is the first event's start, so month view always contains at least one event.
 *
 * `which` picks WHICH event — and that choice is load-bearing, not cosmetic. Every drawer test in
 * this file shares one database (workers:1, serial), so two tests that both open 'first' see each
 * other's writes. A test whose premise is "this lesson has no shared-note row yet" must therefore
 * open a lesson no other test writes to; pass 'last' for that.
 */
async function openFirstLessonDrawer(page: Page, which: 'first' | 'last' = 'first') {
  await page.goto('/dashboard/schedule')
  await expect(page.locator('.fc').first()).toBeVisible()

  // FullCalendar toolbar buttons have no stable role/text → target the view button by class.
  await page.locator('.fc-dayGridMonth-button').click()

  // Each mounted event gets a `calendar-event-<lessonId>` testid via eventDidMount (calendar.tsx).
  const events = page.locator('[data-testid^="calendar-event-"]')
  const firstEvent = which === 'last' ? events.last() : events.first()
  await expect(firstEvent).toBeVisible()
  await firstEvent.click()

  const drawer = page.getByTestId('lesson-detail-drawer')
  await expect(drawer).toBeVisible()
  await expect(page.getByRole('heading', { name: '课节详情' })).toBeVisible()
  return drawer
}
