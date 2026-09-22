import { timingSafeEqual } from 'node:crypto'
import { env } from '@/env'
import { db } from '@/db'
import { organization } from '@/db/schema'
import { runReminderScanCore } from '@/lib/reminder-core'
import { pruneOldNotificationsCore } from '@/lib/notification-core'
import type { AuthContext } from '@/auth/context'

// P7b: reminder-dispatch cron. Triggered by an EXTERNAL scheduler (Coolify Scheduled Task) hitting
// this route with the shared secret — an in-process timer would die/duplicate on redeploy. nodejs
// runtime is REQUIRED (postgres.js sockets + server-only libs cannot run on edge).
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const provided = req.headers.get('x-cron-secret') ?? undefined
  const expected = env.CRON_SECRET
  if (!expected || !provided) return Response.json({ ok: false }, { status: 401 })
  // Constant-time compare; equal-length guard because timingSafeEqual throws on length mismatch.
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b))
    return Response.json({ ok: false }, { status: 401 })

  const now = new Date()
  // organization IS the tenant enumeration — auth-owned (NOT a tenant table), so a raw read is
  // legitimate here. Every subsequent per-tenant read goes through forTenant(synthesized ctx).
  const orgs = await db.select({ id: organization.id }).from(organization)
  let created = 0
  let pruned = 0
  let failed = 0
  for (const o of orgs) {
    const ctx: AuthContext = {
      userId: 'system',
      tenantId: o.id,
      role: 'owner',
      isPlatformAdmin: false,
    }
    try {
      created += (await runReminderScanCore(ctx, now)).created
      // Bound table growth: drop this tenant's notifications older than the retention window.
      pruned += await pruneOldNotificationsCore(ctx, now)
    } catch (e) {
      // Per-tenant isolation: one bad tenant must not abort the whole batch.
      console.error('reminder scan failed', o.id, e)
      failed += 1
    }
  }
  // F9: a SYSTEMATIC failure (every tenant threw — DB down, migration mismatch) previously still
  // returned 200 {ok:true}, so a status-only monitor never saw the outage. Report `failed` always, and
  // fail the whole run (500) when EVERY tenant errored. A partial failure stays 200 so one flaky tenant
  // doesn't page, but `failed > 0` in the body lets richer monitoring alert on degradation.
  const systemic = orgs.length > 0 && failed === orgs.length
  return Response.json(
    { ok: !systemic, created, pruned, failed, total: orgs.length },
    { status: systemic ? 500 : 200 },
  )
}
