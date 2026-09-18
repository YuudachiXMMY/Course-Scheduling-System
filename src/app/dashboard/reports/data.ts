import 'server-only'
import { and, eq, inArray } from 'drizzle-orm'
import { forTenant } from '@/db/tenant'
import { studentIdsForActor } from '@/auth/scope'
import { progressReport, student } from '@/db/schema'
import type { AuthContext } from '@/auth/context'

// Serializable shapes for the client panel (Dates → ISO strings).
export interface ReportRow {
  id: string
  studentId: string
  title: string | null
  periodStart: string | null
  periodEnd: string | null
  status: 'draft' | 'approved'
  narrative: string | null
  createdAt: string
}
export interface StudentOption {
  id: string
  name: string
}

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null)

export async function getReportsPageData(
  ctx: AuthContext,
): Promise<{ reports: ReportRow[]; students: StudentOption[] }> {
  // 工作流 E: a teacher's report list + student picker are confined to their roster (students actively
  // enrolled in the sections they teach); whole-tenant staff see everything. Empty scope → nothing.
  const scope = await studentIdsForActor(ctx)
  if (scope !== 'all' && scope.length === 0) return { reports: [], students: [] }
  const rows = await forTenant(ctx).select(
    progressReport,
    scope === 'all' ? undefined : inArray(progressReport.studentId, scope),
  )
  const students = await forTenant(ctx).select(
    student,
    scope === 'all'
      ? eq(student.status, 'active')
      : and(eq(student.status, 'active'), inArray(student.id, scope)),
  )

  const reports: ReportRow[] = rows
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

  return { reports, students: students.map((s) => ({ id: s.id, name: s.name })) }
}
