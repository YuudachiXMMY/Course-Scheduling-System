'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { and, eq, gte, ne } from 'drizzle-orm'
import { DateTime } from 'luxon'
import { requireAuthContext } from '@/auth/context'
import { requirePermission } from '@/auth/authorize'
import { forTenant } from '@/db/tenant'
import { lesson, classSection } from '@/db/schema'
import { checkTeacherConflict } from '@/lib/conflict'
import { ConflictError, isExclusionViolation } from '@/lib/errors'
import type { CalendarEvent, ScheduleResult } from './types'

const ZONE = 'Asia/Shanghai'

function toEvent(row: typeof lesson.$inferSelect): CalendarEvent {
  return {
    id: row.id,
    title: row.title ?? '课节',
    start: row.startAt.toISOString(),
    end: row.endAt.toISOString(),
    sectionId: row.sectionId,
    status: row.status,
  }
}

function toHHmm(d: Date): string {
  return DateTime.fromJSDate(d).setZone(ZONE).toFormat('HH:mm')
}

const createSchema = z.object({
  sectionId: z.string().trim().min(1),
  startAt: z.coerce.date(),
  endAt: z.coerce.date(),
  title: z.string().trim().max(120).optional(),
})

export async function createLessonAction(
  input: z.input<typeof createSchema>,
): Promise<ScheduleResult> {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { lesson: ['create'] })
  const data = createSchema.parse(input)

  // teacherId comes from the section (denormalized) so GiST/conflict never silently exempts the row.
  const section = (await forTenant(ctx).findById(classSection, data.sectionId)) as
    typeof classSection.$inferSelect | null
  if (!section) throw new Error('班级不存在或不属于当前机构')
  const teacherId = section.teacherId
  if (!teacherId) throw new Error('班级尚未指定教师，无法排课')

  const check = await checkTeacherConflict(ctx, {
    teacherId,
    startAt: data.startAt,
    endAt: data.endAt,
  })
  if (check.hasConflict) {
    return {
      ok: false,
      error: 'CONFLICT',
      conflicts: check.conflicts.map((c) => ({ id: c.id, title: c.title })),
      suggestions: check.suggestions.map(toHHmm),
    }
  }

  try {
    const [row] = await forTenant(ctx).insert(lesson, {
      sectionId: section.id,
      teacherId,
      startAt: data.startAt,
      endAt: data.endAt,
      title: data.title,
      status: 'scheduled',
      isException: true, // ad-hoc lesson (not from the RRULE grid)
    })
    revalidatePath('/dashboard/schedule')
    return { ok: true, event: toEvent(row as typeof lesson.$inferSelect) }
  } catch (e) {
    if (isExclusionViolation(e)) throw new ConflictError()
    throw e
  }
}

const rescheduleSchema = z.object({
  id: z.string().trim().min(1),
  startAt: z.coerce.date(),
  endAt: z.coerce.date(),
})

export async function rescheduleLessonAction(
  input: z.input<typeof rescheduleSchema>,
): Promise<ScheduleResult> {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { lesson: ['update'] })
  const data = rescheduleSchema.parse(input)

  const existing = (await forTenant(ctx).findById(lesson, data.id)) as
    typeof lesson.$inferSelect | null
  if (!existing) throw new Error('课节不存在')
  if (!existing.teacherId) throw new Error('课节缺少教师信息')

  const check = await checkTeacherConflict(ctx, {
    teacherId: existing.teacherId,
    startAt: data.startAt,
    endAt: data.endAt,
    excludeLessonId: data.id, // don't conflict with itself
  })
  if (check.hasConflict) {
    return {
      ok: false,
      error: 'CONFLICT',
      conflicts: check.conflicts.map((c) => ({ id: c.id, title: c.title })),
      suggestions: check.suggestions.map(toHHmm),
    }
  }

  try {
    const [row] = await forTenant(ctx).update(lesson, data.id, {
      startAt: data.startAt,
      endAt: data.endAt,
      isException: true, // moved off the pattern (P2-8)
    })
    revalidatePath('/dashboard/schedule')
    return { ok: true, event: toEvent(row as typeof lesson.$inferSelect) }
  } catch (e) {
    if (isExclusionViolation(e)) throw new ConflictError()
    throw e
  }
}

export async function cancelLessonAction(id: string): Promise<{ ok: true }> {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { lesson: ['update'] })
  // Tombstone (P2-8): keep the row so re-materialization can't resurrect it.
  await forTenant(ctx).update(lesson, id, { status: 'canceled' })
  revalidatePath('/dashboard/schedule')
  return { ok: true }
}

export async function cancelSeriesAction(sectionId: string): Promise<{ canceled: number }> {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { lesson: ['update'] })
  // Cancel all future, non-canceled lessons of the section — stay on the forTenant spine (no raw db.*).
  const rows = (await forTenant(ctx).select(
    lesson,
    and(
      eq(lesson.sectionId, sectionId),
      ne(lesson.status, 'canceled'),
      gte(lesson.startAt, new Date()),
    ),
  )) as (typeof lesson.$inferSelect)[]
  for (const row of rows) {
    await forTenant(ctx).update(lesson, row.id, { status: 'canceled' })
  }
  revalidatePath('/dashboard/schedule')
  return { canceled: rows.length }
}
