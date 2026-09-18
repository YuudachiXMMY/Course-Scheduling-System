import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { DateTime } from 'luxon'
import { db } from '@/db'
import { organization, member, user, course, classSection, lesson } from '@/db/schema'
import { forTenant } from '@/db/tenant'
import { materializeSection } from '@/lib/materialize'
import type { AuthContext } from '@/auth/context'

// 评审 Slice I —— 循环展开/物化正确性。
// B46: RRULE 的 UNTIL 内嵌绝对 UTC 瞬时，却被浮动引擎展开，静默丢弃学期末最后一次合法课次。
// B47: 改模式后重物化，会对已有例外（改期）课的那一周产生重复课节。
const org = 'org_mat_review'
const uid = 'u_mat_review'
const ZONE = 'Asia/Shanghai'
const ctx: AuthContext = { tenantId: org, userId: uid, role: 'owner', isPlatformAdmin: false }
const isoWeek = (d: Date) => DateTime.fromJSDate(d).setZone(ZONE).toFormat("kkkk'W'WW")
const dayStr = (d: Date) => DateTime.fromJSDate(d).setZone(ZONE).toFormat('yyyy-MM-dd')

const cleanup = async () => {
  await db.delete(lesson).where(eq(lesson.tenantId, org))
  await db.delete(classSection).where(eq(classSection.tenantId, org))
  await db.delete(course).where(eq(course.tenantId, org))
  await db.delete(member).where(inArray(member.organizationId, [org]))
  await db.delete(organization).where(inArray(organization.id, [org]))
  await db.delete(user).where(inArray(user.id, [uid]))
}

beforeEach(async () => {
  await cleanup()
  const now = new Date()
  await db.insert(organization).values({ id: org, name: 'MR', slug: 'mr-review', createdAt: now })
  await db.insert(user).values({ id: uid, name: 'MR', email: 'mr@m.com', emailVerified: true })
  await db.insert(member).values({ id: 'm_mr', organizationId: org, userId: uid, role: 'owner', createdAt: now })
})
afterAll(cleanup)

describe('B46 — RRULE UNTIL 绝对 UTC 不再裁掉学期末最后一课', () => {
  it('Asia/Shanghai 周一 19:00，学期末当天的课次被物化（不被 UNTIL=...Z 裁掉）', async () => {
    const dtstart = DateTime.fromObject({ year: 2025, month: 6, day: 2, hour: 19, minute: 0 }, { zone: ZONE })
      .toUTC()
      .toJSDate()
    const [s] = (await forTenant(ctx).insert(classSection, {
      courseId: (await forTenant(ctx).insert(course, { title: '晚课' }))[0].id,
      teacherId: uid,
      capacity: 1,
      // 内嵌绝对 UTC UNTIL：2025-06-30 23:59:59 Asia/Shanghai → 15:59:59Z，早于当晚 19:00 浮动候选。
      rrule: 'FREQ=WEEKLY;BYDAY=MO;UNTIL=20250630T155959Z',
      recurrenceDtstart: dtstart,
      recurrenceTimezone: ZONE,
      defaultDurationMinutes: 60,
      termStartDate: new Date('2025-06-02T00:00:00Z'),
      termEndDate: new Date('2025-06-30T00:00:00Z'),
    })) as { id: string }[]
    const res = await materializeSection(ctx, s.id)
    // 周一：06-02, 06-09, 06-16, 06-23, 06-30 → 5（06-30 曾被 UNTIL 裁掉成 4）。
    expect(res.inserted).toBe(5)
    const rows = (await forTenant(ctx).select(lesson, eq(lesson.sectionId, s.id))) as (typeof lesson.$inferSelect)[]
    expect(rows.map((r) => dayStr(r.startAt)).sort()).toContain('2025-06-30')
  })
})

describe('B47 — 改模式重物化不对已有例外课的那一周产生重复课节', () => {
  it('某周已有改期例外课时，新模式该周的课次不被重复插入', async () => {
    const monStart = DateTime.fromObject({ year: 2026, month: 3, day: 2, hour: 16, minute: 0 }, { zone: ZONE })
      .toUTC()
      .toJSDate()
    const [s] = (await forTenant(ctx).insert(classSection, {
      courseId: (await forTenant(ctx).insert(course, { title: '主课' }))[0].id,
      teacherId: uid,
      capacity: 1,
      rrule: 'FREQ=WEEKLY;BYDAY=MO',
      recurrenceDtstart: monStart,
      recurrenceTimezone: ZONE,
      defaultDurationMinutes: 60,
      termStartDate: new Date('2026-03-02T00:00:00Z'),
      termEndDate: new Date('2026-03-16T00:00:00Z'),
    })) as { id: string }[]
    // 初次物化：周一 03-02 / 03-09 / 03-16。
    expect((await materializeSection(ctx, s.id)).inserted).toBe(3)

    // 把 03-09 的课改期到 03-11（周三），保留 originalStartAt，标记 isException。
    const all = (await forTenant(ctx).select(lesson, eq(lesson.sectionId, s.id))) as (typeof lesson.$inferSelect)[]
    const target = all.find((l) => dayStr(l.startAt) === '2026-03-09')!
    const wk = isoWeek(target.startAt) // 03-09 所在 ISO 周
    await forTenant(ctx).update(lesson, target.id, {
      startAt: new Date('2026-03-11T08:00:00Z'), // 周三 16:00 Shanghai
      endAt: new Date('2026-03-11T09:00:00Z'),
      isException: true,
    })

    // 改模式为周二，重物化。新周二课次：03-03（周 W10）/ 03-10（与 03-09 同 ISO 周 W11）。
    await forTenant(ctx).update(classSection, s.id, {
      rrule: 'FREQ=WEEKLY;BYDAY=TU',
      recurrenceDtstart: DateTime.fromObject({ year: 2026, month: 3, day: 3, hour: 16, minute: 0 }, { zone: ZONE })
        .toUTC()
        .toJSDate(),
    })
    await materializeSection(ctx, s.id)

    // 例外课所在 ISO 周应仍只有 1 节课（例外本身），而非例外 + 新周二课的重复。
    const final = (await forTenant(ctx).select(lesson, eq(lesson.sectionId, s.id))) as (typeof lesson.$inferSelect)[]
    const inExceptionWeek = final.filter((l) => isoWeek(l.startAt) === wk)
    expect(inExceptionWeek.length).toBe(1)
    expect(inExceptionWeek[0].isException).toBe(true)
  })
})
