import { describe, it, expect } from 'vitest'
import {
  sectionDisplayName,
  cardWindow,
  feedWindow,
  buildIcs,
  type FeedLesson,
} from '@/lib/ical-feed'

// ical-feed.test.ts covers buildIcs' event shaping + feedWindow + the DB-backed getFeedLessons.
// These pure helpers are exercised only indirectly there (the DB fixtures all carry titles, so the
// `title ?? sectionDisplayName(...)` fallback and the default-vs-explicit calendar name never run,
// and cardWindow has no coverage). This file pins them directly — no DB, no server harness.

describe('sectionDisplayName', () => {
  it('joins course and section with a middot when the section is named', () => {
    expect(sectionDisplayName('数学', 'A 班')).toBe('数学 · A 班')
  })

  it('falls back to the bare course title when the section is unnamed (null)', () => {
    expect(sectionDisplayName('数学', null)).toBe('数学')
  })

  it('treats an empty section name as unnamed', () => {
    expect(sectionDisplayName('数学', '')).toBe('数学')
  })
})

describe('cardWindow', () => {
  it('spans ~4 America/Toronto calendar weeks from the start of today', () => {
    const now = new Date('2026-06-15T12:00:00Z')
    const { from, to } = cardWindow(now)
    expect(from.getTime()).toBeLessThan(to.getTime())
    expect(from.getTime()).toBeLessThanOrEqual(now.getTime()) // snapped to start-of-today (past)
    expect(to.getTime()).toBeGreaterThan(now.getTime())
    const weeks = (to.getTime() - from.getTime()) / (7 * 24 * 60 * 60 * 1000)
    expect(weeks).toBeGreaterThan(4) // 4 weeks + the tail of today → just over 4
    expect(weeks).toBeLessThan(4.3)
  })

  it('is narrower than the subscribe-grade feed window', () => {
    const now = new Date('2026-06-15T12:00:00Z')
    const card = cardWindow(now)
    const feed = feedWindow(now)
    const cardSpan = card.to.getTime() - card.from.getTime()
    const feedSpan = feed.to.getTime() - feed.from.getTime()
    // Pin the actual invariant against feedWindow itself (~4w card vs -8w..+26w feed),
    // not an unrelated hardcoded constant — so shrinking feedWindow or widening cardWindow
    // past each other is caught here.
    expect(cardSpan).toBeLessThan(feedSpan)
    // And card starts no earlier than feed (feed reaches 8 weeks into the past, card starts today).
    expect(card.from.getTime()).toBeGreaterThan(feed.from.getTime())
  })
})

describe('buildIcs — explicit calendar name option', () => {
  const lessons: FeedLesson[] = [
    {
      id: 'l1',
      title: '数学',
      startAt: new Date('2026-01-05T08:00:00Z'),
      endAt: new Date('2026-01-05T09:00:00Z'),
      location: null,
    },
  ]

  it('uses the provided name instead of the default 课程排课', () => {
    const ics = buildIcs(lessons, { host: 'example.com', name: '我的课表' })
    expect(ics).toContain('我的课表')
    expect(ics).not.toContain('课程排课')
  })

  it('uses the default name 课程排课 when none is provided', () => {
    const ics = buildIcs(lessons, { host: 'example.com' })
    expect(ics).toContain('课程排课')
  })
})
