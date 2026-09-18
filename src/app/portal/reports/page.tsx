import { requireAuthContext } from '@/auth/context'
import { requirePermission } from '@/auth/authorize'
import { getPortalReports } from './data'
import ReportsList from './reports-list'

// Portal progress-report page (Phase 5). Wrapped by portal/layout.tsx (role gate + ConsentGate);
// data-layer requireConsent + row-level scope enforce the real privacy boundary.
export default async function PortalReportsPage() {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { report: ['read'] })
  const data = await getPortalReports(ctx)
  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">进度报告</h2>
      <ReportsList {...data} />
    </section>
  )
}
