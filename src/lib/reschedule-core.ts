import 'server-only'
import { z } from 'zod'
import { and, count, eq, sql } from 'drizzle-orm'
import type { AuthContext } from '@/auth/context'
import { db } from '@/db'
import { forTenant } from '@/db/tenant'
import { rescheduleRequest, lesson, enrollment } from '@/db/schema'
import { assertLinkedToStudent } from '@/auth/portal'
import { actorOwnsSection } from '@/auth/scope'
import { rescheduleLessonCore } from '@/lib/schedule-core'
import { BusinessError, ConflictError } from '@/lib/errors'
import { notifyRescheduleOutcomeCore } from '@/lib/notification-core'
import type { CalendarEvent } from '@/app/dashboard/schedule/types'

// Phase 7a — reschedule-REQUEST workflow (modeled on report-core): parent/student create a request;
// teacher/admin approve (which moves the lesson via the SAME rescheduleLessonCore the UI/MCP use) or
// reject. Cores take a resolved ctx and do NOT call requireAuthContext / revalidatePath — those live
// in the thin Server Actions — so this stays headless-testable (like report-core).

export type RescheduleRequestRow = typeof rescheduleRequest.$inferSelect

// SEC5: these portal write actions are reachable by untrusted external parent/student accounts and had
// NO rate limit — a caller could spam pending requests, growing rows and flooding the teacher review
// queue. We cap the number of OPEN (pending) requests one user may hold at a time. Chosen over an
// in-memory token bucket because a DB count(): (a) survives multi-instance/restart, (b) is cheap
// (indexed by tenant) and self-clearing (approving/rejecting/canceling frees a slot), (c) is
// headless-testable and also covers the MCP path (both go through this core). The cap is generous so
// legitimate rapid corrections aren't blocked.
const MAX_OPEN_RESCHEDULE_REQUESTS_PER_USER = 5

const createRescheduleRequestFields = {
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
  if (!target) throw new BusinessError('课节不存在')

  // The child must actually attend this lesson's section (active enrollment).
  const enrolled = await forTenant(ctx).select(
    enrollment,
    and(
      eq(enrollment.studentId, data.studentId),
      eq(enrollment.sectionId, target.sectionId),
      eq(enrollment.status, 'active'),
    ),
  )
  if (enrolled.length === 0) throw new BusinessError('该学生未在此班级')

  // SEC5: per-user quota on open (pending) requests. The count→insert MUST be atomic: a concurrent burst
  // from the same untrusted account would otherwise each read a below-cap count (READ COMMITTED snapshots
  // exclude peers' uncommitted inserts) and all insert, overshooting the cap. Serialize same-user creators
  // with a per-(tenant,user) transaction-scoped advisory lock, then re-count and insert inside the txn so
  // the loser sees the winner's committed row. tenantId is kept in every WHERE / on the insert for M1.
  const row = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`${ctx.tenantId}:${ctx.userId}`}))`,
    )
    const [openRow] = await tx
      .select({ value: count() })
      .from(rescheduleRequest)
      .where(
        and(
          eq(rescheduleRequest.tenantId, ctx.tenantId),
          eq(rescheduleRequest.requestedById, ctx.userId),
          eq(rescheduleRequest.status, 'pending'),
        ),
      )
    if ((openRow?.value ?? 0) >= MAX_OPEN_RESCHEDULE_REQUESTS_PER_USER) {
      throw new BusinessError('待处理的改期申请过多，请先等待老师处理后再提交')
    }
    const [inserted] = await tx
      .insert(rescheduleRequest)
      .values({
        tenantId: ctx.tenantId,
        studentId: data.studentId,
        lessonId: data.lessonId,
        requestedById: ctx.userId, // audit stamp (mirrors attendance.recordedBy)
        requestedStartAt: data.requestedStartAt,
        requestedEndAt: data.requestedEndAt,
        reason: data.reason,
        status: 'pending',
      })
      .returning()
    return inserted as RescheduleRequestRow
  })
  return row
}

// 工作流 E: reviewing a reschedule request is a teacher action on the request's lesson. The pending
// queue is tenant-wide, so without this any teacher could approve (move) or reject another teacher's
// lesson via a guessed requestId. A section-scoped teacher may only review requests against a lesson of
// a section they teach; whole-tenant staff + superadmin bypass via actorOwnsSection.
async function assertReviewerOwnsRequestLesson(ctx: AuthContext, lessonId: string): Promise<void> {
  const target = await forTenant(ctx).findById(lesson, lessonId)
  if (!target) throw new BusinessError('课节不存在')
  if (!actorOwnsSection(ctx, { teacherId: target.teacherId }))
    throw new BusinessError('无权处理该申请')
}

// H7 internal control-flow sentinels: thrown inside the approve transaction to ABORT (and thus roll
// back the claim), then translated to the public ApproveResult / BusinessError outside the txn.
class AlreadyHandledError extends Error {}
class SoftConflictError extends Error {
  constructor(
    public conflicts: { id: string; title: string | null }[],
    public suggestions: string[],
  ) {
    super('CONFLICT')
  }
}

// Teacher/admin approve: move the lesson via rescheduleLessonCore (same conflict check + GiST backstop
// as the calendar UI). Only flip the request to 'approved' when the move succeeds; on a soft CONFLICT
// or a GiST race, leave it 'pending' and surface the conflict so the reviewer can pick another time.
export async function approveRescheduleRequestCore(
  ctx: AuthContext,
  requestId: string,
): Promise<ApproveResult> {
  const req = await forTenant(ctx).findById(rescheduleRequest, requestId)
  if (!req) throw new BusinessError('申请不存在')
  if (req.status !== 'pending') throw new BusinessError('申请已处理')
  if (!req.requestedStartAt || !req.requestedEndAt) throw new BusinessError('申请缺少目标时间')
  // Capture as non-null locals so the transaction closure below keeps the narrowing.
  const targetStartAt = req.requestedStartAt
  const targetEndAt = req.requestedEndAt
  await assertReviewerOwnsRequestLesson(ctx, req.lessonId)

  // B19/B20 + H7: CLAIM (pending → approved) and MOVE the lesson in ONE transaction so the two either
  // both commit or both roll back. Previously the guarded claim committed on its own statement and the
  // move ran as a SECOND independent statement — a crash in between (OOM/SIGKILL/deploy/pod eviction)
  // left the request stuck 'approved' with the lesson unmoved, and every review path guards
  // status='pending', so it was unrecoverable. The guarded compare-and-set (status='pending') still
  // serialises concurrent approve/reject/cancel: the loser gets 0 rows and bails; the row lock is held
  // for the whole transaction. A soft conflict or a GiST race throws to abort the txn (rolling the claim
  // back to pending), then is translated to a CONFLICT result outside.
  let claimed: RescheduleRequestRow
  let event: CalendarEvent
  try {
    const res = await db.transaction(async (tx) => {
      const [c] = await forTenant(ctx, tx).updateWhere(
        rescheduleRequest,
        requestId,
        eq(rescheduleRequest.status, 'pending'),
        { status: 'approved', reviewedById: ctx.userId, reviewedAt: new Date() },
      )
      if (!c) throw new AlreadyHandledError()
      // Move via the SAME tx so it commits atomically with the claim (byte-identical conflict check +
      // GiST backstop as the calendar UI).
      const move = await rescheduleLessonCore(
        ctx,
        { id: req.lessonId, startAt: targetStartAt, endAt: targetEndAt },
        tx,
      )
      if (!move.ok) throw new SoftConflictError(move.conflicts, move.suggestions)
      return { claimed: c, event: move.event }
    })
    claimed = res.claimed
    event = res.event
  } catch (e) {
    if (e instanceof AlreadyHandledError) throw new BusinessError('申请已处理')
    if (e instanceof SoftConflictError)
      return { ok: false, error: 'CONFLICT', conflicts: e.conflicts, suggestions: e.suggestions }
    // GiST race (23P01) → ConflictError from rescheduleLessonCore aborts the txn; the claim rolled back,
    // so the request stays pending and the reviewer can retry with another time.
    if (e instanceof ConflictError)
      return { ok: false, error: 'CONFLICT', conflicts: [], suggestions: [] }
    throw e
  }

  // P7b: notify the requester + teacher AFTER the transaction commits. Side effect only — a
  // notification failure must NOT undo the approval (which already moved the lesson).
  try {
    const movedLesson = await forTenant(ctx).findById(lesson, req.lessonId)
    if (movedLesson) await notifyRescheduleOutcomeCore(ctx, claimed, movedLesson, 'approved')
  } catch (e) {
    console.error('notify reschedule approved failed', e)
  }
  return { ok: true, request: claimed, event }
}

// Optional reviewer note (a reject reason). Trimmed + capped to mirror the request's own `reason`
// field; empty/whitespace collapses to null so we never persist a blank string.
const rejectRescheduleNoteSchema = z.string().trim().max(500).optional()

export async function rejectRescheduleRequestCore(
  ctx: AuthContext,
  requestId: string,
  note?: string,
): Promise<RescheduleRequestRow> {
  const parsedNote = rejectRescheduleNoteSchema.parse(note)
  const req = await forTenant(ctx).findById(rescheduleRequest, requestId)
  if (!req) throw new BusinessError('申请不存在')
  if (req.status !== 'pending') throw new BusinessError('申请已处理')
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
  if (!updated) throw new BusinessError('申请已处理')
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
  if (!req) throw new BusinessError('申请不存在')
  if (req.requestedById !== ctx.userId) throw new BusinessError('无权取消该申请')
  if (req.status !== 'pending') throw new BusinessError('申请已处理')
  // B19/B20: atomic compare-and-set — cancel only if STILL pending (a race with an approve/reject loses).
  const [updated] = await forTenant(ctx).updateWhere(
    rescheduleRequest,
    requestId,
    eq(rescheduleRequest.status, 'pending'),
    { status: 'canceled' },
  )
  if (!updated) throw new BusinessError('申请已处理')
  return updated
}
