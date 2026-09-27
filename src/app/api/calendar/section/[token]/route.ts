import { getSectionShareByToken, getSectionScheduleForShare } from '@/lib/share'
import { buildIcs } from '@/lib/ical-feed'
import { env } from '@/env'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// PUBLIC, NO-AUTH per-SECTION calendar subscription (功能: 班级日历订阅). The section mirror of
// /api/calendar/[token] (per-teacher/tenant feed): it resolves the SAME sectionShareLink capability token
// that backs the public /sec/[token] schedule page, so generating / rotating / revoking that share link
// also controls this subscription. Lives under app/api/** so no dashboard/ auth-guard layout wraps it — a
// bad/revoked/expired token gets 404, never a login redirect.
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params // Next 16: params is a Promise
  // getSectionShareByToken already enforces revoked_at IS NULL AND (expires_at IS NULL OR future) — a
  // revoked/expired token 404s exactly like the /sec page (M2 token-revocation latency).
  const share = await getSectionShareByToken(token)
  if (!share) return new Response('Not found', { status: 404 })

  // Public read exception: tenantId/sectionId come from the token-RESOLVED share row, NEVER a request
  // param. getSectionScheduleForShare scopes strictly to that (tenantId, sectionId) over the rolling
  // feedWindow and fills each event's "课程名 · 班级名" title.
  const lessons = await getSectionScheduleForShare(share.tenantId, share.sectionId)
  const host = new URL(env.NEXT_PUBLIC_APP_URL).host
  const body = buildIcs(lessons, { host, name: share.label ?? '班级课表' })

  return new Response(body, {
    status: 200,
    headers: {
      // text/calendar (NOT application/octet-stream) so calendar clients SUBSCRIBE, not one-off download.
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="section-schedule.ics"',
      // private: per-tenant data behind a capability token — shared/intermediary caches (CDN, proxy) must
      // NOT store it. no-cache: the client may store the .ics but MUST revalidate before reuse, so a
      // rotated/revoked token 404s immediately instead of coasting on a private cache (mirrors [token]).
      'Cache-Control': 'private, no-cache',
    },
  })
}
