import 'server-only'
import { z } from 'zod'
import { DateTime } from 'luxon'
import type { AuthContext } from '@/auth/context'
import { actorOwnsSection } from '@/auth/scope'
import { db } from '@/db'
import { forTenant } from '@/db/tenant'
import { lesson, classSection } from '@/db/schema'
import { checkTeacherConflict } from '@/lib/conflict'
import { ConflictError, isExclusionViolation } from '@/lib/errors'
import { APP_TIME_ZONE } from '@/lib/timezone'
import { hydrateLessonEvent } from '@/app/dashboard/schedule/data'
import type { ScheduleResult } from '@/app/dashboard/schedule/types'

// P6-3: the scheduling create/reschedule core, extracted from the Server Actions so the Next.js
// dashboard AND the Phase-6 MCP tools share BYTE-IDENTICAL conflict detection + write logic.
// The Server Actions keep only requireAuthContext + revalidatePath; the MCP tools keep only
// resolveMcpAuthContext + the draft-and-confirm gate. Everything else lives here.
//
// Precedent: src/lib/materialize.ts (materializeSection) already lives in src/lib with a
// "Phase-6 MCP shares it" comment. This is the same pattern for the ad-hoc create/reschedule path.

const ZONE = APP_TIME_ZONE

// Render a suggestion instant as HH:mm in the section's zone (CR10) — falls back to APP_TIME_ZONE.
function toHHmm(d: Date, zone: string = ZONE): string {
  return DateTime.fromJSDate(d).setZone(zone).toFormat('HH:mm')
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
  const section = await forTenant(ctx).findById(classSection, data.sectionId)
  if (!section) throw new Error('班级不存在或不属于当前机构')
  // 工作流 E: a section-scoped teacher may only schedule into a section they teach (shared by the
  // dashboard Server Action AND the MCP tool, so both paths are covered here).
  if (!actorOwnsSection(ctx, section)) throw new Error('无权在该班级排课')
  const teacherId = section.teacherId
  if (!teacherId) throw new Error('班级尚未指定教师，无法排课')

  // CR10: suggestions enumerate the business-hours window in the SECTION's zone (recurrenceTimezone),
  // not a hardcoded APP_TIME_ZONE — thread it through so per-section timezones (if ever enabled) stay
  // consistent. Defaults to APP_TIME_ZONE today (classSection.recurrenceTimezone default).
  const check = await checkTeacherConflict(ctx, {
    teacherId,
    startAt: data.startAt,
    endAt: data.endAt,
    zone: section.recurrenceTimezone,
  })
  if (check.hasConflict) {
    return {
      ok: false,
      error: 'CONFLICT',
      conflicts: check.conflicts.map((c) => ({ id: c.id, title: c.title })),
      suggestions: check.suggestions.map((d) => toHHmm(d, section.recurrenceTimezone)),
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
    return { ok: true, event: await hydrateLessonEvent(ctx, row) }
  } catch (e) {
    if (isExclusionViolation(e)) throw new ConflictError()
    throw e
  }
}

export async function rescheduleLessonCore(
  ctx: AuthContext,
  input: z.input<typeof rescheduleSchema>,
  // H7: optional transaction executor. Defaults to the module db (byte-identical for the dashboard
  // Server Action and the MCP tool). approveRescheduleRequestCore passes its `tx` so the lesson MOVE
  // commits in the SAME transaction as the request CLAIM — either both land or both roll back.
  exec: Pick<typeof db, 'select' | 'insert' | 'update' | 'delete'> = db,
): Promise<ScheduleResult> {
  const data = rescheduleSchema.parse(input)

  const existing = await forTenant(ctx, exec).findById(lesson, data.id)
  if (!existing) throw new Error('课节不存在')
  if (!existing.teacherId) throw new Error('课节缺少教师信息')
  // 工作流 E: a section-scoped teacher may only move a lesson of a section they teach (lesson.teacherId
  // is denormalized from the section). Also gates approveRescheduleRequestCore, which moves via here.
  if (!actorOwnsSection(ctx, { teacherId: existing.teacherId })) throw new Error('无权修改该课节')

  // CR10: the lesson row carries no zone; load its section for recurrenceTimezone so suggestions use the
  // section's business-hours window (defaults to APP_TIME_ZONE). Missing section → fall back.
  const section = await forTenant(ctx, exec).findById(classSection, existing.sectionId)
  const zone = section?.recurrenceTimezone ?? ZONE

  // H7: thread `exec` into the conflict pre-check too, so inside the approve transaction it reads on the
  // SAME tx connection (no second pool borrow → no pool-exhaustion deadlock; and a consistent snapshot).
  const check = await checkTeacherConflict(
    ctx,
    {
      teacherId: existing.teacherId,
      startAt: data.startAt,
      endAt: data.endAt,
      excludeLessonId: data.id, // don't conflict with itself
      zone,
    },
    exec,
  )
  if (check.hasConflict) {
    return {
      ok: false,
      error: 'CONFLICT',
      conflicts: check.conflicts.map((c) => ({ id: c.id, title: c.title })),
      suggestions: check.suggestions.map((d) => toHHmm(d, zone)),
    }
  }

  try {
    const [row] = await forTenant(ctx, exec).update(lesson, data.id, {
      startAt: data.startAt,
      endAt: data.endAt,
      isException: true, // moved off the pattern (P2-8)
    })
    // H7: hydrate on the same `exec` too — otherwise its 4 reads borrow extra pool connections inside
    // the transaction.
    return { ok: true, event: await hydrateLessonEvent(ctx, row, exec) }
  } catch (e) {
    if (isExclusionViolation(e)) throw new ConflictError()
    throw e
  }
}
