import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { course, classSection, student, enrollment } from '@/db/schema'
import { requireAuthContext, type AuthContext } from '@/auth/context'
import { studentIdsForActor, actorOwnsStudent } from '@/auth/scope'

// AZ3 — teacher self-created student visibility (workflow-E side effect). A section-scoped teacher HAS
// student:create, but a newly created student has NO enrollment, so the enrollment-only scope
// (studentIdsForActor) would make it permanently invisible to its creator. The fix stamps
// student.createdBy = ctx.userId on create and UNIONs `createdBy === ctx.userId` into the scope —
// STRICTLY self-created (never OR-ing away the enrollment filter, so another teacher's students stay
// hidden). Proven against a live DB, mirrors rbac-teacher-scope.test.ts.

// createStudent calls requireAuthContext()/revalidatePath() internally — override only requireAuthContext
// to drive it as an explicit principal (importActual keeps AuthError so requirePermission still works),
// and stub next/cache (revalidatePath throws outside a request store).
vi.mock('@/auth/context', async (importActual) => ({
  ...(await importActual<typeof import('@/auth/context')>()),
  requireAuthContext: vi.fn(),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { createStudent } from '@/app/dashboard/students/actions'

const asActor = (ctx: AuthContext) => vi.mocked(requireAuthContext).mockResolvedValue(ctx)

const org = 'org_self_created'
const teacherA = 'u_ta_selfcreated'
const teacherB = 'u_tb_selfcreated'
const ownerId = 'u_owner_selfcreated'
const sA1 = 's_a1_selfcreated' // teacherA's section
const stuEnrolledA = 'stu_enrolled_a_sc' // active in sA1 (enrollment-derived visibility)
const stuCreatedByA = 'stu_created_a_sc' // createdBy=teacherA, NO enrollment (the AZ3 case)
const stuCreatedByB = 'stu_created_b_sc' // createdBy=teacherB, NO enrollment (must stay hidden from A)

const ctxFor = (userId: string, role: string, isPlatformAdmin = false): AuthContext => ({
  tenantId: org,
  userId,
  role,
  isPlatformAdmin,
})
const teacherACtx = ctxFor(teacherA, 'teacher')
const teacherBCtx = ctxFor(teacherB, 'teacher')
const ownerCtx = ctxFor(ownerId, 'owner')

const cleanup = async () => {
  await db.delete(enrollment).where(eq(enrollment.tenantId, org))
  await db.delete(classSection).where(eq(classSection.tenantId, org))
  await db.delete(course).where(eq(course.tenantId, org))
  await db.delete(student).where(eq(student.tenantId, org))
}

beforeAll(async () => {
  await cleanup()
  await db.insert(course).values({ id: 'c_selfcreated', tenantId: org, title: '自建学生课程' })
  await db.insert(classSection).values({
    id: sA1,
    tenantId: org,
    courseId: 'c_selfcreated',
    name: 'A1',
    teacherId: teacherA,
    capacity: 5,
  })
  await db.insert(student).values([
    { id: stuEnrolledA, tenantId: org, name: '在册学生A' },
    { id: stuCreatedByA, tenantId: org, name: '教师A自建', createdBy: teacherA },
    { id: stuCreatedByB, tenantId: org, name: '教师B自建', createdBy: teacherB },
  ])
  await db
    .insert(enrollment)
    .values({ tenantId: org, studentId: stuEnrolledA, sectionId: sA1, status: 'active' })
})

afterAll(cleanup)

describe('AZ3 — studentIdsForActor 并入自建学生', () => {
  it('教师看到本班在册学生 + 本人自建（即使无在册），且不泄露他人自建', async () => {
    const a = await studentIdsForActor(teacherACtx)
    expect(a).not.toBe('all')
    expect(new Set(a as string[])).toEqual(new Set([stuEnrolledA, stuCreatedByA]))
    expect(a as string[]).not.toContain(stuCreatedByB) // teacherB 的自建学生对 teacherA 不可见

    const b = await studentIdsForActor(teacherBCtx)
    expect(new Set(b as string[])).toEqual(new Set([stuCreatedByB]))
    expect(b as string[]).not.toContain(stuCreatedByA)
  })

  it('owner 仍看到全部学生（收敛只作用于 section-scoped 教师）', async () => {
    expect(await studentIdsForActor(ownerCtx)).toBe('all')
  })
})

describe('AZ3 — actorOwnsStudent 继承自建归属', () => {
  it('创建者拥有自建学生；他人不拥有；owner 全量', async () => {
    expect(await actorOwnsStudent(teacherACtx, stuCreatedByA)).toBe(true)
    expect(await actorOwnsStudent(teacherBCtx, stuCreatedByA)).toBe(false)
    expect(await actorOwnsStudent(ownerCtx, stuCreatedByB)).toBe(true)
  })
})

describe('AZ3 — createStudent 落库 createdBy 并即时可见', () => {
  it('createStudent 记录 createdBy=ctx.userId，创建者随即可见/可操作，他人看不到', async () => {
    asActor(teacherACtx)
    const res = await createStudent({ name: '新建即时可见' })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.row.createdBy).toBe(teacherA)

    const visible = await studentIdsForActor(teacherACtx)
    expect(visible as string[]).toContain(res.row.id)
    expect(await actorOwnsStudent(teacherACtx, res.row.id)).toBe(true)
    expect(await actorOwnsStudent(teacherBCtx, res.row.id)).toBe(false)
  })
})
