import 'server-only'
import { and, eq, ne, sql } from 'drizzle-orm'
import { DateTime } from 'luxon'
import { forTenant } from '@/db/tenant'
import { lesson } from '@/db/schema'
import type { AuthContext } from '@/auth/context'

export interface ConflictSummary {
  id: string
  title: string | null
  startAt: Date
  endAt: Date
}

export interface ConflictCheck {
  hasConflict: boolean
  conflicts: ConflictSummary[]
  suggestions: Date[] // free start times same day, same duration (Asia/Shanghai wall-clock)
}

/**
 * Teacher double-booking pre-check (P2-3/P2-5). Uses forTenant().select(lesson, extra) so it stays
 * tenant-scoped; the overlap `sql` is passed as the `extra` arg — never a raw unscoped query.
 * Half-open `'[)'` matches the GiST constraint exactly (back-to-back allowed).
 */
export async function checkTeacherConflict(
  ctx: AuthContext,
  args: { teacherId: string; startAt: Date; endAt: Date; excludeLessonId?: string },
): Promise<ConflictCheck> {
  const { teacherId, startAt, endAt, excludeLessonId } = args
  // Bind the bounds as ISO strings with explicit casts: postgres.js can't infer the param type
  // inside tstzrange(...) and fails to serialize a bare Date there.
  const overlaps = sql`tstzrange(${lesson.startAt}, ${lesson.endAt}, '[)') && tstzrange(${startAt.toISOString()}::timestamptz, ${endAt.toISOString()}::timestamptz, '[)')`
  const rows = (await forTenant(ctx).select(
    lesson,
    and(
      eq(lesson.teacherId, teacherId),
      ne(lesson.status, 'canceled'),
      excludeLessonId ? ne(lesson.id, excludeLessonId) : undefined,
      overlaps,
    ),
  )) as (typeof lesson.$inferSelect)[]
  const conflicts: ConflictSummary[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    startAt: r.startAt,
    endAt: r.endAt,
  }))
  const suggestions = conflicts.length
    ? await suggestFreeSlots(ctx, { teacherId, startAt, endAt })
    : []
  return { hasConflict: conflicts.length > 0, conflicts, suggestions }
}

// Scan the SAME calendar day (Asia/Shanghai) in 30-min steps for the first N gaps that fit.
export async function suggestFreeSlots(
  ctx: AuthContext,
  args: { teacherId: string; startAt: Date; endAt: Date },
): Promise<Date[]> {
  const zone = 'Asia/Shanghai'
  const durationMs = args.endAt.getTime() - args.startAt.getTime()
  const day = DateTime.fromJSDate(args.startAt).setZone(zone)
  const dayStart = day.set({ hour: 8, minute: 0, second: 0, millisecond: 0 }) // 08:00 local
  const dayEnd = day.set({ hour: 21, minute: 0, second: 0, millisecond: 0 }) // 21:00 local
  const busy = (await forTenant(ctx).select(
    lesson,
    and(
      eq(lesson.teacherId, args.teacherId),
      ne(lesson.status, 'canceled'),
      sql`${lesson.startAt} >= ${dayStart.toUTC().toISO()}::timestamptz and ${lesson.startAt} < ${dayEnd.toUTC().toISO()}::timestamptz`,
    ),
  )) as (typeof lesson.$inferSelect)[]
  const out: Date[] = []
  for (
    let t = dayStart;
    t.plus({ milliseconds: durationMs }) <= dayEnd && out.length < 3;
    t = t.plus({ minutes: 30 })
  ) {
    const s = t.toUTC().toJSDate()
    const e = t.plus({ milliseconds: durationMs }).toUTC().toJSDate()
    const clash = busy.some((b) => b.startAt < e && s < b.endAt) // half-open overlap
    if (!clash) out.push(s)
  }
  return out
}
