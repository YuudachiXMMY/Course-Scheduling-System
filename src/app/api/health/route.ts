import { sql } from 'drizzle-orm'
import { db } from '@/db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// H1: the health check MUST verify the DB is reachable, not just that the process is up. A static
// `{ok:true}` stays green while Postgres is down, so the orchestrator (Docker HEALTHCHECK / Traefik /
// Coolify) keeps routing traffic to a container that can serve nothing and never restarts it. We probe
// with a trivial `SELECT 1`, bounded by a short timeout so a hung/blocked DB fails the check promptly
// instead of holding the request open until the platform's own timeout.
const DB_PROBE_TIMEOUT_MS = 3000

async function probeDatabase(): Promise<boolean> {
  try {
    await Promise.race([
      db.execute(sql`select 1`),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('db probe timed out')), DB_PROBE_TIMEOUT_MS),
      ),
    ])
    return true
  } catch (e) {
    // Keep the UI/response generic; log the real cause for operators.
    console.error('[health] database probe failed', e)
    return false
  }
}

export async function GET() {
  const dbOk = await probeDatabase()
  return Response.json(
    { ok: dbOk, db: dbOk ? 'up' : 'down', ts: Date.now() },
    { status: dbOk ? 200 : 503 },
  )
}
