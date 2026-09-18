import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import {
  organization,
  member,
  user,
  course,
  classSection,
  student,
  enrollment,
  lesson,
} from '@/db/schema'
import { forTenant } from '@/db/tenant'
import { hydrateLessonEvent } from '@/app/dashboard/schedule/data'
import type { AuthContext } from '@/auth/context'

// CR4: the create/reschedule cores used to return a bare event (id/title/start/end/sectionId/status),
// so the calendar's optimistic update dropped courseTitle/studentNames/location/meetingUrl until a full
// reload. hydrateLessonEvent now enriches a single lesson row the same way listLessonsInRange does. This
// test locks that the enriched event carries the course title + active student names + location.

const org = 'org_hydrate_evt'
const userId = 'user_hydrate_evt'
const ctx: AuthContext = { tenantId: org, userId, role: 'owner', isPlatformAdmin: false }

const cleanup = async () => {
  await db.delete(lesson).where(eq(lesson.tenantId, org))
  await db.delete(enrollment).where(eq(enrollment.tenantId, org))
  await db.delete(student).where(eq(student.tenantId, org))
  await db.delete(classSection).where(eq(classSection.tenantId, org))
  await db.delete(course).where(eq(course.tenantId, org))
  await db.delete(member).where(eq(member.organizationId, org))
  await db.delete(organization).where(eq(organization.id, org))
  await db.delete(user).where(eq(user.id, userId))
}

describe('hydrateLessonEvent enrichment (CR4)', () => {
  let lessonRow: typeof lesson.$inferSelect

  beforeAll(async () => {
    await cleanup()
    const now = new Date()
    await db.insert(organization).values({ id: org, name: 'H', slug: 'hydrate', createdAt: now })
    await db
      .insert(user)
      .values({ id: userId, name: 'T', email: 'hydrate@t.com', emailVerified: true })
    await db
      .insert(member)
      .values({ id: 'm_h', organizationId: org, userId, role: 'owner', createdAt: now })
    const [c] = await forTenant(ctx).insert(course, { title: '钢琴一级' })
    const [s] = await forTenant(ctx).insert(classSection, {
      courseId: c.id,
      teacherId: userId,
      capacity: 5,
    })
    const [stu1] = await forTenant(ctx).insert(student, { name: '小明' })
    const [stu2] = await forTenant(ctx).insert(student, { name: '小红' })
    await forTenant(ctx).insert(enrollment, {
      studentId: stu1.id,
      sectionId: s.id,
      status: 'active',
    })
    await forTenant(ctx).insert(enrollment, {
      studentId: stu2.id,
      sectionId: s.id,
      status: 'active',
    })
    const start = new Date(Date.UTC(2026, 5, 1, 20, 0))
    const [l] = await forTenant(ctx).insert(lesson, {
      sectionId: s.id,
      teacherId: userId,
      startAt: start,
      endAt: new Date(start.getTime() + 3_600_000),
      status: 'scheduled',
      originalStartAt: start,
      location: '3号琴房',
    })
    lessonRow = l
  })
  afterAll(cleanup)

  it('carries course title, active student names, and location', async () => {
    const evt = await hydrateLessonEvent(ctx, lessonRow)
    expect(evt.courseTitle).toBe('钢琴一级')
    expect(evt.title).toBe('钢琴一级') // no explicit lesson title → falls back to course title
    expect((evt.studentNames ?? []).sort()).toEqual(['小明', '小红'])
    expect(evt.location).toBe('3号琴房')
    expect(evt.sectionId).toBe(lessonRow.sectionId)
  })
})
