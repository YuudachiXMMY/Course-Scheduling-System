import { test, expect } from '../fixtures/test'

// Dashboard 进度报告 (project `staff` → owner storageState, all perms).
//
// The AI-drafting path (createReportDraft → report-core) needs ANTHROPIC_API_KEY, which is absent in
// the test env. So we DO NOT drive real draft generation or a real PDF download here — those are
// test.fixme'd (see AUTHORING.md "Known-blocked"). We assert the page/form render + the pure
// client-side validation guard (which short-circuits before any server action fires), and only assert
// the PDF LINK exists when a seeded report happens to be present (none are seeded → skip).
test.describe('进度报告', () => {
  test('页面渲染：标题与「生成报告草稿」表单', async ({ page }) => {
    await page.goto('/dashboard/reports')
    await expect(page).toHaveURL(/\/dashboard\/reports/)

    await expect(page.getByRole('heading', { name: '进度报告' })).toBeVisible()
    await expect(page.getByRole('heading', { name: '生成报告草稿' })).toBeVisible()

    // student select (only <select> on the page) + two date inputs + optional title + submit button.
    await expect(page.getByRole('combobox')).toBeVisible()
    await expect(page.locator('input[type="date"]')).toHaveCount(2)
    await expect(page.getByPlaceholder('标题（可选）')).toBeVisible()
    await expect(page.getByRole('button', { name: '生成草稿' })).toBeVisible()
  })

  test('客户端校验：未选时间段点击「生成草稿」显示错误', async ({ page }) => {
    await page.goto('/dashboard/reports')

    // studentId defaults to students[0], but periodStart/periodEnd are empty → the client guard in
    // report-panel.tsx fires and returns BEFORE calling the (key-dependent) server action, so no
    // ANTHROPIC_API_KEY is needed and no dialog/network mutation occurs.
    const submit = page.getByRole('button', { name: '生成草稿' })
    await expect(submit).toBeEnabled()
    await submit.click()

    await expect(page.getByText('请选择学生与时间段')).toBeVisible()
    // Still on the reports page — nothing was generated.
    await expect(page).toHaveURL(/\/dashboard\/reports/)
  })

  test('已有报告时「下载 PDF」链接存在（无种子报告则跳过）', async ({ page }) => {
    await page.goto('/dashboard/reports')

    const pdfLinks = page.getByRole('link', { name: '下载 PDF' })
    const count = await pdfLinks.count()
    // No progress_report rows are seeded (AI drafting needs ANTHROPIC_API_KEY), so normally 0.
    test.skip(count === 0, '无种子进度报告（AI 起草需 ANTHROPIC_API_KEY，报告列表为空）')

    await expect(pdfLinks.first()).toHaveAttribute('href', /\/api\/reports\/.+\/pdf/)
    await expect(pdfLinks.first()).toHaveAttribute('target', '_blank')
  })

  test.fixme('生成 AI 报告草稿（需 ANTHROPIC_API_KEY）', async ({ page, seed }) => {
    // AI 起草需 ANTHROPIC_API_KEY — absent in test env → createReportDraft errors ("生成报告失败").
    await page.goto('/dashboard/reports')
    await page.getByRole('combobox').selectOption({ label: seed.studentA.name })
    const [start, end] = ['2026-01-01', '2026-01-31']
    const dates = page.locator('input[type="date"]')
    await dates.nth(0).fill(start)
    await dates.nth(1).fill(end)
    await page.getByPlaceholder('标题（可选）').fill(`E2E临时报告-${Date.now()}`)
    await page.getByRole('button', { name: '生成草稿' }).click()
    // A new draft row would appear with the 草稿 badge — requires the API key to actually generate.
    await expect(page.getByText('草稿').first()).toBeVisible()
  })

  test.fixme('下载报告 PDF（需 ANTHROPIC_API_KEY）', async ({ page }) => {
    // AI 起草需 ANTHROPIC_API_KEY — no draft can be created to download, and /api/reports/*/pdf may
    // also depend on the key. Left fixme until the reports runtime is provisioned with the key.
    await page.goto('/dashboard/reports')
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('link', { name: '下载 PDF' }).first().click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toMatch(/\.pdf$/)
  })
})
