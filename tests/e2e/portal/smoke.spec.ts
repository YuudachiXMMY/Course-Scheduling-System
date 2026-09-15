import { test, expect } from '../fixtures/test'

// Portal smoke: proves the consented parent storageState lands on content (past the consent gate) and
// sees the linked student's schedule card.
test.describe('Portal 入口冒烟', () => {
  test('家长登录态直达「我的课表」并看到关联学生课表卡片', async ({ page, seed }) => {
    await page.goto('/portal')
    await expect(page).toHaveURL(/\/portal/)
    await expect(page.getByRole('heading', { name: '我的课表' })).toBeVisible()
    // Consent already stamped in the seed → no consent gate.
    await expect(page.getByRole('heading', { name: '数据处理告知与同意' })).toHaveCount(0)
    await expect(page.getByText(`${seed.studentA.name} 的课表`)).toBeVisible()
  })
})
