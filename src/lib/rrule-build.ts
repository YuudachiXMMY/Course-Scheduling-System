// Pure UI helper (no server-only, no DB) — builds an RFC5545 RRULE string WITHOUT a DTSTART line
// (the schema stores recurrence_dtstart separately). Reusable by both the section form and Phase-6.
import { DateTime } from 'luxon'

export type Weekday = 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'SU'

export const WEEKDAYS: Weekday[] = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']

/**
 * Build a weekly RRULE like `FREQ=WEEKLY;BYDAY=MO,WE`. Optionally bound with UNTIL (a UTC instant,
 * emitted as a UTC `...Z` stamp) or COUNT. `until` and `count` are mutually exclusive per RFC5545.
 */
export function buildWeeklyRrule(params: {
  byDays: Weekday[]
  until?: Date
  count?: number
}): string {
  const { byDays, until, count } = params
  if (!byDays.length) throw new Error('buildWeeklyRrule: at least one weekday is required')
  const parts = ['FREQ=WEEKLY', `BYDAY=${byDays.join(',')}`]
  if (until && count) throw new Error('buildWeeklyRrule: pass only one of until/count')
  if (count !== undefined) {
    if (!Number.isInteger(count) || count < 1)
      throw new Error('buildWeeklyRrule: count must be a positive integer')
    parts.push(`COUNT=${count}`)
  } else if (until) {
    // RFC5545 UNTIL in UTC form: YYYYMMDDTHHMMSSZ
    parts.push(`UNTIL=${DateTime.fromJSDate(until).toUTC().toFormat("yyyyLLdd'T'HHmmss'Z'")}`)
  }
  return parts.join(';')
}

// The four recurrences the ad-hoc「添加课节」flow offers. Biweekly is not an RFC5545 FREQ — it's a
// weekly rule with INTERVAL=2. Monthly repeats on a fixed day-of-month (BYMONTHDAY).
// Single source of truth: the const tuple backs both the type and the zod enum in the add-sessions
// Server Action, and the <select> options in the 排课 UI — add a fifth frequency in ONE place.
export const RECURRENCE_FREQS = ['DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY'] as const
export type RecurrenceFreq = (typeof RECURRENCE_FREQS)[number]

/**
 * Build a bare RRULE (NO DTSTART / UNTIL / COUNT) for the「添加课节」flow. The caller bounds the range
 * with expandRecurrence's between(windowStart, windowEnd) — mirroring the per-meeting RRULE path in
 * materialize.ts — so the date period the user picks is the only bound, not the rule.
 *  - DAILY    → `FREQ=DAILY`
 *  - WEEKLY   → `FREQ=WEEKLY;BYDAY=MO,WE` (byDays required, multi-select supported)
 *  - BIWEEKLY → `FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE`
 *  - MONTHLY  → `FREQ=MONTHLY;BYMONTHDAY=15` (byMonthDay required, 1..31)
 */
export function buildRecurrenceRule(params: {
  freq: RecurrenceFreq
  byDays?: Weekday[]
  byMonthDay?: number
}): string {
  const { freq, byDays, byMonthDay } = params
  switch (freq) {
    case 'DAILY':
      return 'FREQ=DAILY'
    case 'WEEKLY':
    case 'BIWEEKLY': {
      if (!byDays || !byDays.length)
        throw new Error('buildRecurrenceRule: at least one weekday is required for weekly/biweekly')
      const parts = ['FREQ=WEEKLY']
      if (freq === 'BIWEEKLY') parts.push('INTERVAL=2')
      parts.push(`BYDAY=${byDays.join(',')}`)
      return parts.join(';')
    }
    case 'MONTHLY': {
      if (
        byMonthDay === undefined ||
        !Number.isInteger(byMonthDay) ||
        byMonthDay < 1 ||
        byMonthDay > 31
      )
        throw new Error('buildRecurrenceRule: monthly requires a day of month between 1 and 31')
      return `FREQ=MONTHLY;BYMONTHDAY=${byMonthDay}`
    }
  }
}
