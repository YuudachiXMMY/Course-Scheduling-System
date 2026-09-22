import 'server-only'
import { eq } from 'drizzle-orm'
import { DateTime } from 'luxon'
import { db } from '@/db'
import { lesson, classSection, sectionMeeting } from '@/db/schema'
import { forTenant } from '@/db/tenant'
import { expandRecurrence, type Occurrence } from './recurrence'
import { buildWeeklyRrule, WEEKDAYS, type Weekday } from './rrule-build'
import { isExclusionViolation } from './errors'
import { APP_TIME_ZONE } from './timezone'
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
  const section = await forTenant(ctx).findById(classSection, sectionId)
  if (!section) return { inserted: 0, conflicts: 0 }
  const zone = section.recurrenceTimezone ?? APP_TIME_ZONE

  // Multi-slot model (Phase-B): each sectionMeeting is one weekday@time. Falls back to the legacy
  // single section.rrule when a section has no meeting rows (backward compatibility).
  const meetings = await forTenant(ctx).select(
    sectionMeeting,
    eq(sectionMeeting.sectionId, sectionId),
  )
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
      // F15: sectionMeeting.byDay is a free-text column; the zod write path validates it, but a row that
      // reached the DB another way (import/backfill/manual edit) would flow straight into rrule.js as an
      // invalid BYDAY and throw an UNCAUGHT exception here. Validate against the known weekdays and skip a
      // bad row (materialization of the other meetings still succeeds) rather than crash the whole call.
      if (!WEEKDAYS.includes(m.byDay as Weekday)) {
        console.error('materializeSection: skipping meeting with invalid byDay', m.id, m.byDay)
        return []
      }
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
    // B46: the stored rrule may embed UNTIL as an ABSOLUTE UTC instant (older sectionRecurrenceColumns
    // did termEnd@23:59:59.toUTC()). expandRecurrence enumerates in FLOATING wall-clock, so rrule.js
    // compares that absolute-UTC UNTIL against floating candidates — for a zone east of UTC the UNTIL
    // lands earlier in the day than an evening class and silently drops the term's final occurrence
    // (e.g. Asia/Shanghai Mon 19:00 on term-end day). windowStart/windowEnd already clip via between(),
    // so strip UNTIL and let the floating-domain window bound the range.
    const rruleFloating = section.rrule!.replace(/;?\bUNTIL=[^;]*/i, '')
    occurrences = expandRecurrence({
      rruleText: rruleFloating,
      wallStart: { year: dt.year, month: dt.month, day: dt.day, hour: dt.hour, minute: dt.minute },
      zone,
      durationMinutes: duration,
      windowStart,
      windowEnd,
    })
  }
  if (!occurrences.length) return { inserted: 0, conflicts: 0 }

  // B47: a rescheduled lesson keeps its ORIGINAL RECURRENCE-ID (originalStartAt) even though its startAt
  // moved. After a pattern change, the NEW pattern's occurrence for that logical week has a DIFFERENT
  // originalStartAt, so onConflictDoNothing (keyed on originalStartAt) won't suppress it — producing a
  // SECOND lesson in a week that already holds the rescheduled exception (their times don't overlap, so
  // the GiST constraint doesn't fire either). Dedupe by ISO week (in the section zone): skip any new
  // occurrence whose week already contains an exception lesson (keyed by the exception's original slot).
  const existingLessons = await forTenant(ctx).select(
    lesson,
    eq(lesson.sectionId, section.id),
  )
  const isoWeek = (d: Date) => DateTime.fromJSDate(d).setZone(zone).toFormat("kkkk'W'WW")
  // F6: only a GENUINE rescheduled exception may suppress a week's fresh pattern occurrence. Such a
  // lesson keeps its ORIGINAL RECURRENCE-ID in originalStartAt (the logical slot it stands in for), so
  // keying exceptionWeeks by that original slot correctly dedupes the re-materialized pattern row.
  // An ad-hoc temp lesson (scheduleLessonCore, schedule-core.ts) is inserted with isException=true but
  // originalStartAt=NULL — it stands in for NO pattern slot. The old `?? l.startAt` fallback let such a
  // temp lesson claim its OWN calendar week, so a later updateSection (which clears future pattern rows,
  // keeps exceptions, then re-materializes) saw that week as "occupied" and skipped it → the recurring
  // lesson was permanently deleted with no error. Excluding null-originalStartAt rows fixes that.
  const exceptionWeeks = new Set(
    existingLessons
      .filter((l) => l.isException && l.originalStartAt != null)
      .map((l) => isoWeek(l.originalStartAt!)),
  )
  const freshOccurrences = occurrences.filter((o) => !exceptionWeeks.has(isoWeek(o.originalStartAt)))
  if (!freshOccurrences.length) return { inserted: 0, conflicts: 0 }

  // Denormalize section.teacherId → lesson.teacherId (else GiST/conflict silently exempts the row).
  const rows = freshOccurrences.map((o) => ({
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
