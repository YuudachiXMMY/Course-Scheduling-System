import { describe, it, expect } from 'vitest'
import { DateTime } from 'luxon'
import { expandRecurrence } from '@/lib/recurrence'
import { buildWeeklyRrule, type Weekday } from '@/lib/rrule-build'

// Covers the CORE of the multi-slot materializer (src/lib/materialize.ts): a section with several
// sectionMeeting rows expands each as its own weekly RRULE at its own wall-clock time + duration,
// then merges them. This is the pure, DB-free half of req3 (the end-to-end insert is DB-backed and
// lives in materialize.ts / its integration test which needs a live Postgres).

const ZONE = 'Asia/Shanghai'

interface Meeting {
  byDay: Weekday
  startTime: string
  durationMinutes: number
}

// Mirror materialize.ts: anchor date = term-start calendar day; each meeting supplies its own time.
function expandMeetings(meetings: Meeting[], termStart: string, windowStart: Date, windowEnd: Date) {
  const [y, mo, d] = termStart.split('-').map(Number)
  return meetings.flatMap((m) => {
    const [hh, mm] = m.startTime.split(':').map(Number)
    return expandRecurrence({
      rruleText: buildWeeklyRrule({ byDays: [m.byDay] }),
      wallStart: { year: y, month: mo, day: d, hour: hh, minute: mm },
      zone: ZONE,
      durationMinutes: m.durationMinutes,
      windowStart,
      windowEnd,
    })
  })
}

describe('multi-slot section expansion', () => {
  // 2026-01-05 is a Monday; window covers 4 weeks.
  const windowStart = DateTime.fromObject({ year: 2026, month: 1, day: 5 }, { zone: ZONE })
    .toUTC()
    .toJSDate()
  const windowEnd = DateTime.fromObject({ year: 2026, month: 2, day: 1 }, { zone: ZONE })
    .toUTC()
    .toJSDate()

  it('two meetings on different days/times produce two distinct occurrence sets', () => {
    const occ = expandMeetings(
      [
        { byDay: 'MO', startTime: '16:00', durationMinutes: 60 },
        { byDay: 'WE', startTime: '18:00', durationMinutes: 90 },
      ],
      '2026-01-05',
      windowStart,
      windowEnd,
    )

    const locals = occ
      .map((o) => DateTime.fromJSDate(o.startAt, { zone: 'utc' }).setZone(ZONE))
      .sort((a, b) => a.toMillis() - b.toMillis())

    // 4 Mondays + 4 Wednesdays in the window.
    const mondays = locals.filter((l) => l.weekday === 1)
    const wednesdays = locals.filter((l) => l.weekday === 3)
    expect(mondays).toHaveLength(4)
    expect(wednesdays).toHaveLength(4)

    // Monday slot at 16:00 / 60min, Wednesday slot at 18:00 / 90min.
    expect(mondays.every((l) => l.hour === 16 && l.minute === 0)).toBe(true)
    expect(wednesdays.every((l) => l.hour === 18 && l.minute === 0)).toBe(true)

    const mo0 = occ.find(
      (o) => DateTime.fromJSDate(o.startAt, { zone: 'utc' }).setZone(ZONE).weekday === 1,
    )!
    const durMo = (mo0.endAt.getTime() - mo0.startAt.getTime()) / 60000
    expect(durMo).toBe(60)
    const we0 = occ.find(
      (o) => DateTime.fromJSDate(o.startAt, { zone: 'utc' }).setZone(ZONE).weekday === 3,
    )!
    const durWe = (we0.endAt.getTime() - we0.startAt.getTime()) / 60000
    expect(durWe).toBe(90)
  })

  it('two meetings on the SAME day at different times get distinct originalStartAt keys', () => {
    // uq_lesson_section_slot keys on (tenant, section, originalStartAt) — same-day slots must differ.
    const occ = expandMeetings(
      [
        { byDay: 'MO', startTime: '09:00', durationMinutes: 60 },
        { byDay: 'MO', startTime: '16:00', durationMinutes: 60 },
      ],
      '2026-01-05',
      windowStart,
      windowEnd,
    )
    const keys = occ.map((o) => o.originalStartAt.toISOString())
    expect(new Set(keys).size).toBe(keys.length) // all unique
    expect(occ).toHaveLength(8) // 4 mornings + 4 afternoons
  })
})
