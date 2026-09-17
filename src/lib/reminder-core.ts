import 'server-only'
import { and, eq, gt, lte } from 'drizzle-orm'
import { DateTime } from 'luxon'
import type { AuthContext } from '@/auth/context'
import { forTenant } from '@/db/tenant'
import { lesson } from '@/db/schema'
import { APP_TIME_ZONE } from '@/lib/timezone'
import { createNotificationCore, resolveLessonRecipientsCore } from '@/lib/notification-core'
import { sendPushToUserCore } from '@/lib/push-core'

// P7b: fixed reminder offsets. A single constant keeps this trivially extensible (add a channel /
// offset later without touching the producer). No per-user preferences / quiet hours in this phase.
export const REMINDER_OFFSETS = [
  { label: '24h', minutes: 24 * 60 },
  { label: '1h', minutes: 60 },
] as const

function fmtLessonTime(startAt: Date): string {
  return DateTime.fromJSDate(startAt, { zone: 'utc' })
    .setZone(APP_TIME_ZONE)
    .toFormat('MM月dd日 HH:mm')
}

// Scan upcoming lessons for each offset window and write reminders idempotently. `now` is injected
// so tests pass a fixed instant (no fake timers — codebase convention). Re-running with the same
// `now` creates nothing new: the per-(lesson, offset, user) dedupeKey backs uq_notification_dedupe.
export async function runReminderScanCore(
  ctx: AuthContext,
  now: Date = new Date(),
): Promise<{ created: number }> {
  let created = 0
  for (const offset of REMINDER_OFFSETS) {
    const from = now
    const to = new Date(now.getTime() + offset.minutes * 60_000)
    // The imminent (1h) offset carries a distinct title so a lesson caught in BOTH windows within one
    // scan (started <1h out) yields two non-identical reminders rather than a duplicate.
    const title = offset.label === '1h' ? '课程即将开始' : '课前提醒'
    // gt(lower) / lte(upper): exclusive lower, inclusive upper so a lesson on a boundary isn't
    // double-counted between adjacent scans. Only 'scheduled' lessons get reminders.
    const lessons = (await forTenant(ctx).select(
      lesson,
      and(gt(lesson.startAt, from), lte(lesson.startAt, to), eq(lesson.status, 'scheduled')),
    )) as (typeof lesson.$inferSelect)[]

    for (const l of lessons) {
      const recipients = await resolveLessonRecipientsCore(ctx, l)
      if (recipients.length === 0) continue
      const body = `课程将于 ${fmtLessonTime(l.startAt)} 开始`
      for (const userId of recipients) {
        const url = userId === l.teacherId ? '/dashboard/notifications' : '/portal/notifications'
        // dedupeKey includes the lesson's start instant so a rescheduled lesson (same id, new time)
        // gets a FRESH reminder instead of colliding with the stale-time reminder's key. Same-scan
        // idempotency still holds: identical (id, offset, startAt, user) → identical key.
        const dedupeKey = `reminder:${l.id}:${offset.label}:${l.startAt.getTime()}:${userId}`
        const row = await createNotificationCore(ctx, {
          userId,
          type: 'lesson_reminder',
          title,
          body,
          url,
          lessonId: l.id,
          dedupeKey,
        })
        if (row) {
          created++
          try {
            await sendPushToUserCore(ctx, userId, { title, body, url })
          } catch {
            // best-effort push — never let it abort the scan
          }
        }
      }
    }
  }
  return { created }
}
