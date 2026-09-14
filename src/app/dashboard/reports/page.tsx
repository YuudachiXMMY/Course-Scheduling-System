import { requireAuthContext } from '@/auth/context'
import { requirePermission } from '@/auth/authorize'
import { getReportsPageData } from './data'
import ReportPanel from './report-panel'

export default async function ReportsPage() {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { report: ['list'] })
  const { reports, students } = await getReportsPageData(ctx)

  return (
    <section className="flex flex-col gap-6">
      <h2 className="text-lg font-semibold">进度报告</h2>
      <ReportPanel students={students} reports={reports} />
    </section>
  )
}
