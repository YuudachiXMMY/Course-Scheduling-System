import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { course, classSection, user, member } from '@/db/schema'
import { forTenant } from '@/db/tenant'
import { requireAuthContext, type AuthContext } from '@/auth/context'
import { seedOrg, unseedOrg } from './helpers/seed-org'

// 班级设置 → 归档/恢复 单个班级. archiveSection/restoreSection mirror archiveCourse/restoreCourse: a
// soft-delete (isArchived) that drops the section from listSections (rail) but keeps it restorable via
// listArchivedSections. 多教师改造 (PR#78): these are course:update actions, and a teacher now holds only
// course:[read,list] — so archive/restore is owner/admin-only (管理员在班级设置操作). A teacher, even the
// section's own primary, is read-only here and is denied at the permission gate.

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
// 多教师改造: archive/restore requires course:update, which only owner/admin hold. An admin is also a
// whole-tenant actor (isWholeTenantActor is role-based), so it owns every section in the tenant.
const adminCtx = ctxFor('u_sec_arch_admin', 'admin')

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

  it('an admin archives then restores, toggling the browse vs archived lists', async () => {
    asActor(adminCtx)
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

  it('refuses a read-only teacher archiving — even the section’s OWN primary', async () => {
    // teacherA is the primary of sectionA, yet post-PR#78 holds no course:update → denied at the gate.
    asActor(teacherACtx)
    const res = await archiveSection(sectionA)
    expect(res).toEqual({ ok: false, error: '无权执行该操作' })
    const row = await forTenant(adminCtx).findById(classSection, sectionA)
    expect(row?.isArchived).toBe(false)
  })

  it('refuses a read-only teacher restoring an admin-archived section', async () => {
    asActor(adminCtx)
    await archiveSection(sectionA)
    asActor(teacherBCtx)
    const res = await restoreSection(sectionA)
    expect(res).toEqual({ ok: false, error: '无权执行该操作' })
    const row = await forTenant(adminCtx).findById(classSection, sectionA)
    expect(row?.isArchived).toBe(true)
  })
})
