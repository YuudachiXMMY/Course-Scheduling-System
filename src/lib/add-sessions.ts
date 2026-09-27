import 'server-only'
import { DateTime } from 'luxon'
import { classSection } from '@/db/schema'
import { forTenant } from '@/db/tenant'
import { expandRecurrence } from './recurrence'
import { buildRecurrenceRule, type RecurrenceFreq, type Weekday } from './rrule-build'
import { insertLessonsWithConflictFallback } from './lesson-insert'
import { APP_TIME_ZONE } from './timezone'
import type { MaterializeResult } from './materialize'
import type { AuthContext } from '@/auth/context'

export interface AddSessionsInput {
  freq: RecurrenceFreq
  byDays?: Weekday[] // required for WEEKLY / BIWEEKLY (multi-select supported)
  startDate: string // YYYY-MM-DD (inclusive) — the recurrence window lower bound, in the section zone
  endDate: string // YYYY-MM-DD (inclusive) — the recurrence window upper bound
  startTime: string // HH:mm wall-clock in the section zone
  durationMinutes: number
}

// Add ad-hoc lessons to a section by expanding a user-chosen recurrence (daily / weekly / biweekly /
// monthly) over a date period. This is the post-initialization scheduling path (排课 → 添加课节): the
// sectionMeeting grid is only materialized once at creation; every later session is added here.
//
// Mirrors materialize.ts's window + insert logic (bulk INSERT ... ON CONFLICT DO NOTHING with a per-row
// GiST fallback), but the RRULE and window come from explicit input instead of the section grid. Rows are
// keyed on (tenant, section, original_start_at) so re-adding an existing slot is skipped (inserted 0), and
// a teacher time-collision trips the GiST exclusion and is counted as a conflict rather than aborting the
// whole batch.
export async function addSessionsCore(
  ctx: AuthContext,
  sectionId: string,
  input: AddSessionsInput,
): Promise<MaterializeResult> {
  const section = await forTenant(ctx).findById(classSection, sectionId)
  if (!section) return { inserted: 0, conflicts: 0 }
  const zone = section.recurrenceTimezone ?? APP_TIME_ZONE

  const [sy, sm, sd] = input.startDate.split('-').map(Number)
  const [ey, em, ed] = input.endDate.split('-').map(Number)
  const [hh, mm] = input.startTime.split(':').map(Number)

  // Snap the window to the FULL local calendar day in the section zone (same as materialize.ts) so an
  // occurrence late on the final day isn't clipped by between()'s upper bound.
  const windowStart = DateTime.fromObject({ year: sy, month: sm, day: sd }, { zone })
    .startOf('day')
    .toUTC()
    .toJSDate()
  const windowEnd = DateTime.fromObject({ year: ey, month: em, day: ed }, { zone })
    .endOf('day')
    .toUTC()
    .toJSDate()

  const rruleText = buildRecurrenceRule({
    freq: input.freq,
    byDays: input.byDays,
    // MONTHLY repeats on the start date's day-of-month.
    byMonthDay: input.freq === 'MONTHLY' ? sd : undefined,
  })

  const occurrences = expandRecurrence({
    rruleText,
    wallStart: { year: sy, month: sm, day: sd, hour: hh, minute: mm },
    zone,
    durationMinutes: input.durationMinutes,
    windowStart,
    windowEnd,
  })
  if (!occurrences.length) return { inserted: 0, conflicts: 0 }

  // Denormalize section.teacherId → lesson.teacherId (else GiST/conflict silently exempts the row).
  // isException: these are manually-added ad-hoc lessons (not part of the section's canonical grid),
  // mirroring scheduleLessonCore. original_start_at is set so re-adding an existing slot is de-duped.
  const rows = occurrences.map((o) => ({
    tenantId: ctx.tenantId, // assert every row carries the verified tenant (bulk-insert exemption)
    sectionId: section.id,
    teacherId: section.teacherId,
    startAt: o.startAt,
    endAt: o.endAt,
    originalStartAt: o.originalStartAt,
    status: 'scheduled' as const,
    isException: true,
    location: section.defaultLocation,
    meetingUrl: section.defaultMeetingUrl,
  }))

  // Conflict-tolerant bulk insert (dedup on re-add, GiST-collision → per-row fallback) is shared with
  // materialize.ts so both scheduling paths report {inserted, conflicts} identically.
  return insertLessonsWithConflictFallback(rows)
}
