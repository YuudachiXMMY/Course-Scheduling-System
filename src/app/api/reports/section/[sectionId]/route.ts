import { ZipArchive } from 'archiver'
import { and, eq, inArray } from 'drizzle-orm'
import { requireAuthContext } from '@/auth/context'
import { requirePermission } from '@/auth/authorize'
import { forTenant } from '@/db/tenant'
import { classSection, enrollment, progressReport, student } from '@/db/schema'
import { getReportViewModel } from '@/lib/report-core'
import { renderReportPdf } from '@/lib/report-pdf'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const stamp = () => new Date().toISOString().slice(0, 16).replace('T', ' ')

// Sanitize a student name into a safe ZIP entry folder (mirror export/section/route.ts).
function safe(name: string): string {
  const cleaned = name.replace(/[/\\:*?"<>|]/g, '_').trim()
  return cleaned.length > 0 ? cleaned : 'student'
}

// P5: AUTHENTICATED batch export — one APPROVED report PDF per active-enrolled student in the
// section. Students without an approved report are skipped. Sequential loop (small-class scale).
export async function GET(_req: Request, { params }: { params: Promise<{ sectionId: string }> }) {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { report: ['read'] })
  const { sectionId } = await params

  const section = (await forTenant(ctx).findById(classSection, sectionId)) as
    typeof classSection.$inferSelect | null
  if (!section) return new Response('Not found', { status: 404 })

  const enrollments = (await forTenant(ctx).select(
    enrollment,
    and(eq(enrollment.sectionId, sectionId), eq(enrollment.status, 'active')),
  )) as (typeof enrollment.$inferSelect)[]
  const studentIds = [...new Set(enrollments.map((e) => e.studentId))]
  const students =
    studentIds.length === 0
      ? []
      : ((await forTenant(ctx).select(
          student,
          inArray(student.id, studentIds),
        )) as (typeof student.$inferSelect)[])

  // archiver@8 is ESM with named class exports; no .toBuffer() → collect chunks + concat on 'end'.
  const chunks: Buffer[] = []
  const zip = new ZipArchive({ zlib: { level: 9 } })
  zip.on('data', (c: Buffer) => chunks.push(c))
  const done = new Promise<Buffer>((res, rej) => {
    zip.on('end', () => res(Buffer.concat(chunks)))
    zip.on('error', rej)
  })

  const usedNames = new Map<string, number>()
  for (const s of students) {
    // Most-recent APPROVED report for this student.
    const reports = (await forTenant(ctx).select(
      progressReport,
      and(eq(progressReport.studentId, s.id), eq(progressReport.status, 'approved')),
    )) as (typeof progressReport.$inferSelect)[]
    if (reports.length === 0) continue
    const latest = reports.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]!

    const model = await getReportViewModel(ctx, latest.id, stamp())
    if (!model) continue
    const pdf = await renderReportPdf(model)

    let folder = safe(s.name)
    const seen = usedNames.get(folder) ?? 0
    if (seen > 0) folder = `${folder} (${seen + 1})`
    usedNames.set(safe(s.name), seen + 1)

    zip.append(pdf, { name: `${folder}/report.pdf` })
  }

  // finalize() MUST come AFTER every append().
  await zip.finalize()
  const buf = await done

  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="reports-${sectionId}.zip"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
