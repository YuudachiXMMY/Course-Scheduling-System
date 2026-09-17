import { and, eq, isNull } from 'drizzle-orm'
import { db } from '@/db'
import { calendarFeed } from '@/db/schema'
import { getFeedLessons, buildIcs } from '@/lib/ical-feed'
import { env } from '@/env'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// PUBLIC, NO-AUTH subscription feed (P3-2/P3-3). Lives under app/api/** so no
// dashboard/ auth-guard layout wraps it — a bad token gets 404, never a login redirect.
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params // Next 16: params is a Promise
  const [feed] = await db
    .select()
    .from(calendarFeed)
    .where(and(eq(calendarFeed.token, token), isNull(calendarFeed.revokedAt)))
    .limit(1)
  if (!feed) return new Response('Not found', { status: 404 })

  // 评审 Slice D（B6/B45）：按 feed 行的归属维度取数——feed.teacherId 非空（section-scoped 教师自己的
  // feed）只含该教师的课次；为 null（whole-tenant feed）维持全租户。切断"任一 token 泄露全租户课表"。
  const lessons = await getFeedLessons(feed.tenantId, feed.teacherId)
  const host = new URL(env.NEXT_PUBLIC_APP_URL).host
  const body = buildIcs(lessons, { host, name: feed.label ?? '课程排课' })

  return new Response(body, {
    status: 200,
    headers: {
      // text/calendar (NOT application/octet-stream) so clients SUBSCRIBE, not download.
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="schedule.ics"',
      // private: this is per-tenant data behind a capability token — shared/intermediary caches
      // (CDN, proxy) must NOT store it. must-revalidate: once stale, a cache must recheck the
      // origin, so a rotated/revoked feed 404s promptly instead of serving a stale .ics (M2).
      'Cache-Control': 'private, max-age=3600, must-revalidate',
    },
  })
}
