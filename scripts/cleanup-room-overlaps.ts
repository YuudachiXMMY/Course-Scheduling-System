// DB2 prerequisite — detect (and optionally resolve) same-tenant, same-location, time-overlapping
// non-canceled lessons, so the EXCLUDE constraint `lesson_no_room_overlap` in
// drizzle/0015_lesson_room_exclusion.sql can be applied. NULL location is exempt (no room assigned).
//
//   Report only (default):   npx tsx scripts/cleanup-room-overlaps.ts
//   Resolve conflicts:       npx tsx scripts/cleanup-room-overlaps.ts --fix
//
// Report mode lists every overlapping pair and exits non-zero if any exist (so a migration script can
// gate on it). --fix cancels the LATER-starting lesson of each overlapping pair (status='canceled'),
// the conservative choice: it never deletes history and clears the violation. Uses the migrate lock.
import 'dotenv/config'
import postgres from 'postgres'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('[cleanup-room-overlaps] DATABASE_URL is not set')
  process.exit(1)
}
const FIX = process.argv.includes('--fix')
const sql = postgres(url, { max: 1, onnotice: () => {} })
const LOCK_KEY = 728934123 // shared with scripts/migrate.ts

async function main() {
  await sql`SELECT pg_advisory_lock(${LOCK_KEY})`
  try {
    // F4 fast-path (idempotent, mirrors cleanup-orphan-tenants): if the 0015 EXCLUDE constraint already
    // exists, the DB is at/past that migration and CANNOT hold room overlaps → nothing to scan or fix.
    // Also covers a brand-new/empty DB where the `lesson` table doesn't exist yet (to_regclass → NULL).
    const [{ done }] = await sql<{ done: boolean }[]>`
      SELECT (
        to_regclass('public.lesson') IS NULL
        OR EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'lesson_no_room_overlap'
        )
      ) AS done
    `
    if (done) {
      console.log('[cleanup-room-overlaps] constraint present or no schema yet — nothing to do')
      return
    }
    // Self-join: two DISTINCT non-canceled lessons in the same tenant + non-null location whose
    // [start,end) ranges overlap. `a.id < b.id` de-dupes the symmetric pair.
    const pairs = await sql<
      {
        tenant_id: string
        location: string
        a_id: string
        a_start: Date
        a_end: Date
        b_id: string
        b_start: Date
        b_end: Date
      }[]
    >`
      SELECT a.tenant_id, a.location,
             a.id AS a_id, a.start_at AS a_start, a.end_at AS a_end,
             b.id AS b_id, b.start_at AS b_start, b.end_at AS b_end
      FROM lesson a
      JOIN lesson b
        ON a.tenant_id = b.tenant_id
       AND a.location = b.location
       AND a.id < b.id
       AND a.status <> 'canceled'
       AND b.status <> 'canceled'
       AND a.location IS NOT NULL
       AND b.location IS NOT NULL
       AND tstzrange(a.start_at, a.end_at, '[)') && tstzrange(b.start_at, b.end_at, '[)')
      ORDER BY a.tenant_id, a.location, a.start_at
    `
    if (pairs.length === 0) {
      console.log('[cleanup-room-overlaps] no room overlaps found')
      return
    }
    console.log(`[cleanup-room-overlaps] found ${pairs.length} overlapping pair(s):`)
    for (const p of pairs) {
      console.log(
        `  tenant=${p.tenant_id} room=${JSON.stringify(p.location)} ` +
          `A(${p.a_id} ${p.a_start.toISOString()}..${p.a_end.toISOString()}) ` +
          `B(${p.b_id} ${p.b_start.toISOString()}..${p.b_end.toISOString()})`,
      )
    }
    if (!FIX) {
      console.error(
        '[cleanup-room-overlaps] re-run with --fix to cancel the later lesson of each pair',
      )
      process.exitCode = 1
      return
    }
    // Cancel the later-starting lesson of each pair (tie-break by larger id). A single lesson may be
    // the loser in several pairs; a set de-dupes so we cancel each at most once.
    const toCancel = new Set<string>()
    for (const p of pairs) {
      const later =
        p.b_start.getTime() > p.a_start.getTime()
          ? p.b_id
          : p.a_start.getTime() > p.b_start.getTime()
            ? p.a_id
            : p.b_id // equal start → cancel the higher id deterministically
      toCancel.add(later)
    }
    const ids = [...toCancel]
    const res = await sql`UPDATE lesson SET status = 'canceled' WHERE id IN ${sql(ids)} RETURNING 1`
    console.log(`[cleanup-room-overlaps] canceled ${res.length} lesson(s) to clear overlaps`)
  } finally {
    await sql`SELECT pg_advisory_unlock(${LOCK_KEY})`
    await sql.end({ timeout: 5 })
  }
}
main().then(
  () => process.exit(process.exitCode ?? 0),
  (err) => {
    console.error('[cleanup-room-overlaps] FAILED:', err)
    process.exit(1)
  },
)
