import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { course, classSection, lesson, sectionTeacher } from '@/db/schema'
import { getFeedLessons } from '@/lib/ical-feed'
import { seedOrg, unseedOrg } from './helpers/seed-org'

// A4: getFeedLessons(tenantId, teacherId) scopes a section-scoped teacher's ICS feed by the section_teacher
// MEMBERSHIP set (the PRIMARY classSection.teacherId UNION the section_teacher links) — not classSection.
// teacherId alone. These lock the multi-teacher feed contract (ical-feed.ts:92-108):
//   (1) the feed includes both the sections the teacher is PRIMARY of AND those they were ADDED to;
//   (2) it EXCLUDES a section they are neither primary of nor linked to, and canceled lessons;
//   (3) removing the teacher's section_teacher link drops that section's lessons from the feed;
//   (4) teacherId=null keeps the whole-tenant feed (unchanged pre-multi-teacher behavior).

const org = 'org_ical_feed_scope'
const teacherA = 'u_feed_a'
const teacherB = 'u_feed_b'
const s1 = 's_feed_1' // primary = teacherA
const s2 = 's_feed_2' // primary = teacherB, teacherA LINKED (co-teacher)
const s3 = 's_feed_3' // primary = teacherB, teacherA not involved
const soon = () => new Date(Date.now() + 86_400_000) // +1 day, inside feedWindow [now-8w, now+26w]
const soonEnd = () => new Date(Date.now() + 90_000_000)

const cleanup = async () => {
  await db.delete(lesson).where(eq(lesson.tenantId, org))
  await db.delete(sectionTeacher).where(eq(sectionTeacher.tenantId, org))
  await db.delete(classSection).where(eq(classSection.tenantId, org))
  await db.delete(course).where(eq(course.tenantId, org))
  await unseedOrg(org)
}

beforeAll(async () => {
  await cleanup()
  await seedOrg(org)
  await db.insert(course).values({ id: 'c_feed', tenantId: org, title: '订阅范围课程' })
  // classSection.teacherId / sectionTeacher.userId carry no FK (B8 app-level guard), so string ids suffice.
  await db.insert(classSection).values([
    { id: s1, tenantId: org, courseId: 'c_feed', name: 'A主班', teacherId: teacherA, capacity: 5 },
    { id: s2, tenantId: org, courseId: 'c_feed', name: 'B班A协同', teacherId: teacherB, capacity: 5 },
    { id: s3, tenantId: org, courseId: 'c_feed', name: 'B独占班', teacherId: teacherB, capacity: 5 },
  ])
  await db.insert(sectionTeacher).values({ tenantId: org, sectionId: s2, userId: teacherA })
  await db.insert(lesson).values([
    { id: 'l_feed_1', tenantId: org, sectionId: s1, teacherId: teacherA, startAt: soon(), endAt: soonEnd(), status: 'scheduled', title: 'A主课' },
    { id: 'l_feed_2', tenantId: org, sectionId: s2, teacherId: teacherB, startAt: soon(), endAt: soonEnd(), status: 'scheduled', title: 'B班课' },
    { id: 'l_feed_3', tenantId: org, sectionId: s3, teacherId: teacherB, startAt: soon(), endAt: soonEnd(), status: 'scheduled', title: 'B独占课' },
    { id: 'l_feed_cx', tenantId: org, sectionId: s1, teacherId: teacherA, startAt: soon(), endAt: soonEnd(), status: 'canceled', title: 'A已取消' },
  ])
})

afterAll(cleanup)

describe('getFeedLessons — 多教师 membership scoping (A4)', () => {
  it("includes the teacher's PRIMARY sections and the sections they are LINKED to; excludes others + canceled", async () => {
    const ids = (await getFeedLessons(org, teacherA)).map((l) => l.id).sort()
    // primary s1 (l_feed_1) + linked s2 (l_feed_2); NOT s3 (l_feed_3); the canceled l_feed_cx is dropped.
    expect(ids).toEqual(['l_feed_1', 'l_feed_2'])
  })

  it('drops a section from the feed once the teacher is removed from it', async () => {
    await db
      .delete(sectionTeacher)
      .where(and(eq(sectionTeacher.sectionId, s2), eq(sectionTeacher.userId, teacherA)))
    const ids = (await getFeedLessons(org, teacherA)).map((l) => l.id).sort()
    expect(ids).toEqual(['l_feed_1']) // s2 link gone; still PRIMARY of s1
  })

  it('teacherId=null returns the whole-tenant feed (all non-canceled lessons)', async () => {
    const ids = (await getFeedLessons(org, null)).map((l) => l.id).sort()
    expect(ids).toEqual(['l_feed_1', 'l_feed_2', 'l_feed_3'])
  })
})
