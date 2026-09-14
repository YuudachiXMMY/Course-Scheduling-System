import { ZipArchive } from 'archiver'
import { and, eq, inArray } from 'drizzle-orm'
import { requireAuthContext } from '@/auth/context'
import { requirePermission } from '@/auth/authorize'
import { forTenant } from '@/db/tenant'
import { classSection, enrollment, student } from '@/db/schema'
import { ensureActiveShare, getStudentLessonsForTenant } from '@/app/dashboard/students/share-data'
import { renderScheduleCardHtml } from '@/lib/schedule-card-render'
import { renderCardPng } from '@/lib/browser'
import { qrDataUrl } from '@/lib/qr'
import { buildIcs, cardWindow, feedWindow } from '@/lib/ical-feed'
import { env } from '@/env'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Sanitize a student name into a safe ZIP entry folder. Strip path/reserved chars so a name can
// never escape its folder or break the archive; fall back to a stable id if nothing survives.
function safe(name: string): string {
  const cleaned = name.replace(/[/\\:*?"<>|]/g, '_').trim()
  return cleaned.length > 0 ? cleaned : 'student'
}

// P4-8: AUTHENTICATED batch export. Verifies the section belongs to ctx.tenant, loads its ACTIVE
// enrollments → students, and streams a ZIP where each student's folder holds ONLY that child's
// own lessons (per-student slice via getStudentLessonsForTenant on the forTenant spine, M1).
// PNGs are serialized through renderCardPng's internal mutex (small-VPS guard).
export async function GET(_req: Request, { params }: { params: Promise<{ sectionId: string }> }) {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { student: ['read'], lesson: ['read'] })
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

  const host = new URL(env.NEXT_PUBLIC_APP_URL).host

  // archiver has no .toBuffer(): collect chunks and Buffer.concat on 'end'. archiver@8 is ESM with
  // named class exports (no callable default) — construct ZipArchive directly.
  const chunks: Buffer[] = []
  const zip = new ZipArchive({ zlib: { level: 9 } })
  zip.on('data', (c: Buffer) => chunks.push(c))
  const done = new Promise<Buffer>((res, rej) => {
    zip.on('end', () => res(Buffer.concat(chunks)))
    zip.on('error', rej)
  })

  // Guard against duplicate folder names when two students share a sanitized name.
  const usedNames = new Map<string, number>()
  for (const s of students) {
    const share = await ensureActiveShare(ctx, s.id)
    const shareUrl = `${env.NEXT_PUBLIC_APP_URL}/s/${share.token}`

    const cardLessons = await getStudentLessonsForTenant(ctx, s.id, cardWindow())
    const html = await renderScheduleCardHtml({
      studentName: s.name,
      subtitle: s.schoolGrade ?? undefined,
      qrDataUrl: await qrDataUrl(shareUrl),
      shareUrl,
      lessons: cardLessons,
    })
    const png = await renderCardPng(html)

    const icsLessons = await getStudentLessonsForTenant(ctx, s.id, feedWindow())
    const ics = buildIcs(icsLessons, { host, name: `${s.name} 的课表` })

    let folder = safe(s.name)
    const seen = usedNames.get(folder) ?? 0
    if (seen > 0) folder = `${folder} (${seen + 1})`
    usedNames.set(safe(s.name), seen + 1)

    zip.append(png, { name: `${folder}/schedule.png` })
    zip.append(ics, { name: `${folder}/schedule.ics` })
  }

  // finalize() MUST come AFTER every append() — appending post-finalize throws.
  await zip.finalize()
  const buf = await done

  // Buffer<ArrayBufferLike> isn't directly assignable to BodyInit under lib.dom — wrap in a plain
  // Uint8Array (backed by ArrayBuffer) which satisfies BodyInit.
  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="section-${sectionId}.zip"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
