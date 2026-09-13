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
