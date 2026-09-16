import { test, expect } from '../fixtures/test'

// Portal reschedule (project portal = consented Parent A storageState). Parent A is linked to
// seed.studentA, who has future lessons inside the card window, so the form defaults to a
// submittable lesson with start/end pre-filled. Fully reversible: submit a uniquely-tagged request →
// assert it shows as 待处理 → cancel it → assert 已取消. The unique reason isolates OUR own row, so we
// never assert global counts and we leave the fixture clean.
test.describe('改期申请（家长）', () => {
  test('提交改期申请出现「待处理」行，取消后变为「已取消」', async ({ page, seed }) => {
    // Portal submit/cancel surface errors inline (setError), not via native dialogs, but register a
    // defensive accept handler up front in case a confirm/alert is ever wired into this flow.
    page.on('dialog', (d) => d.accept())

    await page.goto('/portal/reschedule')
    await expect(page.getByRole('heading', { name: '改期申请', exact: true })).toBeVisible()

    // Empty state: no upcoming lessons to request against → nothing to submit. Handle gracefully.
    const emptyNote = page.getByText('近期暂无可申请改期的课节。')
    if (await emptyNote.isVisible().catch(() => false)) {
      test.skip(true, '近期暂无可申请改期的课节 — 无可提交的课节（seed 未落在改期窗口内）')
      return
    }

    // Form present; the 选择课节 select defaults to the first future lesson (start/end auto-prefilled).
    await expect(page.getByRole('heading', { name: '申请改期', exact: true })).toBeVisible()
    const select = page.getByTestId('reschedule-lesson-select')
    await expect(select).toBeVisible()
    await expect(select).toContainText(seed.studentA.name)
    await expect(page.getByTestId('reschedule-start-input')).not.toHaveValue('')
    await expect(page.getByTestId('reschedule-end-input')).not.toHaveValue('')

    // Tag the request with a unique reason so we can find OUR row (never assert global counts).
    const reason = `E2E临时改期-${Date.now()}`
    await page.getByTestId('reschedule-reason').fill(reason)
    await page.getByTestId('reschedule-submit').click()

    // New row appears in 我的申请 with status 待处理 (data-status=pending).
    const row = page.getByTestId('reschedule-row').filter({ hasText: reason })
    await expect(row).toBeVisible()
    await expect(row).toHaveAttribute('data-status', 'pending')
    await expect(row.getByText('待处理')).toBeVisible()

    // Cancel it (reschedule-cancel) → status flips to 已取消 and the 取消 button disappears. This keeps
    // the fixture clean (reversible create → cancel in one test).
    await row.getByTestId('reschedule-cancel').click()
    await expect(row).toHaveAttribute('data-status', 'canceled')
    await expect(row.getByText('已取消')).toBeVisible()
    await expect(row.getByTestId('reschedule-cancel')).toHaveCount(0)
  })
})
