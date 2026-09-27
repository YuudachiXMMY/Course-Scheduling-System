'use server'

import { z } from 'zod'
import { and, eq, inArray } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { DateTime } from 'luxon'
import { requireAuthContext, AuthError, type AuthContext } from '@/auth/context'
import { requirePermission } from '@/auth/authorize'
import { actorOwnsSectionById, sectionIdsForActor, isWholeTenantActor } from '@/auth/scope'
import { db } from '@/db'
import { forTenant } from '@/db/tenant'
import { course, classSection, sectionMeeting, sectionTeacher, member } from '@/db/schema'
import { buildWeeklyRrule, type Weekday, WEEKDAYS } from '@/lib/rrule-build'
import { materializeSection } from '@/lib/materialize'
import { toPortalActionError } from '@/lib/errors'
import { APP_TIME_ZONE } from '@/lib/timezone'

export type Course = typeof course.$inferSelect
export type ClassSection = typeof classSection.$inferSelect
export type SectionMeeting = typeof sectionMeeting.$inferSelect

/* ---------- Course ---------- */

const courseSchema = z.object({
  title: z.string().trim().min(1, '课程名称不能为空').max(100),
  subject: z.string().trim().max(50).optional(),
  level: z.string().trim().max(50).optional(),
  defaultDurationMinutes: z.coerce.number().int().min(15).max(480).default(60),
})
export type CourseInput = z.input<typeof courseSchema>

export async function listCourses(): Promise<Course[]> {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { course: ['list'] })
  return await forTenant(ctx).select(course)
}

// Return validation problems as DATA instead of throwing (mirrors createSection): thrown Server
// Action errors are redacted by Next.js in production and surface as the cryptic "Minified React
// error #441" / a failed RSC refresh ("This page couldn't load"). Returning the message reaches the
// client intact so a bad field shows helpful feedback instead of crashing the courses page.
export type CourseResult = { ok: true; course: Course } | { ok: false; error: string }

export async function createCourse(input: CourseInput): Promise<CourseResult> {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { course: ['create'] })
  const parsed = courseSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? '输入有误' }
  }
  const data = parsed.data
  const [row] = await forTenant(ctx).insert(course, {
    title: data.title,
    subject: data.subject,
    level: data.level,
    defaultDurationMinutes: data.defaultDurationMinutes,
  })
  revalidatePath('/dashboard/courses')
  return { ok: true, course: row }
}

export async function updateCourse(id: string, input: CourseInput): Promise<CourseResult> {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { course: ['update'] })
  const parsed = courseSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? '输入有误' }
  }
  const data = parsed.data
  const [row] = await forTenant(ctx).update(course, id, {
    title: data.title,
    subject: data.subject,
    level: data.level,
    defaultDurationMinutes: data.defaultDurationMinutes,
  })
  if (!row) return { ok: false, error: '课程不存在或不属于当前机构' }
  revalidatePath('/dashboard/courses')
  return { ok: true, course: row }
}

// 归档/恢复同样返回判别式 {ok,error}（镜像 create/updateCourse 与 portal-actions）：抛出的 Server
// Action 错误在生产会被 Next.js 脱敏成不透明的 "React error #441"，因此把权限失败（如 assistant
// 越权点击的 FORBIDDEN）与库层错误都 catch 后作为数据返回，中文文案才能到达客户端内联提示而非静默失败。
export async function archiveCourse(id: string): Promise<CourseResult> {
  const ctx = await requireAuthContext()
  try {
    requirePermission(ctx, { course: ['update'] })
    const [row] = await forTenant(ctx).update(course, id, { isArchived: true })
    if (!row) return { ok: false, error: '课程不存在或不属于当前机构' }
    revalidatePath('/dashboard/courses')
    return { ok: true, course: row }
  } catch (e) {
    console.error('archiveCourse failed', e)
    if (e instanceof AuthError) return { ok: false, error: '无权归档该课程' }
    return { ok: false, error: e instanceof Error ? e.message : '归档失败' }
  }
}

// Un-archive: mirror of archiveCourse so an archived course template can be brought back.
export async function restoreCourse(id: string): Promise<CourseResult> {
  const ctx = await requireAuthContext()
  try {
    requirePermission(ctx, { course: ['update'] })
    const [row] = await forTenant(ctx).update(course, id, { isArchived: false })
    if (!row) return { ok: false, error: '课程不存在或不属于当前机构' }
    revalidatePath('/dashboard/courses')
    return { ok: true, course: row }
  } catch (e) {
    console.error('restoreCourse failed', e)
    if (e instanceof AuthError) return { ok: false, error: '无权恢复该课程' }
    return { ok: false, error: e instanceof Error ? e.message : '恢复失败' }
  }
}

/* ---------- Section ---------- */

export async function listSections(): Promise<ClassSection[]> {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { course: ['list'] })
  // 工作流 E: a teacher sees only the sections they teach; owner/admin/assistant/superadmin see all.
  const scope = await sectionIdsForActor(ctx)
  if (scope !== 'all' && scope.length === 0) return []
  // DB4: exclude soft-deleted (archived) sections from the browse list. Direct-by-id reads
  // (findById) intentionally keep returning archived rows so they can still be managed/unarchived.
  const notArchived = eq(classSection.isArchived, false)
  return await forTenant(ctx).select(
    classSection,
    scope === 'all' ? notArchived : and(notArchived, inArray(classSection.id, scope)),
  )
}

const weekdayEnum = z.enum(WEEKDAYS as [Weekday, ...Weekday[]])

// One meeting slot: a weekday + wall-clock time + duration. A section can have several (different
// times on different days), which a single RRULE cannot express — see src/db/schema/course.ts.
const meetingSchema = z.object({
  byDay: weekdayEnum,
  startTime: z.string().regex(/^\d{2}:\d{2}$/, '时间格式 HH:mm'),
  durationMinutes: z.coerce.number().int().min(15).max(480),
})

const sectionSchema = z
  .object({
    courseId: z.string().trim().min(1),
    name: z.string().trim().max(100).optional(),
    teacherId: z.string().trim().min(1, '必须指定教师'),
    capacity: z.coerce.number().int().min(1, '容量至少 1').max(15, '容量最多 15'),
    meetings: z.array(meetingSchema).min(1, '至少添加一个上课时段'),
    termStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式 YYYY-MM-DD'),
    termEndDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    timezone: z.string().trim().default(APP_TIME_ZONE),
    defaultLocation: z.string().trim().max(200).optional(),
    // M2: only accept http(s) URLs so a link can never carry a javascript:/data: scheme if it's ever
    // rendered as an href downstream.
    defaultMeetingUrl: z
      .string()
      .trim()
      .max(500)
      .regex(/^https?:\/\//, '网课链接需以 http:// 或 https:// 开头')
      .optional(),
  })
  // CR1: enforce termEndDate >= termStartDate ON THE SERVER (server actions are a public boundary; the
  // client-only guard in section-form.tsx:146 is bypassable). Mirrors createSchema's endAt>startAt rule
  // in schedule-core.ts. YYYY-MM-DD is lexically orderable, so compare as strings — no Date parsing. An
  // inverted term would otherwise build an RRULE UNTIL earlier than dtstart and materialize zero lessons.
  .refine((d) => !d.termEndDate || d.termEndDate >= d.termStartDate, {
    message: '学期结束日期不能早于开始日期',
    path: ['termEndDate'],
  })
export type SectionInput = z.input<typeof sectionSchema>
type ParsedSection = z.infer<typeof sectionSchema>

// createSection returns validation problems as data instead of throwing: Next.js redacts thrown
// Server Action error messages in production (they surface as the opaque "Minified React error
// #441"), so any Zod field failure must be RETURNED to reach the client with a helpful message.
export type CreateSectionResult = { ok: true; section: ClassSection } | { ok: false; error: string }

// Build recurrenceDtstart as the wall-clock (term start date + start time) in the section's zone.
function computeDtstart(termStartDate: string, startTime: string, zone: string): Date {
  const [y, mo, d] = termStartDate.split('-').map(Number)
  const [hh, mm] = startTime.split(':').map(Number)
  return DateTime.fromObject({ year: y, month: mo, day: d, hour: hh, minute: mm }, { zone })
    .toUTC()
    .toJSDate()
}

// Derive the classSection recurrence columns from the parsed input. The RRULE (all distinct
// weekdays) + first-meeting dtstart are kept for display / iCal / the legacy no-meeting fallback;
// the authoritative per-slot times live in sectionMeeting rows (written by replaceMeetings).
function sectionRecurrenceColumns(data: ParsedSection) {
  const until = data.termEndDate
    ? DateTime.fromISO(`${data.termEndDate}T23:59:59`, { zone: data.timezone }).toUTC().toJSDate()
    : undefined
  const uniqueDays = [...new Set(data.meetings.map((m) => m.byDay))] as Weekday[]
  const first = data.meetings[0]
  return {
    name: data.name,
    teacherId: data.teacherId,
    capacity: data.capacity,
    termStartDate: new Date(`${data.termStartDate}T00:00:00Z`),
    termEndDate: data.termEndDate ? new Date(`${data.termEndDate}T00:00:00Z`) : null,
    rrule: buildWeeklyRrule({ byDays: uniqueDays, until }),
    recurrenceDtstart: computeDtstart(data.termStartDate, first.startTime, data.timezone),
    recurrenceTimezone: data.timezone,
    defaultDurationMinutes: first.durationMinutes,
    defaultLocation: data.defaultLocation ?? null,
    defaultMeetingUrl: data.defaultMeetingUrl ?? null,
  }
}

// Replace the section's meeting rows wholesale (stay on the forTenant spine: no raw db.* on a
// tenant table). N is tiny (a handful of slots), so per-row select/insert/delete is fine.
// M1: the spine has no transaction, so INSERT the new rows BEFORE deleting the old ids. If an insert
// throws mid-way the old slots are still intact (no "section with zero meetings" window); the worst
// case is a few duplicate rows rather than losing the section's schedule entirely.
async function replaceMeetings(
  ctx: AuthContext,
  sectionId: string,
  meetings: ParsedSection['meetings'],
) {
  const existing = await forTenant(ctx).select(
    sectionMeeting,
    eq(sectionMeeting.sectionId, sectionId),
  )
  for (const m of meetings) {
    await forTenant(ctx).insert(sectionMeeting, {
      sectionId,
      byDay: m.byDay,
      startTime: m.startTime,
      durationMinutes: m.durationMinutes,
    })
  }
  for (const m of existing) await forTenant(ctx).delete(sectionMeeting, m.id)
}

export async function listSectionMeetings(sectionId: string): Promise<SectionMeeting[]> {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { course: ['read'] })
  // 工作流 E: mirror updateSection/materializeSectionAction — a section-scoped teacher may only read the
  // weekly schedule of a section they teach, not any same-tenant section by guessed id.
  if (!(await actorOwnsSectionById(ctx, sectionId))) return []
  return await forTenant(ctx).select(sectionMeeting, eq(sectionMeeting.sectionId, sectionId))
}

export async function createSection(input: SectionInput): Promise<CreateSectionResult> {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { course: ['create'] })
  const parsed = sectionSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? '输入有误' }
  }
  const data = parsed.data

  // courseId must belong to this tenant (composite FK enforces it too, but check for a clean error).
  const parent = await forTenant(ctx).findById(course, data.courseId)
  if (!parent) return { ok: false, error: '课程不存在或不属于当前机构' }

  // B8: never trust the client-supplied teacherId. classSection.teacherId has no DB FK and drives
  // sectionIdsForActor, so a section-scoped teacher could otherwise plant a section under a colleague's
  // id (mirrors updateSection's H1, which strips teacherId on edit). Force it to themselves; a
  // whole-tenant actor may assign a DIFFERENT teacher, but only a real member of this org.
  if (!isWholeTenantActor(ctx)) {
    data.teacherId = ctx.userId
  } else if (data.teacherId !== ctx.userId) {
    const [m] = await db
      .select({ id: member.id })
      .from(member)
      .where(and(eq(member.userId, data.teacherId), eq(member.organizationId, ctx.tenantId)))
      .limit(1)
    if (!m) return { ok: false, error: '指定的教师不属于当前机构' }
  }

  const [row] = await forTenant(ctx).insert(classSection, {
    courseId: data.courseId,
    ...sectionRecurrenceColumns(data),
  })
  await replaceMeetings(ctx, row.id, data.meetings)
  // 多教师: seed the access set with the primary teacher so they can open the section immediately.
  // section_teacher is the authoritative access set (src/auth/scope.ts); classSection.teacherId (set via
  // sectionRecurrenceColumns) is just the primary. teacherId was validated as an org member above (B8).
  await forTenant(ctx).insert(sectionTeacher, { sectionId: row.id, userId: data.teacherId })
  revalidatePath('/dashboard/courses')
  return { ok: true, section: row }
}

// EDIT no longer touches the recurrence grid. 上课时段 is an INITIALIZATION-only input (used once at
// createSection to seed the sectionMeeting grid + first materialize); after that, sessions are managed
// via 排课 → 添加课节 / 多选删除. So the edit form carries NO meetings, and updateSection updates only the
// scalar fields — it never rewrites rrule/dtstart/meetings nor wipes future lessons. teacherId is also
// never reassigned here (H1): the form has no teacher picker.
const sectionEditSchema = z
  .object({
    name: z.string().trim().max(100).optional(),
    capacity: z.coerce.number().int().min(1, '容量至少 1').max(15, '容量最多 15'),
    termStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式 YYYY-MM-DD'),
    termEndDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    timezone: z.string().trim().default(APP_TIME_ZONE),
    defaultLocation: z.string().trim().max(200).optional(),
    defaultMeetingUrl: z
      .string()
      .trim()
      .max(500)
      .regex(/^https?:\/\//, '网课链接需以 http:// 或 https:// 开头')
      .optional(),
  })
  .refine((d) => !d.termEndDate || d.termEndDate >= d.termStartDate, {
    message: '学期结束日期不能早于开始日期',
    path: ['termEndDate'],
  })
export type SectionEditInput = z.input<typeof sectionEditSchema>

export async function updateSection(
  id: string,
  input: SectionEditInput,
): Promise<CreateSectionResult> {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { course: ['update'] })
  // 工作流 E: a section-scoped teacher may only edit a section they teach. Checked BEFORE parse so an
  // unowned section never leaks validation detail. Whole-tenant staff bypass via actorOwnsSectionById.
  if (!(await actorOwnsSectionById(ctx, id))) return { ok: false, error: '无权修改该班级' }

  const parsed = sectionEditSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? '输入有误' }
  }
  const data = parsed.data

  const [row] = await forTenant(ctx).update(classSection, id, {
    name: data.name,
    capacity: data.capacity,
    termStartDate: new Date(`${data.termStartDate}T00:00:00Z`),
    termEndDate: data.termEndDate ? new Date(`${data.termEndDate}T00:00:00Z`) : null,
    recurrenceTimezone: data.timezone,
    defaultLocation: data.defaultLocation ?? null,
    defaultMeetingUrl: data.defaultMeetingUrl ?? null,
  })
  if (!row) return { ok: false, error: '班级不存在或不属于当前机构' }
  revalidatePath('/dashboard/courses')
  // Term-date changes shift the 排课 read window (getSectionLessons), so refresh the calendar too.
  revalidatePath('/dashboard/schedule')
  return { ok: true, section: row }
}

// Materialize AFTER the section row is committed. Reuses src/lib/materialize (Phase-6 MCP shares it).
export async function materializeSectionAction(sectionId: string) {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { lesson: ['create'] })
  // 工作流 E: a section-scoped teacher may only materialize lessons for a section they teach.
  if (!(await actorOwnsSectionById(ctx, sectionId))) throw new Error('无权生成该班级课节')
  const res = await materializeSection(ctx, sectionId)
  revalidatePath('/dashboard/schedule')
  return res
}

// Archived sections for the rail's「已归档班级」restore list. Mirrors listSections but returns ONLY the
// archived rows within the actor's scope, so a teacher sees only their own archived classes.
export async function listArchivedSections(): Promise<ClassSection[]> {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { course: ['list'] })
  const scope = await sectionIdsForActor(ctx)
  if (scope !== 'all' && scope.length === 0) return []
  const archived = eq(classSection.isArchived, true)
  return await forTenant(ctx).select(
    classSection,
    scope === 'all' ? archived : and(archived, inArray(classSection.id, scope)),
  )
}

// 班级归档/恢复 — mirror archiveCourse/restoreCourse (soft-delete via isArchived). Return the discriminated
// {ok,error} shape because thrown Server Action errors are redacted in production (React #441). Ownership
// is enforced (actorOwnsSectionById) so a teacher can only archive/restore a section they teach.
export type SectionResult = { ok: true; section: ClassSection } | { ok: false; error: string }

export async function archiveSection(id: string): Promise<SectionResult> {
  const ctx = await requireAuthContext()
  try {
    requirePermission(ctx, { course: ['update'] })
    if (!(await actorOwnsSectionById(ctx, id))) return { ok: false, error: '无权归档该班级' }
    const [row] = await forTenant(ctx).update(classSection, id, { isArchived: true })
    if (!row) return { ok: false, error: '班级不存在或不属于当前机构' }
    revalidatePath('/dashboard/courses')
    revalidatePath('/dashboard/teach')
    return { ok: true, section: row }
  } catch (e) {
    // CWE-209: ownership/permission denials already returned explicit messages above; here an AuthError
    // (RBAC) maps to a generic denial and any unexpected DB fault is logged + collapsed to the fallback,
    // never leaking a raw .message.
    return toPortalActionError(e, '归档失败')
  }
}

export async function restoreSection(id: string): Promise<SectionResult> {
  const ctx = await requireAuthContext()
  try {
    requirePermission(ctx, { course: ['update'] })
    if (!(await actorOwnsSectionById(ctx, id))) return { ok: false, error: '无权恢复该班级' }
    const [row] = await forTenant(ctx).update(classSection, id, { isArchived: false })
    if (!row) return { ok: false, error: '班级不存在或不属于当前机构' }
    revalidatePath('/dashboard/courses')
    revalidatePath('/dashboard/teach')
    return { ok: true, section: row }
  } catch (e) {
    // CWE-209: see archiveSection — explicit denials returned above; unexpected faults collapse to fallback.
    return toPortalActionError(e, '恢复失败')
  }
}
