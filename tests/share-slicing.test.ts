import { describe, it, expect } from 'vitest'
import { sliceLessonsForSections, type SliceableLesson } from '@/lib/share'

// Rolling window: [2026-01-01, 2026-02-01). Filter keeps startAt >= from && startAt < to.
const window = {
  from: new Date('2026-01-01T00:00:00Z'),
  to: new Date('2026-02-01T00:00:00Z'),
}

// Fabricated lesson rows covering every filter branch. Section 'sec-active' is one of the
// student's ACTIVE sections; 'sec-inactive' is not.
const rows: SliceableLesson[] = [
  {
    id: 'keep-1',
    title: '数学',
    startAt: new Date('2026-01-05T08:00:00Z'),
    endAt: new Date('2026-01-05T09:00:00Z'),
    location: '房间1',
    sectionId: 'sec-active',
    status: 'scheduled',
  },
  {
    id: 'keep-2',
    title: null,
    startAt: new Date('2026-01-20T02:00:00Z'),
    endAt: new Date('2026-01-20T03:00:00Z'),
    location: null,
    sectionId: 'sec-active',
    status: 'scheduled',
  },
  {
    id: 'drop-inactive-section',
    title: '语文',
    startAt: new Date('2026-01-10T08:00:00Z'),
    endAt: new Date('2026-01-10T09:00:00Z'),
    location: null,
    sectionId: 'sec-inactive',
    status: 'scheduled',
  },
  {
    id: 'drop-canceled',
    title: '英语',
    startAt: new Date('2026-01-12T08:00:00Z'),
    endAt: new Date('2026-01-12T09:00:00Z'),
    location: null,
    sectionId: 'sec-active',
    status: 'canceled',
  },
  {
    id: 'drop-before-window',
    title: '物理',
    startAt: new Date('2025-12-31T08:00:00Z'),
    endAt: new Date('2025-12-31T09:00:00Z'),
    location: null,
    sectionId: 'sec-active',
    status: 'scheduled',
  },
  {
    id: 'drop-after-window',
    title: '化学',
    startAt: new Date('2026-02-15T08:00:00Z'),
    endAt: new Date('2026-02-15T09:00:00Z'),
    location: null,
    sectionId: 'sec-active',
    status: 'scheduled',
  },
]

describe('sliceLessonsForSections', () => {
  it('keeps only active-section, non-canceled, in-window lessons', () => {
    const result = sliceLessonsForSections(rows, ['sec-active'], window)
    expect(result.map((r) => r.id).sort()).toEqual(['keep-1', 'keep-2'])
  })

  it('drops lessons whose section is not in the active set', () => {
    const result = sliceLessonsForSections(rows, ['sec-active'], window)
    expect(result.some((r) => r.id === 'drop-inactive-section')).toBe(false)
  })

  it('drops canceled lessons', () => {
    const result = sliceLessonsForSections(rows, ['sec-active'], window)
    expect(result.some((r) => r.id === 'drop-canceled')).toBe(false)
  })

  it('drops lessons outside the rolling window', () => {
    const result = sliceLessonsForSections(rows, ['sec-active'], window)
    expect(result.some((r) => r.id === 'drop-before-window')).toBe(false)
    expect(result.some((r) => r.id === 'drop-after-window')).toBe(false)
  })

  it('returns [] when the active section set is empty', () => {
    expect(sliceLessonsForSections(rows, [], window)).toEqual([])
  })

  it('projects rows to the FeedLesson shape (drops sectionId/status)', () => {
    const [first] = sliceLessonsForSections(rows, ['sec-active'], window)
    expect(first).toEqual({
      id: 'keep-1',
      title: '数学',
      startAt: new Date('2026-01-05T08:00:00Z'),
      endAt: new Date('2026-01-05T09:00:00Z'),
      location: '房间1',
    })
    expect(first).not.toHaveProperty('sectionId')
    expect(first).not.toHaveProperty('status')
  })

  it('treats the window as half-open [from, to)', () => {
    const boundaryRows: SliceableLesson[] = [
      {
        id: 'at-from',
        title: 'x',
        startAt: window.from, // included
        endAt: new Date('2026-01-01T01:00:00Z'),
        location: null,
        sectionId: 'sec-active',
        status: 'scheduled',
      },
      {
        id: 'at-to',
        title: 'x',
        startAt: window.to, // excluded
        endAt: new Date('2026-02-01T01:00:00Z'),
        location: null,
        sectionId: 'sec-active',
        status: 'scheduled',
      },
    ]
    const result = sliceLessonsForSections(boundaryRows, ['sec-active'], window)
    expect(result.map((r) => r.id)).toEqual(['at-from'])
  })
})
