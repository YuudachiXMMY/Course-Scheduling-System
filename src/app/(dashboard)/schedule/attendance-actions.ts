'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { and, eq } from 'drizzle-orm'
import { requireAuthContext } from '@/auth/context'
import { requirePermission } from '@/auth/authorize'
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

  const students = (await forTenant(ctx).select(student)) as (typeof student.$inferSelect)[]
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

const noteSchema = z.object({
  lessonId: z.string().trim().min(1),
  body: z.string().trim().min(1, '笔记不能为空').max(2000),
})

export async function addNote(input: z.input<typeof noteSchema>) {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { lesson: ['update'] })
  const data = noteSchema.parse(input)
  const [row] = await forTenant(ctx).insert(note, {
    lessonId: data.lessonId,
    authorId: ctx.userId,
    body: data.body,
    visibility: 'internal',
  })
  revalidatePath('/dashboard/schedule')
  return row
}

export async function listNotes(lessonId: string) {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { lesson: ['read'] })
  return (await forTenant(ctx).select(
    note,
    eq(note.lessonId, lessonId),
  )) as (typeof note.$inferSelect)[]
}
