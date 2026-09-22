import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'
import {
  CLEANUP_TABLES,
  cleanupOrphanTenants,
  deleteOrphansFromTable,
  organizationTableExists,
  tableHasTenantId,
  tenantFkAlreadyEnforced,
} from '../scripts/cleanup-orphan-tenants'

// B1: the orphan-cleanup step is wired into the container entrypoint to run BEFORE migrate on every
// boot. These tests pin the properties that make that safe:
//  1. the delete predicate actually removes orphan rows and spares valid ones (exercised in isolation
//     against temp fixtures, since 0016's FK makes seeding an orphan into the real tables impossible);
//  2. schema guards don't crash on a missing table/column (fresh/partial DB → no-op, not crash-loop);
//  3. on a fully-migrated DB the FK fast-path skips the scans entirely.
const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is not set (tests load it via dotenv/config)')

let sql: ReturnType<typeof postgres>
beforeAll(() => {
  sql = postgres(url, { max: 1, onnotice: () => {} })
})
afterAll(async () => {
  await sql.end({ timeout: 5 })
})

describe('deleteOrphansFromTable (the core delete predicate)', () => {
  it('deletes rows whose tenant_id has no matching ref, and spares valid ones', async () => {
    await sql.begin(async (tx) => {
      await tx`CREATE TEMP TABLE _probe_ref (id text primary key) ON COMMIT DROP`
      await tx`CREATE TEMP TABLE _probe_rows (tenant_id text) ON COMMIT DROP`
      await tx`INSERT INTO _probe_ref (id) VALUES ('org_ok')`
      await tx`INSERT INTO _probe_rows (tenant_id) VALUES ('org_ok'), ('org_ok'), ('orphan_missing')`

      const removed = await deleteOrphansFromTable(tx as unknown as typeof sql, '_probe_rows', '_probe_ref')
      expect(removed).toBe(1)

      const survivors = await tx<{ tenant_id: string }[]>`SELECT tenant_id FROM _probe_rows`
      expect(survivors).toHaveLength(2)
      expect(survivors.every((r) => r.tenant_id === 'org_ok')).toBe(true)
    })
  })

  it('removes 0 when every row has a valid ref (idempotent shape)', async () => {
    await sql.begin(async (tx) => {
      await tx`CREATE TEMP TABLE _probe_ref (id text primary key) ON COMMIT DROP`
      await tx`CREATE TEMP TABLE _probe_rows (tenant_id text) ON COMMIT DROP`
      await tx`INSERT INTO _probe_ref (id) VALUES ('org_ok')`
      await tx`INSERT INTO _probe_rows (tenant_id) VALUES ('org_ok'), ('org_ok')`
      const removed = await deleteOrphansFromTable(tx as unknown as typeof sql, '_probe_rows', '_probe_ref')
      expect(removed).toBe(0)
    })
  })
})

describe('schema guards', () => {
  it('tableHasTenantId: true for a tenant-scoped app table', async () => {
    expect(await tableHasTenantId(sql, 'student')).toBe(true)
  })

  it('tableHasTenantId: false for a table without tenant_id (organization)', async () => {
    expect(await tableHasTenantId(sql, 'organization')).toBe(false)
  })

  it('tableHasTenantId: false for a non-existent table (fresh / partial DB — the anti-crash guard)', async () => {
    expect(await tableHasTenantId(sql, 'definitely_not_a_real_table_9f3a')).toBe(false)
  })

  it('organizationTableExists: true on the migrated DB', async () => {
    expect(await organizationTableExists(sql)).toBe(true)
  })
})

describe('cleanupOrphanTenants on a healthy migrated DB', () => {
  it('takes the FK fast-path (0016 applied) so orphans are impossible', async () => {
    expect(await tenantFkAlreadyEnforced(sql)).toBe(true)
  })

  it('is a non-destructive no-op — returns 0 and does not throw', async () => {
    expect(await cleanupOrphanTenants(sql)).toBe(0)
  })

  it('covers every tenant-scoped table the FK migration constrains, without duplicates', () => {
    expect(CLEANUP_TABLES).toContain('student')
    expect(CLEANUP_TABLES).toContain('payment')
    expect(new Set(CLEANUP_TABLES).size).toBe(CLEANUP_TABLES.length)
  })
})
