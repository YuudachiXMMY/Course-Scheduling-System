'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { and, eq, gte, ne } from 'drizzle-orm'
import { requireAuthContext } from '@/auth/context'
import { requirePermission } from '@/auth/authorize'
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
