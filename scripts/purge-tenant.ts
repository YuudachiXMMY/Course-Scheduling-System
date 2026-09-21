// H8 — explicit tenant (organization) purge routine. drizzle/0016_tenant_id_fk.sql & 0019 add
// tenant_id -> organization foreign keys with ON DELETE RESTRICT (never cascade — a cascade would
// mass-purge tenant data top-down AND bypass the H1 retention FKs on grade/payment/attendance). The
// migration headers explicitly defer removal to "an explicit purge routine — H8": this is it.
//
// Deleting an organization row is otherwise IMPOSSIBLE once it holds any data — the 18 RESTRICT FKs
// block it. This routine removes a tenant's rows from every tenant-scoped table in child->parent order
// first, then deletes the organization row itself (which ON DELETE CASCADEs its member/invitation
// rows), and NULLs out any session.active_organization_id pointing at it. All in ONE transaction under
// the migrator's advisory lock, so a partial purge can never leave a half-deleted tenant and it can
// never race a migration/cleanup.
//
// GLOBAL user/account rows are intentionally NOT deleted: a user may belong to other organizations, so
// account deletion is a separate concern out of this routine's scope.
//
// Usage (DRY-RUN by default — prints the per-table row counts it WOULD delete, changes nothing):
//   npx tsx scripts/purge-tenant.ts <organizationId>
//   node dist/purge-tenant.mjs <organizationId>            # in the prod container
// Add --commit (or --yes) to actually execute the irreversible purge:
//   npx tsx scripts/purge-tenant.ts <organizationId> --commit
import 'dotenv/config'
import { pathToFileURL } from 'node:url'
import postgres from 'postgres'
import {
  CLEANUP_LOCK_KEY,
  CLEANUP_TABLES,
  organizationTableExists,
  tableHasTenantId,
} from './cleanup-orphan-tenants'

type Sql = ReturnType<typeof postgres>

// Serialise schema/data mutation against scripts/migrate.ts and scripts/cleanup-orphan-tenants.ts —
// they contend on the same advisory-lock key, so a purge and a migration can never run concurrently.
export const PURGE_LOCK_KEY = CLEANUP_LOCK_KEY

// Every tenant-scoped table, child -> parent, so the app-level RESTRICT FKs never block a delete.
// section_share_link (added by 0019, NOT part of CLEANUP_TABLES) is a leaf child of class_section and
// itself carries a tenant_id -> organization RESTRICT FK, so it MUST be removed before class_section
// AND before the organization row. The purge-tenant.test.ts completeness assertion pins this list to
// the live DB's actual set of tenant_id columns — add any new tenant table here or offboarding leaks it.
export const PURGE_TABLES = ['section_share_link', ...CLEANUP_TABLES] as const

export interface PurgeSummary {
  tenantId: string
  organizationExists: boolean
  organizationDeleted: boolean
  perTable: Record<string, number>
  totalRows: number
  sessionsCleared: number
  dryRun: boolean
}

// Delete rows in `table` belonging to one tenant. Returns the number removed. The identifier is
// interpolated via sql(...) so it is quoted, never string-concatenated; the value is a bound parameter.
export async function deleteTenantRowsFromTable(
  sql: Sql,
  table: string,
  tenantId: string,
): Promise<number> {
  const rows = await sql`DELETE FROM ${sql(table)} WHERE tenant_id = ${tenantId} RETURNING 1`
  return rows.length
}

// Count (never delete) a tenant's rows in `table` — powers the dry-run preview.
export async function countTenantRowsInTable(
  sql: Sql,
  table: string,
  tenantId: string,
): Promise<number> {
  const rows = await sql<
    { n: number }[]
  >`SELECT count(*)::int AS n FROM ${sql(table)} WHERE tenant_id = ${tenantId}`
  return rows[0]?.n ?? 0
}

async function organizationRowExists(sql: Sql, tenantId: string): Promise<boolean> {
  const rows = await sql<{ present: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM organization WHERE id = ${tenantId}) AS present`
  return rows[0]?.present === true
}

// The core purge, run WITHIN a caller-owned transaction (no lock/tx management here) so it is fully
// testable against seeded fixtures inside a rolled-back transaction. In dry-run it only counts and
// touches nothing. Otherwise it deletes tenant rows child->parent, clears sessions, then deletes the
// organization row (cascading member/invitation).
export async function purgeTenantWithin(
  sql: Sql,
  tenantId: string,
  { dryRun = false }: { dryRun?: boolean } = {},
): Promise<PurgeSummary> {
  const organizationExists = await organizationRowExists(sql, tenantId)
  const perTable: Record<string, number> = {}
  let totalRows = 0
  for (const table of PURGE_TABLES) {
    // Skip a table not yet created / not yet carrying tenant_id (partial migration state) — never crash.
    if (!(await tableHasTenantId(sql, table))) continue
    const n = dryRun
      ? await countTenantRowsInTable(sql, table, tenantId)
      : await deleteTenantRowsFromTable(sql, table, tenantId)
    perTable[table] = n
    totalRows += n
  }

  let sessionsCleared = 0
  let organizationDeleted = false
  if (!dryRun && organizationExists) {
    // session.active_organization_id has no FK (it would block login churn), so clear the dangling
    // pointer explicitly rather than leaving sessions referencing a deleted org.
    const cleared =
      await sql`UPDATE session SET active_organization_id = NULL WHERE active_organization_id = ${tenantId} RETURNING 1`
    sessionsCleared = cleared.length
    // Deleting the org row cascades its member + invitation rows (ON DELETE CASCADE); the RESTRICT app
    // FKs above are already satisfied because every tenant row was removed first.
    const deleted = await sql`DELETE FROM organization WHERE id = ${tenantId} RETURNING 1`
    organizationDeleted = deleted.length > 0
  }

  return {
    tenantId,
    organizationExists,
    organizationDeleted,
    perTable,
    totalRows,
    sessionsCleared,
    dryRun,
  }
}

// Public entrypoint: acquires the migrator advisory lock and runs the whole purge in ONE transaction
// (atomic — a partial purge can never leave a half-deleted tenant). The xact-scoped lock auto-releases
// on commit/rollback. On a fresh DB with no organization table yet, it is a clean no-op.
export async function purgeTenant(
  sql: Sql,
  tenantId: string,
  { dryRun = false }: { dryRun?: boolean } = {},
): Promise<PurgeSummary> {
  return (await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(${PURGE_LOCK_KEY})`
    if (!(await organizationTableExists(tx as unknown as Sql))) {
      return {
        tenantId,
        organizationExists: false,
        organizationDeleted: false,
        perTable: {},
        totalRows: 0,
        sessionsCleared: 0,
        dryRun,
      } satisfies PurgeSummary
    }
    return await purgeTenantWithin(tx as unknown as Sql, tenantId, { dryRun })
  })) as PurgeSummary
}

function printSummary(summary: PurgeSummary): void {
  const nonZero = Object.entries(summary.perTable).filter(([, n]) => n > 0)
  for (const [table, n] of nonZero) console.log(`  ${table}: ${n}`)
  if (nonZero.length === 0) console.log('  (no tenant rows in any table)')
  console.log(`  total tenant rows: ${summary.totalRows}`)
  console.log(`  organization present: ${summary.organizationExists}`)
  console.log(
    summary.dryRun
      ? `  organization would be deleted: ${summary.organizationExists}`
      : `  organization deleted: ${summary.organizationDeleted} · sessions cleared: ${summary.sessionsCleared}`,
  )
}

async function main() {
  const tenantId = process.argv[2]
  const flags = process.argv.slice(3)
  const commit = flags.includes('--commit') || flags.includes('--yes')

  if (!tenantId || tenantId.startsWith('-')) {
    console.error('[purge-tenant] usage: purge-tenant <organizationId> [--commit]')
    console.error(
      '[purge-tenant] runs a DRY-RUN by default; pass --commit to execute the irreversible purge.',
    )
    process.exit(1)
  }
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error('[purge-tenant] DATABASE_URL is not set')
    process.exit(1)
  }

  const sql = postgres(url, { max: 1, onnotice: () => {} })
  try {
    console.log(
      `[purge-tenant] ${commit ? 'COMMIT' : 'DRY-RUN'} — tenant ${tenantId} (global user/account rows are NOT touched)`,
    )
    const summary = await purgeTenant(sql, tenantId, { dryRun: !commit })
    printSummary(summary)
    if (!commit) {
      console.log('[purge-tenant] DRY-RUN — nothing was deleted. Re-run with --commit to execute.')
    } else if (!summary.organizationExists) {
      console.log('[purge-tenant] organization not found — nothing to purge (already removed?).')
    } else {
      console.log('[purge-tenant] done — tenant purged.')
    }
    await sql.end({ timeout: 5 })
    process.exit(0)
  } catch (err) {
    console.error('[purge-tenant] FAILED:', err)
    await sql.end({ timeout: 5 }).catch(() => {})
    process.exit(1)
  }
}

// Run only when executed directly (node dist/purge-tenant.mjs / npx tsx ...), NOT when imported by a
// test — so the unit suite can exercise the exported functions without process.exit().
const invokedDirectly = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) void main()
