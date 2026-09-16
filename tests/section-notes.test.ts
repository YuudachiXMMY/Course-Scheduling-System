import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { and, eq, inArray } from 'drizzle-orm'
import { db } from '@/db'
import {
  organization,
  member,
  user,
  course,
  classSection,
  enrollment,
  lesson,
  note,
  grade,
  student,
} from '@/db/schema'
import { forTenant } from '@/db/tenant'
import type { AuthContext } from '@/auth/context'
import {
  getSectionLessonNotes,
  upsertLessonStudentGradeCore,
  QUICK_GRADE_TITLE,
} from '@/app/dashboard/teach/[sectionId]/data'

// DB-integration tests for the 排课-tab notes/grades matrix. Targets the CORE layer (functions that
// accept a ctx), NOT the 'use server' action — those need a live session/headers. Mirrors
// report-db.test.ts (report-core) and tenant-isolation.test.ts (forTenant).

const ctxFor = (tenantId: string, userId: string, role = 'owner'): AuthContext => ({
  tenantId,
  userId,
  role,
  isPlatformAdmin: false,
})

const org = 'org_secnotes'
const otherOrg = 'org_secnotes_other'
const userId = 'user_secnotes'
const teacherId = userId
const at = (h: number) => new Date(Date.UTC(2026, 2, 10, h))

let sectionId: string
let sA: string
let sB: string
let l1: string
let l2: string

const cleanup = async () => {
  for (const t of [org, otherOrg]) {
    // grade has onDelete('restrict') on its student/lesson/section parents → delete grade rows first.
    await db.delete(grade).where(eq(grade.tenantId, t))
    await db.delete(note).where(eq(note.tenantId, t))
    await db.delete(lesson).where(eq(lesson.tenantId, t))
    await db.delete(enrollment).where(eq(enrollment.tenantId, t))
    await db.delete(classSection).where(eq(classSection.tenantId, t))
    await db.delete(course).where(eq(course.tenantId, t))
    await db.delete(student).where(eq(student.tenantId, t))
  }
  await db.delete(member).where(inArray(member.organizationId, [org, otherOrg]))
  await db.delete(organization).where(inArray(organization.id, [org, otherOrg]))
  await db.delete(user).where(inArray(user.id, [userId]))
}

describe('section notes/grades matrix — DB integration (data.ts core)', () => {
  beforeAll(async () => {
    await cleanup()
    const now = new Date()
    await db.insert(organization).values([
      { id: org, name: 'SN', slug: 'sn-secnotes', createdAt: now },
      { id: otherOrg, name: 'SN2', slug: 'sn-secnotes-2', createdAt: now },
    ])
    await db
      .insert(user)
      .values([{ id: userId, name: 'T', email: 'sn@t.com', emailVerified: true }])
    await db
      .insert(member)
      .values([{ id: 'm_secnotes', organizationId: org, userId, role: 'owner', createdAt: now }])

    const ctx = ctxFor(org, userId)
    const [c] = (await forTenant(ctx).insert(course, { title: '数学' })) as { id: string }[]
    const [sec] = (await forTenant(ctx).insert(classSection, {
      courseId: c.id,
      teacherId,
      capacity: 2,
    })) as { id: string }[]
    sectionId = sec.id
    const [stA] = (await forTenant(ctx).insert(student, { name: '张三' })) as { id: string }[]
    const [stB] = (await forTenant(ctx).insert(student, { name: '李四' })) as { id: string }[]
    sA = stA.id
    sB = stB.id
    await forTenant(ctx).insert(enrollment, { studentId: sA, sectionId, status: 'active' })
    await forTenant(ctx).insert(enrollment, { studentId: sB, sectionId, status: 'active' })

    const [le1] = (await forTenant(ctx).insert(lesson, {
      sectionId,
      teacherId,
      startAt: at(10),
      endAt: at(11),
    })) as { id: string }[]
    const [le2] = (await forTenant(ctx).insert(lesson, {
      sectionId,
      teacherId,
      startAt: at(12),
      endAt: at(13),
    })) as { id: string }[]
    l1 = le1.id
    l2 = le2.id

    // Base fixture on l1: shared note (studentId null) + per-student 点评 for sA + a sentinel grade.
    await forTenant(ctx).insert(note, { lessonId: l1, body: 'summary-l1', visibility: 'internal' })
    await forTenant(ctx).insert(note, { lessonId: l1, studentId: sA, body: 'comment-sA' })
    await forTenant(ctx).insert(grade, {
      studentId: sA,
      lessonId: l1,
      title: QUICK_GRADE_TITLE,
      score: '85.00',
      maxScore: '100.00',
    })
    // A titled assessment on l2 that must NOT surface in a cell (only the sentinel title counts).
    await forTenant(ctx).insert(grade, {
      studentId: sA,
      lessonId: l2,
      title: '月考',
      score: '77.00',
    })
  })
  afterAll(cleanup)

  it('groups shared note, per-student 点评 and sentinel grade by lesson', async () => {
    const m = await getSectionLessonNotes(ctxFor(org, userId), [l1, l2])
    expect(m[l1].summary).toBe('summary-l1')
    expect(m[l1].comments[sA]).toBe('comment-sA')
    expect(m[l1].comments[sB]).toBeUndefined()
    expect(Number(m[l1].grades[sA].score)).toBe(85)
    expect(Number(m[l1].grades[sA].maxScore)).toBe(100)
    // l2 has only a 月考 (non-sentinel) grade → excluded; the row is otherwise empty.
    expect(m[l2].summary).toBe('')
    expect(m[l2].comments).toEqual({})
    expect(m[l2].grades).toEqual({})
  })

  it('latest note wins per (lesson, student) — no unique constraint, oldest→newest sort', async () => {
    const ctx = ctxFor(org, userId)
    await forTenant(ctx).insert(note, {
      lessonId: l2,
      studentId: sB,
      body: 'old',
      createdAt: new Date(Date.UTC(2026, 0, 1)),
    })
    await forTenant(ctx).insert(note, {
      lessonId: l2,
      studentId: sB,
      body: 'new',
      createdAt: new Date(Date.UTC(2026, 0, 2)),
    })
    const m = await getSectionLessonNotes(ctx, [l2])
    expect(m[l2].comments[sB]).toBe('new')
  })

  it('upsertLessonStudentGradeCore: insert → update same row → empty deletes', async () => {
    const ctx = ctxFor(org, userId)
    const key = and(
      eq(grade.lessonId, l2),
      eq(grade.studentId, sB),
      eq(grade.title, QUICK_GRADE_TITLE),
    )
    const countRows = async () => ((await forTenant(ctx).select(grade, key)) as unknown[]).length

    const inserted = await upsertLessonStudentGradeCore(ctx, {
      lessonId: l2,
      studentId: sB,
      score: 60,
    })
    expect(inserted).not.toBeNull()
    expect(Number(inserted!.score)).toBe(60)
    expect(await countRows()).toBe(1)

    const updated = await upsertLessonStudentGradeCore(ctx, {
      lessonId: l2,
      studentId: sB,
      score: 70,
      maxScore: 100,
    })
    expect(Number(updated!.score)).toBe(70)
    expect(Number(updated!.maxScore)).toBe(100)
    expect(await countRows()).toBe(1) // updated in place, not appended

    const deleted = await upsertLessonStudentGradeCore(ctx, { lessonId: l2, studentId: sB })
    expect(deleted).toBeNull()
    expect(await countRows()).toBe(0)
  })

  it('tenant isolation: another tenant reads an empty matrix', async () => {
    const m = await getSectionLessonNotes(ctxFor(otherOrg, 'ghost'), [l1, l2])
    expect(m[l1].summary).toBe('')
    expect(m[l1].comments).toEqual({})
    expect(m[l1].grades).toEqual({})
  })

  it('empty lessonIds returns {} without issuing an invalid inArray([]) query', async () => {
    const m = await getSectionLessonNotes(ctxFor(org, userId), [])
    expect(m).toEqual({})
  })
})
