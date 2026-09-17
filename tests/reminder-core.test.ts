import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { and, eq, inArray } from 'drizzle-orm'
import { db } from '@/db'
import { forTenant } from '@/db/tenant'
import {
  organization,
  user,
  member,
  course,
  classSection,
  student,
  enrollment,
  lesson,
  portalLink,
  notification,
  pushSubscription,
} from '@/db/schema'
import type { AuthContext } from '@/auth/context'
import { runReminderScanCore } from '@/lib/reminder-core'

// web-push is CJS default-exported; mock it so no network is touched even if VAPID were configured.
vi.mock('web-push', () => ({
  default: { setVapidDetails: vi.fn(), sendNotification: vi.fn(async () => ({ statusCode: 201 })) },
}))

const ctxFor = (tenantId: string, userId: string, role = 'owner'): AuthContext => ({
  tenantId,
  userId,
  role,
  isPlatformAdmin: false,
})

const org = 'org_reminder_7b'
const ownerUserId = 'u_owner_reminder_7b'
const parentUserId = 'u_parent_reminder_7b'
const teacherId = 't_reminder_7b'
const ownerCtx = () => ctxFor(org, ownerUserId, 'owner')

// Fixed scan instant + window offsets (no fake timers — codebase convention).
const now = new Date(Date.UTC(2026, 6, 20, 12, 0))
const plus = (min: number) => new Date(now.getTime() + min * 60_000)

let sectionId = ''
let lessonSoon = '' // +30m → in 1h AND 24h windows
let lessonMid = '' // +90m → in 24h window only
let lessonFar = '' // +30h → neither
let lessonCanceled = '' // +200m, canceled → excluded by status

const cleanup = async () => {
  await db.delete(notification).where(eq(notification.tenantId, org))
  await db.delete(pushSubscription).where(eq(pushSubscription.tenantId, org))
  await db.delete(portalLink).where(eq(portalLink.tenantId, org))
  await db.delete(lesson).where(eq(lesson.tenantId, org))
  await db.delete(enrollment).where(eq(enrollment.tenantId, org))
  await db.delete(classSection).where(eq(classSection.tenantId, org))
  await db.delete(course).where(eq(course.tenantId, org))
  await db.delete(student).where(eq(student.tenantId, org))
  await db.delete(member).where(eq(member.organizationId, org))
  await db.delete(organization).where(eq(organization.id, org))
  await db.delete(user).where(inArray(user.id, [ownerUserId, parentUserId]))
}

describe('reminder-core — upcoming-lesson scan — DB integration', () => {
  beforeAll(async () => {
    await cleanup()
    const seededAt = new Date()
    await db
      .insert(organization)
      .values([{ id: org, name: 'R7b', slug: 'r-7b-reminder', createdAt: seededAt }])
    await db.insert(user).values([
      { id: ownerUserId, name: 'Owner', email: 'owner-reminder-7b@t.com', emailVerified: true },
      { id: parentUserId, name: 'Parent', email: 'parent-reminder-7b@t.com', emailVerified: true },
    ])
    await db.insert(member).values([
      {
        id: 'm_owner_reminder_7b',
        organizationId: org,
        userId: ownerUserId,
        role: 'owner',
        createdAt: seededAt,
      },
      {
        id: 'm_parent_reminder_7b',
        organizationId: org,
        userId: parentUserId,
        role: 'parent',
        createdAt: seededAt,
      },
    ])

    const ctx = ownerCtx()
    const [c] = (await forTenant(ctx).insert(course, { title: '数学' })) as { id: string }[]
    const [sec] = (await forTenant(ctx).insert(classSection, {
      courseId: c.id,
      teacherId,
      capacity: 5,
    })) as { id: string }[]
    sectionId = sec.id
    const [st] = (await forTenant(ctx).insert(student, { name: '小明' })) as { id: string }[]
    await forTenant(ctx).insert(enrollment, { studentId: st.id, sectionId, status: 'active' })
    await forTenant(ctx).insert(portalLink, {
      studentId: st.id,
      userId: parentUserId,
      relationship: 'parent',
    })

    const mk = async (startMin: number, endMin: number, status?: 'scheduled' | 'canceled') => {
      const [l] = (await forTenant(ctx).insert(lesson, {
        sectionId,
        teacherId,
        startAt: plus(startMin),
        endAt: plus(endMin),
        ...(status ? { status } : {}),
      })) as { id: string }[]
      return l.id
    }
    // Non-overlapping time ranges for the same teacher to avoid the lesson exclusion constraint.
    lessonSoon = await mk(30, 55)
    lessonMid = await mk(90, 115)
    lessonFar = await mk(1800, 1825)
    lessonCanceled = await mk(200, 225, 'canceled')
  })
  afterAll(cleanup)

  it('creates 24h+1h reminders for teacher + parent, excluding out-of-window / canceled lessons', async () => {
    const { created } = await runReminderScanCore(ownerCtx(), now)
    // lessonSoon: 2 offsets × 2 recipients = 4; lessonMid: 1 offset × 2 recipients = 2 → 6.
    expect(created).toBe(6)

    const parentRows = (await forTenant(ownerCtx()).select(
      notification,
      and(eq(notification.userId, parentUserId), eq(notification.type, 'lesson_reminder')),
    )) as (typeof notification.$inferSelect)[]
    expect(parentRows.length).toBe(3)
    // dedupeKey shape is `reminder:<lessonId>:<offset>:<startMs>:<userId>` — assert the (lesson,
    // offset) pairs robustly without pinning the exact start-instant encoding.
    const hasKey = (lessonId: string, offset: string) =>
      parentRows.some(
        (r) =>
          r.dedupeKey?.startsWith(`reminder:${lessonId}:${offset}:`) &&
          r.dedupeKey?.endsWith(`:${parentUserId}`),
      )
    expect(hasKey(lessonSoon, '1h')).toBe(true)
    expect(hasKey(lessonSoon, '24h')).toBe(true)
    expect(hasKey(lessonMid, '24h')).toBe(true)

    const teacherRows = (await forTenant(ownerCtx()).select(
      notification,
      and(eq(notification.userId, teacherId), eq(notification.type, 'lesson_reminder')),
    )) as (typeof notification.$inferSelect)[]
    expect(teacherRows.length).toBe(3)

    // out-of-window (+30h) and canceled lessons produced nothing.
    const allRows = (await forTenant(ownerCtx()).select(
      notification,
      eq(notification.type, 'lesson_reminder'),
    )) as (typeof notification.$inferSelect)[]
    const lessonIds = new Set(allRows.map((r) => r.lessonId))
    expect(lessonIds.has(lessonFar)).toBe(false)
    expect(lessonIds.has(lessonCanceled)).toBe(false)
    expect(lessonIds.has(lessonSoon)).toBe(true)
    expect(lessonIds.has(lessonMid)).toBe(true)
  })

  it('is idempotent — a second scan with the same now creates nothing', async () => {
    const { created } = await runReminderScanCore(ownerCtx(), now)
    expect(created).toBe(0)
  })

  it('a rescheduled lesson (same id, new time) gets a FRESH reminder — dedupeKey carries startAt', async () => {
    const ctx = ownerCtx()
    // Simulate a reschedule: same lesson row/id, moved to a different (still-in-24h-window) slot.
    await forTenant(ctx).update(lesson, lessonMid, { startAt: plus(125), endAt: plus(130) })
    const { created } = await runReminderScanCore(ctx, now)
    // The moved lesson is no longer suppressed by its stale-time key → teacher + parent get a fresh
    // 24h reminder for the NEW time (2). Were the key time-invariant, this would wrongly be 0.
    expect(created).toBe(2)
    const midRows = (await forTenant(ctx).select(
      notification,
      and(eq(notification.userId, parentUserId), eq(notification.type, 'lesson_reminder')),
    )) as (typeof notification.$inferSelect)[]
    const midKeys = midRows.filter((r) => r.dedupeKey?.startsWith(`reminder:${lessonMid}:24h:`))
    expect(midKeys.length).toBe(2) // stale (+90m) + fresh (+125m)
  })
})
