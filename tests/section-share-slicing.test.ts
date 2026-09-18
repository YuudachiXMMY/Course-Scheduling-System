import { describe, it, expect } from 'vitest'
import { sliceLessonsForSections, withSectionTitles, type SliceableLesson } from '@/lib/share'

// 功能2 — the section public share (getSectionScheduleForShare) reuses the SAME pure slicing helper
// as the student path, but with a single-element section set ([sectionId]) and no enrollment step.
// These tests pin that single-section behavior: window bounds, cancellation, ordering, empty set.

// Rolling window: [2026-01-01, 2026-02-01). Filter keeps startAt >= from && startAt < to.
const window = {
  from: new Date('2026-01-01T00:00:00Z'),
  to: new Date('2026-02-01T00:00:00Z'),
}

// Fabricated lesson rows. 'sec-1' is the SHARED section; 'sec-other' is a different section that
// must never leak into a share scoped to 'sec-1'.
const rows: SliceableLesson[] = [
  {
    id: 'keep-1',
    title: '数学',
    startAt: new Date('2026-01-05T08:00:00Z'),
    endAt: new Date('2026-01-05T09:00:00Z'),
    location: '房间1',
    sectionId: 'sec-1',
    status: 'scheduled',
  },
  {
    id: 'keep-2',
    title: null,
    startAt: new Date('2026-01-20T02:00:00Z'),
    endAt: new Date('2026-01-20T03:00:00Z'),
    location: null,
    sectionId: 'sec-1',
    status: 'scheduled',
  },
  {
    id: 'drop-other-section',
    title: '语文',
    startAt: new Date('2026-01-10T08:00:00Z'),
    endAt: new Date('2026-01-10T09:00:00Z'),
    location: null,
    sectionId: 'sec-other',
    status: 'scheduled',
  },
  {
    id: 'drop-canceled',
    title: '英语',
    startAt: new Date('2026-01-12T08:00:00Z'),
    endAt: new Date('2026-01-12T09:00:00Z'),
    location: null,
    sectionId: 'sec-1',
    status: 'canceled',
  },
  {
    id: 'drop-before-window',
    title: '物理',
    startAt: new Date('2025-12-31T08:00:00Z'),
    endAt: new Date('2025-12-31T09:00:00Z'),
    location: null,
    sectionId: 'sec-1',
    status: 'scheduled',
  },
  {
    id: 'drop-after-window',
    title: '化学',
    startAt: new Date('2026-02-15T08:00:00Z'),
    endAt: new Date('2026-02-15T09:00:00Z'),
    location: null,
    sectionId: 'sec-1',
    status: 'scheduled',
  },
]

describe('section share slicing ([sectionId] single-section path)', () => {
  it('keeps only this-section, non-canceled, in-window lessons', () => {
    const result = sliceLessonsForSections(rows, ['sec-1'], window)
    expect(result.map((r) => r.id).sort()).toEqual(['keep-1', 'keep-2'])
  })

  it('never leaks another section into a single-section share', () => {
    const result = sliceLessonsForSections(rows, ['sec-1'], window)
    expect(result.some((r) => r.id === 'drop-other-section')).toBe(false)
  })

  it('drops canceled lessons', () => {
    const result = sliceLessonsForSections(rows, ['sec-1'], window)
    expect(result.some((r) => r.id === 'drop-canceled')).toBe(false)
  })

  it('drops lessons outside the rolling window (half-open [from, to))', () => {
    const result = sliceLessonsForSections(rows, ['sec-1'], window)
    expect(result.some((r) => r.id === 'drop-before-window')).toBe(false)
    expect(result.some((r) => r.id === 'drop-after-window')).toBe(false)
  })

  it('returns [] for a section with no matching lessons', () => {
    expect(sliceLessonsForSections(rows, ['sec-empty'], window)).toEqual([])
  })

  it('fills the section display title but never overrides an explicit lesson title', () => {
    const titles = new Map([['sec-1', '高一数学 · 周一班']])
    const named = withSectionTitles(rows, titles)
    expect(named.find((r) => r.id === 'keep-1')?.title).toBe('数学')
    expect(named.find((r) => r.id === 'keep-2')?.title).toBe('高一数学 · 周一班')
  })

  it('orders kept lessons by startAt ascending regardless of input order', () => {
    const unordered: SliceableLesson[] = [
      {
        id: 'jan-20',
        title: 'x',
        startAt: new Date('2026-01-20T02:00:00Z'),
        endAt: new Date('2026-01-20T03:00:00Z'),
        location: null,
        sectionId: 'sec-1',
        status: 'scheduled',
      },
      {
        id: 'jan-05',
        title: 'x',
        startAt: new Date('2026-01-05T08:00:00Z'),
        endAt: new Date('2026-01-05T09:00:00Z'),
        location: null,
        sectionId: 'sec-1',
        status: 'scheduled',
      },
    ]
    const result = sliceLessonsForSections(unordered, ['sec-1'], window)
    expect(result.map((r) => r.id)).toEqual(['jan-05', 'jan-20'])
  })
})
