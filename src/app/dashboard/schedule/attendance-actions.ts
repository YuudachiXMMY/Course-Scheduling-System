'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { requireAuthContext } from '@/auth/context'
import { requirePermission } from '@/auth/authorize'
import { actorOwnsLesson } from '@/auth/scope'
import { forTenant } from '@/db/tenant'
import { attendance, note, enrollment, student, lesson } from '@/db/schema'

export interface RosterEntry {
  studentId: string
  name: string
  status: 'present' | 'absent' | 'late' | 'excused' | null
  note: string | null
}

// Roster for a lesson's section + any recorded attendance — powers the detail drawer.
export async function getLessonRoster(lessonId: string): Promise<RosterEntry[]> {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { lesson: ['read'] })
  const lrow = (await forTenant(ctx).findById(lesson, lessonId)) as
    typeof lesson.$inferSelect | null
  if (!lrow) return []

  const enrollments = (await forTenant(ctx).select(
    enrollment,
    and(eq(enrollment.sectionId, lrow.sectionId), eq(enrollment.status, 'active')),
  )) as (typeof enrollment.$inferSelect)[]
  if (enrollments.length === 0) return []

  // Only load the enrolled students' names (not the whole tenant's student table).
  const studentIds = enrollments.map((e) => e.studentId)
  const students = (await forTenant(ctx).select(
    student,
    inArray(student.id, studentIds),
  )) as (typeof student.$inferSelect)[]
  const nameById = new Map(students.map((s) => [s.id, s.name]))

  const recorded = (await forTenant(ctx).select(
    attendance,
    eq(attendance.lessonId, lessonId),
  )) as (typeof attendance.$inferSelect)[]
  const byStudent = new Map(recorded.map((a) => [a.studentId, a]))

  return enrollments.map((e) => {
    const a = byStudent.get(e.studentId)
    return {
      studentId: e.studentId,
      name: nameById.get(e.studentId) ?? e.studentId,
      status: a?.status ?? null,
      note: a?.note ?? null,
    }
  })
}

// P2-9: attendance & notes map to `lesson` permissions.
const attendanceSchema = z.object({
  lessonId: z.string().trim().min(1),
  studentId: z.string().trim().min(1),
  status: z.enum(['present', 'absent', 'late', 'excused']),
  note: z.string().trim().max(500).optional(),
})

// Upsert on (lesson, student): select-then-write on the forTenant spine (no raw db.* — grep guard).
export async function upsertAttendance(input: z.input<typeof attendanceSchema>) {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { lesson: ['update'] })
  const data = attendanceSchema.parse(input)
  // 工作流 E: a section-scoped teacher may only record attendance for a lesson they teach.
  if (!(await actorOwnsLesson(ctx, data.lessonId))) throw new Error('无权记录该课节考勤')

  const existing = (await forTenant(ctx).select(
    attendance,
    and(eq(attendance.lessonId, data.lessonId), eq(attendance.studentId, data.studentId)),
  )) as (typeof attendance.$inferSelect)[]

  if (existing[0]) {
    const [row] = await forTenant(ctx).update(attendance, existing[0].id, {
      status: data.status,
      note: data.note,
      recordedBy: ctx.userId,
      recordedAt: new Date(),
    })
    revalidatePath('/dashboard/schedule')
    return row
  }

  const [row] = await forTenant(ctx).insert(attendance, {
    lessonId: data.lessonId,
    studentId: data.studentId,
    status: data.status,
    note: data.note,
    recordedBy: ctx.userId,
  })
  revalidatePath('/dashboard/schedule')
  return row
}

export async function listAttendance(lessonId: string) {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { lesson: ['read'] })
  return (await forTenant(ctx).select(
    attendance,
    eq(attendance.lessonId, lessonId),
  )) as (typeof attendance.$inferSelect)[]
}

// A lesson's notes: ONE shared note (studentId = null) that every student's per-lesson report
// draws from, PLUS an optional per-student comment (studentId set). Modeled on the note table's
// nullable studentId — no new table needed. The note table has no (lesson, student) unique
// constraint, so all writes are select-then-write (mirrors upsertAttendance above).
export interface LessonNotes {
  shared: string
  perStudent: Record<string, string>
}

export async function getLessonNotes(lessonId: string): Promise<LessonNotes> {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { lesson: ['read'] })
  const rows = (await forTenant(ctx).select(
    note,
    eq(note.lessonId, lessonId),
  )) as (typeof note.$inferSelect)[]
  // Oldest → newest so a later row wins per key (latest edit reflects current state).
  rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  let shared = ''
  const perStudent: Record<string, string> = {}
  for (const r of rows) {
    if (r.studentId) perStudent[r.studentId] = r.body
    else shared = r.body
  }
  return { shared, perStudent }
}

const sharedNoteSchema = z.object({
  lessonId: z.string().trim().min(1),
  body: z.string().trim().min(1, '笔记不能为空').max(2000),
})

// Shared lesson note (studentId = null): upsert the single row so it can be viewed and edited later.
export async function upsertSharedNote(input: z.input<typeof sharedNoteSchema>) {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { lesson: ['update'] })
  const data = sharedNoteSchema.parse(input)
  // 工作流 E: a section-scoped teacher may only write a note on a lesson they teach.
  if (!(await actorOwnsLesson(ctx, data.lessonId))) throw new Error('无权编辑该课节笔记')

  const existing = (await forTenant(ctx).select(
    note,
    and(eq(note.lessonId, data.lessonId), isNull(note.studentId)),
  )) as (typeof note.$inferSelect)[]

  if (existing[0]) {
    const [row] = await forTenant(ctx).update(note, existing[0].id, {
      body: data.body,
      authorId: ctx.userId,
    })
    revalidatePath('/dashboard/schedule')
    return row
  }
  const [row] = await forTenant(ctx).insert(note, {
    lessonId: data.lessonId,
    authorId: ctx.userId,
    body: data.body,
    visibility: 'internal',
  })
  revalidatePath('/dashboard/schedule')
  return row
}

const studentNoteSchema = z.object({
  lessonId: z.string().trim().min(1),
  studentId: z.string().trim().min(1),
  body: z.string().trim().min(1, '点评不能为空').max(2000),
})

// Per-student comment (studentId set): each student's own note for the lesson, upserted independently.
export async function upsertStudentNote(input: z.input<typeof studentNoteSchema>) {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { lesson: ['update'] })
  const data = studentNoteSchema.parse(input)
  // 工作流 E: a section-scoped teacher may only write a comment on a lesson they teach.
  if (!(await actorOwnsLesson(ctx, data.lessonId))) throw new Error('无权编辑该课节点评')

  const existing = (await forTenant(ctx).select(
    note,
    and(eq(note.lessonId, data.lessonId), eq(note.studentId, data.studentId)),
  )) as (typeof note.$inferSelect)[]

  if (existing[0]) {
    const [row] = await forTenant(ctx).update(note, existing[0].id, {
      body: data.body,
      authorId: ctx.userId,
    })
    revalidatePath('/dashboard/schedule')
    return row
  }
  const [row] = await forTenant(ctx).insert(note, {
    lessonId: data.lessonId,
    studentId: data.studentId,
    authorId: ctx.userId,
    body: data.body,
    visibility: 'internal',
  })
  revalidatePath('/dashboard/schedule')
  return row
}
