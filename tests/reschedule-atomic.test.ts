import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { course, classSection, student, enrollment, lesson, rescheduleRequest } from '@/db/schema'
import { forTenant } from '@/db/tenant'
import { approveRescheduleRequestCore, rejectRescheduleRequestCore } from '@/lib/reschedule-core'
import type { AuthContext } from '@/auth/context'
import { seedOrg, unseedOrg } from './helpers/seed-org'

// 评审 Slice G / B19/B20 —— 改期审批 check-then-act 非原子。approve/reject/cancel 曾是"无锁读 → 判 pending →
// 副作用 → 写状态"，并发审批可致课节已移动却记为拒绝、双通知。修复：终态写为带 status='pending' 谓词的原子
// compare-and-set（forTenant.updateWhere），0 行视为冲突；approve 先原子认领再移动，移动失败补偿回滚。

const org = 'org_resched_atomic'
const teacher = 'u_teacher_ra'
const stu = 'stu_ra'
const sec = 's_ra'
const les = 'l_ra'
const reqId = 'req_ra'

const ctx: AuthContext = { tenantId: org, userId: teacher, role: 'teacher', isPlatformAdmin: false }

const origStart = new Date(Date.now() + 86_400_000) // +1d
const origEnd = new Date(Date.now() + 90_000_000)
const reqStart = new Date(Date.now() + 2 * 86_400_000) // +2d
const reqEnd = new Date(Date.now() + 2 * 86_400_000 + 3_600_000)

const cleanup = async () => {
  await db.delete(rescheduleRequest).where(eq(rescheduleRequest.tenantId, org))
  await db.delete(enrollment).where(eq(enrollment.tenantId, org))
  await db.delete(lesson).where(eq(lesson.tenantId, org))
  await db.delete(classSection).where(eq(classSection.tenantId, org))
  await db.delete(student).where(eq(student.tenantId, org))
  await db.delete(course).where(eq(course.tenantId, org))
  await unseedOrg(org)
}

async function seed() {
  await cleanup()
  await seedOrg(org)
  await db.insert(course).values({ id: 'c_ra', tenantId: org, title: '原子改期课程' })
  await db
    .insert(classSection)
    .values({
      id: sec,
      tenantId: org,
      courseId: 'c_ra',
      name: 'RA',
      teacherId: teacher,
      capacity: 5,
    })
  await db.insert(student).values({ id: stu, tenantId: org, name: '学生RA' })
  await db
    .insert(enrollment)
    .values({ tenantId: org, studentId: stu, sectionId: sec, status: 'active' })
  await db.insert(lesson).values({
    id: les,
    tenantId: org,
    sectionId: sec,
    teacherId: teacher,
    startAt: origStart,
    endAt: origEnd,
    status: 'scheduled',
  })
  await db.insert(rescheduleRequest).values({
    id: reqId,
    tenantId: org,
    lessonId: les,
    studentId: stu,
    requestedById: stu,
    requestedStartAt: reqStart,
    requestedEndAt: reqEnd,
    status: 'pending',
  })
}

beforeEach(seed)
afterAll(cleanup)

describe('forTenant.updateWhere — 谓词式原子 compare-and-set (S0)', () => {
  it('谓词匹配时更新 1 行；不再匹配时返回 0 行', async () => {
    const first = await forTenant(ctx).updateWhere(
      rescheduleRequest,
      reqId,
      eq(rescheduleRequest.status, 'pending'),
      { status: 'canceled' },
    )
    expect(first.length).toBe(1)
    const second = await forTenant(ctx).updateWhere(
      rescheduleRequest,
      reqId,
      eq(rescheduleRequest.status, 'pending'), // 现已 canceled，谓词不再成立
      { status: 'rejected' },
    )
    expect(second.length).toBe(0)
  })
})

describe('改期审批并发原子性 (B19/B20)', () => {
  it('并发 approve + reject 同一 pending 申请：恰一个胜出，状态与课节移动一致', async () => {
    const [ap, rj] = await Promise.allSettled([
      approveRescheduleRequestCore(ctx, reqId),
      rejectRescheduleRequestCore(ctx, reqId),
    ])

    const [reqRow] = (await forTenant(ctx).select(
      rescheduleRequest,
      eq(rescheduleRequest.id, reqId),
    )) as (typeof rescheduleRequest.$inferSelect)[]
    const [lesRow] = (await forTenant(ctx).select(
      lesson,
      eq(lesson.id, les),
    )) as (typeof lesson.$inferSelect)[]

    // 终态确定且唯一：既不是仍 pending，也不是"移动了却记为 rejected"的矛盾态。
    expect(['approved', 'rejected']).toContain(reqRow.status)

    if (reqRow.status === 'approved') {
      // approve 胜出：课节已移动到申请时间；reject 应已因非 pending 抛"申请已处理"。
      expect(lesRow.startAt.getTime()).toBe(reqStart.getTime())
      expect(ap.status).toBe('fulfilled')
      if (ap.status === 'fulfilled') expect(ap.value.ok).toBe(true)
      expect(rj.status).toBe('rejected')
    } else {
      // reject 胜出：课节未移动，仍在原时间；approve 应已被原子认领挡下（抛"申请已处理"，未移动）。
      expect(lesRow.startAt.getTime()).toBe(origStart.getTime())
      expect(rj.status).toBe('fulfilled')
    }
  })

  it('顺序：申请已处理后再次 reject 抛"申请已处理"', async () => {
    await approveRescheduleRequestCore(ctx, reqId)
    await expect(rejectRescheduleRequestCore(ctx, reqId)).rejects.toThrow('申请已处理')
  })
})

// H7: claim + move are now ONE transaction — if the move fails, the claim rolls back so the request is
// never stuck 'approved' with its lesson unmoved (the previous compensating-releaseClaim path could be
// skipped by a crash between the two independent commits). The "crash between claim and move" window is
// structurally closed by the transaction (nothing commits until both succeed); here we prove the
// move-fails-→-claim-rolls-back branch deterministically via a soft conflict.
describe('改期审批事务原子性 (H7)', () => {
  it('软冲突（目标时段该教师已有另一节课）→ 事务回滚，申请仍 pending 且原课未移动', async () => {
    // 在申请的目标时段插入同一教师的另一节课，使 approve 内的 rescheduleLessonCore 命中软冲突。
    await db.insert(lesson).values({
      id: 'l_ra_conflict',
      tenantId: org,
      sectionId: sec,
      teacherId: teacher,
      startAt: reqStart,
      endAt: reqEnd,
      status: 'scheduled',
    })

    const res = await approveRescheduleRequestCore(ctx, reqId)
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error).toBe('CONFLICT')
      // 冲突课节应作为 conflicts 回传，供复核者改选时间。
      expect(res.conflicts.some((c) => c.id === 'l_ra_conflict')).toBe(true)
    }

    // 认领已随事务回滚：申请仍 pending（可再复核），绝不卡在 approved。
    const [reqRow] = (await forTenant(ctx).select(
      rescheduleRequest,
      eq(rescheduleRequest.id, reqId),
    )) as (typeof rescheduleRequest.$inferSelect)[]
    expect(reqRow.status).toBe('pending')
    expect(reqRow.reviewedById).toBeNull()

    // 原课节未移动，仍在原时间。
    const [lesRow] = (await forTenant(ctx).select(
      lesson,
      eq(lesson.id, les),
    )) as (typeof lesson.$inferSelect)[]
    expect(lesRow.startAt.getTime()).toBe(origStart.getTime())
  })
})
