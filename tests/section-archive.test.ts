import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { course, classSection, user, member } from '@/db/schema'
import { forTenant } from '@/db/tenant'
import { requireAuthContext, type AuthContext } from '@/auth/context'
import { seedOrg, unseedOrg } from './helpers/seed-org'

// 班级设置 → 归档/恢复 单个班级. archiveSection/restoreSection mirror archiveCourse/restoreCourse: a
// soft-delete (isArchived) that drops the section from listSections (rail) but keeps it restorable via
// listArchivedSections. Ownership is enforced so a teacher can't archive a colleague's class.

vi.mock('@/auth/context', async (importActual) => ({
  ...(await importActual<typeof import('@/auth/context')>()),
  requireAuthContext: vi.fn(),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import {
  archiveSection,
  restoreSection,
  listSections,
  listArchivedSections,
} from '@/app/dashboard/courses/actions'

const asActor = (ctx: AuthContext) => vi.mocked(requireAuthContext).mockResolvedValue(ctx)

const org = 'org_sec_archive'
const teacherA = 'u_sec_arch_a'
const teacherB = 'u_sec_arch_b'
const ctxFor = (userId: string, role = 'teacher'): AuthContext => ({
  tenantId: org,
  userId,
  role,
  isPlatformAdmin: false,
})
const teacherACtx = ctxFor(teacherA)
const teacherBCtx = ctxFor(teacherB)

let sectionA: string

const cleanup = async () => {
  await db.delete(classSection).where(eq(classSection.tenantId, org))
  await db.delete(course).where(eq(course.tenantId, org))
  await db.delete(member).where(eq(member.organizationId, org))
  await db.delete(user).where(eq(user.id, teacherA))
  await db.delete(user).where(eq(user.id, teacherB))
  await unseedOrg(org)
}

describe('archiveSection / restoreSection', () => {
  beforeEach(async () => {
    await cleanup()
    await seedOrg(org)
    const now = new Date()
    await db.insert(user).values([
      { id: teacherA, name: 'A', email: 'sa-a@t.com', emailVerified: true },
      { id: teacherB, name: 'B', email: 'sa-b@t.com', emailVerified: true },
    ])
    await db.insert(member).values([
      { id: 'm_sa_a', organizationId: org, userId: teacherA, role: 'teacher', createdAt: now },
      { id: 'm_sa_b', organizationId: org, userId: teacherB, role: 'teacher', createdAt: now },
    ])
    const [c] = (await forTenant(teacherACtx).insert(course, { title: '英语' })) as { id: string }[]
    const [s] = (await forTenant(teacherACtx).insert(classSection, {
      courseId: c.id,
      teacherId: teacherA,
      capacity: 1,
    })) as { id: string }[]
    sectionA = s.id
  })
  afterAll(cleanup)

  it('archives then restores, toggling the browse vs archived lists', async () => {
    asActor(teacherACtx)
    expect((await listSections()).map((s) => s.id)).toContain(sectionA)
    expect((await listArchivedSections()).map((s) => s.id)).not.toContain(sectionA)

    const arch = await archiveSection(sectionA)
    expect(arch.ok).toBe(true)
    expect((await listSections()).map((s) => s.id)).not.toContain(sectionA)
    expect((await listArchivedSections()).map((s) => s.id)).toContain(sectionA)

    const rest = await restoreSection(sectionA)
    expect(rest.ok).toBe(true)
    expect((await listSections()).map((s) => s.id)).toContain(sectionA)
    expect((await listArchivedSections()).map((s) => s.id)).not.toContain(sectionA)
  })

  it('refuses to archive another teacher’s section', async () => {
    asActor(teacherBCtx)
    const res = await archiveSection(sectionA)
    expect(res).toEqual({ ok: false, error: '无权归档该班级' })
    const row = await forTenant(teacherACtx).findById(classSection, sectionA)
    expect(row?.isArchived).toBe(false)
  })

  it('refuses to restore another teacher’s section', async () => {
    asActor(teacherACtx)
    await archiveSection(sectionA)
    asActor(teacherBCtx)
    const res = await restoreSection(sectionA)
    expect(res).toEqual({ ok: false, error: '无权恢复该班级' })
    const row = await forTenant(teacherACtx).findById(classSection, sectionA)
    expect(row?.isArchived).toBe(true)
  })
})
