import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { eq } from 'drizzle-orm'
import { DateTime } from 'luxon'
import { db } from '@/db'
import { organization, member, user, course, classSection, lesson } from '@/db/schema'
import { forTenant } from '@/db/tenant'
import { suggestFreeSlots } from '@/lib/conflict'
import { APP_TIME_ZONE } from '@/lib/timezone'
import type { AuthContext } from '@/auth/context'

// CR9: suggestFreeSlots filtered busy lessons by START time only, so a lesson beginning BEFORE the
// 08:00 business-hours boundary but overlapping into it (e.g. 07:30–08:45) was missed, and its slots
// were wrongly offered as free. The fix queries by tstzrange OVERLAP with the window. This test seeds a
// pre-boundary overlapping lesson and asserts 08:00/08:30 are NOT suggested while a later free slot is.

const org = 'org_suggest_overlap'
const userId = 'user_suggest_overlap'
const ctx: AuthContext = { tenantId: org, userId, role: 'owner', isPlatformAdmin: false }

// 2026-06-01 is EDT (America/Toronto, UTC-4) — DST active, no gap concerns.
const toronto = (h: number, m: number) =>
  DateTime.fromObject({ year: 2026, month: 6, day: 1, hour: h, minute: m }, { zone: APP_TIME_ZONE })
    .toUTC()
    .toJSDate()

const cleanup = async () => {
  await db.delete(lesson).where(eq(lesson.tenantId, org))
  await db.delete(classSection).where(eq(classSection.tenantId, org))
  await db.delete(course).where(eq(course.tenantId, org))
  await db.delete(member).where(eq(member.organizationId, org))
  await db.delete(organization).where(eq(organization.id, org))
  await db.delete(user).where(eq(user.id, userId))
}

const hhmm = (d: Date) => DateTime.fromJSDate(d).setZone(APP_TIME_ZONE).toFormat('HH:mm')

describe('suggestFreeSlots window overlap (CR9)', () => {
  beforeAll(async () => {
    await cleanup()
    const now = new Date()
    await db.insert(organization).values({ id: org, name: 'O', slug: 'sugg-ov', createdAt: now })
    await db
      .insert(user)
      .values({ id: userId, name: 'T', email: 'suggov@t.com', emailVerified: true })
    await db
      .insert(member)
      .values({ id: 'm_so', organizationId: org, userId, role: 'owner', createdAt: now })
    const [c] = await forTenant(ctx).insert(course, { title: '重叠课程' })
    const [s] = await forTenant(ctx).insert(classSection, {
      courseId: c.id,
      teacherId: userId,
      capacity: 1,
    })
    // A lesson that STARTS before the 08:00 window (07:30) and overlaps into it (ends 08:45 local).
    await db.insert(lesson).values({
      tenantId: org,
      sectionId: s.id,
      teacherId: userId,
      startAt: toronto(7, 30),
      endAt: toronto(8, 45),
      status: 'scheduled',
      originalStartAt: toronto(7, 30),
    })
  })
  afterAll(cleanup)

  it('a 07:30–08:45 lesson removes the 08:00 and 08:30 slots from suggestions', async () => {
    const suggestions = await suggestFreeSlots(ctx, {
      teacherId: userId,
      startAt: toronto(10, 0),
      endAt: toronto(11, 0), // 60-min duration
    })
    const times = suggestions.map(hhmm)
    expect(times).not.toContain('08:00')
    expect(times).not.toContain('08:30')
    // The first fully-free 60-min slot after the pre-boundary lesson is 09:00 (lesson ends 08:45).
    expect(times).toContain('09:00')
  })
})
