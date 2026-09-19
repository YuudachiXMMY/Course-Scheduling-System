import { describe, it, expect } from 'vitest'
import { sharedNoteSchema, SHARED_NOTE_MAX } from '@/lib/note-schema'

// T1 —— 本节课笔记（全班共享）支持输入更多内容：把旧的 body.max(2000) 放宽到 SHARED_NOTE_MAX，
// 并让 upsert 可携带 visibility（'internal' | 'shared'）以支持后续「对外开放」。纯 zod 单测，无 DB。
describe('sharedNoteSchema —— 更长内容 + 可见性', () => {
  it('上限至少 20000，且接受贴着上限的长笔记（远超旧 2000）', () => {
    expect(SHARED_NOTE_MAX).toBeGreaterThanOrEqual(20000)
    const body = 'x'.repeat(SHARED_NOTE_MAX)
    const parsed = sharedNoteSchema.parse({ lessonId: 'l1', body })
    expect(parsed.body.length).toBe(SHARED_NOTE_MAX)
  })

  it('拒绝超过上限的笔记', () => {
    expect(() =>
      sharedNoteSchema.parse({ lessonId: 'l1', body: 'x'.repeat(SHARED_NOTE_MAX + 1) }),
    ).toThrow()
  })

  it('仍拒绝空笔记', () => {
    expect(() => sharedNoteSchema.parse({ lessonId: 'l1', body: '   ' })).toThrow()
  })

  it('接受 visibility=shared / internal，省略时为 undefined', () => {
    expect(
      sharedNoteSchema.parse({ lessonId: 'l1', body: 'a', visibility: 'shared' }).visibility,
    ).toBe('shared')
    expect(
      sharedNoteSchema.parse({ lessonId: 'l1', body: 'a', visibility: 'internal' }).visibility,
    ).toBe('internal')
    expect(sharedNoteSchema.parse({ lessonId: 'l1', body: 'a' }).visibility).toBeUndefined()
  })

  it('拒绝非法 visibility 值', () => {
    expect(() =>
      sharedNoteSchema.parse({ lessonId: 'l1', body: 'a', visibility: 'public' }),
    ).toThrow()
  })
})
