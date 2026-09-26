import { describe, it, expect } from 'vitest'
import { buildWeeklyRrule, buildRecurrenceRule, WEEKDAYS, type Weekday } from '@/lib/rrule-build'

// Pure RFC5545 RRULE builder (luxon only, no DB/server-only). recurrence.test.ts already exercises the
// happy `{ byDays, count }` path via expandRecurrence; this file targets the remaining branches:
// the empty-days guard, the until/count mutual-exclusion, the count validation, and the UNTIL UTC
// formatting — the paths that account for the module's uncovered branch coverage.
describe('buildWeeklyRrule', () => {
  it('builds a bare weekly rule (no bound) from the weekday list', () => {
    expect(buildWeeklyRrule({ byDays: ['MO', 'WE'] })).toBe('FREQ=WEEKLY;BYDAY=MO,WE')
  })

  it('preserves weekday order as given', () => {
    expect(buildWeeklyRrule({ byDays: ['FR', 'MO', 'SU'] })).toBe('FREQ=WEEKLY;BYDAY=FR,MO,SU')
  })

  it('throws when no weekday is provided', () => {
    expect(() => buildWeeklyRrule({ byDays: [] })).toThrow(/at least one weekday/)
  })

  it('appends COUNT for a positive integer count', () => {
    expect(buildWeeklyRrule({ byDays: ['MO'], count: 8 })).toBe('FREQ=WEEKLY;BYDAY=MO;COUNT=8')
  })

  it('rejects a non-integer count', () => {
    expect(() => buildWeeklyRrule({ byDays: ['MO'], count: 2.5 })).toThrow(/positive integer/)
  })

  it('rejects a zero or negative count', () => {
    expect(() => buildWeeklyRrule({ byDays: ['MO'], count: 0 })).toThrow(/positive integer/)
    expect(() => buildWeeklyRrule({ byDays: ['MO'], count: -3 })).toThrow(/positive integer/)
  })

  it('appends UNTIL as a UTC ...Z stamp', () => {
    // 2026-06-15T13:30:00Z → RFC5545 UTC form YYYYMMDDTHHMMSSZ (machine-TZ independent).
    const until = new Date('2026-06-15T13:30:00Z')
    expect(buildWeeklyRrule({ byDays: ['TU', 'TH'], until })).toBe(
      'FREQ=WEEKLY;BYDAY=TU,TH;UNTIL=20260615T133000Z',
    )
  })

  it('throws when both until and count are supplied (RFC5545 mutual exclusion)', () => {
    expect(() =>
      buildWeeklyRrule({ byDays: ['MO'], until: new Date('2026-06-15T00:00:00Z'), count: 5 }),
    ).toThrow(/only one of until\/count/)
  })

  it('exports the seven ISO weekday tokens in Monday-first order', () => {
    expect(WEEKDAYS).toEqual<Weekday[]>(['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'])
  })
})

// The ad-hoc「添加课节」flow (排课 → 添加课节) needs DAILY / WEEKLY / BIWEEKLY / MONTHLY, which the
// weekly-only builder can't express. buildRecurrenceRule emits a bare RRULE (NO UNTIL/COUNT/DTSTART):
// expandRecurrence's between(windowStart, windowEnd) clips the range, exactly like the sectionMeeting
// path in materialize.ts, so the date range is bounded by the query window, not by the rule.
describe('buildRecurrenceRule', () => {
  it('builds a daily rule', () => {
    expect(buildRecurrenceRule({ freq: 'DAILY' })).toBe('FREQ=DAILY')
  })

  it('builds a weekly rule with one or more weekdays', () => {
    expect(buildRecurrenceRule({ freq: 'WEEKLY', byDays: ['MO'] })).toBe('FREQ=WEEKLY;BYDAY=MO')
    expect(buildRecurrenceRule({ freq: 'WEEKLY', byDays: ['MO', 'WE', 'FR'] })).toBe(
      'FREQ=WEEKLY;BYDAY=MO,WE,FR',
    )
  })

  it('builds a biweekly rule as FREQ=WEEKLY;INTERVAL=2', () => {
    expect(buildRecurrenceRule({ freq: 'BIWEEKLY', byDays: ['TU', 'TH'] })).toBe(
      'FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH',
    )
  })

  it('builds a monthly rule pinned to a day-of-month', () => {
    expect(buildRecurrenceRule({ freq: 'MONTHLY', byMonthDay: 15 })).toBe(
      'FREQ=MONTHLY;BYMONTHDAY=15',
    )
  })

  it('requires at least one weekday for weekly / biweekly', () => {
    expect(() => buildRecurrenceRule({ freq: 'WEEKLY', byDays: [] })).toThrow(
      /at least one weekday/,
    )
    expect(() => buildRecurrenceRule({ freq: 'BIWEEKLY' })).toThrow(/at least one weekday/)
  })

  it('requires a valid day-of-month (1..31) for monthly', () => {
    expect(() => buildRecurrenceRule({ freq: 'MONTHLY' })).toThrow(/day of month/)
    expect(() => buildRecurrenceRule({ freq: 'MONTHLY', byMonthDay: 0 })).toThrow(/day of month/)
    expect(() => buildRecurrenceRule({ freq: 'MONTHLY', byMonthDay: 32 })).toThrow(/day of month/)
    expect(() => buildRecurrenceRule({ freq: 'MONTHLY', byMonthDay: 12.5 })).toThrow(/day of month/)
  })
})
