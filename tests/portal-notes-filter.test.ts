import { describe, it, expect } from 'vitest'
import {
  filterNotes,
  sectionOptions,
  sessionOptions,
} from '@/app/portal/notes/filter'
import type { PortalLessonNote } from '@/app/portal/notes/data'

// 门户课节笔记「按课程班级 + 单节课(session)」客户端筛选的行为规格（纯函数，无 DB）。这是本次 change-feature 的
// 期望新行为：notes 页从「无筛选、纯倒序列表」变为「双维度筛选 + 选项数量徽标 + 选课程后 session 选项收敛」。

const note = (o: Partial<PortalLessonNote> & Pick<PortalLessonNote, 'id' | 'lessonId' | 'sectionId'>): PortalLessonNote => ({
  sectionLabel: '课程 · 班级',
  lessonDate: '2026-09-01',
  body: '笔记正文',
  ...o,
})

// 两个班级：sec_a（两节课 l1/l2）、sec_b（一节课 l3）。
const notes: PortalLessonNote[] = [
  note({ id: 'n1', lessonId: 'l1', sectionId: 'sec_a', sectionLabel: '数学 · A班', lessonDate: '2026-09-10' }),
  note({ id: 'n2', lessonId: 'l1', sectionId: 'sec_a', sectionLabel: '数学 · A班', lessonDate: '2026-09-10' }),
  note({ id: 'n3', lessonId: 'l2', sectionId: 'sec_a', sectionLabel: '数学 · A班', lessonDate: '2026-09-17' }),
  note({ id: 'n4', lessonId: 'l3', sectionId: 'sec_b', sectionLabel: '英语 · B班', lessonDate: '2026-09-12' }),
]

describe('门户课节笔记筛选 — 按课程班级', () => {
  it('空 sectionId + 空 lessonId 返回全部', () => {
    expect(filterNotes(notes, { sectionId: '', lessonId: '' })).toHaveLength(4)
  })

  it('按 sectionId 收敛到该班级', () => {
    const r = filterNotes(notes, { sectionId: 'sec_a', lessonId: '' })
    expect(r.map((n) => n.id)).toEqual(['n1', 'n2', 'n3'])
  })

  it('sectionOptions 去重并带正确数量徽标', () => {
    const opts = sectionOptions(notes)
    expect(opts).toEqual([
      { id: 'sec_a', label: '数学 · A班', count: 3 },
      { id: 'sec_b', label: '英语 · B班', count: 1 },
    ])
  })
})

describe('门户课节笔记筛选 — 按单节课(session)', () => {
  it('按 lessonId 精确到某一节课（跨该节课的多条笔记）', () => {
    const r = filterNotes(notes, { sectionId: '', lessonId: 'l1' })
    expect(r.map((n) => n.id)).toEqual(['n1', 'n2'])
  })

  it('班级 + 单节课组合取交集', () => {
    const r = filterNotes(notes, { sectionId: 'sec_a', lessonId: 'l2' })
    expect(r.map((n) => n.id)).toEqual(['n3'])
  })

  it('未选班级时 sessionOptions 列出全部课节，按日期倒序、带数量徽标', () => {
    const opts = sessionOptions(notes, '')
    expect(opts.map((o) => o.id)).toEqual(['l2', 'l3', 'l1']) // 09-17, 09-12, 09-10
    const l1 = opts.find((o) => o.id === 'l1')!
    expect(l1.count).toBe(2)
    expect(l1.label).toBe('数学 · A班 · 2026-09-10')
  })

  it('选中班级后 session 选项收敛到该班级', () => {
    const opts = sessionOptions(notes, 'sec_a')
    expect(opts.map((o) => o.id)).toEqual(['l2', 'l1'])
    expect(opts.every((o) => o.label.startsWith('数学 · A班'))).toBe(true)
  })
})
