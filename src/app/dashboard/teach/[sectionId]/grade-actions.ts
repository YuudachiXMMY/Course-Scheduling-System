'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { requireAuthContext } from '@/auth/context'
import { requirePermission } from '@/auth/authorize'
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
  const row = await upsertLessonStudentGradeCore(ctx, data)
  revalidatePath('/dashboard/schedule')
  return row
}
