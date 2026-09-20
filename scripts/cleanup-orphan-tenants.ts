// DB1 prerequisite — delete orphan rows whose tenant_id has no matching organization(id), so the
// tenant_id foreign keys added in drizzle/0016_tenant_id_fk.sql can be applied. An orphan tenant's
// rows are removed from every app table in child->parent order (the H1/DB6 restrict FKs between app
// tables would otherwise block deleting a parent that still has children). Prints a per-table count.
//
// B1: wired into docker/entrypoint.sh to run automatically BEFORE `db:migrate` on every boot, so an
// upgrade of a DB that accumulated orphans (e.g. a deleted organization) no longer crash-loops the
// container at migration 0016. Standalone use is still supported:
//   npx tsx scripts/cleanup-orphan-tenants.ts
// Idempotent and safe to re-run (a clean DB deletes 0 rows). Uses the same advisory lock as
// scripts/migrate.ts so it can't race a migrator, and it is guarded against a fresh / partially
// migrated schema (see cleanupOrphanTenants) so running it before the first migration is a clean
// no-op rather than a "relation does not exist" crash.
import 'dotenv/config'
import { pathToFileURL } from 'node:url'
import postgres from 'postgres'

type Sql = ReturnType<typeof postgres>

export const CLEANUP_LOCK_KEY = 728934123 // shared with scripts/migrate.ts — serialise schema/data mutation

// child -> parent order so app-level restrict FKs never block a delete.
export const CLEANUP_TABLES = [
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

// True iff `public.<table>` exists AND has a `tenant_id` column. Guards a fresh / partially-migrated
// DB: running this before `db:migrate` on a brand-new database (no tables yet) MUST be a clean no-op,
// never a crash — otherwise wiring it into the entrypoint would trade the 0016 upgrade crash-loop for
// a brand-new "relation does not exist" first-deploy crash-loop.
export async function tableHasTenantId(sql: Sql, table: string): Promise<boolean> {
  const rows = await sql<{ present: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ${table} AND column_name = 'tenant_id'
    ) AS present`
  return rows[0]?.present === true
}

// Does `public.organization` exist yet? False on a brand-new DB before the first migration.
export async function organizationTableExists(sql: Sql): Promise<boolean> {
  const rows = await sql<{ present: boolean }[]>`
    SELECT to_regclass('public.organization') IS NOT NULL AS present`
  return rows[0]?.present === true
}

// True once 0016's tenant_id -> organization FK is in place (checked on a representative table). When it
// is, an orphan row is impossible by definition, so the full-table anti-join scans can be skipped
// entirely — every post-0016 boot then pays one catalog query instead of 18 O(table-size) seq scans.
export async function tenantFkAlreadyEnforced(sql: Sql): Promise<boolean> {
  const rows = await sql<{ present: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM pg_constraint c
      JOIN pg_class child ON child.oid = c.conrelid
      JOIN pg_class parent ON parent.oid = c.confrelid
      JOIN pg_namespace n ON n.oid = child.relnamespace
      WHERE c.contype = 'f' AND n.nspname = 'public'
        AND child.relname = 'student' AND parent.relname = 'organization'
    ) AS present`
  return rows[0]?.present === true
}

// Delete rows in `table` whose tenant_id has no matching row in `refTable` (default: organization).
// Returns the number of rows removed. `refTable` is parameterised so the delete predicate can be
// exercised in isolation against temp fixtures (the FK on the real tables makes seeding an orphan there
// impossible). Both identifiers are interpolated via sql(...) so they are quoted, never string-concatenated.
export async function deleteOrphansFromTable(
  sql: Sql,
  table: string,
  refTable = 'organization',
): Promise<number> {
  const rows = await sql`
    DELETE FROM ${sql(table)}
    WHERE tenant_id NOT IN (SELECT id FROM ${sql(refTable)})
    RETURNING 1
  `
  return rows.length
}

// Delete rows whose tenant_id references no organization(id), across every app table, in child->parent
// order. Idempotent (a healthy DB deletes 0). Returns the total number of rows removed. The caller owns
// the `sql` handle (so tests can inject their own and close it). Acquires the shared advisory lock so it
// can never race scripts/migrate.ts.
export async function cleanupOrphanTenants(sql: Sql): Promise<number> {
  await sql`SELECT pg_advisory_lock(${CLEANUP_LOCK_KEY})`
  let total = 0
  try {
    // No organization table => migrations have not run yet (fresh DB). There is nothing to clean, and
    // 0016 will apply to empty tables. Skip so a first deploy never crash-loops the entrypoint.
    if (!(await organizationTableExists(sql))) {
      console.log(
        '[cleanup-orphan-tenants] no organization table yet (fresh DB) — nothing to clean',
      )
      return 0
    }
    // Healthy fast path: once the 0016 tenant_id FKs exist, orphans are impossible — skip the scans.
    if (await tenantFkAlreadyEnforced(sql)) {
      console.log(
        '[cleanup-orphan-tenants] tenant_id FKs already enforced — no orphans possible, skipping',
      )
      return 0
    }
    for (const t of CLEANUP_TABLES) {
      // Skip any table not yet created / not yet carrying tenant_id (partial migration state).
      if (!(await tableHasTenantId(sql, t))) continue
      // ordered deletes: children before parents so app-level restrict FKs never block a delete
      const n = await deleteOrphansFromTable(sql, t)
      total += n
      if (n > 0) console.log(`[cleanup-orphan-tenants] ${t}: deleted ${n}`)
    }
    console.log(`[cleanup-orphan-tenants] done — ${total} orphan row(s) removed`)
    return total
  } finally {
    await sql`SELECT pg_advisory_unlock(${CLEANUP_LOCK_KEY})`
  }
}

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error('[cleanup-orphan-tenants] DATABASE_URL is not set')
    process.exit(1)
  }
  const sql = postgres(url, { max: 1, onnotice: () => {} })
  try {
    await cleanupOrphanTenants(sql)
    await sql.end({ timeout: 5 })
    process.exit(0)
  } catch (err) {
    console.error('[cleanup-orphan-tenants] FAILED:', err)
    await sql.end({ timeout: 5 }).catch(() => {})
    process.exit(1)
  }
}

// Run only when executed directly (node dist/cleanup-orphan-tenants.mjs / npx tsx ...), NOT when
// imported by a test — so the unit suite can exercise the exported functions without process.exit().
const invokedDirectly = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) void main()
