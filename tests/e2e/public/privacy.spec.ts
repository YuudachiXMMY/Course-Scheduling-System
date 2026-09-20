import { test, expect } from '../fixtures/test'

// Public data-notice page (/privacy) — no auth. Now drafted to the Canada/Ontario (PIPEDA) framework
// (was China PIPL). Linked from the read-only share page footer, the portal footer, and the
// first-login consent modal. This asserts the page is publicly reachable and carries the PIPEDA
// substance, and that the old PIPL framing is gone.
test.describe('公开数据处理告知 /privacy（安省/PIPEDA）', () => {
  test('免登可访问，内容为 PIPEDA 口径，且已去除 PIPL 措辞', async ({ page }) => {
    await page.goto('/privacy')

    await expect(page.getByRole('heading', { name: '数据处理告知', level: 1 })).toBeVisible()

    // Legal framework: PIPEDA, not PIPL. "PIPEDA" recurs across sections → assert the first match.
    await expect(page.getByText('个人信息保护及电子文件法')).toBeVisible()
    await expect(page.getByText('PIPEDA').first()).toBeVisible()

    // Key PIPEDA principles that must be present in the redraft. exact:true so '同意' does not also
    // match the '监护人同意（未成年人）' heading (substring matching is the default otherwise).
    for (const heading of [
      '同意',
      '监护人同意（未成年人）',
      '您的权利：访问与更正',
      '投诉与联系我们',
    ]) {
      await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible()
    }

    // The old China PIPL framing must be gone.
    await expect(page.getByText('中华人民共和国个人信息保护法')).toHaveCount(0)
  })
})
