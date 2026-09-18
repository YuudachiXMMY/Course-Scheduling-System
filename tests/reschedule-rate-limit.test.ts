import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { forTenant } from '@/db/tenant'
import {
  course,
  classSection,
  student,
  enrollment,
  lesson,
  rescheduleRequest,
  portalLink,
} from '@/db/schema'
import type { AuthContext } from '@/auth/context'
import { createRescheduleRequestCore, cancelRescheduleRequestCore } from '@/lib/reschedule-core'
import { seedOrg, unseedOrg } from './helpers/seed-org'

// SEC5: createRescheduleRequestCore caps the number of OPEN (pending) requests a single portal user
// may hold (MAX_OPEN_RESCHEDULE_REQUESTS_PER_USER = 5) so an untrusted parent/student can't spam the
// teacher review queue. The domain tables carry FKs but tenantId is bare text — a unique tenantId
// isolates this suite's rows.
const ctxFor = (tenantId: string, userId: string, role: string): AuthContext => ({
  tenantId,
  userId,
  role,
  isPlatformAdmin: false,
})

const org = 'org_sec5_ratelimit'
const parentUserId = 'u_parent_sec5'
const teacherId = 't_sec5'
const at = (h: number) => new Date(Date.UTC(2026, 6, 20, h, 0)) // future date

let studentId = ''
let lessonId = ''

const ownerCtx = () => ctxFor(org, 'u_owner_sec5', 'owner')
const parentCtx = () => ctxFor(org, parentUserId, 'parent')

const mkRequest = (h: number) =>
  createRescheduleRequestCore(parentCtx(), {
    studentId,
    lessonId,
    requestedStartAt: at(h),
    requestedEndAt: at(h + 1),
  })

const cleanup = async () => {
  await db.delete(rescheduleRequest).where(eq(rescheduleRequest.tenantId, org))
  await db.delete(portalLink).where(eq(portalLink.tenantId, org))
  await db.delete(lesson).where(eq(lesson.tenantId, org))
  await db.delete(enrollment).where(eq(enrollment.tenantId, org))
  await db.delete(classSection).where(eq(classSection.tenantId, org))
  await db.delete(course).where(eq(course.tenantId, org))
  await db.delete(student).where(eq(student.tenantId, org))
  await unseedOrg(org)
}

describe('createRescheduleRequestCore — 每用户待处理配额 (SEC5)', () => {
  beforeAll(async () => {
    await cleanup()
    await seedOrg(org)
    const ctx = ownerCtx()
    const [c] = await forTenant(ctx).insert(course, { title: '数学' })
    const [sec] = await forTenant(ctx).insert(classSection, {
      courseId: c.id,
      teacherId,
      capacity: 10,
    })
    const [st] = await forTenant(ctx).insert(student, { name: '小明' })
    studentId = st.id
    await forTenant(ctx).insert(enrollment, { studentId, sectionId: sec.id, status: 'active' })
    await forTenant(ctx).insert(portalLink, {
      studentId,
      userId: parentUserId,
      relationship: 'parent',
    })
    const [l] = await forTenant(ctx).insert(lesson, {
      sectionId: sec.id,
      teacherId,
      startAt: at(9),
      endAt: at(10),
    })
    lessonId = l.id
  })
  afterAll(cleanup)

  it('第 6 个待处理申请被拒绝（前 5 个成功）', async () => {
    for (let i = 0; i < 5; i++) {
      const row = await mkRequest(11 + i)
      expect(row.status).toBe('pending')
    }
    // The 6th over the cap is rejected with a user-facing Chinese business message.
    await expect(mkRequest(20)).rejects.toThrow('待处理的改期申请过多')
  })

  it('取消一个待处理申请后重新腾出配额，可再次提交', async () => {
    const open = await forTenant(ownerCtx()).select(
      rescheduleRequest,
      eq(rescheduleRequest.status, 'pending'),
    )
    expect(open.length).toBe(5) // still at the cap from the previous test
    await cancelRescheduleRequestCore(parentCtx(), open[0].id) // free one slot
    const row = await mkRequest(8) // now under the cap again
    expect(row.status).toBe('pending')
  })
})
