import 'server-only'
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import type { AuthContext } from '@/auth/context'
import { forTenant } from '@/db/tenant'
import { rescheduleRequest, lesson, enrollment } from '@/db/schema'
import { assertLinkedToStudent } from '@/auth/portal'
import { actorOwnsSection } from '@/auth/scope'
import { rescheduleLessonCore } from '@/lib/schedule-core'
import { ConflictError } from '@/lib/errors'
import { notifyRescheduleOutcomeCore } from '@/lib/notification-core'
import type { CalendarEvent } from '@/app/dashboard/schedule/types'

// Phase 7a — reschedule-REQUEST workflow (modeled on report-core): parent/student create a request;
// teacher/admin approve (which moves the lesson via the SAME rescheduleLessonCore the UI/MCP use) or
// reject. Cores take a resolved ctx and do NOT call requireAuthContext / revalidatePath — those live
// in the thin Server Actions — so this stays headless-testable (like report-core).

export type RescheduleRequestRow = typeof rescheduleRequest.$inferSelect

export const createRescheduleRequestFields = {
  studentId: z.string().trim().min(1),
  lessonId: z.string().trim().min(1),
  requestedStartAt: z.coerce.date(),
  requestedEndAt: z.coerce.date(),
  reason: z.string().trim().max(500).optional(),
}
export const createRescheduleRequestSchema = z
  .object(createRescheduleRequestFields)
  .refine((d) => d.requestedEndAt > d.requestedStartAt, {
    message: '结束时间必须晚于开始时间',
    path: ['requestedEndAt'],
  })

export type ApproveResult =
  | { ok: true; request: RescheduleRequestRow; event: CalendarEvent }
  | {
      ok: false
      error: 'CONFLICT'
      conflicts: { id: string; title: string | null }[]
      suggestions: string[]
    }

// Parent/student create a pending request for their own child, against a lesson the child attends.
export async function createRescheduleRequestCore(
  ctx: AuthContext,
  input: z.input<typeof createRescheduleRequestSchema>,
): Promise<RescheduleRequestRow> {
  const data = createRescheduleRequestSchema.parse(input)

  // Row-level ownership: the acting user must be linked to this student (P7a-5).
  await assertLinkedToStudent(ctx, data.studentId)

  const target = await forTenant(ctx).findById(lesson, data.lessonId)
  if (!target) throw new Error('课节不存在')

  // The child must actually attend this lesson's section (active enrollment).
  const enrolled = await forTenant(ctx).select(
    enrollment,
    and(
      eq(enrollment.studentId, data.studentId),
      eq(enrollment.sectionId, target.sectionId),
      eq(enrollment.status, 'active'),
    ),
  )
  if (enrolled.length === 0) throw new Error('该学生未在此班级')

  const [row] = await forTenant(ctx).insert(rescheduleRequest, {
    studentId: data.studentId,
    lessonId: data.lessonId,
    requestedById: ctx.userId, // audit stamp (mirrors attendance.recordedBy)
    requestedStartAt: data.requestedStartAt,
    requestedEndAt: data.requestedEndAt,
    reason: data.reason,
    status: 'pending',
  })
  return row
}

// 工作流 E: reviewing a reschedule request is a teacher action on the request's lesson. The pending
// queue is tenant-wide, so without this any teacher could approve (move) or reject another teacher's
// lesson via a guessed requestId. A section-scoped teacher may only review requests against a lesson of
// a section they teach; whole-tenant staff + superadmin bypass via actorOwnsSection.
async function assertReviewerOwnsRequestLesson(ctx: AuthContext, lessonId: string): Promise<void> {
  const target = await forTenant(ctx).findById(lesson, lessonId)
  if (!target) throw new Error('课节不存在')
  if (!actorOwnsSection(ctx, { teacherId: target.teacherId })) throw new Error('无权处理该申请')
}

// Teacher/admin approve: move the lesson via rescheduleLessonCore (same conflict check + GiST backstop
// as the calendar UI). Only flip the request to 'approved' when the move succeeds; on a soft CONFLICT
// or a GiST race, leave it 'pending' and surface the conflict so the reviewer can pick another time.
export async function approveRescheduleRequestCore(
  ctx: AuthContext,
  requestId: string,
): Promise<ApproveResult> {
  const req = await forTenant(ctx).findById(rescheduleRequest, requestId)
  if (!req) throw new Error('申请不存在')
  if (req.status !== 'pending') throw new Error('申请已处理')
  if (!req.requestedStartAt || !req.requestedEndAt) throw new Error('申请缺少目标时间')
  await assertReviewerOwnsRequestLesson(ctx, req.lessonId)

  // B19/B20: atomically CLAIM the request (pending → approved) BEFORE moving the lesson. A single
  // guarded UPDATE is the compare-and-set: if a concurrent approve/reject/cancel already transitioned
  // it, 0 rows come back and we bail — so we can never move a lesson yet record the request as rejected,
  // nor fire a duplicate outcome notification (the two-approver race in the review).
  const [claimed] = await forTenant(ctx).updateWhere(
    rescheduleRequest,
    requestId,
    eq(rescheduleRequest.status, 'pending'),
    { status: 'approved', reviewedById: ctx.userId, reviewedAt: new Date() },
  )
  if (!claimed) throw new Error('申请已处理')

  // Compensating rollback: if the move can't happen, release the claim back to pending so the request is
  // reviewable again — never a stuck 'approved' whose lesson never actually moved.
  const releaseClaim = async () => {
    await forTenant(ctx).update(rescheduleRequest, requestId, {
      status: 'pending',
      reviewedById: null,
      reviewedAt: null,
    })
  }

  let result
  try {
    result = await rescheduleLessonCore(ctx, {
      id: req.lessonId,
      startAt: req.requestedStartAt,
      endAt: req.requestedEndAt,
    })
  } catch (e) {
    await releaseClaim()
    // GiST race (23P01) → rescheduleLessonCore throws ConflictError. Treat like a soft conflict:
    // leave the request pending so the reviewer retries with a different time.
    if (e instanceof ConflictError)
      return { ok: false, error: 'CONFLICT', conflicts: [], suggestions: [] }
    throw e
  }

  if (!result.ok) {
    await releaseClaim()
    return {
      ok: false,
      error: 'CONFLICT',
      conflicts: result.conflicts,
      suggestions: result.suggestions,
    }
  }

  // P7b: notify the requester + teacher that the reschedule was approved. Side effect only — a
  // notification failure must NOT undo the approval (which already moved the lesson).
  try {
    const movedLesson = await forTenant(ctx).findById(lesson, req.lessonId)
    if (movedLesson) await notifyRescheduleOutcomeCore(ctx, claimed, movedLesson, 'approved')
  } catch (e) {
    console.error('notify reschedule approved failed', e)
  }
  return { ok: true, request: claimed, event: result.event }
}

// Optional reviewer note (a reject reason). Trimmed + capped to mirror the request's own `reason`
// field; empty/whitespace collapses to null so we never persist a blank string.
export const rejectRescheduleNoteSchema = z.string().trim().max(500).optional()

export async function rejectRescheduleRequestCore(
  ctx: AuthContext,
  requestId: string,
  note?: string,
): Promise<RescheduleRequestRow> {
  const parsedNote = rejectRescheduleNoteSchema.parse(note)
  const req = await forTenant(ctx).findById(rescheduleRequest, requestId)
  if (!req) throw new Error('申请不存在')
  if (req.status !== 'pending') throw new Error('申请已处理')
  await assertReviewerOwnsRequestLesson(ctx, req.lessonId)
  // B19/B20: atomic compare-and-set — reject only if STILL pending, else 0 rows = a concurrent
  // transition already won (no double-notify, no contradictory status).
  const [updated] = await forTenant(ctx).updateWhere(
    rescheduleRequest,
    requestId,
    eq(rescheduleRequest.status, 'pending'),
    {
      status: 'rejected',
      reviewedById: ctx.userId,
      reviewedAt: new Date(),
      reviewNote: parsedNote && parsedNote.length > 0 ? parsedNote : null,
    },
  )
  if (!updated) throw new Error('申请已处理')
  // P7b: notify the requester + teacher of the rejection (no lesson move — use the request's lesson
  // for context). Side effect only — never let it throw out of the core.
  try {
    const reqLesson = await forTenant(ctx).findById(lesson, req.lessonId)
    if (reqLesson) await notifyRescheduleOutcomeCore(ctx, updated, reqLesson, 'rejected')
  } catch (e) {
    console.error('notify reschedule rejected failed', e)
  }
  return updated
}

// Parent/student cancel their OWN pending request.
export async function cancelRescheduleRequestCore(
  ctx: AuthContext,
  requestId: string,
): Promise<RescheduleRequestRow> {
  const req = await forTenant(ctx).findById(rescheduleRequest, requestId)
  if (!req) throw new Error('申请不存在')
  if (req.requestedById !== ctx.userId) throw new Error('无权取消该申请')
  if (req.status !== 'pending') throw new Error('申请已处理')
  // B19/B20: atomic compare-and-set — cancel only if STILL pending (a race with an approve/reject loses).
  const [updated] = await forTenant(ctx).updateWhere(
    rescheduleRequest,
    requestId,
    eq(rescheduleRequest.status, 'pending'),
    { status: 'canceled' },
  )
  if (!updated) throw new Error('申请已处理')
  return updated
}
