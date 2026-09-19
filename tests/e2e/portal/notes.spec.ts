import { test, expect, contextForRole } from '../fixtures/test'

// 门户「课节笔记」端到端覆盖 (PR #56)。功能价值链：教师在班级工作台逐条「对外开放」
// (note.visibility='shared')，关联学生/家长即可在 /portal/notes 看到按 Markdown + LaTeX 渲染的全班
// 共享笔记。seed 不种入任何 note 行，所以「可见」必须由教师侧真实创建 —— 因此这些用例跨角色驱动
// (owner 写 → parent/student 读)。project 为 `portal`，默认 storageState = 已同意的家长 A。
//
// 约定 (见 tests/e2e/README.md)：workers=1 串行、共享一库；每个用例用带时间戳的唯一正文断言自己的
// 行，从不断言全局计数。
test.describe('Portal 课节笔记', () => {
  // NOTE: 空态断言依赖「本次 test:e2e 运行的 seed 未种入任何 shared 笔记」，且本文件内它先于下面的
  // 分享流用例执行（串行、声明顺序）；其它 portal spec 均不创建笔记。请经 `npm run test:e2e`（触发
  // global-setup 重新 seed）运行，而非单独 playwright 起本文件。
  test('家长空态：导航「课节笔记」→ 标题 + 空态文案', async ({ page }) => {
    await page.goto('/portal')
    await page.getByRole('link', { name: '课节笔记' }).click()
    await expect(page).toHaveURL(/\/portal\/notes/)
    await expect(page.getByRole('heading', { name: '课节笔记' })).toBeVisible()
    await expect(page.getByText('暂无公开的课节笔记')).toBeVisible()
  })

  test('完整分享流：教师「对外开放」一条 Markdown+LaTeX 笔记 → 家长与学生门户可见', async ({
    page,
    browser,
    seed,
  }) => {
    const token = `E2E门户公开笔记-${Date.now()}`
    // 含 Markdown 标题 + 行内 LaTeX，验证门户按 MarkdownView 渲染（而非原样输出 '#'/'$'）。
    const body = `# 本周重点\n\n${token}，含公式 $E=mc^2$。`

    // 1) owner（staff，含 lesson:update）在班级工作台开放 section A 第一节课的共享笔记。
    const staff = await contextForRole(browser, 'owner')
    try {
      const staffPage = await staff.newPage()
      await staffPage.goto(`/dashboard/teach/${seed.sectionA.id}?tab=lessons`)

      const toggle = staffPage.getByRole('button', { name: /笔记点评/ }).first()
      await expect(toggle).toBeVisible()
      await toggle.click()

      const summary = staffPage.getByLabel('本节课笔记（全班共享）')
      await expect(summary).toBeVisible()
      await summary.fill(body)

      // 逐条「对外开放」：勾选后 visibility='shared'，门户关联学生/家长可见。
      await staffPage.getByRole('checkbox', { name: /对外开放/ }).check()
      await staffPage.getByRole('button', { name: '保存笔记', exact: true }).click()
      await expect(staffPage.getByText('已保存本节课笔记')).toBeVisible()
    } finally {
      await staff.close()
    }

    // 2) 家长（本用例默认 storageState）在门户看到渲染后的正文与 Markdown 标题。
    await page.goto('/portal/notes')
    await expect(page.getByText(token)).toBeVisible()
    // '# 本周重点' 被渲染为真实 heading（证明 Markdown 生效，而非纯文本 '#'）。
    await expect(page.getByRole('heading', { name: '本周重点' })).toBeVisible()

    // 3) 同一关联学生 A 的学生登录态同样可见。
    const student = await contextForRole(browser, 'student')
    try {
      const studentPage = await student.newPage()
      await studentPage.goto('/portal/notes')
      await expect(studentPage.getByText(token)).toBeVisible()
    } finally {
      await student.close()
    }
  })

  test('越权隔离：未「对外开放」的笔记与逐生点评都不出现在门户', async ({ page, browser, seed }) => {
    const internalToken = `E2E内部笔记-${Date.now()}`
    const commentToken = `E2E逐生点评-${Date.now()}`

    const staff = await contextForRole(browser, 'owner')
    try {
      const staffPage = await staff.newPage()
      await staffPage.goto(`/dashboard/teach/${seed.sectionA.id}?tab=lessons`)

      // 用第二节课，避免覆盖「完整分享流」写在第一节课上的 shared 笔记。
      const toggle = staffPage.getByRole('button', { name: /笔记点评/ }).nth(1)
      await expect(toggle).toBeVisible()
      await toggle.click()

      // Summary 有正文，但「对外开放」保持未勾选 → visibility='internal'（门户不可见）。
      const summary = staffPage.getByLabel('本节课笔记（全班共享）')
      await expect(summary).toBeVisible()
      await summary.fill(internalToken)
      await expect(staffPage.getByRole('checkbox', { name: /对外开放/ })).not.toBeChecked()
      await staffPage.getByRole('button', { name: '保存笔记', exact: true }).click()
      await expect(staffPage.getByText('已保存本节课笔记')).toBeVisible()

      // 逐生点评（studentId 非空）—— 即便日后被标 shared 也绝不外泄给门户（data.ts 安全不变量 #2）。
      const studentRows = staffPage.getByTestId('lesson-note-student')
      if ((await studentRows.count()) > 0) {
        const row = studentRows.first()
        await row.locator('textarea').fill(commentToken)
        await row.getByRole('button', { name: '保存点评', exact: true }).click()
        await expect(staffPage.getByText('已保存点评')).toBeVisible()
      }
    } finally {
      await staff.close()
    }

    // 家长门户：internal 笔记与逐生点评的正文都不出现。
    await page.goto('/portal/notes')
    await expect(page.getByText(internalToken)).toHaveCount(0)
    await expect(page.getByText(commentToken)).toHaveCount(0)
  })
})
