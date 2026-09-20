import 'server-only'
import { and, eq, gte, inArray, lt, ne } from 'drizzle-orm'
import { DateTime } from 'luxon'
import { db } from '@/db'
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
  const rows = await forTenant(ctx).select(
    lesson,
    and(
      gte(lesson.startAt, from),
      lt(lesson.startAt, to),
      ne(lesson.status, 'canceled'),
      scope === 'all' ? undefined : inArray(lesson.sectionId, scope),
    ),
  )
  if (rows.length === 0) return []

  // Batch-load the course title + active-enrolled student names per section (dedup ids, no N+1).
  const sectionIds = [...new Set(rows.map((r) => r.sectionId))]
  const sections = await forTenant(ctx).select(classSection, inArray(classSection.id, sectionIds))
  const courseIdBySection = new Map(sections.map((s) => [s.id, s.courseId]))

  const courseIds = [...new Set(sections.map((s) => s.courseId))]
  const courses = courseIds.length
    ? await forTenant(ctx).select(course, inArray(course.id, courseIds))
    : []
  const titleByCourse = new Map(courses.map((c) => [c.id, c.title]))

  const enrolls = await forTenant(ctx).select(
    enrollment,
    and(inArray(enrollment.sectionId, sectionIds), eq(enrollment.status, 'active')),
  )
  const studentIds = [...new Set(enrolls.map((e) => e.studentId))]
  const students = studentIds.length
    ? await forTenant(ctx).select(student, inArray(student.id, studentIds))
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

// CR4: build the FULLY-ENRICHED CalendarEvent for a single lesson row (course title + active-enrolled
// student names + location/meetingUrl), so the create/reschedule cores return the same shape as
// listLessonsInRange. Without this the client's optimistic update (calendar.tsx setEvents) would drop
// courseTitle/studentNames/location after a create or reschedule until a full page reload. Server-only
// (stays out of the client bundle). One extra section+course lookup and one enrollment+student lookup
// on the create/reschedule path only (single section, not a hot loop). Tenant-scoped via forTenant.
export async function hydrateLessonEvent(
  ctx: AuthContext,
  row: typeof lesson.$inferSelect,
  // H7: optional transaction executor. When called from rescheduleLessonCore inside the approve
  // transaction, this MUST reuse that `tx` connection — otherwise these 4 reads borrow extra pool
  // connections while the txn holds one, risking pool-exhaustion deadlock under concurrent approvals.
  // Defaults to the module db for every other caller (byte-identical).
  exec: Pick<typeof db, 'select' | 'insert' | 'update' | 'delete'> = db,
): Promise<CalendarEvent> {
  const section = await forTenant(ctx, exec).findById(classSection, row.sectionId)
  const parentCourse = section
    ? await forTenant(ctx, exec).findById(course, section.courseId)
    : null
  const courseTitle = parentCourse?.title ?? null

  const enrolls = await forTenant(ctx, exec).select(
    enrollment,
    and(eq(enrollment.sectionId, row.sectionId), eq(enrollment.status, 'active')),
  )
  const studentIds = [...new Set(enrolls.map((e) => e.studentId))]
  const students = studentIds.length
    ? await forTenant(ctx, exec).select(student, inArray(student.id, studentIds))
    : []
  const nameByStudent = new Map(students.map((s) => [s.id, s.name]))
  const studentNames = enrolls.map((e) => nameByStudent.get(e.studentId) ?? e.studentId)

  return {
    id: row.id,
    title: row.title ?? courseTitle ?? '课节',
    start: row.startAt.toISOString(),
    end: row.endAt.toISOString(),
    sectionId: row.sectionId,
    status: row.status,
    courseTitle,
    studentNames,
    location: row.location,
    meetingUrl: row.meetingUrl,
  }
}
