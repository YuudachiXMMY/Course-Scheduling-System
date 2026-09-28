// PURE schedule-summary aggregators — NO db / no server-only imports, so they are directly
// unit-testable and client-safe (mirrors report-stats.ts). Numbers are computed here from raw lesson
// times; the caller passes the real `now` (computed server-side) so client render stays pure — no
// Date.now() reaches the browser (see teach/[sectionId]/data.ts SectionLesson.isPast for the same rule).

import { DateTime } from 'luxon'

// Minimal shape the aggregator needs from a lesson. Callers pass ALL non-canceled lessons of a section
// (canceled tombstones are filtered upstream, matching getSectionLessons).
export interface LessonTime {
  startAt: Date
  endAt: Date
}

export interface LessonStats {
  count: number
  hours: number // sum of (endAt-startAt), rounded to 1 decimal at the total (not per-lesson, to avoid drift)
}

export interface SemesterSpan {
  totalWeeks: number
  totalMonths: number
  remainingWeeks: number // now→end, clamped so before-term == total and after-term == 0
  remainingMonths: number
}

export interface ScheduleSummary {
  totalScheduled: LessonStats // every non-canceled lesson
  totalTaught: LessonStats // subset already finished (endAt < now)
  monthScheduled: LessonStats // startAt in the current calendar month (app zone)
  monthTaught: LessonStats // this-month subset already finished
  semester: SemesterSpan | null // null unless BOTH term dates are set
}

const hoursBetween = (l: LessonTime): number =>
  (l.endAt.getTime() - l.startAt.getTime()) / 3_600_000

// Round a summed hour total to 1 decimal. Summing first then rounding avoids per-lesson rounding drift.
const round1 = (n: number): number => Math.round(n * 10) / 10

const statsOf = (lessons: LessonTime[]): LessonStats => ({
  count: lessons.length,
  hours: round1(lessons.reduce((acc, l) => acc + hoursBetween(l), 0)),
})

// "已经上了" mirrors getSectionLessons' isPast: a lesson counts as taught once it has FINISHED (endAt <
// now). An in-progress lesson (started, not ended) is not yet taught.
const isTaught = (l: LessonTime, nowMs: number): boolean => l.endAt.getTime() < nowMs

// term_start/end_date are `date` columns (UTC-midnight Dates). The class runs in the app zone, so
// interpret each stored y/m/d as a LOCAL calendar day at its START (00:00 local). Both endpoints use
// start-of-day so the diff is a whole-day span: a term defined as an exact number of weeks/months
// (e.g. a "6-week term", 2026-01-05..2026-02-16) measures as exactly 6, not 7 — snapping the END to
// end-of-day would add ~1 day and push ceil() up by one for every exact-length term. (Contrast
// getSectionLessons' localDayBound, which DOES snap to end-of-day — correct there because it builds an
// INCLUSIVE lesson-query window, a different purpose than span arithmetic.)
function localCalendarDay(d: Date, zone: string): DateTime {
  const utc = DateTime.fromJSDate(d, { zone: 'utc' })
  return DateTime.fromObject({ year: utc.year, month: utc.month, day: utc.day }, { zone }).startOf(
    'day',
  )
}

function computeSemesterSpan(
  termStart: Date | null,
  termEnd: Date | null,
  now: Date,
  zone: string,
): SemesterSpan | null {
  if (!termStart || !termEnd) return null
  const start = localCalendarDay(termStart, zone)
  const end = localCalendarDay(termEnd, zone)
  const nowDt = DateTime.fromJSDate(now, { zone })

  // Total spans the whole term; ceil so a partial trailing week/month still counts ("跨越 N 周/月").
  // Floor at 1: a configured term (server validates termEnd >= termStart) always occupies at least one
  // week/month — a single-day term (start == end, diff 0) should read "1 周 · 1 个月", not "0" (which
  // would look like no term is set at all). Any multi-day term already ceils to >= 1.
  const totalWeeks = Math.max(1, Math.ceil(end.diff(start, 'weeks').weeks))
  const totalMonths = Math.max(1, Math.ceil(end.diff(start, 'months').months))

  // Remaining is measured from now, clamped into [start, end]: before the term it equals the full
  // length; after it, zero.
  const clamped = nowDt < start ? start : nowDt > end ? end : nowDt
  const remainingWeeks = Math.max(0, Math.ceil(end.diff(clamped, 'weeks').weeks))
  const remainingMonths = Math.max(0, Math.ceil(end.diff(clamped, 'months').months))

  return { totalWeeks, totalMonths, remainingWeeks, remainingMonths }
}

export function summarizeSchedule(
  lessons: LessonTime[],
  termStart: Date | null,
  termEnd: Date | null,
  now: Date,
  zone: string,
): ScheduleSummary {
  const nowMs = now.getTime()
  const nowDt = DateTime.fromJSDate(now, { zone })

  const taught = lessons.filter((l) => isTaught(l, nowMs))
  const thisMonth = lessons.filter((l) => {
    const s = DateTime.fromJSDate(l.startAt, { zone })
    return s.year === nowDt.year && s.month === nowDt.month
  })
  const monthTaught = thisMonth.filter((l) => isTaught(l, nowMs))

  return {
    totalScheduled: statsOf(lessons),
    totalTaught: statsOf(taught),
    monthScheduled: statsOf(thisMonth),
    monthTaught: statsOf(monthTaught),
    semester: computeSemesterSpan(termStart, termEnd, now, zone),
  }
}
