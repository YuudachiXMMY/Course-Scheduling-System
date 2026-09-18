import { describe, it, expect } from 'vitest'
import { buildWeeklyRrule, WEEKDAYS, type Weekday } from '@/lib/rrule-build'

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
