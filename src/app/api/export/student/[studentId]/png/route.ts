import { requireAuthContext } from '@/auth/context'
import { requirePermission } from '@/auth/authorize'
import { authErrorResponse } from '@/app/api/_auth'
import { actorOwnsStudent } from '@/auth/scope'
import { forTenant } from '@/db/tenant'
import { student } from '@/db/schema'
import { ensureActiveShare, getStudentLessonsForTenant } from '@/app/dashboard/students/share-data'
import { renderScheduleCardHtml } from '@/lib/schedule-card-render'
import { renderCardPng } from '@/lib/browser'
import { consumeRateLimit } from '@/lib/rate-limit'
import { qrDataUrl } from '@/lib/qr'
import { cardWindow } from '@/lib/ical-feed'
import { env } from '@/env'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// L-export-rl: each request drives a Chromium PNG render serialized through renderCardPng's process-global
// mutex; without a per-user cap an authenticated caller can queue unbounded renders and stall every other
// export on the single-VPS worker. 30/min per user is far above any legitimate teacher use yet blunts a
// scripted flood. Keyed per user (bucket-prefixed so it never collides with other rate-limited actions).
const EXPORT_PNG_LIMIT = { limit: 30, windowMs: 60_000 }

// P4-8: AUTHENTICATED export. Reads via forTenant/getStudentLessonsForTenant (NOT the public
// share.ts reader — M1 forbids raw db on the authenticated path). The QR encodes the PUBLIC
// /s/<token> page (P4-11) so the parent can scan-to-open the live timetable in WeChat.
export async function GET(_req: Request, { params }: { params: Promise<{ studentId: string }> }) {
  try {
    const ctx = await requireAuthContext()
    requirePermission(ctx, { student: ['read'], lesson: ['read'] })
    // L-export-rl: throttle the heavy Chromium render per authenticated user before any DB/render work.
    const rl = consumeRateLimit(`export-png:${ctx.userId}`, EXPORT_PNG_LIMIT)
    if (!rl.allowed) {
      return new Response('导出请求过于频繁，请稍后再试。', {
        status: 429,
        headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) },
      })
    }
    const { studentId } = await params
    const s = await forTenant(ctx).findById(student, studentId)
    if (!s) return new Response('Not found', { status: 404 })
    // 工作流 E: a plain teacher may only export a student ACTIVELY enrolled in a section they teach — a
    // guessed same-tenant studentId 404s BEFORE ensureActiveShare, so it can never mint a persistent
    // public /s/{token} for another teacher's student. This route bypasses the RSC layout guard, so it
    // must enforce ownership itself; whole-tenant staff + superadmin bypass via actorOwnsStudent. 404
    // (not 403) so it can't probe student existence.
    if (!(await actorOwnsStudent(ctx, studentId))) return new Response('Not found', { status: 404 })

    const share = await ensureActiveShare(ctx, studentId)
    const shareUrl = `${env.NEXT_PUBLIC_APP_URL}/s/${share.token}`
    const lessons = await getStudentLessonsForTenant(ctx, studentId, cardWindow())
    const html = await renderScheduleCardHtml({
      studentName: s.name,
      subtitle: s.schoolGrade ?? undefined,
      qrDataUrl: await qrDataUrl(shareUrl),
      shareUrl,
      lessons,
    })
    const png = await renderCardPng(html)

    // Buffer<ArrayBufferLike> isn't directly assignable to BodyInit under lib.dom — wrap in a plain
    // Uint8Array (backed by ArrayBuffer) which satisfies BodyInit.
    return new Response(new Uint8Array(png), {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Content-Disposition': `inline; filename="schedule-${studentId}.png"`,
        // per-student data → shared/intermediary caches must NOT store it.
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
