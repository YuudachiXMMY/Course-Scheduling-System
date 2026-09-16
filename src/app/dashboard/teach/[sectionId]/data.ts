import 'server-only'
import { and, eq, gte, inArray, lt, ne } from 'drizzle-orm'
import { DateTime } from 'luxon'
import { notFound } from 'next/navigation'
import { forTenant } from '@/db/tenant'
import { classSection, course, enrollment, student, lesson, progressReport } from '@/db/schema'
import type { AuthContext } from '@/auth/context'
import type { ReportRow } from '@/app/dashboard/reports/data'

// Server-only per-section loaders for the workspace. All reads go through forTenant(ctx) (the only
// sanctioned tenant-scoped path — see src/db/tenant.ts). No new 'use server' surface; mutations reuse
// the existing course/section/enrollment/lesson/report Server Actions.

type Section = typeof classSection.$inferSelect
type Course = typeof course.$inferSelect

export interface SectionLesson {
  id: string
  title: string
  start: string // ISO UTC
  end: string // ISO UTC
  status: 'scheduled' | 'completed' | 'canceled'
  location: string | null
  meetingUrl: string | null
  isPast: boolean // computed server-side (client render must stay pure — no Date.now())
}

export interface SectionStudent {
  id: string
  name: string
}

// The `[sectionId]` segment guard: a stale / cross-tenant id resolves to teach/not-found.tsx (which
// renders inside teach/layout.tsx, so the rail is preserved).
export async function getSectionHeader(
  ctx: AuthContext,
  id: string,
): Promise<{ section: Section; course: Course }> {
  const section = (await forTenant(ctx).findById(classSection, id)) as Section | null
  if (!section) notFound()
  const parent = (await forTenant(ctx).findById(course, section.courseId)) as Course | null
  if (!parent) notFound()
  return { section, course: parent }
}

export async function getSectionRoster(ctx: AuthContext, id: string): Promise<SectionStudent[]> {
  const enrolls = (await forTenant(ctx).select(
    enrollment,
    and(eq(enrollment.sectionId, id), eq(enrollment.status, 'active')),
  )) as (typeof enrollment.$inferSelect)[]
  const ids = [...new Set(enrolls.map((e) => e.studentId))]
  if (ids.length === 0) return []
  const students = (await forTenant(ctx).select(
    student,
    inArray(student.id, ids),
  )) as (typeof student.$inferSelect)[]
  return students
    .map((s) => ({ id: s.id, name: s.name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh'))
}

// Window INCLUDES past lessons (term window, or now-60d…now+120d) so attendance/notes on already-held
// lessons stay reachable from the 排课 tab — a future-only list would strand the drawer's retrospective
// features. Canceled tombstones are hidden.
export async function getSectionLessons(ctx: AuthContext, id: string): Promise<SectionLesson[]> {
  const section = (await forTenant(ctx).findById(classSection, id)) as Section | null
  const now = DateTime.now().setZone('Asia/Shanghai')
  const from = section?.termStartDate ?? now.minus({ days: 60 }).toUTC().toJSDate()
  const to = section?.termEndDate ?? now.plus({ days: 120 }).toUTC().toJSDate()
  const rows = (await forTenant(ctx).select(
    lesson,
    and(
      eq(lesson.sectionId, id),
      ne(lesson.status, 'canceled'),
      gte(lesson.startAt, from),
      lt(lesson.startAt, to),
    ),
  )) as (typeof lesson.$inferSelect)[]
  const parentTitle = section
    ? (((await forTenant(ctx).findById(course, section.courseId)) as Course | null)?.title ?? null)
    : null
  const nowMs = Date.now()
  return rows
    .sort((a, b) => a.startAt.getTime() - b.startAt.getTime())
    .map((r) => ({
      id: r.id,
      title: r.title ?? parentTitle ?? '课节',
      start: r.startAt.toISOString(),
      end: r.endAt.toISOString(),
      status: r.status,
      location: r.location,
      meetingUrl: r.meetingUrl,
      isPast: r.endAt.getTime() < nowMs,
    }))
}

// Reports are student+period scoped (a student may sit in several sections); we surface the reports of
// THIS section's active roster. `report.sectionId` is nullable provenance — we filter by roster
// membership, not by that column, so a student's report shows under every section they're enrolled in.
export async function getSectionReports(ctx: AuthContext, id: string): Promise<ReportRow[]> {
  const roster = await getSectionRoster(ctx, id)
  const rosterIds = new Set(roster.map((r) => r.id))
  if (rosterIds.size === 0) return []
  const rows = (await forTenant(ctx).select(
    progressReport,
  )) as (typeof progressReport.$inferSelect)[]
  const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null)
  return rows
    .filter((r) => rosterIds.has(r.studentId))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map((r) => ({
      id: r.id,
      studentId: r.studentId,
      title: r.title,
      periodStart: day(r.periodStart),
      periodEnd: day(r.periodEnd),
      status: r.status,
      narrative: r.narrative,
      createdAt: r.createdAt.toISOString().slice(0, 10),
    }))
}
