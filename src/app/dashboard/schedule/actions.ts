'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { and, eq, gte, ne, inArray } from 'drizzle-orm'
import { requireAuthContext } from '@/auth/context'
import { requirePermission } from '@/auth/authorize'
import { actorOwnsLesson, actorOwnsSectionById, sectionIdsForActor } from '@/auth/scope'
import { forTenant } from '@/db/tenant'
import { lesson } from '@/db/schema'
import {
  createSchema,
  rescheduleSchema,
  scheduleLessonCore,
  rescheduleLessonCore,
} from '@/lib/schedule-core'
import { addSessionsCore } from '@/lib/add-sessions'
import { WEEKDAYS, RECURRENCE_FREQS, type Weekday } from '@/lib/rrule-build'
import { toPortalActionError } from '@/lib/errors'
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

// 排课 → 多选删除课节. Bulk-cancel the selected lessons (soft-delete tombstone, mirroring
// cancelLessonAction). Ownership is enforced IN the WHERE clause — a section-scoped teacher only matches
// lessons in a section they CURRENTLY own (lesson.sectionId ∈ sectionIdsForActor, never the frozen
// lesson.teacherId), so a guessed same-tenant / foreign id — or a lesson of a section they were removed
// from — simply doesn't match and is silently skipped (never a partial-leak error); `canceled` reports
// only what was actually tombstoned. PERF: ONE atomic updateWhereMany (mirrors cancelSeriesAction) instead
// of a per-id select+update loop (up to ~1000 round-trips for the 500-id cap). Returns as DATA ({ok,error}).
export type CancelLessonsResult = { ok: true; canceled: number } | { ok: false; error: string }

export async function cancelLessonsAction(ids: string[]): Promise<CancelLessonsResult> {
  const ctx = await requireAuthContext()
  const parsed = z.array(z.string().min(1)).min(1, '请至少选择一节课').max(500).safeParse(ids)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? '输入有误' }
  try {
    requirePermission(ctx, { lesson: ['update'] })
    // Dedupe so a repeated id can't inflate the count.
    const unique = [...new Set(parsed.data)]
    // 多教师 SECURITY: whole-tenant staff may cancel any of the tenant's lessons; a section-scoped teacher
    // is confined to the sections they CURRENTLY own. Authorize on the lesson's live section membership
    // (sectionIdsForActor) — NOT the frozen lesson.teacherId, which is denormalized once at materialize time
    // and never updated, so a teacher removed from a section (removeSectionTeacher repoints
    // classSection.teacherId + deletes their link) would otherwise keep bulk-cancel rights over its
    // already-materialized lessons. Mirrors actorOwnsLesson / cancelSeriesAction. updateWhereMany always
    // AND-s the tenant scope, so this stays within ctx.tenantId regardless. ne(canceled) keeps the count to
    // lessons actually transitioned (re-canceling an already-tombstoned row is a no-op, not a +1).
    const ownedSections = await sectionIdsForActor(ctx)
    // A section-scoped actor with no sections sees nothing — short-circuit before inArray([]) (invalid SQL).
    if (ownedSections !== 'all' && ownedSections.length === 0) return { ok: true, canceled: 0 }
    const scope = and(
      inArray(lesson.id, unique),
      ne(lesson.status, 'canceled'),
      ownedSections === 'all' ? undefined : inArray(lesson.sectionId, ownedSections),
    )
    // and() is typed `SQL | undefined` (in the general case every operand could be undefined). The first
    // two operands here are always defined, so it can never actually be undefined — enforce that invariant
    // at runtime with a guard instead of a `!` that only silences the type. A missing scope would be an
    // unfiltered UPDATE, so fail closed rather than let updateWhereMany run without a WHERE.
    if (!scope) throw new Error('cancelLessonsAction: empty scope')
    const rows = await forTenant(ctx).updateWhereMany(lesson, scope, { status: 'canceled' })
    revalidatePath('/dashboard/schedule')
    return { ok: true, canceled: rows.length }
  } catch (e) {
    // CWE-209: only KNOWN user-facing errors (Business/Conflict/Auth) are forwarded; an unexpected DB
    // fault is logged server-side and collapsed to the fallback, never leaked as raw .message.
    return toPortalActionError(e, '删除失败')
  }
}

const addSessionsSchema = z
  .object({
    sectionId: z.string().trim().min(1),
    freq: z.enum(RECURRENCE_FREQS),
    byDays: z.array(z.enum(WEEKDAYS as [Weekday, ...Weekday[]])).optional(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式 YYYY-MM-DD'),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式 YYYY-MM-DD'),
    startTime: z.string().regex(/^\d{2}:\d{2}$/, '时间格式 HH:mm'),
    durationMinutes: z.coerce
      .number()
      .int()
      .min(15, '时长至少 15 分钟')
      .max(480, '时长最多 480 分钟'),
  })
  .refine((d) => d.endDate >= d.startDate, {
    message: '结束日期不能早于开始日期',
    path: ['endDate'],
  })
  // weekly / biweekly need at least one weekday; daily / monthly ignore byDays.
  .refine((d) => !['WEEKLY', 'BIWEEKLY'].includes(d.freq) || (d.byDays?.length ?? 0) > 0, {
    message: '请至少选择一个星期几',
    path: ['byDays'],
  })

export type AddSessionsResult =
  { ok: true; inserted: number; conflicts: number } | { ok: false; error: string }

// 排课 → 添加课节. Expand a user-chosen recurrence over a date period into lesson rows. Returns as DATA
// ({ok,error}) — production redacts thrown Server Action errors (React #441).
export async function addSessionsAction(
  input: z.input<typeof addSessionsSchema>,
): Promise<AddSessionsResult> {
  const ctx = await requireAuthContext()
  const parsed = addSessionsSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? '输入有误' }
  const data = parsed.data
  try {
    requirePermission(ctx, { lesson: ['create'] })
    // 工作流 E: a section-scoped teacher may only add sessions to a section they teach.
    if (!(await actorOwnsSectionById(ctx, data.sectionId)))
      return { ok: false, error: '无权在该班级排课' }
    const res = await addSessionsCore(ctx, data.sectionId, {
      freq: data.freq,
      byDays: data.byDays,
      startDate: data.startDate,
      endDate: data.endDate,
      startTime: data.startTime,
      durationMinutes: data.durationMinutes,
    })
    revalidatePath('/dashboard/schedule')
    return { ok: true, inserted: res.inserted, conflicts: res.conflicts }
  } catch (e) {
    // CWE-209: forward only KNOWN user-facing errors (Business/Conflict/Auth); everything else —
    // expandRecurrence's window/occurrence caps AND any unexpected DB fault — is logged and collapsed to
    // the generic fallback so no internal .message leaks. The client already bounds the date range.
    return toPortalActionError(e, '添加课节失败')
  }
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
  // PERF4: cancel every future, non-canceled lesson of the section in ONE atomic UPDATE (was a select
  // + per-row update loop, N+1). updateWhereMany always AND-s the tenant scope, so this stays scoped to
  // ctx.tenantId; the single statement also removes the TOCTOU window the select-then-loop had.
  const rows = await forTenant(ctx).updateWhereMany(
    lesson,
    // all three operands are defined, so and() is never undefined here (updateWhereMany requires SQL)
    and(
      eq(lesson.sectionId, sectionId),
      ne(lesson.status, 'canceled'),
      gte(lesson.startAt, new Date()),
    )!,
    { status: 'canceled' },
  )
  revalidatePath('/dashboard/schedule')
  return { canceled: rows.length }
}
