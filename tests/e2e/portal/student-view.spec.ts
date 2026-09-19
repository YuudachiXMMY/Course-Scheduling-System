import { test, expect } from '../fixtures/test'
import { authStatePath } from '../fixtures/seed-constants'

// Student portal login (linked to studentA, pre-consented in the seed). Parity with the parent smoke:
// the consented student lands directly on 「课表」 with their own schedule card and never sees the
// consent gate.
test.describe('Portal 学生视图', () => {
  test.use({ storageState: authStatePath('student') })

  test('学生登录态直达「课表」并看到本人课表卡片', async ({ page, seed }) => {
    await page.goto('/portal')
    await expect(page).toHaveURL(/\/portal/)
    await expect(page.getByRole('heading', { name: '课表' })).toBeVisible()

    // Pre-consented → the consent gate is never rendered.
    await expect(page.getByRole('heading', { name: '数据处理告知与同意' })).toHaveCount(0)

    // studentA's schedule card (data-testid=schedule-card, headed by "<name> 的课表").
    await expect(
      page.getByTestId('schedule-card').filter({ hasText: `${seed.studentA.name} 的课表` }),
    ).toBeVisible()
  })
})
