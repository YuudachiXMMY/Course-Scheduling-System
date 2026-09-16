import { test, expect } from '../fixtures/test'

// Public read-only share link (/s/[token]) — no auth. Valid token shows the student's schedule;
// invalid/revoked tokens both fall to the deliberately-vague not-found copy.
test.describe('公开分享链接 /s/[token]', () => {
  test('有效 token 显示学生课表(只读)', async ({ page, seed }) => {
    await page.goto(seed.share.url)
    await expect(page.getByText(`${seed.studentA.name} 的课表`)).toBeVisible()
    await expect(page.getByText('本页仅供查看，链接可能随时更新。')).toBeVisible()
    await expect(page.getByRole('link', { name: '数据处理告知' })).toBeVisible()
  })

  test('无效 token 显示通用「链接无效或已停用」', async ({ page, seed }) => {
    await page.goto(`/s/${seed.invalidShareToken}`)
    await expect(page.getByRole('heading', { name: '链接无效或已停用' })).toBeVisible()
    await expect(
      page.getByText('该分享链接可能已被重新生成或停用，请向老师索取新的链接。'),
    ).toBeVisible()
  })
})
