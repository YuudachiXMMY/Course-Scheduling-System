import 'server-only'
import { eq } from 'drizzle-orm'
import { forTenant } from '@/db/tenant'
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
  const rows = (await forTenant(ctx).select(
    progressReport,
  )) as (typeof progressReport.$inferSelect)[]
  const students = (await forTenant(ctx).select(
    student,
    eq(student.status, 'active'),
  )) as (typeof student.$inferSelect)[]

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
