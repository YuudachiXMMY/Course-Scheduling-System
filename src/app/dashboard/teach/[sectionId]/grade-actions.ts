'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { and, eq } from 'drizzle-orm'
import { requireAuthContext } from '@/auth/context'
import { requirePermission } from '@/auth/authorize'
import { actorOwnsLesson } from '@/auth/scope'
import { forTenant } from '@/db/tenant'
import { lesson, enrollment } from '@/db/schema'
import { upsertLessonStudentGradeCore } from './data'

// Thin web wrapper over the grade core in data.ts (mirrors reports/actions.ts → report-core):
// requireAuthContext → requirePermission → zod parse → core → revalidatePath. Classroom grades are
// recorded per lesson, so they map to `lesson` permissions — the same mapping attendance & notes use
// (attendance-actions.ts:57). No standalone grade permission statement exists (permissions.ts).
const gradeSchema = z.object({
  lessonId: z.string().trim().min(1),
  studentId: z.string().trim().min(1),
  // Inputs arrive as strings from the client; coerce. All optional — a fully-empty grade deletes the row.
  score: z.coerce.number().min(0).max(9999).optional(),
  maxScore: z.coerce.number().min(0).max(9999).optional(),
  comment: z.string().trim().max(2000).optional(),
})

export async function upsertLessonStudentGrade(input: z.input<typeof gradeSchema>) {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { lesson: ['update'] })
  const data = gradeSchema.parse(input)
  // 工作流 E: a section-scoped teacher may only grade a lesson they teach.
  if (!(await actorOwnsLesson(ctx, data.lessonId))) throw new Error('无权录入该课节成绩')
  // B31: object-level authz on studentId — owning the lesson is not enough. grade's FK is (tenant,
  // student), so without this a teacher could write a grade/comment for ANY same-tenant student. The
  // student must be actively enrolled in THIS lesson's section.
  const lrow = (await forTenant(ctx).findById(lesson, data.lessonId)) as
    | typeof lesson.$inferSelect
    | null
  if (!lrow) throw new Error('课节不存在')
  const enrolled = (await forTenant(ctx).select(
    enrollment,
    and(
      eq(enrollment.sectionId, lrow.sectionId),
      eq(enrollment.studentId, data.studentId),
      eq(enrollment.status, 'active'),
    ),
  )) as unknown[]
  if (enrolled.length === 0) throw new Error('该学生不在该课节班级')
  const row = await upsertLessonStudentGradeCore(ctx, data)
  revalidatePath('/dashboard/schedule')
  return row
}
