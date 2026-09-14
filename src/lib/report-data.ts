import 'server-only'
import { and, eq, gte, inArray, lte } from 'drizzle-orm'
import { forTenant } from '@/db/tenant'
import { attendance, enrollment, grade, lesson, note, student } from '@/db/schema'
import type { AuthContext } from '@/auth/context'
import {
  averageScore,
  parseScore,
  summarizeAttendance,
  type AttendanceStatus,
  type GradeItem,
  type ReportData,
} from '@/lib/report-stats'

// Re-export the pure types/aggregators so callers can keep importing from '@/lib/report-data'.
export * from '@/lib/report-stats'

const isoDay = (d: Date) => d.toISOString().slice(0, 10)

// DB read on the forTenant spine (M1). tenantId comes only from ctx, never from params.
export async function getReportData(
  ctx: AuthContext,
  studentId: string,
  window: { from: Date; to: Date },
): Promise<ReportData> {
  const s = (await forTenant(ctx).findById(student, studentId)) as typeof student.$inferSelect | null
  if (!s) throw new Error('学生不存在或不属于当前机构')

  const enrollments = (await forTenant(ctx).select(
    enrollment,
    and(eq(enrollment.studentId, studentId), eq(enrollment.status, 'active')),
  )) as (typeof enrollment.$inferSelect)[]
  const sectionIds = [...new Set(enrollments.map((e) => e.sectionId))]

  // Lessons for those sections within the window. Empty inArray([]) is invalid SQL → guard.
  const lessons =
    sectionIds.length === 0
      ? []
      : ((await forTenant(ctx).select(
          lesson,
          and(
            inArray(lesson.sectionId, sectionIds),
            gte(lesson.startAt, window.from),
            lte(lesson.startAt, window.to),
          ),
        )) as (typeof lesson.$inferSelect)[])
  const lessonIds = new Set(lessons.map((l) => l.id))
  const sectionIdSet = new Set(sectionIds)

  const attendanceRows =
    lessonIds.size === 0
      ? []
      : ((await forTenant(ctx).select(
          attendance,
          and(eq(attendance.studentId, studentId), inArray(attendance.lessonId, [...lessonIds])),
        )) as (typeof attendance.$inferSelect)[])

  // Grades for this student, scoped in-memory to the window's lessons/sections (avoids an OR query).
  const allGrades = (await forTenant(ctx).select(
    grade,
    eq(grade.studentId, studentId),
  )) as (typeof grade.$inferSelect)[]
  const relevantGrades = allGrades.filter(
    (g) =>
      (g.lessonId != null && lessonIds.has(g.lessonId)) ||
      (g.sectionId != null && sectionIdSet.has(g.sectionId)),
  )

  // Student-scoped notes for the AI to summarize (most-recent first, capped for prompt size).
  const noteRows = (await forTenant(ctx).select(
    note,
    eq(note.studentId, studentId),
  )) as (typeof note.$inferSelect)[]
  const notes = noteRows
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 20)
    .map((n) => n.body)

  const grades: GradeItem[] = relevantGrades.map((g) => ({
    title: g.title,
    score: parseScore(g.score),
    maxScore: parseScore(g.maxScore),
    comment: g.comment,
  }))

  return {
    studentName: s.name,
    schoolGrade: s.schoolGrade,
    periodStart: isoDay(window.from),
    periodEnd: isoDay(window.to),
    attendance: summarizeAttendance(attendanceRows.map((a) => a.status as AttendanceStatus)),
    grades,
    gradeAverage: averageScore(grades.map((g) => g.score)),
    notes,
  }
}
