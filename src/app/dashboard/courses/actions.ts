'use server'

import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { DateTime } from 'luxon'
import { requireAuthContext, type AuthContext } from '@/auth/context'
import { requirePermission } from '@/auth/authorize'
import { forTenant } from '@/db/tenant'
import { course, classSection, sectionMeeting } from '@/db/schema'
import { buildWeeklyRrule, type Weekday, WEEKDAYS } from '@/lib/rrule-build'
import { materializeSection } from '@/lib/materialize'

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
  return (await forTenant(ctx).select(course)) as Course[]
}

export async function createCourse(input: CourseInput) {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { course: ['create'] })
  const data = courseSchema.parse(input)
  const [row] = await forTenant(ctx).insert(course, {
    title: data.title,
    subject: data.subject,
    level: data.level,
    defaultDurationMinutes: data.defaultDurationMinutes,
  })
  revalidatePath('/dashboard/courses')
  return row
}

export async function updateCourse(id: string, input: CourseInput) {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { course: ['update'] })
  const data = courseSchema.parse(input)
  const [row] = await forTenant(ctx).update(course, id, {
    title: data.title,
    subject: data.subject,
    level: data.level,
    defaultDurationMinutes: data.defaultDurationMinutes,
  })
  revalidatePath('/dashboard/courses')
  return row
}

export async function archiveCourse(id: string) {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { course: ['update'] })
  const [row] = await forTenant(ctx).update(course, id, { isArchived: true })
  revalidatePath('/dashboard/courses')
  return row
}

/* ---------- Section ---------- */

export async function listSections(): Promise<ClassSection[]> {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { course: ['list'] })
  return (await forTenant(ctx).select(classSection)) as ClassSection[]
}

const weekdayEnum = z.enum(WEEKDAYS as [Weekday, ...Weekday[]])

// One meeting slot: a weekday + wall-clock time + duration. A section can have several (different
// times on different days), which a single RRULE cannot express — see src/db/schema/course.ts.
const meetingSchema = z.object({
  byDay: weekdayEnum,
  startTime: z.string().regex(/^\d{2}:\d{2}$/, '时间格式 HH:mm'),
  durationMinutes: z.coerce.number().int().min(15).max(480),
})

const sectionSchema = z.object({
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
  timezone: z.string().trim().default('Asia/Shanghai'),
  defaultLocation: z.string().trim().max(200).optional(),
  defaultMeetingUrl: z.string().trim().max(500).optional(),
})
export type SectionInput = z.input<typeof sectionSchema>
type ParsedSection = z.infer<typeof sectionSchema>

// createSection returns validation problems as data instead of throwing: Next.js redacts thrown
// Server Action error messages in production (they surface as the opaque "Minified React error
// #441"), so any Zod field failure must be RETURNED to reach the client with a helpful message.
export type CreateSectionResult =
  | { ok: true; section: ClassSection }
  | { ok: false; error: string }

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
// tenant table). N is tiny (a handful of slots), so per-row select/delete/insert is fine.
async function replaceMeetings(
  ctx: AuthContext,
  sectionId: string,
  meetings: ParsedSection['meetings'],
) {
  const existing = (await forTenant(ctx).select(
    sectionMeeting,
    eq(sectionMeeting.sectionId, sectionId),
  )) as SectionMeeting[]
  for (const m of existing) await forTenant(ctx).delete(sectionMeeting, m.id)
  for (const m of meetings) {
    await forTenant(ctx).insert(sectionMeeting, {
      sectionId,
      byDay: m.byDay,
      startTime: m.startTime,
      durationMinutes: m.durationMinutes,
    })
  }
}

export async function listSectionMeetings(sectionId: string): Promise<SectionMeeting[]> {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { course: ['read'] })
  return (await forTenant(ctx).select(
    sectionMeeting,
    eq(sectionMeeting.sectionId, sectionId),
  )) as SectionMeeting[]
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

  const [row] = await forTenant(ctx).insert(classSection, {
    courseId: data.courseId,
    ...sectionRecurrenceColumns(data),
  })
  await replaceMeetings(ctx, (row as ClassSection).id, data.meetings)
  revalidatePath('/dashboard/courses')
  return { ok: true, section: row as ClassSection }
}

export async function updateSection(
  id: string,
  input: SectionInput,
): Promise<CreateSectionResult> {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { course: ['update'] })
  const parsed = sectionSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? '输入有误' }
  }
  const data = parsed.data

  const [row] = await forTenant(ctx).update(classSection, id, sectionRecurrenceColumns(data))
  if (!row) return { ok: false, error: '班级不存在或不属于当前机构' }
  await replaceMeetings(ctx, id, data.meetings)
  revalidatePath('/dashboard/courses')
  return { ok: true, section: row as ClassSection }
}

// Materialize AFTER the section row is committed. Reuses src/lib/materialize (Phase-6 MCP shares it).
export async function materializeSectionAction(sectionId: string) {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { lesson: ['create'] })
  const res = await materializeSection(ctx, sectionId)
  revalidatePath('/dashboard/schedule')
  return res
}
