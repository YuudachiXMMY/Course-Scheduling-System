import { requireAuthContext } from '@/auth/context'
import { requirePermission } from '@/auth/authorize'
import { authErrorResponse } from '@/app/api/_auth'
import { actorOwnsStudent } from '@/auth/scope'
import { forTenant } from '@/db/tenant'
import { student } from '@/db/schema'
import { getStudentLessonsForTenant } from '@/app/dashboard/students/share-data'
import { buildIcs, feedWindow } from '@/lib/ical-feed'
import { env } from '@/env'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// P4-8: AUTHENTICATED export. Reuses Phase-3 buildIcs()/feedWindow() verbatim for the per-student
// .ics (email / iPhone attachment). Reads via the forTenant spine (M1), NOT the public share.ts.
export async function GET(_req: Request, { params }: { params: Promise<{ studentId: string }> }) {
  try {
    const ctx = await requireAuthContext()
    requirePermission(ctx, { student: ['read'], lesson: ['read'] })
    const { studentId } = await params
    const s = await forTenant(ctx).findById(student, studentId)
    if (!s) return new Response('Not found', { status: 404 })
    // 工作流 E: a plain teacher may only export a student enrolled in a section they teach — a guessed
    // same-tenant studentId 404s (never another student's full .ics). Route bypasses the RSC layout
    // guard; whole-tenant staff + superadmin bypass via actorOwnsStudent. 404 (not 403) so it can't
    // probe student existence.
    if (!(await actorOwnsStudent(ctx, studentId))) return new Response('Not found', { status: 404 })

    const lessons = await getStudentLessonsForTenant(ctx, studentId, feedWindow())
    const host = new URL(env.NEXT_PUBLIC_APP_URL).host
    const body = buildIcs(lessons, { host, name: `${s.name} 的课表` })

    return new Response(body, {
      status: 200,
      headers: {
        // attachment (NOT inline) — this is a one-shot download, not a live subscription feed.
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': `attachment; filename="schedule-${studentId}.ics"`,
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
