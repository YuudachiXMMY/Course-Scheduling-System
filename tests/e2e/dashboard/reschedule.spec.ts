import { test, expect } from '../fixtures/test'

// Dashboard reschedule-approval queue (project `staff`, default owner storageState → has
// rescheduleRequest:approve). The seed plants exactly ONE pending request (student B, a
// conflict-free Saturday slot). This is the SOLE spec allowed to consume seed.pendingReschedule —
// approving it MOVES the lesson, so no other spec may mutate the same row.
test.describe('待处理改期申请 审批队列', () => {
  test('owner 通过冲突空闲时段的改期申请后该行消失', async ({ page, seed }) => {
    test.skip(!seed.pendingReschedule, 'no seeded pending reschedule request')
    const req = seed.pendingReschedule!

    await page.goto('/dashboard/reschedule')
    await expect(page.getByRole('heading', { name: '待处理改期申请' })).toBeVisible()

    // The seeded request belongs to student B; locate its row by the stable data-request-id.
    const row = page.locator(
      `[data-testid="reschedule-request"][data-request-id="${req.id}"]`,
    )
    await expect(row).toBeVisible()
    await expect(row).toContainText(seed.studentB.name)

    // Approve. The requested slot is conflict-free → the core moves the lesson, the request leaves
    // "pending", and router.refresh() re-fetches the (now shorter) queue. No native dialog is
    // involved (approve is a server action, not window.confirm).
    await row.getByTestId('reschedule-approve').click()

    // The specific row is gone from the pending list after the refresh.
    await expect(row).toHaveCount(0)
    // No conflict feedback should have appeared for this conflict-free approval.
    await expect(page.getByTestId('reschedule-conflict')).toHaveCount(0)
  })

  // A reject test would need its OWN seeded/created pending request: seed.pendingReschedule is
  // single-use and consumed by the approve test above (approving mutates the row irreversibly).
  // Rejecting the same row would race/duplicate that mutation, so it stays fixme until a dedicated
  // request can be created in-test or seeded separately.
  test.fixme('owner 拒绝改期申请后该行消失 (needs its own seeded/created request)', async () => {
    // Intentionally empty — see comment above.
  })
})
