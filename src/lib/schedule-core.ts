import 'server-only'
import { z } from 'zod'
import { DateTime } from 'luxon'
import type { AuthContext } from '@/auth/context'
import { forTenant } from '@/db/tenant'
import { lesson, classSection } from '@/db/schema'
import { checkTeacherConflict } from '@/lib/conflict'
import { ConflictError, isExclusionViolation } from '@/lib/errors'
import { APP_TIME_ZONE } from '@/lib/timezone'
import type { CalendarEvent, ScheduleResult } from '@/app/dashboard/schedule/types'

// P6-3: the scheduling create/reschedule core, extracted from the Server Actions so the Next.js
// dashboard AND the Phase-6 MCP tools share BYTE-IDENTICAL conflict detection + write logic.
// The Server Actions keep only requireAuthContext + revalidatePath; the MCP tools keep only
// resolveMcpAuthContext + the draft-and-confirm gate. Everything else lives here.
//
// Precedent: src/lib/materialize.ts (materializeSection) already lives in src/lib with a
// "Phase-6 MCP shares it" comment. This is the same pattern for the ad-hoc create/reschedule path.

const ZONE = APP_TIME_ZONE

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

// Field shapes are exported separately from the refined schemas so callers that need a plain
// z.object() for JSON-Schema advertisement (MCP tool inputSchema) can build one, while the
// refined *Schema (with the endAt>startAt rule) is used for parse(). Both validate identically.
export const createFields = {
  sectionId: z.string().trim().min(1),
  startAt: z.coerce.date(),
  endAt: z.coerce.date(),
  title: z.string().trim().max(120).optional(),
}
export const createSchema = z
  .object(createFields)
  .refine((d) => d.endAt > d.startAt, { message: '结束时间必须晚于开始时间', path: ['endAt'] })

export const rescheduleFields = {
  id: z.string().trim().min(1),
  startAt: z.coerce.date(),
  endAt: z.coerce.date(),
}
export const rescheduleSchema = z
  .object(rescheduleFields)
  .refine((d) => d.endAt > d.startAt, { message: '结束时间必须晚于开始时间', path: ['endAt'] })

export async function scheduleLessonCore(
  ctx: AuthContext,
  input: z.input<typeof createSchema>,
): Promise<ScheduleResult> {
  const data = createSchema.parse(input)

  // teacherId comes from the section (denormalized) so GiST/conflict never silently exempts the row.
  const section = (await forTenant(ctx).findById(classSection, data.sectionId)) as
    | typeof classSection.$inferSelect
    | null
  if (!section) throw new Error('班级不存在或不属于当前机构')
  const teacherId = section.teacherId
  if (!teacherId) throw new Error('班级尚未指定教师，无法排课')

  const check = await checkTeacherConflict(ctx, { teacherId, startAt: data.startAt, endAt: data.endAt })
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
    return { ok: true, event: toEvent(row as typeof lesson.$inferSelect) }
  } catch (e) {
    if (isExclusionViolation(e)) throw new ConflictError()
    throw e
  }
}

export async function rescheduleLessonCore(
  ctx: AuthContext,
  input: z.input<typeof rescheduleSchema>,
): Promise<ScheduleResult> {
  const data = rescheduleSchema.parse(input)

  const existing = (await forTenant(ctx).findById(lesson, data.id)) as typeof lesson.$inferSelect | null
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
    return { ok: true, event: toEvent(row as typeof lesson.$inferSelect) }
  } catch (e) {
    if (isExclusionViolation(e)) throw new ConflictError()
    throw e
  }
}
