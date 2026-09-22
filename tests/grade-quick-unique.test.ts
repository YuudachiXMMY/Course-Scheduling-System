import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { and, eq, inArray } from 'drizzle-orm'
import { db } from '@/db'
import {
  organization,
  user,
  member,
  course,
  classSection,
  lesson,
  student,
  enrollment,
  grade,
} from '@/db/schema'
import { forTenant } from '@/db/tenant'
import { isUniqueViolation } from '@/lib/errors'
import type { AuthContext } from '@/auth/context'
import { upsertLessonStudentGradeCore, QUICK_GRADE_TITLE } from '@/app/dashboard/teach/[sectionId]/data'

// B3 (orch-review HIGH — test gap): F5's quick-grade upsert survives a lost select-then-insert race by
// catching SQLSTATE 23505 (raised by the drizzle/0020 partial-unique index uq_grade_lesson_student_title)
// and recovering via re-select + update (last-writer-wins). Neither the DB backstop, the 23505
// classification, nor the recovery path was exercised before. Mirrors section-notes.test.ts's fixture.
const ctxFor = (tenantId: string, userId: string, role = 'owner'): AuthContext => ({
  tenantId,
  userId,
  role,
  isPlatformAdmin: false,
})

const org = 'org_gradeuniq'
const userId = 'user_gradeuniq'
const teacherId = userId
const at = (h: number) => new Date(Date.UTC(2026, 2, 11, h))

let sA: string
let sB: string
let l1: string
let l2: string

const cleanup = async () => {
  // grade has onDelete('restrict') on its student/lesson/section parents → delete grade rows first.
  await db.delete(grade).where(eq(grade.tenantId, org))
  await db.delete(lesson).where(eq(lesson.tenantId, org))
  await db.delete(enrollment).where(eq(enrollment.tenantId, org))
  await db.delete(classSection).where(eq(classSection.tenantId, org))
  await db.delete(course).where(eq(course.tenantId, org))
  await db.delete(student).where(eq(student.tenantId, org))
  await db.delete(member).where(inArray(member.organizationId, [org]))
  await db.delete(organization).where(inArray(organization.id, [org]))
  await db.delete(user).where(inArray(user.id, [userId]))
}

describe('quick-grade unique-violation recovery — DB integration (F5)', () => {
  beforeAll(async () => {
    await cleanup()
    const now = new Date()
    await db.insert(organization).values([{ id: org, name: 'GU', slug: 'gu-gradeuniq', createdAt: now }])
    await db.insert(user).values([{ id: userId, name: 'T', email: 'gu@t.com', emailVerified: true }])
    await db
      .insert(member)
      .values([{ id: 'm_gradeuniq', organizationId: org, userId, role: 'owner', createdAt: now }])

    const ctx = ctxFor(org, userId)
    const [c] = (await forTenant(ctx).insert(course, { title: '数学' })) as { id: string }[]
    const [sec] = (await forTenant(ctx).insert(classSection, {
      courseId: c.id,
      teacherId,
      capacity: 2,
    })) as { id: string }[]
    const [stA] = (await forTenant(ctx).insert(student, { name: '张三' })) as { id: string }[]
    const [stB] = (await forTenant(ctx).insert(student, { name: '李四' })) as { id: string }[]
    sA = stA.id
    sB = stB.id
    await forTenant(ctx).insert(enrollment, { studentId: sA, sectionId: sec.id, status: 'active' })
    await forTenant(ctx).insert(enrollment, { studentId: sB, sectionId: sec.id, status: 'active' })
    const [le1] = (await forTenant(ctx).insert(lesson, {
      sectionId: sec.id,
      teacherId,
      startAt: at(10),
      endAt: at(11),
    })) as { id: string }[]
    const [le2] = (await forTenant(ctx).insert(lesson, {
      sectionId: sec.id,
      teacherId,
      startAt: at(12),
      endAt: at(13),
    })) as { id: string }[]
    l1 = le1.id
    l2 = le2.id
  })
  afterAll(cleanup)

  it('the uq_grade_lesson_student_title backstop raises 23505 on a duplicate, and isUniqueViolation classifies it (0020 + F5 recovery depend on both)', async () => {
    const ctx = ctxFor(org, userId)
    await forTenant(ctx).insert(grade, {
      studentId: sA,
      lessonId: l1,
      title: QUICK_GRADE_TITLE,
      score: '80.00',
      maxScore: '100.00',
    })
    // A second row on the SAME (lesson, student, sentinel title) must be rejected by the unique index —
    // this is exactly the collision the F5 catch recovers from. Drop migration 0020 and this stops throwing.
    let caught: unknown
    try {
      await forTenant(ctx).insert(grade, {
        studentId: sA,
        lessonId: l1,
        title: QUICK_GRADE_TITLE,
        score: '90.00',
        maxScore: '100.00',
      })
    } catch (e) {
      caught = e
    }
    expect(caught).toBeDefined()
    expect(isUniqueViolation(caught)).toBe(true)
  })

  it('upsertLessonStudentGradeCore recovers from a concurrent-insert race: exactly one row survives, no throw (F5)', async () => {
    const ctx = ctxFor(org, userId)
    // No row exists yet for (l2, sB): two concurrent upserts both SELECT empty → both attempt INSERT → one
    // wins, the loser hits 23505 and recovers via re-select + update. Removing the try/catch in
    // upsertLessonStudentGradeCore makes the losing insert reject → Promise.allSettled shows a rejection.
    const results = await Promise.allSettled([
      upsertLessonStudentGradeCore(ctx, { lessonId: l2, studentId: sB, score: 70, maxScore: 100 }),
      upsertLessonStudentGradeCore(ctx, { lessonId: l2, studentId: sB, score: 95, maxScore: 100 }),
    ])
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true)

    const rows = (await forTenant(ctx).select(
      grade,
      and(eq(grade.lessonId, l2), eq(grade.studentId, sB), eq(grade.title, QUICK_GRADE_TITLE)),
    )) as { score: string | null }[]
    expect(rows).toHaveLength(1) // no silent duplicate
    // Last-writer-wins: the surviving score is one of the two writers' values (which one is nondeterministic).
    expect([70, 95]).toContain(Number(rows[0]!.score))
  })
})
