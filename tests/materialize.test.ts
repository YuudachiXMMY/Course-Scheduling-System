import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { inArray, eq, and } from 'drizzle-orm'
import { DateTime } from 'luxon'
import { db } from '@/db'
import { organization, member, user, course, classSection, lesson } from '@/db/schema'
import { forTenant } from '@/db/tenant'
import { materializeSection } from '@/lib/materialize'
import type { AuthContext } from '@/auth/context'

const ctxFor = (tenantId: string, userId: string, role = 'owner'): AuthContext => ({
  tenantId,
  userId,
  role,
  isPlatformAdmin: false,
})

const org = 'org_mat'
const userId = 'user_mat'
const teacherId = userId
let sectionId: string

// Feature tables have no FK to organization → delete them explicitly (children first).
const cleanup = async () => {
  await db.delete(lesson).where(eq(lesson.tenantId, org))
  await db.delete(classSection).where(eq(classSection.tenantId, org))
  await db.delete(course).where(eq(course.tenantId, org))
  await db.delete(organization).where(inArray(organization.id, [org]))
  await db.delete(user).where(inArray(user.id, [userId]))
}

describe('materializeSection (idempotent + edit-preserving)', () => {
  beforeAll(async () => {
    await cleanup()
    const now = new Date()
    await db.insert(organization).values([{ id: org, name: 'M', slug: 'm', createdAt: now }])
    await db.insert(user).values([{ id: userId, name: 'M', email: 'm@m.com', emailVerified: true }])
    await db
      .insert(member)
      .values([{ id: 'm_m', organizationId: org, userId, role: 'owner', createdAt: now }])
    const ctx = ctxFor(org, userId)
    const [c] = (await forTenant(ctx).insert(course, { title: '物理' })) as { id: string }[]
    // 2026-03-02 is a Monday; 16:00 Asia/Shanghai.
    const dtstart = DateTime.fromObject(
      { year: 2026, month: 3, day: 2, hour: 16, minute: 0 },
      { zone: 'Asia/Shanghai' },
    )
      .toUTC()
      .toJSDate()
    const [s] = (await forTenant(ctx).insert(classSection, {
      courseId: c.id,
      teacherId,
      capacity: 1,
      rrule: 'FREQ=WEEKLY;BYDAY=MO;COUNT=4',
      recurrenceDtstart: dtstart,
      recurrenceTimezone: 'Asia/Shanghai',
      defaultDurationMinutes: 60,
    })) as { id: string }[]
    sectionId = s.id
  })
  afterAll(cleanup)

  it('first call inserts 4 occurrences; second call inserts 0 (idempotent)', async () => {
    const ctx = ctxFor(org, userId)
    const first = await materializeSection(ctx, sectionId)
    expect(first.inserted).toBe(4)
    const second = await materializeSection(ctx, sectionId)
    expect(second.inserted).toBe(0)
  })

  it('re-materialize preserves an edited (is_exception) and a canceled lesson', async () => {
    const ctx = ctxFor(org, userId)
    const rows = (await forTenant(ctx).select(
      lesson,
      eq(lesson.sectionId, sectionId),
    )) as (typeof lesson.$inferSelect)[]
    expect(rows.length).toBe(4)
    const sorted = [...rows].sort((a, b) => a.startAt.getTime() - b.startAt.getTime())

    // Edit the first occurrence: move it to a conflict-free slot (Sunday), keep originalStartAt.
    const edited = sorted[0]
    const movedStart = new Date(edited.startAt.getTime() - 24 * 60 * 60 * 1000) // 1 day earlier
    const movedEnd = new Date(edited.endAt.getTime() - 24 * 60 * 60 * 1000)
    await forTenant(ctx).update(lesson, edited.id, {
      startAt: movedStart,
      endAt: movedEnd,
      isException: true,
    })
    // Cancel the second occurrence (tombstone).
    const canceled = sorted[1]
    await forTenant(ctx).update(lesson, canceled.id, { status: 'canceled' })

    const res = await materializeSection(ctx, sectionId)
    expect(res.inserted).toBe(0) // slots already exist → onConflictDoNothing

    const afterEdited = (await forTenant(ctx).findById(lesson, edited.id)) as
      typeof lesson.$inferSelect | null
    expect(afterEdited?.isException).toBe(true)
    expect(afterEdited?.startAt.getTime()).toBe(movedStart.getTime())

    const afterCanceled = (await forTenant(ctx).findById(lesson, canceled.id)) as
      typeof lesson.$inferSelect | null
    expect(afterCanceled?.status).toBe('canceled')

    // Still exactly 4 rows for the section (no resurrection / duplication).
    const finalRows = (await forTenant(ctx).select(
      lesson,
      and(eq(lesson.sectionId, sectionId)),
    )) as (typeof lesson.$inferSelect)[]
    expect(finalRows.length).toBe(4)
  })
})

// Regression: term_start_date / term_end_date are stored at UTC midnight but the section runs in
// Asia/Shanghai (+08). The window must snap to the FULL local day, else the lesson ON term_end_date
// (16:00 local, past the old 08:00-local clip) is silently dropped.
describe('materializeSection term window (local-day bounds)', () => {
  const org2 = 'org_mat_term'
  const uid2 = 'user_mat_term'
  let sid2: string

  const cleanup2 = async () => {
    await db.delete(lesson).where(eq(lesson.tenantId, org2))
    await db.delete(classSection).where(eq(classSection.tenantId, org2))
    await db.delete(course).where(eq(course.tenantId, org2))
    await db.delete(organization).where(inArray(organization.id, [org2]))
    await db.delete(user).where(inArray(user.id, [uid2]))
  }

  beforeAll(async () => {
    await cleanup2()
    const now = new Date()
    await db.insert(organization).values([{ id: org2, name: 'MT', slug: 'mt', createdAt: now }])
    await db.insert(user).values([{ id: uid2, name: 'MT', email: 'mt@m.com', emailVerified: true }])
    await db
      .insert(member)
      .values([{ id: 'm_mt', organizationId: org2, userId: uid2, role: 'owner', createdAt: now }])
    const ctx = ctxFor(org2, uid2)
    const [c] = (await forTenant(ctx).insert(course, { title: '英语' })) as { id: string }[]
    // 16:00 Asia/Shanghai on the first Monday (2026-03-02).
    const dtstart = DateTime.fromObject(
      { year: 2026, month: 3, day: 2, hour: 16, minute: 0 },
      { zone: 'Asia/Shanghai' },
    )
      .toUTC()
      .toJSDate()
    const [s] = (await forTenant(ctx).insert(classSection, {
      courseId: c.id,
      teacherId: uid2,
      capacity: 1,
      rrule: 'FREQ=WEEKLY;BYDAY=MO', // bounded only by the term window
      recurrenceDtstart: dtstart,
      recurrenceTimezone: 'Asia/Shanghai',
      defaultDurationMinutes: 60,
      // Stored at UTC midnight, exactly as createSection() persists them.
      termStartDate: new Date('2026-03-02T00:00:00Z'),
      termEndDate: new Date('2026-03-30T00:00:00Z'),
    })) as { id: string }[]
    sid2 = s.id
  })
  afterAll(cleanup2)

  it('materializes the lesson on term_end_date itself (16:00 local, past the old 08:00 clip)', async () => {
    const ctx = ctxFor(org2, uid2)
    const res = await materializeSection(ctx, sid2)
    // Mondays 03-02, 03-09, 03-16, 03-23, 03-30 → 5 (the 03-30 one used to be clipped to 4).
    expect(res.inserted).toBe(5)
    const rows = (await forTenant(ctx).select(
      lesson,
      eq(lesson.sectionId, sid2),
    )) as (typeof lesson.$inferSelect)[]
    const days = rows
      .map((r) => DateTime.fromJSDate(r.startAt).setZone('Asia/Shanghai').toFormat('yyyy-MM-dd'))
      .sort()
    expect(days).toContain('2026-03-30')
  })
})
