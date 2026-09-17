import 'server-only'
import { eq } from 'drizzle-orm'
import type { AuthContext } from '@/auth/context'
import { forTenant } from '@/db/tenant'
import { actorOwnsSection, isWholeTenantActor } from '@/auth/scope'
import { rescheduleRequest, lesson, student } from '@/db/schema'

// Serializable review row for the teacher's pending-requests list. Dates → ISO for the client
// boundary; the current lesson time is looked up so the reviewer sees old-vs-requested side by side.
export interface ReviewRow {
  id: string
  studentName: string | null
  lessonTitle: string | null
  currentStartAt: string | null
  currentEndAt: string | null
  requestedStartAt: string | null
  requestedEndAt: string | null
  reason: string | null
  status: string
  createdAt: string | null
}

type RescheduleStatus = 'pending' | 'approved' | 'rejected' | 'canceled'

// Single-tutor scale: fetch the requests, then hydrate each with its lesson (current time) + student
// (name) via forTenant lookups. All tenant-scoped; no raw db on the authenticated path.
export async function listRescheduleRequests(
  ctx: AuthContext,
  status: RescheduleStatus = 'pending',
): Promise<ReviewRow[]> {
  const reqs = (await forTenant(ctx).select(
    rescheduleRequest,
    eq(rescheduleRequest.status, status),
  )) as (typeof rescheduleRequest.$inferSelect)[]

  // 工作流 E: the pending queue is tenant-wide, so a section-scoped teacher must only see requests
  // against lessons they teach; whole-tenant staff + superadmin see the whole tenant's queue.
  const wholeTenant = isWholeTenantActor(ctx)

  const out: ReviewRow[] = []
  for (const r of reqs) {
    const l = (await forTenant(ctx).findById(lesson, r.lessonId)) as
      | typeof lesson.$inferSelect
      | null
    if (!wholeTenant && !(l && actorOwnsSection(ctx, { teacherId: l.teacherId }))) continue
    const s = r.studentId
      ? ((await forTenant(ctx).findById(student, r.studentId)) as typeof student.$inferSelect | null)
      : null
    out.push({
      id: r.id,
      studentName: s?.name ?? null,
      lessonTitle: l?.title ?? null,
      currentStartAt: l?.startAt ? l.startAt.toISOString() : null,
      currentEndAt: l?.endAt ? l.endAt.toISOString() : null,
      requestedStartAt: r.requestedStartAt ? r.requestedStartAt.toISOString() : null,
      requestedEndAt: r.requestedEndAt ? r.requestedEndAt.toISOString() : null,
      reason: r.reason,
      status: r.status,
      createdAt: r.createdAt ? r.createdAt.toISOString() : null,
    })
  }
  out.sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''))
  return out
}
