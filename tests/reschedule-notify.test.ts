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
  rescheduleRequest,
  notification,
  pushSubscription,
} from '@/db/schema'
import type { AuthContext } from '@/auth/context'
import { approveRescheduleRequestCore, rejectRescheduleRequestCore } from '@/lib/reschedule-core'

vi.mock('web-push', () => ({
  default: { setVapidDetails: vi.fn(), sendNotification: vi.fn(async () => ({ statusCode: 201 })) },
}))

const ctxFor = (tenantId: string, userId: string, role = 'owner'): AuthContext => ({
  tenantId,
  userId,
  role,
  isPlatformAdmin: false,
})

const org = 'org_resnotify_7b'
const ownerUserId = 'u_owner_resnotify_7b'
const parentUserId = 'u_parent_resnotify_7b'
const teacherId = 't_resnotify_7b'
const ownerCtx = () => ctxFor(org, ownerUserId, 'owner')
const at = (h: number, m = 0) => new Date(Date.UTC(2026, 7, 10, h, m)) // 2026-08-10

let studentId = ''
let sectionId = ''
let lessonApprove = ''
let lessonReject = ''
let reqApprove = ''
let reqReject = ''

const cleanup = async () => {
  await db.delete(notification).where(eq(notification.tenantId, org))
  await db.delete(pushSubscription).where(eq(pushSubscription.tenantId, org))
  await db.delete(rescheduleRequest).where(eq(rescheduleRequest.tenantId, org))
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

describe('reschedule outcome notifications — DB integration', () => {
  beforeAll(async () => {
    await cleanup()
    const seededAt = new Date()
    await db
      .insert(organization)
      .values([{ id: org, name: 'RN7b', slug: 'rn-7b-resnotify', createdAt: seededAt }])
    await db.insert(user).values([
      { id: ownerUserId, name: 'Owner', email: 'owner-resnotify-7b@t.com', emailVerified: true },
      { id: parentUserId, name: 'Parent', email: 'parent-resnotify-7b@t.com', emailVerified: true },
    ])
    await db.insert(member).values([
      {
        id: 'm_owner_resnotify_7b',
        organizationId: org,
        userId: ownerUserId,
        role: 'owner',
        createdAt: seededAt,
      },
      {
        id: 'm_parent_resnotify_7b',
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
    studentId = st.id
    await forTenant(ctx).insert(enrollment, { studentId, sectionId, status: 'active' })
    await forTenant(ctx).insert(portalLink, {
      studentId,
      userId: parentUserId,
      relationship: 'parent',
    })

    const [la] = (await forTenant(ctx).insert(lesson, {
      sectionId,
      teacherId,
      startAt: at(10),
      endAt: at(11),
    })) as { id: string }[]
    lessonApprove = la.id
    const [lr] = (await forTenant(ctx).insert(lesson, {
      sectionId,
      teacherId,
      startAt: at(18),
      endAt: at(19),
    })) as { id: string }[]
    lessonReject = lr.id

    const [ra] = (await forTenant(ctx).insert(rescheduleRequest, {
      lessonId: lessonApprove,
      studentId,
      requestedById: parentUserId,
      requestedStartAt: at(16),
      requestedEndAt: at(17),
      status: 'pending',
    })) as { id: string }[]
    reqApprove = ra.id
    const [rr] = (await forTenant(ctx).insert(rescheduleRequest, {
      lessonId: lessonReject,
      studentId,
      requestedById: parentUserId,
      status: 'pending',
    })) as { id: string }[]
    reqReject = rr.id
  })
  afterAll(cleanup)

  it('approve emits a reschedule_approved notification to the requester and the teacher', async () => {
    const res = await approveRescheduleRequestCore(ownerCtx(), reqApprove)
    expect(res.ok).toBe(true)
    const rows = (await forTenant(ownerCtx()).select(
      notification,
      eq(notification.type, 'reschedule_approved'),
    )) as (typeof notification.$inferSelect)[]
    const recipients = new Set(rows.map((r) => r.userId))
    expect(recipients.has(parentUserId)).toBe(true)
    expect(recipients.has(teacherId)).toBe(true)
    const parentRow = rows.find((r) => r.userId === parentUserId)!
    expect(parentRow.lessonId).toBe(lessonApprove)
    expect(parentRow.url).toBe('/portal/notifications')
  })

  it('reject emits a reschedule_rejected notification carrying the review note', async () => {
    await rejectRescheduleRequestCore(ownerCtx(), reqReject, '时间不合适')
    const rows = (await forTenant(ownerCtx()).select(
      notification,
      and(eq(notification.type, 'reschedule_rejected'), eq(notification.userId, parentUserId)),
    )) as (typeof notification.$inferSelect)[]
    expect(rows.length).toBe(1)
    expect(rows[0].body).toContain('时间不合适')
  })
})
