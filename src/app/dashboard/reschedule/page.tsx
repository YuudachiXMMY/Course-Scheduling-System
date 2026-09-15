import { requireAuthContext } from '@/auth/context'
import { requirePermission, can } from '@/auth/authorize'
import { listRescheduleRequests } from './data'
import ReviewPanel from './review-panel'

// Teacher/admin review queue. Pending requests only; approve moves the lesson via
// rescheduleLessonCore (same conflict check + GiST backstop as the calendar), reject closes it.
// Assistants can list but not approve/reject → the buttons are hidden (actions also re-check).
export default async function ReschedulePage() {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { rescheduleRequest: ['list'] })
  const requests = await listRescheduleRequests(ctx, 'pending')
  const canReview = can(ctx.role, { rescheduleRequest: ['approve'] })

  return (
    <section className="flex max-w-3xl flex-col gap-6">
      <h2 className="text-lg font-semibold">待处理改期申请</h2>
      <ReviewPanel requests={requests} canReview={canReview} />
    </section>
  )
}
