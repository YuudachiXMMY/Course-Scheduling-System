import 'server-only'
import { and, eq, gte, inArray, lte, ne } from 'drizzle-orm'
import { DateTime } from 'luxon'
import { notFound } from 'next/navigation'
import { forTenant } from '@/db/tenant'
import {
  classSection,
  course,
  enrollment,
  student,
  lesson,
  grade,
  note,
  attendance,
  progressReport,
  rescheduleRequest,
} from '@/db/schema'
import { APP_TIME_ZONE } from '@/lib/timezone'
import { actorOwnsSection } from '@/auth/scope'
import type { AttendanceStatus } from '@/lib/report-stats'
import type { AuthContext } from '@/auth/context'
import type { ReportRow } from '@/app/dashboard/reports/data'

// Server-only per-section loaders for the workspace. All reads go through forTenant(ctx) (the only
// sanctioned tenant-scoped path — see src/db/tenant.ts). No new 'use server' surface; mutations reuse
// the existing course/section/enrollment/lesson/report Server Actions.

type Section = typeof classSection.$inferSelect
type Course = typeof course.$inferSelect

export interface SectionLesson {
  id: string
  title: string
  start: string // ISO UTC
  end: string // ISO UTC
  status: 'scheduled' | 'completed' | 'canceled'
  location: string | null
  meetingUrl: string | null
  isPast: boolean // computed server-side (client render must stay pure — no Date.now())
}

export interface SectionStudent {
  id: string
  name: string
}

// 工作流 E — per-section access guard at the DATA layer (not only teach/[sectionId]/layout.tsx). Loads the
// section and 404s unless the actor owns it: a teacher → only sections they teach; owner/admin/assistant/
// superadmin → any (actorOwnsSection). Every per-section loader below calls this so ownership is enforced
// INDEPENDENTLY of Next.js layout/child render ordering — a guessed (same-tenant) or stale/cross-tenant id
// can never leak a roster/lessons/reports through a loader reached outside the layout, and the guard holds
// even on this repo's patched Next.js. Returns the section so callers needing it (term dates, course
// title) don't re-query. A stale / cross-tenant id resolves to teach/not-found.tsx (rendered inside
// teach/layout.tsx, so the rail is preserved).
async function requireOwnedSection(ctx: AuthContext, id: string): Promise<Section> {
  const section = await forTenant(ctx).findById(classSection, id)
  if (!section || !actorOwnsSection(ctx, section)) notFound()
  return section
}

export async function getSectionHeader(
  ctx: AuthContext,
  id: string,
): Promise<{ section: Section; course: Course }> {
  const section = await requireOwnedSection(ctx, id)
  const parent = await forTenant(ctx).findById(course, section.courseId)
  if (!parent) notFound()
  return { section, course: parent }
}

export async function getSectionRoster(ctx: AuthContext, id: string): Promise<SectionStudent[]> {
  await requireOwnedSection(ctx, id) // 工作流 E: enforce section ownership here, not only via the layout
  const enrolls = await forTenant(ctx).select(
    enrollment,
    and(eq(enrollment.sectionId, id), eq(enrollment.status, 'active')),
  )
  const ids = [...new Set(enrolls.map((e) => e.studentId))]
  if (ids.length === 0) return []
  const students = await forTenant(ctx).select(student, inArray(student.id, ids))
  return students
    .map((s) => ({ id: s.id, name: s.name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh'))
}

// Window INCLUDES past lessons (term window, or now-60d…now+120d) so attendance/notes on already-held
// lessons stay reachable from the 排课 tab — a future-only list would strand the drawer's retrospective
// features. Canceled tombstones are hidden.
export async function getSectionLessons(ctx: AuthContext, id: string): Promise<SectionLesson[]> {
  const section = await requireOwnedSection(ctx, id) // 工作流 E: ownership guard (non-null section)
  const now = DateTime.now().setZone(APP_TIME_ZONE)
  // term_start/end_date are stored at UTC midnight but the class runs in America/Toronto, so a raw
  // termEndDate upper bound would clip the final day's afternoon/evening lessons. Mirror
  // materialize.ts's localDayBound: snap to the FULL local calendar day, and use lte so the read
  // window matches the write window the materializer used.
  const localDayBound = (d: Date, edge: 'start' | 'end') => {
    const utc = DateTime.fromJSDate(d, { zone: 'utc' })
    const local = DateTime.fromObject(
      { year: utc.year, month: utc.month, day: utc.day },
      { zone: APP_TIME_ZONE },
    )
    return (edge === 'start' ? local.startOf('day') : local.endOf('day')).toUTC().toJSDate()
  }
  const from = section.termStartDate
    ? localDayBound(section.termStartDate, 'start')
    : now.minus({ days: 60 }).toUTC().toJSDate()
  const to = section.termEndDate
    ? localDayBound(section.termEndDate, 'end')
    : now.plus({ days: 120 }).toUTC().toJSDate()
  const rows = await forTenant(ctx).select(
    lesson,
    and(
      eq(lesson.sectionId, id),
      ne(lesson.status, 'canceled'),
      gte(lesson.startAt, from),
      lte(lesson.startAt, to),
    ),
  )
  const parentTitle = (await forTenant(ctx).findById(course, section.courseId))?.title ?? null
  const nowMs = Date.now()
  return rows
    .sort((a, b) => a.startAt.getTime() - b.startAt.getTime())
    .map((r) => ({
      id: r.id,
      title: r.title ?? parentTitle ?? '课节',
      start: r.startAt.toISOString(),
      end: r.endAt.toISOString(),
      status: r.status,
      location: r.location,
      meetingUrl: r.meetingUrl,
      isPast: r.endAt.getTime() < nowMs,
    }))
}

// Count of PENDING reschedule requests (portal-originated) that target a lesson in THIS section — a
// teacher-facing "N 条待处理改期" badge that links into the tenant-wide 改期申请 queue. Tenant-scoped:
// select this section's lessons, then filter the tenant's pending requests by lesson membership. The
// reschedule queue itself stays global (a request isn't editable here); this is just contextual signal.
export async function getSectionPendingRescheduleCount(
  ctx: AuthContext,
  id: string,
): Promise<number> {
  await requireOwnedSection(ctx, id) // 工作流 E: ownership guard (called from the layout, but self-sufficient)
  const lessons = await forTenant(ctx).select(lesson, eq(lesson.sectionId, id))
  if (lessons.length === 0) return 0
  // Push the lesson-membership filter into SQL (inArray) rather than scanning the tenant's entire
  // pending set in memory — this runs per section-layout render. lessonIds is non-empty (guarded above).
  const lessonIds = lessons.map((l) => l.id)
  const pending = await forTenant(ctx).select(
    rescheduleRequest,
    and(eq(rescheduleRequest.status, 'pending'), inArray(rescheduleRequest.lessonId, lessonIds)),
  )
  return pending.length
}

// Reports are student+period scoped (a student may sit in several sections); we surface the reports of
// THIS section's active roster. `report.sectionId` is nullable provenance — we filter by roster
// membership, not by that column, so a student's report shows under every section they're enrolled in.
export async function getSectionReports(ctx: AuthContext, id: string): Promise<ReportRow[]> {
  await requireOwnedSection(ctx, id) // 工作流 E: self-contained ownership guard, not only transitive via getSectionRoster
  const roster = await getSectionRoster(ctx, id)
  const rosterIds = new Set(roster.map((r) => r.id))
  if (rosterIds.size === 0) return []
  // PERF5: push the roster-membership filter into SQL (inArray) instead of loading the ENTIRE tenant's
  // progressReport table and filtering in memory — this runs on the workspace render path. rosterIds is
  // non-empty (guarded above). Mirrors getSectionPendingRescheduleCount / getSectionLessonNotes here.
  const rows = await forTenant(ctx).select(
    progressReport,
    inArray(progressReport.studentId, [...rosterIds]),
  )
  const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null)
  return rows
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map((r) => ({
      id: r.id,
      studentId: r.studentId,
      title: r.title,
      periodStart: day(r.periodStart),
      periodEnd: day(r.periodEnd),
      status: r.status,
      narrative: r.narrative,
      createdAt: r.createdAt.toISOString().slice(0, 10),
    }))
}

// The 排课 tab's inline editor manages ONE lightweight per-(lesson, student) grade row. This sentinel
// title separates it from future titled assessments (月考/期中); a lesson×student has at most one such
// row. Lives HERE (server-only, NOT a 'use server' file) because a 'use server' module may only export
// async functions — grade-actions.ts imports it from here.
export const QUICK_GRADE_TITLE = '课堂表现'

interface LessonGradeCell {
  score: string | null // node-pg returns numeric as string
  maxScore: string | null
  comment: string | null
}

export interface LessonNoteRow {
  summary: string // shared lesson note (note.studentId = null)
  summaryVisibility: 'internal' | 'shared' // 共享笔记是否「对外开放」给门户学生/家长（无笔记时默认 internal）
  comments: Record<string, string> // studentId -> per-student 点评 (note.studentId set)
  grades: Record<string, LessonGradeCell> // studentId -> 课堂成绩 (grade.title = QUICK_GRADE_TITLE)
  attendance: Record<string, AttendanceStatus> // studentId -> 出勤状态 (attendanceStatus enum union)
}

// Load the note/grade matrix for a whole section's lessons in one pass. note & grade both hang off
// lessonId (shared note = studentId null; see upsertSharedNote), so we batch by lessonIds with
// inArray (mirrors getSectionPendingRescheduleCount / report-data.ts). lessonIds comes from the
// caller's getSectionLessons result — no re-query of the lesson table, and section ownership is already
// enforced there (requireOwnedSection), so these lessonIds are always the actor's own section's.
export async function getSectionLessonNotes(
  ctx: AuthContext,
  lessonIds: string[],
): Promise<Record<string, LessonNoteRow>> {
  const byLesson: Record<string, LessonNoteRow> = {}
  for (const id of lessonIds)
    byLesson[id] = {
      summary: '',
      summaryVisibility: 'internal', // 默认内部；仅当存在共享笔记时用其 visibility 覆盖
      comments: {},
      grades: {},
      attendance: {},
    }
  if (lessonIds.length === 0) return byLesson // inArray([]) is invalid SQL — guard (see report-data.ts)

  const noteRows = await forTenant(ctx).select(note, inArray(note.lessonId, lessonIds))
  // Oldest → newest so a later row wins per key (latest edit reflects current state), matching
  // getLessonNotes in attendance-actions.ts.
  noteRows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  for (const n of noteRows) {
    if (!n.lessonId) continue
    const row = byLesson[n.lessonId]
    if (!row) continue
    if (n.studentId) row.comments[n.studentId] = n.body
    else {
      row.summary = n.body
      row.summaryVisibility = n.visibility // 供教师端「对外开放」开关回显当前状态
    }
  }

  const gradeRows = await forTenant(ctx).select(grade, inArray(grade.lessonId, lessonIds))
  for (const g of gradeRows) {
    // Only the inline sentinel-title grade belongs in a cell; titled assessments stay out.
    if (!g.lessonId || g.studentId == null || g.title !== QUICK_GRADE_TITLE) continue
    const row = byLesson[g.lessonId]
    if (!row) continue
    row.grades[g.studentId] = { score: g.score, maxScore: g.maxScore, comment: g.comment }
  }

  // Attendance is a single row per (lesson, student) (uq_attendance_lesson_student), so no ordering
  // dance is needed — one status wins. Batch by lessonIds like note/grade above.
  const attRows = await forTenant(ctx).select(attendance, inArray(attendance.lessonId, lessonIds))
  for (const a of attRows) {
    const row = byLesson[a.lessonId]
    if (!row) continue
    row.attendance[a.studentId] = a.status
  }
  return byLesson
}

export interface LessonStudentGradeInput {
  lessonId: string
  studentId: string
  score?: number
  maxScore?: number
  comment?: string
}

// Grade upsert core — shared by the 'use server' action (web) and testable directly with a ctxFor
// (mirrors report-core.ts). The caller (grade-actions) has already run requireAuthContext +
// requirePermission + zod; this only touches the DB via forTenant(ctx). One per-(lesson, student)
// sentinel-title row; select-then-write (grade has no (lesson, student) unique constraint). All three
// fields empty → the row is deleted (grade is optional). Returns the row, or null when deleted/absent.
export async function upsertLessonStudentGradeCore(
  ctx: AuthContext,
  data: LessonStudentGradeInput,
): Promise<typeof grade.$inferSelect | null> {
  const existing = await forTenant(ctx).select(
    grade,
    and(
      eq(grade.lessonId, data.lessonId),
      eq(grade.studentId, data.studentId),
      eq(grade.title, QUICK_GRADE_TITLE),
    ),
  )

  const empty = data.score == null && data.maxScore == null && !data.comment
  if (empty) {
    // Deleting the grade ROW is allowed; grade's onDelete('restrict') only guards its referenced
    // student/lesson/section parents, not the grade record itself.
    if (existing[0]) await forTenant(ctx).delete(grade, existing[0].id)
    return null
  }

  const values = {
    score: data.score != null ? String(data.score) : null, // numeric column stores a string
    maxScore: data.maxScore != null ? String(data.maxScore) : null,
    comment: data.comment || null,
    gradedBy: ctx.userId,
    gradedAt: new Date(),
  }
  if (existing[0]) {
    const [row] = await forTenant(ctx).update(grade, existing[0].id, values)
    return row
  }
  const [row] = await forTenant(ctx).insert(grade, {
    studentId: data.studentId,
    lessonId: data.lessonId,
    title: QUICK_GRADE_TITLE,
    ...values,
  })
  return row
}
