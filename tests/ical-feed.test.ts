import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { and, eq, isNull } from 'drizzle-orm'
import { buildIcs, feedWindow, getFeedLessons, type FeedLesson } from '@/lib/ical-feed'

// 评审 Slice D（B6/B45）DB-backed 断言用到的 mock：requireAuthContext（模拟不同调用者）+ next/cache
// （Server Action 里的 revalidatePath 在 vitest 无 Next runtime，需打桩）。放在 import 动作前，vi.mock 会被提升。
vi.mock('@/auth/context', async (importActual) => ({
  ...(await importActual<typeof import('@/auth/context')>()),
  requireAuthContext: vi.fn(),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { db } from '@/db'
import { course, classSection, lesson, calendarFeed } from '@/db/schema'
import { requireAuthContext, type AuthContext } from '@/auth/context'
import { getOrCreateFeed, rotateFeed, revokeFeed } from '@/app/dashboard/calendar/actions'
import { seedOrg, unseedOrg } from './helpers/seed-org'

// Two lessons at known UTC instants. Jan 5 is EST (America/Toronto, UTC-5), so 08:00Z == 03:00 local.
const lessons: FeedLesson[] = [
  {
    id: 'lesson-a',
    title: '数学',
    startAt: new Date('2026-01-05T08:00:00Z'),
    endAt: new Date('2026-01-05T09:00:00Z'),
    location: '房间1',
  },
  {
    id: 'lesson-b',
    title: null, // → default summary '课节'
    startAt: new Date('2026-01-06T10:00:00Z'),
    endAt: new Date('2026-01-06T11:00:00Z'),
    location: null,
  },
]

const uidLines = (ics: string) =>
  ics
    .split(/\r?\n/)
    .filter((l) => l.startsWith('UID:'))
    .sort()

describe('buildIcs', () => {
  it('emits a VCALENDAR with a real VTIMEZONE and one VEVENT per lesson', () => {
    const ics = buildIcs(lessons, { host: 'example.com' })
    expect(ics).toContain('BEGIN:VCALENDAR')
    expect(ics).toContain('END:VCALENDAR')
    expect(ics).toContain('BEGIN:VTIMEZONE')
    expect(ics).toContain('TZID:America/Toronto')
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2)
    expect(ics).toContain('UID:lesson-a@example.com')
    expect(ics).toContain('UID:lesson-b@example.com')
  })

  it('renders the correct America/Toronto wall-clock time (08:00Z → 03:00 local, EST)', () => {
    const ics = buildIcs(lessons, { host: 'example.com' })
    // ical-generator formats a TZID event as DTSTART;TZID=America/Toronto:YYYYMMDDTHHMMSS
    expect(ics).toMatch(/DTSTART;TZID=America\/Toronto:20260105T030000/)
  })

  it('falls back to the default summary when title is null', () => {
    const ics = buildIcs(lessons, { host: 'example.com' })
    expect(ics).toContain('SUMMARY:数学')
    expect(ics).toContain('SUMMARY:课节')
  })

  it('produces stable, PK-derived UIDs (no duplicates on refresh)', () => {
    const first = buildIcs(lessons, { host: 'example.com' })
    const second = buildIcs(lessons, { host: 'example.com' })
    expect(uidLines(first)).toEqual(uidLines(second))
    expect(uidLines(first)).toEqual(['UID:lesson-a@example.com', 'UID:lesson-b@example.com'])
  })

  it('anchors the UID host to the provided option', () => {
    const ics = buildIcs(lessons, { host: 'schedule.example.org' })
    expect(ics).toContain('UID:lesson-a@schedule.example.org')
    expect(ics).not.toContain('@example.com')
  })

  it('emits a valid, event-free VCALENDAR for an empty feed', () => {
    const ics = buildIcs([], { host: 'example.com' })
    expect(ics).toContain('BEGIN:VCALENDAR')
    expect(ics).toContain('END:VCALENDAR')
    expect(ics).not.toContain('BEGIN:VEVENT')
  })
})

describe('feedWindow', () => {
  it('returns from < to spanning ~34 weeks (8 back + 26 forward) on America/Toronto day edges', () => {
    const now = new Date('2026-06-15T12:00:00Z')
    const { from, to } = feedWindow(now)
    expect(from.getTime()).toBeLessThan(to.getTime())
    expect(from.getTime()).toBeLessThan(now.getTime())
    expect(to.getTime()).toBeGreaterThan(now.getTime())
    const weeks = (to.getTime() - from.getTime()) / (7 * 24 * 60 * 60 * 1000)
    expect(weeks).toBeGreaterThan(33.5)
    expect(weeks).toBeLessThan(34.5)
  })
})

// ── 评审 Slice D（B6/B45）— 订阅源按 feed 归属维度收敛 ─────────────────────────────────────────────────
// 独立 org id（fileParallelism=false，串行执行，broad-predicate 清理不会误删其它文件）。
const org = 'org_ical_feed_scope'
const teacherA = 'u_ta_ical'
const teacherB = 'u_tb_ical'
const ownerId = 'u_owner_ical'
const sA = 's_a_ical' // teacherA 所教
const sB = 's_b_ical' // teacherB 所教
const lA = 'l_a_ical' // sA 的课次
const lB = 'l_b_ical' // sB 的课次

const asActor = (ctx: AuthContext) => vi.mocked(requireAuthContext).mockResolvedValue(ctx)
const ctxFor = (userId: string, role: string): AuthContext => ({
  tenantId: org,
  userId,
  role,
  isPlatformAdmin: false,
})
const teacherACtx = ctxFor(teacherA, 'teacher')
const teacherBCtx = ctxFor(teacherB, 'teacher')
const ownerCtx = ctxFor(ownerId, 'owner')

// 课次落在 feedWindow() 窗口内（now+7d），status=scheduled。
const soon = new Date(Date.now() + 7 * 24 * 3_600_000)
const soonEnd = new Date(soon.getTime() + 3_600_000)

const cleanupScope = async () => {
  await db.delete(calendarFeed).where(eq(calendarFeed.tenantId, org))
  await db.delete(lesson).where(eq(lesson.tenantId, org))
  await db.delete(classSection).where(eq(classSection.tenantId, org))
  await db.delete(course).where(eq(course.tenantId, org))
  await unseedOrg(org)
}

describe('评审 Slice D — 订阅源按 feed 归属维度收敛', () => {
  beforeAll(async () => {
    await cleanupScope()
    await seedOrg(org)
    await db.insert(course).values({ id: 'c_ical', tenantId: org, title: 'iCal 课程' })
    await db.insert(classSection).values([
      { id: sA, tenantId: org, courseId: 'c_ical', name: 'A 班', teacherId: teacherA, capacity: 5 },
      { id: sB, tenantId: org, courseId: 'c_ical', name: 'B 班', teacherId: teacherB, capacity: 5 },
    ])
    await db.insert(lesson).values([
      {
        id: lA,
        tenantId: org,
        sectionId: sA,
        teacherId: teacherA,
        startAt: soon,
        endAt: soonEnd,
        status: 'scheduled',
        title: 'A 班课次',
      },
      {
        id: lB,
        tenantId: org,
        sectionId: sB,
        teacherId: teacherB,
        startAt: soon,
        endAt: soonEnd,
        status: 'scheduled',
        title: 'B 班课次',
      },
    ])
  })
  afterAll(cleanupScope)

  // ── getFeedLessons 按 teacherId 收敛 ──────────────────────────────────────────────────────────────
  it('getFeedLessons: section-scoped 教师 A 的 feed 只含 A 所教 section 的课次，不含 B 的', async () => {
    const ids = (await getFeedLessons(org, teacherA)).map((l) => l.id)
    expect(ids).toContain(lA)
    expect(ids).not.toContain(lB)
  })

  it('getFeedLessons: teacherId=null（owner/whole-tenant feed）仍含全租户课次', async () => {
    const ids = (await getFeedLessons(org, null)).map((l) => l.id)
    expect(ids).toEqual(expect.arrayContaining([lA, lB]))
  })

  it('getFeedLessons: 教师 B 的 feed 只含 B 的课次，不含 A 的', async () => {
    const ids = (await getFeedLessons(org, teacherB)).map((l) => l.id)
    expect(ids).toContain(lB)
    expect(ids).not.toContain(lA)
  })

  // ── getOrCreateFeed 按 owner 维度接线 teacherId ───────────────────────────────────────────────────
  it('getOrCreateFeed: owner→teacher_id=null，section-scoped 教师→teacher_id=自己，各自独立', async () => {
    asActor(ownerCtx)
    const ownerFeed = await getOrCreateFeed()
    asActor(teacherACtx)
    const aFeed = await getOrCreateFeed()
    asActor(teacherBCtx)
    const bFeed = await getOrCreateFeed()

    // 三条互不相同的 token
    expect(new Set([ownerFeed.token, aFeed.token, bFeed.token]).size).toBe(3)

    const rows = await db.select().from(calendarFeed).where(eq(calendarFeed.tenantId, org))
    const byTeacher = new Map(rows.map((r) => [r.teacherId, r]))
    expect(byTeacher.get(null)?.token).toBe(ownerFeed.token) // whole-tenant feed
    expect(byTeacher.get(teacherA)?.token).toBe(aFeed.token)
    expect(byTeacher.get(teacherB)?.token).toBe(bFeed.token)
  })

  it('getOrCreateFeed: 幂等——同一 owner 维度再次调用返回同一 token', async () => {
    asActor(teacherACtx)
    const first = await getOrCreateFeed()
    const second = await getOrCreateFeed()
    expect(second.token).toBe(first.token)
  })

  // ── rotate/revoke 定位到调用者自己的 feed 行 ──────────────────────────────────────────────────────
  it('rotateFeed: 教师 A 轮换只换掉自己的 token，不影响 owner / 教师 B 的 feed', async () => {
    const tokenOf = async (teacherId: string | null) => {
      const [row] = await db
        .select()
        .from(calendarFeed)
        .where(
          and(
            eq(calendarFeed.tenantId, org),
            teacherId === null
              ? isNull(calendarFeed.teacherId)
              : eq(calendarFeed.teacherId, teacherId),
          ),
        )
      return row?.token
    }
    const ownerBefore = await tokenOf(null)
    const bBefore = await tokenOf(teacherB)
    const aBefore = await tokenOf(teacherA)

    asActor(teacherACtx)
    const rotated = await rotateFeed()

    expect(rotated.token).not.toBe(aBefore) // A 自己的 token 变了
    expect(await tokenOf(teacherA)).toBe(rotated.token)
    expect(await tokenOf(null)).toBe(ownerBefore) // owner 不受影响
    expect(await tokenOf(teacherB)).toBe(bBefore) // 教师 B 不受影响
  })

  it('revokeFeed: 教师 A 吊销只 tombstone 自己的 feed，owner / 教师 B 的仍活跃', async () => {
    asActor(teacherACtx)
    await revokeFeed()

    const activeTeacherIds = (
      await db
        .select()
        .from(calendarFeed)
        .where(and(eq(calendarFeed.tenantId, org), isNull(calendarFeed.revokedAt)))
    ).map((r) => r.teacherId)

    expect(activeTeacherIds).not.toContain(teacherA) // A 已吊销
    expect(activeTeacherIds).toEqual(expect.arrayContaining([null, teacherB])) // owner + B 仍活跃
  })
})
