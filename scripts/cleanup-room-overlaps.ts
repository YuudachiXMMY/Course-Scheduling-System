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
//
// B2 (orch-review HIGH — test gap): the fast-path guard, the overlap self-join, and the tie-break are
// exported as pure/isolated functions (mirroring cleanup-orphan-tenants.ts) so tests/cleanup-room-overlaps
// .test.ts can pin the logic that guards the entrypoint against the 0015 migration crash-loop. main()
// only composes them; behavior is unchanged.
import 'dotenv/config'
import { pathToFileURL } from 'node:url'
import postgres from 'postgres'

// A query executor: the top-level client OR a transaction handle (so tests can drive the helpers against a
// temp-table fixture inside a rolled-back tx). Mirrors cleanup-orphan-tenants.ts's SqlExecutor.
type Sql = postgres.Sql | postgres.TransactionSql

export const ROOM_OVERLAP_LOCK_KEY = 728934123 // shared with scripts/migrate.ts

export interface RoomOverlapPair {
  tenant_id: string
  location: string
  a_id: string
  a_start: Date
  a_end: Date
  b_id: string
  b_start: Date
  b_end: Date
}

// F4 fast-path (idempotent, mirrors cleanup-orphan-tenants): true when the 0015 EXCLUDE constraint already
// exists (the DB is at/past that migration and CANNOT hold room overlaps) OR the `lesson` table doesn't
// exist yet (brand-new/empty DB, to_regclass → NULL). When true there is nothing to scan or fix.
export async function roomOverlapConstraintSettled(sql: Sql): Promise<boolean> {
  const [row] = await sql<{ done: boolean }[]>`
    SELECT (
      to_regclass('public.lesson') IS NULL
      OR EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'lesson_no_room_overlap'
      )
    ) AS done
  `
  return row?.done === true
}

// Self-join: two DISTINCT non-canceled lessons in the same tenant + non-null location whose [start,end)
// ranges overlap. `a.id < b.id` de-dupes the symmetric pair. `table` is parameterised so the predicate can
// be exercised against a temp fixture in tests; the real call always targets `lesson`.
export async function findRoomOverlapPairs(sql: Sql, table = 'lesson'): Promise<RoomOverlapPair[]> {
  const rows = await sql<RoomOverlapPair[]>`
    SELECT a.tenant_id, a.location,
           a.id AS a_id, a.start_at AS a_start, a.end_at AS a_end,
           b.id AS b_id, b.start_at AS b_start, b.end_at AS b_end
    FROM ${sql(table)} a
    JOIN ${sql(table)} b
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
  return [...rows]
}

// Pick the lesson to cancel from each overlapping pair: the LATER-starting one; on an equal start, the
// higher id (deterministic — findRoomOverlapPairs guarantees a.id < b.id, so b_id is the higher). A single
// lesson can lose several pairs, so a Set de-dupes so we cancel each at most once. Pure + directly testable.
export function resolveOverlapLosers(pairs: RoomOverlapPair[]): string[] {
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
  return [...toCancel]
}

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error('[cleanup-room-overlaps] DATABASE_URL is not set')
    process.exit(1)
  }
  const FIX = process.argv.includes('--fix')
  const sql = postgres(url, { max: 1, onnotice: () => {} })
  await sql`SELECT pg_advisory_lock(${ROOM_OVERLAP_LOCK_KEY})`
  try {
    if (await roomOverlapConstraintSettled(sql)) {
      console.log('[cleanup-room-overlaps] constraint present or no schema yet — nothing to do')
      return
    }
    const pairs = await findRoomOverlapPairs(sql)
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
    const ids = resolveOverlapLosers(pairs)
    const res = await sql`UPDATE lesson SET status = 'canceled' WHERE id IN ${sql(ids)} RETURNING 1`
    console.log(`[cleanup-room-overlaps] canceled ${res.length} lesson(s) to clear overlaps`)
  } finally {
    await sql`SELECT pg_advisory_unlock(${ROOM_OVERLAP_LOCK_KEY})`
    await sql.end({ timeout: 5 })
  }
}

// Run only when executed directly (npx tsx / node dist/…), NOT when imported by a test — so the unit suite
// can exercise the exported functions without triggering the CLI / process.exit().
const invokedDirectly = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) {
  main().then(
    () => process.exit(process.exitCode ?? 0),
    (err) => {
      console.error('[cleanup-room-overlaps] FAILED:', err)
      process.exit(1)
    },
  )
}
