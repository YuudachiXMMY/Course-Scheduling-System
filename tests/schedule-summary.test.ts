import { describe, it, expect } from 'vitest'
import { summarizeSchedule, type LessonTime } from '@/lib/schedule-summary'

const ZONE = 'America/Toronto'

// A lesson at a given local wall-clock time (America/Toronto). durationHours defaults to 1h.
// We build UTC Dates from a local ISO by hand-picking offsets is fragile, so instead express the
// instant as an explicit UTC ISO — the tests below fix `now` in UTC too, and the month bucket is
// asserted with lessons well inside a month so the -04:00/-05:00 offset never straddles a boundary.
const L = (startUtc: string, durationHours = 1): LessonTime => ({
  startAt: new Date(startUtc),
  endAt: new Date(new Date(startUtc).getTime() + durationHours * 3_600_000),
})

describe('summarizeSchedule — lesson counts and hours', () => {
  // now = 2026-03-15T12:00:00Z (mid-March). Toronto is UTC-4 in summer / UTC-5 in winter; March 15 is
  // still EST (UTC-5), so 12:00Z == 07:00 local — comfortably inside March either way.
  const now = new Date('2026-03-15T12:00:00Z')

  it('totals ALL non-canceled lessons for scheduled; only endAt<now for taught', () => {
    const lessons: LessonTime[] = [
      L('2026-03-01T14:00:00Z', 1.5), // past (before now)
      L('2026-03-10T14:00:00Z', 2), // past
      L('2026-03-20T14:00:00Z', 1), // future (this month)
      L('2026-04-05T14:00:00Z', 3), // future (next month)
    ]
    const s = summarizeSchedule(lessons, null, null, now, ZONE)
    expect(s.totalScheduled.count).toBe(4)
    expect(s.totalScheduled.hours).toBeCloseTo(7.5, 5) // 1.5+2+1+3
    expect(s.totalTaught.count).toBe(2) // only the two March 1/10 lessons finished
    expect(s.totalTaught.hours).toBeCloseTo(3.5, 5) // 1.5+2
  })

  it('a lesson still in progress (started but not ended) is NOT taught', () => {
    // starts 1h before now, 2h long → ends 1h AFTER now → not yet "上完"
    const lessons: LessonTime[] = [L('2026-03-15T11:00:00Z', 2)]
    const s = summarizeSchedule(lessons, null, null, now, ZONE)
    expect(s.totalScheduled.count).toBe(1)
    expect(s.totalTaught.count).toBe(0)
  })

  it('buckets this-month by startAt in the app zone, split into scheduled vs taught', () => {
    const lessons: LessonTime[] = [
      L('2026-02-25T14:00:00Z', 1), // last month
      L('2026-03-02T14:00:00Z', 1), // this month, past
      L('2026-03-12T14:00:00Z', 2), // this month, past
      L('2026-03-25T14:00:00Z', 1.5), // this month, future
      L('2026-04-01T14:00:00Z', 1), // next month
    ]
    const s = summarizeSchedule(lessons, null, null, now, ZONE)
    expect(s.monthScheduled.count).toBe(3) // Mar 2 / 12 / 25
    expect(s.monthScheduled.hours).toBeCloseTo(4.5, 5) // 1+2+1.5
    expect(s.monthTaught.count).toBe(2) // Mar 2 / 12
    expect(s.monthTaught.hours).toBeCloseTo(3, 5) // 1+2
  })

  it('empty lesson list yields zeros', () => {
    const s = summarizeSchedule([], null, null, now, ZONE)
    expect(s.totalScheduled).toEqual({ count: 0, hours: 0 })
    expect(s.totalTaught).toEqual({ count: 0, hours: 0 })
    expect(s.monthScheduled).toEqual({ count: 0, hours: 0 })
    expect(s.monthTaught).toEqual({ count: 0, hours: 0 })
  })
})

describe('summarizeSchedule — semester span (weeks / months)', () => {
  const now = new Date('2026-03-15T12:00:00Z')

  it('returns null semester when either term date is missing', () => {
    expect(summarizeSchedule([], null, new Date('2026-06-01'), now, ZONE).semester).toBeNull()
    expect(summarizeSchedule([], new Date('2026-01-01'), null, now, ZONE).semester).toBeNull()
    expect(summarizeSchedule([], null, null, now, ZONE).semester).toBeNull()
  })

  it('a term that is an EXACT number of weeks/months is NOT rounded up (no endOf-day inflation)', () => {
    // 2026-01-05 .. 2026-02-16 == exactly 6 weeks (42 days)
    const wk = summarizeSchedule(
      [],
      new Date('2026-01-05T00:00:00Z'),
      new Date('2026-02-16T00:00:00Z'),
      new Date('2026-01-01T00:00:00Z'), // now before term → remaining == total
      ZONE,
    ).semester!
    expect(wk.totalWeeks).toBe(6)
    expect(wk.remainingWeeks).toBe(6)

    // 2026-01-05 .. 2026-04-05 == exactly 3 calendar months
    const mo = summarizeSchedule(
      [],
      new Date('2026-01-05T00:00:00Z'),
      new Date('2026-04-05T00:00:00Z'),
      new Date('2026-01-01T00:00:00Z'),
      ZONE,
    ).semester!
    expect(mo.totalMonths).toBe(3)
    expect(mo.remainingMonths).toBe(3)
  })

  it('a single-day term (start == end) reads as 1 week / 1 month, not 0', () => {
    const s = summarizeSchedule(
      [],
      new Date('2026-03-10T00:00:00Z'),
      new Date('2026-03-10T00:00:00Z'),
      new Date('2026-03-09T00:00:00Z'), // now before the single day
      ZONE,
    ).semester!
    expect(s.totalWeeks).toBe(1)
    expect(s.totalMonths).toBe(1)
  })

  it('computes total weeks/months by ceil across the term', () => {
    // term: 2026-01-05 .. 2026-04-10  → ~13.7 weeks, ~3.2 months
    const s = summarizeSchedule(
      [],
      new Date('2026-01-05T00:00:00Z'),
      new Date('2026-04-10T00:00:00Z'),
      now,
      ZONE,
    ).semester!
    expect(s.totalWeeks).toBe(14) // ceil(13.7)
    expect(s.totalMonths).toBe(4) // ceil(3.2) — spans Jan..Apr
  })

  it('remaining is measured from now to end (ceil), clamped at 0 after the term ends', () => {
    // term ended before now → remaining 0, totals still positive
    const past = summarizeSchedule(
      [],
      new Date('2026-01-01T00:00:00Z'),
      new Date('2026-02-01T00:00:00Z'),
      now,
      ZONE,
    ).semester!
    expect(past.remainingWeeks).toBe(0)
    expect(past.remainingMonths).toBe(0)
    expect(past.totalWeeks).toBeGreaterThan(0)

    // now is mid-term → remaining < total and > 0
    const mid = summarizeSchedule(
      [],
      new Date('2026-01-05T00:00:00Z'),
      new Date('2026-04-10T00:00:00Z'),
      now,
      ZONE,
    ).semester!
    expect(mid.remainingWeeks).toBeGreaterThan(0)
    expect(mid.remainingWeeks).toBeLessThan(mid.totalWeeks)
    expect(mid.remainingMonths).toBeGreaterThan(0)
    expect(mid.remainingMonths).toBeLessThanOrEqual(mid.totalMonths)
  })

  it('before the term starts, remaining equals the full term length', () => {
    // now (2026-03-15) is BEFORE this term's start → clamp(now)→start, remaining == total
    const s = summarizeSchedule(
      [],
      new Date('2026-05-01T00:00:00Z'),
      new Date('2026-08-01T00:00:00Z'),
      now,
      ZONE,
    ).semester!
    expect(s.remainingWeeks).toBe(s.totalWeeks)
    expect(s.remainingMonths).toBe(s.totalMonths)
  })
})
