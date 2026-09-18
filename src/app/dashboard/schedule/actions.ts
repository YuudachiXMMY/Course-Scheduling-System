'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { and, eq, gte, ne } from 'drizzle-orm'
import { requireAuthContext } from '@/auth/context'
import { requirePermission } from '@/auth/authorize'
import { actorOwnsLesson, actorOwnsSectionById } from '@/auth/scope'
import { forTenant } from '@/db/tenant'
import { lesson } from '@/db/schema'
import {
  createSchema,
  rescheduleSchema,
  scheduleLessonCore,
  rescheduleLessonCore,
} from '@/lib/schedule-core'
import type { ScheduleResult } from './types'

// P6-3: these are thin wrappers over src/lib/schedule-core.ts. The Server Action owns ONLY the
// request-coupled parts — requireAuthContext (needs Next headers()) and revalidatePath (throws
// outside a render). The scheduling logic itself is shared verbatim with the MCP tools.

export async function createLessonAction(
  input: z.input<typeof createSchema>,
): Promise<ScheduleResult> {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { lesson: ['create'] })
  const result = await scheduleLessonCore(ctx, input)
  revalidatePath('/dashboard/schedule')
  return result
}

export async function rescheduleLessonAction(
  input: z.input<typeof rescheduleSchema>,
): Promise<ScheduleResult> {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { lesson: ['update'] })
  const result = await rescheduleLessonCore(ctx, input)
  revalidatePath('/dashboard/schedule')
  return result
}

export async function cancelLessonAction(id: string): Promise<{ ok: true }> {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { lesson: ['update'] })
  // 工作流 E: a section-scoped teacher may only cancel a lesson of a section they teach.
  if (!(await actorOwnsLesson(ctx, id))) throw new Error('无权取消该课节')
  // Tombstone (P2-8): keep the row so re-materialization can't resurrect it.
  await forTenant(ctx).update(lesson, id, { status: 'canceled' })
  revalidatePath('/dashboard/schedule')
  return { ok: true }
}

// Lesson-level location / online-class link editing from the detail drawer (req5). Returns
// validation problems as data (production redacts thrown Server Action errors → React #441).
const updateLessonSchema = z.object({
  id: z.string().trim().min(1),
  location: z.string().trim().max(200).optional(),
  // M2: restrict to http(s) so the link can't carry a javascript:/data: scheme if rendered as href.
  meetingUrl: z
    .string()
    .trim()
    .max(500)
    .regex(/^https?:\/\//, '网课链接需以 http:// 或 https:// 开头')
    .optional(),
})
export type UpdateLessonResult = { ok: true } | { ok: false; error: string }

export async function updateLessonAction(
  input: z.input<typeof updateLessonSchema>,
): Promise<UpdateLessonResult> {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { lesson: ['update'] })
  const parsed = updateLessonSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? '输入有误' }
  }
  const data = parsed.data
  // 工作流 E: a section-scoped teacher may only edit a lesson of a section they teach.
  if (!(await actorOwnsLesson(ctx, data.id))) return { ok: false, error: '无权修改该课节' }
  const [row] = await forTenant(ctx).update(lesson, data.id, {
    location: data.location ?? null,
    meetingUrl: data.meetingUrl ?? null,
  })
  if (!row) return { ok: false, error: '课节不存在' }
  revalidatePath('/dashboard/schedule')
  return { ok: true }
}

export interface LessonMeta {
  location: string | null
  meetingUrl: string | null
  title: string | null
}

export async function getLessonMeta(lessonId: string): Promise<LessonMeta | null> {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { lesson: ['read'] })
  // 工作流 E: mirror updateLessonAction — location/meetingUrl (Zoom/腾讯会议链接) must not leak to a
  // section-scoped teacher or portal account guessing a same-tenant lessonId.
  if (!(await actorOwnsLesson(ctx, lessonId))) return null
  const row = await forTenant(ctx).findById(lesson, lessonId)
  if (!row) return null
  return { location: row.location, meetingUrl: row.meetingUrl, title: row.title }
}

export async function cancelSeriesAction(sectionId: string): Promise<{ canceled: number }> {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { lesson: ['update'] })
  // 工作流 E: a section-scoped teacher may only bulk-cancel a section they teach — this destroys every
  // future lesson of the section, so a guessed same-tenant sectionId must never reach the loop.
  if (!(await actorOwnsSectionById(ctx, sectionId))) throw new Error('无权取消该班级排课')
  // Cancel all future, non-canceled lessons of the section — stay on the forTenant spine (no raw db.*).
  const rows = await forTenant(ctx).select(
    lesson,
    and(
      eq(lesson.sectionId, sectionId),
      ne(lesson.status, 'canceled'),
      gte(lesson.startAt, new Date()),
    ),
  )
  for (const row of rows) {
    await forTenant(ctx).update(lesson, row.id, { status: 'canceled' })
  }
  revalidatePath('/dashboard/schedule')
  return { canceled: rows.length }
}
