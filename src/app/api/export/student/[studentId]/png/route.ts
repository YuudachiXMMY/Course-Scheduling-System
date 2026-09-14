import { requireAuthContext } from '@/auth/context'
import { requirePermission } from '@/auth/authorize'
import { forTenant } from '@/db/tenant'
import { student } from '@/db/schema'
import { ensureActiveShare, getStudentLessonsForTenant } from '@/app/dashboard/students/share-data'
import { renderScheduleCardHtml } from '@/lib/schedule-card'
import { renderCardPng } from '@/lib/browser'
import { qrDataUrl } from '@/lib/qr'
import { cardWindow } from '@/lib/ical-feed'
import { env } from '@/env'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// P4-8: AUTHENTICATED export. Reads via forTenant/getStudentLessonsForTenant (NOT the public
// share.ts reader — M1 forbids raw db on the authenticated path). The QR encodes the PUBLIC
// /s/<token> page (P4-11) so the parent can scan-to-open the live timetable in WeChat.
export async function GET(_req: Request, { params }: { params: Promise<{ studentId: string }> }) {
  const ctx = await requireAuthContext()
  requirePermission(ctx, { student: ['read'], lesson: ['read'] })
  const { studentId } = await params
  const s = (await forTenant(ctx).findById(student, studentId)) as typeof student.$inferSelect | null
  if (!s) return new Response('Not found', { status: 404 })

  const share = await ensureActiveShare(ctx, studentId)
  const shareUrl = `${env.NEXT_PUBLIC_APP_URL}/s/${share.token}`
  const lessons = await getStudentLessonsForTenant(ctx, studentId, cardWindow())
  const html = renderScheduleCardHtml({
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
}
