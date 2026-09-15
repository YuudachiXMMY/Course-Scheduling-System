import 'server-only'
import { eq } from 'drizzle-orm'
import { DateTime } from 'luxon'
import { db } from '@/db'
import { lesson, classSection, sectionMeeting } from '@/db/schema'
import { forTenant } from '@/db/tenant'
import { expandRecurrence, type Occurrence } from './recurrence'
import { buildWeeklyRrule, type Weekday } from './rrule-build'
import { isExclusionViolation } from './errors'
import type { AuthContext } from '@/auth/context'

export interface MaterializeResult {
  inserted: number
  conflicts: number // occurrences skipped because they collide with an existing teacher lesson (GiST 23P01)
}

// Expand section.rrule across the term window and INSERT missing lesson rows only.
// ON CONFLICT (uq_lesson_section_slot) DO NOTHING → never touches manually-edited / canceled rows.
export async function materializeSection(
  ctx: AuthContext,
  sectionId: string,
): Promise<MaterializeResult> {
  const section = (await forTenant(ctx).findById(classSection, sectionId)) as
    typeof classSection.$inferSelect | null
  if (!section) return { inserted: 0, conflicts: 0 }
  const zone = section.recurrenceTimezone ?? 'Asia/Shanghai'

  // Multi-slot model (Phase-B): each sectionMeeting is one weekday@time. Falls back to the legacy
  // single section.rrule when a section has no meeting rows (backward compatibility).
  const meetings = (await forTenant(ctx).select(
    sectionMeeting,
    eq(sectionMeeting.sectionId, sectionId),
  )) as (typeof sectionMeeting.$inferSelect)[]
  const hasMeetings = meetings.length > 0

  // A window anchor is required: term start (preferred) or the legacy recurrenceDtstart.
  const windowAnchor = section.termStartDate ?? section.recurrenceDtstart
  if (!windowAnchor) return { inserted: 0, conflicts: 0 }
  if (!hasMeetings && (!section.rrule || !section.recurrenceDtstart)) {
    return { inserted: 0, conflicts: 0 }
  }

  // term_start_date / term_end_date are stored at UTC midnight, but the section runs in `zone`
  // (e.g. +08 → UTC midnight is 08:00 local). Snap the window to the FULL local calendar day so
  // occurrences late on the final day (after 08:00 local) aren't clipped by between()'s upper bound.
  const localDayBound = (d: Date, edge: 'start' | 'end') => {
    const utc = DateTime.fromJSDate(d, { zone: 'utc' })
    const local = DateTime.fromObject({ year: utc.year, month: utc.month, day: utc.day }, { zone })
    return (edge === 'start' ? local.startOf('day') : local.endOf('day')).toUTC().toJSDate()
  }
  const windowStart = section.termStartDate
    ? localDayBound(section.termStartDate, 'start')
    : windowAnchor
  const windowEnd = section.termEndDate
    ? localDayBound(section.termEndDate, 'end')
    : new Date(windowStart.getTime() + 16 * 7 * 864e5) // +16 weeks fallback

  let occurrences: Occurrence[]
  if (hasMeetings) {
    // Anchor date = term start calendar day (UTC-midmight parts); each meeting supplies its own
    // wall-clock time + duration. between(windowStart,windowEnd) clips the range, so per-meeting
    // RRULEs need no UNTIL. Different times on the same day get distinct originalStartAt keys.
    const dateAnchor = DateTime.fromJSDate(windowAnchor, { zone: 'utc' })
    occurrences = meetings.flatMap((m) => {
      const [hh, mm] = m.startTime.split(':').map(Number)
      return expandRecurrence({
        rruleText: buildWeeklyRrule({ byDays: [m.byDay as Weekday] }),
        wallStart: {
          year: dateAnchor.year,
          month: dateAnchor.month,
          day: dateAnchor.day,
          hour: hh,
          minute: mm,
        },
        zone,
        durationMinutes: m.durationMinutes,
        windowStart,
        windowEnd,
      })
    })
  } else {
    // Legacy single-RRULE path. Derive wall-clock parts of recurrenceDtstart in the zone, then expand.
    const duration = section.defaultDurationMinutes ?? 60
    const dt = DateTime.fromJSDate(section.recurrenceDtstart!).setZone(zone)
    occurrences = expandRecurrence({
      rruleText: section.rrule!,
      wallStart: { year: dt.year, month: dt.month, day: dt.day, hour: dt.hour, minute: dt.minute },
      zone,
      durationMinutes: duration,
      windowStart,
      windowEnd,
    })
  }
  if (!occurrences.length) return { inserted: 0, conflicts: 0 }

  // Denormalize section.teacherId → lesson.teacherId (else GiST/conflict silently exempts the row).
  const rows = occurrences.map((o) => ({
    tenantId: ctx.tenantId, // assert every row carries the verified tenant (bulk-insert exemption)
    sectionId: section.id,
    teacherId: section.teacherId,
    startAt: o.startAt,
    endAt: o.endAt,
    originalStartAt: o.originalStartAt,
    status: 'scheduled' as const,
    location: section.defaultLocation,
    meetingUrl: section.defaultMeetingUrl,
  }))

  const target = [lesson.tenantId, lesson.sectionId, lesson.originalStartAt]

  // Fast path: one bulk insert. A batch that overlaps EXISTING lessons can itself trip the GiST
  // constraint (23P01) — fall back to per-occurrence inserts so good slots still land and conflicting
  // ones are reported, instead of aborting the whole batch (P2-7 GOTCHA).
  try {
    const res = await db
      .insert(lesson)
      .values(rows)
      .onConflictDoNothing({ target })
      .returning({ id: lesson.id })
    return { inserted: res.length, conflicts: 0 }
  } catch (e) {
    if (!isExclusionViolation(e)) throw e
    let inserted = 0
    let conflicts = 0
    for (const row of rows) {
      try {
        const res = await db
          .insert(lesson)
          .values(row)
          .onConflictDoNothing({ target })
          .returning({ id: lesson.id })
        inserted += res.length
      } catch (inner) {
        if (isExclusionViolation(inner)) conflicts += 1
        else throw inner
      }
    }
    return { inserted, conflicts }
  }
}
