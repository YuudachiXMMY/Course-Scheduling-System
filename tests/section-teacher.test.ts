import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { user, member, course, classSection, sectionTeacher, lesson } from '@/db/schema'
import { requireAuthContext, type AuthContext } from '@/auth/context'
import {
  sectionIdsForActor,
  actorOwnsSection,
  actorOwnsSectionById,
  actorOwnsLesson,
  isSectionMember,
} from '@/auth/scope'
import { seedOrg, unseedOrg } from './helpers/seed-org'

// 多教师/助教 — the access set (section_teacher) is the authoritative "who may open this section", on TOP
// of the hybrid where the PRIMARY teacher (classSection.teacherId) is always a member. These lock:
//   (1) a co-teacher/assistant LINKED via section_teacher gets access even though they are not the primary;
//   (2) a section-scoped teacher/assistant NOT linked and NOT primary is confined out;
//   (3) an assistant is now section-scoped (no link ⇒ sees nothing), no longer whole-tenant;
//   (4) the admin add/remove management actions, incl. primary maintenance + non-member rejection.

vi.mock('@/auth/context', async (importActual) => ({
  ...(await importActual<typeof import('@/auth/context')>()),
  requireAuthContext: vi.fn(),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import {
  addSectionTeacher,
  removeSectionTeacher,
  listSectionTeachers,
} from '@/app/dashboard/courses/section-teacher-actions'

const asActor = (ctx: AuthContext) => vi.mocked(requireAuthContext).mockResolvedValue(ctx)

const org = 'org_section_teacher'
const admin = 'u_admin_st' // owner (whole-tenant)
const teacherP = 'u_teacher_p_st' // teacher, PRIMARY of sMain
const coTeacher = 'u_coteacher_st' // teacher, linked to sMain via section_teacher (NOT primary)
const assistantY = 'u_assistant_st' // assistant, linked to sMain
const stranger = 'u_stranger_st' // teacher, neither primary nor linked anywhere
const parentU = 'u_parent_st' // parent (portal) — never assignable as section staff
const sMain = 's_main_st' // teacherId = teacherP
const sNull = 's_null_st' // teacherId = null (no primary yet)
const lMain = 'l_main_st' // a lesson in sMain, lesson.teacherId frozen = teacherP (the primary at materialize time)

const ctxFor = (userId: string, role: string, isPlatformAdmin = false): AuthContext => ({
  tenantId: org,
  userId,
  role,
  isPlatformAdmin,
})
const adminCtx = ctxFor(admin, 'owner')
const teacherPCtx = ctxFor(teacherP, 'teacher')
const coTeacherCtx = ctxFor(coTeacher, 'teacher')
const assistantLinkedCtx = ctxFor(assistantY, 'assistant')
const assistantUnlinkedCtx = ctxFor(stranger, 'assistant') // stranger holds no link → assistant sees nothing
const strangerCtx = ctxFor(stranger, 'teacher')

const cleanup = async () => {
  await db.delete(lesson).where(eq(lesson.tenantId, org))
  await db.delete(sectionTeacher).where(eq(sectionTeacher.tenantId, org))
  await db.delete(classSection).where(eq(classSection.tenantId, org))
  await db.delete(course).where(eq(course.tenantId, org))
  await db.delete(member).where(eq(member.organizationId, org))
  await db.delete(user).where(eq(user.id, admin))
  await db.delete(user).where(eq(user.id, teacherP))
  await db.delete(user).where(eq(user.id, coTeacher))
  await db.delete(user).where(eq(user.id, assistantY))
  await db.delete(user).where(eq(user.id, stranger))
  await db.delete(user).where(eq(user.id, parentU))
  await unseedOrg(org)
}

beforeAll(async () => {
  await cleanup()
  await seedOrg(org)
  const now = new Date()
  await db.insert(user).values([
    { id: admin, name: '管理员', email: 'admin_st@t.com', emailVerified: true },
    { id: teacherP, name: '主讲老师', email: 'tp_st@t.com', emailVerified: true },
    { id: coTeacher, name: '协同老师', email: 'co_st@t.com', emailVerified: true },
    { id: assistantY, name: '助教小李', email: 'ay_st@t.com', emailVerified: true },
    { id: stranger, name: '无关老师', email: 'sr_st@t.com', emailVerified: true },
    { id: parentU, name: '某家长', email: 'pa_st@t.com', emailVerified: true },
  ])
  await db.insert(member).values([
    { id: 'm_admin_st', organizationId: org, userId: admin, role: 'owner', createdAt: now },
    { id: 'm_tp_st', organizationId: org, userId: teacherP, role: 'teacher', createdAt: now },
    { id: 'm_co_st', organizationId: org, userId: coTeacher, role: 'teacher', createdAt: now },
    { id: 'm_ay_st', organizationId: org, userId: assistantY, role: 'assistant', createdAt: now },
    { id: 'm_sr_st', organizationId: org, userId: stranger, role: 'teacher', createdAt: now },
    { id: 'm_pa_st', organizationId: org, userId: parentU, role: 'parent', createdAt: now },
  ])
  await db.insert(course).values({ id: 'c_st', tenantId: org, title: '多教师课程' })
  await db.insert(classSection).values([
    { id: sMain, tenantId: org, courseId: 'c_st', name: '主班', teacherId: teacherP, capacity: 5 },
    { id: sNull, tenantId: org, courseId: 'c_st', name: '待指派', teacherId: null, capacity: 5 },
  ])
  // Co-teacher + assistant are LINKED to sMain but are NOT its primary teacher.
  await db.insert(sectionTeacher).values([
    { tenantId: org, sectionId: sMain, userId: coTeacher },
    { tenantId: org, sectionId: sMain, userId: assistantY },
  ])
  // A materialized lesson in sMain with teacherId frozen to teacherP — used to prove that ownership does
  // NOT ride on the stale lesson.teacherId after the primary is removed from the section.
  await db.insert(lesson).values({
    id: lMain,
    tenantId: org,
    sectionId: sMain,
    teacherId: teacherP,
    startAt: new Date(),
    endAt: new Date(Date.now() + 3_600_000),
    status: 'scheduled',
  })
})

afterAll(cleanup)

describe('section_teacher 成员制作用域', () => {
  it('the PRIMARY teacher owns their section (hybrid: teacherId is always a member)', async () => {
    expect(await isSectionMember(teacherPCtx, sMain)).toBe(false) // no explicit link row for the primary…
    expect(await actorOwnsSection(teacherPCtx, { id: sMain, teacherId: teacherP })).toBe(true) // …but owns via teacherId
    expect(new Set(await sectionIdsForActor(teacherPCtx))).toEqual(new Set([sMain]))
  })

  it('a LINKED co-teacher (not the primary) may open the section', async () => {
    expect(await isSectionMember(coTeacherCtx, sMain)).toBe(true)
    expect(await actorOwnsSection(coTeacherCtx, { id: sMain, teacherId: teacherP })).toBe(true)
    expect(await actorOwnsSectionById(coTeacherCtx, sMain)).toBe(true)
    expect(new Set(await sectionIdsForActor(coTeacherCtx))).toEqual(new Set([sMain]))
  })

  it('a LINKED assistant is section-scoped and sees only the linked section', async () => {
    expect(new Set(await sectionIdsForActor(assistantLinkedCtx))).toEqual(new Set([sMain]))
    expect(await actorOwnsSectionById(assistantLinkedCtx, sMain)).toBe(true)
  })

  it('an UNLINKED assistant sees NOTHING (no longer whole-tenant)', async () => {
    // assistantUnlinkedCtx is the `stranger` user acting as an assistant with no section_teacher link.
    const ids = await sectionIdsForActor(assistantUnlinkedCtx)
    expect(ids).not.toBe('all')
    expect(ids).toEqual([])
    expect(await actorOwnsSectionById(assistantUnlinkedCtx, sMain)).toBe(false)
  })

  it('a teacher who is neither primary nor linked cannot open the section', async () => {
    expect(await isSectionMember(strangerCtx, sMain)).toBe(false)
    expect(await actorOwnsSection(strangerCtx, { id: sMain, teacherId: teacherP })).toBe(false)
    expect(await actorOwnsSectionById(strangerCtx, sMain)).toBe(false)
    expect(await sectionIdsForActor(strangerCtx)).toEqual([])
  })

  it('actorOwnsLesson resolves the lesson CURRENT section (primary + co-teacher yes, stranger no)', async () => {
    // Before any removal: the primary and a linked co-teacher own the lesson; an unrelated teacher does not.
    expect(await actorOwnsLesson(teacherPCtx, lMain)).toBe(true)
    expect(await actorOwnsLesson(coTeacherCtx, lMain)).toBe(true)
    expect(await actorOwnsLesson(strangerCtx, lMain)).toBe(false)
  })
})

describe('addSectionTeacher / removeSectionTeacher — 管理员管理（course:update）', () => {
  it('a teacher (no course:update) cannot add or remove — returns {ok:false}', async () => {
    asActor(teacherPCtx)
    expect(await addSectionTeacher({ sectionId: sMain, userId: stranger })).toEqual({
      ok: false,
      error: '无权管理该班级的教师',
    })
    expect(await removeSectionTeacher({ sectionId: sMain, userId: coTeacher })).toEqual({
      ok: false,
      error: '无权管理该班级的教师',
    })
  })

  it('admin rejects a non-staff (portal) user and a non-member id', async () => {
    asActor(adminCtx)
    expect(await addSectionTeacher({ sectionId: sMain, userId: parentU })).toEqual({
      ok: false,
      error: '该用户不是当前机构的教师/助教',
    })
    expect((await addSectionTeacher({ sectionId: sMain, userId: 'ghost' })).ok).toBe(false)
  })

  it('admin adds a teacher/assistant (idempotent) and it grants access', async () => {
    asActor(adminCtx)
    const first = await addSectionTeacher({ sectionId: sMain, userId: stranger })
    expect(first).toEqual({ ok: true })
    // Idempotent re-add is a no-op success. There is no select-then-insert pre-check anymore: the second
    // add hits the insert, races uq_section_teacher_section_user, and the 23505 is swallowed — so this
    // exercises that unique-violation catch path against the real DB.
    expect(await addSectionTeacher({ sectionId: sMain, userId: stranger })).toEqual({ ok: true })
    // ...and no duplicate link row is created.
    const dupCheck = await db
      .select({ userId: sectionTeacher.userId })
      .from(sectionTeacher)
      .where(and(eq(sectionTeacher.sectionId, sMain), eq(sectionTeacher.userId, stranger)))
    expect(dupCheck).toHaveLength(1)
    // stranger, now linked, can open the section
    expect(await actorOwnsSectionById(strangerCtx, sMain)).toBe(true)
    // cleanup this link so later assertions on sMain's roster are stable
    await db
      .delete(sectionTeacher)
      .where(and(eq(sectionTeacher.sectionId, sMain), eq(sectionTeacher.userId, stranger)))
  })

  it('adding to a section with no primary sets it as the primary teacher', async () => {
    asActor(adminCtx)
    expect(await addSectionTeacher({ sectionId: sNull, userId: teacherP })).toEqual({ ok: true })
    const [row] = await db
      .select({ teacherId: classSection.teacherId })
      .from(classSection)
      .where(and(eq(classSection.tenantId, org), eq(classSection.id, sNull)))
    expect(row.teacherId).toBe(teacherP) // empty primary got filled
  })

  it('listSectionTeachers returns the roster with names, role and primary flag', async () => {
    asActor(adminCtx)
    const rows = await listSectionTeachers(sMain)
    const byId = new Map(rows.map((r) => [r.userId, r]))
    expect(byId.get(teacherP)?.isPrimary).toBe(true)
    expect(byId.get(teacherP)?.name).toBe('主讲老师')
    expect(byId.get(coTeacher)?.isPrimary).toBe(false)
    expect(byId.get(assistantY)?.role).toContain('assistant')
  })

  it('removing the PRIMARY promotes another linked member to primary', async () => {
    asActor(adminCtx)
    // sMain: primary=teacherP (no link row), plus links {coTeacher, assistantY}. Add a link for teacherP
    // too so removal has a deterministic "remaining member" set, then remove the primary.
    await addSectionTeacher({ sectionId: sMain, userId: teacherP })
    expect(await removeSectionTeacher({ sectionId: sMain, userId: teacherP })).toEqual({ ok: true })
    const [row] = await db
      .select({ teacherId: classSection.teacherId })
      .from(classSection)
      .where(and(eq(classSection.tenantId, org), eq(classSection.id, sMain)))
    // teacherP is gone; primary reassigned to one of the remaining links (coTeacher/assistantY), never null.
    expect(row.teacherId).not.toBe(teacherP)
    expect([coTeacher, assistantY]).toContain(row.teacherId)
    // teacherP no longer a member and no longer primary → access revoked.
    expect(await actorOwnsSectionById(teacherPCtx, sMain)).toBe(false)
    // CRITICAL regression: lMain.teacherId is still frozen to teacherP (materialize-time denormalization),
    // but ownership must follow the lesson's CURRENT section — teacherP was removed, so actorOwnsLesson
    // MUST be false. (The old code OR'd row.teacherId === ctx.userId and would have wrongly returned true,
    // letting a removed teacher keep editing grades/attendance/notes and cancel/reschedule old lessons.)
    expect(await actorOwnsLesson(teacherPCtx, lMain)).toBe(false)
    // The promoted primary (coTeacher or assistantY) still owns the lesson via the current section.
    expect(await actorOwnsLesson(coTeacherCtx, lMain)).toBe(true)
  })
})
