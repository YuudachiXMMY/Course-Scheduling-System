import 'server-only'
import { and, eq, inArray } from 'drizzle-orm'
import { forTenant } from '@/db/tenant'
import { requireConsent, resolveLinkedStudentIds } from '@/auth/portal'
import { progressReport, student, classSection, course } from '@/db/schema'
import { sectionDisplayName } from '@/lib/ical-feed'
import { WHOLE_SCHEDULE_KEY } from './constants'
import type { AuthContext } from '@/auth/context'

// Serializable shapes for the client list (Dates → ISO date strings, so the RSC → client boundary
// never ships a Date). Mirrors dashboard/reports/data.ts's ReportRow but is scoped to the portal:
// approved-only + row-level scope by resolveLinkedStudentIds.
export interface PortalReportRow {
  id: string
  title: string | null
  studentId: string
  studentName: string
  sectionId: string | null
  sectionLabel: string // '全程' when the report spans the whole schedule (sectionId === null)
  periodStart: string | null
  periodEnd: string | null
  narrative: string | null
  createdAt: string
}
export interface PortalStudentOption {
  id: string
  name: string
}
export interface PortalSectionOption {
  id: string // WHOLE_SCHEDULE_KEY represents the whole-schedule (null section) bucket
  label: string
}
export interface PortalReportsData {
  reports: PortalReportRow[]
  students: PortalStudentOption[]
  sections: PortalSectionOption[]
}

const WHOLE_SCHEDULE_LABEL = '全程'
// WHOLE_SCHEDULE_KEY lives in ./constants (server-import-free) so reports-list.tsx (a Client Component)
// can import the value without pulling this `server-only` module into the client bundle.
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null)

// Portal report loader (Phase 5). Faces UNTRUSTED users, so every read is row-scoped to the
// student rows this user is linked to (resolveLinkedStudentIds — parent → their children, student →
// self), and ONLY approved reports are exposed (drafts are staff-internal). Consent is re-checked
// here independently of the layout's ConsentGate (which is UX-level only).
export async function getPortalReports(ctx: AuthContext): Promise<PortalReportsData> {
  await requireConsent(ctx)

  const ids = await resolveLinkedStudentIds(ctx)
  // Empty scope → `inArray([])` is invalid SQL; early-return so we never emit it.
  if (ids.length === 0) return { reports: [], students: [], sections: [] }

  const rows = await forTenant(ctx).select(
    progressReport,
    and(inArray(progressReport.studentId, ids), eq(progressReport.status, 'approved')),
  )

  const students = await forTenant(ctx).select(student, inArray(student.id, ids))
  const nameOf = new Map(students.map((s) => [s.id, s.name]))

  // Resolve section → "课程名 · 班级名" for the sections actually referenced by these reports.
  // forTenant().select() is single-table (no join), so fetch sections then their courses and
  // compose via sectionDisplayName — the same label the schedule card / iCal use.
  const sectionIds = [...new Set(rows.map((r) => r.sectionId).filter((s): s is string => !!s))]
  const labelBySection = new Map<string, string>()
  if (sectionIds.length > 0) {
    const secs = await forTenant(ctx).select(classSection, inArray(classSection.id, sectionIds))
    const courseIds = [...new Set(secs.map((s) => s.courseId))]
    const courses =
      courseIds.length > 0
        ? await forTenant(ctx).select(course, inArray(course.id, courseIds))
        : []
    const titleOf = new Map(courses.map((c) => [c.id, c.title]))
    for (const s of secs) {
      labelBySection.set(s.id, sectionDisplayName(titleOf.get(s.courseId) ?? '', s.name))
    }
  }

  const reports: PortalReportRow[] = rows
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map((r) => ({
      id: r.id,
      title: r.title,
      studentId: r.studentId,
      studentName: nameOf.get(r.studentId) ?? r.studentId,
      sectionId: r.sectionId,
      sectionLabel: r.sectionId
        ? (labelBySection.get(r.sectionId) ?? r.sectionId)
        : WHOLE_SCHEDULE_LABEL,
      periodStart: day(r.periodStart),
      periodEnd: day(r.periodEnd),
      narrative: r.narrative,
      createdAt: r.createdAt.toISOString().slice(0, 10),
    }))

  // Filter options derived from the linked students and the sections that actually appear in the
  // reports (deduped). A WHOLE_SCHEDULE_KEY bucket represents whole-schedule (null section) reports
  // when present — non-empty so it never collides with the "全部课程" show-all sentinel.
  const studentOptions: PortalStudentOption[] = students.map((s) => ({ id: s.id, name: s.name }))
  const sectionOptions: PortalSectionOption[] = []
  const seen = new Set<string>()
  for (const r of reports) {
    const key = r.sectionId ?? WHOLE_SCHEDULE_KEY
    if (seen.has(key)) continue
    seen.add(key)
    sectionOptions.push({ id: key, label: r.sectionLabel })
  }

  return { reports, students: studentOptions, sections: sectionOptions }
}
