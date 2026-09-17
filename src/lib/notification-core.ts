import 'server-only'
import { and, desc, eq, inArray, isNull, lt } from 'drizzle-orm'
import { DateTime } from 'luxon'
import type { AuthContext } from '@/auth/context'
import { forTenant } from '@/db/tenant'
import { notification, enrollment, portalLink, lesson } from '@/db/schema'
import { APP_TIME_ZONE } from '@/lib/timezone'
import { sendPushToUserCore } from '@/lib/push-core'

// P7b: notification store core. Headless (ctx-in, no requireAuthContext/revalidatePath) so the cron
// scan and the reschedule cores can call it directly and it stays DB-integration-testable. Web Push
// is fired best-effort AFTER the row is written — a push failure never aborts the persisted write.
export type Notification = typeof notification.$inferSelect
export type NotificationType = Notification['type']
type LessonRow = typeof lesson.$inferSelect

export interface CreateNotificationInput {
  userId: string
  type: NotificationType
  title: string
  body?: string | null
  url?: string | null
  lessonId?: string | null
  studentId?: string | null
  dedupeKey?: string | null
}

// Postgres unique_violation. Drizzle 0.45 wraps the pg error, so the SQLSTATE lives on the .cause
// chain — walk it (bounded) like errors.ts#isExclusionViolation does for 23P01.
function isUniqueViolation(e: unknown): boolean {
  let cur: unknown = e
  for (let i = 0; i < 5 && cur; i++) {
    if ((cur as { code?: string }).code === '23505') return true
    cur = (cur as { cause?: unknown }).cause
  }
  return false
}

// Insert one notification. When `dedupeKey` is set, at most one row per (tenant, dedupeKey) is
// written: a pre-check short-circuits the common case and a 23505 catch is the race backstop
// (uq_notification_dedupe). Returns the created row, or null when deduped.
export async function createNotificationCore(
  ctx: AuthContext,
  input: CreateNotificationInput,
): Promise<Notification | null> {
  if (input.dedupeKey) {
    const existing = (await forTenant(ctx).select(
      notification,
      eq(notification.dedupeKey, input.dedupeKey),
    )) as Notification[]
    if (existing.length > 0) return null
  }
  try {
    const [row] = (await forTenant(ctx).insert(notification, {
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      url: input.url ?? null,
      lessonId: input.lessonId ?? null,
      studentId: input.studentId ?? null,
      dedupeKey: input.dedupeKey ?? null,
    })) as Notification[]
    return row ?? null
  } catch (e) {
    if (input.dedupeKey && isUniqueViolation(e)) return null // lost the race — already delivered
    throw e
  }
}

// Newest-first, capped at NOTIFICATION_PAGE_SIZE. Ordering + limit run in SQL (idx_notification_tenant_
// user_read covers the userId scan) so a long-lived recipient's full history is never loaded into memory.
export const NOTIFICATION_PAGE_SIZE = 100
export async function listNotificationsForUserCore(ctx: AuthContext): Promise<Notification[]> {
  return (await forTenant(ctx)
    .select(notification, eq(notification.userId, ctx.userId))
    .orderBy(desc(notification.createdAt))
    .limit(NOTIFICATION_PAGE_SIZE)) as Notification[]
}

// SQL COUNT(*), not a row fetch — this runs on EVERY dashboard/portal layout render (the unread badge),
// so it must stay O(1)-payload regardless of how many notifications the user has accumulated.
export async function unreadCountForUserCore(ctx: AuthContext): Promise<number> {
  return forTenant(ctx).count(
    notification,
    and(eq(notification.userId, ctx.userId), isNull(notification.readAt)),
  )
}

// Retention: the reminder scan writes a row per (lesson, offset, recipient) and nothing else ever
// deletes them, so the table would grow unbounded. The cron prunes anything older than
// NOTIFICATION_RETENTION_DAYS — a 90-day-old notification is stale by any measure (its deep-linked
// lesson has long passed) — keeping the table bounded. `now` is injected for testability. Returns the
// number of rows removed.
export const NOTIFICATION_RETENTION_DAYS = 90
export async function pruneOldNotificationsCore(
  ctx: AuthContext,
  now: Date = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - NOTIFICATION_RETENTION_DAYS * 24 * 60 * 60 * 1000)
  const removed = (await forTenant(ctx).deleteWhere(
    notification,
    lt(notification.createdAt, cutoff),
  )) as Notification[]
  return removed.length
}

// Mark one notification read. Defense-in-depth: a user may only mark their OWN — a foreign id
// (or missing row) throws, so the action surfaces "通知不存在" rather than silently touching nothing.
export async function markNotificationReadCore(
  ctx: AuthContext,
  id: string,
): Promise<Notification> {
  const row = (await forTenant(ctx).findById(notification, id)) as Notification | null
  if (!row || row.userId !== ctx.userId) throw new Error('通知不存在')
  const [updated] = (await forTenant(ctx).update(notification, id, {
    readAt: new Date(),
  })) as Notification[]
  return updated
}

// Mark every unread notification of the current user read; returns how many were flipped.
export async function markAllReadCore(ctx: AuthContext): Promise<number> {
  const unread = (await forTenant(ctx).select(
    notification,
    and(eq(notification.userId, ctx.userId), isNull(notification.readAt)),
  )) as Notification[]
  const now = new Date()
  let count = 0
  for (const n of unread) {
    await forTenant(ctx).update(notification, n.id, { readAt: now })
    count++
  }
  return count
}

// Who to notify about a lesson: its teacher ∪ the portal users linked to its actively-enrolled
// students. Deduped; falsy ids dropped. Guards the empty `inArray` (invalid SQL).
export async function resolveLessonRecipientsCore(
  ctx: AuthContext,
  lessonRow: LessonRow,
): Promise<string[]> {
  const recipients = new Set<string>()
  if (lessonRow.teacherId) recipients.add(lessonRow.teacherId)

  const enrolls = (await forTenant(ctx).select(
    enrollment,
    and(eq(enrollment.sectionId, lessonRow.sectionId), eq(enrollment.status, 'active')),
  )) as (typeof enrollment.$inferSelect)[]
  const studentIds = [...new Set(enrolls.map((e) => e.studentId))]
  if (studentIds.length > 0) {
    const links = (await forTenant(ctx).select(
      portalLink,
      inArray(portalLink.studentId, studentIds),
    )) as (typeof portalLink.$inferSelect)[]
    for (const l of links) if (l.userId) recipients.add(l.userId)
  }
  return [...recipients]
}

function fmtLessonTime(startAt: Date | null): string {
  if (!startAt) return ''
  return DateTime.fromJSDate(startAt, { zone: 'utc' })
    .setZone(APP_TIME_ZONE)
    .toFormat('MM月dd日 HH:mm')
}

// Emit a reschedule-outcome notification to the requester (parent/student) and the lesson's teacher,
// then fire best-effort push. Recipients get a deep link to their own center (portal vs dashboard);
// the layout role guards self-correct a mismatched link. Never throws a push error to the caller.
export async function notifyRescheduleOutcomeCore(
  ctx: AuthContext,
  req: { requestedById: string | null; studentId: string | null; reviewNote: string | null },
  lessonRow: LessonRow,
  outcome: 'approved' | 'rejected',
): Promise<void> {
  const type: NotificationType =
    outcome === 'approved' ? 'reschedule_approved' : 'reschedule_rejected'
  const title = outcome === 'approved' ? '改期申请已通过' : '改期申请未通过'
  const body =
    outcome === 'approved'
      ? `新时间:${fmtLessonTime(lessonRow.startAt)}`
      : req.reviewNote
        ? `原因:${req.reviewNote}`
        : '老师未通过本次改期申请'

  const targets: { userId: string; url: string }[] = []
  if (req.requestedById) targets.push({ userId: req.requestedById, url: '/portal/notifications' })
  if (lessonRow.teacherId)
    targets.push({ userId: lessonRow.teacherId, url: '/dashboard/notifications' })

  const seen = new Set<string>()
  for (const t of targets) {
    if (seen.has(t.userId)) continue
    seen.add(t.userId)
    const created = await createNotificationCore(ctx, {
      userId: t.userId,
      type,
      title,
      body,
      url: t.url,
      lessonId: lessonRow.id,
      studentId: req.studentId ?? null,
    })
    if (created) {
      try {
        await sendPushToUserCore(ctx, t.userId, { title, body, url: t.url })
      } catch {
        // best-effort — a push failure must not undo the persisted notification
      }
    }
  }
}
