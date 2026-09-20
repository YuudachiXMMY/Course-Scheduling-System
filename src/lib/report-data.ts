import 'server-only'
import { and, eq, gte, inArray, isNull, lte, or } from 'drizzle-orm'
import { forTenant } from '@/db/tenant'
import { attendance, enrollment, grade, lesson, note, student } from '@/db/schema'
import type { AuthContext } from '@/auth/context'
import {
  averageScore,
  capNotesForPrompt,
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
  const s = await forTenant(ctx).findById(student, studentId)
  if (!s) throw new Error('学生不存在或不属于当前机构')

  // B51: include every section the student was enrolled in whose active span OVERLAPS the report window
  // [from, to] — not only the sections they are CURRENTLY active in. Otherwise a student who transferred
  // or completed mid-period (status 'dropped'/'completed', droppedAt set) silently loses that section's
  // lessons/attendance/grades from the report. Overlap = enrolled by `to` AND not dropped before `from`.
  const enrollments = await forTenant(ctx).select(
    enrollment,
    and(
      eq(enrollment.studentId, studentId),
      lte(enrollment.enrolledAt, window.to),
      or(isNull(enrollment.droppedAt), gte(enrollment.droppedAt, window.from)),
    ),
  )
  const sectionIds = [...new Set(enrollments.map((e) => e.sectionId))]

  // Lessons for those sections within the window. Empty inArray([]) is invalid SQL → guard.
  const lessons =
    sectionIds.length === 0
      ? []
      : await forTenant(ctx).select(
          lesson,
          and(
            inArray(lesson.sectionId, sectionIds),
            gte(lesson.startAt, window.from),
            lte(lesson.startAt, window.to),
          ),
        )
  const lessonIds = new Set(lessons.map((l) => l.id))
  const sectionIdSet = new Set(sectionIds)

  const attendanceRows =
    lessonIds.size === 0
      ? []
      : await forTenant(ctx).select(
          attendance,
          and(eq(attendance.studentId, studentId), inArray(attendance.lessonId, [...lessonIds])),
        )

  // Grades for this student, scoped in-memory to the window's lessons/sections (avoids an OR query).
  // Lesson-linked grades inherit the window via lessonIds (lessons are already date-filtered).
  // Section-level (per-term) grades have no lesson, so bound them by gradedAt (fallback createdAt)
  // within [from, to] — otherwise a term grade from outside the period would leak into the report.
  const inWindow = (d: Date | null) => d != null && d >= window.from && d <= window.to
  const allGrades = await forTenant(ctx).select(grade, eq(grade.studentId, studentId))
  const relevantGrades = allGrades.filter((g) => {
    if (g.lessonId != null && lessonIds.has(g.lessonId)) return true
    if (g.sectionId != null && sectionIdSet.has(g.sectionId))
      return inWindow(g.gradedAt ?? g.createdAt)
    return false
  })

  // Student-scoped notes for the AI to summarize (most-recent first, capped for prompt size).
  // B50: ONLY visibility='shared' notes may reach the parent-facing LLM prompt. 'internal' notes are the
  // teacher's private record (e.g. "家庭情况复杂，谨慎沟通") and must NEVER be summarized into a report a
  // family reads — the report-prompt has no way to know a note was confidential once it is in the prompt.
  const noteRows = await forTenant(ctx).select(
    note,
    and(eq(note.studentId, studentId), eq(note.visibility, 'shared')),
  )
  const notes = capNotesForPrompt(
    noteRows
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 20)
      .map((n) => n.body),
  )

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
