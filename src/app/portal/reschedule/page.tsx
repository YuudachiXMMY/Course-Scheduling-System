import { eq } from 'drizzle-orm'
import { requireAuthContext } from '@/auth/context'
import { requirePermission } from '@/auth/authorize'
import { forTenant } from '@/db/tenant'
import { rescheduleRequest } from '@/db/schema'
import { getPortalSchedule } from '../data'
import RequestForm, { type LessonOption, type RequestRow } from './request-form'

// "我的改期申请": the user's own requests + the upcoming lessons they may request a change against.
// Both lists are row-scoped — lessons come from getPortalSchedule (linked students only), requests
// are filtered to requestedById = ctx.userId. Dates are serialized to ISO for the client boundary.
export default async function PortalReschedulePage() {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { rescheduleRequest: ['list'] })

  const cards = await getPortalSchedule(ctx)
  const options: LessonOption[] = cards.flatMap((c) =>
    c.lessons.map((l) => ({
      studentId: c.studentId,
      studentName: c.studentName,
      lessonId: l.id,
      title: l.title,
      startAt: l.startAt.toISOString(),
      endAt: l.endAt.toISOString(),
    })),
  )

  const rows = (await forTenant(ctx).select(
    rescheduleRequest,
    eq(rescheduleRequest.requestedById, ctx.userId),
  )) as (typeof rescheduleRequest.$inferSelect)[]
  const requests: RequestRow[] = rows
    .map((r) => ({
      id: r.id,
      status: r.status,
      reason: r.reason,
      reviewNote: r.reviewNote,
      requestedStartAt: r.requestedStartAt ? r.requestedStartAt.toISOString() : null,
      requestedEndAt: r.requestedEndAt ? r.requestedEndAt.toISOString() : null,
      createdAt: r.createdAt ? r.createdAt.toISOString() : null,
    }))
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-6">
      <h2 className="text-lg font-semibold">改期申请</h2>
      <RequestForm options={options} requests={requests} />
    </section>
  )
}
