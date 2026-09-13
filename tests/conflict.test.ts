import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { inArray, eq } from 'drizzle-orm'
import { db } from '@/db'
import { organization, member, user, course, classSection, lesson } from '@/db/schema'
import { forTenant } from '@/db/tenant'
import { checkTeacherConflict } from '@/lib/conflict'
import { isExclusionViolation } from '@/lib/errors'
import type { AuthContext } from '@/auth/context'

const ctxFor = (tenantId: string, userId: string, role = 'owner'): AuthContext => ({
  tenantId,
  userId,
  role,
  isPlatformAdmin: false,
})

const org = 'org_conflict'
const userId = 'user_conflict'
const teacherId = userId
let courseId: string
let sectionId: string

// A known Monday base (UTC times used directly — the app stores UTC instants).
const at = (h: number, m = 0) => new Date(Date.UTC(2026, 2, 2, h, m)) // 2026-03-02

// Feature tables carry tenant_id but have NO FK to organization, so deleting the org does not
// cascade to them. Delete feature rows explicitly (children before parents) so the suite is
// re-runnable against a persistent DB.
const cleanup = async () => {
  await db.delete(lesson).where(eq(lesson.tenantId, org))
  await db.delete(classSection).where(eq(classSection.tenantId, org))
  await db.delete(course).where(eq(course.tenantId, org))
  await db.delete(organization).where(inArray(organization.id, [org]))
  await db.delete(user).where(inArray(user.id, [userId]))
}

describe('teacher conflict detection + GiST backstop', () => {
  beforeAll(async () => {
    await cleanup()
    const now = new Date()
    await db.insert(organization).values([{ id: org, name: 'C', slug: 'c', createdAt: now }])
    await db.insert(user).values([{ id: userId, name: 'T', email: 't@t.com', emailVerified: true }])
    await db
      .insert(member)
      .values([{ id: 'm_c', organizationId: org, userId, role: 'owner', createdAt: now }])
    const ctx = ctxFor(org, userId)
    const [c] = (await forTenant(ctx).insert(course, { title: '数学' })) as { id: string }[]
    courseId = c.id
    const [s] = (await forTenant(ctx).insert(classSection, {
      courseId,
      teacherId,
      capacity: 1,
    })) as { id: string }[]
    sectionId = s.id
    // Existing teacher lesson 10:00–11:00.
    await db.insert(lesson).values({
      tenantId: org,
      sectionId,
      teacherId,
      startAt: at(10),
      endAt: at(11),
      status: 'scheduled',
      originalStartAt: at(10),
    })
  })
  afterAll(cleanup)

  it('detects an overlapping teacher lesson and returns suggestions', async () => {
    const res = await checkTeacherConflict(ctxFor(org, userId), {
      teacherId,
      startAt: at(10, 30),
      endAt: at(11, 30),
    })
    expect(res.hasConflict).toBe(true)
    expect(res.conflicts.length).toBeGreaterThan(0)
    expect(res.suggestions.length).toBeGreaterThan(0)
  })

  it('allows back-to-back lessons (10:00 end → 11:00 start)', async () => {
    const res = await checkTeacherConflict(ctxFor(org, userId), {
      teacherId,
      startAt: at(11),
      endAt: at(12),
    })
    expect(res.hasConflict).toBe(false)
  })

  it('ignores canceled lessons', async () => {
    // Insert a canceled lesson overlapping 14:00–15:00.
    await db.insert(lesson).values({
      tenantId: org,
      sectionId,
      teacherId,
      startAt: at(14),
      endAt: at(15),
      status: 'canceled',
      originalStartAt: at(14),
    })
    const res = await checkTeacherConflict(ctxFor(org, userId), {
      teacherId,
      startAt: at(14, 15),
      endAt: at(14, 45),
    })
    expect(res.hasConflict).toBe(false)
  })

  it('GiST constraint rejects a direct overlapping non-canceled insert (23P01)', async () => {
    let threw = false
    try {
      await db.insert(lesson).values({
        tenantId: org,
        sectionId,
        teacherId,
        startAt: at(10, 30),
        endAt: at(11, 30),
        status: 'scheduled',
        originalStartAt: at(10, 30),
      })
    } catch (e) {
      threw = true
      expect(isExclusionViolation(e)).toBe(true)
    }
    expect(threw).toBe(true)
  })

  it('null-teacher lessons are exempt from the exclusion constraint', async () => {
    await db.insert(lesson).values([
      {
        tenantId: org,
        sectionId,
        teacherId: null,
        startAt: at(18),
        endAt: at(19),
        status: 'scheduled',
        originalStartAt: at(18),
      },
      {
        tenantId: org,
        sectionId,
        teacherId: null,
        startAt: at(18, 30),
        endAt: at(19, 30),
        status: 'scheduled',
        originalStartAt: at(18, 30),
      },
    ])
    // No throw = exempt. Confirm both rows landed.
    const rows = (await forTenant(ctxFor(org, userId)).select(lesson)) as {
      teacherId: string | null
    }[]
    expect(rows.filter((r) => r.teacherId === null).length).toBe(2)
  })
})
