import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { organization, member, user, course, classSection, student, enrollment } from '@/db/schema'
import { requireAuthContext, type AuthContext } from '@/auth/context'

// CR3: enrollStudent's capacity check-then-act was a race — two concurrent enrollments of DIFFERENT
// students into a section with one free seat both read count < capacity and both wrote → over-capacity.
// The fix serializes same-section enrollers with db.transaction + SELECT ... FOR UPDATE on the section
// row and re-counts inside the lock. This test fires two concurrent enrollStudent calls into a
// capacity-1 section and asserts exactly ONE ends active (the other is rejected as full).
vi.mock('@/auth/context', async (importActual) => ({
  ...(await importActual<typeof import('@/auth/context')>()),
  requireAuthContext: vi.fn(),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { enrollStudent } from '@/app/dashboard/schedule/enrollment-actions'

const org = 'org_enroll_cap'
const userId = 'user_enroll_cap'
const ctx: AuthContext = { tenantId: org, userId, role: 'owner', isPlatformAdmin: false }
const sectionId = 's_enroll_cap'
const stuA = 'stu_cap_a'
const stuB = 'stu_cap_b'

const cleanup = async () => {
  await db.delete(enrollment).where(eq(enrollment.tenantId, org))
  await db.delete(student).where(eq(student.tenantId, org))
  await db.delete(classSection).where(eq(classSection.tenantId, org))
  await db.delete(course).where(eq(course.tenantId, org))
  await db.delete(member).where(eq(member.organizationId, org))
  await db.delete(organization).where(eq(organization.id, org))
  await db.delete(user).where(eq(user.id, userId))
}

describe('enrollStudent capacity race (CR3)', () => {
  beforeAll(async () => {
    await cleanup()
    const now = new Date()
    await db.insert(organization).values({ id: org, name: 'E', slug: 'enroll-cap', createdAt: now })
    await db
      .insert(user)
      .values({ id: userId, name: 'O', email: 'enrollcap@t.com', emailVerified: true })
    await db
      .insert(member)
      .values({ id: 'm_ec', organizationId: org, userId, role: 'owner', createdAt: now })
    await db.insert(course).values({ id: 'c_ec', tenantId: org, title: '容量课程' })
    await db
      .insert(classSection)
      .values({ id: sectionId, tenantId: org, courseId: 'c_ec', teacherId: userId, capacity: 1 })
    await db.insert(student).values([
      { id: stuA, tenantId: org, name: '甲' },
      { id: stuB, tenantId: org, name: '乙' },
    ])
    vi.mocked(requireAuthContext).mockResolvedValue(ctx)
  })
  afterAll(cleanup)

  it('two concurrent enrolls into a capacity-1 section leave exactly 1 active', async () => {
    const results = await Promise.allSettled([
      enrollStudent({ studentId: stuA, sectionId }),
      enrollStudent({ studentId: stuB, sectionId }),
    ])

    const active = await db
      .select()
      .from(enrollment)
      .where(and(eq(enrollment.sectionId, sectionId), eq(enrollment.status, 'active')))
    expect(active.length).toBe(1)

    const fulfilled = results.filter((r) => r.status === 'fulfilled')
    const rejected = results.filter((r) => r.status === 'rejected')
    expect(fulfilled.length).toBe(1)
    expect(rejected.length).toBe(1)
    if (rejected[0]?.status === 'rejected') {
      expect(String(rejected[0].reason?.message ?? rejected[0].reason)).toContain('班级已满')
    }
  })
})
