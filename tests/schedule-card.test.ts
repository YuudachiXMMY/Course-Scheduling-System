import { describe, it, expect } from 'vitest'
import { renderScheduleCardHtml } from '@/lib/schedule-card-render'
import { type CardData, type CardLesson } from '@/lib/schedule-card'
import { cardWindow } from '@/lib/ical-feed'

// Jan 5 is EST (America/Toronto, UTC-5), so 08:00Z == 03:00 local — mirrors the ical-feed test
// so the card and the .ics agree on wall-clock time.
const baseLesson: CardLesson = {
  id: 'lesson-a',
  title: '数学',
  startAt: new Date('2026-01-05T08:00:00Z'),
  endAt: new Date('2026-01-05T09:00:00Z'),
  location: '房间1',
}

function makeLessons(n: number): CardLesson[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `lesson-${i}`,
    title: `课程${i}`,
    startAt: new Date('2026-01-05T08:00:00Z'),
    endAt: new Date('2026-01-05T09:00:00Z'),
    location: null,
  }))
}

describe('renderScheduleCardHtml', () => {
  it('renders the student name with the "的课表" heading', async () => {
    const data: CardData = { studentName: '张三', lessons: [baseLesson] }
    const html = await renderScheduleCardHtml(data)
    expect(html).toContain('张三')
    expect(html).toContain('的课表')
  })

  it('renders the America/Toronto wall-clock time (08:00Z → 03:00 local, EST) for each lesson', async () => {
    const data: CardData = { studentName: '张三', lessons: [baseLesson] }
    const html = await renderScheduleCardHtml(data)
    // startAt 08:00Z → 03:00 local, endAt 09:00Z → 04:00 local.
    expect(html).toContain('03:00')
    expect(html).toContain('04:00')
    // The lesson title/location survive into a row.
    expect(html).toContain('数学')
    expect(html).toContain('房间1')
  })

  it('renders a row per lesson (up to the 12-row PNG cap)', async () => {
    const data: CardData = { studentName: '张三', lessons: makeLessons(5) }
    const html = await renderScheduleCardHtml(data)
    for (let i = 0; i < 5; i++) {
      expect(html).toContain(`课程${i}`)
    }
  })

  it('embeds the QR as an <img src="data:image/png…"> when qrDataUrl is set', async () => {
    const qrDataUrl = 'data:image/png;base64,AAAABBBBCCCC'
    const data: CardData = { studentName: '张三', lessons: [baseLesson], qrDataUrl }
    const html = await renderScheduleCardHtml(data)
    expect(html).toContain('<img')
    expect(html).toContain('src="data:image/png')
    expect(html).toContain(qrDataUrl)
  })

  it('omits the QR block when qrDataUrl is absent', async () => {
    const data: CardData = { studentName: '张三', lessons: [baseLesson] }
    const html = await renderScheduleCardHtml(data)
    expect(html).not.toContain('data:image/png')
  })

  it('declares the Noto Sans SC CJK font-family (stops 豆腐 in the PNG)', async () => {
    const data: CardData = { studentName: '张三', lessons: [baseLesson] }
    const html = await renderScheduleCardHtml(data)
    expect(html).toContain('Noto Sans SC')
  })

  it('truncates past 12 lessons with a "+N 节更多" hint', async () => {
    const data: CardData = { studentName: '张三', lessons: makeLessons(15) }
    const html = await renderScheduleCardHtml(data)
    // 15 lessons → 12 shown, 3 hidden.
    expect(html).toContain('3 节更多')
  })

  it('does not show the "+N 节更多" hint at exactly 12 lessons', async () => {
    const data: CardData = { studentName: '张三', lessons: makeLessons(12) }
    const html = await renderScheduleCardHtml(data)
    expect(html).not.toContain('节更多')
  })

  it('shows "近期暂无排课" for an empty schedule', async () => {
    const data: CardData = { studentName: '张三', lessons: [] }
    const html = await renderScheduleCardHtml(data)
    expect(html).toContain('近期暂无排课')
  })

  it('emits a self-contained HTML document', async () => {
    const data: CardData = { studentName: '张三', lessons: [baseLesson] }
    const html = await renderScheduleCardHtml(data)
    expect(html).toContain('<!doctype html>')
    expect(html).toContain('id="card"')
  })
})

describe('cardWindow', () => {
  it('returns from < to spanning ~4 weeks on America/Toronto day edges', () => {
    const now = new Date('2026-06-15T12:00:00Z')
    const { from, to } = cardWindow(now)
    expect(from.getTime()).toBeLessThan(to.getTime())
    expect(from.getTime()).toBeLessThan(now.getTime())
    expect(to.getTime()).toBeGreaterThan(now.getTime())
    const weeks = (to.getTime() - from.getTime()) / (7 * 24 * 60 * 60 * 1000)
    expect(weeks).toBeGreaterThan(3.9)
    expect(weeks).toBeLessThan(4.3)
  })

  it('snaps `from` to the start of an America/Toronto day (midnight EDT == 04:00Z)', () => {
    const now = new Date('2026-06-15T12:00:00Z')
    const { from } = cardWindow(now)
    // June is EDT (UTC-4): the start of a Toronto calendar day is 04:00:00 UTC the same day.
    expect(from.getUTCHours()).toBe(4)
    expect(from.getUTCMinutes()).toBe(0)
    expect(from.getUTCSeconds()).toBe(0)
  })
})
