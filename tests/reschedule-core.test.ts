import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
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
  rescheduleRequest,
  portalLink,
} from '@/db/schema'
import type { AuthContext } from '@/auth/context'
import {
  createRescheduleRequestCore,
  approveRescheduleRequestCore,
  rejectRescheduleRequestCore,
  cancelRescheduleRequestCore,
} from '@/lib/reschedule-core'

const ctxFor = (tenantId: string, userId: string, role = 'owner'): AuthContext => ({
  tenantId,
  userId,
  role,
  isPlatformAdmin: false,
})

const org = 'org_resched_7a'
const ownerUserId = 'u_owner_resched_7a'
const parentUserId = 'u_parent_resched_7a'
const teacherId = 't_resched_7a'
const at = (h: number, m = 0) => new Date(Date.UTC(2026, 5, 15, h, m)) // 2026-06-15 (future, month 0-indexed)

let studentId = ''
let student2Id = '' // linked-but-different fixture is NOT needed; student2 is UNLINKED
let sectionId = ''
let section2Id = ''
let lessonA = '' // create/approve-happy
let lessonC = '' // approve-conflict subject
let lessonD = '' // reject
let lessonE = '' // cancel
let lessonF = '' // in section2 (student not enrolled) — not-enrolled test

const ownerCtx = () => ctxFor(org, ownerUserId, 'owner')
const parentCtx = () => ctxFor(org, parentUserId, 'parent')

const cleanup = async () => {
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

describe('reschedule-request workflow — DB integration', () => {
  beforeAll(async () => {
    await cleanup()
    const now = new Date()
    await db
      .insert(organization)
      .values([{ id: org, name: 'R7a', slug: 'r-7a-resched', createdAt: now }])
    await db.insert(user).values([
      { id: ownerUserId, name: 'Owner', email: 'owner-7a@t.com', emailVerified: true },
      { id: parentUserId, name: 'Parent', email: 'parent-7a@t.com', emailVerified: true },
    ])
    await db.insert(member).values([
      { id: 'm_owner_7a', organizationId: org, userId: ownerUserId, role: 'owner', createdAt: now },
      {
        id: 'm_parent_7a',
        organizationId: org,
        userId: parentUserId,
        role: 'parent',
        createdAt: now,
      },
    ])

    const ctx = ownerCtx()
    const [c] = (await forTenant(ctx).insert(course, { title: '数学' })) as { id: string }[]
    const [sec] = (await forTenant(ctx).insert(classSection, {
      courseId: c.id,
      teacherId,
      capacity: 1,
    })) as { id: string }[]
    sectionId = sec.id
    const [sec2] = (await forTenant(ctx).insert(classSection, {
      courseId: c.id,
      teacherId,
      capacity: 1,
    })) as { id: string }[]
    section2Id = sec2.id

    const [st] = (await forTenant(ctx).insert(student, { name: '小明' })) as { id: string }[]
    studentId = st.id
    const [st2] = (await forTenant(ctx).insert(student, { name: '小红' })) as { id: string }[]
    student2Id = st2.id

    // 小明 enrolled in section1 only; linked to the parent. 小红 exists but is NOT linked to the parent.
    await forTenant(ctx).insert(enrollment, { studentId, sectionId, status: 'active' })
    await forTenant(ctx).insert(portalLink, {
      studentId,
      userId: parentUserId,
      relationship: 'parent',
    })

    const mk = async (startH: number, endH: number, section = sectionId) => {
      const [l] = (await forTenant(ctx).insert(lesson, {
        sectionId: section,
        teacherId,
        startAt: at(startH),
        endAt: at(endH),
      })) as { id: string }[]
      return l.id
    }
    lessonA = await mk(10, 11)
    await mk(14, 15) // occupant at 14–15 (same teacher) — the slot the conflict test collides with
    lessonC = await mk(12, 13)
    lessonD = await mk(18, 19)
    lessonE = await mk(20, 21)
    lessonF = await mk(8, 9, section2Id) // section2 — 小明 not enrolled
  })
  afterAll(cleanup)

  it('parent creates a pending request for their linked+enrolled child', async () => {
    const row = await createRescheduleRequestCore(parentCtx(), {
      studentId,
      lessonId: lessonA,
      requestedStartAt: at(16),
      requestedEndAt: at(17),
      reason: '临时有事',
    })
    expect(row.status).toBe('pending')
    expect(row.studentId).toBe(studentId)
    expect(row.requestedById).toBe(parentUserId)
  })

  it('parent cannot request for an UNLINKED student (other child)', async () => {
    await expect(
      createRescheduleRequestCore(parentCtx(), {
        studentId: student2Id,
        lessonId: lessonA,
        requestedStartAt: at(16),
        requestedEndAt: at(17),
      }),
    ).rejects.toThrow('无权访问该学生')
  })

  it('parent cannot request against a lesson their child is not enrolled in', async () => {
    await expect(
      createRescheduleRequestCore(parentCtx(), {
        studentId,
        lessonId: lessonF, // section2 — not enrolled
        requestedStartAt: at(16),
        requestedEndAt: at(17),
      }),
    ).rejects.toThrow('该学生未在此班级')
  })

  it('teacher approves a free-slot request → lesson moved, request approved', async () => {
    const req = await createRescheduleRequestCore(parentCtx(), {
      studentId,
      lessonId: lessonA,
      requestedStartAt: at(16),
      requestedEndAt: at(17),
    })
    const res = await approveRescheduleRequestCore(ctxFor(org, ownerUserId, 'teacher'), req.id)
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.request.status).toBe('approved')
      expect(res.request.reviewedById).toBe(ownerUserId)
      expect(res.request.reviewedAt).toBeInstanceOf(Date)
      expect(new Date(res.event.start).getTime()).toBe(at(16).getTime())
    }
    const [moved] = (await forTenant(ownerCtx()).select(
      lesson,
      eq(lesson.id, lessonA),
    )) as (typeof lesson.$inferSelect)[]
    expect(moved.startAt.getTime()).toBe(at(16).getTime())
  })

  it('approving into a conflicting slot leaves the request pending and the lesson unmoved', async () => {
    const req = await createRescheduleRequestCore(parentCtx(), {
      studentId,
      lessonId: lessonC, // currently 12–13
      requestedStartAt: at(14), // collides with lessonB (14–15, same teacher)
      requestedEndAt: at(15),
    })
    const res = await approveRescheduleRequestCore(ownerCtx(), req.id)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toBe('CONFLICT')
    const [reloaded] = (await forTenant(ownerCtx()).select(
      rescheduleRequest,
      eq(rescheduleRequest.id, req.id),
    )) as (typeof rescheduleRequest.$inferSelect)[]
    expect(reloaded.status).toBe('pending')
    const [c] = (await forTenant(ownerCtx()).select(
      lesson,
      eq(lesson.id, lessonC),
    )) as (typeof lesson.$inferSelect)[]
    expect(c.startAt.getTime()).toBe(at(12).getTime()) // unmoved
  })

  it('teacher rejects a pending request', async () => {
    const req = await createRescheduleRequestCore(parentCtx(), {
      studentId,
      lessonId: lessonD,
      requestedStartAt: at(9),
      requestedEndAt: at(10),
    })
    const rejected = await rejectRescheduleRequestCore(ownerCtx(), req.id)
    expect(rejected.status).toBe('rejected')
    expect(rejected.reviewedById).toBe(ownerUserId)
  })

  it('a non-owner cannot cancel; second processing throws', async () => {
    const req = await createRescheduleRequestCore(parentCtx(), {
      studentId,
      lessonId: lessonE,
      requestedStartAt: at(9),
      requestedEndAt: at(10),
    })
    // a different portal user (not the requester) cannot cancel
    await expect(
      cancelRescheduleRequestCore(ctxFor(org, 'someone_else', 'parent'), req.id),
    ).rejects.toThrow('无权取消该申请')
    // owner rejects it
    await rejectRescheduleRequestCore(ownerCtx(), req.id)
    // re-processing a non-pending request throws
    await expect(approveRescheduleRequestCore(ownerCtx(), req.id)).rejects.toThrow('申请已处理')
    await expect(cancelRescheduleRequestCore(parentCtx(), req.id)).rejects.toThrow('申请已处理')
  })

  it('requester cancels their own pending request', async () => {
    const req = await createRescheduleRequestCore(parentCtx(), {
      studentId,
      lessonId: lessonE,
      requestedStartAt: at(22),
      requestedEndAt: at(23),
    })
    const canceled = await cancelRescheduleRequestCore(parentCtx(), req.id)
    expect(canceled.status).toBe('canceled')
  })
})
