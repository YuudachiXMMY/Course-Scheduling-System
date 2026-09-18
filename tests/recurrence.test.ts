import { describe, it, expect } from 'vitest'
import { DateTime } from 'luxon'
import { expandRecurrence } from '@/lib/recurrence'
import { buildWeeklyRrule } from '@/lib/rrule-build'

const ZONE = 'Asia/Shanghai'

describe('expandRecurrence', () => {
  it('weekly Monday over a 4-week window yields 4 occurrences at 16:00 local (08:00 UTC)', () => {
    // 2026-01-05 is a Monday.
    const windowStart = DateTime.fromObject({ year: 2026, month: 1, day: 5 }, { zone: ZONE })
      .toUTC()
      .toJSDate()
    const windowEnd = DateTime.fromObject({ year: 2026, month: 2, day: 1 }, { zone: ZONE })
      .toUTC()
      .toJSDate()
    const occ = expandRecurrence({
      rruleText: 'FREQ=WEEKLY;BYDAY=MO',
      wallStart: { year: 2026, month: 1, day: 5, hour: 16, minute: 0 },
      zone: ZONE,
      durationMinutes: 60,
      windowStart,
      windowEnd,
    })
    expect(occ).toHaveLength(4)
    for (const o of occ) {
      expect(o.startAt.getUTCHours()).toBe(8) // 16:00 Asia/Shanghai == 08:00 UTC
      expect(o.startAt.getUTCMinutes()).toBe(0)
      expect(o.endAt.getTime() - o.startAt.getTime()).toBe(60 * 60 * 1000)
      expect(o.originalStartAt.getTime()).toBe(o.startAt.getTime())
    }
  })

  it('count=3 rule yields exactly 3 occurrences', () => {
    const windowStart = DateTime.fromObject({ year: 2026, month: 1, day: 5 }, { zone: ZONE })
      .toUTC()
      .toJSDate()
    const windowEnd = DateTime.fromObject({ year: 2026, month: 6, day: 1 }, { zone: ZONE })
      .toUTC()
      .toJSDate()
    const occ = expandRecurrence({
      rruleText: buildWeeklyRrule({ byDays: ['MO'], count: 3 }),
      wallStart: { year: 2026, month: 1, day: 5, hour: 16, minute: 0 },
      zone: ZONE,
      durationMinutes: 60,
      windowStart,
      windowEnd,
    })
    expect(occ).toHaveLength(3)
  })

  it('no-DST invariant: January and July occurrences are both at 08:00 UTC (China fixed +08:00)', () => {
    const windowStart = DateTime.fromObject({ year: 2026, month: 1, day: 5 }, { zone: ZONE })
      .toUTC()
      .toJSDate()
    const windowEnd = DateTime.fromObject({ year: 2026, month: 8, day: 1 }, { zone: ZONE })
      .toUTC()
      .toJSDate()
    const occ = expandRecurrence({
      rruleText: 'FREQ=WEEKLY;BYDAY=MO',
      wallStart: { year: 2026, month: 1, day: 5, hour: 16, minute: 0 },
      zone: ZONE,
      durationMinutes: 60,
      windowStart,
      windowEnd,
    })
    const jan = occ.filter((o) => o.startAt.getUTCMonth() === 0)
    const jul = occ.filter((o) => o.startAt.getUTCMonth() === 6)
    expect(jan.length).toBeGreaterThan(0)
    expect(jul.length).toBeGreaterThan(0)
    for (const o of occ) expect(o.startAt.getUTCHours()).toBe(8)
  })

  it('CR11: skips a DST spring-forward gap occurrence (America/Toronto 2026-03-08 02:30 does not exist)', () => {
    const TZ = 'America/Toronto' // spring-forward 2026-03-08: 02:00 → 03:00, so 02:30 has no instant.
    const windowStart = DateTime.fromObject({ year: 2026, month: 3, day: 6 }, { zone: TZ })
      .toUTC()
      .toJSDate()
    const windowEnd = DateTime.fromObject({ year: 2026, month: 3, day: 11 }, { zone: TZ })
      .toUTC()
      .toJSDate()
    const occ = expandRecurrence({
      rruleText: 'FREQ=DAILY',
      wallStart: { year: 2026, month: 3, day: 6, hour: 2, minute: 30 },
      zone: TZ,
      durationMinutes: 60,
      windowStart,
      windowEnd,
    })
    // Floating days 6,7,8,9,10 → 5 occurrences; 03-08 02:30 falls in the gap → skipped → 4 kept.
    expect(occ).toHaveLength(4)
    const localWall = occ.map((o) =>
      DateTime.fromJSDate(o.startAt).setZone(TZ).toFormat('yyyy-MM-dd HH:mm'),
    )
    expect(localWall).not.toContain('2026-03-08 02:30') // the nonexistent time is not emitted
    expect(localWall).toContain('2026-03-07 02:30') // a normal day keeps its 02:30 wall-clock
    expect(localWall).toContain('2026-03-09 02:30')
  })

  it('rejects a runaway expansion (>500 occurrences)', () => {
    const windowStart = new Date(Date.UTC(2026, 0, 1))
    const windowEnd = new Date(Date.UTC(2027, 6, 1)) // ~1.5y, under the 2-year window cap
    expect(() =>
      expandRecurrence({
        rruleText: 'FREQ=DAILY;COUNT=1000',
        wallStart: { year: 2026, month: 1, day: 1, hour: 9, minute: 0 },
        zone: ZONE,
        durationMinutes: 60,
        windowStart,
        windowEnd,
      }),
    ).toThrow()
  })
})
