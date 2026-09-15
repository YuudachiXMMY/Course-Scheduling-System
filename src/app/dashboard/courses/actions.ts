'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { DateTime } from 'luxon'
import { requireAuthContext } from '@/auth/context'
import { requirePermission } from '@/auth/authorize'
import { forTenant } from '@/db/tenant'
import { course, classSection } from '@/db/schema'
import { buildWeeklyRrule, type Weekday, WEEKDAYS } from '@/lib/rrule-build'
import { materializeSection } from '@/lib/materialize'

export type Course = typeof course.$inferSelect
export type ClassSection = typeof classSection.$inferSelect

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

const sectionSchema = z.object({
  courseId: z.string().trim().min(1),
  name: z.string().trim().max(100).optional(),
  teacherId: z.string().trim().min(1, '必须指定教师'),
  capacity: z.coerce.number().int().min(1, '容量至少 1').max(15, '容量最多 15'),
  byDays: z.array(weekdayEnum).min(1, '至少选择一个上课日'),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, '时间格式 HH:mm'),
  durationMinutes: z.coerce.number().int().min(15).max(480),
  termStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式 YYYY-MM-DD'),
  termEndDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  timezone: z.string().trim().default('Asia/Shanghai'),
})
export type SectionInput = z.input<typeof sectionSchema>

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

  const until = data.termEndDate
    ? DateTime.fromISO(`${data.termEndDate}T23:59:59`, { zone: data.timezone }).toUTC().toJSDate()
    : undefined
  const rrule = buildWeeklyRrule({ byDays: data.byDays as Weekday[], until })
  const dtstart = computeDtstart(data.termStartDate, data.startTime, data.timezone)

  const [row] = await forTenant(ctx).insert(classSection, {
    courseId: data.courseId,
    name: data.name,
    teacherId: data.teacherId,
    capacity: data.capacity,
    termStartDate: new Date(`${data.termStartDate}T00:00:00Z`),
    termEndDate: data.termEndDate ? new Date(`${data.termEndDate}T00:00:00Z`) : null,
    rrule,
    recurrenceDtstart: dtstart,
    recurrenceTimezone: data.timezone,
    defaultDurationMinutes: data.durationMinutes,
  })
  revalidatePath('/dashboard/courses')
  return { ok: true, section: row as ClassSection }
}

export async function updateSection(id: string, input: SectionInput) {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { course: ['update'] })
  const data = sectionSchema.parse(input)

  const until = data.termEndDate
    ? DateTime.fromISO(`${data.termEndDate}T23:59:59`, { zone: data.timezone }).toUTC().toJSDate()
    : undefined
  const rrule = buildWeeklyRrule({ byDays: data.byDays as Weekday[], until })
  const dtstart = computeDtstart(data.termStartDate, data.startTime, data.timezone)

  const [row] = await forTenant(ctx).update(classSection, id, {
    name: data.name,
    teacherId: data.teacherId,
    capacity: data.capacity,
    termStartDate: new Date(`${data.termStartDate}T00:00:00Z`),
    termEndDate: data.termEndDate ? new Date(`${data.termEndDate}T00:00:00Z`) : null,
    rrule,
    recurrenceDtstart: dtstart,
    recurrenceTimezone: data.timezone,
    defaultDurationMinutes: data.durationMinutes,
  })
  revalidatePath('/dashboard/courses')
  return row
}

// Materialize AFTER the section row is committed. Reuses src/lib/materialize (Phase-6 MCP shares it).
export async function materializeSectionAction(sectionId: string) {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { lesson: ['create'] })
  const res = await materializeSection(ctx, sectionId)
  revalidatePath('/dashboard/schedule')
  return res
}
