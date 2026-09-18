import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { course, classSection, student, enrollment, lesson } from '@/db/schema'
import { requireAuthContext, type AuthContext } from '@/auth/context'
import { sectionIdsForActor, studentIdsForActor, actorOwnsSection } from '@/auth/scope'
import { seedOrg, unseedOrg } from './helpers/seed-org'

// The per-section loaders in teach/[sectionId]/data.ts 404 via next/navigation's notFound() for a foreign
// section. Mock it to a deterministic throw (mirrors report-db.test.ts's vi.mock) so the DATA-LAYER guard
// is asserted without depending on Next's runtime — this repo runs a patched Next whose notFound() digest
// we don't want the test coupled to.
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
}))
// The 'use server' roster actions call requireAuthContext() (session cookies) internally. Override ONLY
// that export (preserve AuthError etc. via importActual, so @/auth/authorize's requirePermission still
// works) to drive the actions with an explicit ctx — the same way the loaders take one directly.
// mcp-tools.test.ts already loads the real @/auth/context under vitest, so importActual is safe.
vi.mock('@/auth/context', async (importActual) => ({
  ...(await importActual<typeof import('@/auth/context')>()),
  requireAuthContext: vi.fn(),
}))
// revalidatePath throws outside a request store; the guard rejects before reaching it, but stub it so an
// accidental success path (own-section positive assertions) can't blow up on the cache call.
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
import {
  getSectionHeader,
  getSectionRoster,
  getSectionLessons,
  getSectionReports,
  getSectionPendingRescheduleCount,
} from '@/app/dashboard/teach/[sectionId]/data'
import {
  enrollStudent,
  unenrollStudent,
  listSectionEnrollments,
} from '@/app/dashboard/schedule/enrollment-actions'

// Drive a 'use server' action as a specific principal (requireAuthContext is mocked above).
const asActor = (ctx: AuthContext) => vi.mocked(requireAuthContext).mockResolvedValue(ctx)

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

// A lesson seeded into sA1 so getSectionLessons' positive path is non-vacuous.
const lessonA1 = 'l_a1_scope'

const cleanup = async () => {
  await db.delete(enrollment).where(eq(enrollment.tenantId, org))
  await db.delete(lesson).where(eq(lesson.tenantId, org))
  await db.delete(classSection).where(eq(classSection.tenantId, org))
  await db.delete(course).where(eq(course.tenantId, org))
  await db.delete(student).where(eq(student.tenantId, org))
  await unseedOrg(org)
}

beforeAll(async () => {
  await cleanup()
  await seedOrg(org)
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
  // A 'now' lesson in sA1 (inside getSectionLessons' default now-60d…now+120d window for a section with
  // no term dates) so the owner-path assertion verifies a real row, not just an empty array.
  await db.insert(lesson).values({
    id: lessonA1,
    tenantId: org,
    sectionId: sA1,
    teacherId: teacherA,
    startAt: new Date(),
    endAt: new Date(Date.now() + 3_600_000),
    status: 'scheduled',
  })
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

// M1/M2 — the actual URL-tampering defense, now enforced at the DATA layer (requireOwnedSection) rather
// than only by teach/[sectionId]/layout.tsx. These lock the highest-risk behavior the PR claims: a teacher
// who guesses a foreign (same-tenant) section id can never load its header/roster/lessons, even by calling
// a loader DIRECTLY (bypassing the layout choke point).
describe('数据层归属守卫 — getSectionHeader / getSectionRoster / getSectionLessons（M1 下沉 + URL 越权防线）', () => {
  it('a teacher opening their OWN section resolves; a guessed foreign section 404s', async () => {
    const { section } = await getSectionHeader(teacherACtx, sA1)
    expect(section.id).toBe(sA1)
    // teacherA guessing teacherB's (same-tenant) section id → notFound, never teacherB's class.
    await expect(getSectionHeader(teacherACtx, sB1)).rejects.toThrow('NEXT_NOT_FOUND')
    await expect(getSectionHeader(teacherBCtx, sA1)).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('owner and the platform superadmin may open ANY section', async () => {
    await expect(getSectionHeader(ownerCtx, sB1)).resolves.toMatchObject({ section: { id: sB1 } })
    await expect(getSectionHeader(superTeacherCtx, sB1)).resolves.toMatchObject({
      section: { id: sB1 },
    })
  })

  it('getSectionRoster / getSectionLessons enforce ownership at the loader itself, not only via layout', async () => {
    // teacherA's own section: roster loads (stuA active in sA1); the seeded lesson is returned.
    expect((await getSectionRoster(teacherACtx, sA1)).map((r) => r.id)).toEqual([stuA])
    expect((await getSectionLessons(teacherACtx, sA1)).map((l) => l.id)).toContain(lessonA1)
    // A foreign section 404s even when the loader is called DIRECTLY, bypassing the layout guard.
    await expect(getSectionRoster(teacherBCtx, sA1)).rejects.toThrow('NEXT_NOT_FOUND')
    await expect(getSectionLessons(teacherBCtx, sA1)).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('getSectionReports / getSectionPendingRescheduleCount also enforce ownership (guard, not transitive)', async () => {
    // Own section resolves (reports → array; pending count → number).
    expect(await getSectionReports(teacherACtx, sA1)).toBeInstanceOf(Array)
    expect(typeof (await getSectionPendingRescheduleCount(teacherACtx, sA1))).toBe('number')
    // Foreign section 404s directly — locks the getSectionReports self-guard and the new pending-count guard.
    await expect(getSectionReports(teacherBCtx, sA1)).rejects.toThrow('NEXT_NOT_FOUND')
    await expect(getSectionPendingRescheduleCount(teacherBCtx, sA1)).rejects.toThrow(
      'NEXT_NOT_FOUND',
    )
  })
})

// M2 (write path) — the roster mutation/read actions carry the SAME actorOwnsSection guard as the loaders
// but are 'use server' RPC boundaries (requireAuthContext is mocked to inject the principal). A teacher may
// never enroll/drop into, or read the roster of, another teacher's section — the higher-risk mutation surface.
describe('花名册写路径归属守卫 — enrollStudent / unenrollStudent / listSectionEnrollments（M2 补：写路径）', () => {
  it('a teacher cannot enroll or unenroll students in another teacher’s section', async () => {
    asActor(teacherBCtx)
    await expect(enrollStudent({ studentId: stuB, sectionId: sA1 })).rejects.toThrow(
      '无权管理该班级',
    )
    await expect(unenrollStudent({ studentId: stuA, sectionId: sA1 })).rejects.toThrow(
      '无权管理该班级',
    )
  })

  it('listSectionEnrollments returns [] for a foreign section but the real roster for one’s own', async () => {
    asActor(teacherBCtx)
    expect(await listSectionEnrollments(sA1)).toEqual([]) // teacherB may not read teacherA's roster
    asActor(teacherACtx)
    expect((await listSectionEnrollments(sA1)).map((e) => e.studentId)).toEqual([stuA])
  })
})
