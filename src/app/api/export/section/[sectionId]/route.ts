import { ZipArchive } from 'archiver'
import { and, eq, inArray } from 'drizzle-orm'
import { requireAuthContext } from '@/auth/context'
import { requirePermission } from '@/auth/authorize'
import { authErrorResponse } from '@/app/api/_auth'
import { actorOwnsSection } from '@/auth/scope'
import { forTenant } from '@/db/tenant'
import { classSection, enrollment, student } from '@/db/schema'
import { ensureActiveShare, getStudentLessonsForTenant } from '@/app/dashboard/students/share-data'
import { renderScheduleCardHtml } from '@/lib/schedule-card-render'
import { renderCardPng } from '@/lib/browser'
import { consumeRateLimit } from '@/lib/rate-limit'
import { qrDataUrl } from '@/lib/qr'
import { buildIcs, cardWindow, feedWindow } from '@/lib/ical-feed'
import { env } from '@/env'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// PERF1: each enrolled student below drives a Chromium PNG render serialized through renderCardPng's
// process-global mutex (single-VPS guard). An unbounded roster would monopolize the browser and stall
// every other export for minutes. Cap the batch and reject oversized requests with 413.
const MAX_EXPORT_STUDENTS = 60

// L-export-rl: MAX_EXPORT_STUDENTS caps one request's size; this caps REQUEST FREQUENCY per authenticated
// user so a scripted flood can't monopolize the single-VPS Chromium mutex. 10/min is generous for real use.
const EXPORT_ZIP_LIMIT = { limit: 10, windowMs: 60_000 }

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
  try {
    const ctx = await requireAuthContext()
    requirePermission(ctx, { student: ['read'], lesson: ['read'] })
    // L-export-rl: throttle the heavy N-PNG batch render per authenticated user before any DB/render work.
    const rl = consumeRateLimit(`export-section-zip:${ctx.userId}`, EXPORT_ZIP_LIMIT)
    if (!rl.allowed) {
      return new Response('导出请求过于频繁，请稍后再试。', {
        status: 429,
        headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) },
      })
    }
    const { sectionId } = await params

    const section = await forTenant(ctx).findById(classSection, sectionId)
    if (!section) return new Response('Not found', { status: 404 })
    // 工作流 E: a plain teacher may only export sections they teach — a guessed same-tenant sectionId 404s
    // (never another teacher's roster, schedules, or a fresh public /s/{token} minted for their students).
    // This route bypasses the RSC layout guard, so it must enforce ownership itself; whole-tenant staff +
    // superadmin bypass via actorOwnsSection. 404 (not 403) so it can't probe section existence.
    if (!actorOwnsSection(ctx, section)) return new Response('Not found', { status: 404 })

    const enrollments = await forTenant(ctx).select(
      enrollment,
      and(eq(enrollment.sectionId, sectionId), eq(enrollment.status, 'active')),
    )

    const studentIds = [...new Set(enrollments.map((e) => e.studentId))]
    const students =
      studentIds.length === 0
        ? []
        : await forTenant(ctx).select(student, inArray(student.id, studentIds))

    // PERF1: reject before the render loop (which serializes N Chromium renders through the global
    // mutex) so an oversized section can't monopolize the single-VPS browser.
    if (students.length > MAX_EXPORT_STUDENTS) {
      return new Response(
        `学生过多（${students.length} 名），单次最多导出 ${MAX_EXPORT_STUDENTS} 名，请缩小范围后重试。`,
        { status: 413 },
      )
    }

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
  } catch (e) {
    // EH3: AuthError → 401/403 (not 500); re-throw everything else so genuine faults still 500.
    const r = authErrorResponse(e)
    if (r) return r
    throw e
  }
}
