import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { course, classSection, student, enrollment } from '@/db/schema'
import type { AuthContext } from '@/auth/context'
import { sectionIdsForActor, studentIdsForActor, actorOwnsSection } from '@/auth/scope'

// 工作流 E — 教师本班收敛. Proven against a live DB (mirrors report-db.test.ts seeding). Locks the row-level
// scope on TOP of tenant isolation: a plain teacher sees ONLY the sections they teach (classSection.
// teacherId) and the students ACTIVELY enrolled in them; owner + the platform superadmin see everything;
// a teacher can never see another teacher's section/student in the same tenant.
const org = 'org_teacher_scope'
const teacherA = 'u_teacher_a_scope'
const teacherB = 'u_teacher_b_scope'
const ownerId = 'u_owner_scope'

// Sections: A1/A2 belong to teacherA, B1 to teacherB.
const sA1 = 's_a1_scope'
const sA2 = 's_a2_scope'
const sB1 = 's_b1_scope'
// Students: stuA in A1 (active), stuB in B1 (active), stuDropped in A2 (dropped — must NOT surface).
const stuA = 'stu_a_scope'
const stuB = 'stu_b_scope'
const stuDropped = 'stu_dropped_scope'

const ctxFor = (userId: string, role: string, isPlatformAdmin = false): AuthContext => ({
  tenantId: org,
  userId,
  role,
  isPlatformAdmin,
})
const teacherACtx = ctxFor(teacherA, 'teacher')
const teacherBCtx = ctxFor(teacherB, 'teacher')
const ownerCtx = ctxFor(ownerId, 'owner')
// A teacher-role member who is ALSO the platform superadmin still manages the whole tenant.
const superTeacherCtx = ctxFor(teacherA, 'teacher', true)

const cleanup = async () => {
  await db.delete(enrollment).where(eq(enrollment.tenantId, org))
  await db.delete(classSection).where(eq(classSection.tenantId, org))
  await db.delete(course).where(eq(course.tenantId, org))
  await db.delete(student).where(eq(student.tenantId, org))
}

beforeAll(async () => {
  await cleanup()
  await db.insert(course).values({ id: 'c_scope', tenantId: org, title: '作用域课程' })
  await db.insert(classSection).values([
    { id: sA1, tenantId: org, courseId: 'c_scope', name: 'A1', teacherId: teacherA, capacity: 5 },
    { id: sA2, tenantId: org, courseId: 'c_scope', name: 'A2', teacherId: teacherA, capacity: 5 },
    { id: sB1, tenantId: org, courseId: 'c_scope', name: 'B1', teacherId: teacherB, capacity: 5 },
  ])
  await db.insert(student).values([
    { id: stuA, tenantId: org, name: '学生A' },
    { id: stuB, tenantId: org, name: '学生B' },
    { id: stuDropped, tenantId: org, name: '已退学生' },
  ])
  await db.insert(enrollment).values([
    { tenantId: org, studentId: stuA, sectionId: sA1, status: 'active' },
    { tenantId: org, studentId: stuB, sectionId: sB1, status: 'active' },
    // dropped enrollment in one of teacherA's sections → excluded from studentIdsForActor.
    { tenantId: org, studentId: stuDropped, sectionId: sA2, status: 'dropped' },
  ])
})

afterAll(cleanup)

describe('sectionIdsForActor — 教师只见本人 section', () => {
  it('a teacher sees exactly their own sections, never another teacher’s', async () => {
    const a = await sectionIdsForActor(teacherACtx)
    expect(a).not.toBe('all')
    expect(new Set(a as string[])).toEqual(new Set([sA1, sA2]))
    expect(a as string[]).not.toContain(sB1)

    const b = await sectionIdsForActor(teacherBCtx)
    expect(new Set(b as string[])).toEqual(new Set([sB1]))
  })

  it('owner and the platform superadmin see all sections', async () => {
    expect(await sectionIdsForActor(ownerCtx)).toBe('all')
    expect(await sectionIdsForActor(superTeacherCtx)).toBe('all')
  })
})

describe('studentIdsForActor — 教师只见本班 active 学生', () => {
  it('a teacher sees only students actively enrolled in their sections', async () => {
    const a = await studentIdsForActor(teacherACtx)
    expect(a).not.toBe('all')
    // stuA is active in A1; stuDropped is only DROPPED in A2 → excluded; stuB belongs to teacherB.
    expect(new Set(a as string[])).toEqual(new Set([stuA]))
    expect(a as string[]).not.toContain(stuB)
    expect(a as string[]).not.toContain(stuDropped)

    const b = await studentIdsForActor(teacherBCtx)
    expect(new Set(b as string[])).toEqual(new Set([stuB]))
  })

  it('owner sees all students (no restriction)', async () => {
    expect(await studentIdsForActor(ownerCtx)).toBe('all')
  })
})

describe('actorOwnsSection — 每班工作台入口守卫', () => {
  const sectionOf = (teacherId: string) => ({ teacherId })

  it('a teacher owns their own section but not another teacher’s', () => {
    expect(actorOwnsSection(teacherACtx, sectionOf(teacherA))).toBe(true)
    expect(actorOwnsSection(teacherACtx, sectionOf(teacherB))).toBe(false)
    expect(actorOwnsSection(teacherBCtx, sectionOf(teacherA))).toBe(false)
  })

  it('whole-tenant staff (owner) and the platform superadmin own every section', () => {
    expect(actorOwnsSection(ownerCtx, sectionOf(teacherB))).toBe(true)
    expect(actorOwnsSection(superTeacherCtx, sectionOf(teacherB))).toBe(true)
  })
})
