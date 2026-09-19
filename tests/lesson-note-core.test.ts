import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { db } from '@/db'
import { organization, member, user, course, classSection, lesson, note } from '@/db/schema'
import { forTenant } from '@/db/tenant'
import { upsertSharedNoteCore } from '@/lib/lesson-note-core'
import { getSectionLessonNotes } from '@/app/dashboard/teach/[sectionId]/data'
import type { AuthContext } from '@/auth/context'

// T3 —— 教师端「对外开放」开关：upsertSharedNoteCore 是可测核心（会话由 'use server' 包装层校验）。
// 覆盖 insert → update 同一行 + 落 visibility；并验证 getSectionLessonNotes 回读 summary 的可见性。
const org = 'org_lncore'
const userId = 'user_lncore'
const at = (h: number) => new Date(Date.UTC(2026, 2, 11, h))
const ctx: AuthContext = { tenantId: org, userId, role: 'owner', isPlatformAdmin: false }

let sectionId: string
let l1: string

const cleanup = async () => {
  await db.delete(note).where(eq(note.tenantId, org))
  await db.delete(lesson).where(eq(lesson.tenantId, org))
  await db.delete(classSection).where(eq(classSection.tenantId, org))
  await db.delete(course).where(eq(course.tenantId, org))
  await db.delete(member).where(eq(member.organizationId, org))
  await db.delete(organization).where(eq(organization.id, org))
  await db.delete(user).where(eq(user.id, userId))
}

describe('upsertSharedNoteCore —— 落库 visibility + getSectionLessonNotes 回读', () => {
  beforeAll(async () => {
    await cleanup()
    const now = new Date()
    await db.insert(organization).values({ id: org, name: 'LN', slug: 'ln-core', createdAt: now })
    await db.insert(user).values({ id: userId, name: 'T', email: 'ln@t.com', emailVerified: true })
    await db
      .insert(member)
      .values({ id: 'm_lncore', organizationId: org, userId, role: 'owner', createdAt: now })
    const [c] = (await forTenant(ctx).insert(course, { title: '物理' })) as { id: string }[]
    const [sec] = (await forTenant(ctx).insert(classSection, {
      courseId: c.id,
      teacherId: userId,
      capacity: 2,
    })) as { id: string }[]
    sectionId = sec.id
    const [le] = (await forTenant(ctx).insert(lesson, {
      sectionId,
      teacherId: userId,
      startAt: at(10),
      endAt: at(11),
    })) as { id: string }[]
    l1 = le.id
  })
  afterAll(cleanup)

  const sharedRows = async () =>
    (await forTenant(ctx).select(
      note,
      and(eq(note.lessonId, l1), isNull(note.studentId)),
    )) as (typeof note.$inferSelect)[]

  it('首次写入建行，默认 visibility=internal', async () => {
    const row = await upsertSharedNoteCore(ctx, { lessonId: l1, body: '第一版笔记' })
    expect(row.body).toBe('第一版笔记')
    expect(row.visibility).toBe('internal')
    expect((await sharedRows()).length).toBe(1)
  })

  it('再次写入同一课节 → update 同一行（不新增），并可切到 shared', async () => {
    const row = await upsertSharedNoteCore(ctx, {
      lessonId: l1,
      body: '# 标题\n\n质能方程 $E=mc^2$',
      visibility: 'shared',
    })
    expect(row.body).toContain('E=mc^2')
    expect(row.visibility).toBe('shared')
    expect((await sharedRows()).length).toBe(1) // 原地更新，未追加
  })

  it('省略 visibility 时保留已有可见性（不误降级为 internal）', async () => {
    const row = await upsertSharedNoteCore(ctx, { lessonId: l1, body: '仅改正文' })
    expect(row.visibility).toBe('shared') // 仍是上一步设置的 shared
  })

  it('getSectionLessonNotes 回读 summary 的 visibility', async () => {
    const m = await getSectionLessonNotes(ctx, [l1])
    expect(m[l1].summary).toBe('仅改正文')
    expect(m[l1].summaryVisibility).toBe('shared')
  })

  it('无共享笔记的课节 summaryVisibility 缺省为 internal', async () => {
    const [le2] = (await forTenant(ctx).insert(lesson, {
      sectionId,
      teacherId: userId,
      startAt: at(12),
      endAt: at(13),
    })) as { id: string }[]
    const m = await getSectionLessonNotes(ctx, [le2.id])
    expect(m[le2.id].summary).toBe('')
    expect(m[le2.id].summaryVisibility).toBe('internal')
  })
})
