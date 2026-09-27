import 'server-only'
import { and, eq, ne, sql } from 'drizzle-orm'
import { DateTime } from 'luxon'
import { db } from '@/db'
import { forTenant, type TenantExecutor } from '@/db/tenant'
import { lesson } from '@/db/schema'
import { APP_TIME_ZONE } from './timezone'
import type { AuthContext } from '@/auth/context'

// H7: optional transaction executor threaded from the schedule cores. When approveRescheduleRequestCore
// runs the move inside a db.transaction, these read-only pre-checks MUST use that same `tx` connection —
// otherwise they borrow a SECOND connection from the shared pool while the txn still reserves the first,
// and ~pool-size concurrent approvals deadlock the pool (postgres-js has no acquire timeout). Defaults to
// the module db for every other caller (byte-identical).
type Exec = TenantExecutor

export interface ConflictSummary {
  id: string
  title: string | null
  startAt: Date
  endAt: Date
}

export interface ConflictCheck {
  hasConflict: boolean
  conflicts: ConflictSummary[]
  suggestions: Date[] // free start times same day, same duration (in the section's zone, CR10)
}

/**
 * Teacher double-booking pre-check (P2-3/P2-5). Uses forTenant().select(lesson, extra) so it stays
 * tenant-scoped; the overlap `sql` is passed as the `extra` arg — never a raw unscoped query.
 * Half-open `'[)'` matches the GiST constraint exactly (back-to-back allowed).
 *
 * Conflict scope is a SINGLE CLASS: when `sectionId` is supplied the overlap query is restricted to
 * lessons of that same section, so the same teacher may hold overlapping lessons in DIFFERENT sections
 * (cross-class conflicts are permitted). This mirrors the section-scoped `lesson_no_teacher_overlap`
 * GiST constraint (drizzle/0022). Callers always pass the section they are scheduling into; a missing
 * sectionId falls back to the tenant-wide teacher check (kept only as a defensive default).
 */
export async function checkTeacherConflict(
  ctx: AuthContext,
  args: {
    teacherId: string
    startAt: Date
    endAt: Date
    excludeLessonId?: string
    // Restrict conflict detection to this class (section). Overlaps in other sections are allowed.
    sectionId?: string
    // CR10: the zone used for the free-slot business-hours window. Threaded from the section's
    // recurrenceTimezone by the schedule cores; defaults to APP_TIME_ZONE (the app-wide default).
    zone?: string
  },
  exec: Exec = db,
): Promise<ConflictCheck> {
  const { teacherId, startAt, endAt, excludeLessonId, sectionId, zone } = args
  // Bind the bounds as ISO strings with explicit casts: postgres.js can't infer the param type
  // inside tstzrange(...) and fails to serialize a bare Date there.
  const overlaps = sql`tstzrange(${lesson.startAt}, ${lesson.endAt}, '[)') && tstzrange(${startAt.toISOString()}::timestamptz, ${endAt.toISOString()}::timestamptz, '[)')`
  const rows = await forTenant(ctx, exec).select(
    lesson,
    and(
      eq(lesson.teacherId, teacherId),
      sectionId ? eq(lesson.sectionId, sectionId) : undefined, // conflicts scoped to one class
      ne(lesson.status, 'canceled'),
      excludeLessonId ? ne(lesson.id, excludeLessonId) : undefined,
      overlaps,
    ),
  )
  const conflicts: ConflictSummary[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    startAt: r.startAt,
    endAt: r.endAt,
  }))
  const suggestions = conflicts.length
    ? await suggestFreeSlots(ctx, { teacherId, sectionId, startAt, endAt, zone }, exec)
    : []
  return { hasConflict: conflicts.length > 0, conflicts, suggestions }
}

// Scan the SAME calendar day in 30-min steps for the first N gaps that fit. The day/window is
// interpreted in `args.zone` (CR10: the section's recurrenceTimezone), defaulting to APP_TIME_ZONE.
// `sectionId` scopes "busy" to the same class, matching checkTeacherConflict — a slot occupied only by
// the teacher's OTHER sections is now free (cross-class overlaps are allowed), so it may be suggested.
export async function suggestFreeSlots(
  ctx: AuthContext,
  args: { teacherId: string; sectionId?: string; startAt: Date; endAt: Date; zone?: string },
  exec: Exec = db,
): Promise<Date[]> {
  const zone = args.zone ?? APP_TIME_ZONE
  const durationMs = args.endAt.getTime() - args.startAt.getTime()
  const day = DateTime.fromJSDate(args.startAt).setZone(zone)
  const dayStart = day.set({ hour: 8, minute: 0, second: 0, millisecond: 0 }) // 08:00 local
  const dayEnd = day.set({ hour: 21, minute: 0, second: 0, millisecond: 0 }) // 21:00 local
  // CR9: fetch lessons that OVERLAP the business-hours window, not just those STARTING inside it. A
  // lesson beginning before dayStart (e.g. 07:30–08:30) still occupies early slots; filtering by
  // startAt alone missed it and wrongly offered 08:00/08:30 as free. Mirror checkTeacherConflict's
  // tstzrange overlap (half-open '[)') and its explicit ::timestamptz casts (postgres.js param typing).
  const busy = await forTenant(ctx, exec).select(
    lesson,
    and(
      eq(lesson.teacherId, args.teacherId),
      args.sectionId ? eq(lesson.sectionId, args.sectionId) : undefined, // same-class scope
      ne(lesson.status, 'canceled'),
      sql`tstzrange(${lesson.startAt}, ${lesson.endAt}, '[)') && tstzrange(${dayStart.toUTC().toISO()}::timestamptz, ${dayEnd.toUTC().toISO()}::timestamptz, '[)')`,
    ),
  )
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
