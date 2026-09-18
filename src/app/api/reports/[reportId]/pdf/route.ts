import { requireAuthContext } from '@/auth/context'
import { requirePermission } from '@/auth/authorize'
import { authErrorResponse } from '@/app/api/_auth'
import { getReportViewModel } from '@/lib/report-core'
import { renderReportPdf } from '@/lib/report-pdf'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const stamp = () => new Date().toISOString().slice(0, 16).replace('T', ' ')

// P5: authenticated single-report PDF. Numbers rendered from the DB (getReportViewModel);
// narrative frozen on the row. Works for draft (preview) and approved.
export async function GET(_req: Request, { params }: { params: Promise<{ reportId: string }> }) {
  try {
    const ctx = await requireAuthContext()
    requirePermission(ctx, { report: ['read'] })
    const { reportId } = await params
    const model = await getReportViewModel(ctx, reportId, stamp())
    if (!model) return new Response('Not found', { status: 404 })

    const pdf = await renderReportPdf(model)
    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="report-${reportId}.pdf"`,
        'Cache-Control': 'private, no-store',
      },
    })
  } catch (e) {
    // EH3: AuthError → 401/403 (not 500); re-throw everything else so genuine faults still 500.
    const r = authErrorResponse(e)
    if (r) return r
    throw e
  }
}
