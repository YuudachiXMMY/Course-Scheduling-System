import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { course, classSection, lesson, user, member } from '@/db/schema'
import { forTenant } from '@/db/tenant'
import { requireAuthContext, type AuthContext } from '@/auth/context'
import { seedOrg, unseedOrg } from './helpers/seed-org'

// 排课 → 添加课节: the post-initialization scheduling path. addSessionsCore expands a chosen recurrence
// (daily / weekly / biweekly / monthly) over a date period; addSessionsAction adds the auth + ownership
// guard. The recurrence math reuses expandRecurrence, exercised in a real zone (America/Toronto default).

vi.mock('@/auth/context', async (importActual) => ({
  ...(await importActual<typeof import('@/auth/context')>()),
  requireAuthContext: vi.fn(),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { addSessionsCore } from '@/lib/add-sessions'
import { addSessionsAction, cancelLessonsAction } from '@/app/dashboard/schedule/actions'

const asActor = (ctx: AuthContext) => vi.mocked(requireAuthContext).mockResolvedValue(ctx)

const org = 'org_add_sessions'
const teacherA = 'u_add_teacher_a'
const teacherB = 'u_add_teacher_b'
const ctxFor = (userId: string, role = 'teacher'): AuthContext => ({
  tenantId: org,
  userId,
  role,
  isPlatformAdmin: false,
})
const teacherACtx = ctxFor(teacherA)
const teacherBCtx = ctxFor(teacherB)

let sectionA: string // taught by teacherA

const cleanup = async () => {
  await db.delete(lesson).where(eq(lesson.tenantId, org))
  await db.delete(classSection).where(eq(classSection.tenantId, org))
  await db.delete(course).where(eq(course.tenantId, org))
  await db.delete(member).where(eq(member.organizationId, org))
  await db.delete(user).where(eq(user.id, teacherA))
  await db.delete(user).where(eq(user.id, teacherB))
  await unseedOrg(org)
}

describe('addSessions (排课 → 添加课节)', () => {
  beforeAll(async () => {
    await cleanup()
    await seedOrg(org)
    const now = new Date()
    await db.insert(user).values([
      { id: teacherA, name: 'A', email: 'add-a@t.com', emailVerified: true },
      { id: teacherB, name: 'B', email: 'add-b@t.com', emailVerified: true },
    ])
    await db.insert(member).values([
      { id: 'm_add_a', organizationId: org, userId: teacherA, role: 'teacher', createdAt: now },
      { id: 'm_add_b', organizationId: org, userId: teacherB, role: 'teacher', createdAt: now },
    ])
    const [c] = (await forTenant(teacherACtx).insert(course, { title: '数学' })) as { id: string }[]
    const [s] = (await forTenant(teacherACtx).insert(classSection, {
      courseId: c.id,
      teacherId: teacherA,
      capacity: 1,
      recurrenceTimezone: 'America/Toronto',
      defaultDurationMinutes: 60,
      defaultLocation: '101 教室',
    })) as { id: string }[]
    sectionA = s.id
  })
  afterAll(cleanup)

  // Fresh lessons before each math test so counts are independent.
  beforeEach(async () => {
    await db.delete(lesson).where(eq(lesson.sectionId, sectionA))
  })

  it('DAILY inserts one lesson per day across the inclusive range', async () => {
    const res = await addSessionsCore(teacherACtx, sectionA, {
      freq: 'DAILY',
      startDate: '2026-03-02', // Mon
      endDate: '2026-03-06', // Fri
      startTime: '10:00',
      durationMinutes: 60,
    })
    expect(res).toEqual({ inserted: 5, conflicts: 0 })
  })

  it('WEEKLY with multiple weekdays inserts each matching day in the window', async () => {
    const res = await addSessionsCore(teacherACtx, sectionA, {
      freq: 'WEEKLY',
      byDays: ['MO', 'WE'],
      startDate: '2026-03-02', // Mon
      endDate: '2026-03-15', // Sun (Mon 2/9, Wed 4/11 → 4)
      startTime: '16:00',
      durationMinutes: 60,
    })
    expect(res.inserted).toBe(4)
  })

  it('BIWEEKLY repeats every other week from the start date', async () => {
    const res = await addSessionsCore(teacherACtx, sectionA, {
      freq: 'BIWEEKLY',
      byDays: ['MO'],
      startDate: '2026-03-02', // Mon 3/2, 3/16, 3/30 → 3
      endDate: '2026-04-01',
      startTime: '16:00',
      durationMinutes: 60,
    })
    expect(res.inserted).toBe(3)
  })

  it('MONTHLY repeats on the start date day-of-month', async () => {
    const res = await addSessionsCore(teacherACtx, sectionA, {
      freq: 'MONTHLY',
      startDate: '2026-01-15', // 15th of Jan..Apr → 4
      endDate: '2026-04-15',
      startTime: '09:00',
      durationMinutes: 90,
    })
    expect(res.inserted).toBe(4)
  })

  it('carries the section defaults onto the created lessons', async () => {
    await addSessionsCore(teacherACtx, sectionA, {
      freq: 'DAILY',
      startDate: '2026-03-02',
      endDate: '2026-03-03',
      startTime: '10:00',
      durationMinutes: 45,
    })
    const rows = (await forTenant(teacherACtx).select(
      lesson,
      eq(lesson.sectionId, sectionA),
    )) as (typeof lesson.$inferSelect)[]
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.teacherId === teacherA)).toBe(true)
    expect(rows.every((r) => r.location === '101 教室')).toBe(true)
    expect(rows.every((r) => r.isException === true)).toBe(true)
    // 45-minute duration honored.
    expect(rows[0].endAt.getTime() - rows[0].startAt.getTime()).toBe(45 * 60 * 1000)
  })

  it('counts a GiST time-overlap as a conflict (per-row fallback path)', async () => {
    // Seed 10:00–11:00.
    const first = await addSessionsCore(teacherACtx, sectionA, {
      freq: 'DAILY',
      startDate: '2026-03-02',
      endDate: '2026-03-02',
      startTime: '10:00',
      durationMinutes: 60,
    })
    expect(first).toEqual({ inserted: 1, conflicts: 0 })
    // Add an OVERLAPPING slot 10:30–11:30 on the same day: a DIFFERENT original_start_at (so
    // onConflictDoNothing can't suppress it) whose time range overlaps the existing lesson → the GiST
    // exclusion (23P01) fires, exercising the catch → per-row fallback that increments `conflicts`.
    const overlap = await addSessionsCore(teacherACtx, sectionA, {
      freq: 'DAILY',
      startDate: '2026-03-02',
      endDate: '2026-03-02',
      startTime: '10:30',
      durationMinutes: 60,
    })
    expect(overlap).toEqual({ inserted: 0, conflicts: 1 })
  })

  it('is idempotent: re-adding the same slots inserts nothing', async () => {
    const input = {
      freq: 'DAILY' as const,
      startDate: '2026-03-02',
      endDate: '2026-03-04',
      startTime: '10:00',
      durationMinutes: 60,
    }
    const first = await addSessionsCore(teacherACtx, sectionA, input)
    expect(first.inserted).toBe(3)
    const second = await addSessionsCore(teacherACtx, sectionA, input)
    expect(second.inserted).toBe(0)
  })

  describe('addSessionsAction (auth + ownership)', () => {
    beforeEach(async () => {
      await db.delete(lesson).where(eq(lesson.sectionId, sectionA))
    })

    it('lets the owning teacher add sessions', async () => {
      asActor(teacherACtx)
      const res = await addSessionsAction({
        sectionId: sectionA,
        freq: 'DAILY',
        startDate: '2026-03-02',
        endDate: '2026-03-04',
        startTime: '10:00',
        durationMinutes: 60,
      })
      expect(res).toEqual({ ok: true, inserted: 3, conflicts: 0 })
    })

    it('refuses another teacher’s section', async () => {
      asActor(teacherBCtx)
      const res = await addSessionsAction({
        sectionId: sectionA,
        freq: 'DAILY',
        startDate: '2026-03-02',
        endDate: '2026-03-04',
        startTime: '10:00',
        durationMinutes: 60,
      })
      expect(res).toEqual({ ok: false, error: '无权在该班级排课' })
      const rows = await forTenant(teacherACtx).select(lesson, eq(lesson.sectionId, sectionA))
      expect(rows).toHaveLength(0)
    })

    it('rejects weekly/biweekly with no weekday selected', async () => {
      asActor(teacherACtx)
      const res = await addSessionsAction({
        sectionId: sectionA,
        freq: 'WEEKLY',
        byDays: [],
        startDate: '2026-03-02',
        endDate: '2026-03-15',
        startTime: '16:00',
        durationMinutes: 60,
      })
      expect(res).toEqual({ ok: false, error: '请至少选择一个星期几' })
    })

    it('rejects an inverted date range', async () => {
      asActor(teacherACtx)
      const res = await addSessionsAction({
        sectionId: sectionA,
        freq: 'DAILY',
        startDate: '2026-03-10',
        endDate: '2026-03-02',
        startTime: '10:00',
        durationMinutes: 60,
      })
      expect(res).toEqual({ ok: false, error: '结束日期不能早于开始日期' })
    })
  })

  describe('cancelLessonsAction (排课 → 多选删除, soft-delete)', () => {
    let ids: string[]
    beforeEach(async () => {
      await db.delete(lesson).where(eq(lesson.sectionId, sectionA))
      await addSessionsCore(teacherACtx, sectionA, {
        freq: 'DAILY',
        startDate: '2026-03-02',
        endDate: '2026-03-04', // 3 lessons
        startTime: '10:00',
        durationMinutes: 60,
      })
      const rows = (await forTenant(teacherACtx).select(
        lesson,
        eq(lesson.sectionId, sectionA),
      )) as (typeof lesson.$inferSelect)[]
      ids = rows.map((r) => r.id)
    })

    it('tombstones the selected lessons for the owning teacher', async () => {
      asActor(teacherACtx)
      const res = await cancelLessonsAction([ids[0], ids[1]])
      expect(res).toEqual({ ok: true, canceled: 2 })
      const canceled = (await forTenant(teacherACtx).select(
        lesson,
        eq(lesson.sectionId, sectionA),
      )) as (typeof lesson.$inferSelect)[]
      // Rows are kept (tombstone), not deleted; two are now canceled.
      expect(canceled).toHaveLength(3)
      expect(canceled.filter((r) => r.status === 'canceled')).toHaveLength(2)
    })

    it('skips lessons owned by another teacher (no partial-leak error)', async () => {
      asActor(teacherBCtx)
      const res = await cancelLessonsAction(ids)
      expect(res).toEqual({ ok: true, canceled: 0 })
      const stillScheduled = (await forTenant(teacherACtx).select(
        lesson,
        eq(lesson.sectionId, sectionA),
      )) as (typeof lesson.$inferSelect)[]
      expect(stillScheduled.every((r) => r.status === 'scheduled')).toBe(true)
    })

    it('rejects an empty selection', async () => {
      asActor(teacherACtx)
      const res = await cancelLessonsAction([])
      expect(res).toEqual({ ok: false, error: '请至少选择一节课' })
    })

    // BLOCKER 1 regression: authorize on the lesson's CURRENT section membership, NEVER the frozen
    // lesson.teacherId. The lessons here were materialized while teacherA was primary, so their teacherId is
    // frozen to teacherA. Simulate removeSectionTeacher repointing the section's primary to teacherB: teacherA
    // is no longer a member, yet the stale lesson.teacherId still equals teacherA. The old code (eq(lesson
    // .teacherId, ctx.userId)) let the removed teacherA mass-cancel the class; the fix (scope by
    // sectionIdsForActor) must reject teacherA and still allow teacherB, the new current owner.
    it('does NOT let a teacher REMOVED from the section bulk-cancel its lessons (stale lesson.teacherId is not authority)', async () => {
      // Repoint the section's PRIMARY away from teacherA (as removeSectionTeacher would); restore in finally.
      await db
        .update(classSection)
        .set({ teacherId: teacherB })
        .where(and(eq(classSection.tenantId, org), eq(classSection.id, sectionA)))
      try {
        asActor(teacherACtx) // frozen on every lesson, but owns NO section now
        const removed = await cancelLessonsAction(ids)
        expect(removed).toEqual({ ok: true, canceled: 0 }) // nothing matched → nothing tombstoned
        const afterRemoved = (await forTenant(teacherBCtx).select(
          lesson,
          eq(lesson.sectionId, sectionA),
        )) as (typeof lesson.$inferSelect)[]
        expect(afterRemoved.every((r) => r.status === 'scheduled')).toBe(true)

        asActor(teacherBCtx) // the NEW current owner CAN cancel them
        const byOwner = await cancelLessonsAction(ids)
        expect(byOwner).toEqual({ ok: true, canceled: 3 })
      } finally {
        await db
          .update(classSection)
          .set({ teacherId: teacherA })
          .where(and(eq(classSection.tenantId, org), eq(classSection.id, sectionA)))
      }
    })
  })
})
