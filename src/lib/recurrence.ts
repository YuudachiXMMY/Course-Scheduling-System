import 'server-only'
import { rrulestr } from 'rrule'
import { DateTime } from 'luxon'

export interface Occurrence {
  startAt: Date // UTC instant for timestamptz
  endAt: Date // UTC instant
  originalStartAt: Date // === startAt at materialization time (the RECURRENCE-ID slot key)
}

// Runaway-expansion guard (P2-2 GOTCHA): reject rules that could enumerate an unbounded / huge set.
const MAX_OCCURRENCES = 500
const MAX_WINDOW_MS = 2 * 366 * 24 * 60 * 60 * 1000 // ~2 years

/**
 * Expand a section's RRULE into concrete UTC occurrences within [windowStart, windowEnd].
 * `rruleText` is an RFC5545 RRULE line WITHOUT DTSTART (as stored). `wallStart` carries the
 * local wall-clock hour/minute of the first occurrence; `zone` is IANA (app default America/Toronto).
 *
 * rrule is used purely as a FLOATING-time enumerator (P2-1): its Date outputs carry wall-clock
 * components in a UTC-stamped Date, read ONLY with getUTC* getters; Luxon owns all zone conversion.
 */
export function expandRecurrence(params: {
  rruleText: string
  wallStart: { year: number; month: number; day: number; hour: number; minute: number }
  zone: string
  durationMinutes: number
  windowStart: Date
  windowEnd: Date
}): Occurrence[] {
  const { rruleText, wallStart, zone, durationMinutes, windowStart, windowEnd } = params
  if (windowEnd.getTime() - windowStart.getTime() > MAX_WINDOW_MS) {
    throw new Error('recurrence window exceeds the 2-year cap')
  }
  // Enumerate in FLOATING time: dtstart is a naive Date carrying the wall-clock components.
  const dtstart = new Date(
    Date.UTC(wallStart.year, wallStart.month - 1, wallStart.day, wallStart.hour, wallStart.minute),
  )
  const rule = rrulestr(rruleText.startsWith('RRULE:') ? rruleText : `RRULE:${rruleText}`, {
    dtstart,
  })

  // Convert the query window (UTC instants) into the same floating space for between().
  const toFloating = (d: Date) => {
    const z = DateTime.fromJSDate(d).setZone(zone)
    return new Date(Date.UTC(z.year, z.month - 1, z.day, z.hour, z.minute, z.second))
  }
  const floatingOccurrences = rule.between(toFloating(windowStart), toFloating(windowEnd), true)
  if (floatingOccurrences.length > MAX_OCCURRENCES) {
    throw new Error(
      `recurrence expands to ${floatingOccurrences.length} occurrences (max ${MAX_OCCURRENCES})`,
    )
  }
  return floatingOccurrences.flatMap((floating) => {
    const reqHour = floating.getUTCHours()
    const reqMinute = floating.getUTCMinutes()
    // Reinterpret the floating wall-clock as `zone`, then to a real UTC instant.
    const local = DateTime.fromObject(
      {
        year: floating.getUTCFullYear(),
        month: floating.getUTCMonth() + 1,
        day: floating.getUTCDate(),
        hour: reqHour,
        minute: reqMinute,
      },
      { zone },
    )
    // CR11: DST spring-forward gap. On the transition day the requested wall-clock time may NOT EXIST
    // (e.g. 02:30 America/Toronto when clocks jump 02:00 → 03:00). Luxon does NOT set .isValid=false for
    // a gap time — it silently rolls the instant forward to the post-transition offset (02:30 → 03:30),
    // which would materialize a lesson at an unintended wall-clock. Detect it by comparing the requested
    // hour/minute to what Luxon resolved; if they differ (or the DateTime is invalid), SKIP the
    // occurrence rather than emit a shifted one. Fall-back (ambiguous) times keep their wall-clock, so
    // this never drops November occurrences. Business-hours class times almost never land in the gap.
    if (!local.isValid || local.hour !== reqHour || local.minute !== reqMinute) {
      return []
    }
    const startAt = local.toUTC().toJSDate()
    const endAt = local.plus({ minutes: durationMinutes }).toUTC().toJSDate()
    return [{ startAt, endAt, originalStartAt: startAt }]
  })
}
