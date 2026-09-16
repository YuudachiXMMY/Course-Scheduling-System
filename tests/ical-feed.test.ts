import { describe, it, expect } from 'vitest'
import { buildIcs, feedWindow, type FeedLesson } from '@/lib/ical-feed'

// Two lessons at known UTC instants. Jan 5 is EST (America/Toronto, UTC-5), so 08:00Z == 03:00 local.
const lessons: FeedLesson[] = [
  {
    id: 'lesson-a',
    title: '数学',
    startAt: new Date('2026-01-05T08:00:00Z'),
    endAt: new Date('2026-01-05T09:00:00Z'),
    location: '房间1',
  },
  {
    id: 'lesson-b',
    title: null, // → default summary '课节'
    startAt: new Date('2026-01-06T10:00:00Z'),
    endAt: new Date('2026-01-06T11:00:00Z'),
    location: null,
  },
]

const uidLines = (ics: string) =>
  ics
    .split(/\r?\n/)
    .filter((l) => l.startsWith('UID:'))
    .sort()

describe('buildIcs', () => {
  it('emits a VCALENDAR with a real VTIMEZONE and one VEVENT per lesson', () => {
    const ics = buildIcs(lessons, { host: 'example.com' })
    expect(ics).toContain('BEGIN:VCALENDAR')
    expect(ics).toContain('END:VCALENDAR')
    expect(ics).toContain('BEGIN:VTIMEZONE')
    expect(ics).toContain('TZID:America/Toronto')
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2)
    expect(ics).toContain('UID:lesson-a@example.com')
    expect(ics).toContain('UID:lesson-b@example.com')
  })

  it('renders the correct America/Toronto wall-clock time (08:00Z → 03:00 local, EST)', () => {
    const ics = buildIcs(lessons, { host: 'example.com' })
    // ical-generator formats a TZID event as DTSTART;TZID=America/Toronto:YYYYMMDDTHHMMSS
    expect(ics).toMatch(/DTSTART;TZID=America\/Toronto:20260105T030000/)
  })

  it('falls back to the default summary when title is null', () => {
    const ics = buildIcs(lessons, { host: 'example.com' })
    expect(ics).toContain('SUMMARY:数学')
    expect(ics).toContain('SUMMARY:课节')
  })

  it('produces stable, PK-derived UIDs (no duplicates on refresh)', () => {
    const first = buildIcs(lessons, { host: 'example.com' })
    const second = buildIcs(lessons, { host: 'example.com' })
    expect(uidLines(first)).toEqual(uidLines(second))
    expect(uidLines(first)).toEqual(['UID:lesson-a@example.com', 'UID:lesson-b@example.com'])
  })

  it('anchors the UID host to the provided option', () => {
    const ics = buildIcs(lessons, { host: 'schedule.example.org' })
    expect(ics).toContain('UID:lesson-a@schedule.example.org')
    expect(ics).not.toContain('@example.com')
  })

  it('emits a valid, event-free VCALENDAR for an empty feed', () => {
    const ics = buildIcs([], { host: 'example.com' })
    expect(ics).toContain('BEGIN:VCALENDAR')
    expect(ics).toContain('END:VCALENDAR')
    expect(ics).not.toContain('BEGIN:VEVENT')
  })
})

describe('feedWindow', () => {
  it('returns from < to spanning ~34 weeks (8 back + 26 forward) on America/Toronto day edges', () => {
    const now = new Date('2026-06-15T12:00:00Z')
    const { from, to } = feedWindow(now)
    expect(from.getTime()).toBeLessThan(to.getTime())
    expect(from.getTime()).toBeLessThan(now.getTime())
    expect(to.getTime()).toBeGreaterThan(now.getTime())
    const weeks = (to.getTime() - from.getTime()) / (7 * 24 * 60 * 60 * 1000)
    expect(weeks).toBeGreaterThan(33.5)
    expect(weeks).toBeLessThan(34.5)
  })
})
