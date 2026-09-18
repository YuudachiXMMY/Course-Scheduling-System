// DB1 prerequisite — delete orphan rows whose tenant_id has no matching organization(id), so the
// tenant_id foreign keys added in drizzle/0016_tenant_id_fk.sql can be applied. An orphan tenant's
// rows are removed from every app table in child->parent order (the H1/DB6 restrict FKs between app
// tables would otherwise block deleting a parent that still has children). Prints a per-table count.
//
// Run BEFORE `pnpm db:migrate` against any DB that may hold pre-FK junk:
//   npx tsx scripts/cleanup-orphan-tenants.ts
// Idempotent and safe to re-run (a clean DB deletes 0 rows). Uses the same advisory lock as
// scripts/migrate.ts so it can't race a migrator.
import 'dotenv/config'
import postgres from 'postgres'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('[cleanup-orphan-tenants] DATABASE_URL is not set')
  process.exit(1)
}
const sql = postgres(url, { max: 1, onnotice: () => {} })
const LOCK_KEY = 728934123 // shared with scripts/migrate.ts — serialise schema/data mutation

// child -> parent order so app-level restrict FKs never block a delete.
const TABLES = [
  'payment',
  'credit_package',
  'grade',
  'attendance',
  'note',
  'progress_report',
  'reschedule_request',
  'notification',
  'share_link',
  'portal_link',
  'calendar_feed',
  'push_subscription',
  'enrollment',
  'lesson',
  'section_meeting',
  'class_section',
  'course',
  'student',
] as const

async function main() {
  await sql`SELECT pg_advisory_lock(${LOCK_KEY})`
  let total = 0
  try {
    for (const t of TABLES) {
      // ordered deletes: children before parents so app-level restrict FKs never block a delete
      const rows = await sql`
        DELETE FROM ${sql(t)}
        WHERE tenant_id NOT IN (SELECT id FROM organization)
        RETURNING 1
      `
      const n = rows.length
      total += n
      if (n > 0) console.log(`[cleanup-orphan-tenants] ${t}: deleted ${n}`)
    }
    console.log(`[cleanup-orphan-tenants] done — ${total} orphan row(s) removed`)
  } finally {
    await sql`SELECT pg_advisory_unlock(${LOCK_KEY})`
    await sql.end({ timeout: 5 })
  }
}
main().then(
  () => process.exit(0),
  (err) => {
    console.error('[cleanup-orphan-tenants] FAILED:', err)
    process.exit(1)
  },
)
