import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { organization, member, user, course, classSection, sectionMeeting } from '@/db/schema'
import { requireAuthContext, type AuthContext } from '@/auth/context'

// CR1: sectionSchema must enforce termEndDate >= termStartDate ON THE SERVER (server actions are a
// public boundary; the client-only guard is bypassable). sectionSchema is module-private inside a
// 'use server' file (can't be exported), so drive it through the createSection action — mock only
// requireAuthContext (importActual keeps AuthError etc.) and stub next/cache.
vi.mock('@/auth/context', async (importActual) => ({
  ...(await importActual<typeof import('@/auth/context')>()),
  requireAuthContext: vi.fn(),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { createSection } from '@/app/dashboard/courses/actions'

const org = 'org_section_schema'
const userId = 'user_section_schema'
const ctx: AuthContext = { tenantId: org, userId, role: 'owner', isPlatformAdmin: false }
const courseId = 'c_section_schema'

const base = () => ({
  courseId,
  teacherId: userId,
  capacity: 3,
  meetings: [{ byDay: 'MO' as const, startTime: '16:00', durationMinutes: 60 }],
  termStartDate: '2026-03-01',
})

const cleanup = async () => {
  await db.delete(sectionMeeting).where(eq(sectionMeeting.tenantId, org))
  await db.delete(classSection).where(eq(classSection.tenantId, org))
  await db.delete(course).where(eq(course.tenantId, org))
  await db.delete(member).where(eq(member.organizationId, org))
  await db.delete(organization).where(eq(organization.id, org))
  await db.delete(user).where(eq(user.id, userId))
}

describe('sectionSchema term date cross-field validation (CR1)', () => {
  beforeAll(async () => {
    await cleanup()
    const now = new Date()
    await db.insert(organization).values({ id: org, name: 'S', slug: 'sec-schema', createdAt: now })
    await db
      .insert(user)
      .values({ id: userId, name: 'O', email: 'secschema@t.com', emailVerified: true })
    await db
      .insert(member)
      .values({ id: 'm_ss', organizationId: org, userId, role: 'owner', createdAt: now })
    await db.insert(course).values({ id: courseId, tenantId: org, title: '排期课程' })
    vi.mocked(requireAuthContext).mockResolvedValue(ctx)
  })
  afterAll(cleanup)

  it('rejects termEndDate earlier than termStartDate', async () => {
    const res = await createSection({ ...base(), termEndDate: '2026-02-01' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toBe('学期结束日期不能早于开始日期')
  })

  it('accepts termEndDate equal to termStartDate', async () => {
    const res = await createSection({ ...base(), termEndDate: '2026-03-01' })
    expect(res.ok).toBe(true)
  })

  it('accepts termEndDate after termStartDate', async () => {
    const res = await createSection({ ...base(), termEndDate: '2026-06-30' })
    expect(res.ok).toBe(true)
  })

  it('accepts an omitted termEndDate', async () => {
    const res = await createSection(base())
    expect(res.ok).toBe(true)
  })
})
