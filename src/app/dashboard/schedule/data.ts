import 'server-only'
import { and, eq, gte, inArray, lt, ne } from 'drizzle-orm'
import { DateTime } from 'luxon'
import { forTenant } from '@/db/tenant'
import { sectionIdsForActor } from '@/auth/scope'
import { lesson, classSection, course, enrollment, student } from '@/db/schema'
import { APP_TIME_ZONE } from '@/lib/timezone'
import type { AuthContext } from '@/auth/context'
import type { CalendarEvent } from './types'

// Server-only read. Defaults to the current month (America/Toronto) if no range is given.
export async function listLessonsInRange(
  ctx: AuthContext,
  range?: { from: Date; to: Date },
): Promise<CalendarEvent[]> {
  const now = DateTime.now().setZone(APP_TIME_ZONE)
  const from = range?.from ?? now.startOf('month').minus({ weeks: 1 }).toUTC().toJSDate()
  const to = range?.to ?? now.endOf('month').plus({ weeks: 1 }).toUTC().toJSDate()

  // 工作流 E: confine lessons to the actor's sections (teacher → only their own sections' lessons).
  // and() ignores an undefined operand, so 'all' adds no predicate; an empty section list short-circuits.
  const scope = await sectionIdsForActor(ctx)
  if (scope !== 'all' && scope.length === 0) return []
  const rows = (await forTenant(ctx).select(
    lesson,
    and(
      gte(lesson.startAt, from),
      lt(lesson.startAt, to),
      ne(lesson.status, 'canceled'),
      scope === 'all' ? undefined : inArray(lesson.sectionId, scope),
    ),
  )) as (typeof lesson.$inferSelect)[]
  if (rows.length === 0) return []

  // Batch-load the course title + active-enrolled student names per section (dedup ids, no N+1).
  const sectionIds = [...new Set(rows.map((r) => r.sectionId))]
  const sections = (await forTenant(ctx).select(
    classSection,
    inArray(classSection.id, sectionIds),
  )) as (typeof classSection.$inferSelect)[]
  const courseIdBySection = new Map(sections.map((s) => [s.id, s.courseId]))

  const courseIds = [...new Set(sections.map((s) => s.courseId))]
  const courses = courseIds.length
    ? ((await forTenant(ctx).select(
        course,
        inArray(course.id, courseIds),
      )) as (typeof course.$inferSelect)[])
    : []
  const titleByCourse = new Map(courses.map((c) => [c.id, c.title]))

  const enrolls = (await forTenant(ctx).select(
    enrollment,
    and(inArray(enrollment.sectionId, sectionIds), eq(enrollment.status, 'active')),
  )) as (typeof enrollment.$inferSelect)[]
  const studentIds = [...new Set(enrolls.map((e) => e.studentId))]
  const students = studentIds.length
    ? ((await forTenant(ctx).select(
        student,
        inArray(student.id, studentIds),
      )) as (typeof student.$inferSelect)[])
    : []
  const nameByStudent = new Map(students.map((s) => [s.id, s.name]))
  const namesBySection = new Map<string, string[]>()
  for (const e of enrolls) {
    const arr = namesBySection.get(e.sectionId) ?? []
    arr.push(nameByStudent.get(e.studentId) ?? e.studentId)
    namesBySection.set(e.sectionId, arr)
  }

  return rows.map((r) => {
    const courseId = courseIdBySection.get(r.sectionId)
    const courseTitle = courseId ? (titleByCourse.get(courseId) ?? null) : null
    return {
      id: r.id,
      title: r.title ?? courseTitle ?? '课节',
      start: r.startAt.toISOString(),
      end: r.endAt.toISOString(),
      sectionId: r.sectionId,
      status: r.status,
      courseTitle,
      studentNames: namesBySection.get(r.sectionId) ?? [],
      location: r.location,
      meetingUrl: r.meetingUrl,
    }
  })
}
