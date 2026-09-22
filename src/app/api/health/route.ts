import postgres from 'postgres'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// H1: the health check MUST verify the DB is reachable, not just that the process is up. A static
// `{ok:true}` stays green while Postgres is down, so the orchestrator (Docker HEALTHCHECK / Traefik /
// Coolify) keeps routing traffic to a container that can serve nothing and never restarts it.
//
// The probe runs on its OWN single-use connection, deliberately NOT the shared app pool (@/db, max:10).
// `Promise.race` below only stops *waiting* on a hung query — it does not cancel it. Were the probe on
// the shared pool, every timed-out probe would strand one of its 10 connections, and since the platform
// re-probes every ~30s a sustained DB stall would drain the pool and starve real traffic (the very
// site-wide stall H1/H4 exist to prevent). On a private client we always `end({ timeout: 0 })` in
// `finally`, so a hung probe is force-closed and can never touch the app pool. `connect_timeout` makes a
// dead DB fail fast; server-side `statement_timeout` cancels a slow-but-alive query.
const DB_PROBE_TIMEOUT_MS = 3000
const DB_PROBE_TIMEOUT_S = 3

async function probeDatabase(): Promise<boolean> {
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error('[health] DATABASE_URL is not set')
    return false
  }
  const probe = postgres(url, {
    max: 1,
    connect_timeout: DB_PROBE_TIMEOUT_S,
    idle_timeout: 1,
    connection: { statement_timeout: DB_PROBE_TIMEOUT_MS },
    onnotice: () => {},
  })
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      probe`select 1`,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('db probe timed out')), DB_PROBE_TIMEOUT_MS)
      }),
    ])
    return true
  } catch (e) {
    // Keep the UI/response generic; log the real cause for operators.
    console.error('[health] database probe failed', e)
    return false
  } finally {
    // A6 (orch-review LOW): clear the race-loser timer when the probe wins, so a fast health check doesn't
    // leave a dangling 3s timer pending (the platform re-probes ~every 30s). Not a correctness bug — the
    // race still settles either way — just avoids needless pending timers.
    if (timer) clearTimeout(timer)
    // Force the socket shut even mid-query so a hung probe releases its connection immediately — the
    // race above abandons the query but never closes it. `end({ timeout: 0 })` rejects any pending query
    // and tears the connection down at once. On its own isolated client this can never touch the pool.
    await probe.end({ timeout: 0 }).catch(() => {})
  }
}

export async function GET() {
  const dbOk = await probeDatabase()
  return Response.json(
    { ok: dbOk, db: dbOk ? 'up' : 'down', ts: Date.now() },
    { status: dbOk ? 200 : 503 },
  )
}
